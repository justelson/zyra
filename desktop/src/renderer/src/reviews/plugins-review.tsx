import { createRoot } from 'react-dom/client'
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from '@/lib/settings'
import PluginsSettings from '@/pages/settings/PluginsSettings'
import { installPluginsReviewFixture } from './plugins-review-fixture'
import { PluginStoreReview } from './PluginStoreReview'
import '@/index.css'

installPluginsReviewFixture()
createRoot(document.getElementById('root')!).render(<HashRouter><SettingsProvider><div className="flex h-screen min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--settings-border)] bg-[var(--settings-section)] px-4 text-xs text-[var(--settings-text-muted)]">
        <span>UI preview · Sample plugins</span><div className="flex items-center gap-4"><Link to="/settings/assistant/plugins">Plugin settings</Link>
            <select aria-label="Preview scenario" className="bg-[var(--settings-control)] px-2 py-1" value={new URLSearchParams(location.search).get('scenario') || 'installed'} onChange={event => { const url = new URL(location.href); url.searchParams.set('scenario', event.target.value); url.hash = '/settings/assistant/plugins'; location.href = url.href }}><option value="installed">Installed</option><option value="empty">Empty</option><option value="attention">Needs attention</option><option value="loading">Loading</option><option value="error">Error</option></select>
        </div>
    </div>
    <main className="min-h-0 flex-1 overflow-auto" data-review-product><Routes>
        <Route path="/settings/assistant/plugins" element={<PluginsSettings />} /><Route path="/plugins" element={<PluginStoreReview />} />
        <Route path="/assistant/*" element={<div className="p-8"><h1 className="text-xl">New plugin chat</h1><Link to="/settings/assistant/plugins" className="mt-4 block text-sm text-[var(--settings-text-secondary)]">Back to plugins</Link></div>} />
        <Route path="*" element={<Navigate to="/settings/assistant/plugins" replace />} />
    </Routes></main>
</div></SettingsProvider></HashRouter>)
