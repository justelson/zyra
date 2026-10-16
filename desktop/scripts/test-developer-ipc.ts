import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'

const directory = await mkdtemp(join(tmpdir(), 'zyra-developer-ipc-'))
const handlers = new Map<string, (...args: any[]) => unknown>()
const native = { handle: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler) }
mock.module('electron', () => ({ app: { getPath: () => directory, isPackaged: false, once: () => undefined }, ipcMain: native }))
try {
    const { ipcMain, registerTrustedIpcSender } = await import('../src/main/ipc/trusted-ipc')
    const { createOnboardingGatedIpcMain } = await import('../src/main/ipc/onboarding-ipc-gate')
    const { registerDeveloperWorkflowHandlers, disposeDeveloperWorkflowTasks } = await import('../src/main/ipc/handlers/developer-workflow-handlers')
    let accessAllowed = false
    const guarded = createOnboardingGatedIpcMain(ipcMain as any, { isAccessAllowed: () => accessAllowed,
        allowedBeforeOnboarding: new Set(), blockedResult: () => ({ success: false, error: 'Setup is required' }) })
    registerDeveloperWorkflowHandlers(guarded)
    const mainFrame = { url: 'file:///fixture.html' }
    const sender = Object.assign(new EventEmitter(), { id: 101, mainFrame, isDestroyed: () => false })
    const invoke = (event: unknown) => Promise.resolve().then(() => handlers.get('devscope:developerWorkspace')!(event, directory))
    await assert.rejects(invoke({ sender, senderFrame: mainFrame }), /untrusted renderer/, 'An unregistered renderer cannot inspect folders or invoke developer operations')
    registerTrustedIpcSender(sender as any, url => url === mainFrame.url)
    assert.deepEqual(await invoke({ sender, senderFrame: mainFrame }), { success: false, error: 'Setup is required' }, 'Developer IPC retains onboarding policy')
    accessAllowed = true
    await assert.rejects(invoke({ sender, senderFrame: { ...mainFrame } }), /untrusted renderer/, 'Same URL in a child frame does not inherit authority')
    const result = await invoke({ sender, senderFrame: mainFrame }) as any
    assert.equal(result.success, true)
    assert.equal(result.workspace.root.replace(/\\/g, '/'), directory.replace(/\\/g, '/'))
    await disposeDeveloperWorkflowTasks()
    console.log('Actual developer IPC preserves exact sender/frame trust and onboarding, then serves an authorized workspace.')
} finally { await rm(directory, { recursive: true, force: true }) }
