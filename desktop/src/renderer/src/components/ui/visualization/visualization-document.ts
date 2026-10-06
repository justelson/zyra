import DOMPurify from 'dompurify'
import { visualizationPaletteCss } from './visualization-palette'
import type { AppearanceFontResource } from '@/lib/appearance-font-data'

export type VisualizationTheme = { background: string; text: string; muted: string; accent: string; border: string; font: string; fontResource?: AppearanceFontResource; scheme: 'light' | 'dark' }
export const DEFAULT_VISUALIZATION_THEME: VisualizationTheme = { background: '#181c22', text: '#eef1f6', muted: '#a8b0bd', accent: '#568cff', border: '#343b46', font: 'system-ui, sans-serif', scheme: 'dark' }
export const VISUALIZATION_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const tags = ['style', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'main', 'figure', 'figcaption', 'strong', 'em', 'b', 'i', 'small', 'sub', 'sup', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'details', 'summary', 'a', 'img', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'title', 'desc', 'use']
const attributes = ['id', 'class', 'style', 'title', 'role', 'alt', 'src', 'href', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'clip-path', 'clipPathUnits', 'mask', 'patternUnits', 'patternTransform', 'colspan', 'rowspan', 'scope', 'open']

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cssValue = (value: string) => value.replace(/[<>;{}]/g, '')

// Cache immutable sanitized markup, never DOM nodes or iframe instances. Virtual
// rows remount during scrolling; themes and export styling are applied afterward.
const MAX_CACHE_ENTRIES = 48
const MAX_CACHE_BYTES = 2 * 1024 * 1024
const sanitizedCache = new Map<string, { html: string; bytes: number }>()
let cacheBytes = 0
let cacheHits = 0
let cacheMisses = 0
export function getVisualizationDocumentCacheStats() {
    return { entries: sanitizedCache.size, bytes: cacheBytes, hits: cacheHits, misses: cacheMisses, maxEntries: MAX_CACHE_ENTRIES, maxBytes: MAX_CACHE_BYTES }
}

function sanitizeVisualizationHtml(html: string): string {
    const cached = sanitizedCache.get(html)
    if (cached) {
        sanitizedCache.delete(html)
        sanitizedCache.set(html, cached)
        cacheHits++
        return cached.html
    }
    cacheMisses++
    const fragment = DOMPurify.sanitize(html, { ALLOWED_TAGS: tags, ALLOWED_ATTR: attributes, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: true, FORCE_BODY: true, RETURN_DOM_FRAGMENT: true })
    for (const style of fragment.querySelectorAll('style')) {
        // Parse CSS rather than matching text: nested or escaped font-loading
        // rules cannot compete with the app-owned font. Family choices survive.
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(style.textContent ?? '')
        const stripFontRules = (group: CSSStyleSheet | CSSGroupingRule) => {
            for (let index = group.cssRules.length - 1; index >= 0; index--) {
                const rule = group.cssRules[index]!
                if (rule.type === CSSRule.FONT_FACE_RULE || rule.type === CSSRule.IMPORT_RULE) group.deleteRule(index)
                else if ('cssRules' in rule) stripFontRules(rule as CSSGroupingRule)
            }
        }
        stripFontRules(sheet)
        style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join('\n')
    }
    for (const node of fragment.querySelectorAll('[href], [src]')) {
        const href = node.getAttribute('href')
        if (href && !href.startsWith('#')) node.removeAttribute('href')
        const src = node.getAttribute('src')
        if (src && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) node.removeAttribute('src')
    }
    const container = document.createElement('div')
    container.append(fragment)
    const sanitized = container.innerHTML
    const bytes = (html.length + sanitized.length) * 2
    if (bytes <= MAX_CACHE_BYTES) {
        while (sanitizedCache.size >= MAX_CACHE_ENTRIES || cacheBytes + bytes > MAX_CACHE_BYTES) {
            const oldest = sanitizedCache.keys().next().value!
            cacheBytes -= sanitizedCache.get(oldest)!.bytes
            sanitizedCache.delete(oldest)
        }
        sanitizedCache.set(html, { html: sanitized, bytes })
        cacheBytes += bytes
    }
    return sanitized
}

/** Defense in depth: an allowlist, restricted URLs, a deny-by-default CSP, and iframe sandbox. */
export function buildVisualizationDocument(html: string, title: string, theme: VisualizationTheme, { inline = false }: { inline?: boolean } = {}): string {
    const sanitized = sanitizeVisualizationHtml(html)
    // Match the inline iframe's normal color scheme to avoid Chromium's opaque canvas
    // on theme changes. Theme colors still come from the variables below.
    const style = `:root{color-scheme:${inline ? 'normal' : theme.scheme};--viz-bg:${cssValue(theme.background)};--viz-text:${cssValue(theme.text)};--viz-muted:${cssValue(theme.muted)};--viz-accent:${cssValue(theme.accent)};${visualizationPaletteCss(theme.scheme)};--viz-border:${cssValue(theme.border)}}*{box-sizing:border-box}html{background:transparent;scrollbar-color:var(--viz-border) transparent}body{margin:0;padding:${inline ? '0' : '16px'};background:${inline ? 'transparent' : 'var(--viz-bg)'};color:var(--viz-text);font-family:${cssValue(theme.font)};font-size:14px;line-height:1.5;overflow-wrap:anywhere}svg,img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--viz-border);text-align:left}h1,h2,h3,p,figure{margin:0 0 12px}a{color:var(--viz-accent)}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`
    const trustedFont = theme.fontResource?.css ?? ''
    const policy = trustedFont ? VISUALIZATION_CSP.replace("font-src 'none'", 'font-src data:') : VISUALIZATION_CSP
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${style}${trustedFont}</style></head><body>${sanitized}</body></html>`
}
