import assert from 'node:assert/strict'
import { ensureComputerToolState, isDirectComputerControlPrompt, prepareZyraComputerToolsForPrompt } from '../src/zyra-sdk.mjs'
import {
  applyComputerSearchOnlyState,
  COMPUTER_TOOL_SEARCH_NAME,
  COMPUTER_TOOLSET_NAMES,
  createComputerToolSet,
  installComputerToolTurnCleanup,
} from '../src/agent-control/computer-toolset.mjs'

const active = ['read', 'bash', 'computer_control', ...COMPUTER_TOOLSET_NAMES]
let lifecycleListener = null
const session = {
  active,
  getActiveToolNames() { return [...this.active] },
  setActiveToolsByName(names) { this.active = [...names] },
  subscribe(listener) { lifecycleListener = listener; return () => { lifecycleListener = null } },
}
const sessionRef = { current: session }
const calls = []
const candidate = {
  windowToken: 'window-token:opaque-candidate',
  title: 'Private document title',
  applicationName: 'ApplicationFrameHost',
  executableIdentity: 'fixture-identity',
  processId: 4242,
  blocked: false,
}
const observation = {
  targetId: 'control-target:windows-window:fixture',
  revision: 2,
  targetState: 'ready',
  title: 'Calculator',
  focusedElementRef: 'element:display',
  elements: [
    { elementRef: 'element:root', role: 'window', name: 'Calculator', bounds: { x: 0, y: 0, width: 800, height: 600 } },
    { elementRef: 'element:seven', role: 'button', name: 'Seven', actions: ['click'], bounds: { x: 10, y: 10, width: 40, height: 40 } },
    { elementRef: 'element:display', role: 'control', name: 'Display is 7', value: '7', bounds: { x: 10, y: 60, width: 200, height: 40 } },
  ],
  redactions: [],
}
const client = {
  async request(operation) {
    calls.push(operation)
    if (operation.operation === 'open_app') return { applicationName: 'Calculator', windows: [candidate] }
    if (operation.operation === 'list_windows') return { windows: [candidate] }
    if (operation.operation === 'use_app' || operation.operation === 'request_grant') return {
      grant: {
        grantId: 'control-grant:fixture',
        targetId: observation.targetId,
        capabilities: operation.capabilities,
        expiresAt: '2030-01-01T00:00:00.000Z',
        maxActions: 5,
        actionCount: 0,
      },
      observation,
    }
    if (operation.operation === 'observe' || operation.operation === 'act') return { observation }
    if (operation.operation === 'act_sequence') return { observation, completedSteps: operation.steps.length, totalSteps: operation.steps.length }
    if (operation.operation === 'release') return { released: true }
    throw new Error(`Unexpected operation: ${operation.operation}`)
  },
}

const tools = createComputerToolSet({ client, sessionRef })
assert.equal(ensureComputerToolState(session, true, applyComputerSearchOnlyState, COMPUTER_TOOLSET_NAMES, COMPUTER_TOOL_SEARCH_NAME), true)
applyComputerSearchOnlyState(session)
assert(session.active.includes(COMPUTER_TOOL_SEARCH_NAME))
assert(!session.active.includes('computer_control'))
assert(COMPUTER_TOOLSET_NAMES.every((name) => !session.active.includes(name)))
assert.equal(isDirectComputerControlPrompt('Open Calculator and use computer control to calculate 123 × 45.'), true)
assert.equal(isDirectComputerControlPrompt('Refactor the computer-control TypeScript module.'), false)
assert.equal(prepareZyraComputerToolsForPrompt({
  session,
  computerToolsAvailable: true,
  computerToolsetNames: COMPUTER_TOOLSET_NAMES,
  computerToolSearchName: COMPUTER_TOOL_SEARCH_NAME,
}, 'Use computer control to open Calculator.'), true)
assert(COMPUTER_TOOLSET_NAMES.every((name) => session.active.includes(name)), 'explicit computer-control prompts preload the deferred tools before the first model turn')
assert(!session.active.includes(COMPUTER_TOOL_SEARCH_NAME), 'an already-preloaded turn cannot waste its first provider round trip on tool search')
applyComputerSearchOnlyState(session)

const search = tools.find((tool) => tool.name === COMPUTER_TOOL_SEARCH_NAME)
const searched = await search.execute('tool:search', { query: 'Windows computer control' })
assert.match(searched.content[0].text, /loaded for this turn/i)
assert(COMPUTER_TOOLSET_NAMES.every((name) => session.active.includes(name)))

