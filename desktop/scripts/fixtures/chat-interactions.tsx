import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import { AssistantConversationComposerPane } from '../../src/renderer/src/pages/assistant/AssistantConversationComposerPane'
import type { AssistantPendingApproval, AssistantPendingUserInput } from '../../src/shared/assistant/contracts'

export const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
export const sleep = () => new Promise(resolve => setTimeout(resolve, 35))
export const wait = async (test: () => boolean, message: string) => {
    const deadline = Date.now() + 4000
    while (!test() && Date.now() < deadline) await sleep()
    check(test(), message)
}
export const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label || node.title === label)
export const click = async (label: string) => { const target = button(label); check(target && !target.disabled, `Missing/enabled control: ${label}`); target!.click(); await sleep() }
export const editor = () => document.querySelector<HTMLElement>('[data-composer-text-input]')
export const answer = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your answer"]')
export const typeMessage = async (text: string) => {
    const node = editor()!; check(node, 'Message editor exists'); node.textContent = text; node.dispatchEvent(new Event('input', { bubbles: true })); await sleep()
}
export const typeAnswer = async (text: string) => {
    const node = answer()!; check(node, 'Answer editor exists')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true })); await sleep()
}
export const request = (requestId: string, mode: 'async' | 'blocking' = 'async'): AssistantPendingUserInput => ({
    id: requestId, requestId, mode, status: 'pending', answers: null, turnId: 'turn', responseMessageId: null,
    createdAt: '2026-09-17T00:00:00Z', resolvedAt: null,
    questions: [{ id: 'target', header: 'Target', question: 'Which target should I use?', type: 'text', options: [], required: true, allowOther: false }],
})
export const approval: AssistantPendingApproval = {
    id: 'approval', requestId: 'permission', requestType: 'command', title: 'Command approval', command: 'Write-Output "exact target"',
    grantLabel: 'Allow shell commands for this chat', status: 'pending', decision: null, turnId: 'turn', createdAt: '2026-09-17T00:00:00Z', resolvedAt: null,
}
export function createPaneFixture() {
    const root = createRoot(document.getElementById('root')!)
    const sends: string[] = [], responses: Array<{ id: string; answers: unknown; files: unknown }> = [], dismissals: string[] = [], decisions: Array<{ id: string; decision: string }> = []
    const blockedSends: string[] = []
    let rejectAnswer = false, rejectDismiss = false
    const props: ComponentProps<typeof AssistantConversationComposerPane> = {
        placement: 'bottom', pendingPlaygroundLabRequest: null, pendingApprovals: [], pendingControlActions: [], pendingControlGrants: [], controlTargets: [], pendingUserInputs: [],
        userInputResponding: false, commandPending: false, sending: false, thinking: false, queuedMessageCount: 0, queuedMessages: [],
        selectedSessionId: 'attention-chat', useSettingsDefaults: false, selectedSessionMode: 'work', assistantAvailable: true, assistantConnected: true, selectedProjectPath: null,
        availableModels: [{ id: 'fixture/model', label: 'Model', supportedEfforts: ['low', 'medium', 'high'] }], activeModel: 'fixture/model', activeFastModeEnabled: false, modelsLoading: false,
        runtimeMode: 'full-access', interactionMode: 'default', activeProfile: 'yolo-fast', zyraProfile: 'concise', onZyraProfileChange() {}, activeStatusLabel: 'Working',
        sendPrompt: async prompt => { sends.push(prompt); return true }, refreshModels() {},
        onBlockedSend: message => { blockedSends.push(message) },
        onHoldQueue: () => { props.queueHeld = true; render() },
        onUpdateQueuedMessage: async (id, prompt) => { props.queuedMessages = props.queuedMessages.map(message => message.id === id ? { ...message, prompt } : message); render(); return true },
        respondApproval: async (id, decision) => { decisions.push({ id, decision }) },
        respondUserInput: async (id, answers, files) => {
            if (rejectAnswer) throw new Error('Fixture answer failed')
            responses.push({ id, answers, files })
            props.pendingUserInputs = props.pendingUserInputs.filter(entry => entry.requestId !== id)
            render()
        },
        onDismissUserInput: async id => {
            if (rejectDismiss) throw new Error('Fixture dismiss failed')
            dismissals.push(id); props.pendingUserInputs = props.pendingUserInputs.filter(entry => entry.requestId !== id); render()
        },
        setPlaygroundTerminalAccess() {}, setPlaygroundTerminalAccessRequestMuted() {}, approvePendingPlaygroundLabRequest: async () => {}, declinePendingPlaygroundLabRequest: async () => {},
    }
    const render = (patch: Partial<typeof props> = {}) => {
        Object.assign(props, patch)
        flushSync(() => root.render(<MemoryRouter><div style={{ position: 'relative', height: '100%' }}><AssistantConversationComposerPane {...props} /></div></MemoryRouter>))
    }
    return { props, render, sends, responses, dismissals, decisions, blockedSends, rejectAnswer(value: boolean) { rejectAnswer = value }, rejectDismiss(value: boolean) { rejectDismiss = value }, unmount() { flushSync(() => root.unmount()) } }
}
