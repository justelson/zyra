import { createHash } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeJsonAtomically } from '../setup/atomic-json'

export type QueuedPromptDeliveryResult = {
    success: true
    sessionId: string
    threadId: string
    turnId?: string
}

type Input = { sessionId: string; entryId: string; payload: unknown }
type Claim = {
    sessionId: string
    payloadHash: string
    cancelled: boolean
    promise: Promise<QueuedPromptDeliveryResult>
}
type PendingReceipt = {
    schemaVersion: 1
    state: 'pending'
    keyHash: string
    payloadHash: string
    sessionId: string
    entryId: string
}
type AcceptedReceipt = Omit<PendingReceipt, 'state'> & {
    state: 'accepted'
    result: QueuedPromptDeliveryResult
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024
        && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Normalize JSON object order, including after IPC serialization. No payload is retained.
function canonicalJson(value: unknown): string {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('Queued prompt payload must be JSON serializable.')
    const canonical = (item: unknown): string => {
        if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
        if (record(item)) return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
        return JSON.stringify(item)!
    }
    return canonical(JSON.parse(encoded))
}

function uncertain(): Error {
    return new Error('Uncertain queued prompt delivery: the receipt is pending or unreadable. Do not automatically resubmit.')
}

function cancelled(): Error {
    return new Error('Queued prompt delivery cancelled before dispatch.')
}

function validateResult(value: unknown, sessionId: string): QueuedPromptDeliveryResult {
    if (!record(value) || value.success !== true || value.sessionId !== sessionId
        || !validId(value.threadId) || (value.turnId !== undefined && !validId(value.turnId))) {
        throw new Error('Invalid queued prompt delivery result identity.')
    }
    // Persist only the receipt contract, never extra runtime fields.
    return { success: true, sessionId, threadId: value.threadId,
        ...(value.turnId === undefined ? {} : { turnId: value.turnId as string }) }
}

/** One AssistantService-owned instance per directory; this is not a multi-process lock. */
export class QueuedPromptDeliveryOwner {
    private readonly inFlight = new Map<string, Claim>()

    constructor(private readonly directory: string) {}

    get pendingCount(): number { return this.inFlight.size }

    cancelPending(sessionId?: string): void {
        // Keep claims installed until their safe cleanup finishes. A late markSubmitted
        // must still fail, even if the caller has already moved to another request.
        for (const claim of this.inFlight.values()) {
            if (sessionId === undefined || claim.sessionId === sessionId) claim.cancelled = true
        }
    }

    run(input: Input, deliver: (markSubmitted: () => void) => Promise<QueuedPromptDeliveryResult>): Promise<QueuedPromptDeliveryResult> {
        let keyHash: string
        let payloadHash: string
        try {
            if (!validId(input.sessionId) || !validId(input.entryId)) throw new Error('Invalid queued prompt delivery IDs.')
            keyHash = hash(JSON.stringify([input.sessionId, input.entryId]))
            payloadHash = hash(canonicalJson(input.payload))
        } catch {
            return Promise.reject(new Error('Invalid queued prompt delivery IDs or JSON payload.'))
        }
        const existing = this.inFlight.get(keyHash)
        if (existing) {
            if (existing.payloadHash !== payloadHash) return Promise.reject(new Error('Queued prompt entry ID reused with a conflicting payload.'))
            return existing.promise
        }
        const claim: Claim = { sessionId: input.sessionId, payloadHash, cancelled: false, promise: undefined! }
        // Snapshot scope before any asynchronous work (the caller can mutate input).
        const scope = { sessionId: input.sessionId, entryId: input.entryId }
        this.inFlight.set(keyHash, claim)
        claim.promise = Promise.resolve().then(() => this.deliver(scope, keyHash, claim, deliver)).finally(() => {
            this.inFlight.delete(keyHash)
        })
        return claim.promise
    }

    private async deliver(
        scope: Pick<Input, 'sessionId' | 'entryId'>,
        keyHash: string,
        claim: Claim,
        deliver: (markSubmitted: () => void) => Promise<QueuedPromptDeliveryResult>,
    ): Promise<QueuedPromptDeliveryResult> {
        const file = join(this.directory, `${keyHash}.json`)
        const checkCancelled = (): void => { if (claim.cancelled) throw cancelled() }
        checkCancelled()
        let stored: unknown
        try {
            const handle = await open(file, 'r')
            try {
                if ((await handle.stat()).size > 16 * 1024) throw uncertain()
                stored = JSON.parse(await handle.readFile('utf8'))
            } finally { await handle.close() }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw uncertain()
        }
        checkCancelled()
        if (stored !== undefined) {
            if (!record(stored) || stored.schemaVersion !== 1 || !['pending', 'accepted'].includes(stored.state as string)
                || !/^[a-f0-9]{64}$/.test(stored.payloadHash as string)
                || stored.keyHash !== keyHash || stored.sessionId !== scope.sessionId || stored.entryId !== scope.entryId) throw uncertain()
            if (stored.payloadHash !== claim.payloadHash) throw new Error('Queued prompt entry ID reused with a conflicting payload.')
            if (stored.state === 'pending') throw uncertain()
            try { return validateResult(stored.result, scope.sessionId) } catch { throw uncertain() }
        }
        const pending: PendingReceipt = { schemaVersion: 1, state: 'pending', keyHash, payloadHash: claim.payloadHash, ...scope }
        let created = false
        let submitted = false
        let callbackClosed = false
        try {
            await writeJsonAtomically(file, pending)
            created = true
            checkCancelled()
            const result = validateResult(await deliver(() => {
                checkCancelled()
                if (callbackClosed) throw new Error('Queued prompt dispatch claim is closed.')
                // The connection may retry an explicitly rejected attachment. Marking
                // the same live delivery again is safe; cancellation still wins.
                submitted = true
            }), scope.sessionId)
            callbackClosed = true
            if (!submitted) throw new Error('Queued prompt callback returned without marking runtime submission.')
            const accepted: AcceptedReceipt = { ...pending, state: 'accepted', result }
            try {
                await writeJsonAtomically(file, accepted)
            } catch {
                // An atomic writer can fail after rename (directory fsync). Restore
                // uncertainty when possible; never remove the pending claim here.
                await writeJsonAtomically(file, pending).catch(() => undefined)
                throw uncertain()
            }
            return result
        } catch (error) {
            if (created && !submitted) {
                // Only this invocation's successfully-created, undispatched receipt.
                // Cleanup failure leaves the durable claim fail-closed.
                await rm(file)
            }
            throw error
        } finally {
            callbackClosed = true
        }
    }
}
