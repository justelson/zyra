import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { createZyraTuiClientRuntime } from '../src/agent-server/tui-runtime.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'zyra-tui-config-'));
const canonical = 'chat:tui-config';
const chat = { canonicalChatId: canonical, project: dir, cwd: dir, title: 'Synthetic settings sync' };
let durableEntries = [];
const catalog = { history: async () => ({ entries: durableEntries, pageInfo: { oldestCursor: 'fixture:oldest', hasOlder: false } }), record: { metadata: {} }, registerProject: () => dir, find: async () => chat, resolveAlias: v => v || '', recordAttachment() {},
  updateChat: async () => chat, list: async () => [chat], snapshot: () => ({ projects: [{ path: dir }] }) };
class Worker extends EventEmitter {
  config = { model: 'openai-codex/gpt-5.6-sol', thinking: 'high', runtimeMode: 'approval-required', profile: 'default', webSearch: false, webFetch: false };
  models = [{id:'openai-codex/gpt-5.6-sol',label:'Sol',supportedEfforts:['high','max'],contextWindow:64000,inputModes:['text']},{id:'opencode-harness/new/vendor-model',label:'New model',supportedEfforts:['variant:precise'],contextWindow:null,inputModes:['text']}];
  queue = { steering: [], followUp: [] }; rejectClear = false; memoryMode = 'enabled';
  calls = []; alive = true; rejectNext = false; holdNext = false; rejectHeld = null;
  isAlive() { return this.alive; }
  publish(patch) { Object.assign(this.config, patch); this.emit('event', { type: 'session_config', ...this.config }); }
  async request(type, payload) {
    this.calls.push({ type, payload });
    if (type === 'connect') return { threadId: canonical, cwd: dir, config: { ...this.config }, messages: [], availableModels:this.models, activeToolNames:['read','plugin_live_tool'], usage: { cost: .5, costComplete: true } };
    if(type === 'preferences.get')return {memoryMode:this.memoryMode};
    if(type === 'memory.configure'){this.memoryMode=payload.enabled?'enabled':'disabled';return {memoryMode:this.memoryMode};}
    if(type === 'memory.run')return {stage1:{succeeded:1},phase2:{status:'succeeded'}};
    if(type === 'warmup')return {models:this.models};
    if (type === 'configure') {
      if (this.rejectNext) { this.rejectNext = false; throw new Error('Synthetic configure rejection'); }
      if (this.holdNext) { this.holdNext = false; return new Promise((_, reject) => { this.rejectHeld = reject; }); }
      this.publish(payload); return { config: { ...this.config } };
    }
    if(type === 'prompt') {
      this.emit('event',{type:'agent_start'});
      if(payload.prompt === 'Synthetic failed recovery') {
        this.emit('event',{type:'agent_end',willRetry:true});
        this.emit('event',{type:'auto_retry_end',success:false,finalError:'Provider recovery exhausted'});
        return {};
      }
      const startedAt=performance.timeOrigin+performance.now();
      this.emit('event',{type:'model_request_progress',progress:{requestId:'fixture:request',startedAt,firstEventAt:startedAt+1,firstTextAt:startedAt+2,lastActivityAt:startedAt+3,phase:'completed',maxActivityGapMs:1}});
      this.emit('event',{type:'message_end',message:{id:'timing:answer',role:'assistant',content:[{type:'text',text:'Synthetic timed response'}]}});
      this.emit('event',{type:'agent_end'});
      await new Promise(resolve=>{this.finishMaintenance=resolve;});
      return {};
    }
    if(type === 'follow_up') {this.queue.followUp.push(payload.prompt);this.emit('event',{type:'queue_update',...this.queue});return {};}
    if(type === 'clear_queue') {if(this.rejectClear)throw new Error('Synthetic clear failure');const removed=structuredClone(this.queue);this.queue={steering:[],followUp:[]};this.emit('event',{type:'queue_update',...this.queue});return removed;}
    return { ok: true };
  }
  dispose() { this.alive = false; }
  sendControlResponse() {}
}
const worker = new Worker();
const server = new ZyraAgentServer({ stateDirectory: dir, root: process.cwd(), endpoint: 0, catalog, createWorker: () => worker });
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(predicate(), 'Canonical configuration did not propagate');
}
let tui, seed;
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
try {
  await server.start();
  seed = new ZyraAgentServerClient({stateDirectory:dir,autoStart:false,surface:'desktop',clientId:'audit:seed'});
  await seed.attach({project:dir,session:canonical});
  worker.emit('event',{type:'approval_requested',requestId:'audit-startup-approval',command:'synthetic no-op'});
  tui = await createZyraTuiClientRuntime({project:dir,session:canonical,agentServer:{stateDirectory:dir,autoStart:false}});
  assert.deepEqual(await tui.agentServer.memoryPreferences(),{mode:'enabled'});
  assert.deepEqual(await tui.agentServer.setMemoryMode('disabled'),{mode:'disabled'});
  assert.equal(worker.memoryMode,'disabled','memory control reaches attached worker');
  assert.equal((await tui.agentServer.consolidateMemory()).stage1.succeeded,1);
  assert.equal(tui.session.model.contextWindow,64000);
  assert.deepEqual(tui.session.getAvailableThinkingLevels(),['high','max']);
  assert.deepEqual(tui.session.getActiveToolNames(),['read','plugin_live_tool']);
  assert.equal(typeof tui.session.setActiveToolsByName,'undefined','client cannot pretend to mutate the host tool inventory');
  assert.equal(tui.session.agent,undefined,'client does not advertise a local-only system prompt setter');
  let asked = 0;
  tui.agentServer.setApprovalHandler(async()=>{asked++;return 'acceptOnce'});
  await pause(150);
  const startup = worker.calls.filter(c=>c.type==='approval.respond');
  console.log(JSON.stringify({case:'approval present when TUI attaches',handlerCalls:asked,decisions:startup.map(c=>c.payload.decision)}));
  assert.equal(asked,1); assert.equal(startup[0]?.payload.decision,'acceptOnce','pending approval waits for its actual presentation handler');

  let failures = 0;
  const client = tui.agentServer.client;
  const request = client.request.bind(client);
  client.request = async(method,params,...options)=>{
    if(method==='session.request'&&params?.type==='approval.respond'&&params.payload?.requestId==='audit-lost-response'){failures++;if(failures===1)throw Object.assign(new Error('Synthetic wire interruption'),{code:'AGENT_SERVER_DISCONNECTED'})}
    return request(method,params,...options);
  };
  worker.emit('event',{type:'approval_requested',requestId:'audit-lost-response',command:'synthetic no-op'});
  await pause(180);
  worker.emit('event',{type:'approval_requested',requestId:'audit-lost-response',command:'synthetic no-op'});
  await pause(180);
  console.log(JSON.stringify({case:'approval delivery fails and is replayed',handlerCalls:asked,deliveryAttempts:failures}));
  await until(()=>worker.calls.some(c=>c.type==='approval.respond'&&c.payload.requestId==='audit-lost-response'));
  assert.equal(asked,2);assert.equal(failures,2,'a failed delivery retries the same selected decision without asking the user again');
  worker.emit('event',{type:'approval_resolved',requestId:'audit-lost-response'});

  const events=[];tui.session.subscribe(event=>events.push(event));
  durableEntries=[{type:'message',id:'entry:user',message:{id:'recovered:user',role:'user',content:[{type:'text',text:'Recover this chat'}]}},{type:'message',id:'entry:answer',message:{id:'recovered:answer',role:'assistant',content:[{type:'text',text:'Durable answer'}],stopReason:'stop'}}];
  const prompt = tui.session.prompt('Synthetic timing prompt');
  await until(()=>typeof worker.finishMaintenance==='function');
  assert(tui.session.isStreaming,'provider agent_end does not settle while maintenance owns the request');
  assert.equal(tui.responseTimings.recorder.read()[0].outcome,'running');
  worker.finishMaintenance(); await prompt;
  await until(()=>tui.responseTimings.recorder.read()[0].outcome==='completed');
  const timing=tui.responseTimings.recorder.read()[0];
  assert(timing.acceptedMs!==null && timing.firstEventMs!==null && timing.firstTextMs!==null && timing.firstTextReceivedMs!==null && timing.completedMs!==null,'actual server and TUI share all observed timing stages');
  assert.equal(timing.firstDisplayMs,null,'transport receipt cannot claim terminal display');
  await tui.session.prompt('Synthetic failed recovery');
  await until(()=>tui.responseTimings.recorder.read()[0].outcome==='failed');
  assert.equal(server.state().sessions[0].latestTurn.state,'error','failed recovery stays failed even when worker RPC resolves');
  worker.emit('event',{type:'agent_start'});
  worker.emit('event',{type:'compaction_start'});
  worker.emit('event',{type:'message_update',message:{id:'live:answer',role:'assistant',content:[{type:'text',text:'Still working'}]}});
  worker.emit('event',{type:'tool_execution_start',toolCallId:'live:tool',toolName:'read',args:{path:'synthetic.txt'}});
  worker.emit('event',{type:'tool_execution_update',toolCallId:'live:tool',partialResult:{content:[{type:'text',text:'Live tool progress'}]}});
  client.emit('session-event',{sessionKey:canonical,sequence:10000,event:{type:'message_end',message:{id:'unconfirmed-gap',role:'assistant',content:[{type:'text',text:'Must not be printed'}]}}});
  await until(()=>events.some(event=>event.type==='zyra_history_replaced'));
  assert.notEqual(tui.agentServer.presence()?.latestSequence,10000,'unconfirmed gap does not advance the cursor');
  assert(!tui.session.messages.some(message=>message.id==='unconfirmed-gap'));
  assert(tui.session.messages.some(message=>message.id==='recovered:answer'),'canonical history is refreshed');
  const recovered=events.findLast(event=>event.type==='zyra_history_replaced').events;
  assert(recovered.some(event=>event.type==='compaction_start'),'pending maintenance restored');
  assert(recovered.some(event=>event.toolCallId==='live:tool'&&event.partialResult),'latest pending tool state restored');
  assert(recovered.some(event=>event.message?.id==='live:answer'),'current streaming message restored');
  assert(tui.session.isStreaming,'server-owned work is still active after recovery');
  worker.queue.followUp=['Saved on the host'];worker.emit('event',{type:'queue_update',...worker.queue});
  await until(()=>tui.session.getFollowUpMessages().includes('Saved on the host'));
  await tui.session.followUp('Second queued message');
  assert.deepEqual(tui.session.getFollowUpMessages(),['Saved on the host','Second queued message'],'accepted queue stays visible');
  worker.rejectClear=true;await assert.rejects(tui.session.clearQueue(),/Synthetic clear failure/);
  assert.equal(tui.session.getFollowUpMessages().length,2,'rejected clear preserves canonical queue');
  worker.rejectClear=false;const cleared=await tui.session.clearQueue();
  assert.deepEqual(cleared.followUp,['Saved on the host','Second queued message']);
  await until(()=>tui.session.getFollowUpMessages().length===0);
  const recoveries=events.filter(event=>event.type==='zyra_history_replaced').length;
  client.socket.destroy();
  for(let i=0;i<600;i++)worker.emit('event',{type:'audit:progress',index:i});
  await until(()=>events.filter(event=>event.type==='zyra_history_replaced').length>recoveries);
  assert(tui.session.isStreaming,'socket loss and bounded replay cannot interrupt server work');
  tui.codexServiceTierState.value='priority';
  await until(()=>worker.config.codexServiceTier==='priority');
  await tui.session.abortBash();assert(worker.calls.some(call=>call.type==='bash.abort'),'managed command cancellation reaches the host');
  worker.models.push({id:'new-provider/future-model',label:'Future',supportedEfforts:[],contextWindow:12345});
  await tui.agentServer.refreshModels();
  assert.equal(tui.session.modelRegistry.find('new-provider','future-model').contextWindow,12345);
  assert.deepEqual(tui.session.modelRegistry.find('new-provider','future-model').zyraSupportedEfforts,[],'new non-reasoning models do not get guessed effort choices');
  worker.publish({model:'missing-provider/unknown'});await until(()=>tui.session.model.id==='unknown');
  assert.equal(tui.session.model.contextWindow,0);assert.equal(tui.session.model.reasoning,false);
  const exhaustedStart=events.length;
  const attach=client.attach.bind(client);
  client.attach=async()=>{throw Object.assign(Error('Synthetic persistent outage'),{code:'AGENT_SERVER_DISCONNECTED'})};
  client.socket.destroy();
  for(let elapsed=0;elapsed<25_000&&!events.slice(exhaustedStart).some(e=>e.type==='auto_retry_end'&&e.success===false);elapsed+=100)await pause(100);
  assert(events.slice(exhaustedStart).some(e=>e.type==='auto_retry_end'&&e.success===false),'bounded reconnect attempts finish');
  assert(tui.session.isStreaming,'exhausted reconnect cannot settle the host turn');
  assert.equal(tui.agentServer.presence().connection,'disconnected');
  assert(!events.slice(exhaustedStart).some(e=>e.type==='agent_end'),'the client cannot invent a turn completion');
  client.attach=attach;
  const resumedAt=events.filter(e=>e.type==='zyra_history_replaced').length;
  for(let elapsed=0;elapsed<7_000&&events.filter(e=>e.type==='zyra_history_replaced').length===resumedAt;elapsed+=100)await pause(100);
  assert(events.filter(e=>e.type==='zyra_history_replaced').length>resumedAt,'background retry recovers after the initial attempts are exhausted');
  assert(tui.session.isStreaming);
  worker.emit('event',{type:'agent_end'});
  await until(()=>!tui.session.isStreaming);
  await tui.session.dispose();
  const snapshot=server.attachmentSnapshot.bind(server);
  server.attachmentSnapshot=(...args)=>{const result=snapshot(...args);delete result.capabilities.canonicalTurnCompletion;return result;};
  tui=await createZyraTuiClientRuntime({project:dir,session:canonical,agentServer:{stateDirectory:dir,autoStart:false}});
  worker.finishMaintenance=undefined;
  const legacyPrompt=tui.session.prompt('Synthetic legacy prompt');
  await until(()=>typeof worker.finishMaintenance==='function');
  await until(()=>!tui.session.isStreaming);
  worker.finishMaintenance(); await legacyPrompt;
  assert.equal(tui.responseTimings.recorder.read()[0].outcome,'completed','legacy hosts keep their advertised provider-end boundary');
  console.log('PASS: host model/tool capabilities, new models, explicit unknown metadata, service-tier sync and managed command cancellation');
  console.log('PASS: canonical TUI approval attach/delivery, gap and real socket recovery, durable history/live work, canonical queues and acknowledged queue clearing. No provider requests.');

} finally {
  await tui?.session.dispose(); seed?.close(); await server.stop();
  const absolute=path.resolve(dir);assert.equal(path.dirname(absolute),path.resolve(os.tmpdir()));assert(path.basename(absolute).startsWith('zyra-tui-config-'));rmSync(absolute,{recursive:true,force:true});
}
