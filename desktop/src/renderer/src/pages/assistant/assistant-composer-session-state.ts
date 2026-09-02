import { isAssistantRuntimeMode, type AssistantInteractionMode, type AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import { isAssistantReasoningEffort } from '@shared/assistant/reasoning-efforts'
import type { ComposerContextFile } from './assistant-composer-types'

export type AssistantComposerSessionState = {
    draft?: string
    contextFiles?: ComposerContextFile[]
    model?: string
    runtimeMode?: AssistantRuntimeMode
    interactionMode?: AssistantInteractionMode
    effort?: AssistantComposerPreferenceEffort
    fastModeEnabled?: boolean
}

const COMPOSER_SESSION_STORAGE_KEY_PREFIX = 'devscope:assistant:composer-session:v1:'
const COMPOSER_SESSION_EVENT = 'devscope:assistant:composer-session-updated'
const MAX_PERSISTED_ATTACHMENT_CONTENT_CHARS = 80_000
const MAX_PERSISTED_ATTACHMENT_PREVIEW_DATA_URL_CHARS = 350_000

export function areAssistantComposerConfigurationsEqual(
    left: AssistantComposerSessionState,
    right: AssistantComposerSessionState
): boolean {
    return left.model === right.model
        && left.runtimeMode === right.runtimeMode
        && left.interactionMode === right.interactionMode
        && left.effort === right.effort
        && left.fastModeEnabled === right.fastModeEnabled
}

export function areAssistantComposerSessionStatesEqual(
    left: AssistantComposerSessionState,
    right: AssistantComposerSessionState
): boolean {
    return left.draft === right.draft
        && areComposerContextFilesEqual(left.contextFiles, right.contextFiles)
        && areAssistantComposerConfigurationsEqual(left, right)
}

function sanitizeAssistantComposerSessionState(value: unknown): AssistantComposerSessionState {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const contextFiles = sanitizeComposerContextFiles(record.contextFiles)
    return {
        draft: typeof record.draft === 'string' && record.draft.length > 0 ? record.draft : undefined,
        contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
        model: typeof record.model === 'string' && record.model.trim().length > 0 ? record.model.trim() : undefined,
        runtimeMode: isAssistantRuntimeMode(record.runtimeMode) ? record.runtimeMode : undefined,
        interactionMode: record.interactionMode === 'plan' || record.interactionMode === 'default' ? 'default' : undefined,
        effort: isAssistantReasoningEffort(record.effort) ? record.effort : undefined,
        fastModeEnabled: typeof record.fastModeEnabled === 'boolean' ? record.fastModeEnabled : undefined
    }
}

function getAssistantComposerSessionStorageKey(sessionId: string): string {
    return `${COMPOSER_SESSION_STORAGE_KEY_PREFIX}${sessionId}`
}

function isAssistantComposerSessionStateEmpty(state: AssistantComposerSessionState): boolean {
    return !state.draft
        && (!state.contextFiles || state.contextFiles.length === 0)
        && !state.model
        && !state.runtimeMode
        && !state.interactionMode
        && !state.effort
        && state.fastModeEnabled === undefined
}

export function readAssistantComposerSessionOverrides(sessionId?: string | null): AssistantComposerSessionState {
    if (!sessionId) return {}
    try {
        const raw = localStorage.getItem(getAssistantComposerSessionStorageKey(sessionId))
        return raw ? sanitizeAssistantComposerSessionState(JSON.parse(raw)) : {}
    } catch {
        return {}
    }
}

export function readAssistantComposerSessionState(
    sessionId?: string | null,
    fallback: AssistantComposerSessionState = {}
): AssistantComposerSessionState {
    return {
        ...fallback,
        ...readAssistantComposerSessionOverrides(sessionId)
    }
}

function sanitizeComposerContextFiles(value: unknown): ComposerContextFile[] {
    if (!Array.isArray(value)) return []
    return value
        .map((entry, index) => sanitizeComposerContextFile(entry, index))
        .filter((entry): entry is ComposerContextFile => Boolean(entry))
}

function sanitizeComposerContextFile(value: unknown, index: number): ComposerContextFile | null {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
    if (!record) return null

    const path = typeof record.path === 'string' ? record.path.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!path && !name) return null

    const id = typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id.trim()
        : `persisted_attachment_${index}_${Date.now()}`
    const kind = record.kind === 'image' || record.kind === 'doc' || record.kind === 'code' || record.kind === 'file'
        ? record.kind
        : undefined
    const source = record.source === 'manual' || record.source === 'paste' ? record.source : undefined
    const sizeBytes = typeof record.sizeBytes === 'number' && Number.isFinite(record.sizeBytes) ? record.sizeBytes : undefined
    const content = typeof record.content === 'string' && record.content.length > 0
        ? record.content.slice(0, MAX_PERSISTED_ATTACHMENT_CONTENT_CHARS)
        : undefined
    const previewDataUrl = typeof record.previewDataUrl === 'string'
        && record.previewDataUrl.startsWith('data:')
        && record.previewDataUrl.length <= MAX_PERSISTED_ATTACHMENT_PREVIEW_DATA_URL_CHARS
        ? record.previewDataUrl
        : undefined

    return {
        id,
        path,
        name: name || undefined,
        content,
        mimeType: typeof record.mimeType === 'string' && record.mimeType.trim().length > 0 ? record.mimeType.trim() : undefined,
        kind,
        sizeBytes,
        previewText: typeof record.previewText === 'string' && record.previewText.trim().length > 0 ? record.previewText.trim() : undefined,
        previewDataUrl,
        source,
        animateIn: false
    }
}

