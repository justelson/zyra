import { memo, useEffect, useRef } from 'react'
import type { DevScopePreviewTerminalSessionSummary } from '@shared/contracts/devscope-api'
import type { ITheme, Terminal as XtermTerminal } from 'xterm'
import type { FitAddon as XtermFitAddon } from 'xterm-addon-fit'
import { loadPreviewTerminalRuntime } from '@/components/ui/file-preview/previewTerminalRuntime'

function fitTerminalSafely(fitAddon: XtermFitAddon): boolean {
    try {
        fitAddon.fit()
        return true
    } catch {
        return false
    }
}

export const AssistantTerminalViewport = memo(function AssistantTerminalViewport({
    session,
    workspaceCapability,
    initialOutput,
    theme,
    fontFamily,
    fontSize,
    cursorBlink,
    scrollback,
    active,
    visible,
    focusRequestId,
    onActivate,
    onNewTerminal,
    onSplitHorizontal,
    onSplitVertical,
    onCloseTerminal,
    onError
}: {
    session: DevScopePreviewTerminalSessionSummary
    workspaceCapability?: string
    initialOutput: string
    theme: ITheme
    fontFamily: string
    fontSize: number
    cursorBlink: boolean
    scrollback: number
    active: boolean
    visible: boolean
    focusRequestId: number
    onActivate: () => void
    onNewTerminal: () => void
    onSplitHorizontal: () => void
    onSplitVertical: () => void
    onCloseTerminal: () => void
    onError: (message: string) => void
}) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<XtermTerminal | null>(null)
    const fitAddonRef = useRef<XtermFitAddon | null>(null)
    const initialOutputRef = useRef(initialOutput)
    const activeRef = useRef(active)
    const visibleRef = useRef(visible)
    const themeRef = useRef(theme)
    const actionRefs = useRef({ onNewTerminal, onSplitHorizontal, onSplitVertical, onCloseTerminal })
    activeRef.current = active
    visibleRef.current = visible
    themeRef.current = theme
    actionRefs.current = { onNewTerminal, onSplitHorizontal, onSplitVertical, onCloseTerminal }

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        let disposed = false
        let resizeObserver: ResizeObserver | null = null
        let mountedTerminal: XtermTerminal | null = null
        let inputDisposable: { dispose: () => void } | null = null
        let titleDisposable: { dispose: () => void } | null = null
        let syncFrame = 0
        // Output can arrive before the lazy xterm runtime resolves. Retain it in order.
        const pendingEvents: Parameters<Parameters<typeof window.devscope.onPreviewTerminalEvent>[0]>[0][] = []
        let pendingChars = 0
        const applyEvent = (terminal: XtermTerminal, event: typeof pendingEvents[number]) => {
            if (event.type === 'output') terminal.write(String(event.data || ''))
            else if (event.type === 'clear') terminal.clear()
            else if (event.type === 'error') terminal.write(`\r\n[terminal] ${event.message || 'Terminal error'}\r\n`)
            else if (event.type === 'exit') terminal.write(`\r\n[terminal] Process exited${typeof event.exitCode === 'number' ? ` (${event.exitCode})` : ''}.\r\n`)
        }

        const syncSize = () => {
            window.cancelAnimationFrame(syncFrame)
            syncFrame = window.requestAnimationFrame(() => {
                const terminal = terminalRef.current
                const fitAddon = fitAddonRef.current
                if (!terminal || !fitAddon || host.clientWidth <= 0 || host.clientHeight <= 0) return
                const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY
                if (!fitTerminalSafely(fitAddon)) return
                if (wasAtBottom) terminal.scrollToBottom()
                void window.devscope.resizePreviewTerminal({
                    sessionId: session.sessionId,
                    cols: terminal.cols,
                    rows: terminal.rows,
                    workspaceCapability
                }).catch(() => undefined)
            })
        }

        void loadPreviewTerminalRuntime().then((runtime) => {
            if (disposed || hostRef.current !== host) return
            const terminal = new runtime.Terminal({
                cursorBlink,
                convertEol: true,
                fontFamily,
                fontSize,
                lineHeight: 1.08,
                scrollback,
                allowProposedApi: true,
                theme: themeRef.current
            })
            const fitAddon = new runtime.FitAddon()
            terminal.loadAddon(fitAddon)
            terminal.loadAddon(new runtime.WebLinksAddon())
            terminal.open(host)
            mountedTerminal = terminal
            terminalRef.current = terminal
            fitAddonRef.current = fitAddon
            if (initialOutputRef.current) terminal.write(initialOutputRef.current)
            for (const event of pendingEvents.splice(0)) applyEvent(terminal, event)

            terminal.attachCustomKeyEventHandler((event) => {
                const primary = event.ctrlKey || event.metaKey
                if (primary && event.shiftKey && event.code === 'Backquote') {
                    event.preventDefault()
                    actionRefs.current.onNewTerminal()
                    return false
                }
                if (primary && event.shiftKey && event.code === 'Digit5') {
                    event.preventDefault()
                    actionRefs.current.onSplitHorizontal()
                    return false
                }
                if (primary && event.altKey && event.code === 'Digit5') {
                    event.preventDefault()
                    actionRefs.current.onSplitVertical()
                    return false
                }
                if (primary && event.shiftKey && event.code === 'KeyW') {
                    event.preventDefault()
                    actionRefs.current.onCloseTerminal()
                    return false
                }
                return true
            })

            inputDisposable = terminal.onData((data) => {
                void window.devscope.writePreviewTerminal({
                    sessionId: session.sessionId,
                    data,
                    workspaceCapability
                }).then((result) => {
                    if (!result.success) onError(result.error || 'Failed to write terminal input.')
                }).catch((error: unknown) => {
                    onError(error instanceof Error ? error.message : 'Failed to write terminal input.')
                })
            })
            titleDisposable = terminal.onTitleChange((title) => {
                const normalizedTitle = String(title || '').trim()
                if (!normalizedTitle) return
                void window.devscope.setPreviewTerminalTitle({
                    sessionId: session.sessionId,
                    title: normalizedTitle,
                    workspaceCapability
                }).catch(() => undefined)
            })

            resizeObserver = new ResizeObserver(syncSize)
            resizeObserver.observe(host)
            syncSize()
            if (activeRef.current && visibleRef.current) {
                window.requestAnimationFrame(() => terminal.focus())
            }
        }).catch((error: unknown) => {
            if (!disposed) onError(error instanceof Error ? error.message : 'Failed to load terminal runtime.')
        })

        const unsubscribe = window.devscope.onPreviewTerminalEvent((event) => {
            if (event.sessionId !== session.sessionId) return
            const terminal = terminalRef.current
            if (terminal) applyEvent(terminal, event)
            else {
                const queued = event.type === 'output' ? { ...event, data: String(event.data || '').slice(-60_000) } : event
                pendingEvents.push(queued)
                pendingChars += queued.type === 'output' ? String(queued.data || '').length : 0
                while (pendingEvents.length > 256 || pendingChars > 60_000) {
                    const removed = pendingEvents.shift()
                    if (removed?.type === 'output') pendingChars -= String(removed.data || '').length
                }
            }
        }, workspaceCapability)

        return () => {
            disposed = true
            unsubscribe()
            window.cancelAnimationFrame(syncFrame)
            resizeObserver?.disconnect()
            inputDisposable?.dispose()
            titleDisposable?.dispose()
            if (terminalRef.current === mountedTerminal) terminalRef.current = null
            fitAddonRef.current = null
            mountedTerminal?.dispose()
        }
    }, [onError, session.sessionId, workspaceCapability])

    useEffect(() => {
        const terminal = terminalRef.current
        const fitAddon = fitAddonRef.current
        if (!terminal || !fitAddon || !visible) return
        const frame = window.requestAnimationFrame(() => {
            fitTerminalSafely(fitAddon)
            if (active) terminal.focus()
            void window.devscope.resizePreviewTerminal({
                sessionId: session.sessionId,
                cols: terminal.cols,
                rows: terminal.rows,
                workspaceCapability
            }).catch(() => undefined)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [active, focusRequestId, session.sessionId, visible, workspaceCapability])

    useEffect(() => {
        const terminal = terminalRef.current
        if (!terminal) return
        terminal.options.theme = theme
        terminal.refresh(0, Math.max(0, terminal.rows - 1))
    }, [theme])

    useEffect(() => {
        const terminal = terminalRef.current
        if (!terminal) return
        terminal.options.cursorBlink = cursorBlink
        terminal.options.fontFamily = fontFamily
        terminal.options.fontSize = fontSize
        terminal.options.scrollback = scrollback
        const fitAddon = fitAddonRef.current
        if (fitAddon && visible) fitTerminalSafely(fitAddon)
    }, [cursorBlink, fontFamily, fontSize, scrollback, visible])

    return (
        <div
            ref={hostRef}
            className="h-full min-h-0 w-full overflow-hidden bg-[color-mix(in_srgb,var(--color-bg)_96%,black)]"
            onMouseDown={onActivate}
        />
    )
})
