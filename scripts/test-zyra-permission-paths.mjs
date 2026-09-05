import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rename, rm } from 'node:fs/promises';
import { createZyraPermissionGateExtension, describeZyraToolPermission } from '../src/zyra-permission-gate.mjs';
import { resolvePermissionPath } from '../src/permission-paths.mjs';

const piEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
const pi = await import(new URL('./core/tools/path-utils.js', piEntry));
const { createReadToolDefinition } = await import(new URL('./core/tools/read.js', piEntry));
const { createWriteToolDefinition } = await import(new URL('./core/tools/write.js', piEntry));
const { createEditToolDefinition } = await import(new URL('./core/tools/edit.js', piEntry));
const fixture = await mkdtemp(path.join(os.tmpdir(), 'zyra-permission-paths-'));
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const failures = [];
let passed = 0;
async function check(name, run) {
  try { await run(); passed++; }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  const project = path.join(fixture, 'project');
  const home = path.join(fixture, 'home');
  const outside = path.join(fixture, 'outside');
  const readOnly = path.join(fixture, 'read only');
  const skill = path.join(home, 'skill');
  for (const dir of [project, home, outside, readOnly, skill]) await mkdir(dir, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  assert.equal(os.homedir(), home, 'Home expansion must stay in the isolated fixture');
  const filesystemScope = { roots: [{ path: project, access: 'read-write' }, { path: readOnly, access: 'read-only' }] };
  const options = { project, filesystemScope };
  const handler = (extra = {}) => createZyraPermissionGateExtension({
    ...options, getPermissionMode: () => 'full-access',
    requestPermission: async () => { throw new Error('Hard scope limits must not prompt'); }, ...extra,
  }).handlers.get('tool_call')[0];
  const gate = handler();
  const read = createReadToolDefinition(project);
  const write = createWriteToolDefinition(project);
  const edit = createEditToolDefinition(project);
  const link = async (target, name) => symlink(target, name, process.platform === 'win32' ? 'junction' : 'dir');
  await link(outside, path.join(project, 'escape'));
  await link(readOnly, path.join(project, 'readonly-alias'));
  await writeFile(path.join(home, 'note.txt'), 'home fixture');
  await writeFile(path.join(outside, 'note.txt'), 'outside fixture');
  await writeFile(path.join(readOnly, 'note.txt'), 'readonly fixture');

  const directCases = [
    ['tilde home', '~/note.txt', path.join(home, 'note.txt'), 'outside'],
    ['at absolute', `@${path.join(outside, 'note.txt')}`, path.join(outside, 'note.txt'), 'outside'],
    ['at tilde', '@~/note.txt', path.join(home, 'note.txt'), 'outside'],
    ['unicode spaces', path.join(readOnly, 'note.txt').replace('read only', 'read\u00a0only'), path.join(readOnly, 'note.txt'), 'readonly'],
    ['file URL', pathToFileURL(path.join(outside, 'note.txt')).href, path.join(outside, 'note.txt'), 'outside'],
    ['junction outside', 'escape/note.txt', path.join(outside, 'note.txt'), 'outside'],
    ['junction readonly', 'readonly-alias/note.txt', path.join(readOnly, 'note.txt'), 'readonly'],
  ];
  if (process.platform === 'win32') {
    directCases.push(['backslash tilde', '~\\note.txt', path.join(home, 'note.txt'), 'outside']);
    const native = path.join(outside, 'note.txt');
    directCases.push(['MSYS drive', `/${native[0].toLowerCase()}/${native.slice(3).replaceAll('\\', '/')}`, native, 'outside']);
  }
  for (const [name, inputPath, destination, boundary] of directCases) {
    // Execute unguarded native tools ONLY against fixture data, proving the destination.
    for (const toolName of ['write', 'edit', 'grep', 'find', 'ls']) {
      assert.equal(resolvePermissionPath(inputPath, project, toolName), pi.resolveToCwd(inputPath, project), `${name}/${toolName} resolver parity`);
    }
    assert.equal(resolvePermissionPath(inputPath, project, 'read'), await pi.resolveReadPathAsync(inputPath, project), `${name}/read resolver parity`);
    assert.equal(await realpath(pi.resolveToCwd(inputPath, project)), await realpath(destination), name);
    assert.equal(await realpath(await pi.resolveReadPathAsync(inputPath, project)), await realpath(destination), name);
    await write.execute('fixture-write', { path: inputPath, content: 'native before' });
    assert.equal(await readFile(destination, 'utf8'), 'native before');
    await edit.execute('fixture-edit', { path: inputPath, edits: [{ oldText: 'native before', newText: 'native after' }] });
    assert.equal(await readFile(destination, 'utf8'), 'native after');
    assert.equal((await read.execute('fixture-read', { path: inputPath })).content[0].text, 'native after');
    for (const toolName of ['read', 'write', 'edit']) await check(`${name}/${toolName}`, async () => {
      const result = await gate({ toolName, input: { path: inputPath } });
      if (toolName === 'read' && boundary === 'readonly') assert.equal(result, undefined);
      else {
        assert.equal(result?.block, true);
        assert.match(result.reason, boundary === 'readonly' ? /read-only Project folder/ : /outside this chat's filesystem scope/);
      }
    });
  }
  for (const [name, alias] of [['outside', 'escape'], ['readonly', 'readonly-alias']]) {
    await check(`new descendants/${name}`, async () => {
      assert.equal((await gate({ toolName: 'write', input: { path: `${alias}/new/deep/file.txt` } }))?.block, true);
    });
  }
  // Each fallback variant is a directory alias escaping the Project.
  for (const [typed, actual] of [["quote's", 'quote’s'], ['caf\u00e9', 'cafe\u0301'], ['shot AM.png', 'shot\u202fAM.png'], ["caf\u00e9's", 'cafe\u0301’s']]) {
    await link(outside, path.join(project, actual));
    const inputPath = `${typed}/note.txt`;
    assert.equal(resolvePermissionPath(inputPath, project, 'read'), await pi.resolveReadPathAsync(inputPath, project));
    assert.equal(resolvePermissionPath(inputPath, project, 'edit'), pi.resolveToCwd(inputPath, project));
    assert.equal(await realpath(await pi.resolveReadPathAsync(inputPath, project)), await realpath(path.join(outside, 'note.txt')));
    assert.equal((await read.execute('variant', { path: inputPath })).content[0].text, 'native after');
    await check(`read variant ${typed}`, async () => assert.equal((await gate({ toolName: 'read', input: { path: inputPath } }))?.block, true));
    // Pinned 0.84.3 edit uses resolveToCwd, NOT read's filename fallbacks.
    await assert.rejects(edit.execute('no-edit-fallback', { path: inputPath, edits: [{ oldText: 'native after', newText: 'wrong' }] }));
  }
  await check('writable native path spellings', async () => {
    for (const inputPath of ['new.txt', '@new.txt', pathToFileURL(path.join(project, 'new.txt')).href]) {
      assert.equal(await gate({ toolName: 'write', input: { path: inputPath } }), undefined);
      await write.execute('allowed', { path: inputPath, content: 'allowed' });
    }
    assert.equal(await readFile(path.join(project, 'new.txt'), 'utf8'), 'allowed');
  });
  await check('native filenames are not trimmed', async () => {
    const spaced = ' leading.txt';
    await write.execute('spaced-name', { path: spaced, content: 'spaced' });
    assert.equal(await readFile(path.join(project, spaced), 'utf8'), 'spaced');
    const spacedGate = handler({ filesystemScope: { roots: [
      ...filesystemScope.roots, { path: path.join(project, spaced), access: 'read-only' },
    ] } });
    assert.equal((await spacedGate({ toolName: 'write', input: { path: spaced } }))?.block, true);
  });
  await check('canonical read-only aliases beat writable roots', async () => {
    const alias = path.join(project, 'readonly-alias');
    const aliasGate = handler({ filesystemScope: { roots: [
      ...filesystemScope.roots, { path: alias, access: 'read-write' },
    ] } });
    assert.equal((await aliasGate({ toolName: 'write', input: { path: `${alias}/new.txt` } }))?.block, true);
    const duplicateGate = handler({ filesystemScope: { roots: [
      { path: project, access: 'read-write' }, { path: project, access: 'read-only' },
    ] } });
    assert.equal((await duplicateGate({ toolName: 'write', input: { path: 'new.txt' } }))?.block, true);
  });
  await check('outside aliases do not acquire Project authority', async () => {
    const alias = path.join(outside, 'project-alias');
    await link(project, alias);
    const inputPath = path.join(alias, 'new.txt');
    assert.equal(await realpath(await pi.resolveReadPathAsync(inputPath, project)), await realpath(path.join(project, 'new.txt')));
    for (const toolName of ['read', 'write', 'edit']) assert.equal((await gate({ toolName, input: { path: inputPath } }))?.block, true);
  });
  await check('scope root may itself be a stable junction', async () => {
    const alias = path.join(fixture, 'project-alias');
    await link(project, alias);
    const aliasGate = handler({ project: alias, filesystemScope: { roots: [{ path: alias, access: 'read-write' }] } });
    assert.equal(await aliasGate({ toolName: 'write', input: { path: 'new.txt' } }), undefined);
    assert.equal((await aliasGate({ toolName: 'write', input: { path: 'escape/new.txt' } }))?.block, true);
    await rm(alias);
    await link(outside, alias);
    for (const toolName of ['read', 'write', 'grep', 'find', 'ls']) {
      const input = ['grep', 'find', 'ls'].includes(toolName) ? {} : { path: 'note.txt' };
      assert.equal((await aliasGate({ toolName, input }))?.block, true, toolName);
    }
  });
  await check('session grant cannot authorize retargeted descendants', async () => {
    const target = path.join(project, 'target');
    const alias = path.join(project, 'changing');
    await mkdir(target);
    await link(target, alias);
    let approvals = 0;
    const sessionGate = handler({ getPermissionMode: () => 'approval-required', requestPermission: async () => { approvals++; return 'acceptForSession'; } });
    assert.equal(await sessionGate({ toolName: 'write', input: { path: 'changing/new.txt' } }), undefined);
    await rm(alias);
    await link(outside, alias);
    assert.equal((await sessionGate({ toolName: 'write', input: { path: 'changing/new/deep.txt' } }))?.block, true);
    assert.equal(approvals, 1);
  });
  await check('dangling junction fails closed', async () => {
    const target = path.join(fixture, 'vanishing');
    await mkdir(target);
    await link(target, path.join(project, 'dangling'));
    await rm(target, { recursive: true });
    assert.equal((await gate({ toolName: 'write', input: { path: 'dangling/new.txt' } }))?.block, true);
  });
  await check('all permission modes enforce normalized scope', async () => {
    for (const mode of ['full-access', 'edits-only', 'auto-review', 'approval-required']) {
      const modeGate = handler({ getPermissionMode: () => mode, reviewPermission: async () => { throw new Error('Must not review scope violations'); } });
      for (const inputPath of ['~/note.txt', 'escape/new/deep.txt', 'readonly-alias/note.txt']) {
        assert.equal((await modeGate({ toolName: 'write', input: { path: inputPath } }))?.block, true);
      }
    }
  });
  await check('malformed file URL fails closed', async () => {
    assert.equal((await gate({ toolName: 'read', input: { path: 'file:///%zz' } }))?.block, true);
  });
  await check('legacy scope keeps approval behavior', async () => {
    let approvals = 0;
    const legacy = handler({ filesystemScope: undefined, getPermissionMode: () => 'edits-only', requestPermission: async () => { approvals++; return 'acceptOnce'; } });
    assert.equal(await legacy({ toolName: 'write', input: { path: '../outside/legacy.txt' } }), undefined);
    assert.equal(approvals, 1);
    assert.equal(describeZyraToolPermission({ toolName: 'write', input: { path: '~/note.txt' } }, { project }).scopeViolation, false);
  });
  await writeFile(path.join(skill, 'SKILL.md'), 'Skill fixture');
  await writeFile(path.join(skill, 'guide’s.md'), 'Skill reference');
  await link(outside, path.join(skill, 'escape'));
  const resource = { path: skill, realPath: await realpath(skill), directory: true };
  const skillGate = handler({ getSkillReadResources: () => [resource] });
  for (const inputPath of [path.join(skill, 'SKILL.md'), '~/skill/SKILL.md', '@~/skill/SKILL.md', "~/skill/guide's.md"]) {
    await check(`Skill read ${path.basename(inputPath)}/${inputPath.startsWith('~') ? 'tilde' : inputPath[0]}`, async () => {
      assert.equal(await skillGate({ toolName: 'read', input: { path: inputPath } }), undefined);
    });
  }
  await check('Skill authority remains read-only and nonrecursive', async () => {
    for (const toolName of ['write', 'edit', 'grep', 'find', 'ls']) assert.equal((await skillGate({ toolName, input: { path: path.join(skill, 'SKILL.md') } }))?.block, true);
    assert.equal((await skillGate({ toolName: 'bash', input: { command: `cat "${path.join(skill, 'SKILL.md')}"` } }))?.block, true);
    for (const inputPath of [skill, path.join(skill, 'missing.md'), path.join(skill, 'escape/note.txt'), path.join(home, 'note.txt'), '~/skill/escape/note.txt', '@~/skill/escape/note.txt', '~/note.txt']) {
      assert.equal((await skillGate({ toolName: 'read', input: { path: inputPath } }))?.block, true);
    }
  });
  await check('standalone Skill and resource revocation stay bounded', async () => {
    const standalone = path.join(home, 'standalone.md');
    await writeFile(standalone, 'Standalone fixture');
    let resources = [{ path: standalone, realPath: await realpath(standalone), directory: false }];
    const standaloneGate = handler({ getSkillReadResources: () => resources });
    assert.equal(await standaloneGate({ toolName: 'read', input: { path: '@~/standalone.md' } }), undefined);
    assert.equal((await standaloneGate({ toolName: 'read', input: { path: '~/note.txt' } }))?.block, true);
    assert.equal((await standaloneGate({ toolName: 'write', input: { path: '@~/standalone.md' } }))?.block, true);
    resources = [];
    assert.equal((await standaloneGate({ toolName: 'read', input: { path: '@~/standalone.md' } }))?.block, true);
  });
  await check('Skill directory retarget revokes reads', async () => {
    await rename(skill, `${skill}-saved`);
    await link(outside, skill);
    for (const inputPath of [path.join(skill, 'note.txt'), '~/skill/note.txt', '@~/skill/note.txt']) {
      assert.equal((await skillGate({ toolName: 'read', input: { path: inputPath } }))?.block, true);
    }
  });
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(fixture, { recursive: true, force: true });
}
console.log(`Permission path regressions: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
