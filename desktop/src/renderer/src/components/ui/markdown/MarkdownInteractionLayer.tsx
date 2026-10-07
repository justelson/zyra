import { openDesktopLink } from '@/lib/desktop-links'
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { MarkdownLinkContextMenu, type MarkdownLinkMenuTarget } from './MarkdownLinkContextMenu'
import { hasActiveTextSelection } from './fileReferences'
import { inspectMarkdownLinkAvailability } from './linkAvailability'
import { isMarkdownScrollBusy } from './markdownScrollActivity'
import { navigateMarkdownLink, resolveMarkdownLinkTarget } from './linkNavigation'

export type MarkdownInternalLinkHandler = (
    href: string
) => boolean | void | Promise<boolean | void>

export type MarkdownLinkNoticeHandler = (
    message: string,
    tone: 'info' | 'error'
) => void

type MarkdownInteractionLayerProps = {
    rootRef: RefObject<HTMLElement | null>
    filePath?: string
    searchRootPath?: string
    contentKey: string
    onInternalLinkClick?: MarkdownInternalLinkHandler
    onLinkNotice?: MarkdownLinkNoticeHandler
    onAnchorLinkClick?: (href: string) => boolean
}

type MarkdownLinkElement = HTMLAnchorElement | HTMLElement

const MARKDOWN_INTERACTIVE_TARGET_SELECTOR = [
    'a[href]',
    'code[data-devscope-file-reference]',
    'button[data-markdown-heading-target]',
    '[data-markdown-image-target]'
].join(', ')

function findInteractiveTarget(target: EventTarget | null, root: HTMLElement): MarkdownLinkElement | null {
    const element = target instanceof HTMLElement
        ? target
        : target instanceof Text
            ? target.parentElement
            : null
    if (!element || !root.contains(element)) return null
    const containingAnchor = element.closest<HTMLAnchorElement>('a[href]')
    if (containingAnchor) return containingAnchor
    return element.closest(MARKDOWN_INTERACTIVE_TARGET_SELECTOR) as MarkdownLinkElement | null
}

function collectInteractiveTargets(root: HTMLElement, scope: Node): MarkdownLinkElement[] {
    const targets: MarkdownLinkElement[] = []
    if (scope instanceof Element && scope.matches(MARKDOWN_INTERACTIVE_TARGET_SELECTOR)) {
        targets.push(scope as MarkdownLinkElement)
    }
    if (scope instanceof Element || scope instanceof DocumentFragment) {
        targets.push(...Array.from(scope.querySelectorAll(MARKDOWN_INTERACTIVE_TARGET_SELECTOR)) as MarkdownLinkElement[])
    }
    return targets.filter((target) => root.contains(target))
}

function getTargetHref(target: MarkdownLinkElement): string {
    if (target instanceof HTMLAnchorElement) return target.getAttribute('href') || ''
    if (target.dataset.markdownHeadingTarget) return `#${target.dataset.markdownHeadingTarget}`
    return target.dataset.markdownImageTarget || target.dataset.devscopeFileReference || ''
}

function clearLinkState(target: MarkdownLinkElement): void {
    delete target.dataset.markdownLinkState
    delete target.dataset.markdownLinkPath
    delete target.dataset.markdownTargetKind
    target.removeAttribute('aria-disabled')
    target.removeAttribute('title')
}

function applyLinkState(
    target: MarkdownLinkElement,
    state: 'checking' | 'available' | 'missing' | 'unknown' | 'failed',
    targetPath: string,
    targetKind: 'file' | 'directory' | null = null
): void {
    target.dataset.markdownLinkState = state
    target.dataset.markdownLinkPath = targetPath
    if (targetKind) target.dataset.markdownTargetKind = targetKind
    else delete target.dataset.markdownTargetKind

    if (state === 'missing' || state === 'failed') {
        target.setAttribute('aria-disabled', 'true')
        target.title = state === 'missing'
            ? `Missing file: ${targetPath}`
            : `Could not open: ${targetPath}`
        return
    }

    if (state === 'checking' || state === 'unknown') target.setAttribute('aria-disabled', 'true')
    else target.removeAttribute('aria-disabled')
    if (state === 'checking') target.title = `Checking link: ${targetPath}`
    if (state === 'available') target.title = `Open: ${targetPath}`
    if (state === 'unknown') target.title = `Could not verify this link: ${targetPath}`
}

const SANITIZED_FRAGMENT_PREFIX = 'user-content-'
const MAX_CONCURRENT_MARKDOWN_LINK_CHECKS = 4
let markdownLinkRequestSequence = 0

function normalizeSanitizedFragmentId(value: string): string {
    let normalized = value
    while (normalized.startsWith(SANITIZED_FRAGMENT_PREFIX)) {
        normalized = normalized.slice(SANITIZED_FRAGMENT_PREFIX.length)
    }
    return normalized
}

