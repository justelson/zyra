export type AssistantContentParts = {
    thinking: string
    text: string
    hasThinkingBlock: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
}

export function emptyAssistantContentParts(): AssistantContentParts {
    return { thinking: '', text: '', hasThinkingBlock: false }
}

export function hasAssistantContentText(content: AssistantContentParts): boolean {
    return Boolean(content.text.trim())
}

export function hasAssistantThinkingText(content: AssistantContentParts): boolean {
    return Boolean(content.thinking.trim())
}

function extractAssistantContentParts(content: unknown): AssistantContentParts {
    if (typeof content === 'string') return { thinking: '', text: content, hasThinkingBlock: false }
    if (!Array.isArray(content)) return emptyAssistantContentParts()

    const thinking: string[] = []
    const text: string[] = []
    let hasThinkingBlock = false
    for (const part of content) {
        const record = asRecord(part)
        const type = asString(record?.['type'])
        if (type === 'thinking') {
            hasThinkingBlock = true
            const value = asString(record?.['thinking']) || asString(record?.['text'])
            if (value) thinking.push(value)
            continue
        }
        if (type === 'text') {
            const value = asString(record?.['text'])
            if (value) text.push(value)
        }
    }

    return {
        thinking: thinking.join('\n'),
        text: text.join('\n'),
        hasThinkingBlock
    }
}

function suffixPrefixOverlap(left: string, right: string): number {
    const max = Math.min(left.length, right.length)
    for (let size = max; size > 0; size -= 1) {
        if (left.slice(-size) === right.slice(0, size)) return size
    }
    return 0
}

function separateThinkingFromAssistantText(content: AssistantContentParts): AssistantContentParts {
    if (!content.hasThinkingBlock || !content.thinking || !content.text) return content
    const overlap = content.text.startsWith(content.thinking)
        ? content.thinking.length
        : suffixPrefixOverlap(content.thinking, content.text)
    const comparableLength = Math.min(content.thinking.length, content.text.length)
    const minimumOverlap = Math.min(24, Math.max(8, Math.floor(comparableLength * 0.25)))
    if (overlap < minimumOverlap) return content
    return {
        ...content,
        text: content.text.slice(overlap).replace(/^(?:\r?\n){1,2}/, '')
    }
}

function hasAssistantContentSnapshot(value: unknown): boolean {
    return typeof value === 'string' || (Array.isArray(value) && value.length > 0)
}

function applyAssistantContentSnapshot(
    current: AssistantContentParts,
    snapshot: AssistantContentParts
): AssistantContentParts {
    return separateThinkingFromAssistantText({
        thinking: snapshot.hasThinkingBlock ? snapshot.thinking : current.thinking,
        text: snapshot.text,
        hasThinkingBlock: current.hasThinkingBlock || snapshot.hasThinkingBlock
    })
}

export function extractAssistantEventContentParts(
    event: Record<string, unknown>,
    current: AssistantContentParts,
    lifecycleType: string
): AssistantContentParts {
    const message = asRecord(event['message'])
    const assistantMessageEvent = asRecord(event['assistantMessageEvent'])
    const partial = asRecord(assistantMessageEvent?.['partial'])
    const snapshotCandidates = lifecycleType === 'message_end'
        ? [message?.['content'], assistantMessageEvent?.['content'], partial?.['content']]
        : [partial?.['content'], assistantMessageEvent?.['content'], message?.['content']]
    const snapshotValue = snapshotCandidates.find(hasAssistantContentSnapshot)
    if (snapshotValue !== undefined) {
        return applyAssistantContentSnapshot(current, extractAssistantContentParts(snapshotValue))
    }

    const delta = typeof assistantMessageEvent?.['delta'] === 'string' ? assistantMessageEvent['delta'] as string : null
    const eventType = asString(assistantMessageEvent?.['type'])
    if (eventType === 'thinking_delta' && delta) {
        return {
            ...current,
            hasThinkingBlock: true,
            thinking: current.thinking + delta
        }
    }
    if (eventType === 'text_delta' && delta) {
        return {
            ...current,
            text: current.text + delta
        }
    }

    return current
}
