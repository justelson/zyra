import type { DevScopeBrowserColorScheme } from '@shared/contracts/devscope-api'
import type { BrowserSessionMode } from '@shared/browser-view'
import { isAuthenticationBrowserUrl, sanitizeBrowserPersistentUrl } from '@shared/browser-url-sanitization'

export type AssistantBrowserTabStatus = 'idle' | 'loading' | 'ready' | 'error'
export const ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE = 'Dangerous site'

export type AssistantBrowserViewportPresetId =
    | 'iphone-se'
    | 'iphone-xr'
    | 'iphone-12-pro'
    | 'iphone-14-pro-max'
    | 'pixel-7'
    | 'samsung-galaxy-s8-plus'
    | 'samsung-galaxy-s20-ultra'
    | 'ipad-mini'
    | 'ipad-air'
    | 'ipad-pro'
    | 'surface-pro-7'
    | 'surface-duo'
    | 'galaxy-z-fold-5'
    | 'asus-zenbook-fold'
    | 'samsung-galaxy-a51-71'
    | 'nest-hub'
    | 'nest-hub-max'

export type AssistantBrowserViewportSetting =
    | { mode: 'fill' }
    | {
        mode: 'freeform' | 'preset'
        width: number
        height: number
        presetId: AssistantBrowserViewportPresetId | null
        aspectRatio: number | null
    }

export type AssistantBrowserViewportPreset = {
    id: AssistantBrowserViewportPresetId
    label: string
    category: 'Phone' | 'Tablet'
    detail: string
    width: number
    height: number
}

