import { assistantStore } from '@/lib/assistant/assistant-store-core'
import { codeRevision, requestAssistantContextFile, selectionContextFile, type CodeSelectionSnapshot } from '@/pages/assistant/assistant-code-context'

/** Capture the destination synchronously, before any file read or lazy import. */
export async function attachCodeSelection(snapshot: CodeSelectionSnapshot): Promise<void> {
    const sessionId = assistantStore.getState().snapshot.selectedSessionId
    if (!sessionId) throw new Error('Select a chat before asking Zyra about this code.')
    let selection = { ...snapshot }
    if (selection.side === 'file') {
        const current = await window.devscope.readFileContent(selection.filePath).catch(() => null)
        if (current?.success && !current.truncated && typeof current.content === 'string') {
            selection = { ...selection, stale: codeRevision(current.content) !== selection.sourceRevision }
        }
    }
    await requestAssistantContextFile(selectionContextFile(selection), sessionId)
}

export function selectionToolbarPosition(anchor: { top: number; bottom: number; left: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
    const margin = 8, gap = 6
    const left = Math.max(margin, Math.min(anchor.left, viewport.width - size.width - margin))
    const above = anchor.top - size.height - gap
    const top = above >= margin ? above : anchor.bottom + gap
    return { left, top: Math.max(margin, Math.min(top, viewport.height - size.height - margin)) }
}
