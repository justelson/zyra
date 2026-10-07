import { defaultThemeTokens } from '@shared/preferences/default-theme-tokens'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import './diagram-canvas.css'
import { useMarkdownVisualTheme } from './markdownTheme'
import { useThemeRevision } from '@/lib/use-theme-revision'
import { Expand } from 'lucide-react'
import { MermaidExpandedView } from './MermaidExpandedView'
import { ArtifactCreationState } from '../ArtifactCreationState'

function readMermaidTheme(visualTheme: 'light' | 'dark') {
    const root = getComputedStyle(document.documentElement)
    const read = (property: string, fallback: string) => root.getPropertyValue(property).trim() || fallback
    const fallback = defaultThemeTokens(visualTheme)
    const background = read('--color-bg', fallback.bg)
    const surface = read('--color-card', fallback.card)
    const text = read('--color-text', fallback.text)
    const supportingText = read('--color-text-secondary', fallback.textSecondary)
    const border = read('--color-border-secondary', fallback.borderSecondary)
    const accent = read('--accent-primary', fallback.primary)
    const accentSurface = read('--color-accent', surface)
    return {
        cacheKey: [visualTheme, background, surface, text, supportingText, border, accent, accentSurface].join(':'),
        variables: {
            darkMode: visualTheme === 'dark',
            primaryColor: surface,
            primaryTextColor: text,
            primaryBorderColor: accent,
            lineColor: supportingText,
            secondaryColor: accentSurface,
            tertiaryColor: background,
            background,
            mainBkg: surface,
            secondBkg: background,
            textColor: text,
            noteBkgColor: surface,
            noteTextColor: text,
            noteBorderColor: border,
            fontSize: '14px'
        }
    }
}

const MAX_MERMAID_CACHE_ENTRIES = 80
const MAX_MERMAID_CACHE_LENGTH = 2_000_000
const mermaidSvgCache = new Map<string, string>()
const mermaidRenderPromiseCache = new Map<string, Promise<string>>()
let mermaidSvgCacheLength = 0

function readCachedSvg(cacheKey: string): string {
    const cached = mermaidSvgCache.get(cacheKey) || ''
    if (!cached) return ''
    mermaidSvgCache.delete(cacheKey)
    mermaidSvgCache.set(cacheKey, cached)
    return cached
}

function retainCachedSvg(cacheKey: string, svg: string): void {
    const previous = mermaidSvgCache.get(cacheKey)
    if (previous) mermaidSvgCacheLength -= previous.length
    mermaidSvgCache.delete(cacheKey)
    mermaidSvgCache.set(cacheKey, svg)
    mermaidSvgCacheLength += svg.length
    while (mermaidSvgCache.size > MAX_MERMAID_CACHE_ENTRIES || mermaidSvgCacheLength > MAX_MERMAID_CACHE_LENGTH) {
        const oldest = mermaidSvgCache.entries().next().value as [string, string] | undefined
        if (!oldest) break
        mermaidSvgCache.delete(oldest[0])
        mermaidSvgCacheLength -= oldest[1].length
    }
}

function hashString(input: string): string {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash).toString(36)
}

export const MermaidDiagram = memo(function MermaidDiagram({ chart }: { chart: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const visualTheme = useMarkdownVisualTheme()
    const themeRevision = useThemeRevision()
    const activeTheme = useMemo(() => readMermaidTheme(visualTheme), [themeRevision, visualTheme])
    const cacheKey = `${activeTheme.cacheKey}:${chart}`
    const [svg, setSvg] = useState<string>(() => readCachedSvg(cacheKey))
    const [error, setError] = useState('')
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        const cachedSvg = readCachedSvg(cacheKey)
        setSvg((previous) => (previous === (cachedSvg || '') ? previous : (cachedSvg || '')))
        setError((previous) => (previous ? '' : previous))

        if (cachedSvg) {
            return
        }

        let cancelled = false

        const renderDiagram = (): Promise<string> => {
            const existingPromise = mermaidRenderPromiseCache.get(cacheKey)
            if (existingPromise) return existingPromise

            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: 'base',
                themeVariables: activeTheme.variables
            })
            const renderPromise = mermaid.render(`mermaid-${hashString(cacheKey)}`, chart)
                .then(({ svg: renderedSvg }) => {
                    retainCachedSvg(cacheKey, renderedSvg)
                    mermaidRenderPromiseCache.delete(cacheKey)
                    return renderedSvg
                })
                .catch((renderError) => {
                    mermaidRenderPromiseCache.delete(cacheKey)
                    throw renderError
                })

            mermaidRenderPromiseCache.set(cacheKey, renderPromise)
            return renderPromise
        }

        void renderDiagram()
            .then((renderedSvg) => {
                if (cancelled) return
                setSvg((previous) => (previous === renderedSvg ? previous : renderedSvg))
            })
            .catch((renderError: any) => {
                if (cancelled) return
                console.error('Mermaid render error:', renderError)
                setError(renderError.message || 'Failed to render diagram')
            })

        return () => {
            cancelled = true
        }
    }, [activeTheme.variables, cacheKey, chart])

    if (error) {
        return (
            <div ref={containerRef} className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                <strong>Mermaid Error:</strong> {error}
            </div>
        )
    }

    if (!svg) {
        return <ArtifactCreationState kind="diagram" phase="loading"/>
    }

    return (
        <><div className="mermaid-canvas group relative rounded-lg border border-[var(--surface-divider)] bg-sparkle-card">
            <button type="button" aria-label="Expand diagram" title="Expand diagram" onClick={() => setExpanded(true)} className="absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-md border border-[var(--surface-divider)] bg-sparkle-card text-sparkle-text-muted hover:text-sparkle-text"><Expand size={15}/></button>
            <div ref={containerRef} className="mermaid-diagram flex items-center justify-center overflow-x-auto p-4" dangerouslySetInnerHTML={{ __html: svg }}/>
        </div>{expanded ? <MermaidExpandedView svg={svg} onClose={() => setExpanded(false)}/> : null}</>
    )
}, (previous, next) => previous.chart === next.chart)
