import type { AssistantSession, AssistantThread } from '@shared/assistant/contracts'
import { readChatWorkContext, type WorkKind } from '@shared/assistant/work-context'

export type SidebarWorkContext = { folderPath: string | null; label: string; kind: WorkKind }

const workLabels: Record<WorkKind, string> = {
    coding: 'Code', debugging: 'Debug', research: 'Research', music: 'Music', audio: 'Audio',
    video: 'Video', design: 'Design', writing: 'Write', data: 'Data', planning: 'Plan', general: 'Chat'
}

/** Presentation only. The original folder remains the execution/artwork identity. */
export function compactWorkFolderLabel(folderPath: string): string {
    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath
    const readable = name.replace(/[-_ ](?:selected|fullres|exports?|renders?|processed|output|cache|temp)(?:[-_ ].*)?$/i, '') || name
    return readable.replace(/[-_]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ')
        .replace(/^\p{L}/u, letter => letter.toLocaleUpperCase())
}

export function resolveSidebarWorkContext(
    session: Pick<AssistantSession, 'workContext' | 'workingRoot' | 'projectPath'>,
    thread: Pick<AssistantThread, 'cwd'> | null
): SidebarWorkContext | null {
    const work = readChatWorkContext(session.workContext)
    if (!work) return null
    const folderPath = work.folderPath || thread?.cwd || session.workingRoot || session.projectPath || null
    const category = workLabels[work.kind]
    return { kind: work.kind, folderPath, label: folderPath ? `${category} · ${compactWorkFolderLabel(folderPath)}` : category }
}