const useApp = tools.find((tool) => tool.name === 'computer_use_app')
assert(useApp, 'the common exact-app access path needs one provider round trip')
const initialSteps = [{ type: 'click', role: 'button', name: 'Seven', sideEffect: 'none' }]
const used = await useApp.execute('tool:use-app', { application: 'Calculator', access: ['observe', 'click', 'key'], steps: initialSteps })
assert.match(used.content[0].text, /Computer access granted/)
assert.match(used.content[0].text, /Initial computer observation ready/)
assert.deepEqual(calls.at(-1), {
  operation: 'use_app',
  application: 'Calculator',
  capabilities: ['observe.structure', 'pointer.click', 'keyboard.key'],
  durationMs: 10 * 60 * 1000,
  maxActions: 32,
  requestId: calls.at(-1).requestId,
  steps: initialSteps,
})

const openApp = tools.find((tool) => tool.name === 'computer_open_app')
assert(openApp, 'computer tasks need a first-class registered-app launcher')
const opened = await openApp.execute('tool:open-app', { application: 'Calculator' })
assert.match(opened.content[0].text, /candidateRef window-token:opaque-candidate/)
assert.doesNotMatch(opened.content[0].text, /Private document title/)
assert.deepEqual(calls.at(-1), { operation: 'open_app', application: 'Calculator' })

const list = tools.find((tool) => tool.name === 'computer_list_windows')
const listed = await list.execute('tool:list', { query: 'Calculator' })
assert.match(listed.content[0].text, /candidateRef window-token:opaque-candidate/)
assert.doesNotMatch(listed.content[0].text, /Private document title/, 'ambient titles stay out of pre-grant model content')
assert.deepEqual(listed.details, { matchCount: 1 }, 'raw ambient windows are not persisted in tool details')
assert.deepEqual(calls.at(-1), { operation: 'list_windows', query: 'Calculator' })

const requestAccess = tools.find((tool) => tool.name === 'computer_request_access')
const access = await requestAccess.execute('tool:access', {
  candidateRef: candidate.windowToken,
  access: ['observe', 'click'],
})
assert.match(access.content[0].text, /control-grant:fixture/)
assert.match(access.content[0].text, /Initial computer observation ready/)
assert.match(access.content[0].text, /element:seven/)
assert.match(access.content[0].text, /Display is 7/)
assert.doesNotMatch(access.content[0].text, /"bounds"/, 'model observations omit redundant geometry for semantic controls')
assert.doesNotMatch(access.content[0].text, /element:root/, 'model observations omit duplicate target-window chrome')
assert.deepEqual(calls.at(-1), {
  operation: 'request_grant',
  windowToken: candidate.windowToken,
  capabilities: ['observe.structure', 'pointer.click'],
  durationMs: 10 * 60 * 1000,
  maxActions: 32,
})
assert.equal(access.details.observation.revision, 2, 'access returns a compact initial observation summary')

const sequence = tools.find((tool) => tool.name === 'computer_sequence')
assert(sequence, 'known routine interaction sequences need one bounded model round trip')
const sequenceSteps = [
  { type: 'click', role: 'button', name: 'Seven', sideEffect: 'none' },
  { type: 'key', key: 'A', modifiers: ['Ctrl'], sideEffect: 'none' },
  { type: 'type', role: 'edit', name: 'Display', text: 'seven', replace: false, sideEffect: 'none' },
]
const sequenced = await sequence.execute('tool:sequence', {
  targetId: observation.targetId,
  grantId: 'control-grant:fixture',
  observationRevision: observation.revision,
  steps: sequenceSteps,
})
assert.match(sequenced.content[0].text, /completed 3 of 3 steps/i)
assert.deepEqual(calls.at(-1), {
  operation: 'act_sequence',
  version: 1,
  requestId: calls.at(-1).requestId,
  grantId: 'control-grant:fixture',
  targetId: observation.targetId,
  observationRevision: observation.revision,
  steps: sequenceSteps,
})

const observe = tools.find((tool) => tool.name === 'computer_observe')
const observed = await observe.execute('tool:observe', {
  targetId: observation.targetId,
  grantId: 'control-grant:fixture',
})
assert.match(observed.content[0].text, /element:seven/)
assert.equal(observed.details.elementCount, 3)
assert.equal('elements' in observed.details, false, 'the model receives the feedback loop without duplicating raw observations in details')

installComputerToolTurnCleanup(session)
lifecycleListener?.({ type: 'agent_end' })
assert(COMPUTER_TOOLSET_NAMES.every((name) => !session.active.includes(name)), 'computer tools unload after every agent turn')
assert(session.active.includes(COMPUTER_TOOL_SEARCH_NAME))

console.log('Zyra deferred computer-tool feedback loop passed.')
