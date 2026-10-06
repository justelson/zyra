import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { VisualizationBlock } from '@shared/visualization'
import { ZYRA_THEME_CHANGED_EVENT } from '@/lib/theme-events'
import { buildVisualizationDocument, DEFAULT_VISUALIZATION_THEME, type VisualizationTheme } from './visualization-document'

import { VisualizationInfo } from './VisualizationInfo'
import { copyTextToClipboard } from '@/lib/copy-text'

export const VisualizationPreview = memo(function VisualizationPreview({ block, streaming, timestamp }: { block: VisualizationBlock; streaming: boolean; timestamp?: ReactNode }) {
    const root = useRef<HTMLElement>(null)
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
                scheme: owner.body.classList.contains('light') ? 'light' : 'dark'
            }
            setTheme(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        }
        update()
        setMounted(true)
        view.addEventListener(ZYRA_THEME_CHANGED_EVENT, update)
        const observer = new MutationObserver(update)
        observer.observe(owner.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
        observer.observe(owner.body, { attributes: true, attributeFilter: ['class', 'style'] })
        return () => { view.removeEventListener(ZYRA_THEME_CHANGED_EVENT, update); observer.disconnect() }
    }, [])
    const source = useMemo(() => mounted && block.state === 'complete' ? buildVisualizationDocument(block.html, block.title, theme, { inline: true }) : '', [mounted, block.html, block.title, block.state, theme])
    const pending = block.state === 'incomplete' && streaming
    const previewHeight = block.height
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
    return <figure ref={root} className="my-3 min-w-0" data-visualization-state={block.state} aria-busy={pending}>
        <header className="mb-2 flex min-h-6 flex-wrap items-center gap-1 text-[12px] text-sparkle-text">
            <span className={pending ? 'animate-pulse text-sparkle-text-muted motion-reduce:animate-none' : 'min-w-0 break-words font-medium'}>{pending ? 'Creating visualization…' : block.title}</span>
            {block.state === 'complete' && source ? <VisualizationInfo title={block.title} onCopy={copy} onDownload={save} /> : null}
            {block.state === 'complete' && timestamp ? <span className="ml-1 whitespace-nowrap text-[11px] font-normal text-sparkle-text-muted">{timestamp}</span> : null}
        </header>
        {notice ? <p role="status" className="mb-1 text-[11px] text-sparkle-text-muted">{notice}</p> : null}
        {block.state === 'complete' ? source ? <iframe title={block.title} aria-description={block.summary || undefined} srcDoc={source} sandbox="" referrerPolicy="no-referrer" loading="lazy" className="block w-full border-0 bg-transparent" style={{ height: previewHeight, colorScheme: 'normal' }} />
            : <div className="text-[12px] text-sparkle-text-muted" style={{ height: previewHeight }}>Preparing preview…</div>
            : !pending ? <p role="status" className="text-[12px] text-sparkle-text-muted">{block.state === 'too-large' ? 'Visualization exceeds the preview size limit.' : 'Visualization incomplete.'}</p> : null}
    </figure>
})
