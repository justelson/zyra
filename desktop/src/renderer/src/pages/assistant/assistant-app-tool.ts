import type { AssistantActivity } from '@shared/assistant/contracts'

const APP_TOOLS = new Set(['settings', 'settings_action', 'app', 'usage', 'context'])

export function isZyraAppToolActivity(activity: AssistantActivity): boolean {
    const payload = activity.payload || {}
    const name = String(payload.toolName || payload.tool || payload.name || '').trim().toLowerCase()
    // Match exact registered operation names, never arbitrary text in an argument.
    const tool = name.replace(/^(?:functions[.:]|zyra[.:])/, '')
    return APP_TOOLS.has(tool)
}
