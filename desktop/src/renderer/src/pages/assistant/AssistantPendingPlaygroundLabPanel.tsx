import { memo, useEffect, useState } from 'react'
import type { AssistantPlaygroundPendingLabRequest } from '@shared/assistant/contracts'
import { AssistantPermissionQuestion } from './AssistantPermissionQuestion'

export const AssistantPendingPlaygroundLabPanel = memo(function AssistantPendingPlaygroundLabPanel(props: {
    request: AssistantPlaygroundPendingLabRequest
    responding: boolean
    onApprove: (input: { title?: string; source: 'empty' | 'git-clone'; repoUrl?: string }) => Promise<void> | void
    onDecline: () => Promise<void> | void
}) {
    const { request, responding, onApprove, onDecline } = props
    const [title, setTitle] = useState(request.suggestedLabName || '')
    const [repoUrl, setRepoUrl] = useState(request.repoUrl || '')

    useEffect(() => {
        setTitle(request.suggestedLabName || '')
        setRepoUrl(request.repoUrl || '')
    }, [request.createdAt, request.id, request.kind, request.repoUrl, request.suggestedLabName])

    const isClone = request.kind === 'clone-repo'
    const approveLabel = isClone ? 'Clone repository' : 'Create project'
    return <AssistantPermissionQuestion key={request.id} title={isClone ? 'Clone this repository into a Playground project?' : 'Create a Playground project for this chat?'}
        busy={responding} canSubmit={label => label !== approveLabel || !isClone || Boolean(repoUrl.trim())}
        choices={[{ label: 'Decline', description: 'Keep the chat in its current folder.' },
            { label: approveLabel, description: 'Allow filesystem work in the new project folder.' }]}
        onAnswer={label => label === 'Decline' ? onDecline() : onApprove({ title: title.trim() || undefined, source: isClone ? 'git-clone' : 'empty', repoUrl: isClone ? repoUrl.trim() : undefined })}
        details={
            <div className="space-y-3">
                <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-sparkle-bg px-4 py-3 text-sm text-sparkle-text outline-none transition-all focus:border-[var(--accent-primary)]/40 focus:ring-4 focus:ring-[var(--accent-primary)]/10"
                    placeholder="Project name"
                    maxLength={120}
                />
                {isClone ? (
                    <input
                        value={repoUrl}
                        onChange={(event) => setRepoUrl(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-sparkle-bg px-4 py-3 text-sm text-sparkle-text outline-none transition-all focus:border-[var(--accent-primary)]/40 focus:ring-4 focus:ring-[var(--accent-primary)]/10"
                        placeholder="Repository URL"
                    />
                ) : null}
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-xs text-sparkle-text-muted/70">
                    {request.prompt}
                </div>
            </div>
        } />
})
