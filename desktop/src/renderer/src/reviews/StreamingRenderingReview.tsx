import { useMemo, useRef } from 'react'
import type { LegendListRef } from '@legendapp/list/react'
import { AssistantVirtualTimeline } from '@/pages/assistant/AssistantVirtualTimeline'
import { StreamingAssistantMarkdown, CompletedAssistantMarkdown } from '@/pages/assistant/AssistantTimelineText'
import type { TimelineDisplayRow } from '@/pages/assistant/assistant-timeline-helpers'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { streamingDiagram, streamingParagraphs, streamingVisualization } from './streaming-review-data'
import { VisualizationMessage } from '@/components/ui/visualization/VisualizationMessage'
import { useStreamingReview } from './use-streaming-review'

const date = '2026-10-07T13:20:00.000Z'
const history: TimelineDisplayRow[] = Array.from({ length: 8 }, (_, index) => ({
    id: `preview-history-${index}`, kind: 'message', createdAt: date,
    message: { id: `preview-history-${index}`, turnId: null, role: 'assistant', text: `Earlier message ${index + 1}. This is fictional history to make the preview scrollable.`, streaming: false, createdAt: date, updatedAt: date }
}))
const renderRow = (row: TimelineDisplayRow) => row.kind !== 'message' ? null : row.message.streaming
    ? <StreamingAssistantMarkdown content={row.message.text} cacheKey={row.id} fadeStreamingText />
    : <CompletedAssistantMarkdown content={row.message.text} cacheKey={row.id}/>
const buttonClass = 'rounded-md border border-[var(--surface-divider)] px-3 py-1.5 text-xs text-sparkle-text-secondary hover:bg-[var(--surface-hover)]'

export function StreamingRenderingReview() {
    const diagram = useStreamingReview(streamingDiagram, 4)
    const visualization = useStreamingReview(streamingVisualization, 8)
    const prose = useStreamingReview(streamingParagraphs, 14)
    const list = useRef<LegendListRef | null>(null)
    const scroll = useRef<HTMLDivElement | null>(null)
    const rows = useMemo<TimelineDisplayRow[]>(() => [...history, {
        id: 'stream-preview', kind: 'message', createdAt: date,
        message: { id: 'stream-preview', turnId: 'preview-turn', role: 'assistant', text: prose.text || 'Replay to simulate a live response.', streaming: prose.running, createdAt: date, updatedAt: date }
    }], [prose.text, prose.running])
    return <section id="streaming" className="space-y-6">
        <div data-diagram-simulation>
            <div className="mb-3 flex items-center justify-between text-xs"><span>Diagram streaming</span><button className={buttonClass} onClick={diagram.replay}>Replay diagram</button></div>
            <MarkdownRenderer content={diagram.text} transient={diagram.running} interactionLayerEnabled={false} />
        </div>
        <div data-visualization-simulation>
            <div className="mb-3 flex items-center justify-between text-xs"><span>Visualization streaming</span><button className={buttonClass} onClick={visualization.replay}>Replay visualization</button></div>
            <VisualizationMessage content={visualization.text} streaming={visualization.running} renderMarkdown={text => <MarkdownRenderer content={text} transient={visualization.running} interactionLayerEnabled={false}/>} />
        </div>
        <div data-prose-simulation>
            <div className="mb-3 flex items-center justify-between text-xs"><span>Paragraph streaming · follow bottom or scroll up</span><button className={buttonClass} onClick={prose.replay}>Replay response</button></div>
            <div className="h-[420px] overflow-hidden rounded-lg border border-[var(--surface-divider)]">
                <AssistantVirtualTimeline rows={rows} windowKey={`stream-review-${prose.run}`} listRef={list} scrollContainerRef={scroll}
                    contentInsetEndAdjustment={0} isWorking={prose.running} selectionHydrating={false}
                    hasOlder={false} hasNewer={false} loadingOlder={false} loadingNewer={false}
                    loadOlderError={null} loadNewerError={null} renderRow={renderRow}/>
            </div>
        </div>
    </section>
}
