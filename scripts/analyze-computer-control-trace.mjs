import { readFileSync } from 'node:fs'
import path from 'node:path'

const file = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Usage: node scripts/analyze-computer-control-trace.mjs <session.jsonl>')

const entries = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
  try { return [{ ...JSON.parse(line), line: index + 1 }] } catch { return [] }
})
const userIndexes = entries.flatMap((entry, index) => entry.message?.role === 'user' ? [index] : [])
const startIndex = [...userIndexes].reverse().find((index) => /computer[ -]?control/i.test(messageText(entries[index].message))) ?? userIndexes.at(-1)
if (startIndex === undefined) throw new Error('No user turn was found in the session trace.')

const turn = entries.slice(startIndex)
const startAt = timestamp(turn[0])
const calls = new Map()
const toolCounts = new Map()
const providerSteps = []
const toolTimings = []
let previousBoundaryAt = startAt
let providerDecisionMs = 0
let toolRuntimeMs = 0
let observationCharacters = 0
let failedToolResults = 0
let endAt = startAt

for (const entry of turn) {
  const at = timestamp(entry)
  const message = entry.message || {}
  if (message.role === 'assistant') {
    const toolCalls = (message.content || []).filter((part) => part?.type === 'toolCall')
    if (toolCalls.length > 0) {
      const decisionMs = Math.max(0, at - previousBoundaryAt)
      providerDecisionMs += decisionMs
      providerSteps.push({ next: toolCalls.map((call) => call.name).join('+'), seconds: seconds(decisionMs) })
      for (const call of toolCalls) {
        calls.set(call.id, { at, name: call.name })
        toolCounts.set(call.name, (toolCounts.get(call.name) || 0) + 1)
      }
    }
    if ((message.content || []).some((part) => part?.type === 'text')) {
      if (toolCalls.length === 0) {
        const decisionMs = Math.max(0, at - previousBoundaryAt)
        providerDecisionMs += decisionMs
        providerSteps.push({ next: 'final-response', seconds: seconds(decisionMs) })
      }
      endAt = at
    }
  }
  if (message.role === 'toolResult') {
    const call = calls.get(message.toolCallId)
    if (call) {
      const runtimeMs = Math.max(0, at - call.at)
      toolRuntimeMs += runtimeMs
      toolTimings.push({ tool: call.name, seconds: seconds(runtimeMs) })
    }
    const text = messageText(message)
    if (message.toolName?.startsWith('computer_')) observationCharacters += text.includes('"elements"') ? text.length : 0
    if (message.isError || /operation failed|control failed|grant expired|read-only/i.test(text)) failedToolResults += 1
    previousBoundaryAt = at
    endAt = at
  }
}

const totalMs = Math.max(0, endAt - startAt)
const summary = {
  file,
  totalSeconds: seconds(totalMs),
  providerDecisionSeconds: seconds(providerDecisionMs),
  toolRuntimeSeconds: seconds(toolRuntimeMs),
  otherSeconds: seconds(Math.max(0, totalMs - providerDecisionMs - toolRuntimeMs)),
  toolCalls: Object.fromEntries([...toolCounts].sort(([left], [right]) => left.localeCompare(right))),
  computerToolCallCount: [...toolCounts].reduce((total, [name, count]) => total + (name === 'tool_search' || name.startsWith('computer_') ? count : 0), 0),
  grantRequestCount: (toolCounts.get('computer_request_access') || 0) + (toolCounts.get('computer_use_app') || 0),
  explicitObserveCount: toolCounts.get('computer_observe') || 0,
  failedToolResults,
  observationCharacters,
  providerSteps,
  toolTimings
}
console.log(JSON.stringify(summary, null, 2))

function timestamp(entry) {
  const parsed = Date.parse(entry.timestamp || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content.map((part) => typeof part?.text === 'string' ? part.text : '').join('\n')
}

function seconds(milliseconds) {
  return Math.round(milliseconds / 100) / 10
}
