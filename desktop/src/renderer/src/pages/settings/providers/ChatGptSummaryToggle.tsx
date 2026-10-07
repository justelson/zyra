import { ChevronDown } from 'lucide-react'

export function ChatGptSummaryToggle({ label, expanded, summaryId, onToggle }: {
    label: string
    expanded: boolean
    summaryId: string
    onToggle: () => void
}) {
    return <button type="button" className="chatgpt-summary-toggle" aria-expanded={expanded} aria-controls={summaryId} onClick={onToggle}>
        {label}<ChevronDown size={12} aria-hidden="true" />
    </button>
}
