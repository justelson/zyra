import type { Element, Root, RootContent } from 'hast'
import { resolveImageSrc } from './paths'

export type MarkdownAudioSource = { href: string; label: string }
export const isMarkdownAudioHref = (href: string): boolean => /\.(?:mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:[?#].*)?$/i.test(href.trim())
const text = (node: RootContent): string => node.type === 'text' ? node.value : 'children' in node ? node.children.map(child => text(child as RootContent)).join('') : ''

/** Presentation-only grouping, scoped to this compiled message, never the global component cache. */
export function groupMarkdownAudio(tree: Root, filePath?: string): { sources: MarkdownAudioSource[]; copy: string } | null {
    const links: Element[] = []
    const find = (node: Root | RootContent) => {
        if (node.type === 'element') {
            delete node.properties['data-markdown-audio-group']
            if (node.tagName === 'code' || node.tagName === 'pre') return
            if (node.tagName === 'a' && typeof node.properties.href === 'string' && isMarkdownAudioHref(node.properties.href)) links.push(node)
        }
        if ('children' in node) node.children.forEach(child => find(child as RootContent))
    }
    find(tree)
    if (links.length < 2) return null
    const sources = new Map<string, MarkdownAudioSource>()
    const authored: MarkdownAudioSource[] = []
    for (const link of links) {
        const href = String(link.properties.href)
        const source = { href, label: text(link).trim() || 'Audio' }
        authored.push(source)
        const resolved = resolveImageSrc(href, filePath)
        const identity = /^\w+:\/\/\/[a-z]:\//i.test(resolved) ? resolved.toLowerCase() : resolved
        if (!sources.has(identity)) sources.set(identity, source)
    }
    links[0].properties['data-markdown-audio-group'] = 'primary'
    const removed = new Set(links.slice(1))
    const prune = (node: Root | Element): boolean => {
        let changed = false
        node.children = node.children.filter(child => {
            if (child.type !== 'element') return true
            if (removed.has(child)) { changed = true; return false }
            const nested = prune(child)
            changed ||= nested
            return !(nested && ['p', 'li', 'ul', 'ol'].includes(child.tagName) && child.children.every(value => value.type === 'text' && !value.value.trim()))
        })
        return changed
    }
    prune(tree)
    return { sources: [...sources.values()], copy: authored.map(source => `[${source.label}](${source.href})`).join('\n\n') }
}
