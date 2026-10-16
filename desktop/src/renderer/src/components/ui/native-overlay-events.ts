const documents = new Set<Document>()
const changes = new Set<() => void>()
const anchors = new Map<Element, Element>()

/** DOM boxes in a cropped native document still need owner-window coordinates. */
export function getOverlayOwnerRect(element: HTMLElement): DOMRect {
    const rect = element.getBoundingClientRect()
    const root = element.ownerDocument.getElementById('zyra-native-overlay-root')
    if (!root) return rect
    const origin = root.getBoundingClientRect()
    return new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height)
}

export function registerOverlayAnchor(anchor: Element, portalRoot: Element): () => void {
    anchors.set(portalRoot, anchor)
    return () => { if (anchors.get(portalRoot) === anchor) anchors.delete(portalRoot) }
}

export function registerOverlayDocument(document: Document): () => void {
    documents.add(document)
    for (const listener of changes) listener()
    return () => {
        documents.delete(document)
        for (const listener of changes) listener()
    }
}

export function getOverlayEventDocuments(node?: Node | null): Document[] {
    const owner = node?.ownerDocument ?? (typeof document === 'undefined' ? null : document)
    return [...new Set([...(owner ? [owner] : []), ...documents])]
}

export function isOverlayEventInside(event: Event, ...elements: Array<Element | null | undefined>): boolean {
    const target = event.target as Node | null
    if (!target || typeof target.nodeType !== 'number') return false
    const path = event.composedPath?.() ?? []
    const candidates: Node[] = [target]
    const visited = new Set<Node>()
    while (candidates.length) {
        const candidate = candidates.pop()!
        if (visited.has(candidate)) continue
        visited.add(candidate)
        if (elements.some(element => element && (path.includes(element) || element.contains(candidate)))) return true
        for (const [portal, anchor] of anchors) if (portal.contains(candidate)) candidates.push(anchor)
    }
    return false
}

/** Listen in the owner and lazily created portal documents without realm-specific instanceof checks. */
export function addOverlayEventListener<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
): () => void {
    const attached = new Set<Document>()
    const refresh = () => {
        const current = new Set(getOverlayEventDocuments())
        for (const document of attached) if (!current.has(document)) {
            document.removeEventListener(type, listener as EventListener, options)
            attached.delete(document)
        }
        for (const document of current) if (!attached.has(document)) {
            document.addEventListener(type, listener as EventListener, options)
            attached.add(document)
        }
    }
    changes.add(refresh)
    refresh()
    return () => {
        changes.delete(refresh)
        for (const document of attached) document.removeEventListener(type, listener as EventListener, options)
        attached.clear()
    }
}

export function isOverlayWindowFocused(): boolean {
    return getOverlayEventDocuments().some(document => document.hasFocus())
}

export function getOverlayActiveElement(): HTMLElement | null {
    const available = getOverlayEventDocuments()
    const focused = available.filter(document => document.hasFocus())
    for (const document of focused.length ? focused : available) {
        const element = document.activeElement
        if (element && element !== document.body && element !== document.documentElement && 'focus' in element) return element as HTMLElement
    }
    return null
}

export function addOverlayWindowBlurListener(listener: () => void): () => void {
    const attached = new Set<Window>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const blurred = () => {
        clearTimeout(timer)
        timer = setTimeout(() => { if (!isOverlayWindowFocused()) listener() }, 0)
    }
    const refresh = () => {
        const current = new Set<Window>(getOverlayEventDocuments().flatMap(document => document.defaultView ? [document.defaultView] : []))
        for (const window of attached) if (!current.has(window)) { window.removeEventListener('blur', blurred); attached.delete(window) }
        for (const window of current) if (!attached.has(window)) { window.addEventListener('blur', blurred); attached.add(window) }
    }
    changes.add(refresh)
    refresh()
    return () => {
        clearTimeout(timer)
        changes.delete(refresh)
        for (const window of attached) window.removeEventListener('blur', blurred)
    }
}
