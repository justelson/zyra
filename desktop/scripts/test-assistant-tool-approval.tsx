import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantPendingApprovalPanel } from '../src/renderer/src/pages/assistant/AssistantPendingApprovalPanel'
import { AssistantAsyncQuestionCard } from '../src/renderer/src/pages/assistant/AssistantAsyncQuestionCard'
import type { AssistantPendingApproval, AssistantPendingUserInput } from '../src/shared/assistant/contracts'

const approval: AssistantPendingApproval = {
    id: 'fixture', requestId: 'exact-request', requestType: 'command', title: 'Command approval', command: 'Write-Output "review first"',
    grantLabel: 'Allow shell commands for this chat', status: 'pending', decision: null, turnId: 'turn', createdAt: '2026-09-17T00:00:00Z', resolvedAt: null,
}
const neverRespond = () => { throw new Error('Rendering must not decide a request') }
const render = (pendingApprovals: AssistantPendingApproval[], responding = false) => renderToStaticMarkup(<AssistantPendingApprovalPanel pendingApprovals={pendingApprovals} responding={responding} onRespond={neverRespond} />)
const html = render([approval])
assert.match(html, /data-assistant-attention-shelf="true"/)
assert.match(html, /data-composer-drawer="true"/)
assert.match(html, /data-permission-tray="true"/)
assert.match(html, /This action has not run/)
assert.match(html, /Allow once/)
assert.match(html, /Deny/)
assert.match(html, /Other approval options/)
assert.doesNotMatch(html, /rounded-xl[^>]*bg-sparkle-card/, 'Permission has no independent house-card shell')
assert.equal(render([]), '')
assert.equal(render([{ ...approval, status: 'resolved' }]), '')
const busy = render([approval], true)
assert.ok((busy.match(/<button\b[^>]*>/g) || []).every(button => button.includes('disabled')))
assert.match(render([approval, { ...approval, requestId: 'next' }]), /1 of 2/)
assert.equal(approval.decision, null)
const request = { id: 'question', requestId: 'question', mode: 'async', status: 'pending', questions: [{ id: 'q', header: 'Target', question: 'Which target?', type: 'text', options: [], required: true, allowOther: false }], answers: null, turnId: 'turn', createdAt: approval.createdAt, resolvedAt: null, responseMessageId: null } as AssistantPendingUserInput
const collapsed = renderToStaticMarkup(<AssistantAsyncQuestionCard pendingUserInputs={[request]} responding={false} onRespond={neverRespond} sessionId="chat" assistantAvailable assistantConnected selectedProjectPath={null} availableModels={[]} activeModel={undefined} modelsLoading={false} runtimeMode="full-access" interactionMode="default" activeProfile="yolo-fast" activeStatusLabel="Working" agentWorking />)
assert.match(collapsed, /data-composer-drawer="true"/)
assert.match(collapsed, /Agent is continuing/)
assert.match(collapsed, /Answer agent question/)
assert.doesNotMatch(collapsed, /textarea|data-question-composer|autofocus/i, 'Async arrival cannot mount/focus a second composer')
console.log('Permission drawer and non-focusing async arrival SSR: passed')
