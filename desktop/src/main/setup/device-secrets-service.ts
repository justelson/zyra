import { readFile } from 'node:fs/promises'
import type {
    BrowserIntegrationSecretStatus,
    HostedAiSecrets,
    HostedAiSecretStatus,
    UpdateBrowserIntegrationSecretsInput,
    UpdateHostedAiSecretsInput
} from '../../shared/preferences/secrets-contracts'
import { writeBytesAtomically } from './atomic-json'

type SecretEncryption = {
    isAvailable(): boolean
    encrypt(value: string): Buffer
    decrypt(value: Buffer): string
}

type SecretRecord = {
    schemaVersion: 1
    groqApiKey: string
    geminiApiKey: string
    unsplashAccessKey: string
    legacyMigrationCompletedAt: string | null
    updatedAt: string
}

function emptyRecord(now: string): SecretRecord {
    return {
        schemaVersion: 1,
        groqApiKey: '',
        geminiApiKey: '',
        unsplashAccessKey: '',
        legacyMigrationCompletedAt: null,
        updatedAt: now
    }
}

function sanitizeSecret(value: unknown): string {
    if (typeof value !== 'string') return ''
    const normalized = value.trim()
    if (!normalized || /[\u0000-\u001f\u007f\s]/.test(normalized)) return ''
    return normalized.slice(0, 4_096)
}

function parseRecord(value: unknown, now: string): SecretRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyRecord(now)
    const candidate = value as Partial<SecretRecord>
    if (candidate.schemaVersion !== 1) return emptyRecord(now)
    return {
        schemaVersion: 1,
        groqApiKey: sanitizeSecret(candidate.groqApiKey),
        geminiApiKey: sanitizeSecret(candidate.geminiApiKey),
        unsplashAccessKey: sanitizeSecret(candidate.unsplashAccessKey),
        legacyMigrationCompletedAt: typeof candidate.legacyMigrationCompletedAt === 'string'
            ? candidate.legacyMigrationCompletedAt
            : null,
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now
    }
}

export class DeviceSecretsService {
    private record: SecretRecord | null = null
    private loadPromise: Promise<SecretRecord> | null = null
    private operationQueue: Promise<void> = Promise.resolve()

    constructor(
        private readonly filePath: string,
        private readonly encryption: SecretEncryption,
        private readonly now: () => Date = () => new Date()
    ) {}

    async getHostedAiKey(provider: 'groq' | 'gemini'): Promise<string> {
        const record = await this.load()
        return provider === 'groq' ? record.groqApiKey : record.geminiApiKey
    }

    isPersistenceAvailable(): boolean {
        return this.encryption.isAvailable()
    }

    async getUnsplashAccessKey(): Promise<string> {
        return (await this.load()).unsplashAccessKey
    }

    async getHostedAiStatus(): Promise<HostedAiSecretStatus> {
        return this.status(await this.load())
    }

    /** Test/support boundary; decrypted keys are never exposed through IPC. */
    async getHostedAiKeys(): Promise<{ secrets: HostedAiSecrets; status: HostedAiSecretStatus }> {
        const record = await this.load()
        return {
            secrets: {
                groqApiKey: record.groqApiKey,
                geminiApiKey: record.geminiApiKey
            },
            status: this.status(record)
        }
    }

    updateHostedAiKeys(input: UpdateHostedAiSecretsInput): Promise<{ status: HostedAiSecretStatus }> {
        return this.enqueue(async () => {
            const record = await this.load()
            const hasGroqUpdate = Object.prototype.hasOwnProperty.call(input || {}, 'groqApiKey')
            const hasGeminiUpdate = Object.prototype.hasOwnProperty.call(input || {}, 'geminiApiKey')
            const groqApiKey = hasGroqUpdate ? sanitizeSecret(input?.groqApiKey) : record.groqApiKey
            const geminiApiKey = hasGeminiUpdate ? sanitizeSecret(input?.geminiApiKey) : record.geminiApiKey
            const removesExistingCredential = (hasGroqUpdate && Boolean(record.groqApiKey) && !groqApiKey)
                || (hasGeminiUpdate && Boolean(record.geminiApiKey) && !geminiApiKey)
            if (removesExistingCredential && input?.confirmClear !== true) {
                throw Object.assign(new Error('Confirm before removing saved hosted-provider API keys.'), {
                    code: 'CONFIRMATION_REQUIRED'
                })
            }
            const next: SecretRecord = {
                ...record,
                groqApiKey,
                geminiApiKey,
                updatedAt: this.now().toISOString()
            }
            await this.persist(next)
            return { status: this.status(next) }
        })
    }

