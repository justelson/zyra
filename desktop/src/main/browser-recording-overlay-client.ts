import type { BrowserRecordingOverlayApi, BrowserRecordingOverlayCommand, BrowserRecordingOverlayState } from '../shared/contracts/browser-recording-overlay'

/** Serialized into the dedicated trusted overlay. Keep this function self-contained. */
export function mountBrowserRecordingOverlay(): void {
    const api = (window as unknown as { zyraRecordingOverlay: BrowserRecordingOverlayApi }).zyraRecordingOverlay
    const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
    const root = get('recorder')
    const toolbar = get('toolbar')
    const menu = get('menu')
    const choices = get('choices')
    const message = get('message')
    const pause = get<HTMLButtonElement>('pause')
    const microphone = get<HTMLButtonElement>('microphone')
    const audio = get<HTMLButtonElement>('audio')
    let state: BrowserRecordingOverlayState | null = null
    let opened: 'microphone' | 'audio' | null = null
    let menuSignature = ''
    let menuAnimation: Animation | null = null
    let stateEvents = 0
    let frame = 0
    let settleTimer = 0
    let currentSize: { width: number; height: number } | null = null
    let targetSize: { width: number; height: number } | null = null
    let nativeSize: { width: number; height: number } | null = null
    let reportedSize = ''
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const paintSize = (size: { width: number; height: number }) => {
        currentSize = size
        root.style.width = `${size.width}px`
        root.style.height = `${size.height}px`
    }
    const allocate = (size: { width: number; height: number }) => {
        nativeSize = size
        const outer = { width: Math.ceil(size.width + 16), height: Math.min(340, Math.ceil(size.height + 16)) }
        const signature = `${outer.width}:${outer.height}`
        if (signature !== reportedSize) { reportedSize = signature; api.resize(outer) }
    }
    const resize = () => {
        const previous = currentSize
        const wasMenuVisible = !menu.hidden
        // Measure intrinsic content independently of the old native viewport size.
        root.style.maxWidth = 'none'
        root.style.height = 'auto'
        menu.hidden = !opened
        menu.style.width = 'max-content'
        menu.style.maxWidth = '344px'
        const menuWidth = opened ? Math.max(286, menu.offsetWidth) : 0
        const recoveryWidth = !message.hidden || !get('saved-actions').hidden ? 270 : 0
        toolbar.style.width = 'max-content'
        const toolbarWidth = toolbar.scrollWidth
        toolbar.style.width = ''
        const width = Math.min(424, Math.ceil(Math.max(toolbarWidth + 2, menuWidth + 2, recoveryWidth)))
        root.style.width = `${width}px`
        menu.style.width = ''
        menu.style.maxWidth = ''
        const next = { width, height: Math.min(324, root.offsetHeight) }
        root.style.maxWidth = ''
        menu.hidden = !opened && !wasMenuVisible
        menu.inert = !opened
        if (previous) { root.style.width = `${previous.width}px`; root.style.height = `${previous.height}px` }
        if (targetSize?.width === next.width && targetSize.height === next.height) return
        targetSize = next
        cancelAnimationFrame(frame)
        window.clearTimeout(settleTimer)
        // Reserve the transition's envelope once. Only the card animates; resizing
        // the native compositor surface on every frame causes visible repainting.
        allocate({ width: Math.max(nativeSize?.width || 0, next.width), height: Math.max(nativeSize?.height || 0, next.height) })
        const finish = () => {
            cancelAnimationFrame(frame)
            window.clearTimeout(settleTimer)
            frame = 0
            paintSize(next)
            allocate(next)
            root.dataset.resizing = 'false'
            menu.hidden = !opened
        }
        if (!previous || reduced()) { finish(); return }
        root.dataset.resizing = 'true'
        const started = performance.now()
        const step = (now: number) => {
            const progress = Math.max(0, Math.min(1, (now - started) / 210))
            const eased = 1 - Math.pow(1 - progress, 3)
            paintSize({ width: previous.width + (next.width - previous.width) * eased, height: previous.height + (next.height - previous.height) * eased })
            if (progress < 1) frame = requestAnimationFrame(step)
            else finish()
        }
        frame = requestAnimationFrame(step)
        // A blurred or occluded native view may suspend its animation clock.
        settleTimer = window.setTimeout(finish, 280)
    }
    const send = (command: BrowserRecordingOverlayCommand) => api.command(command)
    const closeMenu = (restoreFocus = true) => {
        const trigger = opened === 'microphone' ? microphone : audio
        opened = null
        menuAnimation?.cancel()
        root.dataset.expanded = 'false'
        microphone.setAttribute('aria-expanded', 'false')
        audio.setAttribute('aria-expanded', 'false')
        resize()
        if (restoreFocus) trigger.focus({ preventScroll: true })
    }
    const renderMenu = () => {
        if (!state || !opened) return
        const isMicrophone = opened === 'microphone'
        const pending = isMicrophone ? state.microphonePending : state.audioPending
        const entries = isMicrophone
            ? [{ id: 'off', label: 'Microphone off', supported: true }, { id: '', label: 'Default microphone', supported: true }, ...state.microphones.filter(device => device.id && device.id !== 'default').map(device => ({ ...device, supported: true }))]
            : [{ id: 'off', label: 'Audio off', supported: true }, { id: 'tab', label: 'Tab audio', supported: state.tabAudioSupported }, { id: 'system', label: 'System audio', supported: state.systemAudioSupported }]
        const signature = JSON.stringify([opened, entries])
        if (signature !== menuSignature) {
            menuSignature = signature
            const fragment = document.createDocumentFragment()
            for (const entry of entries) {
                const button = document.createElement('button')
                button.type = 'button'
                button.dataset.value = entry.id
                button.dataset.supported = String(entry.supported)
                button.setAttribute('role', 'menuitemradio')
                const mark = document.createElement('span'); mark.className = 'choice-mark'; mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true')
                const label = document.createElement('span'); label.className = 'choice-label'; label.textContent = entry.label
                button.append(mark, label)
                if (!entry.supported) { const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'Unavailable'; button.append(hint) }
                fragment.append(button)
            }
            choices.replaceChildren(fragment)
        }
        for (const button of choices.querySelectorAll<HTMLButtonElement>('button')) {
            button.disabled = pending || button.dataset.supported !== 'true'
            button.setAttribute('aria-checked', String(button.dataset.value === (isMicrophone ? state.microphone : state.audioSource)))
        }
        get('menu-title').textContent = isMicrophone ? 'Microphone' : 'Recording audio'
        get('refresh').hidden = !isMicrophone
    }
    const openMenu = (kind: 'microphone' | 'audio') => {
        if (opened === kind) { closeMenu(); return }
        opened = kind
        renderMenu()
        root.dataset.expanded = 'true'
        microphone.setAttribute('aria-expanded', String(kind === 'microphone'))
        audio.setAttribute('aria-expanded', String(kind === 'audio'))
        resize()
        menuAnimation?.cancel()
        if (!reduced()) menuAnimation = menu.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' })
        choices.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')?.focus({ preventScroll: true })
        if (kind === 'microphone') send({ kind: 'refresh-devices' })
    }
    microphone.addEventListener('click', () => openMenu('microphone'))
    audio.addEventListener('click', () => openMenu('audio'))
    window.addEventListener('blur', () => { if (opened) closeMenu(false) })
    pause.addEventListener('click', () => { if (state) send({ kind: state.status === 'paused' ? 'resume' : 'pause' }) })
    document.addEventListener('click', event => {
        const button = (event.target as Element).closest<HTMLButtonElement>('button')
        if (!button || button.disabled) return
        if (button.parentElement === choices && opened) {
            if (opened === 'microphone') send({ kind: 'microphone', deviceId: button.dataset.value || '' })
            else send({ kind: 'audio', source: button.dataset.value as 'off' | 'tab' | 'system' })
            closeMenu()
        } else if (button.dataset.command) {
            if (button.dataset.command === 'start' && opened) closeMenu(false)
            send({ kind: button.dataset.command } as BrowserRecordingOverlayCommand)
        }
    })
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && opened) { event.preventDefault(); closeMenu(); return }
        if (event.key === 'Escape' && state?.status === 'ready') { event.preventDefault(); send({ kind: 'dismiss' }); return }
        if (!opened || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = [...choices.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus({ preventScroll: true })
    })
    const render = (next: BrowserRecordingOverlayState) => {
        state = next
        root.dataset.status = next.status
        root.title = next.title
        for (const key of ['background', 'foreground', 'muted', 'accent', 'border'] as const) document.documentElement.style.setProperty(`--${key}`, next.theme[key])
        document.documentElement.style.colorScheme = next.theme.dark ? 'dark' : 'light'
        document.documentElement.style.fontFamily = next.theme.fontFamily || 'system-ui, sans-serif'
        const font = get('appearance-font')
        if (next.theme.fontCss !== undefined && font.textContent !== next.theme.fontCss) font.textContent = next.theme.fontCss || ''
        get('saved-label').hidden = next.status !== 'saved'
        const seconds = Math.max(0, Math.floor(next.elapsedMs / 1000))
        get('duration').textContent = seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
        const ready = next.status === 'ready'
        const active = next.status === 'recording' || next.status === 'paused'
        const terminal = next.status === 'saved' || next.status === 'error'
        get('clock').hidden = ready
        get('start').hidden = !ready
        get<HTMLButtonElement>('start').disabled = !ready
        pause.hidden = terminal || ready
        pause.disabled = !active
        pause.dataset.action = next.status === 'paused' ? 'resume' : 'pause'
        pause.title = next.status === 'paused' ? 'Resume recording' : 'Pause recording'
        pause.setAttribute('aria-label', pause.title)
        get<HTMLButtonElement>('stop').disabled = !active
        get('stop').hidden = terminal || ready
        get('controls-divider').hidden = terminal
        microphone.hidden = terminal; audio.hidden = terminal
        microphone.disabled = !(active || ready) || next.microphonePending
        audio.disabled = !(active || ready) || next.audioPending
        microphone.dataset.selected = String(next.microphone !== 'off')
        microphone.title = next.microphonePending ? 'Connecting microphone…' : next.microphone === 'off' ? 'Microphone off' : ready ? 'Microphone selected' : 'Microphone on'
        microphone.setAttribute('aria-label', microphone.title)
        audio.dataset.selected = String(next.audioSource !== 'off')
        audio.title = next.audioPending ? 'Changing recording audio…' : next.audioSource === 'off' ? 'Recording audio off' : next.audioSource === 'tab' ? (ready ? 'Tab audio selected' : 'Recording tab audio') : (ready ? 'System audio selected' : 'Recording system audio')
        audio.setAttribute('aria-label', audio.title)
        get('dismiss').hidden = (!terminal && !ready) || next.unsaved
        get('saved-actions').hidden = !terminal || (!next.hasArtifact && !next.unsaved)
        get('attach-chat').hidden = !next.hasArtifact || !next.canAttachToChat
        get('view').hidden = !next.hasArtifact
        get('save-copy').hidden = !next.unsaved
        const text = next.error || (next.status === 'starting' ? 'Starting recording…' : next.status === 'stopping' ? 'Saving recording…' : next.status === 'paused' ? 'Recording paused' : '')
        message.hidden = !text
        message.dataset.error = String(Boolean(next.error))
        if (message.textContent !== text) message.textContent = text
        if (terminal && opened) closeMenu(false)
        else renderMenu()
        resize()
    }
    document.fonts.addEventListener('loadingdone', resize)
    api.onState(next => { stateEvents++; render(next) })
    void api.getState().then(next => { if (next && stateEvents === 0) render(next) }).catch(() => {
        if (stateEvents) return
        message.hidden = false; message.textContent = 'Recording controls unavailable.'; resize()
    })
}
