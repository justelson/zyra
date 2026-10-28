import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, useSettings } from '@/lib/settings'
import { AssistantPendingUserInputPanel } from '@/pages/assistant/AssistantPendingUserInputPanel'
import { AssistantComposer } from '@/pages/assistant/AssistantComposer'
import type { AssistantModelInfo, AssistantUserInputQuestion, AssistantUserInputAnswer } from '@shared/assistant/contracts'
import { installProvidersReviewFixture } from './providers-review-fixture'
import '@/index.css'

// Isolated synthetic bridge. This preview never contacts the user's app or providers.
installProvidersReviewFixture()
void window.devscope.preferences.update({ surface: 'browser', expectedRevision: 0, patch: { theme: 'vercel', appearanceDarkTheme: 'vercel', accentColor: 'purple', assistantTranscriptionEnabled: true, assistantTranscriptionEngine: 'codex' } })
Object.assign(window.devscope.assistant, {
    getVoiceTranscriptionState: async () => ({ success: true, available: true, signedIn: true, status: 'ready' }),
    transcribeVoice: async () => ({ success: true, text: 'A sample dictated answer.' }),
    cancelVoiceTranscription: async () => ({ success: true, cancelled: true }),
    persistClipboardImage: async (input: { dataUrl: string }) => ({ success: true, path: input.dataUrl }),
    resolveClipboardAttachment: async () => ({ success: false, error: 'Use a text file or pasted image in this preview.' }),
})
const previewModels: AssistantModelInfo[] = [{ id: 'preview/model', label: 'Preview model', supportedEfforts: ['off', 'low', 'medium', 'high'], inputModes: ['text', 'image'] }]
const questions: AssistantUserInputQuestion[] = [
    { id: 'theme', header: 'Theme', question: 'Which theme should the app use?', type: 'single_select', required: true, allowOther: true, options: [
        { label: 'System', description: 'Follow your device’s light or dark setting.', recommended: true },
        { label: 'Dark', description: 'Keep the interface dark throughout the day.' },
        { label: 'Light', description: 'Use a light background with dark text.' },
    ] },
    { id: 'controls', header: 'Controls', question: 'What would you like to improve?', type: 'multi_select', required: true, allowOther: true, options: [{ label: 'Layout', description: 'Spacing and the way questions fit into chat.' }, { label: 'Choices', description: 'Selection, descriptions and custom answers.' }, { label: 'Navigation', description: 'Moving between questions and reviewing answers.' }] },
    { id: 'notes', header: 'Feedback', question: 'What would make this easier to use?', type: 'text', required: true, allowOther: false, placeholder: 'Tell me what you would change…', options: [] },
    { id: 'rating', header: 'Rating', question: 'How does this version feel, from 1 to 10?', type: 'number', required: true, allowOther: false, min: 1, max: 10, step: 1, options: [] },
    { id: 'confirm', header: 'Confirmation', question: 'Does this layout feel clearer?', type: 'confirm', required: true, allowOther: false, options: [] },
    { id: 'date', header: 'Date', question: 'When would you like to revisit this?', type: 'date', required: false, allowOther: false, options: [] },
    { id: 'ranking', header: 'Priorities', question: 'Put these in order of importance.', type: 'ranking', required: false, allowOther: false, options: [{ label: 'Appearance', description: '' }, { label: 'Speed', description: '' }, { label: 'Clarity', description: '' }] },
    { id: 'files', header: 'Files', question: 'Which files should we update?', type: 'file_select', multiple: true, required: false, allowOther: false, options: [{ label: 'Question panel', description: 'The question, answer area and navigation.' }, { label: 'Choice controls', description: 'Radio buttons, checkboxes and ranking rows.' }] },
]
function formatPreviewAnswer(answer: AssistantUserInputAnswer | undefined): string {
    return Array.isArray(answer) ? answer.join(', ') : answer || 'Skipped'
}
function Preview() {
    const { settings, updateSettings } = useSettings()
    const [scenario, setScenario] = useState('all')
    const [run, setRun] = useState(0)
    const [message, setMessage] = useState('')
    const [submitted, setSubmitted] = useState<Record<string, AssistantUserInputAnswer> | null>(null)
    const selected = scenario === 'all' ? questions : questions.filter(q => q.id === scenario)
    return <div className="theme-adaptive flex h-screen flex-col bg-sparkle-bg text-sparkle-text">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3 text-xs text-sparkle-text-secondary">
            <span>Question composer <span className="ml-2 text-sparkle-text-muted" title="Voice preview inserts sample text without contacting a transcription provider.">Voice uses sample text</span></span>
            <div className="flex items-center gap-3">
                <select aria-label="Preview question type" className="rounded-md border border-white/10 bg-sparkle-card px-2 py-1" value={scenario} onChange={e => { setScenario(e.target.value); setRun(n => n + 1); setSubmitted(null) }}>
                    <option value="message">Message composer</option><option value="all">All question types</option>{questions.map(q => <option key={q.id} value={q.id}>{q.header}</option>)}
                </select>
                <button onClick={() => updateSettings({ appearanceThemeMode: settings.appearanceThemeMode === 'light' ? 'dark' : 'light' })} className="rounded-md px-2 py-1 hover:bg-white/5">{settings.appearanceThemeMode === 'light' ? 'Dark' : 'Light'}</button>
                <button onClick={() => { setRun(n => n + 1); setSubmitted(null) }} className="rounded-md px-2 py-1 hover:bg-white/5">Reset</button>
            </div>
        </header>
        <main className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-10 sm:px-8">
            <div className="mx-auto w-full max-w-3xl flex-1 pb-10">
                <p className="text-[14px] leading-6 text-sparkle-text-secondary">A few questions before I make the changes.</p>
                {message ? <p className="mt-6 text-sm text-sparkle-text">{message}</p> : null}
                {submitted ? <div className="mt-8 space-y-4" data-preview-submitted>{selected.map(q => <div key={q.id}><p className="text-xs text-sparkle-text-muted">{q.question}</p><p className="mt-1 whitespace-pre-wrap text-sm">{formatPreviewAnswer(submitted[q.id])}</p></div>)}</div> : null}
            </div>
            {scenario === 'message' ? <div className="mx-auto w-full max-w-3xl"><AssistantComposer sessionId="normal-composer-preview" onSend={async prompt => { setMessage(prompt); return true }} disabled={false} isSending={false} isThinking={false} isConnected activeModel="preview/model" activeEffort="medium" modelOptions={previewModels} activeProfile="yolo-fast" runtimeMode="full-access" interactionMode="default" acceptBrowserAnnotations={false} /></div> : !submitted ? <AssistantPendingUserInputPanel key={`${scenario}-${run}`} pendingUserInputs={[{ id: `preview-${scenario}-${run}`, requestId: `preview-${scenario}-${run}`, status: 'pending', createdAt: new Date().toISOString(), questions: selected } as any]} responding={false} onRespond={(_id, answers) => setSubmitted(answers)} sessionId="question-composer-preview" assistantAvailable assistantConnected selectedProjectPath={null} availableModels={previewModels} activeModel="preview/model" modelsLoading={false} runtimeMode="full-access" interactionMode="default" activeProfile="yolo-fast" activeStatusLabel="Ready" /> : <button className="mx-auto rounded-md border border-white/10 px-4 py-2 text-xs" onClick={() => { setRun(n => n + 1); setSubmitted(null) }}>Try again</button>}
        </main>
    </div>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><SettingsProvider><Preview /></SettingsProvider></MemoryRouter>)
