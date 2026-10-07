import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from '@/lib/settings'
import ProvidersSettings from '@/pages/settings/ProvidersSettings'
import { AssistantThreadBackgroundProcesses } from '@/pages/assistant/AssistantThreadBackgroundProcesses'
import { installProvidersReviewFixture } from './providers-review-fixture'
import '@/index.css'

installProvidersReviewFixture()
function Review() {
    return <HashRouter><SettingsProvider>
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--settings-border)] bg-[var(--settings-section)] px-4 text-xs">
            <span className="text-[var(--settings-text-muted)]">UI review · Test accounts</span>
            <div className="flex items-center gap-4"><Link to="/settings/providers">Connections</Link><Link to="/settings/providers/limits">Limits</Link><Link to="/review/thread">Thread details</Link>
                <select aria-label="Preview scenario" className="bg-[var(--settings-control)] px-2 py-1 text-xs" value={new URLSearchParams(location.search).get('scenario') || 'weekly'} onChange={e => { const url = new URL(location.href); url.searchParams.set('scenario', e.target.value); location.href = url.href }}>
                    <option value="weekly">Weekly only</option><option value="dual">Two usage windows</option><option value="empty">No accounts</option><option value="signin">Sign-in needed</option><option value="error">Usage error</option><option value="running">Running process</option>
                </select>
            </div>
        </div>
        <main className="min-h-0 flex-1 overflow-auto" data-review-product>
            <Routes><Route path="/settings/providers" element={<ProvidersSettings view="connections" />} /><Route path="/settings/providers/limits" element={<ProvidersSettings view="limits" />} />
                <Route path="/review/thread" element={<div className="ml-auto min-h-full w-full max-w-[420px] border-l border-[var(--settings-border)] p-4"><h1 className="mb-5 text-sm font-medium">Thread details</h1><AssistantThreadBackgroundProcesses sessionId="review" threadId="review" /></div>} />
                <Route path="*" element={<Navigate to="/settings/providers/limits" replace />} />
            </Routes>
        </main>
    </SettingsProvider></HashRouter>
}
createRoot(document.getElementById('root')!).render(<div className="flex h-screen min-h-0 flex-col"><Review /></div>)
