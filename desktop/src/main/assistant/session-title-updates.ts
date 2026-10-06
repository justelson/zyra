// Generation stays outside this queue. Serialize only commits so a delayed
// generated-title save cannot finish after a newer manual rename.
const pendingCommits = new Map<string, Promise<unknown>>()

export async function awaitCanonicalSessionTitleSaves(saves: Iterable<Promise<unknown>>): Promise<void> {
    // Keep the commit queue occupied until every write finishes, even when one
    // fails early. Otherwise a late old save can overwrite the next title.
    const results = await Promise.allSettled(saves)
    for (const result of results) {
        if (result.status === 'rejected') throw result.reason
    }
}

export async function commitAssistantSessionTitle<T>(sessionId: string, commit: () => T | Promise<T>): Promise<T> {
    const previous = pendingCommits.get(sessionId) || Promise.resolve()
    const task = previous.catch(() => undefined).then(commit)
    pendingCommits.set(sessionId, task)
    try {
        return await task
    } finally {
        if (pendingCommits.get(sessionId) === task) pendingCommits.delete(sessionId)
    }
}
