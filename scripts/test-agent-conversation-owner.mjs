import assert from 'node:assert/strict';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real attachSession branch, empty post-restart owner map; only provider connect is simulated.
const calls = [];
const child = {canonicalChatId:'child-session', agentCreatedBy:'parent-session', agentConversationKind:'thread', project:'/fixture'};
const parent = {canonicalChatId:'parent-session', project:'/fixture'};
const owner = {connectedResult:{project:'/fixture',cwd:'/fixture'}, detach(client){calls.push(['detach-owner',client.clientId]);}};
const agent = {providerSessionId:'child-session',cwd:'/fixture/child'};
const view = {sessionKey:'child-session',async connect(input){calls.push(['connect-child',input]);return {threadId:'child-session'};},attach(client){calls.push(['attach-child',client.clientId]);}};
const client = {surface:'desktop',clientId:'client-1'};
const server = Object.assign(Object.create(ZyraAgentServer.prototype), {
  sessions:new Map(),
  catalog:{registerProject:p=>p,resolveAlias:id=>id,async find(id){return id==='child-session'?child:id==='parent-session'?parent:null;},recordAttachment(input){calls.push(['record',input]);}},
  findAgentOwner(){return this.sessions.has('parent-session')?{owner,agent}:null;},
  ensureAgentView(linkedOwner,linkedAgent){assert.equal(linkedOwner,owner);assert.equal(linkedAgent,agent);return view;},
  attachmentSnapshot(snapshot){assert.equal(snapshot,view);return {canonicalChatId:view.sessionKey};},
  async attachSession(incoming,params){
    if(params.session==='parent-session'){
      assert.equal(incoming,client);assert.equal(params.localThreadId,undefined);
      calls.push(['restore-owner',params.session]);this.sessions.set('parent-session',owner);return {canonicalChatId:'parent-session'};
    }
    return ZyraAgentServer.prototype.attachSession.call(this,incoming,params);
  }
});
server.updateMaintenance = {};
await assert.rejects(server.attachSession(client,{project:'/fixture',session:'child-session'}), {code:'AGENT_SERVER_UPDATE_PENDING'});
server.updateMaintenance = null;
server.retiring = true;
await assert.rejects(server.attachSession(client,{project:'/fixture',session:'child-session'}), {code:'AGENT_SERVER_UPDATE_PENDING'});
server.retiring = false;
assert.deepEqual(calls,[], 'Real admission rejects maintenance and retirement before owner restoration');
const result=await server.attachSession(client,{project:'/fixture',session:'child-session',localThreadId:'local-child',permissionMode:'read-only'});
assert.equal(result.canonicalChatId,'child-session');
assert.deepEqual(calls.map(call=>call[0]),['restore-owner','detach-owner','connect-child','attach-child','record']);
const input=calls.find(call=>call[0]==='connect-child')[1];
assert.equal(input.permissionMode,'read-only');assert.equal(input.noSession,true);assert.equal(input.memoryEnabled,false);
assert.equal(view.connectedResult.project,owner.connectedResult.project);
assert.equal(view.connectedResult.cwd,agent.cwd);
assert.equal(calls.at(-1)[1].localThreadId,'local-child');
server.sessions.clear();child.agentConversationKind='subagent';calls.length=0;
await assert.rejects(server.attachSession(client,{project:'/fixture',session:'child-session'}),/Open the owning chat/);
assert.deepEqual(calls,[],'Supporting workers are not silently promoted/restored as independent conversations');
child.agentConversationKind='thread';parent.deleted=true;
await assert.rejects(server.attachSession(client,{project:'/fixture',session:'child-session'}),/Open the owning chat/);
assert.deepEqual(calls,[],'Deleted owner cannot be restored');
// Exercise real session/client lifecycle with short timers and no live worker/profile.
const temporary = mkdtempSync(path.join(tmpdir(), 'zyra-owner-lease-'));
const leaseServer = Object.assign(Object.create(ZyraAgentServer.prototype), {
  sessions:new Map(),root:temporary,paths:{journalDirectory:path.join(temporary,'journals')},idleTimeoutMs:25,
  broadcastCatalogChanged(){},removeSession(session){this.sessions.delete(session.sessionKey);}
});
const seedWorker = Object.assign(new EventEmitter(),{isAlive:()=>true});
const seedOwner = {worker:seedWorker,scheduleIdleStop(){}};
const rootSession = leaseServer.ensureAgentView(seedOwner,{providerSessionId:'parent-lease',agentRunId:'seed',cwd:temporary});
rootSession.parentOwner = null;
const childSession = leaseServer.ensureAgentView(rootSession,{providerSessionId:'child-lease',agentRunId:'child',cwd:temporary});
const leaseClient = {clientId:'lease-client',surface:'desktop',attachedSessionIds:new Set()};
try {
  rootSession.scheduleIdleStop();
  childSession.attach(leaseClient);
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(rootSession.disposed,false,'An attached completed child must retain its restored owner past the idle deadline');
  assert.equal(childSession.disposed,false);
  assert.equal(rootSession.hasBackgroundAgentWork(),false,'Attached completed child does not pretend to be running background work');
  childSession.detach(leaseClient);
  assert.ok(rootSession.idleTimer,'Last child detach rearms owner cleanup');
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(rootSession.disposed,true,'Owner can be reclaimed after all child clients detach');
} finally {
  childSession.dispose('fixture cleanup');rootSession.dispose('fixture cleanup');
  rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
console.log('Actual independent conversation attach: post-restart owner restore, client detach, original read-only scope, child routing, worker/deleted-owner rejection: passed');
