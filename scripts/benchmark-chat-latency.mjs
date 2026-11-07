import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { observeTurnEvent, summarizeSample, distribution } from './response-latency/metrics.mjs';
import { assertInstructionFreeProject, assertOutsideProfile } from './response-latency/project.mjs';

const flags = new Map();
const valueFlags = new Set(['--runtime-root', '--profile', '--output', '--samples', '--timeout-ms', '--idle-ms', '--scenario', '--project']);
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--live' || flag === '--direct-provider') flags.set(flag, true);
  else if (valueFlags.has(flag) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) flags.set(flag, process.argv[++i]);
  else throw new Error('Use --runtime-root PATH --profile PATH --output PATH [--project PATH] [--samples 3] [--scenario echo|code-review] [--idle-ms 0] [--timeout-ms 180000] [--direct-provider] [--live].');
}
for (const name of ['--runtime-root', '--profile', '--output']) if (!flags.has(name)) throw new Error(`${name} is required.`);
const root = path.resolve(flags.get('--runtime-root'));
const profile = path.resolve(flags.get('--profile'));
const output = path.resolve(flags.get('--output'));
assertOutsideProfile(output, profile);
const count = Number(flags.get('--samples') || 3);
const timeoutMs = Number(flags.get('--timeout-ms') || 180_000);
const idleMs = Number(flags.get('--idle-ms') || 0);
const scenario = String(flags.get('--scenario') || 'echo');
if (flags.has('--direct-provider') && idleMs) throw new Error('Use the full Chat path for idle tests.');
const prompts = {
  echo: 'This is a latency measurement. Reply with exactly OK. Do not use any tools.',
  'code-review': `Review this TypeScript cache for concurrency and stale-data bugs. Explain a concrete failing interleaving, then give a corrected implementation. Keep the answer under 250 words. Work only from this code and do not use any tools.\n\nclass Cache {\n value?: string;\n pending?: Promise<string>;\n async get(load: () => Promise<string>) {\n  if (this.value) return this.value;\n  this.pending ??= load().then(v => this.value = v);\n  return this.pending;\n }\n invalidate() { this.value = undefined; this.pending = undefined; }\n}`,
};
if (!Object.hasOwn(prompts, scenario)) throw new Error('Use scenario echo or code-review.');
if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000) throw new Error('Use 1-10 samples and a timeout of 1000-600000 ms.');
if (!Number.isInteger(idleMs) || idleMs < 0 || idleMs > 600_000) throw new Error('Use an idle interval of 0-600000 ms.');
if (existsSync(path.join(output, 'report.json'))) throw new Error('Use a fresh output directory for each measurement.');
const saved = JSON.parse(readFileSync(path.join(profile, 'setup/device-preferences.json'), 'utf8')).shared;
const settings = {
  model: 'openai-codex/gpt-6.1-sol', thinking: saved.assistantDefaultEffort,
  reasoningSummary: saved.assistantReasoningSummary, profile: saved.assistantProductProfile,
  runtimeMode: saved.assistantDefaultRuntimeMode, webSearch: saved.assistantDefaultWebSearch,
  webFetch: saved.assistantDefaultWebFetch, memoryEnabled: saved.assistantMemoryEnabled,
  ...(saved.assistantDefaultFastMode ? { serviceTier: 'fast' } : {}),
};
const plan = { settings, scenario, samples: count, timeoutMs, idleMs, mode: flags.has('--direct-provider')
  ? 'bare provider comparison; no Chat system prompt, tools, server or bridge'
  : 'production server, bridge, SDK and provider; isolated test project and server state; no Electron',
  credentials: 'existing Preview credential owner, no credential copies',
  resources: 'built-in skills and commands; fresh synthetic home excludes personal resources',
  creditsEnabled: flags.has('--live') };
console.log(JSON.stringify({ stage: 'plan', ...plan }));
if (!flags.has('--live')) process.exit(0);
if (settings.memoryEnabled !== false) throw new Error('This isolated runner currently requires Preview memory off to avoid reading personal memory.');
// User temp directories often inherit home-level instructions on Windows.
// A fresh system-temp fixture avoids both the checkout and the user's home.
const scratch = process.platform === 'win32' ? path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'Temp') : tmpdir();
const project = flags.has('--project') ? path.resolve(flags.get('--project'))
  : path.join(scratch, `zyra-chat-latency-${randomUUID()}`);
