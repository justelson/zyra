import { app, BrowserWindow } from 'electron'
import { getAssistantService } from '../assistant'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createInstallerRequests } from './installer-requests'
import { installerIsAbsent } from './installer-presence'
import { createInstallPreflight } from './install-preflight'
import type { AgentUpdateConfirmation } from '../../shared/agent-update'
import log from 'electron-log'
import type {
    DevScopeUpdateActionResult,
    DevScopeUpdateErrorContext,
    DevScopeUpdateState
} from '../../shared/contracts/devscope-api'
import {
    reduceUpdateStateOnCheckFailure,
    reduceUpdateStateOnCheckStart,
    reduceUpdateStateOnDownloadComplete,
    reduceUpdateStateOnDownloadFailure,
    reduceUpdateStateOnDownloadProgress,
    reduceUpdateStateOnDownloadStart,
    reduceUpdateStateOnInstallFailure,
    reduceUpdateStateOnNoUpdate,
    reduceUpdateStateOnUpdateAvailable
} from './update-machine'
import {
    createInitialUpdateState,
    getAutoUpdateDisabledReason,
    resolveReleaseChannel,
    shouldBroadcastDownloadProgress
} from './update-state'
import { resolveGitHubReleaseFeed } from './github-release-feed'
import { previewAutoUpdateDisabledReason } from '../../shared/distribution-identity'
import { classifyAnalyticsErrorCode as updateAnalyticsErrorCode } from '../../shared/analytics/error-code'

export const UPDATE_STATE_CHANNEL = 'devscope:updates:state'
export const UPDATE_GET_STATE_CHANNEL = 'devscope:updates:getState'
export const UPDATE_CHECK_CHANNEL = 'devscope:updates:checkForUpdates'
export const UPDATE_DOWNLOAD_CHANNEL = 'devscope:updates:downloadUpdate'
export const UPDATE_INSTALL_CHANNEL = 'devscope:updates:installUpdate'

const DEFAULT_RELEASE_REPOSITORY = 'justelson/zyra'
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000
const AUTO_UPDATE_CHECK_TIMEOUT_MS = 45 * 1000

const releaseRepository =
    process.env.ZYRA_UPDATE_REPOSITORY?.trim()
    || process.env.DEVSCOPE_DESKTOP_UPDATE_REPOSITORY?.trim()
    || process.env.GITHUB_REPOSITORY?.trim()
    || DEFAULT_RELEASE_REPOSITORY
const releaseFeedUrlOverride =
    process.env.ZYRA_UPDATE_FEED_URL?.trim()
    || process.env.DEVSCOPE_DESKTOP_UPDATE_FEED_URL?.trim()
    || ''
const releasePageUrl = `https://github.com/${releaseRepository}/releases`

type ElectronUpdaterModule = typeof import('electron-updater')
type ElectronUpdaterModuleShape = ElectronUpdaterModule & {
    default?: Partial<ElectronUpdaterModule>
}
type AutoUpdater = ElectronUpdaterModule['autoUpdater']

let autoUpdaterRef: AutoUpdater | null = null
let autoUpdaterLoadPromise: Promise<AutoUpdater> | null = null
let updaterInitializationPromise: Promise<void> | null = null

let trackedWindowIds = new Set<number>()
let updatePollTimer: ReturnType<typeof setInterval> | null = null
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null
let updateCheckTimeoutTimer: ReturnType<typeof setTimeout> | null = null
let updateCheckInFlight = false
let updateDownloadInFlight = false
let isInstallingUpdate = false
let updaterConfigured = false
let updaterInitialized = false
let configuredFeedTagName: string | null = null
let captureUpdateAnalytics: ((properties: {
    action: 'update_check'
    outcome: 'started' | 'completed' | 'failed' | 'available' | 'current' | 'unknown'
    error_code?: string
}) => void) | null = null

export function configureUpdateAnalytics(capture: typeof captureUpdateAnalytics): void {
    captureUpdateAnalytics = capture
}

