import type { AssistantComposerSessionState } from './assistant-composer-session-state'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import type { AssistantRuntimeMode } from '@shared/assistant/contracts'
import { DRAFT_STORAGE_KEY } from './assistant-composer-utils'

export const COMPOSER_SESSION_PERSIST_DEBOUNCE_MS = 180

export const EFFORT_LABELS: Record<AssistantComposerPreferenceEffort, string> = {
    off: 'Off',
    none: 'None',
    minimal: 'Minimal',
    low: 'Light',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
    max: 'Max'
}

export function buildEffortSliderTicks(optionCount: number): string {
    const safeCount = Math.max(1, Math.floor(optionCount))
    const sliderMax = safeCount - 1
    return Array.from({ length: safeCount }, (_, index) => {
        const position = sliderMax > 0 ? 2.8 + ((94.4 * index) / sliderMax) : 50
        return `radial-gradient(circle at ${position}% 50%, color-mix(in srgb, var(--color-text) 34%, transparent) 0 1.35px, transparent 1.6px)`
    }).join(', ')
}

export function getProfileLabel(runtimeMode: AssistantRuntimeMode) {
    if (runtimeMode === 'full-access') return 'Full access'
    if (runtimeMode === 'auto-review') return 'Auto review'
    if (runtimeMode === 'edits-only') return 'Edits only'
    return 'Supervised'
}

export function readLegacyComposerSessionState(): AssistantComposerSessionState {
    try {
        localStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {}
    return {}
}

export function syncScrollAffordance(
    element: HTMLDivElement | null,
    setCanScrollUp: (value: boolean) => void,
    setCanScrollDown: (value: boolean) => void
) {
    if (!element) {
        setCanScrollUp(false)
        setCanScrollDown(false)
        return
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    setCanScrollUp(element.scrollTop > 2)
    setCanScrollDown(maxScrollTop - element.scrollTop > 2)
}

export function ensureListItemVisible(
    listElement: HTMLDivElement | null,
    itemElement: HTMLElement | null,
    options?: { topInset?: number; bottomInset?: number }
) {
    if (!listElement || !itemElement) return
    const topInset = options?.topInset ?? 26
    const bottomInset = options?.bottomInset ?? 26
    const itemTop = itemElement.offsetTop
    const itemBottom = itemTop + itemElement.offsetHeight
    const visibleTop = listElement.scrollTop + topInset
    const visibleBottom = listElement.scrollTop + listElement.clientHeight - bottomInset
    if (itemTop < visibleTop) {
        requestAnimationFrame(() => { listElement.scrollTop = Math.max(0, itemTop - topInset) })
        return
    }
    if (itemBottom > visibleBottom) {
        requestAnimationFrame(() => {
            listElement.scrollTop = Math.min(listElement.scrollHeight - listElement.clientHeight, itemBottom - listElement.clientHeight + bottomInset)
        })
    }
}
