import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantPendingApprovalPanel } from '../src/renderer/src/pages/assistant/AssistantPendingApprovalPanel'
import type { AssistantPendingApproval } from '../src/shared/assistant/contracts'

const approval: AssistantPendingApproval = {
    id: 'approval-fixture', requestId: 'request-fixture', requestType: 'command',
    title: 'Command approval', command: 'Get-ChildItem .', status: 'pending', decision: null,
    turnId: 'turn-fixture', createdAt: '2026-09-01T00:00:00.000Z', resolvedAt: null
}
const onRespond = () => { throw Error('Rendering a prompt must never approve an action') }
const render = (pendingApprovals: AssistantPendingApproval[], responding = false) => renderToStaticMarkup(
    <AssistantPendingApprovalPanel pendingApprovals={pendingApprovals} responding={responding} onRespond={onRespond} />
)
assert.equal(render([]), '', 'no prompt without a pending request')
const html = render([approval])
assert.ok(html.includes(approval.command!))
assert.ok(html.includes('Deny'))
assert.ok(html.includes('Allow once'))
assert.ok(!html.includes('request-fixture'), 'internal request IDs are not visible copy')
const busy = render([approval], true)
const buttons = busy.match(/<button\b[^>]*>/g) || []
assert.ok(buttons.length >= 2)
assert.ok(buttons.every(button => button.includes('disabled')), 'duplicate clicks are disabled while responding')
assert.equal(approval.status, 'pending', 'rendering cannot mutate the pending decision')
console.log('Tool approval panel: exact command, no implicit approval, empty state and disabled response controls: ok')

assert.ok(html.includes('This action has not run.'))
assert.ok(busy.includes('Saving your choice'))
assert.equal(render([{ ...approval, status: 'resolved' }]), '', 'resolved requests cannot reopen an approval prompt')
assert.ok(render([{ ...approval, grantLabel: 'Allow shell commands for this chat' }]).includes('Allow shell commands for this chat'), 'prompt preserves the exact permission scope')
