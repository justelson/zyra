import { spawn } from 'node:child_process';
import path from 'node:path';

// Serial fixtures keep timing checks free from competing compiler/import work.
const checks = [
  ['scripts/build-runtime-schema.mjs', '--check'],
  ['scripts/test-runtime-schema.mjs'],
  ['scripts/test-session-engine-imports.mjs'],
  ['scripts/test-session-worker-pool.mjs'],
  ['scripts/test-harness-transport.mjs'],
  ['scripts/test-harness-transport-broker.mjs'],
  ['scripts/test-harness-config-plugin.mjs'],
  ['scripts/test-harness-broker-bridge.mjs'],
  ['scripts/test-session-connect-overlap.mjs'],
  ['scripts/test-harness-conversation.mjs'],
  ['scripts/test-harness-events.mjs'],
  ['scripts/test-harness-stream-recovery.mjs'],
  ['scripts/test-runtime-latency.mjs'],
  ['scripts/test-opencode-harness.mjs'],
  ['scripts/test-harness-v2.mjs'],
];
for (const args of checks) await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(Error(`${args[0]} failed (${code})`)));
});
console.log('Harness performance and behavior checks passed; no live model calls.');
