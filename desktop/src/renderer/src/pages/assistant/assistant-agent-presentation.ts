import type { AgentRunState, AgentTranscriptPage, AssistantActivity } from '@shared/assistant/contracts'

export type AgentIdentitySource = Pick<AgentRunState, 'agentRunId' | 'agentId' | 'definitionName' | 'label' | 'goal'>

export type AssistantAgentVibe = 'inquiry' | 'systems' | 'guardian' | 'craft' | 'proof' | 'builder' | 'velocity' | 'contemplative'

export interface AssistantAgentIdentity {
    seed: string
    name: string
    roleTitle: string
    vibe: AssistantAgentVibe
}

export interface AssistantAgentTranscriptMessage {
    index: number
    role: 'user' | 'assistant'
    text: string
    timestamp: string | null
}

export interface AssistantAgentTranscriptActivity {
    index: number
    partIndex: number
    toolCallId: string
    summary: string
    detail: string | null
    status: 'running' | 'completed' | 'failed'
    timestamp: string | null
    activity: AssistantActivity
}

export interface AssistantAgentLiveActivity {
    summary: string
    detail: string | null
    status: 'running' | 'completed' | 'failed'
    updatedAt: string | null
}

const AGENT_NAMES_BY_VIBE: Record<AssistantAgentVibe, string[]> = {
    inquiry: ['Socrates', 'Hypatia', 'Zeno', 'Diogenes', 'Hume', 'Spinoza', 'Popper', 'Plato', 'Aristotle', 'Descartes', 'Kierkegaard', 'Nietzsche'],
    systems: ['Ada', 'Turing', 'Archimedes', 'Tesla', 'Hopper', 'Shannon', 'Pascal', 'Euclid', 'Galileo', 'Faraday', 'Lovelace', 'Babbage'],
    guardian: ['Athena', 'Seneca', 'Kant', 'Arendt', 'Locke', 'Confucius', 'Laozi', 'Marcus', 'Cicero', 'Rawls', 'Hobbes', 'Themis'],
    craft: ['Sappho', 'Rumi', 'Iris', 'Woolf', 'Sontag', 'Maya', 'Basho', 'Blake', 'Dante', 'Homer', 'Virgil', 'Calliope'],
    proof: ['Curie', 'Gauss', 'Euler', 'Noether', 'Darwin', 'Franklin', 'Bacon', 'Kepler', 'Feynman', 'Leibniz', 'Ramanujan', 'Emmy'],
    builder: ['Vitruvius', 'Brunel', 'Hedy', 'Daedalus', 'Fuller', 'Foster', 'Edison', 'Bell', 'Imhotep', 'Hero', 'Woz', 'Hephaestus'],
    velocity: ['Hermes', 'Achilles', 'Maxwell', 'Fermi', 'Newton', 'Boltzmann', 'Tycho', 'Halley', 'Ampere', 'Volta', 'Joule', 'Kelvin'],
    contemplative: ['Thales', 'Solon', 'Epictetus', 'Rhea', 'Plotinus', 'Avicenna', 'Averroes', 'Maimonides', 'Parmenides', 'Heraclitus', 'Proclus', 'Orpheus']
}

function stableHash(value: string): number {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

function humanizeAgentLabel(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_.:/]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
}

