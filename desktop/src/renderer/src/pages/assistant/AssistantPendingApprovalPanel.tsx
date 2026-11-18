import { memo } from 'react'
import type { AssistantApprovalDecision, AssistantPendingApproval } from '@shared/assistant/contracts'
import { getApprovalPresentation } from './assistant-approval-presentation'
import { AssistantComposerAttentionShelf } from './AssistantComposerAttentionShelf'
import { AssistantPermissionQuestion } from './AssistantPermissionQuestion'

export const AssistantPendingApprovalPanel = memo(function AssistantPendingApprovalPanel(props: {
    pendingApprovals: AssistantPendingApproval[]
    responding: boolean
    onRespond: (requestId: string, decision: AssistantApprovalDecision) => Promise<void> | void
}) {
    const pending = props.pendingApprovals.filter(entry => entry.status === 'pending')
    const approval = pending[0]
    if (!approval) return null
    const presentation = getApprovalPresentation(approval)
    const choices = [
        { label: 'Deny', description: 'Leave this action unexecuted.', decision: 'decline' },
        { label: 'Allow once', description: 'Run this action once.', decision: 'acceptOnce' }
    ] as { label: string; description: string; decision: AssistantApprovalDecision }[]
    if (presentation.grantLabel !== 'This exact app operation only') choices.push({ label: 'Allow for this chat', description: presentation.grantLabel, decision: 'acceptForSession' })
    return <AssistantComposerAttentionShelf title="Permissions"><AssistantPermissionQuestion key={approval.requestId} title={presentation.title} busy={props.responding}
        details={[presentation.command, ...presentation.paths.map(path => path.path), presentation.detail].filter(Boolean).join('\n')}
        choices={choices} onAnswer={label => {
            const choice = choices.find(option => option.label === label)
            if (choice) return props.onRespond(approval.requestId, choice.decision)
        }} /></AssistantComposerAttentionShelf>
})
