import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
    normalizeAssistantHistoryWheelDelta,
    shouldRevealAssistantInitialHistory,
    resolveAssistantHistoryStreamPlan,
    updateAssistantHistoryScrollVelocity
} from '../src/renderer/src/pages/assistant/assistant-history-streaming-policy'

const coldHistory = {initialLayoutReady: true, selectionSettled: true, isWorking: false, hasOlder: true, loadingOlder: false, hasLoadError: false, requestPending: false, contentLength: 240, viewportSize: 800, pagesRequested: 0}
assert.equal(shouldRevealAssistantInitialHistory(coldHistory), false, 'do not reveal the cold one-turn window while it still needs viewport fill')
assert.equal(shouldRevealAssistantInitialHistory({...coldHistory, loadingOlder: true}), false, 'keep the cold loading presentation during paging')
assert.equal(shouldRevealAssistantInitialHistory({...coldHistory, contentLength: 1200}), true, 'reveal once the viewport has enough history')
assert.equal(shouldRevealAssistantInitialHistory({...coldHistory, hasOlder: false}), true, 'short complete chats reveal without extra loading')
assert.equal(shouldRevealAssistantInitialHistory({...coldHistory, hasLoadError: true}), true, 'a failed history page must not leave the chat hidden')
assert.equal(shouldRevealAssistantInitialHistory({...coldHistory, pagesRequested: 3}), true, 'bounded fill reveals even when the viewport remains short')
const closedPlan = resolveAssistantHistoryStreamPlan({
    startupSettled: true,
    upwardIntent: false,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false,
    distanceFromStart: 0,
    viewportSize: 900,
    velocityPxPerMs: 8
})
assert.equal(closedPlan.shouldRequest, false, 'opening a chat cannot start history streaming')
assert.deepEqual([
    normalizeAssistantHistoryWheelDelta(10, 0, 900),
    normalizeAssistantHistoryWheelDelta(2, 1, 900),
    normalizeAssistantHistoryWheelDelta(1, 2, 900)
], [10, 32, 900], 'pixel, line, and page wheels feed one velocity scale')

let velocity = 0
let loadedTurns = 1
let requestCount = 0
let maxInFlight = 0
let inFlight = false
let distanceFromStart = 3_000
const pageLimits: number[] = []
for (let frame = 0; frame < 360; frame += 1) {
    const fastPhase = frame >= 90 && frame < 240
    const upwardDistance = fastPhase ? 240 : 8
    velocity = updateAssistantHistoryScrollVelocity(velocity, upwardDistance, 16)
    distanceFromStart = Math.max(0, distanceFromStart - upwardDistance)
    const plan = resolveAssistantHistoryStreamPlan({
        startupSettled: true,
        upwardIntent: true,
        hasOlder: loadedTurns < 70,
        loadingOlder: inFlight,
        hasLoadError: false,
        distanceFromStart,
        viewportSize: 900,
        velocityPxPerMs: velocity
    })
    if (plan.shouldRequest && !inFlight) {
        inFlight = true
        requestCount += 1
        maxInFlight = Math.max(maxInFlight, 1)
        pageLimits.push(plan.turnLimit)
        loadedTurns += plan.turnLimit
        distanceFromStart += plan.turnLimit * 1_100
        inFlight = false
    }
}
assert.equal(maxInFlight, 1, 'cursor pages remain strictly serial')
assert.equal(pageLimits.includes(1), true, 'line-by-line reading loads one turn')
assert.equal(pageLimits.includes(3), true, 'fast upward scrolling batches three bounded turns')
assert.equal(requestCount > 5, true, 'continued upward movement streams several pages')
assert.equal(loadedTurns <= 72, true, 'bounded page sizes cannot overshoot history materially')

const samples: number[] = []
for (let sample = 0; sample < 7; sample += 1) {
    const startedAt = performance.now()
    let sampleVelocity = 0
    for (let index = 0; index < 100_000; index += 1) {
        sampleVelocity = updateAssistantHistoryScrollVelocity(sampleVelocity, index % 5 === 0 ? 220 : 24, 16)
        resolveAssistantHistoryStreamPlan({
            startupSettled: true,
            upwardIntent: true,
            hasOlder: true,
            loadingOlder: false,
            hasLoadError: false,
            distanceFromStart: index % 9_000,
            viewportSize: 900,
            velocityPxPerMs: sampleVelocity
        })
    }
    samples.push(performance.now() - startedAt)
}
const sorted = [...samples].sort((left, right) => left - right)
const medianMs = sorted[Math.floor(sorted.length / 2)]!
assert.ok(medianMs < 150, `100k stream-policy decisions stay negligible; received ${medianMs.toFixed(2)}ms`)
console.log(JSON.stringify({ requestCount, loadedTurns, pageLimits, policy100kMedianMs: Number(medianMs.toFixed(2)) }, null, 2))
console.log('Assistant history streaming: ok')
