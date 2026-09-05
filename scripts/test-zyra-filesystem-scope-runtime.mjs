import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { loadSkillsFromDir, formatSkillsForPrompt } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js';
import { resolveZyraSkillSources } from '../src/zyra-prompt-resources.mjs';
import { createZyraPermissionGateExtension } from '../src/zyra-permission-gate.mjs';

const sdkSource = await readFile(new URL('../src/zyra-sdk.mjs', import.meta.url), 'utf8');

// Execute the production functions, including both option-forwarding call sites.
// Do not import the SDK: its session setup always creates a credential-backed Pi
// runtime. Offline substitutes stop at createAgentSession, before memory setup or
// any provider/session activity. The loader and permission gate are not mocked.
function productionFunction(name) {
  const start = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm').exec(sdkSource);
  assert.ok(start, `Production function ${name} must exist`);
  const end = sdkSource.indexOf('\n}', start.index);
  assert.notEqual(end, -1, `Production function ${name} must have a top-level closing brace`);
  return sdkSource.slice(start.index, end + 2).replace(/^export /, '');
}

function createStartupProbe(fixture) {
  let captured;
  let defaultLoaderCount = 0;
  let defaultReloadCount = 0;
  let skillLoadCount = 0;
  const stopAtPiSession = new Error('Offline startup captured');
  const agentDir = path.join(fixture, 'agent');
  const extensionRuntime = { offline: true };
  const externalExtension = { path: '<fixture:external>', handlers: new Map() };
  const settingsManager = { applyOverrides() {} };
  const pi = {
    loadSkillsFromDir,
    getAgentDir: () => agentDir,
    SettingsManager: {
      create(project, requestedAgentDir, options) {
        assert.equal(requestedAgentDir, agentDir);
        assert.equal(options.projectTrusted, false);
        assert.ok(project.startsWith(`${fixture}${path.sep}`));
        return settingsManager;
      },
    },
    createExtensionRuntime: () => extensionRuntime,
    DefaultResourceLoader: class {
      constructor(options) {
        defaultLoaderCount += 1;
        assert.equal(options.agentDir, agentDir);
        this.options = options;
      }
      async reload() { defaultReloadCount += 1; }
      getExtensions() {
        return { extensions: [externalExtension], errors: [], runtime: extensionRuntime };
      }
      getSkills() { return this.options.skillsOverride(); }
    },
    async createAgentSession(options) {
      captured = options;
      throw stopAtPiSession;
    },
  };
  const emptyTool = () => ({ name: 'offline-unused' });
  const context = vm.createContext({
    path,
    existsSync,
    mkdirSync,
    realpathSync,
    statSync,
    // No inherited environment, home, auth, network, timers, or module imports.
    process: { env: {}, platform: process.platform },
    ROOT: fixture,
    defaults: { project: fixture, prompt: path.join(fixture, 'guide.md') },
    DEFAULT_ASSISTANT_REASONING_SUMMARY: 'auto',
    DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS: 100000,
    normalizeAssistantReasoningSummary: (value) => value,
    normalizeAssistantContextCompactionThreshold: (value) => value,
    readProjectPreferences: () => ({}),
    resolveZyraStartupPreferences: () => ({ thinking: 'medium', codexServiceTier: 'default' }),
    loadPiPackage: async () => pi,
    loadPiSessionManager: async () => ({
      inMemory: (cwd) => ({ getCwd: () => cwd }),
    }),
    loadPiStartupResources: async () => pi,
    createZyraPiRuntime: async () => ({ modelRuntime: {}, modelRegistry: {} }),
    loadZyraToolModules: async () => ({
      createManagedBashState: () => ({}),
      createManagedBashTool: emptyTool,
      createAssistantActionBatchTool: emptyTool,
      createZyraWebSearchTool: emptyTool,
      createZyraWebFetchTool: emptyTool,
      createZyraWriteTool: emptyTool,
      createBrowserControlTool: emptyTool,
      createBrowserToolSet: () => [],
      createComputerToolSet: () => [],
    }),
    createRequestUserInputTool: emptyTool,
    ensureSessionTheme: () => 'fixture',
    ensureSessionTerminalTheme: () => 'fixture',
    ensureSessionProfile: () => 'default',
    registerZyraRuntimeModels: () => [],
    toPiThinkingLevel: (value) => value,
    resolveZyraSkillSources: (options) => resolveZyraSkillSources({
      ...options, home: fixture,
      skillSourceSettings: { enabledSourceIds: [], customSources: [], priority: [] },
    }),
    readZyraSkillSourceSettings: async () => ({ preferredSourceBySkill: {} }),
    createZyraPermissionGateExtension,
  });
  const functions = [
    'loadZyraSkills',
    'createZyraSession',
    'createSessionManager',
    'applyZyraChatRetryPolicy',
    'createZyraResourceLoader',
    'createFastResourceLoader',
    'createEmptyExtensionRuntime',
    'withZyraBuiltinExtensions',
    'createZyraBuiltinExtensions',
    'createCodexServiceTierExtension',
    'createGpt56ThinkingExtension',
    'createReasoningSummaryExtension',
  ];
  // Retry constants are only used for an in-memory settings override.
  context.ZYRA_RETRY_MAX_ATTEMPTS = 1;
  context.ZYRA_RETRY_BASE_DELAY_MS = 1;
  vm.runInContext(functions.map(productionFunction).join('\n\n'), context, {
    filename: 'zyra-sdk-offline-startup.mjs',
  });
  const actualLoadSkills = context.loadZyraSkills;
  context.loadZyraSkills = (...args) => { skillLoadCount += 1; return actualLoadSkills(...args); };
  return {
    async start(options) {
      captured = undefined;
      const previousDefaultCount = defaultLoaderCount;
      const previousReloadCount = defaultReloadCount;
      const previousSkillCount = skillLoadCount;
      await assert.rejects(context.createZyraSession({
        sessions: path.join(fixture, 'sessions'),
        noSession: true,
        enableFleet: false,
        ...options,
      }), (error) => error === stopAtPiSession);
      assert.ok(captured, 'Actual startup must pass a resource loader to Pi');
      assert.equal(captured.cwd, options.project);
      assert.equal(captured.agentDir, agentDir);
      assert.equal(captured.settingsManager, settingsManager);
      assert.equal(defaultLoaderCount - previousDefaultCount, options.enablePiExtensions ? 1 : 0);
      assert.equal(defaultReloadCount - previousReloadCount, options.enablePiExtensions ? 1 : 0);
      assert.equal(skillLoadCount - previousSkillCount, 1);
      return captured.resourceLoader;
    },
    async reload(loader, enabled) {
      const previousReloadCount = defaultReloadCount;
      const previousSkillCount = skillLoadCount;
      await loader.reload();
      assert.equal(defaultReloadCount - previousReloadCount, enabled ? 1 : 0);
      assert.equal(skillLoadCount - previousSkillCount, 1);
    },
    gate(loader, enabled) {
      const loaded = loader.getExtensions();
      assert.equal(loaded.runtime, extensionRuntime);
      assert.equal(loaded.errors.length, 0);
      assert.equal(loaded.extensions.includes(externalExtension), enabled);
      const gates = loaded.extensions.filter((entry) => entry.path === '<zyra:permission-gate>');
      assert.equal(gates.length, 1, 'Startup must install exactly one real built-in gate');
      return gates[0].handlers.get('tool_call')[0];
    },
  };
}

