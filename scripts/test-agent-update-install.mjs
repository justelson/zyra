import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { assertRuntimeStartAllowed, installSuccessFile, inspectInstallRecovery, recoverInstallHandoff, recordInstallHandoff, readStoppedInstallHandoff, renewStoppedInstallHandoff, restoreStoppedInstallHandoff } from '../src/agent-server/install-guard.mjs';
import { readRuntimeRevision } from '../src/agent-server/runtime-revision.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'zyra-install-handoff-'));
const clients = []; let server, stopped;
try {
    const root = path.join(directory, 'runtime'); await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'fixture.mjs'), 'export const synthetic = true;');
    await writeFile(path.join(root, 'package.json'), '{"version":"0.7.0"}');
    const options = { root, stateDirectory: path.join(directory, 'state'), channel: 'test', endpoint: 0, desktopAuthorityToken: 'fixture-authority', createWorker() { throw new Error('No real provider may start'); } };
    server = new ZyraAgentServer(options); await server.start();
    server.once('retire', () => { stopped = server.stop(); });
    const client = new ZyraAgentServerClient({ ...options, autoStart: false, verifyRuntimeRevision: false, requiredMethods: ['server.status'], surface: 'desktop', authorityProof: 'fixture-authority', authorities: ['desktop-control'], heartbeat: false }); clients.push(client); await client.connect();
    const input = { expectedInstanceId: server.instanceId, expectedNamespaceId: server.paths.namespaceId, targetVersion: '0.8.0', stopBlockers: true };
    const observer = new ZyraAgentServerClient({ ...options, autoStart: false, verifyRuntimeRevision: false, requiredMethods: ['server.status'], heartbeat: false }); clients.push(observer); await observer.connect();
    await assert.rejects(observer.request('server.prepareUpdate', input), { code: 'AGENT_SERVER_AUTH_FAILED' });
    let localCancellations = 0;
    const hooks = { onPrepared: async () => { localCancellations++; } };
    await assert.rejects(client.prepareRuntimeInstallation({ ...input, expectedInstanceId: 'older-instance' }, hooks), { code: 'AGENT_SERVER_INSTANCE_CHANGED' });
    assert.equal(localCancellations, 0, 'stale consent cannot cancel local pending submissions');
    let release, stops = 0;
    const session = { sessionKey: 'fixture-chat', latestTurn: { id: 'fixture-turn', state: 'running' },
        summary() { return { latestTurn: this.latestTurn } }, releaseUserInputContinuations() {}, dispose() {},
        publish(event) { this.latestTurn = { ...this.latestTurn, state: event.outcome } },
        worker: { async shutdown() { await new Promise(resolve => { release = resolve }); stops++; } } };
    server.sessions.set(session.sessionKey, session);
    const descriptor = JSON.parse(readFileSync(server.paths.descriptorFile, 'utf8'));
    writeFileSync(server.paths.descriptorFile, JSON.stringify({ ...descriptor, pid: 2147483646 }));
    const installation = client.prepareRuntimeInstallation(input, hooks);
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(stops, 0); assert.equal(session.latestTurn.state, 'running'); assert.equal(localCancellations, 0);
    await assert.rejects(observer.request('runtime.prepare'), { code: 'AGENT_SERVER_UPDATE_PENDING' });
    release(); await installation; await stopped;
    assert.equal(stops, 1); assert.equal(session.latestTurn.state, 'interrupted'); assert.equal(localCancellations, 1, 'local cancellation runs only under the exact prepared lease');
    await assert.rejects(assertRuntimeStartAllowed(server.paths, root), { code: 'AGENT_SERVER_INSTALL_PENDING' });
    const recovery = await inspectInstallRecovery(server.paths, root);
    assert.equal(recovery.targetVersion, '0.8.0');
    assert.equal(await inspectInstallRecovery({ ...server.paths, namespaceId: 'other-namespace' }, root), null);
    await recoverInstallHandoff(server.paths, root);
    await assertRuntimeStartAllowed(server.paths, root);
    recordInstallHandoff(server.paths, root, { ...recovery, instanceId: server.instanceId }, '0.8.0', server.runtimeRevision);
    await writeFile(path.join(root, 'package.json'), '{"version":"0.8.0"}');
    assert.equal(readStoppedInstallHandoff(server.paths, root), null, 'a still-live original PID never becomes repair authority');
    const repairProof = readStoppedInstallHandoff(server.paths, root, () => false);
    assert.equal(repairProof.instanceId, server.instanceId, 'a stopped receipt can repair partially replaced files without running code');
    const repairInput = { ...input, operationId: '11111111-1111-1111-1111-111111111111' };
    assert.throws(() => renewStoppedInstallHandoff(server.paths, root, { ...repairInput, expectedInstanceId: 'newer-instance' }, () => false), /changed update/);
    const prior = renewStoppedInstallHandoff(server.paths, root, repairInput, () => false);
    restoreStoppedInstallHandoff(server.paths, prior, repairInput.operationId);
    assert.equal(readStoppedInstallHandoff(server.paths, root, () => false).receiptNonce, prior.receiptNonce, 'failed repair restores its previous guard, not mixed-code admission');
    renewStoppedInstallHandoff(server.paths, root, repairInput, () => false);
    if (process.platform === 'win32') {
        await assert.rejects(assertRuntimeStartAllowed(server.paths, root), { code: 'AGENT_SERVER_INSTALL_PENDING' });
        const handoff = JSON.parse(readFileSync(path.join(server.paths.stateDirectory, `install-handoff-${server.paths.channel}.json`), 'utf8'));
        writeFileSync(installSuccessFile(server.paths, '0.8.0'), handoff.receiptNonce);
    }
    await assertRuntimeStartAllowed(server.paths, root);
    await assertRuntimeStartAllowed(server.paths, root);
    if (process.platform === 'win32') {
        recordInstallHandoff(server.paths, root, { ...recovery, instanceId: server.instanceId }, '0.8.0', await readRuntimeRevision(root));
        await assert.rejects(assertRuntimeStartAllowed(server.paths, root), { code: 'AGENT_SERVER_INSTALL_PENDING' });
        const reinstall = JSON.parse(readFileSync(path.join(server.paths.stateDirectory, `install-handoff-${server.paths.channel}.json`), 'utf8'));
        writeFileSync(installSuccessFile(server.paths, '0.8.0'), reinstall.receiptNonce);
        await assertRuntimeStartAllowed(server.paths, root);
    }
    console.log('PASS real transport: scoped consent, exact instance, admission freeze, verified worker exit, retirement and old-code restart guard');
} finally { for (const client of clients) client.close(); await stopped; await server?.stop(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
