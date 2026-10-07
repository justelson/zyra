// Run from desktop: bun scripts/test-assistant-background-processes.tsx
// Hidden, disposable Electron document; real React, synthetic thread-only API.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const directory = await mkdtemp(join(tmpdir(), 'zyra-background-process-test-'))
const component = resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantThreadBackgroundProcesses.tsx')
const harness = `
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AssistantThreadBackgroundProcesses } from ${JSON.stringify(component)}
import { AssistantThreadDetailsWorkspace } from ${JSON.stringify(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantControlWorkspace.tsx'))}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
const job = (jobId, overrides = {}) => ({ jobId, toolCallId: 'tool', command: 'npm run server ' + jobId, status: 'running', background: true, startedAt: '2026-01-01', ...overrides })
const ok = (jobs = [], runtimeAvailable = true) => ({ success: true, jobs, runtimeAvailable })
const reads = [], stops = []
window.devscope = { assistant: {
 listBackgroundProcesses: args => { const request = deferred(); reads.push({ args, ...request }); return request.promise },
 stopBackgroundProcesses: args => { const request = deferred(); stops.push({ args, ...request }); return request.promise }
} }
// Poll timers are advanced explicitly, without sleeps or timing-sensitive assertions.
const nativeTimeout = window.setTimeout, nativeClear = window.clearTimeout
const timers = new Map(); let timerId = 1
window.setTimeout = (callback, delay, ...args) => { if (delay !== 3000) return nativeTimeout(callback, delay, ...args); const id = timerId++; timers.set(id, callback); return id }
window.clearTimeout = id => { if (!timers.delete(id)) nativeClear(id) }
const poll = async () => { assert(timers.size === 1, 'one bounded poll timer'); const [id, fn] = [...timers][0]; timers.delete(id); await act(async () => fn()) }
const root = createRoot(document.getElementById('root'))
const render = async (threadId) => act(async () => root.render(<AssistantThreadBackgroundProcesses sessionId="session" threadId={threadId} />))
const text = () => document.body.textContent
const click = async label => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label); assert(button, 'button exists: ' + label); await act(async () => button.click()) }
const settle = async (request, result) => act(async () => request.resolve(result))
try {
 const thread = id => ({id, model:'test-model', state:'idle', runtimeMode:'approval-required', activities:[], pendingApprovals:[], pendingUserInputs:[]})
 window.__assistantState = {commandPending:false, snapshot:{selectedSessionId:'other-session',knownModels:[],sessions:[
  {id:'session',title:'Pinned details',activeThreadId:'old',threads:[thread('old'),thread('new')]},
  {id:'other-session',title:'Other chat',activeThreadId:'other-thread',threads:[thread('other-thread')]}
 ]}}
 const renderWorkspace = async (active, threadId = 'new', sessionId = 'session') => act(async () => root.render(
  <AssistantThreadDetailsWorkspace active={active} sessionId={sessionId} threadId={threadId} projectPath={null} fleetSnapshot={null} controlState={null} />))
 await renderWorkspace(true)
 assert(reads.length === 1, 'the actual Desktop Thread Details workspace mounts live background controls')
 assert(JSON.stringify(reads[0].args) === JSON.stringify({sessionId:'session',threadId:'new'}), 'pinned details read their own thread instead of global selection or session active thread')
 await settle(reads[0], ok([job('workspace-job')]))
 assert(document.querySelector('[data-testid="assistant-thread-details-workspace"] [aria-label="Background processes"]') && text().includes('workspace-job'), 'processes appear inside the real details workspace')
 await click('Stop process workspace-job')
 assert(stops[0].args.sessionId === 'session' && stops[0].args.threadId === 'new' && stops[0].args.jobId === 'workspace-job', 'real workspace stop controls keep the pinned owner')
 await settle(stops[0], ok())
 await renderWorkspace(false)
 assert(timers.size === 0 && !document.querySelector('[aria-label="Background processes"]'), 'inactive retained workspace unmounts controls and polling')
 window.__assistantState.selectionHydrationKey = 'session:new'
 await renderWorkspace(true)
 assert(reads.length === 1, 'hydrating details cannot mount process controls')
 window.__assistantState.selectionHydrationKey = null
 await renderWorkspace(true, 'missing-thread')
 await renderWorkspace(true, 'new', 'missing-session')
 assert(reads.length === 1, 'missing pinned owners cannot read a fallback thread or another selected chat')
 await act(async () => root.render(null))
 reads.length = 0; stops.length = 0
 await render('old')
 assert(text().includes('Loading processes'), 'loading visible')
 await render('new')
 assert(reads.length === 2, 'selected chat starts own live read')
 await settle(reads[1], ok([job('new-job'), job('finished', {status:'completed'}), job('foreground', {background:false})]))
 await settle(reads[0], ok([job('old-job')]))
 assert(text().includes('new-job') && !text().includes('old-job'), 'late old-chat response discarded')
 assert(!text().includes('finished') && !text().includes('foreground'), 'only running background jobs shown')
 await click('Stop all processes')
 assert(stops.length === 0 && text().includes('Servers will stop.'), 'inline confirmation before stop-all call')
 await click('Cancel')
 assert(stops.length === 0, 'cancel makes no stop call')
 await click('Stop all processes')
 await click('Confirm stop all')
 assert(JSON.stringify(stops[0].args) === JSON.stringify({sessionId:'session',threadId:'new',all:true}), 'stop all scoped to exact thread')
 assert(text().includes('Stopping') && text().includes('new-job'), 'pending stop does not optimistically remove job')
 await settle(stops[0], {success:false,error:'Server cleanup failed'})
 assert(text().includes('Server cleanup failed') && text().includes('new-job'), 'cleanup failure preserves job and error')
 await poll()
 await settle(reads[2], ok([job('new-job')]))
 assert(text().includes('Server cleanup failed'), 'successful poll does not hide cleanup failure')
 await poll()
 assert(reads.length === 4 && timers.size === 0, 'no overlapping poll while list pending')
 await click('Stop process new-job')
 assert(stops[1].args.jobId === 'new-job' && stops[1].args.threadId === 'new' && !stops[1].args.all, 'individual stop scoped by job and thread')
 await settle(stops[1], ok([job('new-job', {status:'stopped'})]))
 await settle(reads[3], ok([job('new-job')]))
 assert(text().includes('No running background processes.') && !text().includes('npm run server'), 'stale read cannot overwrite stop result')
 await poll()
 await settle(reads[4], {success:false,error:'Temporary list failure'})
 assert(text().includes('Temporary list failure'), 'read error visible')
 await render('failure')
 await settle(reads[5], ok([job('retained')]))
 await poll()
 await settle(reads[6], {success:false,error:'Offline'})
 assert(text().includes('retained') && text().includes('Offline'), 'transient read failure preserves live list')
 await click('Stop process retained')
 await settle(stops[2], ok([
  job('retained', {status:'failed', cleanupFailed:true, errorMessage:'Child server cleanup could not be confirmed', ownerAgentRunId:'agent-run'}),
  job('unrelated-running')
 ]))
 assert(text().includes('retained') && text().includes('Cleanup unconfirmed') && text().includes('Child server cleanup could not be confirmed'), 'successful invocation retains returned unconfirmed cleanup failure and error')
 assert(!text().includes('No running background processes.') && text().includes('unrelated-running'), 'full stop response preserves unrelated running jobs without empty claim')
 assert(text().includes('Agent process'), 'child-owned process labeled')
 await click('Stop process unrelated-running')
 await settle(stops[3], ok([job('retained', {status:'failed', cleanupFailed:true, errorMessage:'Cleanup still unconfirmed'})]))
 assert(text().includes('retained') && text().includes('Cleanup still unconfirmed') && !text().includes('No running background processes.'), 'unconfirmed cleanup alone never renders an empty or stopped claim')
 await render('unavailable')
 await settle(reads[7], ok([], false))
 assert(text().includes('Process runtime unavailable.') && !text().includes('No running background'), 'unavailable is distinct from empty')
 await render('empty')
 await settle(reads[8], ok())
 assert(text().includes('No running background processes.'), 'authoritative empty result')
 assert(text().includes('Stop turn leaves these running.'), 'turn-stop behavior explained')
 await poll()
 const pending = reads[9]
 await act(async () => root.unmount())
 assert(timers.size === 0, 'unmount clears poll timer')
 await settle(pending, ok([job('late')]))
 assert(!text().includes('late') && timers.size === 0, 'unmount rejects late reads and rescheduling')
 console.log('BACKGROUND_PROCESS_TEST_PASS')
} catch (error) { console.error('BACKGROUND_PROCESS_TEST_FAIL', error.stack || String(error)) }
finally { window.setTimeout = nativeTimeout; window.clearTimeout = nativeClear }
`
try {
    const source = await readFile(component, 'utf8')
    assert.doesNotMatch(source, /AssistantActivity|activityFeed|getAssistantActivityFeed|latestTurn/, 'saved history cannot infer live processes')
    const build = await Bun.build({
        entrypoints: ['background-process-harness'], target: 'browser',
        plugins: [{ name: 'isolated-harness', setup(builder) {
            const mockModules = {
                '@/lib/assistant/store': 'export const useAssistantStoreSelector = selector => selector(window.__assistantState); export const useAssistantStoreActions = () => ({});',
                '@/lib/settings': 'export const useSettings = () => ({settings:{}});',
                './useAssistantSessionTurnUsage': 'export const useAssistantSessionTurnUsage = () => ({sessionTurnUsage:null,sessionTurnUsageLoading:false});',
                './useAssistantPageSidebarState': 'export const SIDEBAR_EFFORT_LABELS = {high:"High"};',
                './assistant-composer-controller-constants': 'export const getProfileLabel = () => "Supervised";'
            }
            builder.onResolve({ filter: /^(?:@\/|@shared\/|\.\/)/ }, args => {
                if (args.path in mockModules) return {path:args.path, namespace:'mock'}
                const base = args.path.startsWith('@/') ? resolve(import.meta.dir, '../src/renderer/src', args.path.slice(2))
                    : args.path.startsWith('@shared/') ? resolve(import.meta.dir, '../src/shared', args.path.slice(8)) : null
                if (base) return {path:['.ts','.tsx','.js','/index.ts','/index.tsx'].map(suffix => base + suffix).find(existsSync) || base}
            })
            builder.onLoad({ filter: /.*/, namespace:'mock' }, args => ({contents:mockModules[args.path],loader:'js'}))
            builder.onResolve({ filter: /^background-process-harness$/ }, () => ({ path: 'harness', namespace: 'fixture' }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'tsx', resolveDir: resolve(import.meta.dir, '..') }))
        } }]
    })
    if (!build.success) throw new Error(build.logs.map(String).join('\n'))
    await writeFile(join(directory, 'test.js'), await build.outputs[0].text())
    await writeFile(join(directory, 'test.html'), '<div id="root"></div><script type="module" src="test.js"></script>')
    await writeFile(join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
app.whenReady().then(async () => {
 const window = new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}})
 window.webContents.on('console-message', (event, _level, legacyMessage) => {
  const message = typeof legacyMessage === 'string' ? legacyMessage : event.message
  console.log(message)
  if (message.includes('BACKGROUND_PROCESS_TEST_PASS')) app.exit(0)
  if (message.includes('BACKGROUND_PROCESS_TEST_FAIL')) app.exit(1)
 })
 await window.loadFile(${JSON.stringify(join(directory, 'test.html'))})
})
setTimeout(() => { console.error('Background process test timed out'); app.exit(1) }, 30000)
`)
    const electron = createRequire(import.meta.url)('electron') as string
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [join(directory, 'main.cjs')], { stdio: 'inherit', env })
    const code = await new Promise<number>((resolveCode, reject) => {
        child.on('error', reject)
        child.on('exit', code => resolveCode(code ?? 1))
    })
    if (code !== 0) throw new Error(`Background process fixture exited ${code}`)
    console.log('Background process controls: isolated React states, exact-thread stops, races and cleanup: ok')
} finally {
    await rm(directory, { recursive: true, force: true })
}
