import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import { codeRevision, type CodeSelectionSnapshot } from '@/pages/assistant/assistant-code-context'
import { SelectionActionBar } from '../SelectionActionBar'
import { selectionToolbarPosition } from '../selection-actions'

export function PreviewCodeSelection({ editor: instance, filePath, workspaceRoot, onAttached }: { editor: editor.IStandaloneCodeEditor | null; filePath: string; workspaceRoot?: string; onAttached?: () => void }) {
    const [selection, setSelection] = useState<CodeSelectionSnapshot | null>(null)
    const toolbar = useRef<HTMLDivElement>(null)
    const reposition = useRef<() => void>(() => {})
    const dismiss = () => { setSelection(null); instance?.focus() }

    // Measure the committed portal, never Monaco's empty pre-commit widget host.
    useLayoutEffect(() => {
        reposition.current()
        const node = toolbar.current
        if (!node) return
        const observer = new ResizeObserver(() => reposition.current())
        observer.observe(node)
        return () => observer.disconnect()
    }, [selection])

    useEffect(() => {
        setSelection(null)
        if (!instance) return
        let version = -1, revision = '', dragging = false, timer = 0
        let disposed = false
        const editorNode = instance.getDomNode()
        reposition.current = () => {
            const node = toolbar.current, range = instance.getSelection()
            const editorBounds = editorNode?.getBoundingClientRect()
            const start = range && instance.getScrolledVisiblePosition(range.getStartPosition())
            if (!node || !range || !editorBounds || !start) return
            const lineTop = editorBounds.top + start.top
            const visible = lineTop + start.height > Math.max(0, editorBounds.top) && lineTop < Math.min(window.innerHeight, editorBounds.bottom)
            node.style.visibility = visible ? 'visible' : 'hidden'
            const position = selectionToolbarPosition({ top: lineTop, bottom: lineTop + start.height, left: editorBounds.left + start.left }, node.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
            node.style.left = `${position.left}px`
            node.style.top = `${position.top}px`
        }
        const update = () => {
            if (disposed || dragging) return
            const range = instance.getSelection(), model = instance.getModel()
            if (!model || !range || range.isEmpty()) { setSelection(null); return }
            const text = model.getValueInRange(range)
            if (model.getVersionId() !== version) { version = model.getVersionId(); revision = codeRevision(model.getValue()) }
            const endLine = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber
            setSelection(text.trim() && text.length <= 64_000 ? { filePath, workspaceRoot, startLine: range.startLineNumber, endLine, text, side: 'file', sourceRevision: revision } : null)
        }
        const pointerDown = (event: PointerEvent) => {
            if (!editorNode?.contains(event.target as Node)) return
            window.clearTimeout(timer)
            dragging = true
            setSelection(null)
        }
        const pointerUp = () => {
            if (!dragging) return
            dragging = false
            // Let Monaco finish word/line selection and keep the next click unobstructed.
            window.clearTimeout(timer)
            timer = window.setTimeout(update, 250)
        }
        const selected = instance.onDidChangeCursorSelection(() => {
            window.clearTimeout(timer)
            setSelection(null)
            if (!dragging) timer = window.setTimeout(update, 250)
        })
        const changed = instance.onDidChangeModelContent(update)
        const modelChanged = instance.onDidChangeModel(() => { version = -1; update() })
        const scrolled = instance.onDidScrollChange(() => reposition.current())
        const laidOut = instance.onDidLayoutChange(() => reposition.current())
        const keyDown = instance.onKeyDown(event => {
            if (event.browserEvent.key === 'Escape') { window.clearTimeout(timer); setSelection(null) }
            const button = toolbar.current?.querySelector<HTMLButtonElement>('button')
            if (event.browserEvent.key === 'Tab' && !event.browserEvent.shiftKey && toolbar.current?.style.visibility === 'visible' && button && !button.disabled) {
                event.preventDefault(); event.stopPropagation()
                button.focus()
            }
        })
        document.addEventListener('pointerdown', pointerDown, true)
        document.addEventListener('pointerup', pointerUp, true)
        document.addEventListener('pointercancel', pointerUp, true)
        window.addEventListener('resize', reposition.current)
        document.addEventListener('scroll', reposition.current, true)
        update()
        const layout = reposition.current
        return () => {
            disposed = true
            window.clearTimeout(timer)
            selected.dispose(); changed.dispose(); modelChanged.dispose(); scrolled.dispose(); laidOut.dispose(); keyDown.dispose()
            document.removeEventListener('pointerdown', pointerDown, true)
            document.removeEventListener('pointerup', pointerUp, true)
            document.removeEventListener('pointercancel', pointerUp, true)
            window.removeEventListener('resize', layout)
            document.removeEventListener('scroll', layout, true)
            reposition.current = () => {}
        }
    }, [instance, filePath, workspaceRoot])
    if (!selection) return null
    return createPortal(<div ref={toolbar} style={{ position: 'fixed', zIndex: 10000, visibility: 'hidden', width: 'max-content', maxWidth: 'calc(100vw - 16px)' }}>
        <SelectionActionBar key={`${selection.sourceRevision}:${selection.startLine}:${selection.endLine}:${selection.text}`} selection={selection} onAttached={onAttached} onDismiss={dismiss} />
    </div>, document.body)
}
