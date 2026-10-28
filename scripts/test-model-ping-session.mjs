import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentSession } from '../src/runtime/engine/source/core/sdk.ts';
import { DefaultResourceLoader } from '../src/runtime/engine/source/core/resource-loader.ts';
import { SettingsManager } from '../src/runtime/engine/source/core/settings-manager.ts';
import { SessionManager } from '../src/runtime/engine/source/core/session-manager.ts';
import { AssistantMessageEventStream } from '../src/runtime/providers/source/utils/event-stream.ts';
import { pingActiveModel } from '../src/model-ping.mjs';
const directory = await mkdtemp(path.join(tmpdir(), 'zyra-ping-session-'));
const model = { id: 'fixture', provider: 'fixture', api: 'fixture', name: 'Fixture', baseUrl: 'https://fixture.invalid', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, maxTokens: 1024, contextWindow: 8192 };
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const answer = (content, stopReason = 'stop') => ({ role: 'assistant', content, stopReason, usage, api: 'fixture', provider: 'fixture', model: 'fixture', timestamp: Date.now() });
function done(message) { const stream = new AssistantMessageEventStream(); queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); }); return stream; }
let session, toolRuns = 0, calls = 0;
const events = [], contexts = [];
const realNow = Date.now;
try {
    const manager = SessionManager.inMemory(directory);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Synthetic Ping test.' });
    await resourceLoader.reload();
    const evidence = { name: 'evidence', label: 'Evidence', description: 'Synthetic work', parameters: Type.Object({}), execute: async () => { toolRuns++; return { content: [{ type: 'text', text: 'COMPLETED_EVIDENCE' }], details: {} }; } };
    const modelRuntime = { hasConfiguredAuth: () => true, checkAuth: async () => undefined, isUsingOAuth: () => false, getAuth: async () => undefined };
    ({ session } = await createAgentSession({ cwd: directory, agentDir: directory, model, modelRuntime, settingsManager, resourceLoader, sessionManager: manager, tools: ['evidence'], customTools: [evidence] }));
    session.subscribe(event => events.push(event));
    session.agent.streamFunction = (_model, context, options) => {
        contexts.push(context); calls++;
        if (calls === 1) return done(answer([{ type: 'toolCall', id: 'once', name: 'evidence', arguments: {} }], 'toolUse'));
        if (calls === 2) {
            const stream = new AssistantMessageEventStream();
            queueMicrotask(() => stream.push({ type: 'start', partial: answer([{ type: 'thinking', thinking: 'INTERRUPTED_REASONING' }]) }));
            options.signal.addEventListener('abort', () => { stream.push({ type: 'error', reason: 'aborted', error: answer([], 'aborted') }); stream.end(); }, { once: true });
            return stream;
        }
        return done(answer([{ type: 'text', text: 'The evidence is saved. Continuing the original task.' }]));
    };
    const run = session.prompt('Finish the original task.');
    const deadline = realNow() + 5000;
    while (!(calls === 2 && session.agent.state.streamingMessage) && realNow() < deadline) await delay(2);
    assert.equal(calls, 2);
    const request = session.agent.modelRequestProgress;
    assert.ok(request?.canPing);
    Date.now = () => realNow() + 130_000;
    pingActiveModel({ session }, request.requestId);
    await run;
    Date.now = realNow;
    assert.equal(toolRuns, 1);
    assert.equal(calls, 3);
    assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
    assert.equal(events.filter(event => event.type === 'agent_end').length, 1);
    assert.equal(session.agent.state.streamingMessage, undefined);
    assert.equal(contexts[2].messages.filter(message => message.role === 'toolResult').length, 1);
    assert.ok(JSON.stringify(contexts[2].messages).includes('COMPLETED_EVIDENCE'));
    assert.ok(JSON.stringify(contexts[2].messages).includes('Give a brief, concrete progress update'));
    const entries = manager.getEntries();
    assert.equal(entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'zyra.model-ping.v1' && entry.display === false).length, 1);
    assert.equal(entries.filter(entry => entry.type === 'message' && entry.message.role === 'user').length, 1, 'no new saved user bubble');
    assert.equal(entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').length, 1);
    assert.equal(JSON.stringify(entries).includes('INTERRUPTED_REASONING'), false, 'discarded partial never reaches canonical history');
    assert.ok(manager.buildSessionContext().messages.some(message => message.role === 'custom' && message.customType === 'zyra.model-ping.v1'), 'hidden recovery restores into provider context');
    console.log('Model Ping session: real SDK conversion/persistence, one lifecycle and tool result, hidden canonical recovery, discarded reasoning and context restore: ok');
} finally { Date.now = realNow; session?.dispose(); await rm(directory, { recursive: true, force: true }); }
