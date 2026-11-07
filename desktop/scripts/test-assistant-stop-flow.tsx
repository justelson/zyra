import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { waitForAssistantStopConfirmation } from '../src/renderer/src/pages/assistant/assistant-stop-confirmation'
import { ComposerSendButton } from '../src/renderer/src/pages/assistant/ComposerSendButton'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import type { AssistantMessage, AssistantSessionTurnUsageEntry } from '../src/shared/assistant/contracts'
mock.module('../src/renderer/src/lib/settings', () => ({useSettings:()=>({settings:{assistantShowActionStats:false,assistantAllowCollapseWhileWorking:false}})}))
const { TimelineTurnWorkSummary } = await import('../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary')
const user:AssistantMessage={id:'stop-before-tools',role:'user',text:'Check the page',turnId:'stopped-turn',streaming:false,createdAt:'2026-11-07T10:00:00Z',updatedAt:'2026-11-07T10:00:00Z'}
const usage:AssistantSessionTurnUsageEntry={id:'stopped-turn',sessionId:'session',threadId:'thread',model:'fixture',state:'interrupted',requestedAt:user.createdAt,startedAt:user.createdAt,completedAt:'2026-11-07T10:00:12Z',assistantMessageId:null,usage:null,updatedAt:'2026-11-07T10:00:12Z'}
const stoppedRows=groupTimelineRowsIntoWorkSummaries({rows:buildTimelineRows(getTimelineEntries([user],[]),false,null),messages:[user],latestAssistantMessageId:null,latestTurnStartedAt:null,isWorking:false,turnUsageById:new Map([[usage.id,usage]])})
assert.ok(stoppedRows.some(row=>row.kind==='turn-work-summary'&&row.outcome==='interrupted'&&row.completedAt===usage.completedAt),'a canonical Stop before any tool or response retains its timed terminal presentation')
const nextUser={...user,id:'next-user',turnId:'next-turn',text:'Take another approach',createdAt:'2026-11-07T10:01:00Z',updatedAt:'2026-11-07T10:01:00Z'}
const followedRows=groupTimelineRowsIntoWorkSummaries({rows:buildTimelineRows(getTimelineEntries([user,nextUser],[]),false,null),messages:[user,nextUser],latestAssistantMessageId:null,latestTurnStartedAt:null,isWorking:false,turnUsageById:new Map([[usage.id,usage]])})
assert.deepEqual(followedRows.filter(row=>row.kind==='message').map(row=>row.message.id),[user.id,nextUser.id],'an empty stopped turn cannot swallow the following instruction')

let turn = {id:'stopped-turn',state:'running'}
const listeners = new Set<() => void>()
const source = {turnId:turn.id,readTurn:()=>turn,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}}}
let confirmed = false
const stopping = waitForAssistantStopConfirmation(source).then(()=>{confirmed=true})
await Promise.resolve()
assert.equal(confirmed,false,'an abort ACK alone cannot dismiss Stopping')
turn = {...turn,state:'interrupted'}
for (const listener of listeners) listener()
await stopping
assert.equal(confirmed,true)
assert.equal(listeners.size,0,'confirmation releases the observer')
turn={id:'newer-turn',state:'running'}
await waitForAssistantStopConfirmation(source)
assert.equal(turn.state,'running','an old Stop cannot end or wait on a replacement turn')
turn={id:'stopped-turn',state:'running'}
await assert.rejects(waitForAssistantStopConfirmation({...source,timeoutMs:10}),/not confirmed/)
assert.equal(listeners.size,0,'unconfirmed Stop releases its timed-out observer without fabricating completion')

const button = (extra={}) => renderToStaticMarkup(<ComposerSendButton disabled={false} isConnected isThinking={false} canSend={false} canContinue onContinue={()=>{}} onSend={()=>{}} {...extra} />)
assert.match(button(),/aria-label="Continue response"/)
assert.doesNotMatch(button(),/disabled=""/)
assert.match(button({canSend:true}),/aria-label="Send"/,'a fresh draft replaces Continue with Send')
assert.match(button({isThinking:true,onStop:()=>{}}),/aria-label="Stop current turn"/)
assert.match(button({isStopping:true,onStop:()=>{}}),/aria-label="Stopping current turn"[^>]*|aria-busy="true"/)
assert.match(button({isStopping:true,onStop:()=>{}}),/disabled=""/)
for (const hasWork of [true,false]) {
  const html=renderToStaticMarkup(<TimelineTurnWorkSummary startedAt="2026-11-07T10:00:00Z" completedAt="2026-11-07T10:00:12Z" outcome="interrupted" interruptionLabel="Stopped" running={false} hasWork={hasWork} renderChildren={()=><div>Partial work</div>} />)
  assert.match(html,/Stopped after 12s/,'the stopped duration remains visible even before the first tool action')
  if (!hasWork) assert.doesNotMatch(html,/aria-expanded/,'no empty work disclosure')
}
console.log('Stop flow: canonical confirmation, stale target, timeout cleanup, Continue/Send/Stop controls and retained duration passed')
