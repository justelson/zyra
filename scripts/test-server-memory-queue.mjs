import assert from 'node:assert/strict';
import { ServerMemoryQueue } from '../src/memory/server-memory-queue.mjs';
function clock() { let now=0,id=0;const timers=new Map();return {now:()=>now,setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id},clearTimer:key=>timers.delete(key),async tick(ms){now+=ms;for(let i=0;i<20;i++){const next=[...timers].find(([,t])=>t.at<=now);if(!next)break;timers.delete(next[0]);next[1].fn();for(let j=0;j<8;j++)await Promise.resolve()}}} }
const time=clock(),a={},b={};let concurrent=0,maxConcurrent=0;const runs=[];
const queue=new ServerMemoryQueue({...time,idleMs:10,cooldownMs:100,retryMs:[5,10],run:(session,signal)=>new Promise((resolve,reject)=>{concurrent++;maxConcurrent=Math.max(concurrent,maxConcurrent);const finish=(result)=>{concurrent--;resolve(result)};runs.push({session,finish});signal.addEventListener('abort',()=>{concurrent--;reject(new Error('cancelled'))},{once:true})})});
queue.observe(a,false);queue.observe(b,false);await time.tick(10);assert.equal(runs.length,1);assert.equal(queue.snapshot().phase,'running');
queue.observe(b,true);await time.tick(1);assert.equal(queue.snapshot().phase,'waiting');assert.equal(queue.snapshot().lastError,null);
await time.tick(50);assert.equal(runs.length,1,'Foreground work blocks all jobs');queue.observe(b,false);await time.tick(10);assert.equal(runs.length,2);
runs[1].finish({updated:true});await time.tick(0);await time.tick(10);assert.equal(runs.length,3);runs[2].finish({updated:false});await time.tick(0);assert.equal(maxConcurrent,1);assert.ok(queue.snapshot().lastSuccessAt);assert.equal(queue.snapshot().lastCheckedAt,time.now());
queue.observe(a,false);await time.tick(30);assert.equal(runs.length,3,'Per-chat cooldown is respected');queue.remove(a);queue.remove(b);queue.dispose();assert.equal(queue.snapshot().phase,'offline');
const retryTime=clock();let tries=0;const failing=new ServerMemoryQueue({...retryTime,idleMs:1,retryMs:[2,4],run:async()=>{tries++;return {failed:true}}});failing.observe({},false);await retryTime.tick(1);await retryTime.tick(2);await retryTime.tick(4);await retryTime.tick(100);assert.equal(tries,3);assert.equal(failing.snapshot().phase,'error');assert.equal(failing.snapshot().queued,0);failing.dispose();
console.log('Server memory queue: serialization, foreground cancellation, cooldown, bounded retry and status passed');
