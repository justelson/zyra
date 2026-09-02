import type {
    AssistantPromptCommandResource,
    AssistantPromptResourceScope,
    AssistantPromptResourcesPayload
} from '@shared/assistant/contracts'
import { listAssistantDesktopSlashCommandResources } from './assistant-composer-utils'

export type AssistantComposerCommandItem = {
    id: string
    value: string
    label: string
    description: string
    kind: 'command' | 'skill'
    scope: AssistantPromptResourceScope
}

export type AssistantComposerSlashToken = {
    start: number
    end: number
    query: string
}

export function resolveAssistantComposerCommandMenuIndex(
    currentIndex: number,
    direction: 'ArrowDown' | 'ArrowUp',
    itemCount: number
): number {
    if (itemCount <= 0) return 0
    const normalizedIndex = Number.isFinite(currentIndex)
        ? Math.min(Math.max(Math.trunc(currentIndex), 0), itemCount - 1)
        : 0
    if (direction === 'ArrowDown') return (normalizedIndex + 1) % itemCount
    return (normalizedIndex - 1 + itemCount) % itemCount
}

export function findAssistantComposerSlashToken(text: string, cursor: number): AssistantComposerSlashToken | null {
    const safeCursor = Math.max(0, Math.min(cursor, text.length))
    const beforeCursor = text.slice(0, safeCursor)
    const leadingWhitespace = beforeCursor.match(/^\s*/)?.[0].length ?? 0
    const token = beforeCursor.slice(leadingWhitespace)
    if (!/^\/[^\s]*$/.test(token)) return null

    let end = safeCursor
    while (end < text.length && !/\s/.test(text[end])) end += 1
    return {
        start: leadingWhitespace,
        end,
        query: token.slice(1).toLowerCase()
    }
}

export function buildAssistantComposerCommandItems(
    resources: AssistantPromptResourcesPayload | null,
    query: string
): AssistantComposerCommandItem[] {
    const normalizedQuery = query.trim().toLowerCase()
    const commandsByName = new Map<string, AssistantPromptCommandResource>(listAssistantDesktopSlashCommandResources()
        .map((command) => [command.name, command]))
    for (const command of resources?.commands || []) {
        if (!commandsByName.has(command.name)) commandsByName.set(command.name, command)
    }
    const commands = [...commandsByName.values()].map((command) => ({
        id: `command:${command.scope}:${command.name}`,
        value: `/${command.name}`,
        label: `/${command.name}`,
        description: command.description,
        kind: 'command' as const,
        scope: command.scope
    }))
    const skills = (resources?.skills || []).map((skill) => ({
        id: `skill:${skill.scope}:${skill.name}`,
        value: `/skill:${skill.name}`,
        label: `/skill:${skill.name}`,
        description: skill.description,
        kind: 'skill' as const,
        scope: skill.scope
    }))

    return [...commands, ...skills]
        .filter((item) => {
            if (!normalizedQuery) return true
            const haystack = `${item.label.slice(1)} ${item.description} ${item.scope}`.toLowerCase()
            return normalizedQuery.split(/\s+/).every((part) => haystack.includes(part))
        })
        .sort((left, right) => {
            const leftPrefix = left.label.slice(1).startsWith(normalizedQuery) ? 0 : 1
            const rightPrefix = right.label.slice(1).startsWith(normalizedQuery) ? 0 : 1
            if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix
            if (left.kind !== right.kind) return left.kind === 'command' ? -1 : 1
            return left.label.localeCompare(right.label)
        })
}

export function applyAssistantComposerCommandItem(
    text: string,
    token: AssistantComposerSlashToken,
    item: AssistantComposerCommandItem
): { text: string; cursor: number } {
    const insertion = `${item.value} `
    const nextText = `${text.slice(0, token.start)}${insertion}${text.slice(token.end)}`
    return {
        text: nextText,
        cursor: token.start + insertion.length
    }
}

export function getAssistantComposerCommandOptionId(menuId: string, itemId: string): string {
    return `${menuId}-option-${itemId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

export function formatAssistantPromptResourceScope(scope: AssistantPromptResourceScope): string {
    if (scope === 'built-in') return 'Built in'
    if (scope === 'project') return 'Project'
    return 'Personal'
}
