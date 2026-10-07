export type ProviderAddKind = 'openai-codex' | 'openai' | 'opencode' | 'opencode-harness' | 'anthropic' | 'custom'
export type ProviderAddChoice = { id: ProviderAddKind; label: string; description: string }

const choices: readonly ProviderAddChoice[] = [
    { id: 'openai-codex', label: 'ChatGPT subscription', description: 'Sign in with your ChatGPT account.' },
    { id: 'openai', label: 'OpenAI API', description: 'Verify and save an OpenAI API key.' },
    { id: 'opencode', label: 'OpenCode Zen', description: 'Connect with a Zen API key.' },
    { id: 'opencode-harness', label: 'OpenCode harness', description: 'Use your installed OpenCode login. No API key.' },
    { id: 'anthropic', label: 'Claude API', description: 'Connect with an Anthropic API key.' },
    { id: 'custom', label: 'Custom endpoint', description: 'Add a compatible provider and model.' }
]

export function availableProviderAddChoices(existing: readonly string[], chatGptConfigured: boolean, openAiConfigured: boolean): ProviderAddChoice[] {
    return choices.filter(choice => {
        if (choice.id === 'custom') return true
        if (choice.id === 'openai-codex') return true
        if (choice.id === 'openai') return !openAiConfigured
        return !existing.includes(choice.id)
    }).map(choice => choice.id === 'openai-codex' && chatGptConfigured ? { ...choice, description: 'Sign in with another ChatGPT account.' } : choice)
}

export type ProviderAddGroupId = 'openai' | 'opencode'
export type ProviderAddGroup = { id: ProviderAddGroupId; label: string; description: string; children: readonly ProviderAddKind[] }

export const PROVIDER_ADD_GROUPS: readonly ProviderAddGroup[] = [
    { id: 'openai', label: 'OpenAI', description: 'ChatGPT subscription or API key.', children: ['openai-codex', 'openai'] },
    { id: 'opencode', label: 'OpenCode', description: 'Zen API key or installed harness.', children: ['opencode', 'opencode-harness'] }
]

export type ProviderAddRow =
    | { kind: 'group'; group: ProviderAddGroup; choices: ProviderAddChoice[] }
    | { kind: 'leaf'; choice: ProviderAddChoice }

/** Folds flat choices into top-level rows. A group with a single visible
 * child collapses to that leaf so drilling never leads to a one-item page. */
export function groupProviderAddChoices(available: readonly ProviderAddChoice[]): ProviderAddRow[] {
    const remaining = new Map(available.map(choice => [choice.id, choice] as const))
    const rows: ProviderAddRow[] = []
    for (const group of PROVIDER_ADD_GROUPS) {
        const visible = group.children.map(id => remaining.get(id)).filter((choice): choice is ProviderAddChoice => Boolean(choice))
        for (const choice of visible) remaining.delete(choice.id)
        if (visible.length > 1) rows.push({ kind: 'group', group, choices: visible })
        else if (visible.length === 1) rows.push({ kind: 'leaf', choice: visible[0]! })
    }
    for (const choice of available) {
        if (remaining.has(choice.id)) rows.push({ kind: 'leaf', choice })
    }
    return rows
}
