import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import ArchivedChatsSettings from '../../src/renderer/src/pages/settings/ArchivedChatsSettings'
import { resolveThemeTokens } from '../../src/renderer/src/lib/settings-theme-semantics'
import { getThemeDefinition } from '../../src/renderer/src/lib/settings-theme-catalog'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root')!)
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
const listeners = new Set<() => void>()
let snapshot: any = { snapshot: { sessions: [] } }
let failure = false, confirmation = true, holdRestore: (() => void) | null = null
const calls: string[] = []
const initial = () => [
    ['Preview build', 'C:/Projects/zyra', 2], ['Browser extension support', 'C:/Projects/zyra', 4],
    ['New chat', '', 8], ['Polish the landing page', 'C:/Projects/Harbor', 12],
    ['Video export settings', '', 20], ['A longer chat title that should stay on one line without pushing the actions away', 'C:/Projects/Archive', 25],
    ['New chat', '', 31]
].map(([title, projectPath, days], index) => ({ id: `archive-${index}`, title, projectPath, archived: true, threads: [], createdAt: new Date(Date.now() - Number(days) * 86400000).toISOString(), updatedAt: new Date(Date.now() - Number(days) * 86400000).toISOString() }))
const publish = (sessions: any[]) => { snapshot = { snapshot: { sessions } }; listeners.forEach(listener => listener()) }
;(window as any).archiveStore = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    getState: () => snapshot,
    actions: {
        archiveSessionResult: async (id: string, archived: boolean) => {
            calls.push(`restore:${id}:${archived}`)
            if (holdRestore) await new Promise<void>(resolve => { holdRestore = resolve })
            if (failure) return { success: false, error: 'Could not restore this chat. Try again.' }
            publish(snapshot.snapshot.sessions.map((session: any) => session.id === id ? { ...session, archived } : session))
            return { success: true }
        },
        selectSessionResult: async (id: string) => { calls.push(`select:${id}`); return { success: true } },
        deleteSessionResult: async (id: string) => { calls.push(`delete:${id}`); publish(snapshot.snapshot.sessions.filter((session: any) => session.id !== id)); return { success: true } }
    }
}
;(window as any).devscope = { window: { getRuntimeInfo: async () => ({ platform: 'win32' }) } }
window.confirm = () => confirmation
function Location() { return <output hidden id="location">{useLocation().pathname}</output> }
const mount = async () => {
    await act(async () => root.render(<MemoryRouter key={Math.random()} initialEntries={['/settings/assistant/archived']}><ArchivedChatsSettings /><Location /></MemoryRouter>))
    await flush()
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.getAttribute('title') === label) || null
const click = async (node: HTMLElement | null) => { check(node, 'click target exists'); await act(async () => node!.click()); await flush() }
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.includes(label)) || null
const rows = () => document.querySelectorAll('tbody tr')
const search = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search archived chats"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await flush()
}
const theme = (light = false) => {
    const tokens = resolveThemeTokens(getThemeDefinition(light ? 'paper-light' : 'vercel').tokens)
    for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty('--color-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase()), value)
    document.documentElement.className = light ? 'light' : 'dark'
    document.body.className = light ? 'light' : ''
    document.documentElement.style.colorScheme = light ? 'light' : 'dark'
}
;(window as any).archiveReview = {
    preview: async (view = 'default') => {
        failure = false; holdRestore = null; theme(view === 'light')
        await act(async () => publish(view === 'empty' ? [] : initial())); await mount()
        if (view === 'menu') await click(button('Actions for Preview build'))
        if (view === 'search') await search('zyra')
    },
    run: async () => {
        theme(); await act(async () => publish(initial())); await mount()
        check(rows().length === 7, 'archived data reaches the actual table')
        check([...document.querySelectorAll('th[scope="col"]')].map(node => node.textContent?.trim()).join('|') === 'Chat|Project|Last active|Actions', 'table exposes chat, project and last activity headers')
        check(rows()[0].textContent?.includes('Preview build'), 'latest activity stays first')
        check(document.querySelector('tbody td:nth-child(2) span')?.getAttribute('title') === 'C:/Projects/zyra', 'compact project name retains full path in tooltip')
        await search('zyra'); check(rows().length === 2, 'search matches project paths')
        await search('archive-2'); check(rows().length === 1, 'search still matches chat IDs')
        await search('no-matches'); check(rows().length === 0 && document.body.textContent?.includes('No archived chats match'), 'filtered empty state')
        await search('')
        failure = true; await click(button('Restore Preview build'))
        check(rows().length === 7 && document.body.textContent?.includes('Could not restore this chat'), 'failed restore preserves the row and exposes the error')
        failure = false; holdRestore = () => {}
        await click(button('Restore Preview build'))
        check(document.querySelector('tbody tr[aria-busy="true"]'), 'pending restore stays visible')
        check(button('Restore Browser extension support')?.disabled, 'duplicate operations stay disabled')
        await act(async () => { holdRestore!(); holdRestore = null }); await flush()
        check(rows().length === 6 && !document.body.textContent?.includes('Could not restore this chat'), 'successful restore updates the table')
        await click(button('Actions for Browser extension support')); await click(menuItem('Restore and open'))
        check(calls.includes('select:archive-1') && document.getElementById('location')?.textContent === '/assistant', 'restore and open still selects and navigates')
        await act(async () => publish(initial())); await mount(); confirmation = false
        await click(button('Actions for Preview build')); await click(menuItem('Delete chat'))
        check(rows().length === 7 && !calls.includes('delete:archive-0'), 'cancelled delete preserves the chat')
        confirmation = true; await click(button('Actions for Preview build')); await click(menuItem('Delete chat'))
        check(rows().length === 6 && calls.includes('delete:archive-0'), 'confirmed delete refreshes the actual table')
        await act(async () => publish(Array.from({ length: 15 }, (_, index) => ({ ...initial()[0], id: `many-${index}`, title: `Archived chat ${index + 1}` })))); await mount()
        check(rows().length === 12, 'pagination remains bounded')
        const scroller = document.querySelector('table')!.parentElement!
        check(scroller.scrollHeight > scroller.clientHeight, 'long archives scroll inside the bounded table')
        check(button('Next page')!.getBoundingClientRect().bottom <= innerHeight, 'pagination stays visible below the scroll region')
        await click(button('Next page')); check(rows().length === 3, 'next page reaches older rows')
        await search('Archived chat 1'); check(rows().length === 7, 'search resets pagination')
        await act(async () => publish([])); await mount(); check(document.body.textContent?.includes('No chats are archived.'), 'empty archive state')
        console.log('PASS: actual Archived chats table, recency, search, project tooltips, pending/error recovery, restore/open/delete, pagination and empty states')
    },
    narrow: () => {
        check(document.documentElement.scrollWidth <= innerWidth, 'narrow archive has no horizontal overflow')
        check(getComputedStyle(document.querySelector('tbody td:nth-child(2)')!).display === 'none', 'narrow rows move projects beneath chat titles')
        for (const node of document.querySelectorAll<HTMLElement>('tbody button')) check(node.getBoundingClientRect().right <= innerWidth, 'row actions stay on screen')
        console.log('PASS: narrow table columns, truncation and visible actions')
    }
}
