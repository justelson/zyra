import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'

let bootstrapCalls = 0
let subscriptions = 0
let disconnects = 0
const snapshot = createDefaultAssistantSnapshot()
const status = { available: false, connected: false, connecting: false, selectedSessionId: null, activeThreadId: null, providerThreadId: null, message: null }
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout, clearTimeout, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    devscope: { assistant: {
        bootstrap: async () => { bootstrapCalls++; return { snapshot, status } },
        onEvent: () => { subscriptions++; return () => { disconnects++ } }
    } }
} })
const { AssistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Chat actions + the rail retain the same store. Both release on route unmount.
const baseline = new AssistantStore()
for (const route of ['Chat', 'Plugins', 'Chat']) {
    void route
    baseline.retain(); baseline.retain()
    await settle()
    baseline.release(); baseline.release()
}
assert.equal(bootstrapCalls, 3)
assert.equal(subscriptions, 3)
assert.equal(disconnects, 3)
console.log('Reproduced Chat → Plugins → Chat: 3 bootstraps and 3 event subscriptions.')

// The shared route parent owns the subscription while either child is mounted.
bootstrapCalls = subscriptions = disconnects = 0
const store = new AssistantStore()
store.retain()
await settle()
const stableSnapshot = store.getState().snapshot
for (const route of ['Chat', 'Plugins', 'Chat', 'Plugins', 'Chat']) {
    void route
    store.retain(); store.retain()
    await settle()
    store.release(); store.release()
    assert.equal(store.getState().snapshot, stableSnapshot)
}
assert.equal(bootstrapCalls, 1)
assert.equal(subscriptions, 1)
assert.equal(disconnects, 0)
store.release()
assert.equal(disconnects, 1, 'leaving the workspace still releases the event stream')
store.retain()
await settle()
assert.equal(bootstrapCalls, 2, 'returning from outside the workspace reconciles missed events')
store.release()

const app = readFileSync(join(import.meta.dir, '../src/renderer/src/App.tsx'), 'utf8')
assert.match(app, /<Route element=\{<AssistantWorkspaceLifetime \/>\}>[\s\S]*?path="\/assistant"[\s\S]*?path="\/plugins"[\s\S]*?<\/Route>/, 'Chat and Plugins must share the persistent route owner')
const page = readFileSync(join(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantPage.tsx'), 'utf8')
const plugins = readFileSync(join(import.meta.dir, '../src/renderer/src/pages/plugins/PluginWorkspace.tsx'), 'utf8')
assert.doesNotMatch(page, /<ConnectedAssistantSessionsRail/, 'Chat must not own a route-local sidebar instance')
assert.doesNotMatch(plugins, /<ConnectedAssistantSessionsRail/, 'Plugins must not own a replacement sidebar instance')
const lifetime = readFileSync(join(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantWorkspaceLifetime.tsx'), 'utf8')
const layout = readFileSync(join(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantWorkspaceLayout.tsx'), 'utf8')
assert.match(lifetime, /<AssistantWorkspaceLayout><Outlet \/><\/AssistantWorkspaceLayout>/)
assert.match(layout, /<ConnectedAssistantSessionsRail[\s\S]*<Suspense[\s\S]*\{children\}/, 'lazy route loading stays beside the persistent sidebar')
assert.match(page, /useAssistantWorkspaceLayout\(\)/, 'Chat and sidebar share the same pane sizing and preferences')
console.log('Assistant workspace retains Chat state and one sidebar across Plugin navigation and releases on exit: ok')
