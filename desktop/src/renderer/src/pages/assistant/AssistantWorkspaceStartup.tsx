import type { ReactNode } from 'react'

export function AssistantWorkspaceStartup({ ready, error, onRetry, loadingFallback, children }: {
    ready: boolean
    error: string | null
    onRetry: () => void
    loadingFallback: ReactNode
    children: ReactNode
}) {
    if (ready) return <>{children}</>
    if (!error) return <>{loadingFallback}</>
    return <section className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <h1 className="text-base font-medium">Could not open your chats</h1>
        <p className="max-w-md text-sm text-sparkle-text-secondary">Your saved chats are still on this device. Try opening the workspace again.</p>
        <button type="button" onClick={onRetry} className="rounded-md bg-[var(--accent-primary)] px-4 py-2 text-sm text-[var(--accent-on-primary)]">Try again</button>
    </section>
}
