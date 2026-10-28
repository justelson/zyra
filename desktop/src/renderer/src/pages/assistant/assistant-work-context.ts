import type { AssistantSession, AssistantThread } from '@shared/assistant/contracts'
import { readChatWorkContext, type WorkKind } from '@shared/assistant/work-context'

export type SidebarWorkContext = { folderPath: string | null; label: string; kind: WorkKind }

export function resolveSidebarWorkContext(
    session: Pick<AssistantSession, 'workContext' | 'workingRoot' | 'projectPath'>,
    thread: Pick<AssistantThread, 'cwd'> | null
): SidebarWorkContext | null {
    const work = readChatWorkContext(session.workContext)
    if (!work) return null
    const folderPath = work.folderPath || thread?.cwd || session.workingRoot || session.projectPath || null
    return { kind: work.kind, folderPath, label: folderPath?.split(/[\\/]/).filter(Boolean).pop() || folderPath || 'Chat' }
}
