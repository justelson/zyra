export async function connectWithStablePluginAuthority<T>(options: {
    getGeneration: () => number
    resolve: () => Promise<T>
    connect: (resolved: T) => Promise<void>
    disconnect: (resolved: T) => void
    maxAttempts?: number
    waitForSettled?: () => Promise<void>
}): Promise<void> {
    const maxAttempts = Math.max(1, Math.min(4, Math.trunc(options.maxAttempts || 2)))
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await options.waitForSettled?.()
        const generation = options.getGeneration()
        const resolved = await options.resolve()
        if (generation !== options.getGeneration()) continue
        try {
            await options.connect(resolved)
        } catch (error) {
            if (generation === options.getGeneration()) throw error
            options.disconnect(resolved)
            continue
        }
        if (generation === options.getGeneration()) return
        options.disconnect(resolved)
    }
    throw new Error('Chat Plugin scope changed while Zyra was connecting. Try again.')
}

// Mutations are ordered; only Chats whose pinned authority can change wait/retry.
export class PluginAuthorityMutations {
    private queue: Promise<unknown> = Promise.resolve()
    private readonly generations = new Map<string, number>()
    private readonly pending = new Map<string, Promise<unknown>>()

    generation(sessionId: string): number { return this.generations.get(sessionId) || 0 }

    async wait(sessionId: string): Promise<void> {
        while (this.pending.has(sessionId)) await this.pending.get(sessionId)?.catch(() => undefined)
    }

    run<T>(sessionIds: string[], action: () => Promise<T>): Promise<T> {
        const ids = [...new Set(sessionIds)]
        for (const id of ids) this.generations.set(id, this.generation(id) + 1)
        const operation = this.queue.catch(() => undefined).then(action)
        const settled = operation.finally(() => {
            for (const id of ids) {
                this.generations.set(id, this.generation(id) + 1)
                if (this.pending.get(id) === settled) this.pending.delete(id)
            }
        })
        for (const id of ids) this.pending.set(id, settled)
        this.queue = settled.catch(() => undefined)
        return settled
    }
}
