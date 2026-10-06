import katex from 'katex'
import { fromHtml } from 'hast-util-from-html'
import type { Element, Root } from 'hast'

/** Normalize model-style TeX delimiters, leaving fenced and inline code alone. */
export function normalizeMathDelimiters(content: string): string {
    if (!content.includes('\\(') && !content.includes('\\[') && !content.includes('$$')) return content
    const missingClosers = new Set<string>()
    let output = '', index = 0, fence = '', inline = ''
    while (index < content.length) {
        if (index === 0 || content[index - 1] === '\n') {
            const marker = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(content.slice(index))
            const displayLine = !fence && !inline ? /^ {0,3}\$\$([^\n]+?)\$\$[ \t]*(?:\r?\n|$)/.exec(content.slice(index)) : null
            if (displayLine) { output += `$$\n${displayLine[1]}\n$$\n`; index += displayLine[0].length; continue }
            if (marker && !inline) {
                const run = marker[1]
                if (!fence) fence = run
                else if (run[0] === fence[0] && run.length >= fence.length && marker[0].slice(marker[0].indexOf(run) + run.length).trim() === '') fence = ''
                output += marker[0]; index += marker[0].length; continue
            }
        }
        if (!fence && content[index] === '`') {
            const run = /^`+/.exec(content.slice(index))![0]
            if (!inline) inline = run
            else if (inline === run) inline = ''
            output += run; index += run.length; continue
        }
        if (!fence && !inline && content[index] === '\\') {
            if (content[index + 1] === '\\') { output += '\\\\'; index += 2; continue }
            const display = content[index + 1] === '['
            if (display || content[index + 1] === '(') {
                const closer = display ? '\\]' : '\\)'
                const end = missingClosers.has(closer) ? -1 : content.indexOf(closer, index + 2)
                if (end < 0) missingClosers.add(closer)
                if (end >= 0) {
                    const value = content.slice(index + 2, end)
                    output += display ? `\n$$\n${value}\n$$\n` : `$${value}$`
                    index = end + 2; continue
                }
            }
        }
        output += content[index++]
    }
    return output
}

type MathNode = { type: string; value?: string; data?: unknown; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MathNode[] }
/** EOF is not a closing display delimiter during streaming. Prices stay prose. */
export function remarkMathFallback() {
    return (tree: MathNode, file: { value: unknown }) => {
        const source = String(file.value)
        const walk = (node: MathNode) => {
            const raw = source.slice(node.position?.start.offset, node.position?.end.offset)
            const price = node.type === 'inlineMath' && /^\d/.test(node.value || '') && /^\d/.test(source.slice(node.position?.end.offset)) && !/[\\^_+=]/.test(node.value || '')
            if ((node.type === 'math' && !/\n {0,3}\${2,}\s*$/.test(raw)) || price) {
                node.type = 'text'; node.value = raw; delete node.data
            }
            node.children?.forEach(walk)
        }
        walk(tree)
    }
}

const formulaCache = new Map<string, { children: Element['children']; bytes: number }>()
const MAX_FORMULA_CACHE_BYTES = 512 * 1024
let formulaCacheBytes = 0, formulaCompilations = 0
export function clearMathRenderCache(): void { formulaCache.clear(); formulaCacheBytes = 0; formulaCompilations = 0 }
export function getMathRenderCacheStats() { return { entries: formulaCache.size, bytes: formulaCacheBytes, compilations: formulaCompilations } }

function renderFormula(value: string, display: boolean, copy: string): Element['children'] {
    const key = `${display ? 'display' : 'inline'}:${value}`
    const cached = formulaCache.get(key)
    if (cached) {
        formulaCache.delete(key); formulaCache.set(key, cached)
        return structuredClone(cached.children)
    }
    let children: Element['children']
    try {
        if (value.length > 8192) throw new RangeError('Formula exceeds the rendering limit')
        formulaCompilations++
        children = fromHtml(katex.renderToString(value, { displayMode: display, output: 'htmlAndMathml', trust: false, strict: 'ignore', throwOnError: true, maxExpand: 1000, maxSize: 20 }), { fragment: true }).children.filter(part => part.type !== 'doctype')
    } catch { children = [{ type: 'text', value: copy }] }
    const bytes = (key.length + JSON.stringify(children).length) * 2
    if (bytes <= MAX_FORMULA_CACHE_BYTES) {
        while (formulaCache.size >= 32 || formulaCacheBytes + bytes > MAX_FORMULA_CACHE_BYTES) {
            const oldest = formulaCache.keys().next().value!
            formulaCacheBytes -= formulaCache.get(oldest)!.bytes; formulaCache.delete(oldest)
        }
        formulaCache.set(key, { children: structuredClone(children), bytes }); formulaCacheBytes += bytes
    }
    return children
}

/** Only sanitized math markers reach this plugin. KaTeX never trusts TeX HTML. */
export function rehypeSafeMath() {
    return (tree: Root) => {
        const walk = (parent: Root | Element) => {
            parent.children = parent.children.map(child => {
                if (child.type !== 'element') return child
                const classes = child.properties.className as string[] | undefined
                if (child.tagName === 'code' && classes?.includes('language-math')) {
                    const display = classes.includes('math-display')
                    const value = child.children.map(part => part.type === 'text' ? part.value : '').join('').replace(/\n$/, '')
                    const copy = display ? `$$\n${value}\n$$` : `$${value}$`
                    const children = renderFormula(value, display, copy)
                    return { type: 'element', tagName: 'span', properties: { className: ['markdown-math'], dataMathSource: value, dataMarkdownCopy: copy }, children } satisfies Element
                }
                walk(child)
                // remark-rehype uses pre > code for display math; don't render it as a code card.
                if (child.tagName === 'pre' && child.children.length === 1 && child.children[0].type === 'element' && child.children[0].properties.dataMathSource !== undefined) return child.children[0]
                return child
            }) as typeof parent.children
        }
        walk(tree)
    }
}
