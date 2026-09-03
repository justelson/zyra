import type { DevScopeIndexedPathEntry } from '@shared/contracts/devscope-project-contracts'
import type { AssistantComposerProjectRoot } from './assistant-composer-types'

export type AssistantComposerIncludeToken = {
    start: number
    end: number
    query: string
}

export type AssistantComposerFileSearchItem = {
    id: string
    path: string
    name: string
    relativePath: string
    rootPath: string
    rootLabel: string
    showRootLabel: boolean
}

export function findAssistantComposerIncludeToken(text: string, cursor: number): AssistantComposerIncludeToken | null {
    const safeCursor = Math.max(0, Math.min(cursor, text.length))
    const beforeCursor = text.slice(0, safeCursor)
    const match = beforeCursor.match(/(?:^|\s)(\/include[\t ]+([^\r\n]*))$/i)
    const invocation = match?.[1]
    if (!invocation) return null
    return {
        start: safeCursor - invocation.length,
        end: safeCursor,
        query: String(match?.[2] || '').trim()
    }
}

export function removeAssistantComposerIncludeToken(
    text: string,
    token: AssistantComposerIncludeToken
): { text: string; cursor: number } {
    let before = text.slice(0, token.start)
    let after = text.slice(token.end)
    if (/\s$/.test(before) && /^\s/.test(after)) after = after.replace(/^\s/, '')
    if (!after && /[\t ]$/.test(before)) before = before.replace(/[\t ]+$/, ' ')
    return { text: `${before}${after}`, cursor: before.length }
}

export function getAssistantComposerFileOptionId(menuId: string, itemId: string): string {
    return `${menuId}-option-${itemId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

export function buildAssistantComposerFileSearchItems(
    entries: DevScopeIndexedPathEntry[],
    roots: AssistantComposerProjectRoot[]
): AssistantComposerFileSearchItem[] {
    const rootLabelCounts = new Map<string, number>()
    for (const root of roots) {
        const key = root.label.trim().toLocaleLowerCase()
        rootLabelCounts.set(key, (rootLabelCounts.get(key) || 0) + 1)
    }
    const normalizedRoots = roots.map((root) => {
        const label = root.label.trim() || basename(root.path)
        const duplicateLabel = (rootLabelCounts.get(label.toLocaleLowerCase()) || 0) > 1
        return {
            ...root,
            key: normalizePath(root.path),
            displayLabel: duplicateLabel ? `${label} · ${pathTail(root.path, 2)}` : label
        }
    })
    const rootForEntry = (entry: DevScopeIndexedPathEntry) => normalizedRoots.find((root) => root.key === normalizePath(entry.rootPath))
        || normalizedRoots.find((root) => {
            const entryPath = normalizePath(entry.path)
            return entryPath === root.key || entryPath.startsWith(`${root.key}/`)
        })
    const rootKeysByName = new Map<string, Set<string>>()
    for (const entry of entries) {
        const root = rootForEntry(entry)
        const nameKey = entry.name.toLocaleLowerCase()
        const rootsForName = rootKeysByName.get(nameKey) || new Set<string>()
        rootsForName.add(root?.key || normalizePath(entry.rootPath))
        rootKeysByName.set(nameKey, rootsForName)
    }

    return entries.map((entry) => {
        const root = rootForEntry(entry)
        return {
            id: `file:${entry.path}`,
            path: entry.path,
            name: entry.name,
            relativePath: entry.relativePath,
            rootPath: root?.path || entry.rootPath,
            rootLabel: root?.displayLabel || basename(entry.rootPath),
            showRootLabel: (rootKeysByName.get(entry.name.toLocaleLowerCase())?.size || 0) > 1
        }
    })
}

function normalizePath(pathValue: string): string {
    const normalized = String(pathValue || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLocaleLowerCase() : normalized
}

function basename(pathValue: string): string {
    return String(pathValue || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || 'Folder'
}

function pathTail(pathValue: string, segmentCount: number): string {
    return String(pathValue || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).slice(-segmentCount).join('/') || 'Folder'
}