function currentAutoUpdateDisabledReason(): string | null {
    return previewAutoUpdateDisabledReason() || getAutoUpdateDisabledReason({
        isPackaged: app.isPackaged,
        disabledByEnv: process.env.ZYRA_DISABLE_AUTO_UPDATE === '1' || process.env.DEVSCOPE_DISABLE_AUTO_UPDATE === '1',
        platform: process.platform,
        appImagePath: process.env.APPIMAGE
    })
}

let updateState: DevScopeUpdateState = createInitialUpdateState(
    app.getVersion(),
    releaseRepository,
    false,
    releasePageUrl,
    currentAutoUpdateDisabledReason()
)

async function loadAutoUpdater(): Promise<AutoUpdater> {
    if (autoUpdaterRef) return autoUpdaterRef
    if (!autoUpdaterLoadPromise) {
        autoUpdaterLoadPromise = import('electron-updater').then((rawModule) => {
            const module = rawModule as ElectronUpdaterModuleShape
            const autoUpdater = module.autoUpdater ?? module.default?.autoUpdater
            if (!autoUpdater) {
                throw new Error('electron-updater did not expose autoUpdater.')
            }
            autoUpdaterRef = autoUpdater
            return autoUpdaterRef
        })
    }
    return autoUpdaterLoadPromise
}

function nowIso(): string {
    return new Date().toISOString()
}

function clearUpdateTimers(): void {
    if (updateStartupTimer) {
        clearTimeout(updateStartupTimer)
        updateStartupTimer = null
    }
    if (updatePollTimer) {
        clearInterval(updatePollTimer)
        updatePollTimer = null
    }
    clearUpdateCheckTimeoutTimer()
}

function clearUpdateCheckTimeoutTimer(): void {
    if (updateCheckTimeoutTimer) {
        clearTimeout(updateCheckTimeoutTimer)
        updateCheckTimeoutTimer = null
    }
}

function armUpdateCheckTimeout(reason: string): void {
    clearUpdateCheckTimeoutTimer()
    updateCheckTimeoutTimer = setTimeout(() => {
        updateCheckTimeoutTimer = null
        if (updateState.status !== 'checking') {
            return
        }

        updateCheckInFlight = false
        setUpdateState(
            reduceUpdateStateOnCheckFailure(
                updateState,
                'Timed out while checking for updates. Try again.',
                nowIso()
            )
        )
        captureUpdateAnalytics?.({ action: 'update_check', outcome: 'failed', error_code: 'timeout' })
        log.error(`[updater] update check timed out (${reason})`)
    }, AUTO_UPDATE_CHECK_TIMEOUT_MS)
    updateCheckTimeoutTimer.unref()
}

function resolveUpdaterErrorContext(): DevScopeUpdateErrorContext {
    if (isInstallingUpdate) return 'install'
    if (updateDownloadInFlight) return 'download'
    if (updateCheckInFlight) return 'check'
    return updateState.errorContext
}

function emitUpdateState(): void {
    for (const windowId of Array.from(trackedWindowIds)) {
        const target = BrowserWindow.fromId(windowId)
        if (!target || target.isDestroyed()) {
            trackedWindowIds.delete(windowId)
            continue
        }
        target.webContents.send(UPDATE_STATE_CHANNEL, updateState)
    }
}

function setUpdateState(nextState: DevScopeUpdateState): DevScopeUpdateState {
    updateState = nextState
    emitUpdateState()
    return updateState
}

function buildActionResult(accepted: boolean, completed: boolean): DevScopeUpdateActionResult {
    return {
        accepted,
        completed,
        state: updateState
    }
}

function rejectAction(message: string): DevScopeUpdateActionResult {
    setUpdateState({
        ...updateState,
        message,
        canRetry: updateState.status === 'error' ? updateState.canRetry : false
    })
    return buildActionResult(false, false)
}

function getUpdaterUnavailableMessage(): string {
    return updateState.disabledReason || updateState.message || 'Updater is not ready in this build yet.'
}

