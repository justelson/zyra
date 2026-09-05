// Isolated renderer acceptance fixture. No Electron bridge, network updater, or install.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { DevScopeUpdateActionResult, DevScopeUpdateState } from '../../src/shared/contracts/devscope-api'
import { AppUpdatesProvider, useAppUpdates } from '../../src/renderer/src/lib/app-updates'
import { AssistantSidebarFooter } from '../../src/renderer/src/pages/assistant/AssistantSidebarFooter'
import { UpdatePromptCenter } from '../../src/renderer/src/components/updates/UpdatePromptCenter'
import '../../src/renderer/src/index.css'

const initial: DevScopeUpdateState = { enabled: true, status: 'idle', currentVersion: '0.6.0', currentDisplayVersion: 'v0.6.0', channel: 'stable', repository: 'fixture', releasePageUrl: 'https://example.test/releases', disabledReason: null, availableVersion: null, availableDisplayVersion: null, downloadedVersion: null, downloadedDisplayVersion: null, downloadPercent: null, checkedAt: null, message: null, errorContext: null, canRetry: false }
let state = { ...initial }
const listeners = new Set<(state: DevScopeUpdateState) => void>()
const calls: string[] = []
let settleInitial: (() => void) | null = null
let settleDownload: (() => void) | null = null
let rejectDownload: (() => void) | null = null
let actions: ReturnType<typeof useAppUpdates> | null = null
let resetProvider: (() => void) | null = null
let failInstall = false
const emit = (patch: Partial<DevScopeUpdateState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(state) }
const result = (completed = true): DevScopeUpdateActionResult => ({ accepted: true, completed, state })
Object.defineProperty(window, 'devscope', { configurable: true, value: { updates: {
    getState: () => { const captured = { ...state }; return new Promise<DevScopeUpdateState>(resolve => { settleInitial = () => resolve(captured) }) },
    onStateChange: (listener: (state: DevScopeUpdateState) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    checkForUpdates: async () => { calls.push('check'); emit({ status: 'available', availableVersion: '0.6.1', availableDisplayVersion: 'v0.6.1' }); return result() },
    downloadUpdate: () => { calls.push('download'); const stale = { ...state }; emit({ status: 'downloading', downloadPercent: 0 }); return new Promise<DevScopeUpdateActionResult>((resolve, reject) => { settleDownload = () => { emit({ status: 'downloaded', downloadedVersion: '0.6.1', downloadedDisplayVersion: 'v0.6.1', downloadPercent: 100 }); resolve({ accepted: true, completed: true, state: stale }) }; rejectDownload = () => { emit({ status: 'available' }); reject(new Error('Synthetic transport failure')) } }) },
    installUpdate: async () => { calls.push('install'); if (failInstall) { failInstall = false; emit({ message: 'Synthetic installer failure' }); return result(false) }; return result() }
} } })
localStorage.setItem('devscope:update-success-seen:0.6.0', '1')
const fixture = { calls, emit, settleInitial: () => settleInitial?.(), finishDownload: () => settleDownload?.(), failDownload: () => rejectDownload?.(), failInstall: () => { failInstall = true }, actions: () => actions, listenerCount: () => listeners.size, reset: () => { resetProvider?.() } }
Object.assign(window, { __updateFixture: fixture })
function Probe() {
    const value = useAppUpdates()
    const location = useLocation()
    useEffect(() => { actions = value }, [value])
    return <output id="fixture-route">{location.pathname}</output>
}
function Preview() {
    const [generation, setGeneration] = useState(0)
    resetProvider = () => setGeneration(value => value + 1)
    return <AppUpdatesProvider key={generation}><MemoryRouter>
        <main style={{ padding: 24 }}><h1 style={{ fontSize: 16 }}>Update acceptance fixture</h1><Probe /></main>
        <aside id="fixture-sidebar" style={{ position: 'fixed', left: 0, bottom: 0, width: 322, padding: 12, background: 'var(--surface-sidebar)' }}><AssistantSidebarFooter agentInboxEnabled /></aside>
        <UpdatePromptCenter />
    </MemoryRouter></AppUpdatesProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
