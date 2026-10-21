import { createRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { AssistantConversationComposerPane } from '../../src/renderer/src/pages/assistant/AssistantConversationComposerPane'
import { flushSync } from 'react-dom'
import { AssistantPendingUserInputPanel } from '../../src/renderer/src/pages/assistant/AssistantPendingUserInputPanel'
const root = createRoot(document.getElementById('root')!)
const sleep = () => new Promise((resolve) => setTimeout(resolve, 25))
const check = (value: unknown, label: string) => {
    if (!value) throw new Error(label)
}
const results: string[] = []
const wait = async (fn: () => boolean, label: string) => {
    const deadline = Date.now() + 3500
    while (!fn() && Date.now() < deadline) await sleep()
    check(fn(), label)
}
let questionId = 'choices',
    required = true,
    choice = true
let extraQuestions: any[] = []
let multiple = false
const responses: any[] = [],
    saved: any[] = []
let clipText = 'My own pasted explanation',
    clipImage = false
;(window as any).devscope = {
    assistant: {
        getVoiceTranscriptionState: async () => ({
            success: true,
            provider: 'codex',
            available: true,
            signedIn: true,
            status: 'ready',
        }),
        persistClipboardImage: async (input: any) => {
            saved.push(input)
            return { success: true, path: `/fixture/${input.fileName}` }
        },
        resolveClipboardAttachment: async (input: any) => {
            saved.push(input)
            return { success: true, path: '/fixture/upload.txt' }
        },
    },
}
const props = {
    responding: false,
    sessionId: 'fixture-session',
    assistantAvailable: true,
    assistantConnected: true,
    selectedProjectPath: null,
    availableModels: [{ id: 'fixture/model', label: 'Model', inputModes: ['text', 'image'], supportedEfforts: ['off', 'medium'] }],
    activeModel: 'fixture/model',
    modelsLoading: false,
    runtimeMode: 'full-access' as const,
    interactionMode: 'default' as const,
    activeProfile: 'yolo-fast' as const,
    activeStatusLabel: 'Ready',
    onRespond: async (requestId: string, answers: any, files: any) => {
        responses.push({ requestId, answers, files })
    },
}
const render = (empty = false) =>
    flushSync(() =>
        root.render(
            <AssistantPendingUserInputPanel
                key={questionId}
                {...props}
                pendingUserInputs={
                    empty
                        ? []
                        : ([
                              {
                                  requestId: questionId,
                                  status: 'pending',
                                  createdAt: new Date().toISOString(),
                                  questions: [
                                      {
                                          id: 'answer',
                                          header: 'Test',
                                          question: 'Choose or explain',
                                          type: choice
                                              ? multiple
                                                  ? 'multi_select'
                                                  : 'single_select'
                                              : 'text',
                                          options: choice
                                              ? [
                                                    { label: 'Passed', description: '' },
                                                    { label: 'Fix it', description: '' },
                                                ]
                                              : [],
                                          required,
                                          ...(multiple
                                              ? { minSelections: 2, maxSelections: 2 }
                                              : {}),
                                          allowOther: false,
                                          placeholder: 'Type another answer',
                                      },
                                      ...extraQuestions,
                                  ],
                              },
                          ] as any)
                }
            />,
        ),
    )
const button = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label || label === 'Continue' && b.textContent?.trim() === 'Submit answer',
    )!
const input = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your answer"]')!
const typeAnswer = (value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
}
const option = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]')).find(
        (node) => node.textContent?.includes(label),
    )!
