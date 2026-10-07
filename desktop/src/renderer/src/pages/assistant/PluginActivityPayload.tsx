import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { TimelineCopyButton } from './assistant-timeline-path-ui'

export function PluginActivityPayload({ label, value }: { label: string; value: string }) {
    const [open, setOpen] = useState(false)
    return <div className="rounded-md border border-[var(--surface-divider)]">
        <div className="flex items-center pr-2">
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sparkle-text-muted">
                <ChevronRight size={12} className={`transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />{label}
            </button>
            <TimelineCopyButton value={value} compact />
        </div>
        <AnimatedHeight isOpen={open} duration={220} crispContent>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-[11px] leading-5 [scrollbar-gutter:stable]">{value}</pre>
        </AnimatedHeight>
    </div>
}
