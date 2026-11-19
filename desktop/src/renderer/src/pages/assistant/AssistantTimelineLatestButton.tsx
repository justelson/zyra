import type { RefObject } from 'react'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AssistantTimelineLatestButton(props: { buttonRef?: RefObject<HTMLButtonElement | null>; visible: boolean; label: string; pending?: boolean; onClick: () => void }) {
    return <button ref={props.buttonRef} type="button" onClick={props.onClick} disabled={props.pending}
        className={cn('pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-sparkle-card/95 px-3 py-2 text-xs text-sparkle-text-secondary shadow-lg shadow-black/20 backdrop-blur-xl transition-all hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text', props.visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0')}
        title={props.label} aria-busy={props.pending || undefined}>
        <ArrowDown size={13} aria-hidden="true" />{props.label}
    </button>
}