function areComposerContextFilesEqual(
    left: ComposerContextFile[] | undefined,
    right: ComposerContextFile[] | undefined
): boolean {
    const leftFiles = left || []
    const rightFiles = right || []
    if (leftFiles.length !== rightFiles.length) return false
    return leftFiles.every((leftFile, index) => {
        const rightFile = rightFiles[index]
        return leftFile.id === rightFile.id
            && leftFile.path === rightFile.path
            && leftFile.name === rightFile.name
            && leftFile.content === rightFile.content
            && leftFile.mimeType === rightFile.mimeType
            && leftFile.kind === rightFile.kind
            && leftFile.sizeBytes === rightFile.sizeBytes
            && leftFile.previewText === rightFile.previewText
            && leftFile.previewDataUrl === rightFile.previewDataUrl
            && leftFile.source === rightFile.source
    })
}

export function writeAssistantComposerSessionState(sessionId: string, state: AssistantComposerSessionState): AssistantComposerSessionState {
    const sanitized = sanitizeAssistantComposerSessionState(state)
    try {
        const key = getAssistantComposerSessionStorageKey(sessionId)
        const current = readAssistantComposerSessionState(sessionId)
        if (areAssistantComposerSessionStatesEqual(current, sanitized)) return sanitized
        if (isAssistantComposerSessionStateEmpty(sanitized)) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify(sanitized))
        window.dispatchEvent(new CustomEvent(COMPOSER_SESSION_EVENT, {
            detail: {
                sessionId,
                state: sanitized
            }
        }))
    } catch {}
    return sanitized
}

export function clearAssistantComposerSessionState(sessionId: string): void {
    try {
        localStorage.removeItem(getAssistantComposerSessionStorageKey(sessionId))
        window.dispatchEvent(new CustomEvent(COMPOSER_SESSION_EVENT, {
            detail: {
                sessionId,
                state: {}
            }
        }))
    } catch {}
}

export function subscribeAssistantComposerSessionState(
    listener: (sessionId: string, state: AssistantComposerSessionState) => void
): () => void {
    const handleEvent = (event: Event) => {
        const detail = (event as CustomEvent<{ sessionId?: string; state?: AssistantComposerSessionState } | undefined>).detail
        const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : ''
        if (!sessionId) return
        listener(sessionId, sanitizeAssistantComposerSessionState(detail?.state))
    }
    window.addEventListener(COMPOSER_SESSION_EVENT, handleEvent)
    return () => window.removeEventListener(COMPOSER_SESSION_EVENT, handleEvent)
}
