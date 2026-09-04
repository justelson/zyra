export type AssistantSkillFrontmatterEntry = {
    key: string
    value: string
    valueKind: 'string' | 'number' | 'boolean' | 'null' | 'collection'
}

export type AssistantSkillSnapshot = {
    frontmatter: AssistantSkillFrontmatterEntry[]
    body: string
}

function classifyYamlValue(value: string): AssistantSkillFrontmatterEntry['valueKind'] {
    if (/^(?:true|false)$/i.test(value)) return 'boolean'
    if (/^(?:null|~)$/i.test(value)) return 'null'
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return 'number'
    if (/^[\[{]|[\]}]$/.test(value) || value === '|' || value === '>') return 'collection'
    return 'string'
}

export function parseAssistantSkillSnapshot(content: string): AssistantSkillSnapshot {
    const normalized = String(content || '').replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return { frontmatter: [], body: normalized }
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex < 0) return { frontmatter: [], body: normalized }
    const frontmatterText = normalized.slice(4, closingIndex)
    const frontmatter = frontmatterText.split('\n').flatMap((line) => {
        if (!line.trim() || /^\s*#/.test(line)) return []
        const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
        if (!match) return [{ key: '', value: line, valueKind: 'collection' as const }]
        const value = match[2] || ''
        return [{ key: match[1] || '', value, valueKind: classifyYamlValue(value) }]
    })
    return { frontmatter, body: normalized.slice(closingIndex + 5).replace(/^\n+/, '') }
}
