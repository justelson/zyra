import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Box, Folder, SquareTerminal, X } from 'lucide-react'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { INLINE_REFERENCE_CHIP_GEOMETRY, SKILL_REFERENCE_CHIP_TONE } from '@/components/ui/SkillReferenceChip'
import { composerNodeText, composerSelection, composerTokenDeletionRange, setComposerSelection } from './composer-rich-text'
import { sortInlineMentionTags, type InlineMentionTag } from './assistant-composer-inline-mentions'

// Geometry ported from T3's composerInlineChip: font-relative height, icon, gap,
// baseline and dismiss target, so changing the prompt font preserves alignment.
const geometry = `${INLINE_REFERENCE_CHIP_GEOMETRY} select-none`
const iconClass = 'block size-[1.17em] shrink-0 self-center opacity-85 [&>svg]:block'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
    tags: InlineMentionTag[]; theme: 'light' | 'dark'; onRemoveTag: (tag: InlineMentionTag) => void; onTagsChange: (tags: InlineMentionTag[]) => void
}

/** A text editor with real noneditable token chips and a textarea-compatible caret API. */
export const ComposerTextInput = forwardRef<HTMLTextAreaElement, Props>(function ComposerTextInput({ value = '', tags, theme, onRemoveTag, onTagsChange, onChange, onPaste, onCopy, onCut, onKeyDown, rows = 3, disabled, placeholder, ...props }, forwardedRef) {
    const rootRef = useRef<HTMLDivElement>(null)
    const chipRoots = useRef<Root[]>([])
    const composing = useRef(false)
    const renderedTheme = useRef(theme)
    const onRemove = useRef(onRemoveTag); onRemove.current = onRemoveTag
    useImperativeHandle(forwardedRef, () => rootRef.current as unknown as HTMLTextAreaElement, [])

    useLayoutEffect(() => {
        const root = rootRef.current!
        Object.defineProperties(root, {
            value: { configurable: true, get: () => composerNodeText(root) },
            selectionStart: { configurable: true, get: () => composerSelection(root)[0] },
            selectionEnd: { configurable: true, get: () => composerSelection(root)[1] },
            setSelectionRange: { configurable: true, value: (start: number, end: number) => setComposerSelection(root, start, end) }
        })
        return () => { const roots = chipRoots.current; chipRoots.current = []; queueMicrotask(() => roots.forEach(chip => chip.unmount())) }
    }, [])

    useLayoutEffect(() => {
        const root = rootRef.current!, text = String(value)
        const signature = JSON.stringify(tags.map(tag => [tag.id, tag.kind, tag.path]))
        const domSignature = JSON.stringify(readTags(root).map(tag => [tag.id, tag.kind, tag.path]))
        if (composing.current || (composerNodeText(root) === text && signature === domSignature && theme === renderedTheme.current)) return
        const focused = root.ownerDocument.activeElement === root, caret = composerSelection(root)
        const oldRoots = chipRoots.current; chipRoots.current = []; queueMicrotask(() => oldRoots.forEach(chip => chip.unmount()))
        const nodes: Node[] = []
        const addText = (content: string) => content.split('\n').forEach((line, index) => { if (index) nodes.push(document.createElement('br')); nodes.push(document.createTextNode(line)) })
        let cursor = 0
        for (const tag of sortInlineMentionTags(tags)) {
            if (tag.start < cursor || tag.end > text.length) continue
            addText(text.slice(cursor, tag.start))
            const chip = document.createElement('span')
            chip.contentEditable = 'false'; chip.dataset.composerToken = text.slice(tag.start, tag.end)
            chip.dataset.composerTag = JSON.stringify(tag)
            chip.dataset.composerChip = tag.kind
            chip.className = `relative inline-flex align-[-0.125em] leading-none ${geometry} ${tag.kind === 'skill' ? SKILL_REFERENCE_CHIP_TONE : tag.kind === 'command' ? 'border-amber-500/25 bg-amber-500/[0.12] text-amber-700 dark:text-amber-300' : 'border-[var(--surface-divider)] bg-[var(--surface-active)] text-sparkle-text'}`
            chip.title = tag.kind === 'skill' ? `Skill: ${tag.label}` : tag.relativePath
            const chipRoot = createRoot(chip); chipRoots.current.push(chipRoot)
            const icon = tag.kind === 'skill' ? <Box className={iconClass} /> : tag.kind === 'command' ? <SquareTerminal className={iconClass} /> : tag.kind === 'directory' ? <Folder className={iconClass} /> : <FileEntryIcon pathValue={tag.path} kind="file" theme={theme} size={14} className={iconClass} />
            chipRoot.render(<>{icon}<span className="block max-w-[24ch] self-center truncate leading-tight">{tag.label}</span><button type="button" tabIndex={-1} aria-label={`Remove ${tag.label}`} onMouseDown={event => event.preventDefault()} onClick={() => { root.focus(); const live = readTags(root).find(entry => entry.id === tag.id); if (!live) return; setComposerSelection(root, live.start, live.end); if (!document.execCommand('delete')) onRemove.current(live) }} className="ml-[0.17em] inline-flex size-[1.17em] shrink-0 items-center justify-center rounded-sm text-sparkle-text-muted/70 transition-colors hover:bg-white/10 hover:text-sparkle-text"><X size={11} /></button></>)
            nodes.push(chip); cursor = tag.end
        }
        addText(text.slice(cursor)); root.replaceChildren(...nodes)
        renderedTheme.current = theme
        if (focused) setComposerSelection(root, Math.min(caret[0], text.length), Math.min(caret[1], text.length))
    }, [value, tags, theme])

    const emit = (event: unknown) => { onChange?.(event as Parameters<NonNullable<Props['onChange']>>[0]); onTagsChange(readTags(rootRef.current!)) }
    const insert = (text: string) => { rootRef.current?.focus(); const escaped = document.createElement('div'); escaped.textContent = text; document.execCommand('insertHTML', false, escaped.innerHTML.replace(/\r?\n/g, '<br>')) }
    const copySelection = (event: React.ClipboardEvent<HTMLDivElement>, cut = false) => {
        const [start, end] = composerSelection(rootRef.current!)
        if (start === end) return
        event.preventDefault()
        event.clipboardData.setData('text/plain', composerNodeText(rootRef.current!).slice(start, end))
        if (cut && !disabled) document.execCommand('delete')
    }
    return <div role="textbox" aria-multiline="true" {...props as React.HTMLAttributes<HTMLDivElement>} ref={rootRef} style={{ ...props.style, minHeight: `${rows}lh` }} contentEditable={!disabled} suppressContentEditableWarning aria-disabled={disabled || undefined} data-composer-text-input data-placeholder={placeholder} className={`${props.className || ''} whitespace-pre-wrap break-words empty:before:pointer-events-none empty:before:font-normal empty:before:text-sparkle-text-muted empty:before:opacity-80 empty:before:content-[attr(data-placeholder)]`}
        onInput={event => { if (!composing.current) emit(event) }}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={event => { composing.current = false; emit(event) }}
        onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing) return
            if (!disabled && (event.key === 'Backspace' || event.key === 'Delete')) {
                const root = rootRef.current!
                const [start, end] = composerSelection(root)
                const range = composerTokenDeletionRange(readTags(root), start, end, event.key)
                if (range) {
                    event.preventDefault()
                    setComposerSelection(root, ...range)
                    // Native editing keeps the prompt, chip metadata and undo history together.
                    root.ownerDocument.execCommand('delete')
                    return
                }
            }
            if (event.key !== 'Backspace' && event.key !== 'Delete') onKeyDown?.(event as unknown as Parameters<NonNullable<Props['onKeyDown']>>[0])
            if (!event.defaultPrevented && event.key === 'Enter') { event.preventDefault(); document.execCommand('insertLineBreak') }
        }}
        onPaste={event => {
            onPaste?.(event as unknown as Parameters<NonNullable<Props['onPaste']>>[0])
            if (!event.defaultPrevented) { event.preventDefault(); insert(event.clipboardData.getData('text/plain')) }
        }}
        onCopy={event => { onCopy?.(event as unknown as Parameters<NonNullable<Props['onCopy']>>[0]); if (!event.defaultPrevented) copySelection(event) }}
        onCut={event => { onCut?.(event as unknown as Parameters<NonNullable<Props['onCut']>>[0]); if (!event.defaultPrevented) copySelection(event, true) }}
    />
})

function readTags(root: HTMLElement): InlineMentionTag[] {
    const result: InlineMentionTag[] = []
    let offset = 0
    const visit = (node: Node) => {
        if (node instanceof HTMLElement && node.dataset.composerTag) {
            const tag = JSON.parse(node.dataset.composerTag) as InlineMentionTag
            const length = composerNodeText(node).length
            result.push({ ...tag, start: offset, end: offset + length }); offset += length
        } else if (node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement) offset += composerNodeText(node).length
        else node.childNodes.forEach(visit)
    }
    root.childNodes.forEach(visit)
    return result
}