function resolveMarkdownAnchorTarget(root: HTMLElement, href: string): HTMLElement | null {
    const rawId = href.slice(1)
    let targetId = rawId
    try {
        targetId = decodeURIComponent(rawId)
    } catch {
        targetId = rawId
    }
    const normalizedTargetId = normalizeSanitizedFragmentId(targetId)
    return Array.from(root.querySelectorAll<HTMLElement>('[id]'))
        .find((element) => (
            element.id === targetId
            || normalizeSanitizedFragmentId(element.id) === normalizedTargetId
        )) || null
}

function preventDragFromInteractiveTarget(target: EventTarget | null, root: HTMLElement, event: DragEvent): void {
    const interactiveTarget = findInteractiveTarget(target, root)
    if (interactiveTarget) event.preventDefault()
}

export function MarkdownInteractionLayer({
    rootRef,
    filePath,
    searchRootPath,
    contentKey,
    onInternalLinkClick,
    onLinkNotice,
    onAnchorLinkClick
}: MarkdownInteractionLayerProps) {
    const [menuTarget, setMenuTarget] = useState<MarkdownLinkMenuTarget | null>(null)
    const closeMenu = useCallback((options?: { restoreFocus?: boolean }) => {
        setMenuTarget((target) => {
            if (options?.restoreFocus && target?.element.isConnected) target.element.focus({ preventScroll: true })
            return null
        })
    }, [])
    useEffect(() => closeMenu(), [contentKey, filePath, searchRootPath, closeMenu])
    useEffect(() => {
        const root = rootRef.current
        if (!root) return
        let disposed = false
        let availabilityIdleId: number | null = null
        let availabilityTimerId: number | null = null
        const pendingTargets = new Set<MarkdownLinkElement>()
        const inspectedTargets = new WeakMap<MarkdownLinkElement, { href: string; generation: number }>()
        let activeAvailabilityChecks = 0

        const inspectPendingLinks = () => {
            availabilityIdleId = null
            availabilityTimerId = null
            if (disposed) return
            if (isMarkdownScrollBusy()) {
                availabilityTimerId = window.setTimeout(inspectPendingLinks, 160)
                return
            }
            const availableSlots = Math.max(0, MAX_CONCURRENT_MARKDOWN_LINK_CHECKS - activeAvailabilityChecks)
            const targets = [...pendingTargets].slice(0, availableSlots)
            for (const target of targets) {
                pendingTargets.delete(target)
                if (!root.contains(target)) continue
                const href = getTargetHref(target)
                const previousInspection = inspectedTargets.get(target)
                if (previousInspection?.href === href) continue
                const generation = (previousInspection?.generation || 0) + 1
                inspectedTargets.set(target, { href, generation })
                clearLinkState(target)
                if (href.startsWith('#')) continue
                const resolvedTarget = resolveMarkdownLinkTarget(href, filePath)
                if (!resolvedTarget) continue
                applyLinkState(target, 'checking', resolvedTarget.path)
                activeAvailabilityChecks += 1
                void inspectMarkdownLinkAvailability(href, filePath, searchRootPath, {
                    allowProjectSearch: false
                }).then((result) => {
                    const currentInspection = inspectedTargets.get(target)
                    if (
                        disposed
                        || !result
                        || !root.contains(target)
                        || getTargetHref(target) !== href
                        || currentInspection?.generation !== generation
                    ) return
                    applyLinkState(target, result.availability, result.path, result.targetKind)
                }).finally(() => {
                    activeAvailabilityChecks = Math.max(0, activeAvailabilityChecks - 1)
                    scheduleInspection()
                })
            }
            scheduleInspection()
        }
        const scheduleInspection = () => {
            if (
                disposed
                || availabilityIdleId !== null
                || availabilityTimerId !== null
                || pendingTargets.size === 0
                || activeAvailabilityChecks >= MAX_CONCURRENT_MARKDOWN_LINK_CHECKS
            ) return
            if (typeof window.requestIdleCallback === 'function') {
                availabilityIdleId = window.requestIdleCallback(inspectPendingLinks, { timeout: 500 })
            } else {
                availabilityTimerId = window.setTimeout(inspectPendingLinks, 0)
            }
        }
        const enqueueScope = (scope: Node) => {
            for (const target of collectInteractiveTargets(root, scope)) {
                if (inspectedTargets.get(target)?.href !== getTargetHref(target)) pendingTargets.add(target)
            }
            scheduleInspection()
        }

        enqueueScope(root)
        const mutationObserver = typeof MutationObserver === 'undefined'
            ? null
            : new MutationObserver((records) => {
                for (const record of records) {
                    if (record.type === 'attributes') enqueueScope(record.target)
                    for (const addedNode of record.addedNodes) enqueueScope(addedNode)
                }
            })
        mutationObserver?.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href', 'data-markdown-heading-target', 'data-markdown-image-target', 'data-devscope-file-reference']
        })

        return () => {
            disposed = true
            mutationObserver?.disconnect()
            if (availabilityIdleId !== null) window.cancelIdleCallback(availabilityIdleId)
            if (availabilityTimerId !== null) window.clearTimeout(availabilityTimerId)
            pendingTargets.clear()
        }
    }, [contentKey, filePath, rootRef, searchRootPath])

    useEffect(() => {
        const root = rootRef.current
        if (!root) return
        const handleClick = async (event: MouseEvent) => {
            const target = findInteractiveTarget(event.target, root)
            if (!target) return

            const rawHref = getTargetHref(target)
            if (!rawHref) return
            if (rawHref.startsWith('#')) {
                event.preventDefault()
                if (hasActiveTextSelection()) return
                const anchorTarget = resolveMarkdownAnchorTarget(root, rawHref)
                const currentHeading = target.closest('h1,h2,h3,h4,h5,h6')
                if (anchorTarget && currentHeading === anchorTarget) {
                    onLinkNotice?.('This section is already in view.', 'info')
                    return
                }
                if (anchorTarget) anchorTarget.scrollIntoView({ behavior: 'smooth', block: 'start' })
                else onAnchorLinkClick?.(rawHref)
                return
            }
            const imageTarget = target.dataset.markdownImageTarget
            if (imageTarget && /^https?:\/\//i.test(rawHref)) {
                event.preventDefault()
                if (hasActiveTextSelection()) return
                void openDesktopLink(rawHref)
                return
            }

            const internalTarget = resolveMarkdownLinkTarget(rawHref, filePath)
            if (!internalTarget) {
                if (target.hasAttribute('data-markdown-file-link')) {
                    event.preventDefault()
                    onLinkNotice?.('The working folder for this file link is not available yet.', 'error')
                }
                return
            }

            // Local Markdown targets must never fall through to browser/app routing.
            event.preventDefault()
            if (hasActiveTextSelection()) return

            markdownLinkRequestSequence += 1
            const requestToken = `${markdownLinkRequestSequence}:${rawHref}`
            target.dataset.markdownLinkRequest = requestToken
            const availability = await inspectMarkdownLinkAvailability(rawHref, filePath, searchRootPath, {
                force: true,
                allowProjectSearch: !target.dataset.devscopeFileReference
            })
            if (disposed || !root.contains(target) || getTargetHref(target) !== rawHref || target.dataset.markdownLinkRequest !== requestToken) return
            delete target.dataset.markdownLinkRequest
            if (availability?.availability === 'missing') {
                applyLinkState(target, 'missing', availability.path)
                onLinkNotice?.(`Broken link — file not found: ${availability.path}`, 'error')
                return
            }
            if (availability?.availability !== 'available') {
                applyLinkState(target, 'unknown', availability?.path || internalTarget.path)
                onLinkNotice?.(`Could not verify this file: ${availability?.path || internalTarget.path}`, 'error')
                return
            }
            applyLinkState(target, availability.availability, availability.path, availability.targetKind)
            const openTarget = availability.resolvedBy === 'project-search'
                ? `${availability.path}${internalTarget.anchor ? `#${internalTarget.anchor}` : internalTarget.focusLine ? `#L${internalTarget.focusLine}` : ''}`
                : rawHref

            try {
                const opened = onInternalLinkClick
                    ? await onInternalLinkClick(openTarget)
                    : await navigateMarkdownLink({ href: openTarget, filePath })
                if (opened === false) {
                    const targetPath = availability?.path || internalTarget.path
                    applyLinkState(target, 'failed', targetPath)
                    onLinkNotice?.(`Could not open link: ${targetPath}`, 'error')
                }
            } catch {
                const targetPath = availability?.path || internalTarget.path
                applyLinkState(target, 'failed', targetPath)
                onLinkNotice?.(`Could not open link: ${targetPath}`, 'error')
            }
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            const target = findInteractiveTarget(event.target, root)
            if (!target?.dataset.markdownImageTarget) return
            event.preventDefault()
            target.click()
        }
        const handleDragStart = (event: DragEvent) => {
            preventDragFromInteractiveTarget(event.target, root, event)
        }
        const handleContextMenu = (event: MouseEvent) => {
            const target = findInteractiveTarget(event.target, root)
            if (!target) return
            const href = getTargetHref(target)
            if (!href || href.startsWith('#')) return
            const fileLink = Boolean(resolveMarkdownLinkTarget(href, filePath) || target.hasAttribute('data-markdown-file-link'))
            if (!fileLink && !/^https?:\/\//i.test(href)) return
            event.preventDefault()
            event.stopPropagation()
            setMenuTarget({ element: target, href, fileLink, x: event.clientX, y: event.clientY })
        }

        let disposed = false
        root.addEventListener('click', handleClick)
        root.addEventListener('keydown', handleKeyDown)
        root.addEventListener('dragstart', handleDragStart)
        root.addEventListener('contextmenu', handleContextMenu)
        return () => {
            disposed = true
            root.removeEventListener('click', handleClick)
            root.removeEventListener('keydown', handleKeyDown)
            root.removeEventListener('dragstart', handleDragStart)
            root.removeEventListener('contextmenu', handleContextMenu)
        }
    }, [filePath, onAnchorLinkClick, onInternalLinkClick, onLinkNotice, rootRef, searchRootPath])

    return menuTarget ? <MarkdownLinkContextMenu key={`${filePath}:${menuTarget.href}`} target={menuTarget} filePath={filePath} searchRootPath={searchRootPath} onClose={closeMenu} onLinkNotice={onLinkNotice} /> : null
}
