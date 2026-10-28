import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RuntimeLifecycleSection } from '../../src/renderer/src/pages/settings/RuntimeLifecycleSection'
import type { RuntimeActivationStatus } from '../../src/shared/runtime-activation'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root')!)
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
let state: RuntimeActivationStatus = { phase: 'waiting', connection: 'connected', updatePending: true, lastConfirmedAt: new Date().toISOString(),
    installation: { kind: 'installed', label: 'Preview fixture', appVersion: '0.7.0-dev.42' }, expectedRuntimeRevision: 'b'.repeat(64),
    instance: { instanceId: 'fixture-instance', namespaceId: 'fixture-namespace', channel: 'desktop', protocolVersion: 5, startedAt: new Date().toISOString(), runtimeRevision: 'a'.repeat(64) },
    activity: { activeTurns: 1, backgroundChats: 1, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 } }
const listeners = new Set<(state: RuntimeActivationStatus) => void>()
const publish = (patch: Partial<RuntimeActivationStatus>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)) }
let calls = 0, refreshes = 0, failRefresh = false
let release!: (success: boolean) => void
const api = {
    getState: async () => state,
    onStateChange: (listener: (next: RuntimeActivationStatus) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    refresh: async () => { refreshes++; if (failRefresh) throw new Error('Synthetic disconnected status'); publish({ phase: 'waiting', connection: 'connected', lastConfirmedAt: new Date().toISOString() }); return state },
    activateUpdate: async () => {
        calls++
        const success = await new Promise<boolean>(resolve => { release = resolve })
        if (!success) throw new Error('Synthetic activation failed')
        publish({ updatePending: false, phase: 'ready', instance: { ...state.instance!, instanceId: 'replacement-instance', runtimeRevision: 'b'.repeat(64) } })
        return state
    }
}
window.devscope = { runtimeActivation: api } as any
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!
Object.assign(window, { runRuntimeLifecycle: async () => {
    await act(async () => root.render(<RuntimeLifecycleSection />)); await flush()
    check(document.body.textContent?.includes('Update ready'), 'pending activation is distinguished from installation')
    check(!button('Review update').disabled, 'running work can be reviewed without being cancelled')
    await act(async () => button('Review update').click()); await flush()
    check(calls === 0 && document.querySelector('dialog')?.textContent?.includes('Background work'), 'review lists real blocker counts without cancelling work')
    check(document.activeElement?.textContent === 'Later', 'safe Later action receives focus')
    await act(async () => button('Later').click()); await flush()
    check(calls === 0 && !document.querySelector('dialog'), 'Later neither cancels nor schedules activation')
    await act(async () => publish({ activity: { ...state.activity!, activeTurns: 0, backgroundChats: 0 } }))
    check(!button('Review update').disabled, 'idle observation makes review usable')
    await act(async () => button('Review update').click()); await flush()
    await act(async () => button('Update agent').click()); await flush()
    check(calls === 1 && button('Preparing…').disabled, 'only one activation can be in flight')
    await act(async () => release(false)); await flush()
    check(document.querySelector('[role=alert]')?.textContent?.includes('Update did not start'), 'failure is visible and retryable')
    check(document.body.textContent?.includes('Update ready'), 'failure never claims active code agreement')
    await act(async () => button('Check again').click()); await flush()
    await act(async () => button('Update agent').click()); await flush()
    await act(async () => release(true)); await flush()
    check(calls === 2 && document.body.textContent?.includes('Installed code is running.'), 'successful response reflects the verified replacement')
    await act(async () => publish({ connection: 'disconnected', phase: 'failed' }))
    check(document.body.textContent?.includes('Active code is not confirmed.'), 'retained old identity is not current while disconnected')
    failRefresh = true
    await act(async () => button('Reconnect').click()); await flush()
    check(document.querySelector('[role=alert]')?.textContent?.includes('Agent check failed'), 'reconnect failure stays visible with details on request')
    failRefresh = false
    await act(async () => button('Reconnect').click()); await flush()
    check(refreshes >= 2 && button('Refresh'), 'explicit reconnect refreshes status without an activation request')
    ;[...document.querySelectorAll('summary')].find(node => node.textContent === 'Agent details')!.click(); await flush()
    check(document.body.textContent?.includes('0.7.0-dev.42') && document.body.textContent?.includes('bbbbbbbbbbbb'), 'app version and separate installed/observed runtime code are available')
    window.devscope.runtimeActivation = { getState: api.getState, onStateChange: api.onStateChange }
    await act(async () => publish({ ...state }))
    check(!button('Review update') && !button('Refresh'), 'read-only hosts expose no lifecycle controls')
    check(document.body.textContent?.includes('connection is read-only'), 'read-only restriction is explicit')
    window.devscope.runtimeActivation = api
    await act(async () => publish({ ...state, updatePending: true, phase: 'waiting', instance: { ...state.instance!, runtimeRevision: 'a'.repeat(64) } }))
    check(document.documentElement.scrollWidth <= innerWidth + 1, 'agent section fits the viewport')
    return { blockers: true, activationRetry: true, singleInFlight: true, reconnect: true, desiredVsActive: true, readOnlyHost: true }
}, runtimeLifecycleGeometry: () => {
    check(document.documentElement.scrollWidth <= innerWidth + 1, 'narrow agent section has no horizontal overflow')
} })
