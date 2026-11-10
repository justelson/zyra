import { randomUUID } from 'node:crypto'
import type { DevScopeBrowserCaptureDraft } from '../shared/contracts/devscope-api'

const pending: DevScopeBrowserCaptureDraft[] = []
let launch: (() => void) | undefined
let receiver: (() => number | undefined) | undefined

export function configureBrowserCaptureHandoff(open: () => void, mainRenderer: () => number | undefined) {
    launch = open
    receiver = mainRenderer
}

export function enqueueBrowserCaptureDraft(draft: Omit<DevScopeBrowserCaptureDraft, 'id'>) {
    if (!launch || pending.length >= 16) throw new Error('Chat is unavailable. Try attaching the capture again.')
    const item = { ...draft, id: randomUUID() }
    pending.push(item)
    try { launch() } catch (error) { pending.splice(pending.indexOf(item), 1); throw error }
}

export function readBrowserCaptureDraft(senderId: number) {
    if (receiver?.() !== senderId) throw new Error('Only the main chat window can receive captures.')
    return pending[0] || null
}

export function acknowledgeBrowserCaptureDraft(senderId: number, id: string) {
    if (receiver?.() !== senderId) throw new Error('Only the main chat window can receive captures.')
    if (pending[0]?.id === id) pending.shift()
}
