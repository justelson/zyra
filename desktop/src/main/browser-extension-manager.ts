import { app, dialog, type BrowserWindow, type Extension, type Session } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import log from 'electron-log'
import { getGlobalBrowserSession } from './ipc/handlers/browser-preview-handlers'
import type { BrowserExtensionRecord } from '../shared/browser-extensions'
import { downloadChromeWebStoreCrx, extractCrxToDirectory } from './browser-extension-crx'
import { chromeWebStoreIdFromUrl } from '../shared/browser-web-store'

type StoredExtension = Omit<BrowserExtensionRecord, 'warnings'> & { warnings?: string[] }
type ExtensionManifest = {
    manifest_version?: number
    name?: string
    version?: string
    description?: string
    permissions?: unknown
    host_permissions?: unknown
    optional_permissions?: unknown
    key?: string
}

const STORE_DIRECTORY = 'zyra-browser-extensions'
const STORE_FILE = 'browser-extensions.json'

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 128) : []
}

function extensionStorageRoot(): string {
    return join(app.getPath('userData'), STORE_DIRECTORY)
}

function extensionConfigPath(): string {
    return join(app.getPath('userData'), STORE_FILE)
}

async function readManifest(root: string): Promise<ExtensionManifest & { name: string; version: string }> {
    let raw: string
    try {
        raw = await readFile(join(root, 'manifest.json'), 'utf8')
    } catch {
        throw new Error('The selected folder does not contain a readable manifest.json file.')
    }
    if (raw.length > 512 * 1024) throw new Error('The extension manifest is too large.')
    let manifest: ExtensionManifest
    try { manifest = JSON.parse(raw) as ExtensionManifest } catch { throw new Error('The extension manifest is not valid JSON.') }
    if (manifest.manifest_version !== 3) throw new Error('Only Manifest V3 extensions are supported in Zyra Browser.')
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('The extension manifest has no valid name.')
    if (typeof manifest.version !== 'string' || !manifest.version.trim()) throw new Error('The extension manifest has no valid version.')
    return manifest as ExtensionManifest & { name: string; version: string }
}

async function readStored(): Promise<StoredExtension[]> {
    try {
        const raw = await readFile(extensionConfigPath(), 'utf8')
        const value = JSON.parse(raw) as unknown
        if (!Array.isArray(value)) return []
        return value.filter((item): item is StoredExtension => Boolean(item && typeof item === 'object' && typeof (item as StoredExtension).id === 'string' && typeof (item as StoredExtension).path === 'string'))
    } catch { return [] }
}

