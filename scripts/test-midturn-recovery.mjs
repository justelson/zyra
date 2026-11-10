import assert from 'node:assert/strict';
import { AgentSession } from '../src/runtime/engine/src/core/agent-session.js';
import { isRetryableAssistantError, retryAssistantCall } from '../src/runtime/providers/src/utils/retry.js';

const failure = (text, extra = {}) => ({ role: 'assistant', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } }, content: [], stopReason: 'error', errorMessage: text, ...extra });
assert.equal(isRetryableAssistantError(failure('An unexpected model response failed.')), true, 'an unclassified first failure gets one bounded recovery attempt');
assert.equal(isRetryableAssistantError(failure('An unexpected model response failed.'), 1), false, 'unknown persistent failures cannot loop ten times');
for (const text of ['401 unauthorized', 'Invalid API key', 'Thinking must be one of: high', '403 permission denied', 'quota exceeded', 'invalid request schema']) {
    assert.equal(isRetryableAssistantError(failure(text)), false, `${text} needs a user/configuration change`);
}
assert.equal(isRetryableAssistantError(failure('fetch failed', { errorRetryable: false })), false, 'externally admitted actions cannot be blindly resubmitted');
assert.equal(isRetryableAssistantError(failure('Please try again.')), true);
assert.equal(isRetryableAssistantError(failure('')), true, 'missing provider details still get one recovery attempt');
assert.equal(isRetryableAssistantError(failure(''), 1), false);
assert.equal(isRetryableAssistantError({ ...failure('temporary'), stopReason: 'aborted' }), false);
assert.equal(isRetryableAssistantError(failure('503 unavailable'), 3), true);

class RetrySession extends AgentSession {
    _buildRuntime() { this._extensionRunner = { hasHandlers: () => false, emit: async () => undefined, emitMessageEnd: async () => undefined }; }
    async _checkCompaction() { return false; }
}
for (const recover of [true, false]) {
    const events = [], saved = [];
    let listener, attempts = 0;
    const previousTool = { role: 'toolResult', toolCallId: 'already-done', content: [{ type: 'text', text: 'Retained output' }] };
    const agent = { state: { model: { contextWindow: 100000 }, messages: [previousTool], tools: [] },
        subscribe(fn) { listener = fn; return () => {}; }, hasQueuedMessages: () => false };
    const session = new RetrySession({ agent, cwd: process.cwd(), resourceLoader: {},
        settingsManager: { getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 1 }) },
        sessionManager: { appendMessage: message => saved.push(message) } });
    session.subscribe(event => events.push(event));
    async function produce() {
        attempts++;
        const message = recover && attempts > 1 ? { ...failure(''), content: [{ type: 'text', text: 'Continuing' }], stopReason: 'stop' }
            : failure('An unexpected model response failed.');
        agent.state.messages.push(message);
        await listener({ type: 'message_end', message });
        await listener({ type: 'agent_end', messages: [message] });
    }
    agent.prompt = produce;
    agent.continue = produce;
    await session._runAgentPrompt([{ role: 'user', content: 'Continue' }]);
    assert.equal(attempts, 2);
    assert.equal(agent.state.messages[0], previousTool, 'continuation retains completed tools rather than rerunning the original prompt');
    assert.deepEqual(events.filter(e => e.type === 'agent_end').map(e => e.willRetry), [true, false]);
    assert.equal(events.filter(e => e.type === 'agent_settled').length, 1, 'one canonical run settles once');
    assert.equal(events.find(e => e.type === 'auto_retry_end')?.success, recover);
}
console.log('Mid-turn recovery: one bounded unknown-error retry, same run, retained tool output, persistent/permanent failure boundaries passed');

for (const [text,enabled,maxRetries,expected] of [['Unknown failure',true,10,2],['503 unavailable',true,2,3],['Unknown failure',false,10,1],['401 unauthorized',true,10,1]]) {
 let calls=0;
 await retryAssistantCall(async()=>{calls++;return failure(text)}, {enabled,maxRetries,baseDelayMs:1});
 assert.equal(calls,expected,'helper and agent loop apply the same bounded policy');
}
const stop=new AbortController();let stoppedCalls=0;
const stopped=await retryAssistantCall(async()=>{stoppedCalls++;return failure('503 unavailable')}, {enabled:true,maxRetries:3,baseDelayMs:50},stop.signal,{onRetryScheduled:()=>stop.abort()});
assert.equal(stopped.stopReason,'aborted');assert.equal(stoppedCalls,1,'Stop during recovery cannot make another provider request');
