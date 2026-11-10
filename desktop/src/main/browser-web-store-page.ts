import type { chromeWebStoreIdFromUrl, WebStoreInstallPresentation, WebStoreInstallTheme } from '../shared/browser-web-store'

/** Serialized into an isolated world. The website receives no Node, preload, or IPC bridge. */
export function renderWebStoreInstall(presentation: WebStoreInstallPresentation | null, listingId: typeof chromeWebStoreIdFromUrl, theme: WebStoreInstallTheme): void {
    type State = { update(value: WebStoreInstallPresentation, theme: WebStoreInstallTheme): void; dispose(): void }
    const scope = globalThis as typeof globalThis & { __zyraWebStoreInstall?: State }
    if (!presentation || listingId(location.href) !== presentation.id) {
        scope.__zyraWebStoreInstall?.dispose()
        return
    }
    if (scope.__zyraWebStoreInstall) { scope.__zyraWebStoreInstall.update(presentation, theme); return }
    let value = presentation
    const host = document.createElement('span')
    host.dataset.zyraWebStoreInstall = ''
    host.style.cssText = 'display:inline-flex;vertical-align:middle;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
        :host{all:initial}
        button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 24px;border:0;border-radius:20px;background:var(--gm3-sys-color-primary,#0b57d0);color:var(--gm3-sys-color-on-primary,#fff);font:500 14px/20px var(--zyra-font);cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,opacity 120ms ease}
        button:hover:enabled{background:color-mix(in srgb,var(--gm3-sys-color-on-primary,#fff) 8%,var(--gm3-sys-color-primary,#0b57d0))}
        button:active:enabled{background:color-mix(in srgb,var(--gm3-sys-color-on-primary,#fff) 12%,var(--gm3-sys-color-primary,#0b57d0))}
        button:focus-visible{outline:2px solid var(--gm3-sys-color-primary,#0b57d0);outline-offset:3px}
        button:disabled{cursor:default;opacity:.65}
        @media(prefers-reduced-motion:reduce){button{transition:none}}
    `
    const button = document.createElement('button')
    button.type = 'button'
    const label = document.createElement('span')
    label.setAttribute('aria-live', 'polite')
    button.append(label); shadow.append(style, button)
    const hidden = new Map<HTMLElement, { display: string; priority: string }>()
    const hide = (element: HTMLElement) => {
        if (!hidden.has(element)) hidden.set(element, { display: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') })
        element.style.setProperty('display', 'none', 'important')
    }
    const restoreHidden = () => {
        for (const [element, previous] of hidden) {
            if (previous.display) element.style.setProperty('display', previous.display, previous.priority)
            else element.style.removeProperty('display')
        }
        hidden.clear()
    }
    let scheduled = 0
    const position = () => {
        cancelAnimationFrame(scheduled)
        scheduled = 0
        if (listingId(location.href) !== value.id) { state.dispose(); return }
        const nativeButton = Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"]'))
            .find(element => /^(Add to Chrome|Add to Desktop|Remove from Chrome)$/i.test(element.textContent?.trim() || ''))
        const heading = document.querySelector<HTMLElement>('h1, [role="heading"][aria-level="1"]')
        observer.disconnect()
        restoreHidden()
        for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"][aria-labelledby="promo-header"]')) {
            if (dialog.querySelector('a[href^="https://www.google.com/chrome/"]')) hide(dialog)
        }
        // Hide only the Chrome install prompt, never a listing, review or navigation area.
        for (const action of document.querySelectorAll<HTMLElement>('button, a')) {
            if (!/^(Install Chrome|Open Chrome|Download Chrome)$/i.test(action.textContent?.trim() || '')) continue
            let banner = action.parentElement
            for (let depth = 0; banner && depth < 5 && !banner.matches('body, main, header, nav') && !banner.querySelector('h1, [role="heading"][aria-level="1"]'); depth++, banner = banner.parentElement) {
                if (/switch to chrome to install extensions and themes/i.test(banner.textContent || '')) { hide(banner); break }
            }
        }
        if (nativeButton?.parentElement) {
            host.style.cssText = 'display:inline-flex;vertical-align:middle;'
            button.style.setProperty('--zyra-font', getComputedStyle(nativeButton).fontFamily)
            hide(nativeButton)
            if (nativeButton.nextElementSibling !== host) nativeButton.after(host)
        } else if (heading?.parentElement) {
            // Store labels are localized and its Chrome-only action can be absent.
            host.style.cssText = 'display:flex;width:max-content;margin:12px 0;'
            if (heading.nextElementSibling !== host) heading.after(host)
        } else {
            host.remove()
        }
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    }
    const observer = new MutationObserver(() => { if (!scheduled) scheduled = requestAnimationFrame(position) })
    const events = new AbortController()
    const state: State = {
        update(next, colors) {
            value = next
            button.style.setProperty('--zyra-font', colors.fontFamily)
            button.style.colorScheme = colors.colorScheme
            const labels = { ready: 'Add to Zyra', downloading: 'Downloading…', reviewing: 'Review permissions…', installed: 'Added to Zyra', error: 'Try again' }
            label.textContent = labels[next.state]
            button.disabled = !['ready', 'error'].includes(next.state)
            button.setAttribute('aria-busy', String(['downloading', 'reviewing'].includes(next.state)))
            button.title = next.state === 'installed' ? 'Installed. Reload open websites to use this extension.' : 'Install this extension in Zyra Browser'
            position()
        },
        dispose() {
            observer.disconnect(); cancelAnimationFrame(scheduled); events.abort(); host.remove(); restoreHidden()
            if (scope.__zyraWebStoreInstall === state) delete scope.__zyraWebStoreInstall
        }
    }
    button.addEventListener('click', event => {
        if (!event.isTrusted || button.disabled || listingId(location.href) !== value.id) return
        button.disabled = true
        label.textContent = 'Downloading…'
        location.href = value.requestUrl
    }, { signal: events.signal })
    window.addEventListener('pagehide', state.dispose, { signal: events.signal })
    scope.__zyraWebStoreInstall = state
    state.update(presentation, theme)
}
