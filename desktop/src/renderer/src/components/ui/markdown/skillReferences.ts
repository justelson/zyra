import type { Element, Root, Text } from 'hast'

const SKILL_REFERENCE = /(^|[\s(\[{"'])\/skill:([a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*)(?=$|[\s.,!?;)\]}])/gi
const BLOCKED_ELEMENTS = new Set(['a', 'code', 'pre', 'script', 'style', 'math'])

function splitSkillReferences(value: string): Array<Text | Element> {
    const nodes: Array<Text | Element> = []
    let cursor = 0
    for (const match of value.matchAll(SKILL_REFERENCE)) {
        const start = match.index + match[1].length
        const reference = match[0].slice(match[1].length)
        if (start > cursor) nodes.push({ type: 'text', value: value.slice(cursor, start) })
        nodes.push({
            type: 'element',
            tagName: 'span',
            properties: { dataSkillReference: reference },
            children: [{ type: 'text', value: match[2] }]
        })
        cursor = start + reference.length
    }
    if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
    return nodes
}

/** Enhance sanitized prose only; links, literal code and math retain their original text. */
export function enhanceSkillReferenceChips(node: Root | Element): void {
    if (node.type === 'element' && (BLOCKED_ELEMENTS.has(node.tagName) || node.properties.dataMathSource !== undefined)) return
    const children: Root['children'] = []
    for (const child of node.children) {
        if (child.type === 'text') children.push(...splitSkillReferences(child.value))
        else {
            if (child.type === 'element') enhanceSkillReferenceChips(child)
            children.push(child)
        }
    }
    node.children = children as typeof node.children
}