function normalizeGenericFeedUrl(feedUrl: string): string {
    const parsed = new URL(feedUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('DEVSCOPE_DESKTOP_UPDATE_FEED_URL must use http or https.')
    }
    if (!parsed.pathname.endsWith('/')) {
        parsed.pathname = `${parsed.pathname}/`
    }
    return parsed.toString()
}

async function configureAutoUpdaterFeed(autoUpdater: AutoUpdater): Promise<void> {
    if (releaseFeedUrlOverride) {
        const normalizedFeedUrl = normalizeGenericFeedUrl(releaseFeedUrlOverride)
        const overrideFeedKey = `env:${normalizedFeedUrl}`
        if (configuredFeedTagName !== overrideFeedKey) {
            autoUpdater.setFeedURL({
                provider: 'generic',
                url: normalizedFeedUrl
            })
            configuredFeedTagName = overrideFeedKey
            log.info(`[updater] using override update feed ${normalizedFeedUrl}`)
        }

        autoUpdater.previousBlockmapBaseUrlOverride = normalizedFeedUrl
        if (updateState.releasePageUrl !== normalizedFeedUrl) {
            updateState = {
                ...updateState,
                releasePageUrl: normalizedFeedUrl
            }
        }
        return
    }

    const allowPrerelease = resolveReleaseChannel(app.getVersion()) !== 'stable'
    const feed = await resolveGitHubReleaseFeed({
        repository: releaseRepository,
        currentVersion: app.getVersion(),
        allowPrerelease,
        platform: process.platform,
        arch: process.arch
    })

    if (!feed) {
        configuredFeedTagName = null
        return
    }

    if (configuredFeedTagName !== feed.tagName) {
        autoUpdater.setFeedURL({
            provider: 'generic',
            url: feed.feedUrl
        })
        configuredFeedTagName = feed.tagName
        log.info(`[updater] using GitHub release feed ${feed.tagName}`)
    }

    autoUpdater.previousBlockmapBaseUrlOverride = feed.previousBlockmapBaseUrlOverride
    if (updateState.releasePageUrl !== feed.releasePageUrl) {
        updateState = {
            ...updateState,
            releasePageUrl: feed.releasePageUrl
        }
    }
}

export function registerUpdateWindow(window: BrowserWindow): void {
    const windowId = window.id
    trackedWindowIds.add(windowId)
    window.once('closed', () => {
        trackedWindowIds.delete(windowId)
    })
    window.webContents.once('did-finish-load', () => {
        if (!window.isDestroyed()) {
            window.webContents.send(UPDATE_STATE_CHANNEL, updateState)
        }
    })
}

export function getUpdateState(): DevScopeUpdateState {
    return updateState
}

