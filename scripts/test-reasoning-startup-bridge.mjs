import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { AgentBridgeWorker } from '../src/agent-server/bridge-worker.mjs';
import { fixtureModel, isolateBridgeEnvironment } from './fixtures/agent-server-bridge-env.mjs';

const directory = await mkdtemp(join(tmpdir(),'zyra-reasoning-bridge-'));
const isolated = isolateBridgeEnvironment(directory);
let worker;
try {
  const project = join(directory,'project');
  await mkdir(project,{recursive:true});
  const configPath = join(process.env.ZYRA_CODING_AGENT_DIR,'models.json');
  const config = JSON.parse(await readFile(configPath,'utf8'));
  Object.values(config.providers)[0].models[0].reasoning = false;
  await writeFile(configPath,JSON.stringify(config));
  worker = new AgentBridgeWorker({root:resolve(import.meta.dirname,'..'),cwd:project});
  const connected=await worker.request('connect',{surface:'memory-worker',project,cwd:project,model:fixtureModel,thinking:'high',memoryEnabled:false},{timeoutMs:20000});
  assert(Array.isArray(connected.availableModels),'real bridge exposes its already loaded host model catalog without a separate warmup');
  assert(Array.isArray(connected.activeToolNames),'real bridge exposes the active tool inventory');
  assert.equal((await worker.request('memory.configure',{enabled:false})).memoryMode,'disabled');
  assert.equal((await worker.request('preferences.get',{})).memoryMode,'disabled');
  assert.equal((await worker.request('memory.run',{})).skipped,true,'manual consolidation reaches real owned runtime; disabled memory does not run a provider');
  const result = await worker.request('configure',{thinking:'high'},{timeoutMs:5000});
  assert.equal(result.config.thinking,'default','a stale saved effort on a model without controls must not reject starting a thread');
  const key='synthetic-bridge-openai-key';
  const authPath=join(process.env.ZYRA_STATE_DIR,'credentials','auth.json');
  const auth=JSON.parse(await readFile(authPath,'utf8'));
  auth.openai={type:'api_key',key};
  await writeFile(authPath,JSON.stringify(auth));
  const catalogPath=join(process.env.ZYRA_STATE_DIR,'model-catalog');
  await mkdir(catalogPath,{recursive:true});
  await writeFile(join(catalogPath,'openai.json'),JSON.stringify({version:1,fingerprint:createHash('sha256').update(key).digest('hex'),updatedAt:Date.now(),models:[{
    id:'future-native-bridge',label:'Future native',provider:'openai',supportedEfforts:['high','variant:Ultra%20mode'],inputModes:['text'],contextWindow:32768,maxTokens:4096
  }]}));
  await worker.request('connect',{surface:'memory-worker',project,cwd:project,noSession:true,model:'openai/future-native-bridge',thinking:'high',memoryEnabled:false},{timeoutMs:20000});
  const native=await worker.request('configure',{thinking:'variant:Ultra%20mode'},{timeoutMs:5000});
  assert.equal(native.config.thinking,'variant:Ultra%20mode','the real bridge retains exact future native IDs through configuration');
  const defaults=await worker.request('configure',{thinking:'default'},{timeoutMs:5000});
  assert.equal(defaults.config.thinking,'default','provider default survives bridge configuration and acknowledgement');
  const tier=await worker.request('configure',{codexServiceTier:'priority'},{timeoutMs:5000});
  assert.equal(tier.config.codexServiceTier,'priority','service tier is applied to the actual worker runtime');
  const cleared=await worker.request('clear_queue',{}, {timeoutMs:5000});assert.deepEqual(cleared,{steering:[],followUp:[]},'queue clear returns an acknowledged receipt from the real engine');
  const bash=await worker.request('bash.abort',{}, {timeoutMs:5000});assert.equal(bash.aborted,true);
  isolated.assertOffline();
  console.log('Real bridge startup: stale effort recovery, exact future native IDs and provider default, offline');
} finally {
  const child=worker?.child;
  const exited=child && child.exitCode===null ? once(child,'close') : Promise.resolve();
  worker?.dispose(); await exited;
  isolated.restore();
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('zyra-reasoning-bridge-'));
  await rm(directory,{recursive:true,force:true});
}
