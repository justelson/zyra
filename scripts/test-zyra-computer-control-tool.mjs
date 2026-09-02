import assert from 'node:assert/strict'
import { ensureComputerToolState } from '../src/zyra-sdk.mjs'
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
  elements: [{ elementRef: 'element:seven', role: 'button', name: 'Seven', actions: ['click'] }],
  redactions: [],
}
const client = {
  async request(operation) {
    calls.push(operation)
    if (operation.operation === 'open_app') return { applicationName: 'Calculator', windows: [candidate] }
    if (operation.operation === 'list_windows') return { windows: [candidate] }
    if (operation.operation === 'request_grant') return {
      grant: {
        grantId: 'control-grant:fixture',
        targetId: observation.targetId,
        capabilities: operation.capabilities,
        expiresAt: '2030-01-01T00:00:00.000Z',
        maxActions: 5,
        actionCount: 0,
      },
    }
    if (operation.operation === 'observe' || operation.operation === 'act') return { observation }
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

const search = tools.find((tool) => tool.name === COMPUTER_TOOL_SEARCH_NAME)
const searched = await search.execute('tool:search', { query: 'Windows computer control' })
assert.match(searched.content[0].text, /loaded for this turn/i)
assert(COMPUTER_TOOLSET_NAMES.every((name) => session.active.includes(name)))

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
  maxActions: 5,
})
assert.match(access.content[0].text, /control-grant:fixture/)
assert.deepEqual(calls.at(-1), {
  operation: 'request_grant',
  windowToken: candidate.windowToken,
  capabilities: ['observe.structure', 'pointer.click'],
  maxActions: 5,
})

const observe = tools.find((tool) => tool.name === 'computer_observe')
const observed = await observe.execute('tool:observe', {
  targetId: observation.targetId,
  grantId: 'control-grant:fixture',
})
assert.match(observed.content[0].text, /element:seven/)
assert.equal(observed.details.elementCount, 1)
assert.equal('elements' in observed.details, false, 'the model receives the feedback loop without duplicating raw observations in details')

installComputerToolTurnCleanup(session)
lifecycleListener?.({ type: 'agent_end' })
assert(COMPUTER_TOOLSET_NAMES.every((name) => !session.active.includes(name)), 'computer tools unload after every agent turn')
assert(session.active.includes(COMPUTER_TOOL_SEARCH_NAME))

console.log('Zyra deferred computer-tool feedback loop passed.')
