import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isolateBridgeEnvironment } from './fixtures/agent-server-bridge-env.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'zyra-engine-imports-'));
const isolation = isolateBridgeEnvironment(directory);
let publicEntryLoaded = false;
let extensionCompilerLoaded = false;
const optionalModulesLoaded = new Set();
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/runtime/engine/src/index.js')) publicEntryLoaded = true;
  if (url.includes('/node_modules/jiti/')) extensionCompilerLoaded = true;
  for (const name of ['core/resource-loader.js', 'core/package-manager.js', 'core/export-html/index.js']) {
    if (url.endsWith(name)) optionalModulesLoaded.add(name);
  }
  return nextLoad(url, context);
} });
try {
  const core = await import('../src/zyra-session-engine.mjs');
  await import('../src/zyra-runtime.mjs');
  assert.equal(publicEntryLoaded, false, 'core services must not initialize the public CLI/terminal entry');
  assert.equal(extensionCompilerLoaded, false, 'normal sessions do not load the extension compiler');
  const { createZyraSession } = await import('../src/zyra-sdk.mjs');
  const project = path.join(directory, 'project');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(project, { recursive: true });
  const { fixtureModel } = await import('./fixtures/agent-server-bridge-env.mjs');
  const runtime = await createZyraSession({ project, model: fixtureModel, memoryEnabled: false, enableFleet: false,
    skipMemoryStartup: true, skipModelAvailability: true, persistStartupPreferences: false });
  try {
    assert.deepEqual([...optionalModulesLoaded], [], 'normal Chat setup must defer optional package discovery and HTML export');
    assert.ok(runtime.session.model, 'the production session is fully configured');
    const { ensureSessionDurable } = await import('../src/agent-server/session-durability.mjs');
    ensureSessionDurable(runtime.session.sessionManager);
    const html = await runtime.session.exportToHtml(path.join(directory, 'fixture.html'));
    assert.ok((await readFile(html, 'utf8')).includes('<html'), 'on-demand HTML export retains the real exporter');
    assert.ok(optionalModulesLoaded.has('core/export-html/index.js'));
    const { createZyraRuntime } = await import('../src/zyra-runtime.mjs');
    const { modelRuntime } = await createZyraRuntime();
    const fallback = await core.createAgentSession({ cwd: project, modelRuntime, model: runtime.session.model });
    try { assert.ok(optionalModulesLoaded.has('core/resource-loader.js'), 'default SDK resource discovery still loads when requested'); }
    finally { fallback.session.dispose(); }
    const extensions = await createZyraSession({ project, model: fixtureModel, memoryEnabled: false,
      enableFleet: false, enableExtensions: true, noSession: true, skipMemoryStartup: true,
      skipModelAvailability: true, persistStartupPreferences: false });
    try { assert.equal(extensions.session.model.provider, runtime.session.model.provider, 'explicit extension loading preserves provider selection'); }
    finally { extensions.session.dispose(); }
  } finally { runtime.session.dispose(); await runtime.fleet?.cancelAll?.('Import check finished'); }
  const full = await import('../src/runtime/engine/src/index.js');
  for (const [name, value] of Object.entries(core)) assert.equal(value, full[name], `${name} retains the exact engine implementation`);
  const { VIRTUAL_MODULES } = await import('../src/runtime/engine/src/core/extensions/virtual-modules.js');
  assert.equal(VIRTUAL_MODULES['@zyra/engine'], full);
  assert.equal(VIRTUAL_MODULES['@earendil-works/pi-coding-agent'], full);
  assert.equal(VIRTUAL_MODULES['@mariozechner/pi-coding-agent'], full);
  assert.equal(VIRTUAL_MODULES['@zyra/terminal'], VIRTUAL_MODULES['@mariozechner/pi-tui']);
  assert.equal(VIRTUAL_MODULES.typebox, VIRTUAL_MODULES['@sinclair/typebox']);
  isolation.assertOffline();
  console.log('Session imports exclude the public engine, preserve core export identities and retain bundled extension aliases.');
} finally {
  hooks.deregister(); isolation.restore();
  await rm(directory, { recursive: true, force: true });
}
