import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Quote, X } from 'lucide-react'
import type { ComposerContextFile } from './assistant-composer-types'
import { assistantCitationSourceHref, updateCitationComment } from './assistant-citations'

export function AssistantCitationChip({ file, onUpdate, onRemove, removing }: { file: ComposerContextFile; onUpdate?: (file: ComposerContextFile) => void; onRemove?: () => void; removing?: boolean }) {
    const [expanded, setExpanded] = useState(false)
    const citation = file.citation
    if (!citation) return null
    return <div className={`max-w-[340px] rounded-xl border border-white/15 bg-white/[0.04] text-xs text-sparkle-text ${removing ? 'pointer-events-none opacity-40' : ''}`}>
        <div className="flex items-center gap-1 px-2 py-1.5">
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex min-w-0 items-center gap-1.5 text-left" title={citation.text}><Quote size={13} className="shrink-0" /><span className="truncate">{citation.text.slice(0, 70)}</span></button>
            {onRemove ? <button type="button" className="ml-1 rounded p-0.5 hover:bg-white/10" aria-label="Remove citation" onClick={onRemove}><X size={12} /></button> : null}
        </div>
        {expanded ? <div className="space-y-2 border-t border-white/10 p-2">
            <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-white/20 pl-2 text-sparkle-text-secondary">{citation.text}</blockquote>
            <Link className="inline-block underline underline-offset-2" to={assistantCitationSourceHref(citation)} state={{ assistantCitation: citation }}>View source response</Link>
            {onUpdate ? <label className="block">Comment<textarea aria-label="Citation comment" className="mt-1 max-h-40 min-h-16 w-full resize-y rounded border border-white/15 bg-transparent p-2 outline-none focus:border-white/40" maxLength={8000} value={citation.comment} disabled={!onUpdate} placeholder="Add a comment about this passage…" onChange={event => onUpdate?.(updateCitationComment(file, event.target.value))} /></label> : citation.comment ? <p className="whitespace-pre-wrap break-words text-sparkle-text-secondary">{citation.comment}</p> : null}
        </div> : null}
    </div>
}