const fixture = await mkdtemp(path.join(os.tmpdir(), 'zyra-filesystem-scope-runtime-'));
let checks = 0;
const failures = [];
async function check(label, action) {
  try {
    await action();
    checks += 1;
  } catch (error) {
    failures.push({ label, error });
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

try {
  const home = path.join(fixture, 'project-home');
  const writable = path.join(fixture, 'associated-writable');
  const readOnly = path.join(fixture, 'associated-read-only');
  const outside = path.join(fixture, 'outside');
  await Promise.all([home, writable, readOnly, outside].map((dir) => mkdir(dir)));
  await writeFile(path.join(fixture, 'guide.md'), 'Offline fixture guide.\n');
  const roots = [
    { id: 'home', kind: 'project-home', path: home, access: 'read-write' },
    { id: 'writable', kind: 'associated-folder', path: writable, access: 'read-write' },
    { id: 'reference', kind: 'associated-folder', path: readOnly, access: 'read-only' },
  ];
  const probe = createStartupProbe(fixture);
  for (const enabled of [false, true]) {
    const branch = enabled ? 'enabled-extensions' : 'default-fast';
    // Leave enablePiExtensions absent for the real default branch.
    const branchOptions = enabled ? { enablePiExtensions: true } : {};
    for (const project of [writable, readOnly]) {
      const filesystemScope = {
        projectId: 'fixture-project', projectRevision: 3, workingRoot: project, roots,
      };
      const originalScope = JSON.stringify(filesystemScope);
      let mode = 'full-access';
      let requests = 0;
      let reviews = 0;
      const loader = await probe.start({
        ...branchOptions,
        project,
        filesystemScope,
        getPermissionMode: () => mode,
        permissionRequest: async () => { requests += 1; return 'acceptForSession'; },
        permissionReview: async () => { reviews += 1; return { decision: 'approve' }; },
      });
      for (const phase of ['startup', 'reload']) {
        if (phase === 'reload') await probe.reload(loader, enabled);
        const handler = probe.gate(loader, enabled);
        const call = (toolName, target) => handler({ toolName, input: { path: target } });
        const prefix = `${branch}/${path.basename(project)}/${phase}`;
        for (mode of ['full-access', 'edits-only', 'auto-review', 'approval-required']) {
          await check(`${prefix}/${mode}/scope ceilings`, async () => {
            const before = [requests, reviews];
            const targets = [path.join(readOnly, 'notes.md')];
            if (project === readOnly) targets.push('notes.md');
            for (const tool of ['write', 'edit']) {
              for (const target of targets) {
                const result = await call(tool, target);
                assert.equal(result?.block, true, `${tool} in a read-only root must be blocked`);
                assert.match(result.reason, /read-only Project folder/i);
              }
            }
            assert.deepEqual([requests, reviews], before, 'Approval and review cannot widen read-only access');
          });
          await check(`${prefix}/${mode}/out-of-scope denial`, async () => {
            const before = [requests, reviews];
            for (const tool of ['read', 'write', 'edit']) {
              for (const target of [path.join(outside, 'notes.md'), '../outside/notes.md', `${project}-sibling/notes.md`]) {
                const result = await call(tool, target);
                assert.equal(result?.block, true, `${tool} outside scope must be blocked`);
                assert.match(result.reason, /outside this chat's filesystem scope/i);
              }
            }
            assert.deepEqual([requests, reviews], before, 'Approval and review cannot widen scope');
          });
        }
        for (mode of ['full-access', 'edits-only']) {
          await check(`${prefix}/${mode}/all permitted roots`, async () => {
            const before = [requests, reviews];
            for (const root of roots) {
              assert.equal(await call('read', path.join(root.path, 'notes.md')), undefined);
              if (root.access === 'read-write') {
                for (const tool of ['write', 'edit']) {
                  assert.equal(await call(tool, path.join(root.path, 'notes.md')), undefined);
                }
              }
            }
            assert.equal(await call('read', 'notes.md'), undefined, 'Relative reads use the Working root');
            if (project === writable) assert.equal(await call('write', 'notes.md'), undefined);
            assert.deepEqual([requests, reviews], before, 'All allowed roots are in scope, not just cwd');
          });
        }
        await check(`${prefix}/session approval stays bounded`, async () => {
          mode = 'approval-required';
          const before = requests;
          assert.equal(await call('write', path.join(writable, 'approved.md')), undefined);
          assert.equal(await call('write', path.join(home, 'approved.md')), undefined);
          const expectedRequests = phase === 'reload' && !enabled ? 0 : 1;
          assert.equal(requests, before + expectedRequests, 'Writable roots share the scoped grant; fast reload retains it');
          mode = 'full-access';
          const beforeDenials = [requests, reviews];
          assert.equal((await call('write', path.join(readOnly, 'notes.md')))?.block, true);
          assert.equal((await call('write', path.join(outside, 'notes.md')))?.block, true);
          assert.deepEqual([requests, reviews], beforeDenials);
        });
      }
      assert.equal(JSON.stringify(filesystemScope), originalScope, 'Startup must not mutate the saved scope');
    }
    await check(`${branch}/loaded Skill progressive read`, async () => {
      const pluginRoot = path.join(fixture, 'plugin');
      const skillDir = path.join(pluginRoot, 'skills', 'approved');
      await mkdir(path.join(skillDir, 'references'), { recursive: true });
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: approved
description: Offline approved Skill
---
Read references/guide.md.
`);
      await writeFile(path.join(skillDir, 'references', 'guide.md'), 'Offline reference');
      const pluginSkillSources = [{
        dir: path.join(pluginRoot, 'skills'), installationRoot: pluginRoot,
        sourceId: 'fixture-plugin', sourceLabel: 'Fixture plugin', pluginId: 'fixture',
        releaseId: 'fixture-release', contentDigest: 'a'.repeat(64), scope: 'personal',
      }];
      const globalDir = path.join(fixture, 'skills');
      await mkdir(globalDir, { recursive: true });
      const standalone = path.join(globalDir, 'standalone.md');
      await writeFile(standalone, `---
name: standalone
description: Standalone global fixture
---
Instructions`);
      const unrelated = path.join(pluginRoot, 'unrelated.txt');
      await writeFile(unrelated, 'Unrelated fixture');
      await writeFile(path.join(globalDir, 'not-a-skill.txt'), 'Unrelated global fixture');
      await writeFile(path.join(outside, 'reference.md'), 'Outside fixture');
      const escape = path.join(skillDir, 'escape');
      // Junctions exercise realpath boundaries on Windows without symlink privileges.
      await symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
      let skillMode = 'full-access';
      const loader = await probe.start({
        ...branchOptions, project: writable, filesystemScope: { roots }, pluginSkillSources,
        getPermissionMode: () => skillMode,
        permissionRequest: async () => { throw new Error('Skill reads must not request approval'); },
      });
      const skill = loader.getSkills().skills.find((entry) => entry.name === 'approved');
      assert.ok(skill, 'Real Zyra/Pi loading must expose the approved plugin Skill');
      assert.equal(skill.baseDir, skillDir);
      assert.match(formatSkillsForPrompt(loader.getSkills().skills), /Use the read tool/);
      const handler = probe.gate(loader, enabled);
      assert.equal(await handler({ toolName: 'read', input: { path: skill.filePath } }), undefined,
        'Prompt-advertised SKILL.md must pass the real permission gate');
      const reference = path.join(skill.baseDir, 'references/guide.md');
      for (skillMode of ['full-access', 'edits-only', 'auto-review', 'approval-required']) {
        for (const target of [skill.filePath, reference, standalone]) {
          assert.equal(await handler({ toolName: 'read', input: { path: target } }), undefined);
        }
        for (const target of [pluginRoot, unrelated, globalDir, path.join(globalDir, 'not-a-skill.txt'),
          path.join(escape, 'reference.md'), path.join(skillDir, '../../unrelated.txt'),
          path.join(skillDir, 'missing.md')]) {
          assert.equal((await handler({ toolName: 'read', input: { path: target } }))?.block, true,
            `Read must not widen Skill authority: ${target}`);
        }
        for (const toolName of ['write', 'edit', 'grep', 'find', 'ls', 'custom_read']) {
          assert.equal((await handler({ toolName, input: { path: reference } }))?.block, true);
        }
        assert.equal((await handler({ toolName: 'bash', input: { command: `cat "${reference}"` } }))?.block, true);
      }
      // A resource directory swapped after loading cannot move the read boundary.
      const savedSkillDir = `${skillDir}-saved`;
      await rename(skillDir, savedSkillDir);
      await symlink(outside, skillDir, process.platform === 'win32' ? 'junction' : 'dir');
      assert.equal((await handler({ toolName: 'read', input: { path: path.join(skillDir, 'reference.md') } }))?.block, true);
      await rm(skillDir);
      await rename(savedSkillDir, skillDir);
      assert.equal(await handler({ toolName: 'read', input: { path: reference } }), undefined);
      // A failed reload clears old authority rather than keeping stale grants.
      const savedSource = pluginSkillSources[0];
      pluginSkillSources[0] = { ...savedSource, contentDigest: 'invalid' };
      await assert.rejects(loader.reload(), /metadata is invalid/);
      assert.equal((await handler({ toolName: 'read', input: { path: reference } }))?.block, true);
      pluginSkillSources[0] = savedSource;
      await probe.reload(loader, enabled);
      assert.equal(await handler({ toolName: 'read', input: { path: reference } }), undefined);
      // Retained handlers must see revocation too, including the proxy loader branch.
      pluginSkillSources.splice(0);
      await probe.reload(loader, enabled);
      assert.equal(loader.getSkills().skills.some((entry) => entry.name === 'approved'), false);
      for (const gate of [handler, probe.gate(loader, enabled)]) {
        assert.equal((await gate({ toolName: 'read', input: { path: reference } }))?.block, true);
        assert.equal(await gate({ toolName: 'read', input: { path: standalone } }), undefined);
      }
      await rm(escape);
    });
    await check(`${branch}/legacy no-explicit-scope fallback`, async () => {
      let mode = 'edits-only';
      let requests = 0;
      let reviews = 0;
      const loader = await probe.start({
        ...branchOptions,
        project: writable,
        getPermissionMode: () => mode,
        permissionRequest: async () => { requests += 1; return 'acceptOnce'; },
        permissionReview: async () => { reviews += 1; return { decision: 'approve' }; },
      });
      for (const phase of ['startup', 'reload']) {
        if (phase === 'reload') await probe.reload(loader, enabled);
        const handler = probe.gate(loader, enabled);
        mode = 'edits-only';
        const before = requests;
        assert.equal(await handler({ toolName: 'read', input: { path: 'notes.md' } }), undefined);
        assert.equal(await handler({ toolName: 'write', input: { path: 'notes.md' } }), undefined);
        assert.equal(requests, before, 'Legacy project-local access remains permitted');
        assert.equal(await handler({ toolName: 'write', input: { path: '../outside/notes.md' } }), undefined);
        assert.equal(requests, before + 1, 'Legacy outside writes still request approval, not hard denial');
        mode = 'full-access';
        const beforeReviews = reviews;
        for (const toolName of ['read', 'write']) {
          assert.equal(await handler({ toolName, input: { path: '../outside/notes.md' } }), undefined);
        }
        assert.equal(reviews, beforeReviews + 2, 'Legacy full-access outside paths remain reviewable');
      }
    });
  }
} finally {
  await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  assert.equal(existsSync(fixture), false, 'Temporary fixtures must be removed even on failure');
}

console.log(`Zyra filesystem scope startup wiring: ${checks} passed, ${failures.length} failed; fixtures cleaned`);
if (failures.length) process.exitCode = 1;
