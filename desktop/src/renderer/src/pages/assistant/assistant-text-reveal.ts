import type { AssistantTextStreamingMode } from '@/lib/settings'

export function getAssistantStreamRevealCount(backlogCharacters: number, mode: AssistantTextStreamingMode, completing: boolean): number {
    if (backlogCharacters <= 0) return 0
    const frames = completing ? 5 : mode === 'chunks' ? 5 : 10
    return Math.min(backlogCharacters, Math.max(mode === 'chunks' ? 4 : 1, Math.ceil(backlogCharacters / frames)))
}

function avoidSplittingSurrogatePair(text: string, end: number): number {
    if (end <= 0 || end >= text.length) return end
    const previous = text.charCodeAt(end - 1), next = text.charCodeAt(end)
    return previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF ? end + 1 : end
}

export function getAssistantInitialVisibleText(text: string, streaming: boolean, mode: AssistantTextStreamingMode = 'stream'): string {
    // Navigation never replays saved text. Chunk mode keeps only an unfinished live line buffered.
    return streaming && mode === 'chunks' ? text.slice(0, text.lastIndexOf('\n') + 1) : text
}

export function revealAssistantStreamText(currentText: string, targetText: string, mode: AssistantTextStreamingMode, completing: boolean, minimumRevealCount = 0): string {
    if (currentText === targetText) return currentText
    if (mode === 'chunks') {
        if (completing) return targetText
        if (!targetText.startsWith(currentText)) return getAssistantInitialVisibleText(targetText, true, mode)
        const paragraph = targetText.indexOf('\n\n', currentText.length)
        const line = targetText.indexOf('\n', currentText.length)
        const end = paragraph >= 0 ? paragraph + 2 : line >= 0 ? line + 1 : currentText.length
        return targetText.slice(0, end)
    }
    if (!targetText.startsWith(currentText)) return targetText
    const backlog = targetText.length - currentText.length
    const count = Math.max(minimumRevealCount, getAssistantStreamRevealCount(backlog, mode, completing))
    return targetText.slice(0, avoidSplittingSurrogatePair(targetText, Math.min(targetText.length, currentText.length + count)))
}
