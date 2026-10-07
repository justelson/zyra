export type ChatAttentionNotice = {
    canonicalChatId: string
    token: string
    kind: 'completed' | 'input' | 'approval'
    turnId?: string | null
}
type Toast = { show(): void; close(): void; on(event: string, listener: (...args: any[]) => void): unknown }
type NotificationChat = {
    title: string
    archived?: boolean
    lastSeenCompletedTurnId?: string | null
    presence?: { viewers?: unknown[]; attention?: string | null; latestTurn?: { id: string; state: string } | null }
}

/** Receives live canonical edges only; catalog hydration never generates a toast. */
export class ChatNotifications {
    private readonly delivered = new Set<string>()
    private readonly active = new Map<string, { notice: ChatAttentionNotice; toast: Toast }>()
    private disposed = false
    constructor(private readonly dependencies: {
        readChat(id: string): Promise<NotificationChat | null>
        create(options: { title: string; body: string }): Toast | null
        openChat(id: string): Promise<void>
        failed(error: unknown): void
    }) {}

    async receive(notice: ChatAttentionNotice): Promise<void> {
        if (this.disposed || !notice.token || this.delivered.has(notice.token)) return
        this.delivered.add(notice.token)
        if (this.delivered.size > 2048) this.delivered.delete(this.delivered.values().next().value!)
        try {
            const chat = await this.dependencies.readChat(notice.canonicalChatId)
            if (this.disposed || !chat || !this.actionable(notice, chat)) return
            this.close(notice.canonicalChatId)
            const toast = this.dependencies.create({
                title: notice.kind === 'completed' ? 'Chat finished' : notice.kind === 'input' ? 'Input needed' : 'Approval needed',
                body: chat.title || 'Chat'
            })
            if (!toast) return
            if (this.active.size >= 32) this.close(this.active.keys().next().value!)
            this.active.set(notice.canonicalChatId, { notice, toast })
            toast.on('click', () => { this.close(notice.canonicalChatId); void this.dependencies.openChat(notice.canonicalChatId).catch(this.dependencies.failed) })
            toast.on('failed', (_event, error) => { this.dependencies.failed(error); this.close(notice.canonicalChatId) })
            toast.show()
        } catch (error) { this.dependencies.failed(error) }
    }

    async refresh(id?: string): Promise<void> {
        for (const [chatId, entry] of this.active) {
            if (id && id !== chatId) continue
            try {
                const chat = await this.dependencies.readChat(chatId)
                if (!chat || !this.actionable(entry.notice, chat)) this.close(chatId)
            } catch (error) { this.dependencies.failed(error) }
        }
    }
    dispose(): void { this.disposed = true; for (const id of this.active.keys()) this.close(id) }
    private close(id: string): void { const entry = this.active.get(id); this.active.delete(id); entry?.toast.close() }
    private actionable(notice: ChatAttentionNotice, chat: NotificationChat): boolean {
        if (chat.archived || chat.presence?.viewers?.length) return false
        if (notice.kind === 'completed') return chat.lastSeenCompletedTurnId !== notice.turnId
            && chat.presence?.latestTurn?.id === notice.turnId && chat.presence?.latestTurn?.state === 'completed'
        return notice.kind === 'input' ? ['input', 'user-input'].includes(chat.presence?.attention || '') : chat.presence?.attention === 'approval'
    }
}