async function performUpdaterInitialization(): Promise<void> {
    if (updaterInitialized) return
    updaterInitialized = true

    const disabledReason = currentAutoUpdateDisabledReason()
    const enabled = disabledReason === null
    const externalInstaller = updateState.externalInstaller
    updateState = createInitialUpdateState(
        app.getVersion(),
        releaseRepository,
        enabled,
        releasePageUrl,
        disabledReason
    )
    if (externalInstaller) updateState.externalInstaller = externalInstaller
    void refreshInstallationRecovery()

    if (!enabled) {
        if (disabledReason) {
            log.info(`[updater] disabled: ${disabledReason}`)
        }
        emitUpdateState()
        return
    }

    let autoUpdater: AutoUpdater
    try {
        autoUpdater = await loadAutoUpdater()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setUpdateState({
            ...updateState,
            status: 'error',
            checkedAt: nowIso(),
            message: `Failed to load updater: ${message}`,
            errorContext: 'check',
            canRetry: true
        })
        log.error('[updater] failed to load electron-updater', error)
        return
    }

    updaterConfigured = true
    autoUpdater.logger = log
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = resolveReleaseChannel(app.getVersion()) !== 'stable'
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false

    try {
        await configureAutoUpdaterFeed(autoUpdater)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setUpdateState({
            ...updateState,
            status: 'error',
            checkedAt: nowIso(),
            message: `Failed to resolve GitHub release feed: ${message}`,
            errorContext: 'check',
            canRetry: true
        })
        log.error('[updater] failed to resolve GitHub release feed', error)
        return
    }

    autoUpdater.on('checking-for-update', () => {
        log.info('[updater] checking for updates')
    })

    autoUpdater.on('update-available', (info) => {
        clearUpdateCheckTimeoutTimer()
        setUpdateState(reduceUpdateStateOnUpdateAvailable(updateState, info.version, nowIso()))
        log.info(`[updater] update available: ${info.version}`)
    })

    autoUpdater.on('update-not-available', () => {
        clearUpdateCheckTimeoutTimer()
        setUpdateState(reduceUpdateStateOnNoUpdate(updateState, nowIso()))
        log.info('[updater] no updates available')
    })

    autoUpdater.on('error', (error) => {
        clearUpdateCheckTimeoutTimer()
        const message = error instanceof Error ? error.message : String(error)
        if (isInstallingUpdate) {
            void cancelPendingAppInstallation(message)
        } else if (!updateCheckInFlight && !updateDownloadInFlight) {
            setUpdateState({
                ...updateState,
                status: 'error',
                checkedAt: nowIso(),
                message,
                downloadPercent: null,
                errorContext: resolveUpdaterErrorContext(),
                canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null
            })
        }
        log.error('[updater] error', error)
    })

    autoUpdater.on('download-progress', (progress) => {
        if (
            shouldBroadcastDownloadProgress(updateState, progress.percent)
            || updateState.message !== null
        ) {
            setUpdateState(reduceUpdateStateOnDownloadProgress(updateState, progress.percent))
        }
    })

    autoUpdater.on('update-downloaded', (info) => {
        setUpdateState(reduceUpdateStateOnDownloadComplete(updateState, info.version))
        log.info(`[updater] update downloaded: ${info.version}`)
    })

    updateStartupTimer = setTimeout(() => {
        updateStartupTimer = null
        void checkForAppUpdates('startup')
    }, AUTO_UPDATE_STARTUP_DELAY_MS)
    updateStartupTimer.unref()

    updatePollTimer = setInterval(() => {
        void checkForAppUpdates('poll')
    }, AUTO_UPDATE_POLL_INTERVAL_MS)
    updatePollTimer.unref()
}

export function initializeUpdater(): Promise<void> {
    if (!updaterInitializationPromise) {
        updaterInitializationPromise = performUpdaterInitialization()
    }
    return updaterInitializationPromise
}

export async function checkForAppUpdates(_reason: string = 'manual'): Promise<DevScopeUpdateActionResult> {
    await initializeUpdater()

    if (!updaterConfigured || !autoUpdaterRef || updateCheckInFlight || updateState.status === 'checking') {
        if (!updaterConfigured || !autoUpdaterRef) {
            return rejectAction(getUpdaterUnavailableMessage())
        }
        return rejectAction('An update check is already in progress.')
    }
    if (updateState.status === 'downloading' || updateState.status === 'downloaded') {
        return rejectAction(
            updateState.status === 'downloaded'
                ? 'An update is already downloaded. Install it before checking again.'
                : 'An update is already downloading.'
        )
    }

    updateCheckInFlight = true
    captureUpdateAnalytics?.({ action: 'update_check', outcome: 'started' })
    setUpdateState(reduceUpdateStateOnCheckStart(updateState, nowIso()))
    armUpdateCheckTimeout(_reason)

    try {
        await configureAutoUpdaterFeed(autoUpdaterRef)
        await autoUpdaterRef.checkForUpdates()
        captureUpdateAnalytics?.({
            action: 'update_check',
            outcome: updateState.status === 'available' ? 'available' : updateState.status === 'idle' ? 'current' : 'completed'
        })
        return buildActionResult(true, true)
    } catch (error) {
        clearUpdateCheckTimeoutTimer()
        const message = error instanceof Error ? error.message : String(error)
        setUpdateState(reduceUpdateStateOnCheckFailure(updateState, message, nowIso()))
        captureUpdateAnalytics?.({ action: 'update_check', outcome: 'failed', error_code: updateAnalyticsErrorCode(error) })
        log.error('[updater] failed to check for updates', error)
        return buildActionResult(true, false)
    } finally {
        updateCheckInFlight = false
    }
}

