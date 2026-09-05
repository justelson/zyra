// Browser-only QA: real App routing/rendering, explicit in-memory IPC fakes.
// No preload, browser bridge, filesystem, auth, process, or external-open access.
import { createRoot } from 'react-dom/client'
import type { OnboardingSnapshot } from '../../src/shared/onboarding/contracts'
import type { DevicePreferencesSnapshot, UpdateDevicePreferencesInput } from '../../src/shared/preferences/contracts'
import '../../src/renderer/src/index.css'

const defaultFile = 'C:/Fixture files/encoded # & + % 日本語.md'
const markdown = '# System file preview fixture\n\nThis Markdown comes only from the isolated QA IPC fake.\n'
const timestamp = '2026-01-01T00:00:00.000Z'
const calls: Array<{ method: string; args: unknown[] }> = []
const readPaths: string[] = []
const rendererErrors: string[] = []
const captureRendererError = (message: string) => { if (rendererErrors.length < 10 && !rendererErrors.includes(message)) rendererErrors.push(message) }
window.addEventListener('error', (event) => captureRendererError(event.message))
window.addEventListener('unhandledrejection', (event) => captureRendererError(String(event.reason)))
const originalConsoleError = console.error
console.error = (...args) => { captureRendererError(args.map(String).join(' ').slice(0,2000)); originalConsoleError(...args) }
const externalOpenCalls: Array<{ method: string; target: string }> = []
const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }) }
const subscribe = () => () => undefined
const blocked = async () => ({ success: false as const, error: 'Disabled in the isolated shell preview fixture.' })
const externalOpen = (method: string) => async (target: string) => {
    externalOpenCalls.push({ method, target })
    record(method, target)
    return { success: true as const }
}
const preferences: DevicePreferencesSnapshot = {
    schemaVersion: 1, revision: 1, surface: 'desktop', desktopLegacyMigrationComplete: true,
    updatedAt: timestamp,
    settings: { settingsSchemaVersion: 4, appearanceThemeMode: 'dark', filePreviewDefaultMode: 'preview' }
}
const onboarding: OnboardingSnapshot = {
    hydrated: true, accessAllowed: true, showOnboarding: false, blockedReason: null,
    detectedSchemaVersion: 1, recovery: null,
    record: {
        schemaVersion: 1, flowVersion: 2, revision: 1, status: 'completed', currentStep: 'review',
        completedSteps: ['welcome', 'connect-openai', 'appearance', 'projects', 'review'],
        reviewActive: false, startedAt: timestamp, updatedAt: timestamp, completedAt: timestamp, data: {}
    }
}
function setFile(file: string, mode: 'reload' | 'hash' = 'reload') {
    const hash = `#/quick-open?file=${encodeURIComponent(file)}`
    if (mode === 'hash') window.location.hash = hash
    else {
        // replaceState plus reload also works when the requested hash is unchanged.
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
        window.location.reload()
    }
}
Object.assign(window, {
    __shellPreviewFixture: {
        defaultFile, markdown, calls, readPaths, rendererErrors, externalOpenCalls, setFile,
        get routeFile() { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('file') },
        clearCalls() { calls.length = 0; readPaths.length = 0; externalOpenCalls.length = 0 }
    }
})
// Desktop runtime detection uses the UA. Install before dynamically importing App.
Object.defineProperty(navigator, 'userAgent', {
    configurable: true, value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ShellPreviewFixture Electron/40.0.0'
})
let maximized = false
const maximizeListeners = new Set<(value: boolean) => void>()
Object.defineProperty(window, 'devscope', { configurable: true, value: {
    preferences: {
        get: async () => ({ success: true, snapshot: structuredClone(preferences) }),
        update: async (input: UpdateDevicePreferencesInput) => {
            record('preferences.update', input)
            Object.assign(preferences.settings, input.patch)
            preferences.revision += 1
            return { success: true, snapshot: structuredClone(preferences) }
        },
        onChanged: subscribe
    },
    // Discard migration input without reading, storing, or forwarding credentials.
    secrets: {
        migrateLegacyHostedAiKeys: async () => ({ success: true, status: {
            groqConfigured: false, geminiConfigured: false, legacyMigrationComplete: false
        } }),
        updateHostedAiKeys: blocked
    },
    onboarding: {
        getState: async () => ({ success: true, snapshot: structuredClone(onboarding) }),
        onChanged: subscribe,
        getAuthStatus: blocked, connectChatGpt: blocked, connectApiKey: blocked,
        updateAppearance: blocked, commitStep: blocked, navigate: blocked,
        beginReview: blocked, cancelReview: blocked
    },
    window: {
        getRuntimeInfo: async () => ({ platform: 'win32', architecture: 'x64', appVersion: 'fixture',
            electronVersion: '40.0.0', isPackaged: false, nativeFrame: false, customWindowControls: true }),
        isMaximized: async () => maximized,
        onMaximizedChange: (listener: (value: boolean) => void) => {
            maximizeListeners.add(listener)
            return () => { maximizeListeners.delete(listener) }
        },
        minimize: async () => { record('window.minimize') },
        maximize: async () => {
            record('window.maximize'); maximized = !maximized
            maximizeListeners.forEach((listener) => listener(maximized))
        },
        close: async () => { record('window.close') }
    },
    readFileContent: async (path: string, options?: unknown) => {
        readPaths.push(path); record('readFileContent', path, options)
        const size = new TextEncoder().encode(markdown).length
        return { success: true, content: markdown, truncated: false, size, previewBytes: size, modifiedAt: Date.parse(timestamp) }
    },
    readTextFileFull: async (path: string) => {
        record('readTextFileFull', path)
        return { success: true, content: markdown, modifiedAt: Date.parse(timestamp) }
    },
    getFileTree: async (path: string, options?: unknown) => {
        record('getFileTree', path, options)
        return { success: true, tree: [] }
    },
    searchIndexedPaths: async () => ({ success: true, entries: [] }),
    listPreviewTerminalSessions: async () => ({ success: true, sessions: [] }),
    onPreviewTerminalEvent: subscribe, onPythonPreviewEvent: subscribe,
    createPreviewTerminal: blocked, runPythonPreview: blocked, stopPythonPreview: blocked,
    writeTextFile: blocked, readBinaryFile: blocked, getWorkingDiff: blocked,
    createFileSystemItem: blocked, renameFileSystemItem: blocked, deleteFileSystemItem: blocked,
    openFile: externalOpen('openFile'), openWith: externalOpen('openWith'),
    openInExplorer: externalOpen('openInExplorer'), openExternal: externalOpen('openExternal'),
    copyToClipboard: async (text: string) => { record('copyToClipboard', text); return { success: true } }
} })
Object.defineProperty(window, 'zyraAnalytics', { configurable: true, value: {
    capture: async (input: unknown) => { record('analytics.capture', input); return { success: true } },
    getStatus: blocked, setEnabled: blocked, onStatusChange: subscribe
} })
window.open = ((url?: string | URL) => {
    externalOpenCalls.push({ method: 'window.open', target: String(url || '') })
    return null
}) as typeof window.open
if (!window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/quick-open?file=${encodeURIComponent(defaultFile)}`)
}
// Deliberately do not import main.tsx, which installs the real browser bridge.
// No duplicate route or mocked product component: regressions must reach real App.
void import('../../src/renderer/src/App').then(({ default: App }) => {
    createRoot(document.getElementById('root')!).render(<App />)
})
