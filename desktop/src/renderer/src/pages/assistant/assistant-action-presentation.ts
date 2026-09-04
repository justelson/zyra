import type { AssistantActivity } from '@shared/assistant/contracts'
import { splitAssistantReadOutput } from '@shared/assistant/read-activity'
import {
    getActivityCommand,
    getActivityOutput,
    getActivityPaths
} from './assistant-timeline-helpers'
import { getAssistantRelativeFilePath } from './assistant-file-navigation'

export type AssistantActionFamily =
    | 'command'
    | 'read'
    | 'edit'
    | 'search'
    | 'web-search'
    | 'web-fetch'
    | 'skill'
    | 'agent'
    | 'workflow'
    | 'browser'
    | 'computer'
    | 'tool'

export type AssistantWebEvidenceItem = {
    title: string
    url: string
    snippet: string
    site: string
    faviconUrl: string | null
}

export type AssistantAgentActionEvidence = {
    action: string
    runId: string | null
    definitionName: string | null
    label: string | null
    goal: string | null
    status: string | null
    elapsedMs: number | null
    run: Record<string, unknown> | null
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function compactToolName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function getAssistantActivityToolName(activity: AssistantActivity): string {
    const payload = activity.payload || {}
    const surface = record(payload.surface)
    return text(payload.toolName) || text(surface?.toolName) || ''
}

export function getAssistantActivityArgs(activity: AssistantActivity): Record<string, unknown> {
    return record(activity.payload?.args) || {}
}

function getResultDetails(activity: AssistantActivity): Record<string, unknown> {
    const result = record(activity.payload?.result)
    return record(result?.details) || {}
}

export function getAssistantActionFamily(activity: AssistantActivity): AssistantActionFamily {
    const kind = activity.kind.toLowerCase()
    const tool = compactToolName(getAssistantActivityToolName(activity))
    const category = text(activity.payload?.category)?.toLowerCase() || ''
    if (kind === 'web-search' || category === 'web-search' || tool === 'websearch') return 'web-search'
    if (kind === 'web-fetch' || category === 'web-fetch' || tool === 'webfetch') return 'web-fetch'
    if (kind === 'skill' || category === 'skill' || getActivityPaths(activity).some((path) => /(?:^|[\\/])skills[\\/][^\\/]+[\\/]skill\.md$/i.test(path))) return 'skill'
    if (kind === 'agent' || category === 'agent' || tool === 'agent' || kind.startsWith('subagent.')) return 'agent'
    if (kind === 'workflow' || category === 'workflow' || tool === 'workflow') return 'workflow'
    if (kind === 'browser-control' || category === 'browser-control' || tool.startsWith('browser')) return 'browser'
    if (kind === 'computer-control' || category === 'computer-control' || tool.startsWith('computer')) return 'computer'
    if (kind === 'command' || kind === 'command.checkpoint') return 'command'
    if (kind === 'file-change') return 'edit'
    if (kind === 'file-read') return 'read'
    if (kind === 'search' || /(?:search|grep|find)$/.test(tool)) return 'search'
    return 'tool'
}

function firstSentence(value: string | null, maxLength = 88): string | null {
    if (!value) return null
    const normalized = value.replace(/\s+/g, ' ').trim()
    const sentence = normalized.match(/^.*?(?:[.!?](?=\s|$)|$)/)?.[0]?.replace(/[.!?]+$/, '').trim() || normalized
    if (sentence.length <= maxLength) return sentence
    const clipped = sentence.slice(0, maxLength - 1).replace(/\s+\S*$/, '').trim()
    return `${clipped || sentence.slice(0, maxLength - 1)}…`
}

function hostLabel(url: string | null): string | null {
    if (!url) return null
    try {
        return new URL(url).hostname.replace(/^www\./, '')
    } catch {
        return null
    }
}

function readActionUrl(activity: AssistantActivity): string | null {
    const args = getAssistantActivityArgs(activity)
    const details = getResultDetails(activity)
    return text(activity.payload?.url) || text(args.url) || text(details.url)
}

function shortIntentTarget(value: string | null, maxLength = 52): string | null {
    return firstSentence(value, maxLength)
}

function actionFileLabel(path: string | null): string | null {
    if (!path) return null
    const normalized = path.replace(/\\/g, '/')
    return normalized.split('/').filter(Boolean).at(-1) || normalized
}

function commandIntent(command: string): string {
    if (/^\s*(?:rg|grep|findstr)\b/i.test(command)) return 'Searching code'
    if (/^\s*git\s+(?:status|diff)\b/i.test(command)) return 'Checking changes'
    if (/^\s*git\s+(?:log|show)\b/i.test(command)) return 'Reading Git history'
    if (/\bnode\s+--check\b|\bsyntax\b/i.test(command)) return 'Checking syntax'
    if (/\b(?:typecheck|tsc)\b/i.test(command)) return 'Checking types'
    if (/\b(?:test|tests|vitest|jest|playwright)\b/i.test(command)) return 'Running tests'
    if (/\b(?:build|compile)\b/i.test(command) || /\bnpm\s+pack\b/i.test(command)) return 'Building project'
    return 'Running command'
}

function operationIntent(operationValue: string | null, target: string | null, surface: 'browser' | 'computer'): string {
    const operation = String(operationValue || '').toLowerCase().replace(/[._-]+/g, ' ')
    const suffix = target ? ` ${target}` : surface === 'browser' ? ' web page' : ''
    if (/navigate|open/.test(operation)) return `Opening${suffix || (surface === 'computer' ? ' app' : '')}`
    if (/observe|inspect|snapshot/.test(operation)) return `Inspecting${suffix || (surface === 'computer' ? ' app' : '')}`
    if (/click|press/.test(operation)) return `Clicking${suffix}`
    if (/\btype|input|fill/.test(operation)) return `Typing${suffix}`
    if (/scroll/.test(operation)) return `Scrolling${suffix}`
    if (/focus/.test(operation)) return `Focusing${suffix}`
    if (/drag/.test(operation)) return `Dragging${suffix}`
    if (/wait/.test(operation)) return `Waiting${target ? ` for ${target}` : ''}`
    if (/release|close|stop/.test(operation)) return surface === 'browser' ? 'Closing browser control' : 'Releasing computer control'
    return surface === 'browser' ? 'Using browser' : 'Running computer control'
}

function agentIntent(actionValue: string, subject: 'agent' | 'workflow', label: string | null): string {
    const action = actionValue.toLowerCase().replace(/[._-]+/g, ' ')
    const target = shortIntentTarget(label, 36)
    if (/spawn|start|run/.test(action)) return subject === 'agent' ? `Starting${target ? ` ${target}` : ' agent'}` : `Running${target ? ` ${target}` : ' workflow'}`
    if (/wait/.test(action)) return `Waiting for ${subject}`
    if (/send|steer|input/.test(action)) return `Steering ${subject}`
    if (/resume/.test(action)) return `Resuming ${subject}`
    if (/stop|close/.test(action)) return `Stopping ${subject}`
    return subject === 'agent' ? 'Checking agent' : 'Checking workflow'
}

function fallbackIntent(activity: AssistantActivity): string {
    const value = shortIntentTarget(text(activity.summary) || text(activity.detail))
    if (!value) return 'Using tool'
    return value
        .replace(/^Ran\b/i, 'Running')
        .replace(/^Run\b/i, 'Running')
        .replace(/^Read\b/i, 'Reading')
        .replace(/^Used?\b/i, 'Using')
        .replace(/^Searched?\b/i, 'Searching')
        .replace(/^Checked?\b/i, 'Checking')
        .replace(/^Loaded?\b/i, 'Loading')
}

export function getAssistantActionTitle(
    activity: AssistantActivity,
    projectRootPath?: string | null
): string {
    const family = getAssistantActionFamily(activity)
    const args = getAssistantActivityArgs(activity)
    const paths = getActivityPaths(activity)
    const path = paths[0] ? getAssistantRelativeFilePath(paths[0], projectRootPath) : null
    const query = shortIntentTarget(text(activity.payload?.query) || text(args.query) || text(args.pattern))
    const operation = text(activity.payload?.operation) || text(args.operation) || text(args.action)

    if (family === 'command') return commandIntent(getActivityCommand(activity))
    if (family === 'read') return `Reading ${actionFileLabel(path) || 'file'}`
    if (family === 'edit') return path ? `Editing ${actionFileLabel(path)}${paths.length > 1 ? ` +${paths.length - 1}` : ''}` : 'Editing files'
    if (family === 'skill') return `Loading ${getAssistantSkillName(activity) || 'skill'}`
    if (family === 'web-search') return query ? `Searching ${query}` : 'Searching the web'
    if (family === 'web-fetch') {
        const pageTitle = shortIntentTarget(text(activity.payload?.pageTitle) || text(getResultDetails(activity).title))
        return `Reading ${pageTitle || hostLabel(readActionUrl(activity)) || 'web page'}`
    }
    if (family === 'search') return query ? `Searching ${query}` : 'Searching the project'
    if (family === 'browser') return operationIntent(operation, hostLabel(readActionUrl(activity)), 'browser')
    if (family === 'computer') {
        const target = shortIntentTarget(text(args.name) || text(args.targetId) || text(activity.payload?.targetId), 36)
        return operationIntent(operation, target, 'computer')
    }
    if (family === 'agent') {
        const evidence = getAssistantAgentActionEvidence(activity)
        return agentIntent(evidence.action, 'agent', evidence.label || evidence.definitionName)
    }
    if (family === 'workflow') {
        const name = text(args.name) || text(activity.payload?.label)
        return agentIntent(operation || 'run', 'workflow', name)
    }
    return fallbackIntent(activity)
}

export function getAssistantActionTarget(activity: AssistantActivity, projectRootPath?: string | null): string | null {
    const family = getAssistantActionFamily(activity)
    const args = getAssistantActivityArgs(activity)
    if (family === 'command') return null
    if (family === 'read' || family === 'edit' || family === 'skill') {
        const paths = getActivityPaths(activity)
        return paths[0] ? getAssistantRelativeFilePath(paths[0], projectRootPath) : null
    }
    if (family === 'web-search' || family === 'search') return text(activity.payload?.query) || text(args.query) || null
    if (family === 'web-fetch' || family === 'browser') return hostLabel(readActionUrl(activity))
    if (family === 'agent') return getAssistantAgentActionEvidence(activity).definitionName
    return text(activity.payload?.operation) || text(args.operation) || text(args.action)
}

export function stripAssistantCommandEnvelope(output: string, command: string): string {
    let next = String(output || '').replace(/^\[Zyra managed command update]\s*\r?\n/i, '')
    const lines = next.split(/\r?\n/)
    const hasManagedEnvelope = /^Command (?:completed|failed|still running|exited|timed out)\b/i.test(lines[0] || '')
        && (/^Last output:/i.test(lines[1] || '') || /^Command:\s*/i.test(lines[1] || ''))
    if (hasManagedEnvelope) lines.shift()
    if (hasManagedEnvelope && /^Last output:/i.test(lines[0] || '')) lines.shift()
    if (hasManagedEnvelope && /^Command:\s*/i.test(lines[0] || '')) {
        const wrappedCommand = (lines.shift() || '').replace(/^Command:\s*/i, '').trim()
        if (!command || wrappedCommand === command.trim()) {
            while (lines[0] === '') lines.shift()
        }
    }
    if (hasManagedEnvelope && /^Current output:\s*$/i.test(lines[0] || '')) {
        lines.shift()
        while (lines[0] === '') lines.shift()
    }
    if (hasManagedEnvelope) {
        const footerIndex = lines.findIndex((line) => /^To check again,|^Use this command output to decide/i.test(line))
        if (footerIndex >= 0) lines.splice(footerIndex)
    }
    next = lines.join('\n').trimEnd()
    return next
}

export function getAssistantWebEvidence(activity: AssistantActivity): AssistantWebEvidenceItem[] {
    const directResults = Array.isArray(activity.payload?.webResults) ? activity.payload.webResults : null
    const detailResults = Array.isArray(getResultDetails(activity).results) ? getResultDetails(activity).results : []
    const values: unknown[] = (directResults || detailResults) as unknown[]
    const items = values.flatMap((entry: unknown): AssistantWebEvidenceItem[] => {
        const value = record(entry)
        const title = text(value?.title)
        const url = text(value?.url)
        if (!title || !url) return []
        return [{
            title,
            url,
            snippet: text(value?.snippet) || '',
            site: hostLabel(url) || url,
            faviconUrl: text(value?.faviconUrl) || null
        }]
    })
    if (items.length > 0) return items

    const url = readActionUrl(activity)
    if (!url) return []
    return [{
        title: text(activity.payload?.pageTitle) || text(getResultDetails(activity).title) || hostLabel(url) || url,
        url,
        snippet: text(activity.payload?.pageText) || text(getResultDetails(activity).text) || '',
        site: hostLabel(url) || url,
        faviconUrl: text(activity.payload?.faviconUrl) || null
    }]
}

export function getAssistantSkillName(activity: AssistantActivity): string | null {
    const explicit = text(activity.payload?.skillName)
    if (explicit) return explicit
    const skillPath = getActivityPaths(activity).find((path) => /(?:^|[\\/])skills[\\/][^\\/]+[\\/]skill\.md$/i.test(path))
    return skillPath?.replace(/\\/g, '/').match(/\/skills\/([^/]+)\/SKILL\.md$/i)?.[1] || null
}

export function getAssistantCapturedRead(activity: AssistantActivity): {
    path: string
    content: string
    startLine: number | null
    endLine: number | null
    totalLines: number | null
} | null {
    const path = getActivityPaths(activity)[0]
    if (!path) return null
    const rawOutput = typeof activity.payload?.output === 'string'
        ? activity.payload.output
        : getActivityOutput(activity)
    const split = splitAssistantReadOutput(rawOutput)
    return {
        path,
        content: split.content,
        startLine: numberValue(activity.payload?.readStartLine),
        endLine: numberValue(activity.payload?.readEndLine),
        totalLines: numberValue(activity.payload?.readTotalLines)
    }
}

export function getAssistantAgentActionEvidence(activity: AssistantActivity): AssistantAgentActionEvidence {
    const args = getAssistantActivityArgs(activity)
    const payloadRun = record(activity.payload?.run)
    let outputRun: Record<string, unknown> | null = null
    const output = getActivityOutput(activity).trim()
    if (output.startsWith('{')) {
        try { outputRun = record(JSON.parse(output)) } catch { outputRun = null }
    }
    const run = payloadRun || outputRun
    const action = text(activity.payload?.action) || text(args.action) || activity.kind.split('.').at(-1) || 'inspect'
    const runId = text(activity.payload?.agentRunId)
        || text(activity.payload?.workflowRunId)
        || text(activity.payload?.runId)
        || text(run?.agentRunId)
        || text(run?.workflowRunId)
        || text(args.agentRunId)
        || text(args.workflowRunId)
    return {
        action,
        runId,
        definitionName: text(run?.definitionName) || text(activity.payload?.requestedAgent) || text(args.agent) || text(args.name),
        label: text(run?.label) || text(activity.payload?.label) || text(args.label) || text(args.name),
        goal: text(run?.goal) || text(activity.payload?.prompt) || text(args.prompt) || text(activity.detail),
        status: text(run?.status) || text(activity.payload?.status),
        elapsedMs: numberValue(run?.elapsedMs) || numberValue(activity.payload?.durationMs),
        run
    }
}