assertOutsideProfile(project, profile);
assertInstructionFreeProject(project);
if (existsSync(project) && readdirSync(project).length) throw new Error('Synthetic project must be a new or empty scratch directory.');
mkdirSync(output, { recursive: true });
const stateDirectory = path.join(output, 'server-state');
mkdirSync(project, { recursive: true });
// SDK skill/command discovery uses os.homedir(), independently of data/agent
// directories. Give this process and its workers a fresh home while retaining
// the explicitly selected credential owner below. Never reuse an existing home.
const syntheticHome = path.join(output, 'home');
mkdirSync(syntheticHome);
const observationPath = path.join(output, 'provider-observations.jsonl');
// Workers use the existing credential/config owner. Server-owned catalogs/journals
// use the explicit isolated stateDirectory below. User chats are never attached.
Object.assign(process.env, {
  HOME: syntheticHome, USERPROFILE: syntheticHome,
  ZYRA_ROOT: root, ZYRA_DATA_ROOT: path.join(output, 'data'),
  ZYRA_STATE_DIR: path.join(profile, 'assistant/agent-server'),
  ZYRA_CODING_AGENT_DIR: path.join(output, 'coding-agent'), ZYRA_AGENT_DIR: path.join(output, 'coding-agent'),
  ZYRA_MEMORY_BACKGROUND: '0', ZYRA_ANALYTICS_ENABLED: '0', ZYRA_ANALYTICS_USE_RELEASE_CONFIG: '0',
  ZYRA_LATENCY_OBSERVATIONS: observationPath,
  ZYRA_PERFORMANCE_TRACE: '1',
  ZYRA_CODEX_SERVICE_TIER: saved.assistantDefaultFastMode ? 'priority' : 'default',
});
const preload = pathToFileURL(path.join(import.meta.dirname, 'response-latency/observe-provider.mjs')).href;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim();
const instanceStartedAt = Date.now();
const importRuntime = file => import(pathToFileURL(path.join(root, file)).href);
if (flags.has('--direct-provider')) {
  const { runProviderBaseline } = await import('./response-latency/provider-baseline.mjs');
  try { await runProviderBaseline({ importRuntime, settings, prompt: prompts[scenario], count, timeoutMs, output, plan }); }
  catch { console.log(JSON.stringify({ stage: 'failed', code: 'PROVIDER_BASELINE_FAILED' })); process.exitCode = 1; }
} else {
const { ZyraAgentServer } = await importRuntime('src/agent-server/server.mjs');
const { ZyraAgentServerClient } = await importRuntime('src/agent-server/client.mjs');
const stages = { importsMs: Date.now() - instanceStartedAt };
const channel = `latency-${randomUUID().slice(0, 8)}`;
const options = { root, stateDirectory, channel, idleTimeoutMs: 30_000 };
const server = new ZyraAgentServer(options);
const performanceMetrics = [];
server.on('worker-stderr', ({ text }) => {
  for (const line of text.split('\n')) {
    if (!line.startsWith('[zyra-performance] ')) continue;
    try {
      const value = JSON.parse(line.slice('[zyra-performance] '.length));
      const clean = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
        ['area', 'phase'].includes(key) ? typeof item === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(item)
          : typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean'));
      performanceMetrics.push(clean);
    } catch {}
  }
});
const client = new ZyraAgentServerClient({ ...options, autoStart: false, verifyRuntimeRevision: false, surface: 'desktop', clientId: `latency:${randomUUID()}` });
const samples = [];
let active, attached, peakRss = process.memoryUsage().rss;
const events = envelope => {
  if (!active || envelope.sessionKey !== attached?.sessionKey) return;
  observeTurnEvent(active, envelope.event, Date.now());
  if (envelope.event.type === 'approval_requested') {
    void client.request('session.request', { sessionKey: attached.sessionKey, type: 'approval.respond',
      payload: { requestId: envelope.event.requestId, decision: 'decline' } }).catch(() => {});
  }
};
client.on('session-event', events);
const monitor = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 1000);
monitor.unref();
let exitCode = 0;
try {
  const startAt = Date.now(); await server.start(); stages.serverStartMs = Date.now() - startAt;
  const connectAt = Date.now(); await client.connect(); stages.clientConnectMs = Date.now() - connectAt;
  const attachStarted = Date.now();
  attached = await client.attach({ ...settings, project, cwd: project, localThreadId: `latency:${randomUUID()}` });
  stages.attachMs = Date.now() - attachStarted;
  console.log(JSON.stringify({ stage: 'ready', startupMs: Date.now() - instanceStartedAt, attachMs: Date.now() - attachStarted,
    model: attached.connected.model, thinking: attached.connected.thinking, stages }));
  if (attached.connected.model !== settings.model) throw new Error('Production runtime selected a different model. No prompt was sent.');
  for (let i = 0; i < count; i++) {
    if (i && idleMs) {
      console.log(JSON.stringify({ stage: 'idle', idleMs }));
      // Progress stays observable during long idle/reconnection experiments.
      for (let remaining = idleMs; remaining > 0; remaining -= Math.min(remaining, 15_000)) {
        await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 15_000)));
        console.log(JSON.stringify({ stage: 'idle-progress', remainingMs: Math.max(0, remaining - 15_000) }));
      }
    }
    active = { name: i ? `${idleMs ? 'idle' : 'warm'}-followup-${i}` : 'fresh-chat', submittedAt: Date.now(), instanceStartedAt,
      textCharacters: 0, toolCalls: 0, retries: 0, compactions: 0 };
    console.log(JSON.stringify({ stage: 'submitted', sample: active.name }));
    const waitLog = setInterval(() => console.log(JSON.stringify({ stage: 'waiting', sample: active.name,
      elapsedMs: Date.now() - active.submittedAt, firstTextReceived: Boolean(active.firstTextReceivedAt) })), 15_000);
    try {
      await client.request('session.request', { sessionKey: attached.sessionKey, type: 'prompt',
        payload: { ...settings, prompt: prompts[scenario], initialManualTitle: 'Latency measurement' },
        requestContext: { turnId: `latency-turn:${randomUUID()}`, localThreadId: 'latency-measurement' } }, { timeoutMs });
      active.completedAt = Date.now();
    } catch (error) {
      active.completedAt = Date.now(); active.failure = error.code === 'AGENT_SERVER_TIMEOUT' ? 'timeout' : 'error';
      // Do not print raw provider errors, which may contain endpoint/account details.
      exitCode = 1;
      await client.request('session.request', { sessionKey: attached.sessionKey, type: 'abort', payload: {} }, { timeoutMs: 10_000 }).catch(() => {});
    } finally { clearInterval(waitLog); }
    // Observer snapshots are synchronously written alongside outgoing worker events.
    let latest = [], workerPeakRssBytes = 0;
    if (existsSync(observationPath)) for (const line of readFileSync(observationPath, 'utf8').trim().split('\n')) {
      try { const observation = JSON.parse(line); latest = observation.requests;
        workerPeakRssBytes = Math.max(workerPeakRssBytes, observation.rssBytes || 0); } catch {}
    }
    const requests = latest.filter(row => row.startedAt >= active.submittedAt);
    const sample = summarizeSample(active, requests); samples.push(sample);
    if (sample.outcome !== 'completed' || sample.submitToFirstTextMs === null) exitCode = 1;
    writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...plan, stages, samples, performanceMetrics,
      runtimeVersion: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      runtimeRevision: server.runtimeRevision, nodeVersion: process.version,
      observedRunnerPeakRssBytes: peakRss, observedWorkerPeakRssBytes: workerPeakRssBytes,
      firstText: distribution(samples.map(s => s.submitToFirstTextMs)), note: 'Client receipt is measured. Desktop/phone display paint is not measured by this Node runner.' }, null, 2));
    console.log(JSON.stringify({ stage: 'measured', ...sample }));
    if (exitCode) break;
  }
} catch (error) {
  exitCode = 1;
  const code = /^[A-Z][A-Z0-9_]{0,80}$/.test(error.code || '') ? error.code : 'LATENCY_RUN_FAILED';
  console.log(JSON.stringify({ stage: 'failed', code }));
  writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ code, stages, completedSamples: samples.length }));
} finally {
  clearInterval(monitor); client.off('session-event', events); client.close(); await server.stop('Latency measurement finished.');
}
process.exitCode = exitCode;
}
