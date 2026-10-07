// App-owned presentation only. Runs in an opaque sandbox with no network access.
(() => {
    if (window === window.top) return
    let initialized = false
    addEventListener('message', event => {
    if (initialized || event.source !== parent || event.data?.type !== 'zyra:visualization-init') return
    const { channel, document: source } = event.data
    if (typeof channel !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(channel) || typeof source !== 'string') return
    initialized = true
    // Only the parent supplies DOMPurify-cleaned markup. The frame's immutable
    // hash CSP additionally blocks authored scripts, handlers and remote assets.
    const parsed = new DOMParser().parseFromString(source, 'text/html')
    const content = parsed.body.querySelector('.zyra-viz-content')
    if (!content) return
    for (const style of parsed.head.querySelectorAll('style')) document.head.append(document.importNode(style, true))
    document.body.replaceChildren(document.importNode(content, true))
    const mountedContent = document.body.firstElementChild
    let pending = false
    const report = () => {
        if (pending) return
        pending = true
        requestAnimationFrame(() => {
            pending = false
            parent.postMessage({ type: 'zyra:visualization-height', channel, height: Math.ceil(mountedContent.getBoundingClientRect().height) }, '*')
        })
    }
    new ResizeObserver(report).observe(mountedContent)
    addEventListener('load', report)
    document.fonts.ready.then(report)
    report()
    for (const details of mountedContent.querySelectorAll('details')) {
        const summary = details.querySelector(':scope > summary')
        if (!summary) continue
        const body = document.createElement('div')
        body.className = 'zyra-disclosure-body'
        for (const child of [...details.childNodes]) if (child !== summary) body.append(child)
        details.append(body)
        let open = details.open
        let animation
        let settleTimer
        summary.setAttribute('aria-expanded', String(open))
        summary.addEventListener('click', event => {
            event.preventDefault()
            const from = details.open ? body.getBoundingClientRect().height : 0
            clearTimeout(settleTimer)
            animation?.cancel()
            open = !open
            summary.setAttribute('aria-expanded', String(open))
            details.open = true
            body.style.overflow = 'hidden'
            const to = open ? body.scrollHeight : 0
            const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220
            animation = body.animate([{ height: `${from}px`, opacity: open ? 0.6 : 1 }, { height: `${to}px`, opacity: open ? 1 : 0.6 }], { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' })
            const finish = () => { clearTimeout(settleTimer); details.open = open; animation.cancel(); body.style.overflow = ''; report() }
            animation.onfinish = finish
            // Offscreen extension frames may suspend their document timeline.
            // The logical disclosure must still finish settling.
            settleTimer = setTimeout(finish, duration + 80)
        })
    }
    const tip = document.createElement('div')
    tip.className = 'zyra-chart-tooltip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.append(tip)
    const label = element => element.getAttribute('data-viz-tooltip') || element.getAttribute('title') || element.querySelector(':scope > title')?.textContent || element.getAttribute('aria-label')
    let cachedText
    let tipWidth = 0
    let tipHeight = 0
    let pointerFrame = 0
    let pointer
    const hide = () => { pointer = null; cancelAnimationFrame(pointerFrame); pointerFrame = 0; tip.hidden = true }
    const show = (element, x, y) => {
        const text = label(element)
        if (!text) { hide(); return }
        tip.hidden = false
        if (cachedText !== text) {
            tip.textContent = text
            cachedText = text
            tipWidth = tip.offsetWidth
            tipHeight = tip.offsetHeight
        }
        tip.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - tipWidth - 8))}px`
        tip.style.top = `${Math.max(8, y - tipHeight - 12)}px`
    }
    mountedContent.addEventListener('pointermove', event => {
        const element = event.target.closest('[data-viz-tooltip],svg circle,svg rect,svg path,svg polygon,[title]')
        if (!element) { hide(); return }
        pointer = { element, x: event.clientX, y: event.clientY }
        if (!pointerFrame) pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; if (pointer) show(pointer.element, pointer.x, pointer.y) })
    })
    mountedContent.addEventListener('pointerleave', hide)
    for (const element of mountedContent.querySelectorAll('[data-viz-tooltip],svg circle,svg rect,svg path,svg polygon')) {
        if (!label(element)) continue
        element.setAttribute('tabindex', '0')
        element.addEventListener('focus', () => { hide(); const bounds = element.getBoundingClientRect(); show(element, bounds.x + bounds.width / 2, bounds.y) })
        element.addEventListener('blur', hide)
    }
    addEventListener('scroll', hide, true)
    addEventListener('resize', () => { cachedText = undefined })
    document.fonts.ready.then(() => { cachedText = undefined })
    })
    parent.postMessage({ type: 'zyra:visualization-ready' }, '*')
})()