const paste = () => {
    const data = new DataTransfer()
    if (clipImage) {
        data.items.add(
            new File(
                [
                    Uint8Array.from(
                        atob(
                            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=',
                        ),
                        (c) => c.charCodeAt(0),
                    ),
                ],
                'pasted-image.png',
                { type: 'image/png' },
            ),
        )
    } else data.setData('text/plain', clipText)
    input().dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    )
}
;(window as any).sidebarContinuityCheck = (async () => {
    render()
    await sleep()
    await sleep()
    check(input(), 'Custom answer is visible immediately even with allowOther false')
    check(
        !button('Type another answer') && !button('Paste'),
        'There is no third option or paste icon',
    )
    check(
        input().placeholder === 'Type another answer',
        'The supplied placeholder appears in the editor',
    )
    check(document.querySelectorAll('[role="radio"]').length === 2, 'Only supplied choices render')
    check(
        button('Attach files') && !button('Attach files').disabled,
        'Attachments are available alongside suggested choices',
    )
    check(button('Continue').disabled, 'Required choice is not silently skipped')
    option('Passed').click()
    await sleep()
    check(option('Passed').getAttribute('aria-checked') === 'true', 'Fixed choice selects normally')
    input().focus()
    await sleep()
    check(
        option('Passed').getAttribute('aria-checked') === 'true',
        'Focusing the empty editor does not clear a fixed choice',
    )
    typeAnswer('Another approach')
    await sleep()
    check(
        Array.from(document.querySelectorAll('[role="radio"]')).every(
            (node) => node.getAttribute('aria-checked') === 'false',
        ),
        'Typing replaces the single selected choice',
    )
    option('Fix it').click()
    await sleep()
    check(
        input().value === '' && option('Fix it').getAttribute('aria-checked') === 'true',
        'Choosing a fixed answer replaces custom text without hiding the editor',
    )
    paste()
    await wait(
        () => input().value === clipText,
        'Paste inserts clipboard text into a custom answer',
    )
    check(!button('Continue').disabled, 'Typed custom answer is complete')
    input().setSelectionRange(0, 2)
    const expectedPastedAnswer = clipText + clipText.slice(2)
    paste()
    await wait(
        () => input().value === expectedPastedAnswer,
        'Short paste replaces the current selection at the caret',
    )
    typeAnswer(clipText)
    await sleep()
    check(button('Continue').textContent?.trim() === 'Submit answer', 'A simple single answer submits directly without an extra review step')
    button('Continue').click()
    button('Continue').click()
    await wait(() => responses.length === 1, 'Response submits once')
    check(
        responses[0].answers.answer === clipText,
        'Custom text reaches the response callback without selecting a fixed option',
    )
    results.push('Choice escape, custom clipboard paste and required-answer guard')
    questionId = 'optional'
    required = false
    choice = false
    render()
    await sleep()
    await sleep()
    check(
        Array.from(document.querySelectorAll('button')).filter(
            (b) => b.textContent?.trim() === 'Skip',
        ).length === 1,
        'Exactly one primary Skip button exists for an empty optional answer',
    )
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(input(), 'A comment')
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await sleep()
    check(
        button('Continue') && !button('Skip'),
        'The same primary action becomes Continue when text is entered',
    )
    setter.call(input(), '')
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await sleep()
    button('Skip').click()
    await wait(() => responses.length === 2, 'A single optional question skips directly with explicit empty-answer semantics')
    check(
        responses[1].answers.answer === '',
        'Skipping is explicit and preserves empty-answer semantics',
    )
    results.push('Direct single-answer submission, one Skip action and explicit empty optional answers')
    questionId = 'files'
    required = true
    choice = false
    render()
    await sleep()
    await sleep()
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const files = new DataTransfer()
    files.items.add(
        new File(['Complete supporting notes'], 'notes.txt', {
            type: 'text/plain',
        }),
    )
    Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: files.files,
    })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(
        () => document.body.textContent!.includes('notes.txt'),
        'A selected file appears on the attachment shelf',
    )
    clipImage = true
    paste()
    await wait(
        () => Boolean(document.querySelector('[aria-label="Open preview for pasted-image.png"]')),
        'Clipboard image becomes an attachment',
    )
    const pills = Array.from(
        document.querySelectorAll<HTMLElement>('[data-composer-attachment-pill]'),
    )
    check(
        pills.length === 2 &&
            pills.every(
                (pill) => pill.getBoundingClientRect().height <= 30 && !pill.querySelector('pre'),
            ),
        'Files and images use small single-row pills, not full previews',
    )
    check(
        pills.every((pill) => pill.getBoundingClientRect().width <= 226),
        'Attachment pills remain bounded',
    )
    await wait(
        () =>
            !button('Open preview for notes.txt').disabled &&
            !button('Open preview for pasted-image.png').disabled,
        'Attachment entry animation finishes before opening a pill',
    )
    button('Open preview for notes.txt').click()
    await wait(
        () => (window as any).fixtureAttachmentPreview?.content === 'Complete supporting notes',
        'Text pill opens the full existing attachment preview',
    )
    button('Open preview for pasted-image.png').click()
    await wait(
        () => (window as any).fixtureAttachmentPreview?.kind === 'image',
        'Image pill opens the existing preview without dropping its image path',
    )
    check(
        saved.some((x) => x.dataUrl?.startsWith('data:image/png;base64,')),
        'Pasted image persists through the existing image API',
    )
    button('Continue').click()
    await wait(() => Boolean(button('Submit')), 'File-only answer reaches review')
    const removalButtons = () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((item) =>
            item.getAttribute('aria-label')?.startsWith('Remove '),
        )
    await wait(
        () => removalButtons().length === 2 && removalButtons().every((item) => !item.disabled),
        'Attachment entry animation finishes before removal',
    )
    for (const remove of removalButtons()) remove.click()
    await wait(
        () => button('Submit')?.disabled === true,
        'Removing all evidence invalidates the required file-only answer',
    )
    button('Submit').click()
    await sleep()
    check(responses.length === 2, 'An answer claiming missing attachments cannot submit')
    button('Back').click()
    await wait(() => Boolean(input()), 'Missing required answer can be edited')
    check(input().value === '', 'The orphaned file-only caption is not presented as typed text')
    Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: files.files,
    })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(() => document.body.textContent!.includes('notes.txt'), 'Evidence can be restored')
    paste()
    await wait(
        () => Boolean(document.querySelector('[aria-label="Open preview for pasted-image.png"]')),
        'Image evidence can be restored',
    )
    button('Continue').click()
    await wait(
        () => button('Submit')?.disabled === false,
        'Restoring evidence validates the attachment-only answer',
    )
    button('Submit').click()
    await wait(() => responses.length === 3, 'Attachments submit')
    check(
        responses[2].files.length === 2 &&
            responses[2].files.some((f: any) => f.content === 'Complete supporting notes'),
        'Complete file content and image path accompany the answer',
    )
    results.push('File picker, clipboard image, attachment shelf and file-only response')
    questionId = 'optional-after-evidence'
    extraQuestions = [
        {
            id: 'optional',
            header: 'Optional',
            question: 'Anything else?',
            type: 'single_select',
            options: [{ label: 'One' }, { label: 'Two' }],
            required: false,
            allowOther: false,
        },
    ]
    render()
    await sleep()
    await sleep()
    const multiFileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(multiFileInput, 'files', { configurable: true, value: files.files })
    multiFileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(
        () => document.body.textContent!.includes('notes.txt'),
        'Evidence attaches to the first question',
    )
    button('Continue').click()
    await wait(
        () => Boolean(button('Skip')),
        'An unrelated empty optional question remains skippable with request-wide evidence',
    )
    check(
        !button('Continue'),
        'Earlier evidence does not force a file-only caption for the optional answer',
    )
    button('Skip').click()
    await wait(() => Boolean(button('Submit')), 'Optional skip reaches review')
    button('Submit').click()
    await wait(() => responses.length === 4, 'Multi-question response submits once')
    check(
        responses[3].answers.optional === '' && responses[3].files.length === 1,
        'Optional answer remains explicitly empty while supporting files survive',
    )
    results.push('Optional questions remain skippable after another answer attaches evidence')
    extraQuestions = []
    questionId = 'multiple-custom'
    choice = true
    multiple = true
    render()
    await sleep()
    await sleep()
    check(input(), 'Multi-select has an immediately available editor')
    option('Passed').click()
    await sleep()
    check(button('Continue').disabled, 'Minimum selection count still applies')
    typeAnswer('My addition')
    await sleep()
    check(
        option('Passed').getAttribute('aria-checked') === 'true' && !button('Continue').disabled,
        'Typing adds to multi-select instead of replacing selected options',
    )
    typeAnswer('')
    await sleep()
    check(button('Continue').disabled, 'Clearing custom text removes only that selection')
    option('Fix it').click()
    await sleep()
    typeAnswer('Too many')
    await sleep()
    check(button('Continue').disabled, 'Custom text cannot bypass maximum selections')
    option('Fix it').click()
    await sleep()
    check(
        !button('Continue').disabled,
        'Removing one fixed option restores the valid custom combination',
    )
    button('Continue').click()
    await wait(() => Boolean(button('Submit')), 'Multi-select combination reaches review')
    button('Submit').click()
    await wait(() => responses.length === 5, 'Multi-select combination submits')
    check(
        JSON.stringify(responses[4].answers.answer) === JSON.stringify(['Passed', 'Too many']),
        'Fixed and custom multi-select answers submit together',
    )
    results.push('Direct multi-select typing preserves choices and min/max constraints')
    questionId = 'long-paste'
    multiple = false
    choice = false
    render()
    await sleep()
    await sleep()
    clipImage = false
    clipText = 'Evidence line\n'.repeat(150)
    paste()
    await wait(
        () => Boolean(document.querySelector('[data-composer-attachment-item]')),
        'Long clipboard text becomes a readable attachment',
    )
    check(input().value === '', 'Long paste does not flood the answer field')
    render(true)
    await sleep()
    render()
    await sleep()
    check(input(), 'Empty pending state restores without a hooks-order error')
    results.push('Long text paste and empty-prompt lifecycle')
    questionId = 'offline-draft'
    choice = true
    props.assistantConnected = false
    render()
    await sleep()
    await sleep()
    check(
        !input().disabled && button('Attach files').disabled,
        'Disconnected forms permit drafts but lock attachments',
    )
    clipImage = false
    clipText = 'Draft while disconnected'
    paste()
    await wait(
        () => input().value === clipText,
        'Plain text paste remains available while attachments are locked',
    )
    clipImage = true
    paste()
    await sleep()
    check(
        !document.querySelector('[data-composer-attachment-item]'),
        'Disconnected clipboard images remain blocked',
    )
    clipImage = false
    clipText = 'Long disconnected evidence\n'.repeat(150)
    paste()
    await sleep()
    check(
        input().value === 'Draft while disconnected' &&
            !document.querySelector('[data-composer-attachment-item]'),
        'Disconnected long-text attachments remain blocked without replacing the draft',
    )
    check(
        document.querySelector('[role="alert"]'),
        'Locked attachment paste explains the restriction',
    )
    props.responding = true
    render()
    await sleep()
    clipText = 'Cannot paste during Submit'
    paste()
    await sleep()
    check(
        input().disabled && input().value === 'Draft while disconnected',
        'Submission locks block paste into disabled inputs',
    )
    props.responding = false
    props.assistantConnected = true
    results.push('Disconnected plain-text drafts remain editable without permitting attachments')
    questionId = 'visual-direct-entry'
    choice = true
    render()
    await sleep()
    await sleep()
    const visibleFiles = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(visibleFiles, 'files', { configurable: true, value: files.files })
    visibleFiles.dispatchEvent(new Event('change', { bubbles: true }))
    clipImage = true
    paste()
    await wait(
        () => document.querySelectorAll('[data-composer-attachment-pill]').length === 2,
        'Both attachment types render as pills',
    )
    typeAnswer('Use my own approach')
    await new Promise((resolve) => setTimeout(resolve, 750))
    check(
        input().getBoundingClientRect().bottom <=
            document.querySelector('[data-composer-attachment-pill]')!.getBoundingClientRect().top,
        'Pills stay below the answer in the existing shelf position',
    )
    check(
        document.documentElement.scrollWidth <= window.innerWidth,
        'The question form has no horizontal overflow',
    )
    const ordinarySends: string[] = []
    const dismissed: string[] = []
    const paneRef = createRef<HTMLDivElement>()
    const asyncRequest = { id: 'async-card', requestId: 'async-card', mode: 'async', status: 'pending', createdAt: new Date().toISOString(), questions: [{ id: 'later', header: 'Later', question: 'Which target should I use later?', type: 'text', options: [], required: true }] }
    const pane = (pendingUserInputs: any[]) => flushSync(() => root.render(<MemoryRouter><div style={{ position: 'relative', height: '100%' }}><AssistantConversationComposerPane {...props as any}
        placement="bottom" paneRef={paneRef} selectedSessionId="ordinary-async-chat" selectedSessionMode="work" pendingUserInputs={pendingUserInputs}
        pendingApprovals={[]} pendingControlActions={[]} pendingControlGrants={[]} controlTargets={[]} pendingPlaygroundLabRequest={null}
        thinking sending={false} userInputResponding={false} queuedMessages={[]} queuedMessageCount={0} commandPending={false}
        refreshModels={() => {}} sendPrompt={async prompt => { ordinarySends.push(prompt); return true }} respondUserInput={props.onRespond}
        onDismissUserInput={async id => { dismissed.push(id) }} onStop={() => {}}
    /></div></MemoryRouter>))
    pane([])
    await wait(() => Boolean(document.querySelector('[data-composer-text-input]')), 'Ordinary composer mounts before answer-later question')
    const ordinary = document.querySelector<HTMLElement>('[data-composer-text-input]')!
    ordinary.focus()
    ordinary.textContent = 'Keep my ordinary draft'
    ordinary.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Keep my ordinary draft' }))
    await sleep()
    pane([asyncRequest])
    await sleep()
    check(document.querySelector('[data-composer-text-input]') === ordinary && ordinary.textContent === 'Keep my ordinary draft', 'Async arrival preserves the exact ordinary composer and its draft')
    check(document.activeElement === ordinary, 'Async arrival does not steal input focus')
    check(!document.querySelector('[data-assistant-async-question] textarea'), 'Answer-later card is compact until explicitly opened')
    button('Answer').click()
    await wait(() => Boolean(document.querySelector('[data-assistant-async-question] textarea')), 'Answer-later question opens only on intent')
    ordinary.focus()
    await sleep()
    check(document.activeElement === ordinary, 'An open async question does not reclaim focus from ordinary drafting')
    const answerCount = responses.length
    ordinary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait(() => ordinarySends.length === 1, 'Enter in the ordinary composer sends its draft, not the open async question')
    check(responses.length === answerCount, 'Normal Enter cannot accidentally submit the async question')
    button('Dismiss').click()
    await wait(() => dismissed.length === 1, 'Dismiss reaches the async request without sending an answer')
    check(responses.length === answerCount && dismissed[0] === 'async-card', 'Dismiss sends no invented answer')
    results.push('Async questions preserve normal drafts/focus, open explicitly, never hijack Enter and dismiss without an answer')
    return results
})()
