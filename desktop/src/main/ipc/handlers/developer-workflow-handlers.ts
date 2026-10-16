import { app, type IpcMain } from 'electron'
import { join } from 'node:path'
import { DeveloperTasks } from '../../services/developer-tasks'
import { previewRecordedUndo, applyRecordedUndo } from '../../services/developer-undo'
import { getAugmentedEnv } from '../../inspectors/safe-exec'

let developerTasks: DeveloperTasks | null = null

export async function disposeDeveloperWorkflowTasks(): Promise<void> {
    await developerTasks?.dispose()
}

export function registerDeveloperWorkflowHandlers(ipcMain: Pick<IpcMain, 'handle'>) {
    const tasks = developerTasks = new DeveloperTasks(join(app.getPath('userData'), 'developer-tasks.json'), getAugmentedEnv())
    const undoOwners = new Map<string, { senderId: number; expiresAt: number }>()
    const handle = (channel: string, execute: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<object>) => ipcMain.handle(channel, async (event, ...args) => {
        try { return { success: true, ...await execute(event, ...args) } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Developer action failed.' } }
    })
    handle('devscope:developerWorkspace', async (_event, root: string) => ({ workspace: await tasks.workspace(root) }))
    handle('devscope:startDeveloperTask', async (_event, root: string, name: string) => ({ task: await tasks.start(root, name) }))
    handle('devscope:stopDeveloperTask', async (_event, id: string) => { await tasks.stop(id); return {} })
    handle('devscope:previewRecordedUndo', async (event, root: string, patch: string) => {
        const preview = await previewRecordedUndo(root, patch)
        for (const [key, owner] of undoOwners) if (owner.expiresAt < Date.now()) undoOwners.delete(key)
        while (undoOwners.size >= 20) undoOwners.delete(undoOwners.keys().next().value!)
        undoOwners.set(preview.token, { senderId: event.sender.id, expiresAt: Date.now() + 120_000 })
        return preview
    })
    handle('devscope:applyRecordedUndo', async (event, token: string) => {
        const owner = undoOwners.get(token)
        if (owner?.senderId !== event.sender.id || owner.expiresAt < Date.now()) throw new Error('Restore preview is unavailable in this window.')
        undoOwners.delete(token); await applyRecordedUndo(token); return {}
    })
}
