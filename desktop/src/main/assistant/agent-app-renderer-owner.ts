import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { AGENT_APP_IPC, type RendererAppResponse } from '../../shared/agent-app-operations'
import type { AppRequest } from './agent-app-service'

/** Replies are bound to the exact trusted renderer that owns the profile state. */
export function createAgentAppRendererOwner(getOwner: () => WebContents | null) {
    const pending = new Map<string, { owner: WebContents; resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    ipcMain.on(AGENT_APP_IPC.response, (event, response: RendererAppResponse) => {
        const item = pending.get(response?.requestId)
        if (!item || event.sender !== item.owner || event.sender.isDestroyed() || event.senderFrame !== item.owner.mainFrame) return
        pending.delete(response.requestId); clearTimeout(item.timer)
        if (response.error) item.reject(new Error(String(response.error).slice(0, 2000)))
        else if (response.result && typeof response.result === 'object') item.resolve(response.result)
        else item.reject(new Error('The app owner returned an invalid receipt.'))
    })
    return (request: AppRequest): Promise<Record<string, unknown>> => {
        const owner = getOwner()
        if (!owner || owner.isDestroyed()) return Promise.reject(new Error('The Desktop profile owner is unavailable. No browser or other device was substituted.'))
        if (pending.size >= 32) return Promise.reject(new Error('Too many pending app-owner operations.'))
        const requestId = randomUUID()
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('The Desktop profile did not acknowledge the operation. Inspect current state before retrying.')) }, 10_000)
            timer.unref?.()
            pending.set(requestId, { owner, resolve, reject, timer })
            owner.send(AGENT_APP_IPC.request, { requestId, request })
        })
    }
}
