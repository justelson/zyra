import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import { MessageSquare } from 'lucide-react'
import { codeRevision, requestCodeContext, type CodeSelectionSnapshot } from '@/pages/assistant/assistant-code-context'

export function PreviewCodeSelection({ editor: instance, filePath, workspaceRoot, onAttached }: { editor: editor.IStandaloneCodeEditor | null; filePath: string; workspaceRoot?: string; onAttached?: () => void }) {
    const [selection, setSelection] = useState<CodeSelectionSnapshot | null>(null)
    const [error, setError] = useState('')
    const [host, setHost] = useState<HTMLElement | null>(null)
    useEffect(() => {
        setSelection(null); setError('')
        if (!instance) return
        const node = document.createElement('div')
        node.className = 'pointer-events-auto'
        const widget: editor.IContentWidget = {
            getId: () => 'zyra.ask-selection', getDomNode: () => node,
            allowEditorOverflow: false, suppressMouseDown: true,
            getPosition: () => {
                const range = instance.getSelection()
                return range && !range.isEmpty() ? { position: { lineNumber: range.startLineNumber, column: range.startColumn }, preference: [1, 2] } : null
            }
        }
        instance.addContentWidget(widget)
        setHost(node)
        let version = -1, revision = ''
        const update = () => {
            const range = instance.getSelection(), model = instance.getModel()
            instance.layoutContentWidget(widget)
            if (!model || !range || range.isEmpty()) { setSelection(null); return }
            const text = model.getValueInRange(range)
            if (model.getVersionId() !== version) { version = model.getVersionId(); revision = codeRevision(model.getValue()) }
            const endLine = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber
            setSelection(text.trim() && text.length <= 64_000 ? { filePath, workspaceRoot, startLine: range.startLineNumber, endLine, text, side: 'file', sourceRevision: revision } : null)
        }
        const selected = instance.onDidChangeCursorSelection(update), changed = instance.onDidChangeModelContent(update)
        update()
        const scrolled = instance.onDidScrollChange(() => instance.layoutContentWidget(widget))
        return () => { selected.dispose(); changed.dispose(); scrolled.dispose(); instance.removeContentWidget(widget); setHost(null) }
    }, [instance, filePath, workspaceRoot])
    if (!selection || !host) return null
    return createPortal(<div className="mb-1 flex items-center gap-2 rounded-md border border-sparkle-border bg-[var(--surface-floating)] px-2 py-1 text-xs shadow-lg" data-code-selection>
        {error && <span role="alert" className="text-red-400">{error}</span>}
        <span className="text-sparkle-text-muted">Lines {selection.startLine}–{selection.endLine}</span>
        <button className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sparkle-text hover:bg-[var(--surface-hover)]" onClick={() => void requestCodeContext(selection).then(() => onAttached?.()).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not attach selection.'))}><MessageSquare size={12} />Ask Zyra</button>
    </div>, host)
}
