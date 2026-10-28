import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import { ArrowUpRight, LoaderCircle, PanelTopClose, PanelTopOpen } from 'lucide-react'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { pluginAppViewIdentity, type PluginAppViewDescriptor } from './plugin-app-view-state'

type LoadedView = { html: string; csp: { connectDomains: string[]; resourceDomains: string[] } }

/** Shared with the isolated permission review; decisions still belong to the view bridge. */
export function PluginAppActionApproval({ server, tool, args, onChoose }: { server: string; tool: string; args: Record<string, unknown>; onChoose: (approved: boolean) => void }) {
    return <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] p-3">
        <div className="max-w-md rounded-md border border-[var(--surface-divider)] bg-[var(--color-card)] p-3 text-xs shadow-lg" role="dialog" aria-modal="true" aria-label="Approve app view action">
            <p className="font-medium">Allow {server} to run {tool}?</p>
            <p className="mt-1 text-sparkle-text-muted">This action comes from the Plugin view.</p>
            <pre className="mt-2 max-h-24 overflow-auto break-all text-[10px] text-sparkle-text-secondary">{JSON.stringify(args).slice(0, 800)}</pre>
            <div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md border border-[var(--surface-divider)] px-3 py-1.5" onClick={() => onChoose(false)}>Cancel</button><button type="button" className="inline-flex items-center gap-1 rounded-md bg-[var(--color-text)] px-3 py-1.5 text-[var(--color-bg)]" onClick={() => onChoose(true)}><ArrowUpRight size={13} />Allow once</button></div>
        </div>
    </div>
}

