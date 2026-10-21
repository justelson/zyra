import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeJsonAtomically } from '../setup/atomic-json'

export type AppOperationReceipt = { operationId: string; actor: string; fingerprint: string; domain: string; operation: string;
    phase: 'claimed' | 'completed' | 'failed'; createdAt: string; completedAt?: string; result?: Record<string, unknown>; error?: string }
type Claim = Pick<AppOperationReceipt, 'operationId' | 'actor' | 'fingerprint'>

/** Bounded result history, durable append-only identity claims. One Desktop-profile owner serializes effects. */
export class AppOperationReceipts {
    private loaded: Promise<void> | null = null
    private records: AppOperationReceipt[] = []
    private claims = new Map<string, Claim>()
    private queue: Promise<unknown> = Promise.resolve()
    constructor(private readonly filePath: string) {}
    private validClaim(value: Claim) { return value && /^[a-f0-9]{64}$/.test(value.operationId) && typeof value.actor === 'string' && value.actor.length > 0 && value.actor.length <= 512 && /^[a-f0-9]{64}$/.test(value.fingerprint) }
    private async appendClaims(claims: Claim[]) {
        if (!claims.length) return
        await mkdir(dirname(this.filePath), { recursive: true })
        const file = await open(`${this.filePath}.claims.jsonl`, 'a', 0o600)
        try { await file.writeFile(claims.map(value => JSON.stringify(value)).join('\n') + '\n', 'utf8'); await file.sync() }
        finally { await file.close() }
    }
    private load(): Promise<void> {
        return this.loaded ||= (async () => {
            try {
                const value = JSON.parse(await readFile(this.filePath, 'utf8'))
                if (value?.version !== 1 || !Array.isArray(value.receipts) || value.receipts.some((row: AppOperationReceipt) => !this.validClaim(row))) throw new Error('Invalid app receipt journal.')
                this.records = value.receipts
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
            try {
                const source = await readFile(`${this.filePath}.claims.jsonl`, 'utf8')
                if (source && !source.endsWith('\n')) throw new Error('Incomplete durable app claim. Automatic delivery is blocked.')
                for (const line of source.split('\n').filter(Boolean)) {
                    const claim = JSON.parse(line) as Claim
                    if (!this.validClaim(claim)) throw new Error('Invalid durable app claim. Automatic delivery is blocked.')
                    const old = this.claims.get(claim.operationId)
                    if (old && (old.actor !== claim.actor || old.fingerprint !== claim.fingerprint)) throw new Error('Conflicting durable app claim.')
                    this.claims.set(claim.operationId, claim)
                }
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
            // Migrate retained v1 claims before result retention can evict them.
            const missing = this.records.filter(row => !this.claims.has(row.operationId)).map(({ operationId, actor, fingerprint }) => ({ operationId, actor, fingerprint }))
            await this.appendClaims(missing)
            for (const claim of missing) this.claims.set(claim.operationId, claim)
            for (const row of this.records) {
                const claim = this.claims.get(row.operationId)!
                if (claim.actor !== row.actor || claim.fingerprint !== row.fingerprint) throw new Error('The receipt and durable app claim disagree.')
            }
        })()
    }
    private async save() {
        const retained = this.records.slice(-500)
        await writeJsonAtomically(this.filePath, { version: 1, receipts: retained })
        this.records = retained
    }
    async history(actor: string, waitForWrites = true) {
        await this.load(); if (waitForWrites) await this.queue
        return structuredClone(this.records.filter(item => item.actor === actor).slice(-50))
    }
    /** Compensation only, called inside run's serialized owner queue before cleanup. */
    async invalidateForkPreparation(operationId: string, actor: string) {
        await this.load()
        const receipt = this.records.find(item => item.operationId === operationId)
        if (!receipt || receipt.actor !== actor || receipt.domain !== 'app' || receipt.operation !== 'fork_prepare' || receipt.phase !== 'completed') throw new Error('The exact completed fork preparation is unavailable for cleanup.')
        const previous = structuredClone(receipt)
        receipt.phase = 'failed'
        receipt.error = 'This fork preparation was cancelled. Inspect retained state before starting a new operation.'
        delete receipt.result
        try { await this.save() }
        catch (error) { delete receipt.error; Object.assign(receipt, previous); throw error }
    }
    run(request: { operationId: string; actor: string; domain: string; operation: string; params: unknown }, work: () => Promise<Record<string, unknown>>, authorize?: () => Promise<void>) {
        const execute = async () => {
            await this.load()
            // Replay is a data delivery too. Reauthorize inside the serialized
            // queue, not before waiting behind a different owner operation.
            await authorize?.()
            const fingerprint = createHash('sha256').update(JSON.stringify({ domain: request.domain, operation: request.operation, params: request.params })).digest('hex')
            const claim = { operationId: request.operationId, actor: request.actor, fingerprint }
            if (!this.validClaim(claim)) throw new Error('Invalid app operation identity.')
            const old = this.records.find(item => item.operationId === request.operationId)
            const admitted = this.claims.get(request.operationId)
            if (old || admitted) {
                const prior = old || admitted!
                if (prior.actor !== request.actor || prior.fingerprint !== fingerprint) throw new Error('App operation ID was reused for different arguments.')
                if (old?.phase === 'completed') return { ...structuredClone(old.result), replayed: true, operationId: old.operationId }
                if (!old) throw new Error('This operation was already claimed, but its detailed receipt expired. Inspect current state; automatic replay is blocked.')
                throw new Error(old.phase === 'claimed' ? 'Delivery is uncertain after interruption. Inspect current state before issuing a new operation.' : old.error || 'The earlier operation failed. Inspect state and use a new operation ID.')
            }
            // Identity admission survives result/history pruning and restart.
            await this.appendClaims([claim]); this.claims.set(claim.operationId, claim)
            const receipt: AppOperationReceipt = { operationId: request.operationId, actor: request.actor, domain: request.domain, operation: request.operation, fingerprint, phase: 'claimed', createdAt: new Date().toISOString() }
            this.records.push(receipt)
            await this.save()
            try {
                const result = await work()
                receipt.result = structuredClone(result); receipt.phase = 'completed'; receipt.completedAt = new Date().toISOString()
                try { await this.save() }
                catch (error) {
                    receipt.phase = 'claimed'; delete receipt.result; delete receipt.completedAt
                    throw Object.assign(new Error('The side effect may have completed, but its receipt was not saved. Inspect current state before retrying.'), { receiptUncertain: true, cause: error })
                }
                return { ...result, operationId: receipt.operationId }
            } catch (error) {
                if (!(error && typeof error === 'object' && 'receiptUncertain' in error) && receipt.phase !== 'completed') {
                    receipt.phase = 'failed'; receipt.error = 'The owning service failed or did not confirm completion. Inspect current state before issuing a new operation.'
                    await this.save()
                }
                throw error
            }
        }
        const next = this.queue.catch(() => {}).then(execute)
        this.queue = next.catch(() => {})
        return next
    }
}