export function resolveAssistantAgentRoleTitle(run: AgentIdentitySource): string {
    const task = run.goal.toLowerCase()
    const definition = [run.agentId, run.definitionName, run.label].filter(Boolean).join(' ').toLowerCase()

    if (/\b(security|vulnerabilit|threat|permission|encryption|credential|secret)\w*\b/.test(task)) return 'Security Analyst'
    if (/\b(performance|latency|memory|startup|optimi[sz]|benchmark)\w*\b/.test(task)) return 'Performance Analyst'
    if (/\b(documentation|docs?|readme|guide)\b/.test(task)) return 'Documentation Editor'
    if (/\b(test|tests|testing|coverage|regression|fixture)\w*\b/.test(task)) return 'Test Engineer'
    if (/\b(ui|ux|interface|layout|frontend|renderer|visual|accessibility)\b/.test(task)) return 'Interface Engineer'
    if (/\b(database|schema|sqlite|sql|persistence|migration)\b/.test(task)) return 'Data Engineer'
    if (/\b(server|backend|api|protocol|runtime|lifecycle)\b/.test(task)) return 'Systems Analyst'

    if (/code[\s-]*review|reviewer/.test(definition)) return 'Code Reviewer'
    if (/bug[\s-]*(analy[sz]er|investigator)|debugger/.test(definition)) return 'Bug Investigator'
    if (/research|investigat|analy[sz]/.test(definition)) return 'Research Analyst'
    if (/\b(review|audit|inspect)\w*\b/.test(task)) return 'Code Reviewer'
    if (/\b(debug|bug|failure|root cause)\b/.test(task)) return 'Bug Investigator'
    if (/\b(research|trace|investigate|analy[sz]|compare|find)\w*\b/.test(task)) return 'Research Analyst'
    if (/\b(implement|build|fix|refactor|change|add|create)\w*\b/.test(task)) return 'Software Engineer'

    const definitionTitle = humanizeAgentLabel(run.definitionName || run.agentId || run.label)
    if (definitionTitle && definitionTitle.toLowerCase() !== 'agent') return definitionTitle
    return 'Task Specialist'
}

function resolveAssistantAgentVibe(roleTitle: string): AssistantAgentVibe {
    if (roleTitle === 'Security Analyst') return 'guardian'
    if (roleTitle === 'Performance Analyst') return 'velocity'
    if (roleTitle === 'Documentation Editor' || roleTitle === 'Interface Engineer') return 'craft'
    if (roleTitle === 'Test Engineer' || roleTitle === 'Data Engineer') return 'proof'
    if (roleTitle === 'Systems Analyst') return 'systems'
    if (roleTitle === 'Software Engineer') return 'builder'
    if (roleTitle === 'Code Reviewer' || roleTitle === 'Bug Investigator' || roleTitle === 'Research Analyst') return 'inquiry'
    return 'contemplative'
}

