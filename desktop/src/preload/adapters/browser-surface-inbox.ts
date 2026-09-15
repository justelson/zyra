// Preload lives longer than the Assistant route. Preserve requests during a
// React mount gap; the host's acknowledgement deadline remains authoritative.
export class BrowserSurfaceInbox<T extends { requestId: string }> {
    private readonly pending = new Map<string, T>()
    private listener: ((request: T) => void) | null = null

    constructor(private readonly limit = 8) {}

    receive(request: T): void {
        if (this.listener) { this.listener(request); return }
        this.pending.set(request.requestId, request)
        while (this.pending.size > this.limit) this.pending.delete(this.pending.keys().next().value!)
    }

    cancel(requestId: string): void { this.pending.delete(requestId) }

    subscribe(listener: (request: T) => void): () => void {
        this.listener = listener
        const pending = [...this.pending.values()]
        this.pending.clear()
        for (const request of pending) listener(request)
        return () => { if (this.listener === listener) this.listener = null }
    }
}
