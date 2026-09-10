type AccountOverviewPollingOptions<Timer> = {
    refresh: (forceRefresh: boolean) => Promise<void>
    isVisible: () => boolean
    intervalMs: number
    setTimer: (callback: () => void, delayMs: number) => Timer
    clearTimer: (timer: Timer) => void
}

// One poller belongs to one mounted Account page, including its pending refresh.
export function startAccountOverviewPolling<Timer>(options: AccountOverviewPollingOptions<Timer>) {
    let disposed = false
    let timer: Timer | null = null
    let pending: Promise<void> | null = null
    const clearTimer = () => {
        if (timer !== null) options.clearTimer(timer)
        timer = null
    }
    const schedule = () => {
        clearTimer()
        if (disposed) return
        timer = options.setTimer(() => {
            timer = null
            if (disposed) return
            if (options.isVisible()) void refresh(true)
            else schedule()
        }, options.intervalMs)
    }
    const refresh = (forceRefresh: boolean): Promise<void> => {
        if (disposed) return Promise.resolve()
        if (pending) return pending
        clearTimer()
        pending = Promise.resolve()
            .then(() => { if (!disposed) return options.refresh(forceRefresh) })
            .catch(() => undefined) // The page's refresh owns its error presentation.
            .finally(() => { pending = null; schedule() })
        return pending
    }
    void refresh(false)
    return {
        refreshIfVisible: () => { if (!disposed && options.isVisible()) void refresh(false) },
        dispose: () => { disposed = true; clearTimer() }
    }
}
