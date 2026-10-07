import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { VisualizationBlock } from '@shared/visualization'
import { ZYRA_THEME_CHANGED_EVENT } from '@/lib/theme-events'
import { buildVisualizationDocument, DEFAULT_VISUALIZATION_THEME, type VisualizationTheme } from './visualization-document'

import { VisualizationInfo } from './VisualizationInfo'
import { copyTextToClipboard } from '@/lib/copy-text'
import { APPEARANCE_FONT_FACES_CHANGED_EVENT, getAppearanceFontResource } from '@/lib/appearance-font-faces'
import { ArtifactCreationState } from '../ArtifactCreationState'

export const VisualizationPreview = memo(function VisualizationPreview({ block, streaming, timestamp }: { block: VisualizationBlock; streaming: boolean; timestamp?: ReactNode }) {
    const root = useRef<HTMLElement>(null)
    const frame = useRef<HTMLIFrameElement>(null)
    const [channel] = useState(() => crypto.randomUUID())
    const [measurement, setMeasurement] = useState<{ source: string; height: number } | null>(null)
    const [theme, setTheme] = useState<VisualizationTheme>(DEFAULT_VISUALIZATION_THEME)
    const [mounted, setMounted] = useState(false)
    const [notice, setNotice] = useState('')
    useEffect(() => {
        if (!notice) return
        const timer = window.setTimeout(() => setNotice(''), 3000)
        return () => window.clearTimeout(timer)
    }, [notice])
    useEffect(() => {
        const element = root.current
        if (!element) return
        const owner = element.ownerDocument
        const view = owner.defaultView!
        const update = () => {
            const css = view.getComputedStyle(element)
            const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
            const next: VisualizationTheme = {
                background: value('--color-bg', DEFAULT_VISUALIZATION_THEME.background),
                text: value('--color-text', DEFAULT_VISUALIZATION_THEME.text),
                muted: value('--color-text-muted', DEFAULT_VISUALIZATION_THEME.muted),
                accent: value('--accent-primary', DEFAULT_VISUALIZATION_THEME.accent),
                border: value('--surface-divider', DEFAULT_VISUALIZATION_THEME.border),
                font: css.fontFamily || DEFAULT_VISUALIZATION_THEME.font,
                fontResource: getAppearanceFontResource(owner, css.fontFamily),
                scheme: owner.body.classList.contains('light') ? 'light' : 'dark'
            }
            setTheme(previous => (Object.keys(next) as (keyof VisualizationTheme)[]).every(key => previous[key] === next[key]) ? previous : next)
        }
        update()
        setMounted(true)
        view.addEventListener(ZYRA_THEME_CHANGED_EVENT, update)
        view.addEventListener(APPEARANCE_FONT_FACES_CHANGED_EVENT, update)
        const observer = new MutationObserver(update)
        observer.observe(owner.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
        observer.observe(owner.body, { attributes: true, attributeFilter: ['class', 'style'] })
        return () => { view.removeEventListener(ZYRA_THEME_CHANGED_EVENT, update); view.removeEventListener(APPEARANCE_FONT_FACES_CHANGED_EVENT, update); observer.disconnect() }
    }, [])
    const source = useMemo(() => mounted && block.state === 'complete' ? buildVisualizationDocument(block.html, block.title, theme, { inline: true }) : '', [mounted, block.html, block.title, block.state, theme])
    const initializeFrame = () => frame.current?.contentWindow?.postMessage({ type: 'zyra:visualization-init', channel, document: source }, '*')
    useEffect(() => {
        const view = root.current?.ownerDocument.defaultView
        if (!view || !source) return
        const receive = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return
            if (event.data?.type === 'zyra:visualization-ready') { initializeFrame(); return }
            if (event.data?.type !== 'zyra:visualization-height' || event.data.channel !== channel) return
            const height = event.data.height
            if (typeof height !== 'number' || !Number.isFinite(height) || height < 0 || height > 100_000) return
            setMeasurement(previous => previous?.source === source && previous.height === height ? previous : { source, height })
        }
        view.addEventListener('message', receive)
        return () => view.removeEventListener('message', receive)
    }, [source, channel])
    const pending = block.state === 'incomplete' && streaming
    const previewHeight = measurement?.source === source ? Math.min(block.height, Math.max(32, measurement.height)) : block.height
    const copy = async () => {
        try { await copyTextToClipboard(buildVisualizationDocument(block.html, block.title, theme)); setNotice('HTML copied') }
        catch { setNotice('Could not copy HTML. Try downloading it.') }
    }
    const save = () => {
        const exported = buildVisualizationDocument(block.html, block.title, theme)
        const url = URL.createObjectURL(new Blob([exported], { type: 'text/html' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${block.title.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'visualization'}.html`
        anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    if (pending) return <figure ref={root} className="my-3 min-w-0" data-visualization-state={block.state} aria-busy><ArtifactCreationState kind="visualization" phase="creating"/></figure>
    return <figure ref={root} className="my-3 min-w-0" data-visualization-state={block.state}>
        <header className="mb-2 flex min-h-6 items-center gap-2 text-[12px] text-sparkle-text">
            <span className="min-w-0 break-words font-medium">{block.title}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
                {block.state === 'complete' && timestamp ? <span className="whitespace-nowrap text-[11px] font-normal text-sparkle-text-muted">{timestamp}</span> : null}
                {block.state === 'complete' && source ? <VisualizationInfo title={block.title} onCopy={copy} onDownload={save} /> : null}
            </span>
        </header>
        {notice ? <p role="status" className="mb-1 text-[11px] text-sparkle-text-muted">{notice}</p> : null}
        {block.state === 'complete' ? source ? <div className="relative">
            <iframe key={source} ref={frame} title={block.title} aria-description={block.summary || undefined} aria-hidden={measurement?.source !== source || undefined} src="./visualization-frame.html" onLoad={initializeFrame} data-visualization-ready={measurement?.source === source || undefined} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" className="block w-full border-0 bg-transparent" style={{ height: previewHeight, colorScheme: 'normal', opacity: measurement?.source === source ? 1 : 0 }} />
            {measurement?.source !== source ? <div className="absolute inset-0"><ArtifactCreationState kind="visualization" phase="loading" className="h-full"/></div> : null}
        </div> : <div style={{ height: previewHeight }}><ArtifactCreationState kind="visualization" phase="loading" className="h-full"/></div>
            : <p role="status" className="text-[12px] text-sparkle-text-muted">{block.state === 'too-large' ? 'Visualization exceeds the preview size limit.' : 'Visualization incomplete.'}</p>}
    </figure>
})