export async function downloadAppUpdate(): Promise<DevScopeUpdateActionResult> {
    await initializeUpdater()

    if (!updaterConfigured || !autoUpdaterRef || updateDownloadInFlight || updateState.status !== 'available') {
        if (!updaterConfigured || !autoUpdaterRef) {
            return rejectAction(getUpdaterUnavailableMessage())
        }
        if (updateDownloadInFlight) {
            return rejectAction('An update download is already in progress.')
        }
        if (updateState.status === 'downloaded') {
            return rejectAction('This update is already downloaded and ready to install.')
        }
        if (updateState.status === 'downloading') {
            return rejectAction('An update is already downloading.')
        }
        if (updateState.status === 'checking') {
            return rejectAction('Wait for the current update check to finish first.')
        }
        return rejectAction('No downloadable update is available yet.')
    }

    updateDownloadInFlight = true
    setUpdateState(reduceUpdateStateOnDownloadStart(updateState))
    autoUpdaterRef.disableDifferentialDownload = false

    try {
        await autoUpdaterRef.downloadUpdate()
        return buildActionResult(true, true)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setUpdateState(reduceUpdateStateOnDownloadFailure(updateState, message))
        log.error('[updater] failed to download update', error)
        return buildActionResult(true, false)
    } finally {
        updateDownloadInFlight = false
    }
}

let installerRequests: ReturnType<typeof createInstallerRequests> | null = null
let installRelease: (() => Promise<void>) | null = null
let installVersion: string | null = null
let installOperationId = ''
let readyOnQuit: (() => void) | null = null
let abortUpdateQuit = false
const installerFlag = (kind: 'pending' | 'ready', version = installVersion) => join(app.getPath('userData'), 'updates', `installer-${kind}-${version && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) ? version : 'invalid'}.flag`)
async function releaseInstallationResources() {
    if (readyOnQuit) app.removeListener('will-quit', readyOnQuit)
    readyOnQuit = null
    rmSync(installerFlag('pending'), { force: true }); rmSync(installerFlag('ready'), { force: true })
    await installRelease?.(); installRelease = null
}
export function shouldAbortUpdateQuit() { const blocked = abortUpdateQuit; abortUpdateQuit = false; return blocked }
export async function cancelPendingAppInstallation(message: string, abortScheduledQuit = true) {
    if (!isInstallingUpdate) return
    isInstallingUpdate = false; abortUpdateQuit = abortScheduledQuit
    try { await releaseInstallationResources() } catch (error) { log.error('[updater] handoff release failed', error) }
    if (updateState.externalInstaller) installerRequests?.later()
    setUpdateState({ ...reduceUpdateStateOnInstallFailure(updateState, message), externalInstaller: undefined })
}
export async function refreshInstallationRecovery() {
    try {
        const pending = await getAssistantService().inspectInstallRecovery()
        const available = Boolean(pending && await installerIsAbsent(app.getName()))
        setUpdateState({ ...updateState, installRecoveryAvailable: available })
    } catch { /* Unknown never grants recovery. */ }
}
export async function resumePreviousAgent() {
    if (isInstallingUpdate || !await installerIsAbsent(app.getName())) return rejectAction('An installer may still be running.')
    try {
        const version = await getAssistantService().recoverInstallHandoff()
        rmSync(installerFlag('pending', version), { force: true }); rmSync(installerFlag('ready', version), { force: true })
        setUpdateState({ ...updateState, installRecoveryAvailable: false, message: null, errorContext: null })
        return buildActionResult(true, true)
    } catch { return rejectAction('The previous installation could not be verified. Repair it first.') }
}
export function hasCurrentManualInstallerRequest(): boolean {
    const pending = updateState.externalInstaller
    if (!pending || pending.agentServerUpdate !== true) return false
    try {
        const request = installerRequests?.assertCurrent()
        return request?.id === pending.id && request.version === pending.version
    } catch { return false }
}
export function receiveInstallerUpdateRequest(argv: string[]): boolean {
    if (isInstallingUpdate) return false
    installerRequests ||= createInstallerRequests(join(app.getPath('userData'), 'updates', 'installer-requests'))
    if (!installerRequests.accept(argv, app.getVersion())) return false
    const request = installerRequests.current()!
    void installPreflight.defer()
    setUpdateState({ ...updateState, externalInstaller: { id: request.id, version: request.version, agentServerUpdate: true } })
    return true
}
const installPreflight = createInstallPreflight({
    version: () => updateState.externalInstaller?.version || (updateState.enabled && updateState.status === 'downloaded' ? updateState.downloadedVersion : null),
    inspect: () => getAssistantService().inspectRuntimeInstallation(),
    prepare: async input => {
        if (updateState.externalInstaller) installerRequests!.assertCurrent()
        const assistant = getAssistantService()
        installRelease = () => assistant.cancelRuntimeInstallation()
        installVersion = input.targetVersion
        installOperationId = updateState.externalInstaller?.id || input.operationId
        await assistant.prepareRuntimeInstallation({ ...input, operationId: installOperationId })
    },
    release: releaseInstallationResources,
    install: () => {
        clearUpdateTimers()
        if (updateState.externalInstaller) {
            installerRequests!.assertCurrent()
            // The installer cannot continue until normal Desktop persistence and
            // before-quit cleanup have finished. No PID is killed here.
            readyOnQuit = () => installerRequests!.ready()
            app.once('will-quit', readyOnQuit)
            app.quit()
        } else {
            mkdirSync(join(app.getPath('userData'), 'updates'), { recursive: true })
            writeFileSync(installerFlag('pending'), installOperationId, { mode: 0o600 })
            readyOnQuit = () => writeFileSync(installerFlag('ready'), installOperationId, { mode: 0o600 })
            app.once('will-quit', readyOnQuit)
            autoUpdaterRef!.quitAndInstall()
        }
    }
})
export async function preflightAppUpdate() {
    if (!hasCurrentManualInstallerRequest()) await initializeUpdater()
    return installPreflight.inspect()
}
export async function deferAppUpdate() {
    await installPreflight.defer()
    if (updateState.externalInstaller) { installerRequests?.later(); setUpdateState({ ...updateState, externalInstaller: undefined }) }
}