    updateBrowserIntegrationSecrets(input: UpdateBrowserIntegrationSecretsInput): Promise<{ status: BrowserIntegrationSecretStatus }> {
        return this.enqueue(async () => {
            const record = await this.load()
            const hasUpdate = Object.prototype.hasOwnProperty.call(input || {}, 'unsplashAccessKey')
            const unsplashAccessKey = hasUpdate ? sanitizeSecret(input?.unsplashAccessKey) : record.unsplashAccessKey
            if (hasUpdate && record.unsplashAccessKey && !unsplashAccessKey && input?.confirmClear !== true) {
                throw Object.assign(new Error('Confirm before removing the saved Unsplash access key.'), {
                    code: 'CONFIRMATION_REQUIRED'
                })
            }
            const next: SecretRecord = {
                ...record,
                unsplashAccessKey,
                updatedAt: this.now().toISOString()
            }
            await this.persist(next)
            return { status: this.browserIntegrationStatus(next) }
        })
    }

    migrateLegacyHostedAiKeys(input: UpdateHostedAiSecretsInput): Promise<{ status: HostedAiSecretStatus }> {
        return this.enqueue(async () => {
            const record = await this.load()
            if (record.legacyMigrationCompletedAt) return { status: this.status(record) }
            const next: SecretRecord = {
                ...record,
                // A previously saved OS-owned value wins over a late renderer migration.
                groqApiKey: record.groqApiKey || sanitizeSecret(input?.groqApiKey),
                geminiApiKey: record.geminiApiKey || sanitizeSecret(input?.geminiApiKey),
                legacyMigrationCompletedAt: this.now().toISOString(),
                updatedAt: this.now().toISOString()
            }
            await this.persist(next)
            return { status: this.status(next) }
        })
    }

    private browserIntegrationStatus(record: SecretRecord): BrowserIntegrationSecretStatus {
        return {
            unsplashConfigured: Boolean(record.unsplashAccessKey),
            persistenceAvailable: this.encryption.isAvailable()
        }
    }

    private status(record: SecretRecord): HostedAiSecretStatus {
        return {
            groqConfigured: Boolean(record.groqApiKey),
            geminiConfigured: Boolean(record.geminiApiKey),
            persistenceAvailable: this.encryption.isAvailable(),
            legacyMigrationComplete: Boolean(record.legacyMigrationCompletedAt)
        }
    }

    private load(): Promise<SecretRecord> {
        if (this.record) return Promise.resolve(this.record)
        if (!this.loadPromise) {
            this.loadPromise = this.readFromDisk().then((record) => {
                this.record = record
                return record
            })
        }
        return this.loadPromise
    }

    private async readFromDisk(): Promise<SecretRecord> {
        const now = this.now().toISOString()
        if (!this.encryption.isAvailable()) return emptyRecord(now)
        try {
            const encrypted = await readFile(this.filePath)
            const plaintext = this.encryption.decrypt(encrypted)
            return parseRecord(JSON.parse(plaintext), now)
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return emptyRecord(now)
            // Fail closed: an unreadable secret file never leaks or falls back to plaintext.
            return emptyRecord(now)
        }
    }

    private async persist(record: SecretRecord): Promise<void> {
        if (!this.encryption.isAvailable()) {
            throw new Error('Secure OS credential storage is unavailable. Zyra did not save these API keys.')
        }
        const encrypted = this.encryption.encrypt(JSON.stringify(record))
        await writeBytesAtomically(this.filePath, encrypted)
        this.record = record
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const next = this.operationQueue.then(work)
        this.operationQueue = next.then(() => undefined, () => undefined)
        return next
    }
}
