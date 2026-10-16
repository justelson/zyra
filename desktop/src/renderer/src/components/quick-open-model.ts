export type QuickOpenFile = { path: string; name: string; line?: number; text?: string }

export function parseQuickOpenQuery(value: string): { term: string; line?: number } {
    const match = /^(.*?):([1-9]\d*)$/.exec(value.trim())
    return match ? { term: match[1], line: Math.min(1_000_000, Number(match[2])) } : { term: value.trim() }
}

export function quickOpenRecentKey(root: string): string {
    const normalized = root.replace(/\\/g, '/').replace(/\/$/, '')
    return `zyra:quick-open:${/^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized}`
}

export function rankQuickOpenFiles(files: QuickOpenFile[], recent: string[], term: string): QuickOpenFile[] {
    const needle = term.toLocaleLowerCase()
    const score = (file: QuickOpenFile) => {
        const recentIndex = recent.indexOf(file.path)
        return (file.name.toLocaleLowerCase() === needle ? 1000 : file.name.toLocaleLowerCase().startsWith(needle) ? 500 : 0)
            + (recentIndex >= 0 ? 100 - recentIndex : 0)
    }
    return [...files].sort((left, right) => score(right) - score(left) || left.name.localeCompare(right.name))
}
