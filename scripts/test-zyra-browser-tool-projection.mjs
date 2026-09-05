import assert from 'node:assert/strict'
import {
  ensureBrowserControlToolState,
  isDirectBrowserControlPrompt,
  prepareZyraBrowserToolsForPrompt,
} from '../src/zyra-sdk.mjs'
import {
  applyBrowserLoaderOnlyState,
  BROWSER_LOADER_TOOL_NAME,
  BROWSER_TOOLSET_NAMES,
  createBrowserToolSet,
  installBrowserToolTurnCleanup,
} from '../src/agent-control/browser-toolset.mjs'
import { BROWSER_CONTROL_OPERATIONS, browserControlSchema } from '../src/agent-control/tool-contracts.mjs'

function fakeSession(options = {}) {
  return {
    active: [...(options.active || ['read', 'bash', 'browser_control', ...BROWSER_TOOLSET_NAMES])],
    getActiveToolNames() {
      return [...this.active]
    },
    setActiveToolsByName(names) {
      this.active = [...names]
    },
    subscribe(listener) {
      this.lifecycleListener = listener
      return () => { this.lifecycleListener = null }
    },
  }
}

const projected = fakeSession()
assert.equal(ensureBrowserControlToolState(projected, true, applyBrowserLoaderOnlyState, BROWSER_TOOLSET_NAMES), true)
assert.deepEqual(projected.getActiveToolNames(), ['read', 'bash', BROWSER_LOADER_TOOL_NAME], 'fresh chats should see only the small Browser loader')
assert.equal(ensureBrowserControlToolState(projected, true, applyBrowserLoaderOnlyState, BROWSER_TOOLSET_NAMES), false, 'loader-only projection is idempotent')
assert.equal(isDirectBrowserControlPrompt("Use Zyra's in-app Browser control to open example.com."), true)
assert.equal(isDirectBrowserControlPrompt('Refactor the Browser control TypeScript module.'), false)
assert.equal(prepareZyraBrowserToolsForPrompt({
  session: projected,
  browserToolsAvailable: true,
  browserToolsetNames: BROWSER_TOOLSET_NAMES,
  browserLoaderToolName: BROWSER_LOADER_TOOL_NAME,
}, "Use Zyra's in-app Browser control to open example.com."), true)
assert(BROWSER_TOOLSET_NAMES.every((name) => projected.active.includes(name)), 'explicit in-app Browser prompts preload the complete tool set')
assert(!projected.active.includes(BROWSER_LOADER_TOOL_NAME), 'preloaded Browser turns cannot waste the first provider round trip on the loader')
applyBrowserLoaderOnlyState(projected)

const sessionRef = { current: projected }
const tools = createBrowserToolSet({ sessionRef })
const loader = tools.find((tool) => tool.name === BROWSER_LOADER_TOOL_NAME)
assert(loader, 'browser_use must be registered')
await loader.execute('tool-call:load', { action: 'load' })
assert.deepEqual(
  projected.getActiveToolNames().filter((name) => name.startsWith('browser_')),
  [BROWSER_LOADER_TOOL_NAME, ...BROWSER_TOOLSET_NAMES],
  'loading should activate the complete Browser tool set without the legacy schema'
)
assert(!projected.getActiveToolNames().includes('browser_control'))
const removeTurnCleanup = installBrowserToolTurnCleanup(projected)
projected.lifecycleListener?.({ type: 'agent_end' })
assert.deepEqual(projected.getActiveToolNames(), ['read', 'bash', BROWSER_LOADER_TOOL_NAME], 'turn completion restores the bounded loader-only state')
removeTurnCleanup()
await loader.execute('tool-call:reload', { action: 'load' })

const perform = tools.find((tool) => tool.name === 'browser_perform')
assert(perform?.parameters?.properties?.steps, 'loaded staged execution must publish a bounded steps schema')
assert.equal(perform.parameters.properties.steps.maxItems, 64)
const strokeVariant = perform.parameters.properties.steps.items.anyOf.find((entry) => entry.properties?.type?.const === 'stroke')
assert.equal(strokeVariant.properties.points.maxItems, 512, 'continuous strokes must remain bounded')

await loader.execute('tool-call:unload', { action: 'unload' })
assert.deepEqual(projected.getActiveToolNames(), ['read', 'bash', BROWSER_LOADER_TOOL_NAME])

const observation = {
  targetId: 'control-target:zyra-browser:fixture',
  revision: 3,
  targetState: 'ready',
  url: 'https://example.com/',
  origin: 'https://example.com',
  title: 'Example Domain',
  viewport: { width: 800, height: 600, scale: 1 },
  elements: [
    { elementRef: 'element:3:1', role: 'RootWebArea', name: 'Example Domain', states: ['focusable'], actions: [], sensitive: false },
    { elementRef: 'element:3:2', role: 'heading', name: 'Example Domain', states: [], actions: [], sensitive: false },
    { elementRef: 'element:3:3', role: 'link', name: 'Learn more', states: ['focusable'], actions: ['click'], sensitive: false },
  ],
  redactions: ['url-query-secrets'],
}
const projectedTools = createBrowserToolSet({
  sessionRef: { current: projected },
  client: {
    async request(operation) {
      if (operation.operation === 'request_grant') return {
        grant: { grantId: 'control-grant:fixture', targetId: observation.targetId, capabilities: operation.capabilities, expiresAt: '2030-01-01T00:00:00.000Z', maxActions: 2, actionCount: 1 },
        observation,
      }
      if (operation.operation === 'observe') return { observation }
      throw new Error(`Unexpected Browser projection operation: ${operation.operation}`)
    },
  },
})
const access = projectedTools.find((tool) => tool.name === 'browser_access')
const accessResult = await access.execute('tool-call:access', {
  operation: 'request',
  targetId: observation.targetId,
  capabilities: ['observe.structure'],
  maxActions: 2,
})
assert.match(accessResult.content[0].text, /Initial Browser observation ready/)
assert.match(accessResult.content[0].text, /"role": "heading"/)
assert.match(accessResult.content[0].text, /"name": "Example Domain"/)
assert.match(accessResult.content[0].text, /"elementRef": "element:3:3"/)
assert.doesNotMatch(accessResult.content[0].text, /element:3:2/, 'non-actionable structural elements do not expose unusable refs')

const disabled = fakeSession()
assert.equal(ensureBrowserControlToolState(disabled, false, applyBrowserLoaderOnlyState, BROWSER_TOOLSET_NAMES), true)
assert.deepEqual(disabled.getActiveToolNames(), ['read', 'bash'])

for (const operation of ['reveal_tab', 'close_tab', 'refresh_tab', 'open_external', 'set_tab_layout', 'resize_inspector']) {
  assert(BROWSER_CONTROL_OPERATIONS.includes(operation), `${operation} must remain available through the inactive compatibility tool`)
}
assert(browserControlSchema.properties.primaryTargetId)
assert(browserControlSchema.properties.secondaryTargetId)
assert(browserControlSchema.properties.grantId)
assert(browserControlSchema.properties.width)

console.log('Zyra lazy Browser tool-set projection passed.')
