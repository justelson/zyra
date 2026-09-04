export type AssistantSkillFrontmatterEntry = {
    key: string
    value: string
    valueKind: 'string' | 'number' | 'boolean' | 'null' | 'collection'
}

export type AssistantSkillSnapshot = {
    frontmatter: AssistantSkillFrontmatterEntry[]
    frontmatterSource: string
    name: string | null
    description: string | null
    metadata: AssistantSkillFrontmatterEntry[]
    body: string
}

function classifyYamlValue(value: string): AssistantSkillFrontmatterEntry['valueKind'] {
    if (/^(?:true|false)$/i.test(value)) return 'boolean'
    if (/^(?:null|~)$/i.test(value)) return 'null'
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return 'number'
    if (/^[\[{]|[\]}]$/.test(value) || /^[-*]\s/.test(value) || /\n/.test(value)) return 'collection'
    return 'string'
}

function unwrapYamlScalar(value: string): string {
    const trimmed = value.trim()
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
            return JSON.parse(trimmed) as string
        } catch {
            return trimmed.slice(1, -1)
        }
    }
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/''/g, "'")
    }
    return trimmed
}

function normalizeBlockScalar(lines: string[], folded: boolean): string {
    const nonEmptyIndents = lines
        .filter((line) => line.trim())
        .map((line) => line.match(/^\s*/)?.[0].length || 0)
    const indentation = nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : 0
    const normalized = lines.map((line) => line.slice(Math.min(indentation, line.length)).trimEnd())
    if (!folded) return normalized.join('\n').trim()

    const paragraphs: string[] = []
    let paragraph: string[] = []
    const flush = () => {
        if (paragraph.length === 0) return
        paragraphs.push(paragraph.map((line) => line.trim()).filter(Boolean).join(' '))
        paragraph = []
    }
    for (const line of normalized) {
        if (!line.trim()) flush()
        else paragraph.push(line)
    }
    flush()
    return paragraphs.join('\n\n').trim()
}

function parseFrontmatter(source: string): AssistantSkillFrontmatterEntry[] {
    const lines = source.split('\n')
    const entries: AssistantSkillFrontmatterEntry[] = []
    for (let index = 0; index < lines.length;) {
        const line = lines[index] || ''
        if (!line.trim() || /^\s*#/.test(line)) {
            index += 1
            continue
        }
        const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
        if (!match) {
            entries.push({ key: '', value: line.trim(), valueKind: 'collection' })
            index += 1
            continue
        }

        const key = match[1] || ''
        const rawValue = match[2] || ''
        const isBlockScalar = /^[>|][+-]?$/.test(rawValue.trim())
        if (!isBlockScalar && rawValue.trim()) {
            const value = unwrapYamlScalar(rawValue)
            entries.push({ key, value, valueKind: classifyYamlValue(value) })
            index += 1
            continue
        }

        const nestedLines: string[] = []
        index += 1
        while (index < lines.length) {
            const nestedLine = lines[index] || ''
            if (nestedLine.trim() && !/^\s/.test(nestedLine) && /^[A-Za-z0-9_.-]+:/.test(nestedLine)) break
            nestedLines.push(nestedLine)
            index += 1
        }
        const value = isBlockScalar
            ? normalizeBlockScalar(nestedLines, rawValue.trim().startsWith('>'))
            : normalizeBlockScalar(nestedLines, false)
        entries.push({ key, value, valueKind: isBlockScalar ? 'string' : 'collection' })
    }
    return entries
}

function emptySnapshot(body: string): AssistantSkillSnapshot {
    return {
        frontmatter: [],
        frontmatterSource: '',
        name: null,
        description: null,
        metadata: [],
        body
    }
}

export function parseAssistantSkillSnapshot(content: string): AssistantSkillSnapshot {
    const normalized = String(content || '').replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return emptySnapshot(normalized)
    const closingMatch = /\n---(?:\n|$)/.exec(normalized.slice(4))
    if (!closingMatch || closingMatch.index < 0) return emptySnapshot(normalized)
    const closingIndex = 4 + closingMatch.index

    const frontmatterSource = normalized.slice(4, closingIndex)
    const frontmatter = parseFrontmatter(frontmatterSource)
    const namedValues = new Map(frontmatter.filter((entry) => entry.key).map((entry) => [entry.key.toLowerCase(), entry.value]))
    return {
        frontmatter,
        frontmatterSource,
        name: namedValues.get('name') || null,
        description: namedValues.get('description') || null,
        metadata: frontmatter.filter((entry) => !['name', 'description'].includes(entry.key.toLowerCase())),
        body: normalized.slice(closingIndex + closingMatch[0].length).replace(/^\n+/, '')
    }
}
