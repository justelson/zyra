import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const label = String(process.argv[2] || '').trim()
const prompt = String(process.argv[3] || '').trim()
if (!label || !prompt) throw new Error('Usage: node scripts/benchmark-live-computer-control.mjs <label> <prompt>')
if (process.platform !== 'win32') throw new Error('Live Windows computer-control benchmarks require Windows.')

const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const descriptorPath = process.env.ZYRA_BENCHMARK_BRIDGE_DESCRIPTOR || path.join(roaming, 'Zyra-dev', 'browser-assistant-bridge.json')
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
const title = `__zyra-control-benchmark-${label}-${runId}`
const existingSessionId = String(process.env.ZYRA_BENCHMARK_EXISTING_SESSION_ID || '').trim()
const requiresVisibleBrowserChat = /\b(?:browser_(?:access|observe|perform|session|tabs)|in-app\s+browser|zyra(?:'s)?\s+browser)\b/i.test(prompt)
if (requiresVisibleBrowserChat && !existingSessionId) {
    throw new Error('In-app Browser benchmarks require ZYRA_BENCHMARK_EXISTING_SESSION_ID for a Chat already selected in the development renderer.')
}
let ownsSession = false
let sessionId = ''
let sessionPath = ''
let eventJournalPath = ''
let originalSessionId = ''
let cleanup = { serviceDeleted: false, rawTraceDeleted: false, eventJournalDeleted: false, eventReplayFilesDeleted: 0, originalSelectionRestored: false }
const wallStartedAt = Date.now()

try {
    const initial = await invoke('getSnapshot')
    originalSessionId = String(initial.snapshot?.selectedSessionId || initial.selectedSessionId || '')
    if (existingSessionId) {
        const sessions = initial.snapshot?.sessions || initial.sessions || []
        if (!sessions.some((session) => session.id === existingSessionId)) throw new Error('The requested existing benchmark Chat does not exist.')
        if (originalSessionId !== existingSessionId) throw new Error('Visible Browser benchmarks require the existing Chat to already be selected.')
        sessionId = existingSessionId
    } else {
        const created = await invoke('createSession', [{ title, mode: 'work' }])
        sessionId = String(created.sessionId || '')
        if (!sessionId) throw new Error('Zyra did not return a local benchmark session id.')
        ownsSession = true
    }
    console.log(JSON.stringify({
        stage: 'started', label, sessionId,
        model: process.env.ZYRA_BENCHMARK_MODEL || 'openai-codex/gpt-5.6-sol',
        thinking: process.env.ZYRA_BENCHMARK_THINKING || 'xhigh',
        runtimeMode: process.env.ZYRA_BENCHMARK_PERMISSION_MODE || 'full-access'
    }))
    const sent = await invoke('sendPrompt', [prompt, {
        sessionId,
        model: process.env.ZYRA_BENCHMARK_MODEL || 'openai-codex/gpt-5.6-sol',
        effort: process.env.ZYRA_BENCHMARK_THINKING || 'xhigh',
        runtimeMode: process.env.ZYRA_BENCHMARK_PERMISSION_MODE || 'full-access',
        interactionMode: 'intervene',
        profile: 'default'
    }])
    const turnId = String(sent.turnId || '')
    const threadId = String(sent.threadId || '')
    if (!turnId || !threadId) throw new Error('Zyra accepted the benchmark without returning its turn identity.')
    console.log(JSON.stringify({ stage: 'accepted', label, turnId, threadId }))
    const completed = await waitForTurn(sessionId, threadId, turnId, Number(process.env.ZYRA_BENCHMARK_TIMEOUT_MS || 1_200_000))
    const providerThreadId = String(completed.thread.providerThreadId || '')
    sessionPath = resolveSessionPath(providerThreadId)
    eventJournalPath = providerThreadId
        ? path.join(roaming, 'Zyra-dev', 'assistant', 'agent-server', 'agent-events', `${createHash('sha256').update(providerThreadId).digest('hex')}.jsonl`)
        : ''
    if (!sessionPath || !existsSync(sessionPath)) throw new Error(`The terminal benchmark turn has no canonical trace for ${providerThreadId || 'an unknown provider thread'}.`)
    const summary = analyzeTrace(sessionPath, wallStartedAt)
    console.log(JSON.stringify({ stage: 'measured', label, summary }))
} finally {
    if (ownsSession && sessionId) {
        try {
            const deleted = await invoke('deleteSession', [sessionId])
            cleanup.serviceDeleted = deleted.success !== false
        } catch {}
    }
    if (ownsSession && originalSessionId) {
        try {
            const restored = await invoke('selectSession', [originalSessionId])
            cleanup.originalSelectionRestored = restored.success !== false
        } catch {}
    }
    if (ownsSession && sessionPath && existsSync(sessionPath) && /[\\/]\.zyra[\\/]sessions[\\/][^\\/]+\.jsonl$/i.test(sessionPath)) {
        rmSync(sessionPath, { force: true })
        cleanup.rawTraceDeleted = !existsSync(sessionPath)
    }
    if (ownsSession && eventJournalPath && existsSync(eventJournalPath) && /[\\/]agent-events[\\/][a-f0-9]{64}\.jsonl$/i.test(eventJournalPath)) {
        rmSync(eventJournalPath, { force: true })
        cleanup.eventJournalDeleted = !existsSync(eventJournalPath)
        if (cleanup.eventJournalDeleted) cleanup.eventReplayFilesDeleted += 1
    }
    if (ownsSession) {
        const eventJournalDirectory = path.join(roaming, 'Zyra-dev', 'assistant', 'agent-server', 'agent-events')
        try {
            for (const name of readdirSync(eventJournalDirectory).filter((entry) => /^[a-f0-9]{64}\.jsonl$/i.test(entry))) {
                const file = path.join(eventJournalDirectory, name)
                if (!readFileSync(file, 'utf8').includes(prompt)) continue
                rmSync(file, { force: true })
                cleanup.eventReplayFilesDeleted += 1
            }
        } catch {}
    }
    console.log(JSON.stringify({ stage: 'cleanup', label, cleanup }))
}

async function waitForTurn(expectedSessionId, expectedThreadId, expectedTurnId, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    let interruptRequested = false
    for (;;) {
        const current = await invoke('getSnapshot')
        const sessions = current.snapshot?.sessions || current.sessions || []
        const session = sessions.find((candidate) => candidate.id === expectedSessionId)
        const thread = session?.threads?.find((candidate) => candidate.id === expectedThreadId)
        const turn = thread?.latestTurn
        if (turn?.id === expectedTurnId && ['completed', 'error', 'interrupted'].includes(turn.state)) return { session, thread, turn }
        if (thread && ['error', 'stopped'].includes(thread.state) && turn?.id === expectedTurnId) return { session, thread, turn }
        if (!interruptRequested && thread && (thread.hasPendingUserInputs || thread.hasPendingApprovals)) {
            interruptRequested = true
            console.log(JSON.stringify({ stage: 'unattended-block', turnId: expectedTurnId, userInput: Boolean(thread.hasPendingUserInputs), approval: Boolean(thread.hasPendingApprovals) }))
            await invoke('interruptTurn', [expectedTurnId, expectedSessionId])
        }
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for benchmark turn ${expectedTurnId}.`)
        await delay(500)
    }
}

function resolveSessionPath(providerThreadId) {
    if (!providerThreadId) return ''
    if (path.isAbsolute(providerThreadId)) return providerThreadId
    const sessionsDirectory = path.join(roaming, 'Zyra-dev', 'assistant', 'global-workspace', '.zyra', 'sessions')
    try {
        const match = readdirSync(sessionsDirectory).find((name) => name.endsWith(`_${providerThreadId}.jsonl`))
        return match ? path.join(sessionsDirectory, match) : ''
    } catch {
        return ''
    }
}

async function invoke(method, args = [], timeoutMs = 120_000) {
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
    if (!descriptor.host || !descriptor.port || !descriptor.capability) throw new Error('The development Assistant bridge descriptor is incomplete.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`Assistant bridge ${method} timed out.`)), timeoutMs)
    try {
        const response = await fetch(`http://${descriptor.host}:${descriptor.port}/v1/assistant/invoke`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                origin: 'http://127.0.0.1:47822',
                'content-type': 'application/json',
                'x-zyra-browser-client': 'assistant-v1',
                'x-zyra-browser-capability': descriptor.capability
            },
            body: JSON.stringify({ method, args })
        })
        const body = await response.json()
        if (!response.ok || body.ok !== true) throw new Error(body.error || `Assistant bridge ${method} failed.`)
        if (body.value?.success === false) throw new Error(body.value.error || `Assistant service ${method} failed.`)
        return body.value || {}
    } finally {
        clearTimeout(timer)
    }
}

