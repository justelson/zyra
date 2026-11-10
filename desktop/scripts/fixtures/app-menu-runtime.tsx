import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import TitleBar from '../../src/renderer/src/components/layout/TitleBar'
import { AssistantTitleBarProvider } from '../../src/renderer/src/lib/assistant/assistant-title-bar'
import { resolveThemeTokens } from '../../src/renderer/src/lib/settings-theme-semantics'
import { getThemeDefinition } from '../../src/renderer/src/lib/settings-theme-catalog'
import type { RuntimeActivationStatus } from '../../src/shared/runtime-activation'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root')!)
const listeners = new Set<(state: RuntimeActivationStatus) => void>()
let state: RuntimeActivationStatus
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
const status = () => document.querySelector<HTMLButtonElement>('[aria-label="Agent status and updates"]')
const initial = (): RuntimeActivationStatus => ({ phase: 'ready', connection: 'connected', lastConfirmedAt: new Date().toISOString(), installation: { kind: 'installed', label: 'Installed' } })
;(window as any).devscope = {
    runtimeActivation: { getState: async () => state, onStateChange: (listener: (next: RuntimeActivationStatus) => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
    agentControl: { getState: async () => ({ success: false }), onStateChange: () => () => {} },
    window: { minimize: () => {}, maximize: () => {}, close: () => {} }
}
const theme = (light = false) => {
    for (const [key, value] of Object.entries(resolveThemeTokens(getThemeDefinition(light ? 'paper-light' : 'vercel').tokens))) {
        document.documentElement.style.setProperty('--color-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase()), value)
    }
    document.documentElement.className = light ? 'light' : 'dark'
    document.body.className = light ? 'light' : ''
    document.documentElement.style.colorScheme = light ? 'light' : 'dark'
}
function Location() { return <output hidden id="location">{useLocation().pathname}</output> }
const click = async (node: HTMLElement | null) => { check(node, 'click target exists'); await act(async () => node!.click()); await flush() }
const update = async (patch: Partial<RuntimeActivationStatus>) => { state = { ...state, ...patch }; await act(async () => listeners.forEach(listener => listener(state))); await flush() }
const open = async () => { if (!status()) await click(document.querySelector('button[aria-haspopup="menu"]')) }
;(window as any).appMenuReview = {
    preview: async (view = 'connected') => {
        theme(view === 'light'); state = initial()
        await act(async () => root.render(<MemoryRouter key={Math.random()} initialEntries={['/assistant']}><AssistantTitleBarProvider><TitleBar /><Location /></AssistantTitleBarProvider></MemoryRouter>))
        await flush(); await update({}); await open()
        if (view === 'disconnected') await update({ phase: 'failed', connection: 'disconnected' })
        if (view === 'connecting') await update({ phase: 'checking', connection: 'connecting' })
        if (view === 'update') await update({ updatePending: true })
    },
    run: async () => {
        await (window as any).appMenuReview.preview()
        check(status()?.textContent === 'AgentConnected', 'healthy status is one concise menu row')
        check(status()?.title.includes('Installed · Connected'), 'installation detail stays in the tooltip')
        check(status()!.getBoundingClientRect().height <= 40, 'status keeps the menu compact')

        check(!document.querySelector('button[aria-label="Agent status and updates"]')?.textContent?.includes('Installed'), 'normal menu is free of installation metadata')
        for (const label of ['New chat', 'Search', 'Accessories', 'Plugins', 'Settings', 'View']) check([...document.querySelectorAll('[role="menuitem"]')].some(node => node.textContent?.includes(label)), 'existing menu action remains: ' + label)
        await update({ updatePending: true }); check(status()?.textContent === 'AgentConnected' && status()?.querySelector('[aria-label="Agent update pending"]'), 'pending update keeps connected status with a small indicator')
        check(status()?.getAttribute('aria-description')?.includes('agent update deferred'), 'full update state is available to assistive technology')
        await update({ updatePending: false, phase: 'checking', connection: 'connecting' }); check(status()?.textContent === 'AgentConnecting', 'connecting state uses the same layout')
        await update({ phase: 'failed', connection: 'disconnected' }); check(status()?.textContent === 'AgentDisconnected', 'disconnect stays visible')
        await update({ phase: 'ready', connection: 'connected', lastConfirmedAt: new Date(Date.now() - 90_000).toISOString() }); check(status()?.textContent === 'AgentStale', 'stale state is not presented as connected')
        await click(status()); check(document.getElementById('location')?.textContent === '/settings/about', 'status opens the real About page route')
        check(!document.querySelector('[role="menu"]'), 'selection closes the app menu')
        await (window as any).appMenuReview.preview(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await flush()
        check(!status(), 'Escape still dismisses the menu')
        console.log('PASS: real TitleBar menu, live connection states, pending update, metadata, existing actions, status navigation and Escape')
    },
    bounds: () => {
        const row = status()!, rect = row.getBoundingClientRect()
        check(row.scrollWidth <= row.clientWidth, 'runtime row does not overflow')
        for (const node of row.querySelectorAll<HTMLElement>('span,svg')) {
            const box = node.getBoundingClientRect()
            check(box.left >= rect.left && box.right <= rect.right + 1, 'status contents fit the menu row')
        }
    }
}
