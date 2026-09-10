import type { DevScopeBrowserAnnotationTheme } from '../../../shared/contracts/devscope-api'

/**
 * Runs in an Electron isolated world inside the owned Browser guest. It has DOM
 * access for direct annotation, but no preload, Node, Electron, or Zyra bridge.
 */
async function runBrowserPreviewAnnotation(theme: DevScopeBrowserAnnotationTheme) {
    type Point = { x: number; y: number }
    type Rect = { x: number; y: number; width: number; height: number }
    type Selected = { id: string; element: Element; outline: HTMLDivElement; label: HTMLDivElement }
    type Region = { id: string; rect: Rect; node: HTMLDivElement }
    type Stroke = { id: string; color: string; width: number; points: Point[]; bounds: Rect; node: SVGPolylineElement }
    type Tool = 'select' | 'region' | 'draw' | 'erase'

    const WORLD_KEY = '__zyraBrowserAnnotationSessionV1'
    const UI_ATTRIBUTE = 'data-zyra-browser-annotation-ui'
    const MAX_ELEMENTS = 40
    const MAX_REGIONS = 64
    const MAX_STROKES = 64
    const MAX_POINTS = 2_048
    const existing = (globalThis as unknown as Record<string, { cancel?: () => void }>)[WORLD_KEY]
    existing?.cancel?.()

    return await new Promise((resolve) => {
        let settled = false
        let attached = false
        let sequence = 0
        let tool: Tool = 'select'
        let drag: { pointerId: number; start: Point; points: Point[] } | null = null
        const selected = new Map<Element, Selected>()
        const regions: Region[] = []
        const strokes: Stroke[] = []
        const toolButtons = new Map<Tool, HTMLButtonElement>()

        const id = (prefix: string) => {
            sequence += 1
            return `${prefix}:${Date.now().toString(36)}:${sequence.toString(36)}`
        }
        const point = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })
        const rect = (start: Point, end: Point): Rect => ({
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y)
        })
        const pointBounds = (points: Point[], width: number): Rect => {
            const xs = points.map((entry) => entry.x)
            const ys = points.map((entry) => entry.y)
            return {
                x: Math.min(...xs) - width / 2,
                y: Math.min(...ys) - width / 2,
                width: Math.max(width, Math.max(...xs) - Math.min(...xs) + width),
                height: Math.max(width, Math.max(...ys) - Math.min(...ys) + width)
            }
        }
        const contains = (bounds: Rect, target: Point) => target.x >= bounds.x
            && target.x <= bounds.x + bounds.width
            && target.y >= bounds.y
            && target.y <= bounds.y + bounds.height
        const domRect = (value: DOMRect): Rect => ({ x: value.left, y: value.top, width: value.width, height: value.height })
        const union = (values: Rect[], padding = 18): Rect | null => {
            if (values.length === 0) return null
            const left = Math.min(...values.map((entry) => entry.x))
            const top = Math.min(...values.map((entry) => entry.y))
            const right = Math.max(...values.map((entry) => entry.x + entry.width))
            const bottom = Math.max(...values.map((entry) => entry.y + entry.height))
            const x = Math.max(0, left - padding)
            const y = Math.max(0, top - padding)
            return {
                x,
                y,
                width: Math.max(1, Math.min(window.innerWidth - x, right - left + padding * 2)),
                height: Math.max(1, Math.min(window.innerHeight - y, bottom - top + padding * 2))
            }
        }

        const host = document.createElement('div')
        host.setAttribute(UI_ATTRIBUTE, '')
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style;'
        const shadow = host.attachShadow({ mode: 'closed' })
        const style = document.createElement('style')
        style.textContent = `
            :host{all:initial;color-scheme:${theme.colorScheme};--z-bg:${theme.background};--z-fg:${theme.foreground};--z-card:${theme.popover};--z-muted:${theme.mutedForeground};--z-border:${theme.border};--z-primary:${theme.primary};--z-primary-fg:${theme.primaryForeground};font-family:${theme.fontFamily};}
            *{box-sizing:border-box} button,textarea{font:inherit}
            button{border:0;cursor:pointer} button:disabled{cursor:default;opacity:.4}
            .toolbar{pointer-events:auto;position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:4px;border:1px solid var(--z-border);border-radius:9px;background:color-mix(in srgb,var(--z-card) 96%,transparent);box-shadow:0 10px 28px rgba(0,0,0,.24);backdrop-filter:blur(16px);color:var(--z-fg)}
            .tool,.icon{height:30px;border-radius:6px;background:transparent;color:var(--z-muted)}
            .tool{padding:0 10px;font-size:12px;font-weight:550}.icon{display:inline-flex;align-items:center;justify-content:center;width:30px;flex:0 0 30px;padding:0;font-size:15px}.icon svg{position:static;display:block;width:16px;height:16px;flex:none;pointer-events:none}
            .tool:hover,.icon:hover{background:color-mix(in srgb,var(--z-fg) 7%,transparent);color:var(--z-fg)}
            .tool[data-active=true]{background:color-mix(in srgb,var(--z-primary) 12%,transparent);color:var(--z-primary)}
            .divider{width:1px;height:18px;margin:0 2px;background:var(--z-border)}
            .editor{pointer-events:auto;position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:none;align-items:flex-start;gap:8px;width:min(430px,calc(100vw - 24px));padding:8px;border:1px solid var(--z-border);border-radius:11px;background:color-mix(in srgb,var(--z-card) 97%,transparent);box-shadow:0 16px 40px rgba(0,0,0,.28);backdrop-filter:blur(18px);color:var(--z-fg)}
            textarea{min-width:0;min-height:32px;max-height:96px;flex:1;resize:none;border:0;border-bottom:1px solid transparent;background:transparent;padding:6px 2px;color:var(--z-fg);font-size:12px;line-height:18px;outline:none}
            textarea:focus{border-bottom-color:var(--z-primary)} textarea::placeholder{color:var(--z-muted)}
            .attach{height:32px;padding:0 13px;border-radius:7px;background:var(--z-primary);color:var(--z-primary-fg);font-size:12px;font-weight:650}.attach:hover{filter:brightness(1.08)}
            .outline,.region,.hover,.marquee{position:fixed;pointer-events:none;border:2px solid var(--z-primary);background:color-mix(in srgb,var(--z-primary) 8%,transparent)}
            .hover{border-style:dashed;background:color-mix(in srgb,var(--z-primary) 4%,transparent)}
            .marquee{border-style:dashed;background:color-mix(in srgb,var(--z-primary) 6%,transparent)}
            .label{position:fixed;pointer-events:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 6px;border-radius:4px;background:var(--z-primary);color:var(--z-primary-fg);font:600 10px/15px ${theme.fontFamily};box-shadow:0 4px 12px rgba(0,0,0,.2)}
            .drawing-plane{position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
        `
        shadow.appendChild(style)

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute(UI_ATTRIBUTE, '')
        svg.classList.add('drawing-plane')
        svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`)
        shadow.appendChild(svg)
        const hover = document.createElement('div')
        hover.className = 'hover'
        hover.style.display = 'none'
        shadow.appendChild(hover)
        const marquee = document.createElement('div')
        marquee.className = 'marquee'
        marquee.style.display = 'none'
        shadow.appendChild(marquee)

        const toolbar = document.createElement('div')
        toolbar.className = 'toolbar'
        toolbar.setAttribute(UI_ATTRIBUTE, '')
        const editor = document.createElement('div')
        editor.className = 'editor'
        editor.setAttribute(UI_ATTRIBUTE, '')
        const comment = document.createElement('textarea')
        comment.rows = 1
        comment.placeholder = 'Describe the change…'
        const attach = document.createElement('button')
        attach.className = 'attach'
        attach.textContent = 'Attach'
        editor.append(comment, attach)
        shadow.append(toolbar, editor)

        const isUiEvent = (event: Event) => event.composedPath().some((entry) => entry instanceof Element && entry.hasAttribute(UI_ATTRIBUTE))
        const pageElementAt = (x: number, y: number) => document.elementsFromPoint(x, y).find((entry) => (
            !entry.hasAttribute(UI_ATTRIBUTE)
            && entry !== document.documentElement
            && entry !== document.body
        )) || null
        const setBox = (node: HTMLElement, bounds: Rect) => {
            node.style.left = `${bounds.x}px`
            node.style.top = `${bounds.y}px`
            node.style.width = `${Math.max(0, bounds.width)}px`
            node.style.height = `${Math.max(0, bounds.height)}px`
        }
        const selector = (element: Element) => {
            if (element.id) return `#${CSS.escape(element.id)}`.slice(0, 512)
            const testId = element.getAttribute('data-testid')
            if (testId) return `[data-testid="${CSS.escape(testId)}"]`.slice(0, 512)
            const classes = Array.from(element.classList).slice(0, 3).map((name) => `.${CSS.escape(name)}`).join('')
            return `${element.tagName.toLowerCase()}${classes}`.slice(0, 512)
        }
        const attributes = (element: Element) => {
            const values: Record<string, string> = {}
            for (const attribute of Array.from(element.attributes).slice(0, 20)) {
                values[attribute.name.slice(0, 128)] = /pass(word|code)|secret|token|authorization|cookie/i.test(attribute.name)
                    ? '[redacted]'
                    : attribute.value.slice(0, 1_024)
            }
            if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') values.value = '[redacted]'
            return values
        }
        const updateEditor = () => {
            const hasTargets = selected.size > 0 || regions.length > 0 || strokes.length > 0
            editor.style.display = hasTargets ? 'flex' : 'none'
            attach.disabled = !hasTargets
            if (hasTargets) window.setTimeout(() => comment.focus({ preventScroll: true }), 0)
        }
        const repaint = () => {
            for (const item of selected.values()) {
                const bounds = item.element.getBoundingClientRect()
                setBox(item.outline, domRect(bounds))
                item.label.style.left = `${Math.max(0, bounds.left)}px`
                item.label.style.top = `${Math.max(0, bounds.top - 19)}px`
            }
        }
        const removeSelected = (item: Selected) => {
            selected.delete(item.element)
            item.outline.remove()
            item.label.remove()
            updateEditor()
        }
        const addSelected = (element: Element, additive: boolean) => {
            const previous = selected.get(element)
            if (previous) {
                removeSelected(previous)
                return
            }
            if (!additive) for (const item of [...selected.values()]) removeSelected(item)
            if (selected.size >= MAX_ELEMENTS) return
            const outline = document.createElement('div')
            outline.className = 'outline'
            const label = document.createElement('div')
            label.className = 'label'
            label.textContent = selector(element)
            const item = { id: id('element'), element, outline, label }
            selected.set(element, item)
            shadow.append(outline, label)
            repaint()
            updateEditor()
        }
        const removeAt = (target: Point) => {
            for (const item of [...selected.values()].reverse()) {
                if (contains(domRect(item.element.getBoundingClientRect()), target)) {
                    removeSelected(item)
                    return
                }
            }
            const regionIndex = regions.findIndex((entry) => contains(entry.rect, target))
            if (regionIndex >= 0) {
                regions[regionIndex].node.remove()
                regions.splice(regionIndex, 1)
                updateEditor()
                return
            }
            const strokeIndex = strokes.findIndex((entry) => contains(entry.bounds, target))
            if (strokeIndex >= 0) {
                strokes[strokeIndex].node.remove()
                strokes.splice(strokeIndex, 1)
                updateEditor()
            }
        }
        const clear = () => {
            for (const item of [...selected.values()]) removeSelected(item)
            for (const entry of regions.splice(0)) entry.node.remove()
            for (const entry of strokes.splice(0)) entry.node.remove()
            hover.style.display = 'none'
            marquee.style.display = 'none'
            updateEditor()
        }
        const setTool = (next: Tool) => {
            tool = next
            hover.style.display = 'none'
            marquee.style.display = 'none'
            for (const [name, button] of toolButtons) button.dataset.active = String(name === next)
        }
        const makeButton = (text: string, title: string, className = 'tool') => {
            const button = document.createElement('button')
            button.className = className
            button.textContent = text
            button.title = title
            button.setAttribute(UI_ATTRIBUTE, '')
            return button
        }
        for (const [name, label, shortcut] of [
            ['select', 'Select', 'V'],
            ['region', 'Region', 'R'],
            ['draw', 'Draw', 'D'],
            ['erase', 'Erase', 'E']
        ] as Array<[Tool, string, string]>) {
            const button = makeButton(label, `${label} (${shortcut})`)
            button.addEventListener('click', () => setTool(name))
            toolButtons.set(name, button)
            toolbar.appendChild(button)
        }
        const divider = document.createElement('span')
        divider.className = 'divider'
        const clearButton = makeButton('', 'Clear annotation', 'icon')
        clearButton.setAttribute('aria-label', 'Clear annotation')
        // A recognizable eraser, consistent with the rest of Zyra's tools.
        clearButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l10.6-10.6a2.4 2.4 0 0 1 3.4 0l4.6 4.6a2.4 2.4 0 0 1 0 3.4L11 21H7Z"/><path d="m5 11 9 9M11 21h10"/></svg>'
        clearButton.addEventListener('click', clear)
        const cancelButton = makeButton('×', 'Cancel annotation', 'icon')
        toolbar.append(divider, clearButton, cancelButton)
        setTool('select')

        const teardown = () => {
            window.removeEventListener('pointermove', onPointerMove, true)
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('pointerup', onPointerUp, true)
            window.removeEventListener('pointercancel', onPointerUp, true)
            window.removeEventListener('click', onClick, true)
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('scroll', repaint, true)
            window.removeEventListener('resize', repaint)
            host.remove()
            delete (globalThis as unknown as Record<string, unknown>)[WORLD_KEY]
        }
        const cancel = () => {
            if (settled) return
            settled = true
            teardown()
            resolve({ status: 'cancelled' })
        }
        const completeCapture = () => {
            if (!attached) return
            teardown()
        }
        cancelButton.addEventListener('click', cancel)

        const onPointerMove = (event: PointerEvent) => {
            if (isUiEvent(event)) {
                hover.style.display = 'none'
                return
            }
            if (tool === 'select' && !drag) {
                const element = pageElementAt(event.clientX, event.clientY)
                if (element) {
                    setBox(hover, domRect(element.getBoundingClientRect()))
                    hover.style.display = 'block'
                } else hover.style.display = 'none'
                return
            }
            hover.style.display = 'none'
            if (!drag) return
            if (tool === 'region') {
                setBox(marquee, rect(drag.start, point(event)))
                marquee.style.display = 'block'
            } else if (tool === 'draw' && strokes.length < MAX_STROKES && drag.points.length < MAX_POINTS) {
                drag.points.push(point(event))
                const active = strokes[strokes.length - 1]
                if (active?.id === `active:${drag.pointerId}`) {
                    active.points = [...drag.points]
                    active.bounds = pointBounds(active.points, active.width)
                    active.node.setAttribute('points', active.points.map((entry) => `${entry.x},${entry.y}`).join(' '))
                }
            }
        }
        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || isUiEvent(event)) return
            event.preventDefault()
            event.stopPropagation()
            const target = point(event)
            if (tool === 'select') {
                const element = pageElementAt(target.x, target.y)
                if (element) addSelected(element, event.shiftKey)
                return
            }
            if (tool === 'erase') {
                removeAt(target)
                return
            }
            drag = { pointerId: event.pointerId, start: target, points: [target] }
            if (tool === 'draw' && strokes.length < MAX_STROKES) {
                const node = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
                node.setAttribute('fill', 'none')
                node.setAttribute('stroke', theme.primary)
                node.setAttribute('stroke-width', '4')
                node.setAttribute('stroke-linecap', 'round')
                node.setAttribute('stroke-linejoin', 'round')
                svg.appendChild(node)
                strokes.push({ id: `active:${event.pointerId}`, color: theme.primary, width: 4, points: [target], bounds: { x: target.x, y: target.y, width: 1, height: 1 }, node })
            }
        }
        const onPointerUp = (event: PointerEvent) => {
            if (!drag || drag.pointerId !== event.pointerId) return
            event.preventDefault()
            event.stopPropagation()
            if (tool === 'region') {
                marquee.style.display = 'none'
                const bounds = rect(drag.start, point(event))
                if (bounds.width >= 3 && bounds.height >= 3 && regions.length < MAX_REGIONS) {
                    const node = document.createElement('div')
                    node.className = 'region'
                    setBox(node, bounds)
                    shadow.appendChild(node)
                    regions.push({ id: id('region'), rect: bounds, node })
                }
            } else if (tool === 'draw') {
                const active = strokes[strokes.length - 1]
                if (active?.id === `active:${event.pointerId}`) {
                    if (active.points.length < 2) {
                        active.node.remove()
                        strokes.pop()
                    } else active.id = id('stroke')
                }
            }
            drag = null
            updateEditor()
        }
        const onClick = (event: MouseEvent) => {
            if (isUiEvent(event)) return
            event.preventDefault()
            event.stopPropagation()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (isUiEvent(event) && event.key !== 'Escape') return
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                cancel()
                return
            }
            const key = event.key.toLowerCase()
            const next = key === 'v' ? 'select' : key === 'r' ? 'region' : key === 'd' ? 'draw' : key === 'e' ? 'erase' : null
            if (next) {
                event.preventDefault()
                setTool(next)
            }
        }

        attach.addEventListener('click', () => {
            if (settled || (selected.size === 0 && regions.length === 0 && strokes.length === 0)) return
            settled = true
            attached = true
            const createdAt = new Date().toISOString()
            const elements = [...selected.values()].map((item) => ({
                id: item.id,
                tabId: '',
                url: location.href.slice(0, 2_048),
                title: document.title.slice(0, 512) || null,
                selector: selector(item.element),
                tagName: item.element.tagName.toLowerCase().slice(0, 128),
                attributes: attributes(item.element),
                bounds: domRect(item.element.getBoundingClientRect()),
                createdAt
            }))
            toolbar.style.display = 'none'
            editor.style.display = 'none'
            hover.style.display = 'none'
            const captureRect = union([
                ...elements.flatMap((entry) => entry.bounds ? [entry.bounds] : []),
                ...regions.map((entry) => entry.rect),
                ...strokes.map((entry) => entry.bounds)
            ])
            resolve({
                status: 'attached',
                captureRect,
                annotation: {
                    id: id('annotation'),
                    tabId: '',
                    url: location.href.slice(0, 2_048),
                    title: document.title.slice(0, 512) || null,
                    comment: comment.value.trim().slice(0, 4_000),
                    elements,
                    regions: regions.map(({ id: regionId, rect: regionRect }) => ({ id: regionId, rect: regionRect })),
                    strokes: strokes.map(({ id: strokeId, color, width, points, bounds }) => ({ id: strokeId, color, width, points, bounds })),
                    styleChanges: [],
                    createdAt
                }
            })
        })
        comment.addEventListener('input', () => {
            comment.style.height = 'auto'
            comment.style.height = `${Math.min(96, comment.scrollHeight)}px`
        })
        comment.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                attach.click()
            }
        })

        window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
        window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false })
        window.addEventListener('pointerup', onPointerUp, { capture: true, passive: false })
        window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: false })
        window.addEventListener('click', onClick, { capture: true, passive: false })
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', repaint, { capture: true, passive: true })
        window.addEventListener('resize', repaint)
        document.documentElement.appendChild(host)
        const buttonRect = (button: HTMLButtonElement) => domRect(button.getBoundingClientRect())
        ;(globalThis as unknown as Record<string, unknown>)[WORLD_KEY] = {
            cancel,
            completeCapture,
            snapshot: () => ({
                elements: selected.size,
                regions: regions.length,
                strokes: strokes.length,
                tools: Object.fromEntries([...toolButtons].map(([name, button]) => [name, buttonRect(button)])),
                clear: buttonRect(clearButton),
                cancel: buttonRect(cancelButton)
            })
        }
    })
}

export function browserPreviewAnnotationSource(theme: DevScopeBrowserAnnotationTheme): string {
    return `(${runBrowserPreviewAnnotation.toString()})(${JSON.stringify(theme)})`
}

export const BROWSER_PREVIEW_ANNOTATION_CANCEL_SOURCE = `globalThis.__zyraBrowserAnnotationSessionV1?.cancel?.()`
export const BROWSER_PREVIEW_ANNOTATION_CAPTURED_SOURCE = `globalThis.__zyraBrowserAnnotationSessionV1?.completeCapture?.()`
