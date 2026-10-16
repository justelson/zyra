import { useSettings } from '@/lib/settings'
import { X } from 'lucide-react'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import type { ComposerContextFile } from './assistant-composer-types'

export function AssistantContextAttachment({ file, removing, onOpen, onRemove }: {
    file: ComposerContextFile; removing: boolean; onOpen: () => void; onRemove: () => void
}) {
    const { settings } = useSettings()
    const selection = file.selection
    const hasPreview = Boolean(selection || (file.kind !== 'image' && (file.previewText || file.content)))
    const text = selection?.text || file.previewText || file.content || ''
    return <article data-composer-attachment-item="true" className={`group relative shrink-0 overflow-hidden rounded-md border border-[var(--surface-divider)] bg-sparkle-card transition-[opacity,transform] duration-200 ${removing ? 'scale-95 opacity-0' : ''} ${hasPreview ? 'w-64' : 'max-w-56'}`}>
        <button type="button" aria-label={`Open preview for ${file.name}`} onClick={onOpen} className="block w-full text-left hover:bg-[var(--surface-hover)]">
            <span className="flex h-9 items-center gap-2 pl-2 pr-8">
                {file.previewDataUrl ? <img src={file.previewDataUrl} alt="" className="size-6 shrink-0 rounded-sm object-cover" /> : <FileEntryIcon pathValue={file.path} kind="file" theme={settings.appearanceResolvedMode} size={16} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-xs text-sparkle-text">{selection ? selection.filePath.replace(/\\/g, '/').split('/').pop() : file.name}</span>
                {selection && <span className="shrink-0 rounded bg-white/5 px-1 text-[10px] text-sparkle-text-muted">L{selection.startLine}–{selection.endLine}</span>}
            </span>
            {hasPreview && <pre className="line-clamp-3 max-h-14 overflow-hidden border-t border-[var(--surface-divider)] px-2 py-1.5 font-mono text-[10px] leading-4 text-sparkle-text-muted">{text}</pre>}
        </button>
        <button type="button" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} disabled={removing} onClick={event => { event.stopPropagation(); onRemove() }} className="absolute right-1 top-1.5 flex size-6 items-center justify-center rounded text-sparkle-text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-sparkle-text focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"><X size={12} /></button>
    </article>
}
