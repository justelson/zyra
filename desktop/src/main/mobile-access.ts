import { listenForMobile } from './mobile-listener'
import { MobileTerminalAccess } from './mobile-terminal-access'
import { MobileVoiceAccess } from './mobile-voice-access'
import { MobilePluginAccess } from './mobile-plugin-access'
import { MobileFleetAccess } from './mobile-fleet-access'
import { MobileReviewAccess } from './mobile-review-access'
import { MobileProjectPresentations } from './mobile-project-presentation'
import { MobileBrowserCaptures } from './mobile-browser-captures'
import { mobileListenerPort, preferredMobileAddress } from '../shared/mobile-access-policy'
import { readFile, mkdir, rename, writeFile, realpath, stat } from 'node:fs/promises'
import { networkInterfaces, hostname } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MobileAccessConfig, MobileAccessState } from '../shared/mobile-access'
import type { Gateway, MobileHostClient } from '../../../mobile/gateway/src/desktop-entry.mjs'
import { resolveZyraRoot } from './zyra/zyra-root'
import { resolveDesktopAgentServerNamespace } from './assistant/zyra-agent-server-worker'
import type { AssistantService } from './assistant/service'
import { readRuntimeActivation } from './assistant/runtime-activation'

export class MobileAccessManager {
    private config: MobileAccessConfig = { enabled: false, address: '', projects: [] }
    private gateway: Gateway | null = null
    private tls: { fingerprint: string } | null = null
    private origin: string | undefined
    private failure: string | undefined
    private serial: Promise<unknown> = Promise.resolve()
    private readonly directory: string
    private readonly projectPresentations: MobileProjectPresentations
    constructor(private readonly userData: string, private readonly service: () => AssistantService, projectIconOverrides: () => Promise<Record<string, string>> = async () => ({}), private readonly timingSummary: (properties: Record<string, unknown>) => void = () => {}) {
        this.directory = join(userData, 'mobile-access')
        this.projectPresentations = new MobileProjectPresentations(projectIconOverrides, async () => (await this.service().listProjects()).catalog.projects)
    }
    invalidateProjectArtwork() { this.projectPresentations.clear() }
    private enqueue<T>(action: () => Promise<T>): Promise<T> {
        const next = this.serial.then(action, action)
        this.serial = next.catch(() => undefined)
        return next
    }
    addresses() {
        return Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries || [])
            .filter(entry => !entry.internal && entry.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(entry.address))
            .map(entry => ({ name, address: entry.address })))
    }
    async state(): Promise<MobileAccessState> {
        const { DeviceStore } = await import('../../../mobile/gateway/src/desktop-entry.mjs')
        return { defaultProject: this.defaultProject, config: { ...this.config, address: preferredMobileAddress(this.addresses(), this.config.address), projects: this.config.projects.length ? [...this.config.projects] : [this.defaultProject] }, running: !!this.gateway,
            runtimeStatus: readRuntimeActivation(), origin: this.origin, addresses: this.addresses(), devices: new DeviceStore(this.directory).list().map(device => ({ ...device, connected: this.gateway?.connectedDeviceIds().includes(device.id) || false })), error: this.failure }
    }
    private get defaultProject() { return join(this.userData, 'assistant', 'global-workspace') }
    async restore(): Promise<void> {
        return this.enqueue(async () => {
            try {
                this.config = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'))
                // Preserve any earlier host-wide restrictions for existing phones only.
                // New pairings always begin with the full catalog.
                if (this.config.hiddenProjects?.length) {
                    const { DeviceStore } = await import('../../../mobile/gateway/src/desktop-entry.mjs')
                    const devices = new DeviceStore(this.directory)
                    for (const device of devices.list()) if (device.hiddenProjects === undefined) devices.setAccess(device.id, { hiddenProjects: this.config.hiddenProjects })
                    delete this.config.hiddenProjects
                    await writeFile(join(this.directory, 'settings.json.tmp'), JSON.stringify(this.config), { mode: 0o600 })
                    await rename(join(this.directory, 'settings.json.tmp'), join(this.directory, 'settings.json'))
                }
                if (this.config.enabled) {
                    await this.start()
                    await writeFile(join(this.directory, 'settings.json.tmp'), JSON.stringify(this.config), { mode: 0o600 })
                    await rename(join(this.directory, 'settings.json.tmp'), join(this.directory, 'settings.json'))
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    await this.stopNow()
                    this.failure = error instanceof Error ? error.message : 'Mobile access could not start.'
                }
            }
        })
    }
    configure(input: MobileAccessConfig): Promise<MobileAccessState> {
        return this.enqueue(async () => {
            if (!input || typeof input.enabled !== 'boolean' || !Array.isArray(input.projects) || input.projects.length > 32) throw new Error('Choose up to 32 shared folders.')
            if (input.hiddenProjects !== undefined && (!Array.isArray(input.hiddenProjects) || input.hiddenProjects.length > 256 || input.hiddenProjects.some(path => typeof path !== 'string' || path.length > 4096))) throw new Error('Invalid project visibility.')
            const address = input.address || preferredMobileAddress(this.addresses())
            if (input.enabled && !this.addresses().some(entry => entry.address === address)) throw new Error('Connect this computer to Wi-Fi or Ethernet, then try again.')
            const projects: string[] = []
            const requestedProjects = input.projects.length ? input.projects : [this.defaultProject]
            if (requestedProjects.includes(this.defaultProject)) await mkdir(this.defaultProject, { recursive: true })
            for (const value of requestedProjects) {
                if (typeof value !== 'string') throw new Error('Invalid shared folder.')
                const folder = await realpath(value)
                if (!(await stat(folder)).isDirectory()) throw new Error('Share a folder, not a file.')
                if (!projects.includes(folder)) projects.push(folder)
            }
            if (input.enabled && projects.length === 0) throw new Error('Choose at least one folder to share.')
            await this.stopNow()
            this.config = { enabled: input.enabled, address, projects, ...(this.config.port ? { port: this.config.port } : {}) }
            this.failure = undefined
            try {
                if (input.enabled) await this.start()
                await mkdir(this.directory, { recursive: true })
                await writeFile(join(this.directory, 'settings.json.tmp'), JSON.stringify(this.config), { mode: 0o600 })
                await rename(join(this.directory, 'settings.json.tmp'), join(this.directory, 'settings.json'))
            } catch (error) {
                await this.stopNow()
                this.failure = error instanceof Error ? error.message : 'Mobile access could not start.'
                throw error
            }
            return this.state()
        })
    }
    private async clientFactory() {
        const root = resolveZyraRoot()
        const runtime = await import(/* @vite-ignore */ pathToFileURL(join(root, 'src', 'agent-server', 'client.mjs')).href) as {
            ZyraAgentServerClient: new (options: Record<string, unknown>) => MobileHostClient
        }
        return (device: { id: string; name?: string }) => new runtime.ZyraAgentServerClient({ root, ...resolveDesktopAgentServerNamespace(this.userData),
            clientId: 'mobile:' + device.id, surface: 'mobile', displayName: device.name, autoStart: false, verifyRuntimeRevision: false, requiredMethods: ['session.join', 'catalog.projects'] })
    }
    async projectChoices() {
        await this.service().getStatus()
        const client = (await this.clientFactory())({ id: 'settings-projects' })
        const { DeviceStore } = await import('../../../mobile/gateway/src/desktop-entry.mjs')
        const hiddenPaths = new DeviceStore(this.directory).list().flatMap(device => device.hiddenProjects || [])
        try {
            await client.connect()
            const [{ projects }, catalog] = await Promise.all([client.request('catalog.projects'), this.service().listProjects()])
            const choices = catalog.catalog.projects.filter(project => !project.archived).map(project => ({
                name: project.name,
                paths: [project.homePath, ...project.folders.map(folder => folder.path)],
                iconPath: project.folders[0]?.path || project.homePath,
                folders: project.folders.map(folder => ({ label: folder.label, path: folder.path }))
            }))
            const represented = new Set(choices.flatMap(choice => choice.paths).map(path => path.toLowerCase()))
            for (const path of [...new Set<string>([this.defaultProject, ...projects, ...hiddenPaths])]) {
                if (!represented.has(path.toLowerCase())) choices.push({ name: path === this.defaultProject ? 'Other chats' : basename(path), paths: [path], iconPath: path, folders: [] })
            }
            return choices.sort((a, b) => a.name.localeCompare(b.name))
        } finally { client.close() }
    }
    private async start(): Promise<void> {
        if (this.gateway) { this.failure = undefined; return }
        if (!this.addresses().some(entry => entry.address === this.config.address)) throw new Error('The saved network address is unavailable. Select your current network in Device connections.')
        if (!Array.isArray(this.config.projects) || !this.config.projects.length) throw new Error('No folders are shared.')
        const { createGateway, hostTls, prepareHostProcessIdentity } = await import('../../../mobile/gateway/src/desktop-entry.mjs')
        const tls = await hostTls(this.directory)
        const clientFactory = await this.clientFactory()
        // Starting Desktop's normal runtime preserves its saved chat scope and plugin authority.
        await this.service().getStatus()
        await prepareHostProcessIdentity()
        const gateway = createGateway({ tls, directory: this.directory, projects: this.config.projects, allProjects: true, name: hostname(),
            runtimeStatus: readRuntimeActivation,
            prepareChat: id => this.service().prepareMobileChat(id),
            regenerateTitle: id => this.service().regenerateMobileChatTitle(id),
            review: new MobileReviewAccess(this.service),
            fleet: new MobileFleetAccess(this.service),
            accountLimits: async () => (await this.service().getAccountLimitsOverview()).overview,
            resolveScope: id => this.service().getMobileFilesystemContext(id),
            searchChats: input => this.service().searchMobileChats(input),
            searchContext: input => this.service().mobileSearchContext(input),
            projectPresentation: project => this.projectPresentations.get(project),
            captures: new MobileBrowserCaptures(join(this.userData, 'browser-preview', 'artifacts')),
            timingSummary: properties => this.timingSummary(properties),
            terminalFactory: (_device, receive) => new MobileTerminalAccess(this.service, receive),
            voiceFactory: (device, receive) => new MobileVoiceAccess(this.service(), receive, device.name),
            pluginFactory: (_device, changed) => new MobilePluginAccess(this.service(), changed),
            clientFactory })
        try {
            const address = await listenForMobile(gateway, this.config.address, mobileListenerPort(this.config.port, readRuntimeActivation().installation?.kind === 'development'))
            this.config.port = address.port
            this.gateway = gateway; this.tls = tls; this.origin = 'https://' + this.config.address + ':' + address.port
            this.failure = undefined
        } catch (error) { await gateway.close(); throw error }
    }
    pair() {
        return this.enqueue(async () => {
            if (!this.gateway || !this.tls || !this.origin) throw new Error('Enable mobile access first.')
            const { pairingDisplay } = await import('../../../mobile/gateway/src/desktop-entry.mjs')
            return pairingDisplay(this.gateway, this.tls, this.origin, hostname())
        })
    }
    setDeviceAccess(id: string, access: { hiddenProjects: string[] }) {
        return this.enqueue(async () => {
            if (typeof id !== 'string') throw new Error('Choose a paired device.')
            if (this.gateway) this.gateway.setAccess(id, access)
            else { const { DeviceStore } = await import('../../../mobile/gateway/src/desktop-entry.mjs'); new DeviceStore(this.directory).setAccess(id, access) }
            return this.state()
        })
    }
    revoke(id: string) {
        return this.enqueue(async () => {
            if (typeof id !== 'string') throw new Error('Choose a trusted device.')
            if (this.gateway) this.gateway.revoke(id)
            else { const { DeviceStore } = await import('../../../mobile/gateway/src/desktop-entry.mjs'); new DeviceStore(this.directory).revoke(id) }
            return this.state()
        })
    }
    stop() { return this.enqueue(() => this.stopNow()) }
    private async stopNow() {
        const gateway = this.gateway; this.gateway = null; this.origin = undefined; this.tls = null
        await gateway?.close()
    }
}