// Chrome DevTools' standard device order and CSS viewport dimensions.
export const ASSISTANT_BROWSER_VIEWPORT_PRESETS: AssistantBrowserViewportPreset[] = [
    { id: 'iphone-se', label: 'iPhone SE', category: 'Phone', detail: '375 × 667', width: 375, height: 667 },
    { id: 'iphone-xr', label: 'iPhone XR', category: 'Phone', detail: '414 × 896', width: 414, height: 896 },
    { id: 'iphone-12-pro', label: 'iPhone 12 Pro', category: 'Phone', detail: '390 × 844', width: 390, height: 844 },
    { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', category: 'Phone', detail: '430 × 932', width: 430, height: 932 },
    { id: 'pixel-7', label: 'Pixel 7', category: 'Phone', detail: '412 × 915', width: 412, height: 915 },
    { id: 'samsung-galaxy-s8-plus', label: 'Samsung Galaxy S8+', category: 'Phone', detail: '360 × 740', width: 360, height: 740 },
    { id: 'samsung-galaxy-s20-ultra', label: 'Samsung Galaxy S20 Ultra', category: 'Phone', detail: '412 × 915', width: 412, height: 915 },
    { id: 'ipad-mini', label: 'iPad Mini', category: 'Tablet', detail: '768 × 1024', width: 768, height: 1024 },
    { id: 'ipad-air', label: 'iPad Air', category: 'Tablet', detail: '820 × 1180', width: 820, height: 1180 },
    { id: 'ipad-pro', label: 'iPad Pro', category: 'Tablet', detail: '1024 × 1366', width: 1024, height: 1366 },
    { id: 'surface-pro-7', label: 'Surface Pro 7', category: 'Tablet', detail: '912 × 1368', width: 912, height: 1368 },
    { id: 'surface-duo', label: 'Surface Duo', category: 'Phone', detail: '540 × 720', width: 540, height: 720 },
    { id: 'galaxy-z-fold-5', label: 'Galaxy Z Fold 5', category: 'Phone', detail: '344 × 882', width: 344, height: 882 },
    { id: 'asus-zenbook-fold', label: 'Asus Zenbook Fold', category: 'Tablet', detail: '853 × 1280', width: 853, height: 1280 },
    { id: 'samsung-galaxy-a51-71', label: 'Samsung Galaxy A51/71', category: 'Phone', detail: '412 × 914', width: 412, height: 914 },
    { id: 'nest-hub', label: 'Nest Hub', category: 'Tablet', detail: '1024 × 600', width: 1024, height: 600 },
    { id: 'nest-hub-max', label: 'Nest Hub Max', category: 'Tablet', detail: '1280 × 800', width: 1280, height: 800 }
]

export const ASSISTANT_BROWSER_VIEWPORT_MIN = 240
export const ASSISTANT_BROWSER_VIEWPORT_MAX = 2560
export const ASSISTANT_BROWSER_VIEWPORT_MAX_AREA = 5_000_000

export type AssistantBrowserTabState = {
    id: string
    sessionMode: BrowserSessionMode
    url: string
    displayAddress: string | null
    title: string
    status: AssistantBrowserTabStatus
    error: string | null
    canGoBack: boolean
    canGoForward: boolean
    audible: boolean
    faviconUrl: string | null
    threatStatus?: 'dangerous'
    viewport: AssistantBrowserViewportSetting
    zoomFactor: number
    colorScheme: DevScopeBrowserColorScheme
    updatedAt: number
}

export type AssistantBrowserWorkspaceState = {
    version: 1
    activeTabId: string
    splitTabId: string | null
    tabs: AssistantBrowserTabState[]
}

export type AssistantBrowserNavigationResult =
    | { success: true; url: string }
    | { success: false; error: string }

export const ASSISTANT_BROWSER_TAB_LIMIT = 8
const ASSISTANT_BROWSER_STORAGE_KEY = 'zyra:assistant-browser-workspaces:v1'
const ASSISTANT_BROWSER_WORKSPACE_LIMIT = 20
const ASSISTANT_BROWSER_URL_LIMIT = 2048
const ASSISTANT_BROWSER_FAVICON_URL_LIMIT = 8192

export function createAssistantBrowserTab(id: string, url = '', sessionMode: BrowserSessionMode = 'normal'): AssistantBrowserTabState {
    const normalizedUrl = url.trim()
    return {
        id,
        sessionMode,
        url: normalizedUrl,
        displayAddress: null,
        title: normalizedUrl ? browserTabFallbackTitle(normalizedUrl) : 'New tab',
        status: normalizedUrl ? 'loading' : 'idle',
        error: null,
        canGoBack: false,
        canGoForward: false,
        audible: false,
        faviconUrl: null,
        viewport: { mode: 'fill' },
        zoomFactor: 1,
        colorScheme: 'system',
        updatedAt: Date.now()
    }
}

export function createAssistantBrowserWorkspaceState(
    tabId = 'browser:0',
    sessionMode: BrowserSessionMode = 'normal'
): AssistantBrowserWorkspaceState {
    return {
        version: 1,
        activeTabId: tabId,
        splitTabId: null,
        tabs: [createAssistantBrowserTab(tabId, '', sessionMode)]
    }
}

export function addAssistantBrowserTab(
    state: AssistantBrowserWorkspaceState,
    tabId: string,
    url = '',
    activate = true,
    sessionMode: BrowserSessionMode = 'normal'
): AssistantBrowserWorkspaceState {
    if (!tabId || state.tabs.some((tab) => tab.id === tabId)) {
        return state.tabs.some((tab) => tab.id === tabId)
            ? { ...state, activeTabId: tabId }
            : state
    }
    if (state.tabs.length >= ASSISTANT_BROWSER_TAB_LIMIT) return state
    return {
        ...state,
        version: 1,
        activeTabId: activate ? tabId : state.activeTabId,
        tabs: [...state.tabs, createAssistantBrowserTab(tabId, url, sessionMode)]
    }
}

export function resolveAssistantBrowserSurfaceTabSessionMode(
    selectedTabId: string,
    request: { tabId: string; mode?: string; sessionMode?: BrowserSessionMode } | null | undefined,
    trustedSessionMode?: BrowserSessionMode
): BrowserSessionMode {
    if (!request || request.tabId !== selectedTabId) return 'normal'
    return (request.mode || 'open') === 'open'
        ? request.sessionMode || 'incognito'
        : trustedSessionMode || 'normal'
}

export function ensureAssistantBrowserWorkspaceTab(
    state: AssistantBrowserWorkspaceState,
    tabId: string,
    sessionMode: BrowserSessionMode = 'normal'
): AssistantBrowserWorkspaceState {
    if (!tabId) return state
    if (state.tabs.some((tab) => tab.id === tabId)) return activateAssistantBrowserTab(state, tabId)
    const onlyTab = state.tabs.length === 1 ? state.tabs[0] : null
    if (onlyTab && !onlyTab.url && onlyTab.status === 'idle' && !onlyTab.error) {
        return {
            ...state,
            activeTabId: tabId,
            splitTabId: null,
            tabs: [{ ...onlyTab, id: tabId, sessionMode, updatedAt: Date.now() }]
        }
    }
    return addAssistantBrowserTab(state, tabId, '', true, sessionMode)
}

export function ensureAssistantBrowserSurfaceTabs(
    state: AssistantBrowserWorkspaceState,
    primaryTabId: string,
    secondaryTabId: string | null = null,
    primarySessionMode: BrowserSessionMode = 'normal'
): AssistantBrowserWorkspaceState {
    let next = ensureAssistantBrowserWorkspaceTab(state, primaryTabId, primarySessionMode)
    if (secondaryTabId && secondaryTabId !== primaryTabId && !next.tabs.some((tab) => tab.id === secondaryTabId)) {
        next = addAssistantBrowserTab(next, secondaryTabId, '', false)
    }
    return next.splitTabId ? { ...next, splitTabId: null } : next
}

export function shouldFocusAssistantBrowserOmnibox(
    workspaceActive: boolean,
    chromeReady: boolean,
    tab: Pick<AssistantBrowserTabState, 'url'> | null | undefined
): boolean {
    return Boolean(workspaceActive && chromeReady && tab && !tab.url)
}

export function activateAssistantBrowserTab(
    state: AssistantBrowserWorkspaceState,
    tabId: string
): AssistantBrowserWorkspaceState {
    if (!state.tabs.some((tab) => tab.id === tabId) || state.activeTabId === tabId) return state
    if (state.splitTabId === tabId) {
        return { ...state, activeTabId: tabId, splitTabId: state.activeTabId }
    }
    return { ...state, activeTabId: tabId }
}

export function setAssistantBrowserLayout(
    state: AssistantBrowserWorkspaceState,
    primaryTabId: string,
    secondaryTabId: string | null
): AssistantBrowserWorkspaceState {
    if (!state.tabs.some((tab) => tab.id === primaryTabId)) return state
    const splitTabId = secondaryTabId
        && secondaryTabId !== primaryTabId
        && state.tabs.some((tab) => tab.id === secondaryTabId)
        ? secondaryTabId
        : null
    if (state.activeTabId === primaryTabId && state.splitTabId === splitTabId) return state
    return { ...state, activeTabId: primaryTabId, splitTabId }
}

export function updateAssistantBrowserTab(
    state: AssistantBrowserWorkspaceState,
    tabId: string,
    patch: Partial<Omit<AssistantBrowserTabState, 'id'>>
): AssistantBrowserWorkspaceState {
    const index = state.tabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return state
    const current = state.tabs[index]
    const nextTab: AssistantBrowserTabState = {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: Number.isFinite(patch.updatedAt) ? Number(patch.updatedAt) : Date.now()
    }
    if (!nextTab.url) nextTab.title = 'New tab'
    if (
        current.url === nextTab.url
        && current.sessionMode === nextTab.sessionMode
        && current.title === nextTab.title
        && current.status === nextTab.status
        && current.error === nextTab.error
        && current.canGoBack === nextTab.canGoBack
        && current.canGoForward === nextTab.canGoForward
        && current.audible === nextTab.audible
        && current.faviconUrl === nextTab.faviconUrl
        && viewportSettingKey(current.viewport) === viewportSettingKey(nextTab.viewport)
        && current.zoomFactor === nextTab.zoomFactor
        && current.colorScheme === nextTab.colorScheme
    ) return state
    const tabs = state.tabs.slice()
    tabs[index] = nextTab
    return { ...state, tabs }
}

export function closeAssistantBrowserTab(
    state: AssistantBrowserWorkspaceState,
    tabId: string,
    replacementTabId: string
): AssistantBrowserWorkspaceState {
    const closingIndex = state.tabs.findIndex((tab) => tab.id === tabId)
    if (closingIndex < 0) return state
    const tabs = state.tabs.filter((tab) => tab.id !== tabId)
    if (tabs.length === 0) return createAssistantBrowserWorkspaceState(replacementTabId)
    if (state.splitTabId === tabId) return { ...state, splitTabId: null, tabs }
    if (state.activeTabId !== tabId) return { ...state, tabs }
    if (state.splitTabId && tabs.some((tab) => tab.id === state.splitTabId)) {
        return { ...state, activeTabId: state.splitTabId, splitTabId: null, tabs }
    }
    const fallback = tabs[Math.min(closingIndex, tabs.length - 1)] || tabs[0]
    return { ...state, activeTabId: fallback.id, splitTabId: null, tabs }
}

function normalizePersistentBrowserTitle(url: string, value: unknown, authenticationUrl = isAuthenticationBrowserUrl(url)): string {
    if (!url) return 'New tab'
    if (authenticationUrl) return browserTabFallbackTitle(url)
    const title = String(value || '').trim().slice(0, 256)
    return title || browserTabFallbackTitle(url)
}

export function normalizeAssistantBrowserWorkspaceState(
    candidate: unknown,
    fallbackTabId = 'browser:0'
): AssistantBrowserWorkspaceState {
    if (!candidate || typeof candidate !== 'object') return createAssistantBrowserWorkspaceState(fallbackTabId)
    const input = candidate as Partial<AssistantBrowserWorkspaceState>
    const seen = new Set<string>()
    const tabs = (Array.isArray(input.tabs) ? input.tabs : [])
        .flatMap((entry): AssistantBrowserTabState[] => {
            if (!entry || typeof entry !== 'object') return []
            const tab = entry as Partial<AssistantBrowserTabState>
            if (tab.sessionMode === 'incognito') return []
            const id = String(tab.id || '').trim().slice(0, 128)
            if (!id || seen.has(id)) return []
            seen.add(id)
            const rawUrl = String(tab.url || '').trim().slice(0, ASSISTANT_BROWSER_URL_LIMIT)
            const url = sanitizeBrowserPersistentUrl(rawUrl, ASSISTANT_BROWSER_URL_LIMIT) || ''
            return [{
                id,
                sessionMode: 'normal',
                url,
                displayAddress: null,
                title: normalizePersistentBrowserTitle(url, tab.title, isAuthenticationBrowserUrl(rawUrl)),
                status: 'idle',
                error: null,
                canGoBack: false,
                canGoForward: false,
                audible: false,
                faviconUrl: normalizeAssistantBrowserFaviconUrl(tab.faviconUrl),
                viewport: normalizeAssistantBrowserViewport(tab.viewport),
                zoomFactor: normalizeAssistantBrowserZoom(tab.zoomFactor),
                colorScheme: normalizeAssistantBrowserColorScheme(tab.colorScheme),
                updatedAt: Number.isFinite(tab.updatedAt) ? Number(tab.updatedAt) : Date.now()
            }]
        })
        .slice(0, ASSISTANT_BROWSER_TAB_LIMIT)
    if (tabs.length === 0) return createAssistantBrowserWorkspaceState(fallbackTabId)
    const requestedActiveTabId = String(input.activeTabId || '')
    const activeTabId = tabs.some((tab) => tab.id === requestedActiveTabId) ? requestedActiveTabId : tabs[0].id
    const requestedSplitTabId = String(input.splitTabId || '')
    return {
        version: 1,
        activeTabId,
        splitTabId: requestedSplitTabId !== activeTabId && tabs.some((tab) => tab.id === requestedSplitTabId)
            ? requestedSplitTabId
            : null,
        tabs
    }
}

function workspaceSnapshotForPersistence(state: AssistantBrowserWorkspaceState): AssistantBrowserWorkspaceState {
    const tabs = state.tabs
        .filter((tab) => tab.sessionMode === 'normal')
        .map((tab) => {
            const url = sanitizeBrowserPersistentUrl(tab.url, ASSISTANT_BROWSER_URL_LIMIT) || ''
            return {
                ...tab,
                sessionMode: 'normal' as const,
                url,
                displayAddress: null,
                title: normalizePersistentBrowserTitle(url, tab.title, isAuthenticationBrowserUrl(tab.url)),
                faviconUrl: normalizeAssistantBrowserFaviconUrl(tab.faviconUrl)
            }
        })
    if (tabs.length === 0) return createAssistantBrowserWorkspaceState()
    const activeTabId = tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : tabs[0].id
    return {
        version: 1,
        activeTabId,
        splitTabId: state.splitTabId !== activeTabId && tabs.some((tab) => tab.id === state.splitTabId)
            ? state.splitTabId
            : null,
        tabs
    }
}

function sanitizeStoredWorkspaceRecord(stored: Record<string, unknown>): Record<string, AssistantBrowserWorkspaceState> {
    return Object.fromEntries(Object.entries(stored).flatMap(([key, value], index) => {
        if (!value || typeof value !== 'object' || !Array.isArray((value as { tabs?: unknown }).tabs)) return []
        return [[key, workspaceSnapshotForPersistence(normalizeAssistantBrowserWorkspaceState(value, `browser:restored:${index}`))]]
    }))
}

function readAndSanitizePersistedWorkspaceRecord(): Record<string, AssistantBrowserWorkspaceState> {
    const stored = JSON.parse(localStorage.getItem(ASSISTANT_BROWSER_STORAGE_KEY) || '{}') as Record<string, unknown>
    const sanitized = sanitizeStoredWorkspaceRecord(stored)
    localStorage.setItem(ASSISTANT_BROWSER_STORAGE_KEY, JSON.stringify(sanitized))
    return sanitized
}

export function hasPersistedAssistantBrowserWorkspaceState(workspaceKey: string): boolean {
    if (!workspaceKey || typeof window === 'undefined') return false
    try {
        return Object.prototype.hasOwnProperty.call(readAndSanitizePersistedWorkspaceRecord(), workspaceKey)
    } catch {
        return false
    }
}

export function loadAssistantBrowserWorkspaceState(workspaceKey: string): AssistantBrowserWorkspaceState {
    if (!workspaceKey || typeof window === 'undefined') return createAssistantBrowserWorkspaceState()
    try {
        return readAndSanitizePersistedWorkspaceRecord()[workspaceKey] || createAssistantBrowserWorkspaceState()
    } catch {
        return createAssistantBrowserWorkspaceState()
    }
}

export function countPersistedAssistantBrowserWorkspaces(): number {
    if (typeof window === 'undefined') return 0
    try {
        return Object.keys(readAndSanitizePersistedWorkspaceRecord()).length
    } catch {
        return 0
    }
}

export function clearPersistedAssistantBrowserWorkspaces(): void {
    if (typeof window === 'undefined') return
    localStorage.removeItem(ASSISTANT_BROWSER_STORAGE_KEY)
}

export function persistAssistantBrowserWorkspaceState(
    workspaceKey: string,
    state: AssistantBrowserWorkspaceState
): void {
    if (!workspaceKey || typeof window === 'undefined') return
    try {
        const stored = readAndSanitizePersistedWorkspaceRecord()
        const entries = Object.entries(stored).filter(([key]) => key !== workspaceKey)
        const bounded = entries.slice(Math.max(0, entries.length - ASSISTANT_BROWSER_WORKSPACE_LIMIT + 1))
        localStorage.setItem(ASSISTANT_BROWSER_STORAGE_KEY, JSON.stringify({
            ...Object.fromEntries(bounded),
            [workspaceKey]: workspaceSnapshotForPersistence(state)
        }))
    } catch {
        // Browser state is helpful continuity, never a reason to break navigation.
    }
}

export function normalizeAssistantBrowserZoom(value: unknown): number {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 1
    return Math.round(Math.min(2, Math.max(0.25, numeric)) * 100) / 100
}

export function normalizeAssistantBrowserColorScheme(value: unknown): DevScopeBrowserColorScheme {
    return value === 'light' || value === 'dark' ? value : 'system'
}

export function normalizeAssistantBrowserViewportDimension(value: unknown, fallback: number): number {
    const numeric = Math.round(Number(value))
    return Number.isFinite(numeric)
        ? Math.min(ASSISTANT_BROWSER_VIEWPORT_MAX, Math.max(ASSISTANT_BROWSER_VIEWPORT_MIN, numeric))
        : fallback
}

export function normalizeAssistantBrowserViewport(value: unknown): AssistantBrowserViewportSetting {
    if (!value || typeof value !== 'object' || (value as { mode?: unknown }).mode === 'fill') return { mode: 'fill' }
    const candidate = value as Partial<Exclude<AssistantBrowserViewportSetting, { mode: 'fill' }>>
    const requestedPresetId = String(candidate.presetId || '')
    const preset = ASSISTANT_BROWSER_VIEWPORT_PRESETS.find((entry) => entry.id === requestedPresetId) || null
    let width = normalizeAssistantBrowserViewportDimension(candidate.width, preset?.width || 1280)
    let height = normalizeAssistantBrowserViewportDimension(candidate.height, preset?.height || 800)
    if (width * height > ASSISTANT_BROWSER_VIEWPORT_MAX_AREA) {
        const scale = Math.sqrt(ASSISTANT_BROWSER_VIEWPORT_MAX_AREA / (width * height))
        width = Math.max(ASSISTANT_BROWSER_VIEWPORT_MIN, Math.floor(width * scale))
        height = Math.max(ASSISTANT_BROWSER_VIEWPORT_MIN, Math.floor(height * scale))
    }
    const rawRatio = Number(candidate.aspectRatio)
    return {
        mode: candidate.mode === 'preset' && preset ? 'preset' : 'freeform',
        width,
        height,
        presetId: candidate.mode === 'preset' && preset ? preset.id : null,
        aspectRatio: Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : null
    }
}

export function viewportSettingKey(value: AssistantBrowserViewportSetting): string {
    return value.mode === 'fill'
        ? 'fill'
        : `${value.mode}:${value.presetId || ''}:${value.width}:${value.height}:${value.aspectRatio || ''}`
}

export function normalizeAssistantBrowserFaviconUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const candidate = value.trim()
    if (!candidate || candidate.length > ASSISTANT_BROWSER_FAVICON_URL_LIMIT) return null
    if (/^data:image\/(?:png|gif|jpe?g|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test(candidate)) {
        return candidate
    }
    try {
        const parsed = new URL(candidate)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? sanitizeBrowserPersistentUrl(parsed.toString(), ASSISTANT_BROWSER_FAVICON_URL_LIMIT)
            : null
    } catch {
        return null
    }
}

export function isSafeAssistantBrowserUrl(value: string): boolean {
    try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

export function normalizeAssistantBrowserNavigation(rawInput: string): AssistantBrowserNavigationResult {
    const trimmed = String(rawInput || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (!trimmed) return { success: false, error: 'Enter an address or search.' }
    if (trimmed.length > ASSISTANT_BROWSER_URL_LIMIT) {
        return { success: false, error: `Address must be ${ASSISTANT_BROWSER_URL_LIMIT} characters or fewer.` }
    }

    const loopback = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d{1,5})?(?:[/?#]|$)/i.test(trimmed)
    const localName = /^[a-z\d-]+\.local(?::\d{1,5})?(?:[/?#]|$)/i.test(trimmed)
    const hostnameWithPort = /^[a-z\d.-]+:\d{1,5}(?:[/?#]|$)/i.test(trimmed)
    const explicitScheme = trimmed.match(/^([a-z][a-z\d+.-]*):(?:\/\/)?/i)?.[1]?.toLowerCase()
    const schemeIsHostPort = hostnameWithPort || loopback || localName
    if (explicitScheme && !schemeIsHostPort && explicitScheme !== 'http' && explicitScheme !== 'https') {
        return { success: false, error: `Zyra Browser cannot open ${explicitScheme}: addresses.` }
    }

    const candidate = explicitScheme && !schemeIsHostPort
        ? trimmed
        : loopback || localName
            ? `http://${trimmed}`
            : /^[^\s/]+\.[^\s]+(?:[/?#].*)?$/i.test(trimmed)
                ? `https://${trimmed}`
                : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`

    try {
        const parsed = new URL(candidate)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { success: false, error: 'Only HTTP and HTTPS addresses are supported.' }
        }
        if (parsed.port) {
            const port = Number(parsed.port)
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                return { success: false, error: 'That port is outside the valid range.' }
            }
        }
        return { success: true, url: parsed.toString() }
    } catch {
        return { success: false, error: 'That address could not be understood.' }
    }
}

export function browserTabFallbackTitle(url: string): string {
    try {
        const parsed = new URL(url)
        return parsed.hostname || parsed.href
    } catch {
        return url || 'New tab'
    }
}
