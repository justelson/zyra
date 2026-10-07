import type { Root } from 'hast'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { normalizeMathDelimiters, remarkMathFallback, rehypeSafeMath } from './math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

type MarkdownAstNode = {
    type?: string
    meta?: unknown
    data?: { hProperties?: Record<string, unknown> }
    position?: unknown
    children?: MarkdownAstNode[]
}

function remarkPreserveCodeMeta() {
    return (tree: MarkdownAstNode) => {
        const visitNode = (node: MarkdownAstNode) => {
            if (node.type === 'code' && typeof node.meta === 'string' && node.meta.trim()) {
                node.data = {
                    ...node.data,
                    hProperties: {
                        ...node.data?.hProperties,
                        dataCodeMeta: node.meta.trim()
                    }
                }
            }
            node.children?.forEach(visitNode)
        }
        visitNode(tree)
    }
}

const MARKDOWN_SANITIZE_SCHEMA = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'details', 'summary', 'picture', 'source'],
    attributes: {
        ...defaultSchema.attributes,
        '*': [
            ...(defaultSchema.attributes?.['*'] || []).filter((attribute) => attribute !== 'title'),
            'align'
        ],
        code: [...(defaultSchema.attributes?.code || []).filter(attribute => !Array.isArray(attribute) || attribute[0] !== 'className'), ['className', /^language-./, 'math-inline', 'math-display'], 'dataCodeMeta'],
        details: [...(defaultSchema.attributes?.details || []), 'open'],
        div: [...(defaultSchema.attributes?.div || []), 'dataCacheRaw'],
        source: [...(defaultSchema.attributes?.source || []), 'src', 'srcSet', 'type', 'media']
    },
    protocols: {
        ...defaultSchema.protocols,
        href: [...(defaultSchema.protocols?.href || []), 'file', 'zyra', 'devscope'],
        src: [...(defaultSchema.protocols?.src || []), 'file', 'zyra', 'devscope']
    }
} satisfies Parameters<typeof rehypeSanitize>[0]

const RAW_HTML_TAG_REGEX = /<\/?[A-Za-z][^>\n]*>/

function createMarkdownProcessor(hasRawHtml: boolean) {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkMathFallback)
        .use(remarkPreserveCodeMeta)
        .use(remarkRehype, { allowDangerousHtml: hasRawHtml })
    if (hasRawHtml) processor.use(rehypeRaw)
    return processor.use(rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA).use(rehypeSafeMath).freeze()
}

const standardMarkdownProcessor = createMarkdownProcessor(false)
const rawHtmlMarkdownProcessor = createMarkdownProcessor(true)

export function markdownContainsRawHtml(content: string): boolean {
    return RAW_HTML_TAG_REGEX.test(content)
}

export function parseMarkdownToHast(content: string, allowRawHtml = true): Root {
    const normalized = normalizeMathDelimiters(content)
    const hasRawHtml = allowRawHtml && markdownContainsRawHtml(normalized)
    const processor = hasRawHtml ? rawHtmlMarkdownProcessor : standardMarkdownProcessor
    return processor.runSync(processor.parse(normalized), { value: normalized }) as Root
}

export function stripMarkdownTreePositions(tree: Root): Root {
    const visitNode = (node: MarkdownAstNode) => {
        delete node.position
        node.children?.forEach(visitNode)
    }
    visitNode(tree as MarkdownAstNode)
    return tree
}

export function applyDocumentMarkdownHeadingIds(tree: Root, headingIds: readonly string[] | undefined): void {
    if (!headingIds?.length) return
    const headings: Array<Extract<Root['children'][number], { type: 'element' }>> = []
    const visitNode = (node: Root['children'][number]) => {
        if (node.type !== 'element') return
        if (/^h[1-6]$/.test(node.tagName) && !node.properties.id) headings.push(node)
        for (const child of node.children) visitNode(child as Root['children'][number])
    }
    for (const child of tree.children) visitNode(child)
    if (headings.length !== headingIds.length) return
    for (let index = 0; index < headings.length; index += 1) headings[index].properties.id = headingIds[index]
}