function analyzeTrace(file, fallbackStartAt) {
    const entries = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)] } catch { return [] }
    })
    const userIndexes = entries.flatMap((entry, index) => entry.message?.role === 'user' ? [index] : [])
    const startIndex = userIndexes.at(-1)
    if (startIndex === undefined) throw new Error('No user turn was found in the benchmark trace.')
    const turn = entries.slice(startIndex)
    const startAt = timestamp(turn[0]) || fallbackStartAt
    const calls = new Map()
    const toolCounts = new Map()
    const failures = []
    const providerSteps = []
    const toolTimings = []
    let previousBoundaryAt = startAt
    let providerDecisionMs = 0
    let toolRuntimeMs = 0
    let observationCharacters = 0
    let grantRequestCount = 0
    let endAt = startAt
    let finalText = ''
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
                    const requestsGrant = call.name === 'computer_request_access'
                        || call.name === 'computer_use_app'
                        || (call.name === 'browser_access' && call.arguments?.operation === 'request')
                    if (requestsGrant) grantRequestCount += 1
                }
            }
            const text = messageText(message)
            if (text) {
                if (toolCalls.length === 0) {
                    const decisionMs = Math.max(0, at - previousBoundaryAt)
                    providerDecisionMs += decisionMs
                    providerSteps.push({ next: 'final-response', seconds: seconds(decisionMs) })
                }
                finalText = text
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
            if (message.toolName?.startsWith('computer_') || message.toolName?.startsWith('browser_')) observationCharacters += text.includes('"elements"') ? text.length : 0
            if (message.isError || /operation failed|control failed|grant expired|is read-only|field is read-only/i.test(text)) {
                failures.push({ tool: message.toolName, code: message.details?.code || null, message: text.replace(/\s+/g, ' ').slice(0, 240) })
            }
            previousBoundaryAt = at
            endAt = at
        }
    }
    const totalMs = Math.max(0, endAt - startAt)
    return {
        totalSeconds: seconds(totalMs),
        wallSeconds: seconds(Date.now() - fallbackStartAt),
        providerDecisionSeconds: seconds(providerDecisionMs),
        toolRuntimeSeconds: seconds(toolRuntimeMs),
        otherSeconds: seconds(Math.max(0, totalMs - providerDecisionMs - toolRuntimeMs)),
        toolCalls: Object.fromEntries([...toolCounts].sort(([left], [right]) => left.localeCompare(right))),
        computerToolCallCount: [...toolCounts].reduce((total, [name, count]) => total + (name === 'tool_search' || name.startsWith('computer_') ? count : 0), 0),
        browserToolCallCount: [...toolCounts].reduce((total, [name, count]) => total + (name.startsWith('browser_') ? count : 0), 0),
        grantRequestCount,
        explicitObserveCount: (toolCounts.get('computer_observe') || 0) + (toolCounts.get('browser_observe') || 0),
        failedToolResults: failures.length,
        failures: failures.slice(0, 12),
        observationCharacters,
        providerSteps,
        toolTimings,
        finalText: finalText.replace(/\s+/g, ' ').slice(0, 500)
    }
}

function timestamp(entry) {
    const parsed = Date.parse(entry.timestamp || '')
    return Number.isFinite(parsed) ? parsed : 0
}
function messageText(message) {
    if (typeof message?.content === 'string') return message.content
    if (!Array.isArray(message?.content)) return ''
    return message.content.map((part) => typeof part?.text === 'string' ? part.text : '').join('\n')
}
function seconds(milliseconds) { return Math.round(milliseconds / 100) / 10 }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
