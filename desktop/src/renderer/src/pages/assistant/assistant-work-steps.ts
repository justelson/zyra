import type { TimelineRenderRow } from './assistant-timeline-helpers'

export type AssistantWorkStep = {
    id: string
    title: string | null
    sourceMessageId: string | null
    rows: TimelineRenderRow[]
    actionCount: number
}

function cleanMarkdownTitle(value: string): string {
    const firstLine = String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || ''
    const withoutMarkdown = firstLine
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^>\s*/, '')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    const clauses = withoutMarkdown.split(/(?<=[.!?;])\s+/).filter(Boolean)
    const intentClause = [...clauses].reverse().find((clause) => /^(?:Next|Now|I['’]?(?:ll|m)|I (?:will|am)|Let me)\b/i.test(clause))
    const firstSentence = intentClause || clauses[0] || withoutMarkdown
    const withoutSpeaker = firstSentence
        .replace(/^(?:Next|Now),?\s+/i, '')
        .replace(/^(?:I['’]?ll|I will|I['’]?m going to|I am going to|Let me)\s+/i, '')
        .replace(/^I(?:['’]?m| am)\s+/i, '')
    const gerundMatch = withoutSpeaker.match(/^(checking|verifying|reviewing|inspecting|tracing|testing|running|reading|updating|fixing|building|comparing|mapping|locating|loading|waiting)\b/i)
    const imperativeByGerund: Record<string, string> = {
        checking: 'Check', verifying: 'Verify', reviewing: 'Review', inspecting: 'Inspect', tracing: 'Trace', testing: 'Test',
        running: 'Run', reading: 'Read', updating: 'Update', fixing: 'Fix', building: 'Build', comparing: 'Compare',
        mapping: 'Map', locating: 'Locate', loading: 'Load', waiting: 'Wait'
    }
    const intent = gerundMatch
        ? `${imperativeByGerund[gerundMatch[1]!.toLowerCase()]}${withoutSpeaker.slice(gerundMatch[1]!.length)}`
        : withoutSpeaker
    return intent.replace(/[.:;!?]+$/, '').trim()
}

export function deriveAssistantWorkStepTitle(text: string, maxLength = 96): string | null {
    const cleaned = cleanMarkdownTitle(text)
    if (!cleaned) return null
    const title = `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`
    if (title.length <= maxLength) return title
    const clipped = title.slice(0, Math.max(1, maxLength - 1)).replace(/\s+\S*$/, '').trim()
    return `${clipped || title.slice(0, maxLength - 1)}…`
}

export function countAssistantWorkStepActions(rows: ReadonlyArray<TimelineRenderRow>): number {
    return rows.reduce((count, row) => {
        if (row.kind === 'activity') return count + 1
        if ('activities' in row) return count + row.activities.length
        return count
    }, 0)
}

function stepId(sourceMessageId: string | null, rows: ReadonlyArray<TimelineRenderRow>, index: number): string {
    return `work-step:${sourceMessageId || rows[0]?.id || `legacy-${index}`}`
}

export function buildAssistantWorkSteps(rows: ReadonlyArray<TimelineRenderRow>): AssistantWorkStep[] {
    const steps: AssistantWorkStep[] = []
    let title: string | null = null
    let sourceMessageId: string | null = null
    let stepRows: TimelineRenderRow[] = []

    const flush = () => {
        if (!title && stepRows.length === 0) return
        const actionCount = countAssistantWorkStepActions(stepRows)
        steps.push({
            id: stepId(sourceMessageId, stepRows, steps.length),
            title,
            sourceMessageId,
            rows: stepRows,
            actionCount
        })
        title = null
        sourceMessageId = null
        stepRows = []
    }

    for (const row of rows) {
        if (row.kind === 'message' && row.message.role === 'assistant') {
            const nextTitle = deriveAssistantWorkStepTitle(row.message.text)
            if (!nextTitle) continue
            if (stepRows.length > 0) flush()
            title = nextTitle
            sourceMessageId = row.message.id
            continue
        }
        stepRows.push(row)
    }
    flush()

    return steps
}

export function shouldInheritAssistantWorkStepTitle(step: AssistantWorkStep): boolean {
    return Boolean(step.title) && step.actionCount === 1 && step.rows.length === 1
}
