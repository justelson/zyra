import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { readRuntimeRevision } from '../src/agent-server/runtime-revision.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'zyra-cold-connect-'));
const root = path.join(directory, 'runtime');
let server, client, startup;
try {
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'src', 'entry.mjs'), 'export const version=1;');
  const options = { root, stateDirectory: path.join(directory, 'state'), channel: 'cold-connect', endpoint: 0 };
  server = new ZyraAgentServer(options);
  client = new ZyraAgentServerClient({ ...options, verifyRuntimeRevision: true });
  let starts = 0;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  client.startServer = () => { starts++; startup = server.start(); markStarted(); };
  const connecting = client.connect();
  // Admission is asynchronous. Observe launch after that guard, without waiting
  // for the full fingerprint/handshake or imposing a wall-clock delay.
  await Promise.race([started, connecting]);
  assert.equal(starts, 1, 'a missing service starts while the client fingerprint is being read');
  assert.equal(client.expectedRuntimeRevision, null, 'launch precedes full fingerprint acceptance');
  await Promise.all([connecting, client.connect()]);
  assert.equal(starts, 1, 'concurrent callers share one server launch and handshake');
  assert.equal(client.serverRuntimeRevision, await readRuntimeRevision(root), 'acceptance still verifies the full runtime revision');
  assert.equal(client.connectionStatus.connection, 'connected');
  assert.equal(client.connectionStatus.updatePending === true, false);
  console.log('Cold connection: launch overlaps fingerprint, concurrent launch coalesces, revision verification preserved.');
} finally {
  client?.close();
  await startup;
  await server?.stop();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