export function resolveAssistantAgentIdentity(run: AgentIdentitySource): AssistantAgentIdentity {
    const seed = `zyra-agent:${run.agentRunId}`
    const roleTitle = resolveAssistantAgentRoleTitle(run)
    const vibe = resolveAssistantAgentVibe(roleTitle)
    const names = AGENT_NAMES_BY_VIBE[vibe]
    return {
        seed,
        name: names[stableHash(`${seed}:${vibe}`) % names.length],
        roleTitle,
        vibe
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function readMessageText(message: Record<string, unknown>): string {
    const content = message['content']
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
        return content.flatMap((part) => {
            if (typeof part === 'string') return [part]
            const record = asRecord(part)
            if (!record) return []
            const type = String(record['type'] || 'text')
            if (!['text', 'input_text', 'output_text'].includes(type)) return []
            return typeof record['text'] === 'string' ? [record['text']] : []
        }).join('\n').trim()
    }
    return typeof message['text'] === 'string' ? message['text'].trim() : ''
}

function normalizeTranscriptTimestamp(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function projectAssistantAgentTranscriptMessages(
    entries: AgentTranscriptPage['entries']
): AssistantAgentTranscriptMessage[] {
    return entries.flatMap((entry) => {
        const nestedMessage = asRecord(entry['message'])
        const message = nestedMessage || entry
        const role = message['role']
        if (role !== 'user' && role !== 'assistant') return []
        const text = readMessageText(message)
        if (!text) return []
        const projected: AssistantAgentTranscriptMessage = {
            index: entry.index,
            role,
            text,
            timestamp: normalizeTranscriptTimestamp(entry['timestamp'] ?? message['timestamp'])
        }
        return [projected]
    }).sort((left, right) => left.index - right.index)
}

function activitySummary(toolNameValue: unknown, status: AssistantAgentTranscriptActivity['status']): string {
    const toolName = String(toolNameValue || 'tool').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (status === 'failed') return `${toolName} failed`
    return `${status === 'running' ? 'Using' : 'Used'} ${toolName}`
}

function activityKind(toolNameValue: unknown): string {
    const toolName = String(toolNameValue || '').toLowerCase()
    if (/\b(read|open|cat|view)\b/.test(toolName) && !/\b(thread|message)\b/.test(toolName)) return 'file-read'
    if (/\b(edit|write|patch|replace|delete|move)\b/.test(toolName)) return 'file-change'
    if (/\b(bash|shell|powershell|terminal|exec|command|cmd)\b/.test(toolName)) return 'command'
    if (/\b(search|grep|find|rg)\b/.test(toolName)) return 'search'
    return 'tool'
}

function activityDetail(value: unknown): string | null {
    const record = asRecord(value)
    if (!record) return null
    for (const key of ['path', 'filePath', 'query', 'command', 'pattern', 'url']) {
        const candidate = record[key]
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().replace(/\s+/g, ' ').slice(0, 220)
    }
    return null
}

export function projectAssistantAgentTranscriptActivities(
    entries: AgentTranscriptPage['entries']
): AssistantAgentTranscriptActivity[] {
    const resultsByCallId = new Map<string, { failed: boolean; message: Record<string, unknown>; timestamp: string | null }>()
    for (const entry of entries) {
        const message = asRecord(entry['message']) || entry
        if (message['role'] !== 'toolResult') continue
        const toolCallId = String(message['toolCallId'] || message['tool_call_id'] || '')
        if (toolCallId) resultsByCallId.set(toolCallId, {
            failed: message['isError'] === true,
            message,
            timestamp: normalizeTranscriptTimestamp(entry['timestamp'] ?? message['timestamp'])
        })
    }

    return entries.flatMap((entry) => {
        const message = asRecord(entry['message']) || entry
        if (message['role'] !== 'assistant' || !Array.isArray(message['content'])) return []
        const startedAt = normalizeTranscriptTimestamp(entry['timestamp'] ?? message['timestamp'])
        return message['content'].flatMap((part, partIndex) => {
            const record = asRecord(part)
            if (!record || record['type'] !== 'toolCall') return []
            const toolCallId = String(record['id'] || `${entry.index}:${partIndex}`)
            const result = resultsByCallId.get(toolCallId)
            const status: AssistantAgentTranscriptActivity['status'] = result?.failed ? 'failed' : result ? 'completed' : 'running'
            const summary = activitySummary(record['name'], status)
            const detail = activityDetail(record['arguments'])
            const timestamp = startedAt || result?.timestamp || null
            const startedAtMs = timestamp ? Date.parse(timestamp) : Number.NaN
            const completedAtMs = result?.timestamp ? Date.parse(result.timestamp) : Number.NaN
            const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
                ? Math.max(0, completedAtMs - startedAtMs)
                : undefined
            const activity: AssistantActivity = {
                id: `agent-tool:${toolCallId}`,
                kind: activityKind(record['name']),
                tone: status === 'failed' ? 'error' : 'tool',
                summary,
                detail: detail || undefined,
                turnId: null,
                timelineSequence: entry.index * 100 + partIndex,
                createdAt: timestamp || new Date(0).toISOString(),
                payload: {
                    toolName: String(record['name'] || 'tool'),
                    args: asRecord(record['arguments']) || record['arguments'],
                    result: result?.message,
                    status,
                    startedAt: timestamp || undefined,
                    completedAt: result?.timestamp || undefined,
                    durationMs
                }
            }
            return [{ index: entry.index, partIndex, toolCallId, summary, detail, status, timestamp, activity }]
        })
    }).sort((left, right) => left.index - right.index || left.partIndex - right.partIndex)
}

export function resolveAssistantAgentLiveActivity(value: unknown): AssistantAgentLiveActivity | null {
    const activity = asRecord(value)
    if (!activity) return null
    const explicitSummary = typeof activity['summary'] === 'string' ? activity['summary'].trim() : ''
    const type = String(activity['type'] || activity['kind'] || '')
    const status: AssistantAgentLiveActivity['status'] = activity['isError'] === true
        ? 'failed'
        : type.includes('end')
            ? 'completed'
            : 'running'
    const summary = explicitSummary || activitySummary(activity['toolName'] || activity['name'], status)
    return summary ? {
        summary,
        detail: activityDetail(activity['args'] || activity['arguments']),
        status,
        updatedAt: normalizeTranscriptTimestamp(activity['updatedAt'] || activity['occurredAt'])
    } : null
}

export function projectAssistantAgentLiveToolActivity(
    value: unknown,
    fallbackCreatedAt: string
): AssistantActivity | null {
    const source = asRecord(value)
    if (!source) return null
    const toolCallId = String(source['toolCallId'] || source['id'] || '').trim()
    const toolName = String(source['toolName'] || source['name'] || '').trim()
    if (!toolCallId && !toolName) return null
    const live = resolveAssistantAgentLiveActivity(source)
    if (!live) return null
    const createdAt = live.updatedAt || fallbackCreatedAt
    return {
        id: `agent-tool:${toolCallId || `${toolName}:${createdAt}`}`,
        kind: activityKind(toolName),
        tone: live.status === 'failed' ? 'error' : 'tool',
        summary: live.summary,
        detail: live.detail || undefined,
        turnId: null,
        createdAt,
        payload: {
            toolName: toolName || 'tool',
            args: asRecord(source['args']) || source['args'],
            result: source['result'],
            status: live.status,
            startedAt: createdAt,
            completedAt: live.status === 'running' ? undefined : createdAt
        }
    }
}

export function mergeAssistantAgentTranscriptPages(
    current: AgentTranscriptPage,
    older: AgentTranscriptPage
): AgentTranscriptPage {
    const entriesByIndex = new Map<number, AgentTranscriptPage['entries'][number]>()
    for (const entry of [...older.entries, ...current.entries]) entriesByIndex.set(entry.index, entry)
    const entries = [...entriesByIndex.values()].sort((left, right) => left.index - right.index)
    return {
        entries,
        nextBefore: older.nextBefore,
        totalEntries: Math.max(current.totalEntries, older.totalEntries),
        bytes: Math.max(current.bytes, older.bytes),
        truncatedEntries: Math.max(current.truncatedEntries, older.truncatedEntries),
        hydrated: entries.length
    }
}

export function mergeAssistantAgentTranscriptRefresh(
    current: AgentTranscriptPage,
    latest: AgentTranscriptPage
): AgentTranscriptPage {
    const entriesByIndex = new Map<number, AgentTranscriptPage['entries'][number]>()
    for (const entry of [...current.entries, ...latest.entries]) entriesByIndex.set(entry.index, entry)
    const entries = [...entriesByIndex.values()].sort((left, right) => left.index - right.index)
    return {
        entries,
        nextBefore: current.nextBefore === null
            ? null
            : latest.nextBefore === null
                ? current.nextBefore
                : Math.min(current.nextBefore, latest.nextBefore),
        totalEntries: Math.max(current.totalEntries, latest.totalEntries),
        bytes: Math.max(current.bytes, latest.bytes),
        truncatedEntries: Math.max(current.truncatedEntries, latest.truncatedEntries),
        hydrated: entries.length
    }
}

export function shortAssistantAgentModel(model: string): string {
    const selected = model.split('/').at(-1) || model
    return selected.replace(/^gpt-\d+(?:\.\d+)?-/, '')
}

export function formatAssistantAgentElapsed(ms: number): string {
    const seconds = Math.max(0, Math.round((ms || 0) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function formatAssistantAgentTokens(tokens: number | null | undefined): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(tokens || 0)
}