export function PluginAppView({ view }: { view: PluginAppViewDescriptor }) {
    const [open, setOpen] = useState(view.displayMode === 'automatic')
    const [loaded, setLoaded] = useState<LoadedView | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [height, setHeight] = useState(320)
    const [approval, setApproval] = useState<{ tool: string; args: Record<string, unknown> } | null>(null)
    const approvalResolver = useRef<((approved: boolean) => void) | null>(null)
    const frameRef = useRef<HTMLIFrameElement | null>(null)
    const bridgeRef = useRef<AppBridge | null>(null)
    const bridgeEpoch = useRef(0)
    const viewIdentity = pluginAppViewIdentity(view)
    const identityRef = useRef(viewIdentity)
    identityRef.current = viewIdentity
    const sandboxUrl = window.location.protocol === 'file:'
        ? new URL('./mcp-app-sandbox.html', window.location.href).href
        : new URL('/mcp-app-sandbox.html', window.location.origin).href

    const stopBridge = useCallback(() => {
        bridgeEpoch.current += 1
        approvalResolver.current?.(false)
        approvalResolver.current = null
        setApproval(null)
        const bridge = bridgeRef.current
        bridgeRef.current = null
        if (bridge) void bridge.teardownResource({}).catch(() => undefined).finally(() => { void bridge.close() })
    }, [])

    useEffect(() => () => {
        bridgeEpoch.current += 1
        approvalResolver.current?.(false)
        const bridge = bridgeRef.current
        bridgeRef.current = null
        if (bridge) void bridge.close()
    }, [])

    useEffect(() => {
        if (!open || loaded || !isElectronRendererRuntime()) return
        let cancelled = false
        setLoading(true)
        setError(null)
        void window.devscope.assistant.readPluginAppView({
            threadId: view.threadId, pluginId: view.pluginId, server: view.server, tool: view.tool, uri: view.uri
        }).then((response) => {
            if (cancelled) return
            if (!response.success) throw new Error(response.error || 'Could not load this app view.')
            setLoaded(response.view)
        }).catch((cause) => {
            if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this app view.')
        }).finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [loaded, open, view.pluginId, view.server, view.threadId, view.tool, view.uri])

    const startBridge = useCallback(async () => {
        const frame = frameRef.current
        if (!frame?.contentWindow || !loaded || bridgeRef.current) return
        const epoch = ++bridgeEpoch.current
        try {
            const { AppBridge: AppBridgeConstructor, PostMessageTransport } = await import('@modelcontextprotocol/ext-apps/app-bridge')
            if (epoch !== bridgeEpoch.current || identityRef.current !== viewIdentity || frameRef.current !== frame || !frame.contentWindow || bridgeRef.current) return
            const bridge = new AppBridgeConstructor(null, { name: 'Zyra', version: '0.6.2' }, {
                serverTools: {}, serverResources: {}
            }, { hostContext: {
                platform: 'desktop',
                theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
                displayMode: 'inline',
                containerDimensions: { maxHeight: 640 }
            } })
            bridgeRef.current = bridge
            bridge.oninitialized = () => {
                if (epoch !== bridgeEpoch.current || bridgeRef.current !== bridge) return
                bridge.sendToolInput({ arguments: view.arguments })
                bridge.sendToolResult(view.result as Parameters<AppBridge['sendToolResult']>[0])
            }
            bridge.onreadresource = async ({ uri }) => {
                if (uri !== view.uri) throw new Error('This app view cannot read another resource.')
                return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: loaded.html }] }
            }
            bridge.oncalltool = async ({ name, arguments: args }) => {
                if (approvalResolver.current) throw new Error('Finish the pending app view action first.')
                const toolArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
                const approved = await new Promise<boolean>((resolve) => {
                    approvalResolver.current = resolve
                    setApproval({ tool: name, args: toolArgs })
                })
                approvalResolver.current = null
                if (!approved) throw new Error('App view action was cancelled.')
                const response = await window.devscope.assistant.callPluginAppViewTool({
                    threadId: view.threadId, pluginId: view.pluginId, server: view.server, tool: name, arguments: toolArgs
                })
                if (!response.success) throw new Error(response.error || 'App view action failed.')
                return response.result as Awaited<ReturnType<NonNullable<AppBridge['oncalltool']>>>
            }
            bridge.onsizechange = ({ height: requestedHeight }) => {
                if (typeof requestedHeight === 'number' && Number.isFinite(requestedHeight)) setHeight(Math.max(180, Math.min(640, Math.round(requestedHeight))))
            }
            await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow))
            if (epoch !== bridgeEpoch.current || bridgeRef.current !== bridge) return
            await bridge.sendSandboxResourceReady({ html: loaded.html, csp: loaded.csp, sandbox: 'allow-scripts' })
        } catch (cause) {
            if (epoch !== bridgeEpoch.current) return
            setError(cause instanceof Error ? cause.message : 'Could not open this app view.')
            stopBridge()
        }
    }, [loaded, stopBridge, view, viewIdentity])

    const chooseApproval = (approved: boolean) => {
        const resolve = approvalResolver.current
        approvalResolver.current = null
        setApproval(null)
        resolve?.(approved)
    }

    if (!isElectronRendererRuntime()) return null
    return <div className="mt-2 overflow-hidden rounded-lg border border-[var(--surface-divider)] bg-[var(--color-card)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--surface-divider)] px-3 py-2">
            <span className="text-[11px] font-medium text-sparkle-text-secondary">App view · {view.server}</span>
            <button type="button" className="inline-flex items-center gap-1 text-[11px] text-sparkle-text-secondary hover:text-[var(--color-text)]" onClick={() => {
                if (open) { stopBridge(); setLoaded(null) }
                setOpen(!open)
            }} aria-expanded={open}>{open ? <><PanelTopClose size={14} />Close</> : <><PanelTopOpen size={14} />Open</>}</button>
        </div>
        {open ? <div className="relative">
            {loading ? <p className="flex items-center gap-2 px-3 py-4 text-xs text-sparkle-text-muted" role="status"><LoaderCircle size={14} className="animate-spin" />Loading app view…</p> : null}
            {error ? <p className="px-3 py-4 text-xs text-[var(--status-danger)]" role="alert">{error}</p> : null}
            {loaded && !error ? <iframe ref={frameRef} title={`App view from ${view.server}`} src={sandboxUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={() => { void startBridge() }} className="block w-full border-0 bg-transparent" style={{ height }} /> : null}
            {approval ? <PluginAppActionApproval server={view.server} tool={approval.tool} args={approval.args} onChoose={chooseApproval} /> : null}
        </div> : null}
    </div>
}
