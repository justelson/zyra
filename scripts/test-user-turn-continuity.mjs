import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createUserTurnContinuity, readUserTurnRootMessageId } from '../src/user-turn-continuity.mjs';
import { AgentBridgeWorker } from '../src/agent-server/bridge-worker.mjs';

const observer = createUserTurnContinuity();
const user = timestamp => ({ role: 'user', content: [{ type: 'text', text: 'Synthetic correction' }], timestamp });
const first = user(100), correction = user(101), next = user(102);
observer.observe({ type: 'agent_start' });
observer.observe({ type: 'message_start', message: first });
observer.observe({ type: 'agent_end', willRetry: true });
observer.observe({ type: 'agent_start' });
observer.expectSteeringMessage();
observer.observe({ type: 'message_end', message: correction });
assert.equal(readUserTurnRootMessageId(correction), readUserTurnRootMessageId(first), 'retries preserve the task root');
observer.observe({ type: 'agent_end' });
observer.observe({ type: 'agent_start' });
observer.observe({ type: 'message_start', message: next });
assert.notEqual(readUserTurnRootMessageId(next), readUserTurnRootMessageId(first), 'a terminal end releases the previous task root');
const cancel = observer.expectSteeringMessage(); cancel();
const queued = user(103);
observer.observe({ type: 'message_start', message: queued });
assert.notEqual(readUserTurnRootMessageId(queued), readUserTurnRootMessageId(next), 'non-steering follow-ups and rejected steering cannot inherit the task root');
assert.equal(readUserTurnRootMessageId({ ...first, zyraUserTurn: { version: 2, rootMessageId: 'invalid-version' } }), null);
assert.equal(readUserTurnRootMessageId({ ...first, zyraUserTurn: { version: 1, rootMessageId: '../invalid' } }), null);

const directory = await mkdtemp(path.join(tmpdir(), 'zyra-user-turn-'));
const sessionFile = path.join(directory, 'canonical.jsonl');
let worker;
try {
  await mkdir(path.join(directory, 'src'));
  await writeFile(path.join(directory, 'src/zyra-sdk.mjs'), `
import { appendFileSync } from 'node:fs';
let emit, finish, timestamp = 1793966400000;
const append = message => appendFileSync(${JSON.stringify(sessionFile)}, JSON.stringify({type:'message',id:String(message.timestamp),message})+'\\n');
const sendUser = text => { const message={role:'user',content:[{type:'text',text}],timestamp:timestamp++};emit({type:'message_start',message});emit({type:'message_end',message});append(message); };
export async function createZyraSession(){return {session:{sessionManager:{getSessionId:()=> 'turn-fixture'},subscribe(fn){emit=fn;return ()=>{}},async steer(text){sendUser(text)},async abort(){finish?.()},abortCompaction(){},dispose(){}}};}
export function describeRuntime(){return {};}
export function getZyraThinkingLevel(){return 'low';}
export function setZyraReasoningSummary(){}
export async function prepareZyraSessionRuntime(){}
export async function runZyraPrompt(runtime,text){const done=new Promise(resolve=>{finish=resolve});emit({type:'agent_start'});sendUser(text);await done;emit({type:'agent_end'});}
`);
  worker = new AgentBridgeWorker({ root: directory, cwd: directory, bridgePath: path.resolve(import.meta.dirname, '../src/zyra-ui-bridge.mjs') });
  await worker.request('connect', { surface: 'memory-worker', cwd: directory }, { timeoutMs: 15000 });
  for (let index = 0; index < 2; index++) {
    const started = once(worker, 'event');
    const prompt = worker.request('prompt', { prompt: `Task ${index}`, skipTitleGeneration: true });
    void prompt.catch(() => {});
    await started;
    await worker.request('steer', { prompt: 'First correction' });
    await worker.request('steer', { prompt: 'Second correction' });
    await worker.request('abort', {}, { timeoutMs: 5000 });
    await prompt;
  }
  const records = (await readFile(sessionFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 6);
  const roots = records.map(entry => readUserTurnRootMessageId(entry.message));
  assert(roots.every(Boolean), 'the actual bridge annotates original and steering message_end records before persistence');
  assert.deepEqual(roots.slice(0, 3), [roots[0], roots[0], roots[0]]);
  assert.deepEqual(roots.slice(3), [roots[3], roots[3], roots[3]]);
  assert.notEqual(roots[0], roots[3], 'a new prompt after Stop cannot inherit the previous task');
  console.log('User turn continuity: actual bridge persistence, repeated steering, retries, Stop/new-task separation and metadata validation: ok');
} finally {
  const child = worker?.child;
  const closed = child && child.exitCode === null ? once(child, 'close') : Promise.resolve();
  worker?.dispose();
  await closed;
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert(path.basename(directory).startsWith('zyra-user-turn-'));
  await rm(directory, { recursive: true, force: true });
}
