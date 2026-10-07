import { createRoot } from 'react-dom/client'
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from '@/lib/settings'
import ArchivedChatsSettings from '@/pages/settings/ArchivedChatsSettings'
import { installArchivedReviewFixture } from './archived-review-fixture'
import '@/index.css'

await installArchivedReviewFixture()
createRoot(document.getElementById('root')!).render(<HashRouter><SettingsProvider><div className="flex h-screen min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--settings-border)] px-4 text-xs text-[var(--settings-text-muted)]"><span>UI preview · Sample chats</span><select aria-label="Preview scenario" className="bg-[var(--settings-control)] px-2 py-1" value={new URLSearchParams(location.search).get('scenario') || 'populated'} onChange={event => { const url = new URL(location.href); url.searchParams.set('scenario',event.target.value); url.hash='/settings/assistant/archived'; location.href=url.href }}><option value="populated">Archived</option><option value="empty">Empty</option><option value="error">Restore error</option></select></div>
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden"><Routes><Route path="/settings/assistant/archived" element={<ArchivedChatsSettings/>}/><Route path="/assistant" element={<div className="p-8"><h1 className="text-xl">Sample chat restored</h1><Link to="/settings/assistant/archived" className="mt-4 block text-sm">Back to archived chats</Link></div>}/><Route path="*" element={<Navigate to="/settings/assistant/archived" replace/>}/></Routes></main>
</div></SettingsProvider></HashRouter>)