async function writeStored(entries: StoredExtension[]): Promise<void> {
    await writeFile(extensionConfigPath(), `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
}

function displayRecord(entry: StoredExtension): BrowserExtensionRecord {
    return { ...entry, warnings: Array.isArray(entry.warnings) ? entry.warnings : [] }
}

function parseChromeWebStoreId(value: string): string {
    const input = String(value || '').trim()
    const id = /^[a-p]{32}$/.test(input) ? input : chromeWebStoreIdFromUrl(input)
    if (!id) throw new Error('Enter a Chrome Web Store URL or its 32-character extension ID.')
    return id
}

function extensionWarnings(manifest: ExtensionManifest): string[] {
    const permissions = [...asStringArray(manifest.permissions), ...asStringArray(manifest.host_permissions)]
    const warnings: string[] = []
    if (permissions.includes('<all_urls>') || permissions.includes('*://*/*')) warnings.push('Can read or modify most websites.')
    if (permissions.some(permission => ['cookies', 'history', 'downloads', 'management', 'nativeMessaging', 'debugger'].includes(permission))) warnings.push('Requests access to sensitive browser capabilities.')
    const optional = asStringArray(manifest.optional_permissions)
    if (optional.length > 0) warnings.push('Optional permission prompts are not supported in Zyra Browser.')
    // Confirmed missing in the bundled Electron host. Unlisted APIs can be provisional.
    const unsupported = [...new Set([...permissions, ...optional].filter(permission => ['contextMenus', 'fontSettings'].includes(permission)))]
    if (unsupported.length > 0) warnings.push(`Some features may not work. Unsupported browser APIs: ${unsupported.join(', ')}.`)
    return [...new Set(warnings)]
}

export class BrowserExtensionManager {
    private browserSession: Session | undefined
    private readonly loaded = new Map<string, Extension>()
    private readonly pending = new Map<string, { destination: string; manifest: ExtensionManifest & { name: string; version: string }; metadata: Pick<StoredExtension, 'source' | 'storeUrl' | 'sha256'> }>()
    private operation: Promise<unknown> = Promise.resolve()

    constructor(session?: Session) {
        this.browserSession = session
    }

    private get session(): Session {
        return this.browserSession ??= getGlobalBrowserSession()
    }

    async list(): Promise<BrowserExtensionRecord[]> {
        return (await readStored()).map(displayRecord)
    }

    async loadEnabled(): Promise<void> {
        await this.runExclusive(async () => {
            for (const entry of await readStored()) {
                if (!entry.enabled || this.loaded.has(entry.id)) continue
                if (!existsSync(join(entry.path, 'manifest.json'))) {
                    log.warn(`[BrowserExtensions] Missing extension files for ${entry.name}`)
                    continue
                }
                try {
                    const extension = await this.session.extensions.loadExtension(entry.path, { allowFileAccess: false })
                    this.loaded.set(entry.id, extension)
                } catch (error) {
                    log.warn(`[BrowserExtensions] Could not load ${entry.name}`, error)
                }
            }
        })
    }

    async chooseAndInstall(window: BrowserWindow): Promise<BrowserExtensionRecord> {
        const result = await dialog.showOpenDialog(window, { title: 'Choose an unpacked Chrome extension', properties: ['openDirectory'] })
        if (result.canceled || !result.filePaths[0]) throw new Error('Extension installation cancelled.')
        return this.install(result.filePaths[0])
    }

    async install(sourcePath: string): Promise<BrowserExtensionRecord> {
        return this.runExclusive(async () => {
            const source = resolve(sourcePath)
            const manifest = await readManifest(source)
            const sourceHash = createHash('sha256').update(`${source}\0${manifest.name}\0${manifest.version}`).digest('hex').slice(0, 24)
            const destination = join(extensionStorageRoot(), sourceHash)
            await mkdir(extensionStorageRoot(), { recursive: true })
            if (source !== resolve(destination)) {
                await rm(destination, { recursive: true, force: true })
                await cp(source, destination, { recursive: true, dereference: true, filter: (path) => !path.includes('node_modules') })
            }
            return this.registerInstalled(destination, manifest)
        })
    }

    async inspectWebStore(urlOrId: string): Promise<BrowserExtensionRecord> {
        return this.runExclusive(async () => {
            const id = parseChromeWebStoreId(urlOrId)
            if (this.pending.has(id)) throw new Error('This extension is already awaiting permission review.')
            const downloaded = await downloadChromeWebStoreCrx(id)
            const destination = join(extensionStorageRoot(), `.pending-${id}-${randomUUID()}`)
            await mkdir(extensionStorageRoot(), { recursive: true })
            let manifest: ExtensionManifest & { name: string; version: string }
            try {
                await extractCrxToDirectory(downloaded.bytes, destination, id)
                manifest = await readManifest(destination)
            } catch (error) {
                await rm(destination, { recursive: true, force: true })
                throw error
            }
            const metadata = { source: 'chrome-web-store' as const, storeUrl: `https://chromewebstore.google.com/detail/${id}`, sha256: downloaded.sha256 }
            this.pending.set(id, { destination, manifest, metadata })
            return {
                id,
                name: manifest.name.trim().slice(0, 256),
                version: manifest.version.trim().slice(0, 64),
                description: typeof manifest.description === 'string' ? manifest.description.trim().slice(0, 1_024) : '',
                path: '',
                enabled: false,
                permissions: asStringArray(manifest.permissions),
                hostPermissions: asStringArray(manifest.host_permissions),
                warnings: extensionWarnings(manifest),
                ...metadata,
                pending: true
            }
        })
    }

    async approveWebStore(id: string): Promise<BrowserExtensionRecord> {
        return this.runExclusive(async () => {
            const pending = this.pending.get(id)
            if (!pending) throw new Error('The extension review expired. Download it again.')
            this.pending.delete(id)
            return this.registerInstalled(pending.destination, pending.manifest, pending.metadata)
        })
    }

    async discardWebStore(id: string): Promise<void> {
        return this.runExclusive(async () => {
            const pending = this.pending.get(id)
            if (!pending) return
            this.pending.delete(id)
            await rm(pending.destination, { recursive: true, force: true })
        })
    }

    private async registerInstalled(destination: string, manifest: ExtensionManifest & { name: string; version: string }, metadata: Pick<StoredExtension, 'source' | 'storeUrl' | 'sha256'> = {}): Promise<BrowserExtensionRecord> {
        const existing = (await readStored()).find(entry => entry.path === destination)
        if (existing && this.loaded.has(existing.id)) return displayRecord(existing)
        let extension: Extension
        try { extension = await this.session.extensions.loadExtension(destination, { allowFileAccess: false }) } catch (error) {
            await rm(destination, { recursive: true, force: true })
            throw new Error(`Electron could not load this extension: ${error instanceof Error ? error.message : 'unknown loading error'}`)
        }
        const stored = await readStored()
        const entries = stored.filter(entry => entry.id !== extension.id && entry.path !== destination)
        const record: StoredExtension = {
            id: extension.id,
            name: manifest.name.trim().slice(0, 256),
            version: manifest.version.trim().slice(0, 64),
            description: typeof manifest.description === 'string' ? manifest.description.trim().slice(0, 1_024) : '',
            path: destination,
            enabled: true,
            permissions: asStringArray(manifest.permissions),
            hostPermissions: asStringArray(manifest.host_permissions),
            warnings: extensionWarnings(manifest),
            ...metadata
        }
        entries.push(record)
        await writeStored(entries)
        this.loaded.set(extension.id, extension)
        // Retire only our old package after the new version is loaded and saved.
        for (const previous of stored) {
            if (previous.id !== extension.id || previous.path === destination || dirname(resolve(previous.path)) !== resolve(extensionStorageRoot())) continue
            await rm(previous.path, { recursive: true, force: true }).catch(error => log.warn('[BrowserExtensions] Could not retire previous package', error))
        }
        return displayRecord(record)
    }

    async setEnabled(id: string, enabled: boolean): Promise<BrowserExtensionRecord> {
        return this.runExclusive(async () => {
            const entries = await readStored()
            const entry = entries.find(candidate => candidate.id === id)
            if (!entry) throw new Error('Extension not found.')
            if (enabled) {
                if (!existsSync(join(entry.path, 'manifest.json'))) throw new Error('The extension files are missing. Remove and install it again.')
                if (!this.loaded.has(id)) this.loaded.set(id, await this.session.extensions.loadExtension(entry.path, { allowFileAccess: false }))
            } else if (this.loaded.has(id)) {
                this.session.extensions.removeExtension(id)
                this.loaded.delete(id)
            }
            entry.enabled = enabled
            await writeStored(entries)
            return displayRecord(entry)
        })
    }

    async remove(id: string): Promise<void> {
        await this.runExclusive(async () => {
            const entries = await readStored()
            const entry = entries.find(candidate => candidate.id === id)
            if (!entry) return
            if (this.loaded.has(id)) this.session.extensions.removeExtension(id)
            this.loaded.delete(id)
            await rm(entry.path, { recursive: true, force: true })
            await writeStored(entries.filter(candidate => candidate.id !== id))
        })
    }

    async reload(id: string): Promise<BrowserExtensionRecord> {
        return this.runExclusive(async () => {
            const entries = await readStored()
            const entry = entries.find(candidate => candidate.id === id)
            if (!entry) throw new Error('Extension not found.')
            if (this.loaded.has(id)) {
                this.session.extensions.removeExtension(id)
                this.loaded.delete(id)
            }
            if (entry.enabled) this.loaded.set(id, await this.session.extensions.loadExtension(entry.path, { allowFileAccess: false }))
            return displayRecord(entry)
        })
    }

    private async runExclusive<T>(work: () => Promise<T>): Promise<T> {
        const previous = this.operation
        let release!: () => void
        this.operation = new Promise<void>(resolve => { release = resolve })
        await previous
        try { return await work() } finally { release() }
    }
}

let manager: BrowserExtensionManager | null = null
export function getBrowserExtensionManager(): BrowserExtensionManager {
    return manager ??= new BrowserExtensionManager()
}
