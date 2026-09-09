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
  title: 'Calculator - Standard',
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
      selectedWindow: { targetId: observation.targetId, candidateRef: candidate.windowToken,
        processId: candidate.processId, applicationName: candidate.applicationName, title: candidate.title },
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
assert.equal(isDirectComputerControlPrompt("Use Zyra's in-app Browser control and Windows computer control only."), true)
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
const sequenceKeyVariant = useApp.parameters.properties.steps.items.anyOf.find((entry) => entry.properties?.type?.const === 'key')
const advertisedSequenceKeys = sequenceKeyVariant.properties.key.anyOf.map((entry) => entry.const)
assert(advertisedSequenceKeys.includes('Escape'))
assert(!advertisedSequenceKeys.includes('3'), 'sequence schemas do not advertise numeric typing that the broker must reject')
assert(!advertisedSequenceKeys.includes('Enter'), 'sequence schemas keep Enter on the individual reviewed action path')
const initialSteps = [{ type: 'click', role: 'button', name: 'Seven', sideEffect: 'none' }]
const used = await useApp.execute('tool:use-app', { application: 'Calculator', access: ['observe', 'click', 'key'], steps: initialSteps })
assert.match(used.content[0].text, /Computer access granted/)
assert.equal(used.details.selectedWindow.processId, 4242)
assert.match(used.content[0].text, /selectedWindow/)
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
assert.match(opened.content[0].text, /Calculator - Standard/)
assert.deepEqual(calls.at(-1), { operation: 'open_app', application: 'Calculator' })

const list = tools.find((tool) => tool.name === 'computer_list_windows')
const listed = await list.execute('tool:list', { query: 'Calculator' })
assert.match(listed.content[0].text, /candidateRef window-token:opaque-candidate/)
assert.match(listed.content[0].text, /Calculator - Standard/, 'query-scoped window titles distinguish exact candidates before access')
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
assert.equal(access.details.selectedWindow.candidateRef, candidate.windowToken)
assert.match(access.content[0].text, /selectedWindow/)
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

const dragStepSchema = sequence.parameters.properties.steps.items.anyOf.find((entry) => entry.properties?.type?.const === 'drag')
assert(dragStepSchema, 'drawing gestures are available in the model-facing batch schema')
assert.equal(dragStepSchema.properties.sideEffect.const, 'none')
assert.equal(dragStepSchema.properties.durationMs.maximum, 5000)
assert.equal(dragStepSchema.additionalProperties, false)
assert.equal(sequence.parameters.properties.steps.maxItems, 16)
const useAppForDrag = tools.find((tool) => tool.name === 'computer_use_app')
assert(useAppForDrag.parameters.properties.steps.items.anyOf.some((entry) => entry.properties?.type?.const === 'drag'), 'computer_use_app shares the bounded drag sequence schema')


const pointStepSchema = sequence.parameters.properties.steps.items.anyOf.find((entry) => entry.properties?.type?.const === 'click_point')
assert(pointStepSchema, 'routine coordinate clicks must not require separate model round trips')
assert.equal(pointStepSchema.properties.sideEffect.const, 'none')
assert.equal(pointStepSchema.properties.x.minimum, 0)
assert.equal(pointStepSchema.properties.y.maximum, 100000)
assert.equal(pointStepSchema.additionalProperties, false)
assert(useApp.parameters.properties.steps.items.anyOf.some((entry) => entry.properties?.type?.const === 'click_point'))
const pointSteps = [
  { type: 'click_point', x: 120, y: 140, sideEffect: 'none' },
  { type: 'click_point', x: 220, y: 140, sideEffect: 'none' },
  { type: 'click', name: 'Pencil', sideEffect: 'none' },
]
await sequence.execute('tool:point-sequence', {
  targetId: observation.targetId, grantId: 'control-grant:fixture',
  observationRevision: observation.revision, steps: pointSteps,
})
assert.deepEqual(calls.at(-1).steps, pointSteps, 'coordinates and the final semantic action reach the broker in one ordered batch')
assert.equal(calls.at(-1).operation, 'act_sequence')

const strokeTool = tools.find(tool => tool.name === 'computer_stroke')
assert.ok(strokeTool, 'native continuous strokes are discoverable')
assert.equal(strokeTool.parameters.properties.points.minItems, 2)
assert.equal(strokeTool.parameters.properties.points.maxItems, 512)
assert.ok(sequence.parameters.properties.steps.items.anyOf.some(step => step.properties.type.const === 'stroke'))

const orderedPoints = [{ x: 20, y: 30 }, { x: 40, y: 60 }, { x: 80, y: 35 }]
await strokeTool.execute('tool:stroke', { targetId: observation.targetId, grantId: 'control-grant:fixture', observationRevision: observation.revision, points: orderedPoints, durationMs: 600 })
assert.deepEqual(calls.at(-1).action, { type: 'stroke', points: orderedPoints, durationMs: 600 })

assert.equal(useApp.parameters.properties.steps.minItems, 0, 'an empty optional app setup must behave like omitted steps')
assert.equal(sequence.parameters.properties.steps.minItems, 1, 'standalone execution still requires a step')
await useApp.execute('tool:empty-setup', { application: 'Calculator', access: ['observe'], steps: [] })
assert.equal('steps' in calls.at(-1), false, 'empty optional setup is omitted before the bridge call')

await strokeTool.execute('tool:compact-stroke', { targetId: observation.targetId, grantId: 'control-grant:fixture', observationRevision: observation.revision, points: [[20,30],[40,60],[80,35]], durationMs: 600 })
assert.deepEqual(calls.at(-1).action, { type: 'stroke', points: orderedPoints, durationMs: 600 })
await sequence.execute('tool:compact-sequence', { targetId: observation.targetId, grantId: 'control-grant:fixture', observationRevision: observation.revision, steps: [{ type: 'stroke', points: [[20,30],[40,60]], sideEffect: 'none' }] })
assert.deepEqual(calls.at(-1).steps, [{ type: 'stroke', points: [{x:20,y:30},{x:40,y:60}], sideEffect: 'none' }])
await useApp.execute('tool:compact-app', { application: 'Calculator', access: ['observe','drag'], steps: [{ type: 'stroke', points: [[20,30],[40,60]], sideEffect: 'none' }] })
assert.deepEqual(calls.at(-1).steps, [{ type: 'stroke', points: [{x:20,y:30},{x:40,y:60}], sideEffect: 'none' }])
await assert.rejects(() => strokeTool.execute('tool:invalid-point', { targetId: observation.targetId, grantId: 'control-grant:fixture', observationRevision: observation.revision, points: [[20,30,40],[40,60]] }), /exactly/)
