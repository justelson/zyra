import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, useSettings } from '@/lib/settings'
import { AssistantComposer } from '@/pages/assistant/AssistantComposer'
import { type AssistantModelInactivityProgress } from '@/pages/assistant/AssistantModelInactivityPanel'
import type { AssistantModelInfo } from '@shared/assistant/contracts'
import { installProvidersReviewFixture } from './providers-review-fixture'
import '@/index.css'

// Real production composer and inactivity panel, with an isolated synthetic bridge.
// This page cannot ping a provider, stop a Chat or change installed preferences.
installProvidersReviewFixture()
void window.devscope.preferences.update({ patch: { theme: 'vercel', appearanceDarkTheme: 'vercel', accentColor: 'purple' } } as any)
const models: AssistantModelInfo[] = [{ id: 'openai-codex/gpt-6.1-sol', label: 'GPT-6.1 Sol', supportedEfforts: ['low', 'medium', 'high'], inputModes: ['text', 'image'] }]
function stalled(requestId: string): AssistantModelInactivityProgress {
    return { requestId, startedAt: Date.now() - 180_000, lastActivityAt: Date.now() - 125_000, phase: 'waiting', canPing: true }
}
function Preview() {
    const { settings, updateSettings } = useSettings()
    const [run, setRun] = useState(0)
    const [progress, setProgress] = useState<AssistantModelInactivityProgress | null>(() => stalled('preview-0'))
    const [working, setWorking] = useState(true)
    const [notice, setNotice] = useState('')
    const [message, setMessage] = useState('')
    function reset() { const next = run + 1; setRun(next); setProgress(stalled(`preview-${next}`)); setWorking(true); setNotice('') }
    async function stop() { setWorking(false); setProgress(null); setNotice('Stopped. Preview only.') }
    async function ping() {
        setProgress(current => current ? { ...current, phase: 'recovering', canPing: false } : null)
        setNotice('Pinged model due to suspected hang. Preview only.')
    }
    return <div className="theme-adaptive flex h-screen flex-col bg-sparkle-bg text-sparkle-text">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3 text-xs text-sparkle-text-secondary">
            <span>Composer preview <span className="ml-2 text-sparkle-text-muted">Simulated model inactivity</span></span>
            <div className="flex items-center gap-3">
                <button className="rounded-md px-2 py-1 hover:bg-white/5" onClick={() => updateSettings({ appearanceThemeMode: settings.appearanceThemeMode === 'light' ? 'dark' : 'light' })}>{settings.appearanceThemeMode === 'light' ? 'Dark' : 'Light'}</button>
                <button className="rounded-md px-2 py-1 hover:bg-white/5" onClick={reset}>Reset preview</button>
            </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-12 sm:px-8">
            <div className="mx-auto w-full max-w-[760px] flex-1 pb-10">
                <p className="text-sm leading-6 text-sparkle-text-secondary">I’ll check the runtime and preserve the completed work.</p>
                {notice ? <p role="status" className="mt-6 text-xs text-sparkle-text-muted">{notice}</p> : null}
                {message ? <p className="mt-6 text-sm">{message}</p> : null}
            </div>
            <div className="mx-auto w-full max-w-[760px]" data-assistant-composer-hitbox="true">
                <AssistantComposer sessionId="model-ping-preview" placement="bottom"
                    modelInactivity={{ progress, turnId: working ? 'preview-turn' : null, onPing: ping, onStop: stop }}
                    onSend={async prompt => { setMessage(prompt); return true }} onStop={stop}
                    disabled={false} isSending={false} isThinking={working} isConnected
                    activeModel="openai-codex/gpt-6.1-sol" activeEffort="high" modelOptions={models}
                    activeProfile="yolo-fast" runtimeMode="full-access" interactionMode="default"
                    acceptBrowserAnnotations={false}/>
            </div>
        </main>
    </div>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><SettingsProvider><Preview/></SettingsProvider></MemoryRouter>)
