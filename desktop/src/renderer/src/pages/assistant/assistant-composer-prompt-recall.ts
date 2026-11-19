import type { AssistantHistoryPage } from '@shared/assistant/contracts'
import { stripSidebarBrowserContext } from '@shared/assistant/browser-context'
import { parseSerializedAssistantMessage } from '@shared/assistant/message-attachments'
import { visibleSkillContextMessages } from '@shared/assistant/skill-context-presentation'

type Page = Pick<AssistantHistoryPage, 'messages' | 'pageInfo'>
type RecallSession = {
    draft: string
    index: number
    prompts: string[]
    ids: Set<string>
    before: string | null
    hasOlder: boolean
    work: Promise<void>
}

// Read older turns only when the user reaches them. Keep paging independent of the visible timeline.
export function createComposerPromptRecall(readPage?: (before: string | null) => Promise<Page>) {
    let session: RecallSession | null = null
    const cancel = () => { session = null }
    return {
        get active() { return session !== null },
        cancel,
        move(direction: 'older' | 'newer', draft: string, local: string[], show: (text: string) => void, report?: (message: string) => void) {
            if (!session && direction === 'newer') return
            const current: RecallSession = session ??= {
                draft,
                index: -1,
                prompts: readPage ? [] : local.slice().reverse(),
                ids: new Set<string>(),
                before: null,
                hasOlder: Boolean(readPage),
                work: Promise.resolve()
            }
            current.work = current.work.then(async () => {
                if (session !== current) return
                if (direction === 'newer') {
                    if (current.index > 0) {
                        current.index -= 1
                        show(current.prompts[current.index])
                    } else {
                        cancel()
                        show(current.draft)
                    }
                    return
                }
                while (current.index + 1 >= current.prompts.length && current.hasOlder && readPage) {
                    const page = await readPage(current.before)
                    if (session !== current) return
                    for (const message of visibleSkillContextMessages(page.messages).slice().reverse()) {
                        if (message.role !== 'user' || current.ids.has(message.id)) continue
                        current.ids.add(message.id)
                        const prompt = parseSerializedAssistantMessage(stripSidebarBrowserContext(message.text)).body
                        if (prompt.trim()) current.prompts.push(prompt)
                    }
                    const cursor = page.pageInfo.oldestCursor
                    current.hasOlder = page.pageInfo.hasOlder && Boolean(cursor) && cursor !== current.before
                    current.before = cursor
                }
                if (!current.prompts.length) {
                    cancel()
                    return
                }
                current.index = (current.index + 1) % current.prompts.length
                show(current.prompts[current.index])
            }).catch(error => {
                if (session !== current) return
                cancel()
                report?.(error instanceof Error ? error.message : 'Could not read prompt history.')
            })
            return current.work
        }
    }
}
