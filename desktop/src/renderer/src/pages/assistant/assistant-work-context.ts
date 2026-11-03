import type { AssistantSession, AssistantThread } from '@shared/assistant/contracts'
import { readChatWorkContext, type WorkKind } from '@shared/assistant/work-context'

export type SidebarWorkContext = { folderPath: string | null; label: string; kind: WorkKind }

const workLabels: Record<WorkKind, string> = {
    coding: 'Code', debugging: 'Debug', research: 'Research', music: 'Music', audio: 'Audio',
    video: 'Video', design: 'Design', writing: 'Write', data: 'Data', planning: 'Plan', general: 'Chat'
}

export function resolveSidebarWorkContext(
    session: Pick<AssistantSession, 'workContext' | 'workingRoot' | 'projectPath'>,
    thread: Pick<AssistantThread, 'cwd'> | null
): SidebarWorkContext | null {
    const work = readChatWorkContext(session.workContext)
    if (!work) return null
    const folderPath = work.folderPath || thread?.cwd || session.workingRoot || session.projectPath || null
    const category = workLabels[work.kind]
    // Legacy metadata cannot tell us the actual task. Keep its honest category until
    // the next substantial-work turn upgrades it, never guess from folder names.
    return { kind: work.kind, folderPath, label: work.shortName || category }
}
