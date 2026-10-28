// Synthetic bridge only. This entry never uses the installed updater or agent.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AppUpdatesProvider, useAppUpdates } from '@/lib/app-updates'
import AboutSettings from '@/pages/settings/AboutSettings'
import { UpdateInstallConfirmation } from '@/components/updates/UpdateInstallConfirmation'
import type { AgentUpdatePlan } from '@shared/agent-update'
import type { RuntimeActivationStatus } from '@shared/runtime-activation'
import type { DevScopeUpdateState } from '@shared/contracts/devscope-api'
import '../index.css'
import './runtime-update-review.css'

const calls: string[] = []
const listeners = new Set<(state: DevScopeUpdateState) => void>()
const runtimeListeners = new Set<(state: RuntimeActivationStatus) => void>()
let scenario = new URLSearchParams(location.search).get('scenario') || 'busy'
const empty = { activeTurns: 0, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 }
let state: DevScopeUpdateState = { enabled: true, status: 'downloaded', currentVersion: '0.7.1-dev.30', currentDisplayVersion: 'v0.7.1-dev.30', channel: 'stable', repository: 'preview', releasePageUrl: 'https://example.test/releases', disabledReason: null, availableVersion: '0.8.0-dev.1', availableDisplayVersion: 'v0.8.0-dev.1', downloadedVersion: '0.8.0-dev.1', downloadedDisplayVersion: 'v0.8.0-dev.1', downloadPercent: 100, checkedAt: new Date().toISOString(), message: null, errorContext: null, canRetry: false }
let runtime: RuntimeActivationStatus = { phase: 'waiting', connection: 'connected', updatePending: true, lastConfirmedAt: new Date().toISOString(),
    installation: { kind: 'installed', label: 'Zyra Preview', appVersion: state.currentVersion }, expectedRuntimeRevision: 'b'.repeat(64),
    instance: { instanceId: 'preview-instance', namespaceId: 'preview-namespace', channel: 'desktop', protocolVersion: 5, startedAt: new Date().toISOString(), runtimeRevision: 'a'.repeat(64) }, activity: empty }
const emitRuntime = () => { runtime = { ...runtime, lastConfirmedAt: new Date().toISOString() }; runtimeListeners.forEach(listener => listener(runtime)) }
function setScenario(value: string) {
    scenario = value
    runtime = { ...runtime, connection: value === 'unknown' ? 'disconnected' : 'connected', phase: value === 'unknown' ? 'failed' : 'waiting',
        updatePending: true, instance: { ...runtime.instance!, runtimeRevision: 'a'.repeat(64) },
        activity: value === 'busy' ? { ...empty, activeTurns: 2, backgroundChats: 1, attention: 1, requests: 1, externalTools: 1 } : { ...empty } }
    emitRuntime()
}
setScenario(scenario)
let selectedPlan: AgentUpdatePlan | null = null
let showNotice: (text: string) => void = () => {}
const api = {
    updates: {
        getState: async () => state,
        onStateChange: (listener: (next: DevScopeUpdateState) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
        checkForUpdates: async () => ({ accepted: true, completed: true, state }),
        downloadUpdate: async () => ({ accepted: true, completed: true, state }),
        preflightInstall: async (): Promise<AgentUpdatePlan> => {
            calls.push('preflight'); await new Promise(resolve => setTimeout(resolve, 200))
            selectedPlan = { id: `preview-plan-${calls.length}`, version: state.downloadedVersion!, agentServerUpdate: true,
                state: scenario === 'unknown' ? 'unknown' : scenario === 'busy' ? 'blocked' : 'ready', instanceId: runtime.instance!.instanceId, namespaceId: runtime.instance!.namespaceId,
                activity: { ...runtime.activity! }, expiresAt: new Date(Date.now() + 60_000).toISOString(), message: 'The selected agent is disconnected.' }
            return selectedPlan
        },
        deferInstall: async () => { calls.push('later'); selectedPlan = null },
        installUpdate: async (input: { planId: string; stopBlockers: boolean }) => {
            if (!selectedPlan || input.planId !== selectedPlan.id || selectedPlan.state === 'unknown' || selectedPlan.state === 'blocked' && !input.stopBlockers) throw new Error('Review the agent first.')
            if (input.stopBlockers) calls.push('stop-owned-work')
            calls.push('install'); await new Promise(resolve => setTimeout(resolve, 650))
            showNotice('Simulation complete. No update was installed.')
            return { accepted: true, completed: true, state }
        }
    },
    runtimeActivation: {
        getState: async () => runtime,
        onStateChange: (listener: (next: RuntimeActivationStatus) => void) => { runtimeListeners.add(listener); return () => runtimeListeners.delete(listener) },
        refresh: async () => { emitRuntime(); return runtime },
        activateUpdate: async (input?: { expectedInstanceId: string; stopBlockers: boolean }) => {
            if (!input || input.expectedInstanceId !== runtime.instance?.instanceId) throw new Error('The agent changed.')
            if (scenario === 'busy' && !input.stopBlockers) throw new Error('Work is running.')
            if (input.stopBlockers) calls.push('stop-owned-work')
            calls.push('activate'); await new Promise(resolve => setTimeout(resolve, 600))
            runtime = { ...runtime, phase: 'ready', updatePending: false, activity: empty, instance: { ...runtime.instance!, runtimeRevision: 'b'.repeat(64) } }; emitRuntime(); return runtime
        }
    },
    window: { getRuntimeInfo: async () => ({ platform: 'win32', architecture: 'x64', appVersion: state.currentVersion, electronVersion: 'preview', isPackaged: false, nativeFrame: false, customWindowControls: true }), isMaximized: async () => false, onMaximizedChange: () => () => {} }
}
Object.defineProperty(window, 'devscope', { configurable: true, value: api })
localStorage.setItem(`devscope:update-success-seen:${state.currentVersion}`, '1')
let actions: ReturnType<typeof useAppUpdates>
function Probe() { const current = useAppUpdates(); useEffect(() => { actions = current }, [current]); return null }
function Preview() {
    const [generation, setGeneration] = useState(0)
    const [selected, setSelected] = useState(scenario)
    const [notice, setNotice] = useState('UI preview · No real updates')
    showNotice = setNotice
    return <AppUpdatesProvider key={generation}><MemoryRouter initialEntries={['/settings/about']}><Probe />
        <nav className="update-preview-toolbar" aria-label="Preview controls"><span>{notice}</span>
            <select aria-label="Agent scenario" value={selected} onChange={event => { setSelected(event.target.value); setScenario(event.target.value); setGeneration(value => value + 1) }}>
                <option value="busy">Work running</option><option value="idle">Idle</option><option value="unknown">Disconnected</option>
            </select>
            <button onClick={() => { void actions.installUpdate() }}>Preview installer</button>
            <button onClick={() => { setScenario(selected); calls.length = 0; setNotice('UI preview · No real updates'); setGeneration(value => value + 1) }}>Reset</button>
        </nav>
        <main><AboutSettings /></main><UpdateInstallConfirmation />
    </MemoryRouter></AppUpdatesProvider>
}
Object.assign(window, { __agentUpdatePreview: { calls, setScenario, actions: () => actions, manual: () => { state = { ...state, enabled: false, externalInstaller: { id: '12345678-1234-1234-1234-123456789abc', version: state.downloadedVersion!, agentServerUpdate: true } }; listeners.forEach(listener => listener(state)) } } })
createRoot(document.getElementById('root')!).render(<Preview />)
