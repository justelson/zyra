import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { SettingsProvider } from '@/lib/settings'
import { VisualizationMessage } from '@/components/ui/visualization/VisualizationMessage'
import { MermaidDiagram } from '@/components/ui/markdown/MermaidDiagram'
import { TimelineToolCallList } from '@/pages/assistant/AssistantTimelineToolCalls'
import { installProvidersReviewFixture } from './providers-review-fixture'
import { chart,compact,diagram,pluginActivities } from './rendering-review-data'
import { StreamingRenderingReview } from './StreamingRenderingReview'
import '@/index.css'
installProvidersReviewFixture()
const timestamp=<time dateTime="2026-10-07T13:20:00">7 Oct 2026, 13:20</time>
const visual=(content:string)=><VisualizationMessage content={content} streaming={false} timestamp={timestamp} renderMarkdown={text=><p>{text}</p>}/>
createRoot(document.getElementById('root')!).render(<HashRouter><SettingsProvider><div className="flex h-screen flex-col">
    <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--surface-divider)] px-4 text-xs text-sparkle-text-muted"><span>Chat rendering preview · Fictional data</span><nav className="flex gap-4"><a href="#charts">Charts</a><a href="#diagrams">Diagram</a><a href="#plugins">Plugin work</a><a href="#streaming">Streaming</a></nav></header>
    <main className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"><div className="mx-auto max-w-[820px] space-y-10 px-6 py-8">
        <section id="charts" className="space-y-6">{visual(chart)}{visual(compact)}</section>
        <section id="diagrams"><MermaidDiagram chart={diagram}/></section>
        <section id="plugins" className="pb-8"><TimelineToolCallList activities={pluginActivities}/></section>
        <StreamingRenderingReview />
    </div></main>
</div></SettingsProvider></HashRouter>)