export async function installAppUpdate(confirmation?: AgentUpdateConfirmation): Promise<DevScopeUpdateActionResult> {
    // A validated native installer already owns the local payload. Its consent
    // and shutdown handoff must not wait for online release-feed discovery.
    if (!hasCurrentManualInstallerRequest()) await initializeUpdater()

    if (!updateState.externalInstaller && (!updaterConfigured || !autoUpdaterRef || isInstallingUpdate || updateState.status !== 'downloaded')) {
        if (!updaterConfigured || !autoUpdaterRef) {
            return rejectAction(getUpdaterUnavailableMessage())
        }
        if (isInstallingUpdate) {
            return rejectAction('Install is already in progress.')
        }
        if (updateState.status === 'available') {
            return rejectAction('Download the update before trying to install it.')
        }
        if (updateState.status === 'downloading') {
            return rejectAction('Wait for the current download to finish before installing.')
        }
        return rejectAction('No downloaded update is ready to install.')
    }

    if (isInstallingUpdate) return rejectAction('Install is already in progress.')
    if (!confirmation?.planId || typeof confirmation.stopBlockers !== 'boolean') return rejectAction('Review the agent update before installing.')
    isInstallingUpdate = true

    try {
        await installPreflight.confirm(confirmation)
        return buildActionResult(true, isInstallingUpdate)
    } catch (error) {
        await cancelPendingAppInstallation(error instanceof Error ? error.message : 'Installation did not start.')
        isInstallingUpdate = false
        const message = error instanceof Error ? error.message : String(error)
        setUpdateState(reduceUpdateStateOnInstallFailure(updateState, message))
        log.error('[updater] failed to install update', error)
        return buildActionResult(true, false)
    }
}

export function disposeUpdater(): void {
    clearUpdateTimers()
}
