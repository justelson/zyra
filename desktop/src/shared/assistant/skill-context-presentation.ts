import type { AssistantMessage } from './contracts'

function matchesLegacySkillExpansion(prompt: string, expansion: string): boolean {
    const invocation = prompt.trim().match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/i)
    if (!invocation) return false
    const lead = `Use the ${invocation[1]} skill for this request.\n\nSkill location: `
    if (!expansion.startsWith(lead)) return false
    const body = expansion.slice(lead.length)
    if (!/^(?:[A-Za-z]:[\\/]|\/)[^\r\n]*[\\/]SKILL\.md\r?\n\r?\n/.test(body)) return false
    const args = invocation[2]?.trim() || 'Start the skill workflow for the current request.'
    return expansion.endsWith(`\n\nUser: ${args}`)
}

/** Suppress only a native history expansion paired with the original explicit invocation. */
export function visibleSkillContextMessages(messages: AssistantMessage[]): AssistantMessage[] {
    let original: AssistantMessage | null = null
    let visible: AssistantMessage[] | null = null
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index]
        const nativeUser = message.id.startsWith('assistant-message-user-zyra-message:user:')
        if (message.role === 'user' && nativeUser && original && matchesLegacySkillExpansion(original.text, message.text)) {
            visible ||= messages.slice(0, index)
            continue
        }
        visible?.push(message)
        if (message.role === 'user') original = message
    }
    return visible || messages
}
