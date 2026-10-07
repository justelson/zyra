import { getSelectedSession, getActiveThread } from './service-state'
import type { AssistantServiceActionDeps } from './service-action-deps'

type StartupSelectionDeps = Pick<AssistantServiceActionDeps, 'getSnapshot' | 'appendEvent' | 'createSession'>

/** Bootstrap owns the initial selection; concurrent windows share one draft. */
export class AssistantStartupSelection {
    private pending: Promise<void> | null = null

    ensure(deps: StartupSelectionDeps): Promise<void> {
        if (this.pending) return this.pending
        this.pending = this.restore(deps).finally(() => { this.pending = null })
        return this.pending
    }

    private async restore(deps: StartupSelectionDeps): Promise<void> {
        const snapshot = deps.getSnapshot()
        const selected = getSelectedSession(snapshot)
        if (getActiveThread(selected)) return

        const candidate = selected?.threads.length ? selected : snapshot.sessions.reduce<NonNullable<typeof selected> | undefined>((latest, session) => {
            if (session.archived || !session.threads.length) return latest
            return !latest || session.updatedAt.localeCompare(latest.updatedAt) > 0 ? session : latest
        }, undefined)
        if (!candidate) {
            await deps.createSession({ mode: 'work' })
            return
        }
        const threadId = candidate.threads.find(thread => thread.id === candidate.activeThreadId)?.id
            || candidate.threads[0]!.id
        const occurredAt = new Date().toISOString()
        if (candidate.activeThreadId !== threadId) {
            deps.appendEvent('session.updated', occurredAt, { sessionId: candidate.id, patch: { activeThreadId: threadId } }, candidate.id, threadId)
        }
        if (snapshot.selectedSessionId !== candidate.id) {
            deps.appendEvent('session.selected', occurredAt, { sessionId: candidate.id }, candidate.id, threadId)
        }
    }
}
