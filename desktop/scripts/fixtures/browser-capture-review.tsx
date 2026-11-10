import { resolveThemeTokens } from '../../src/renderer/src/lib/settings-theme-semantics'
import { getThemeDefinition } from '../../src/renderer/src/lib/settings-theme-catalog'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import BrowserCapturesSettings from '../../src/renderer/src/pages/settings/BrowserCapturesSettings'
import BrowserControlSettings from '../../src/renderer/src/pages/settings/BrowserControlSettings'
import { AssistantBrowserWorkspace } from '../../src/renderer/src/pages/assistant/AssistantBrowserWorkspace'
import { AssistantInspectorDeveloperToast, useAssistantInspectorDeveloperToast } from '../../src/renderer/src/pages/assistant/AssistantInspectorDeveloperToast'
import { BrowserCaptureDraftHost } from '../../src/renderer/src/pages/assistant/BrowserCaptureDraftHost'
import { subscribeAssistantBrowserAnnotationAttachments } from '../../src/renderer/src/pages/assistant/assistant-browser-annotation-composer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 70)) })
const root = createRoot(document.getElementById('root')!)
const calls: Array<[string, any]> = []
const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200
const context = canvas.getContext('2d')!; context.fillStyle = '#1b3341'; context.fillRect(0, 0, 400, 200); context.fillStyle = '#b7d6b0'; context.fillRect(32, 32, 130, 136); context.fillStyle = '#c2d8e2'; context.font = '18px sans-serif'; context.fillText('Browser capture', 184, 90)
const screenshot = { artifactId: 'browser-screenshot:fixture', tabId: 'browser:1', kind: 'screenshot', mimeType: 'image/png', sizeBytes: 143821, createdAt: '2026-11-09T09:04:00Z', width: 400, height: 200, thumbnailDataUrl: canvas.toDataURL() }
const recording = { ...screenshot, artifactId: 'browser-recording:fixture', kind: 'recording', mimeType: 'video/webm', sizeBytes: 3894521, thumbnailDataUrl: undefined, createdAt: '2026-11-09T08:45:00Z' }
let captures = [screenshot, recording, { ...screenshot, artifactId: 'browser-screenshot:fixture2', createdAt: '2026-11-08T16:26:00Z' }]
let failure = false, pendingDraft: any = null, created = 0
const annotation = { id: 'annotation:fixture', tabId: 'browser:1', url: 'https://example.test/', title: 'Example', comment: 'Explain this selected component', elements: [], regions: [], strokes: [], styleChanges: [], createdAt: screenshot.createdAt }
const api: any = {
    prepareNativeOverlay: undefined, setNativeOverlayVisible: undefined,
    window: { getRuntimeInfo: async () => ({ platform: 'win32' }), onFullScreenChange: () => () => {} },
    getBrowserPreviewConfig: async () => ({ success: true, partition: 'fixture', webPreferences: '', profileScope: 'app', persistent: true, protectedMedia: { ready: true } }),
    getBrowserHistory: async () => ({ success: true, entries: [] }), getBrowserBookmarks: async () => ({ success: true, entries: [], bookmarks: [] }),
    listBrowserCaptures: async (input: any) => { if (failure) return { success: false, error: 'Could not read saved captures.' }; const list = captures.filter(c => !input.kind || c.kind === input.kind); return { success: true, captures: list.slice(input.offset, input.offset + input.limit), total: list.length } },
    deleteBrowserCapture: async (id: string) => { calls.push(['delete', id]); captures = captures.filter(c => c.artifactId !== id); return { success: true } },
    copyBrowserPreviewArtifact: async (input: any) => { calls.push(['copy', input]); return { success: true } },
    openBrowserPreviewArtifact: async (id: string) => { calls.push(['open', id]); return { success: true } },
    revealBrowserPreviewArtifact: async (id: string) => { calls.push(['reveal', id]); return { success: true } },
    attachBrowserCaptureToChat: async (input: any) => { calls.push(['attach', input]); return { success: true } },
    captureBrowserPreviewScreenshot: async () => ({ success: true, artifact: screenshot }),
    startBrowserPreviewAnnotation: async (input: any) => { calls.push(['annotate', input]); return { success: true, artifact: screenshot, annotation } },
    openBrowserPreviewExternal: async (url: string) => { calls.push(['external', url]); return { success: true } },
    readBrowserCaptureDraft: async () => ({ success: true, draft: pendingDraft }),
    acknowledgeBrowserCaptureDraft: async (id: string) => { if (pendingDraft?.id === id) pendingDraft = null; return { success: true } }
}
const namespace = new Proxy({}, { get: (_, key) => String(key).startsWith('on') ? () => () => {} : async () => ({ success: false }) })
;(window as any).devscope = new Proxy(api, { get: (target, key) => key in target ? target[key] : ['agentControl', 'browserView', 'browserPopup'].includes(String(key)) ? namespace : String(key).startsWith('on') ? () => () => {} : async () => ({ success: false }) })
;(window as any).fixtureActions = { createSessionResult: async () => { created++; return { success: true, sessionId: 'session:new', snapshot: { sessions: [{ id: 'session:new' }] } } } }
function BrowserFixture({ integrated = false }: { integrated?: boolean }) {
    const { developerToast, showDeveloperToast, dismissDeveloperToast } = useAssistantInspectorDeveloperToast()
    const [request, setRequest] = useState<any>({ id: 1, tabId: 'browser:1', url: 'https://example.test/', sessionMode: 'normal' })
    return <div className="flex h-[560px] flex-col overflow-hidden rounded-xl border border-[var(--surface-divider)]"><AssistantBrowserWorkspace workspaceKey="session:original" captureSessionId="session:original" threadId="thread:fixture" projectPath="C:/fixture" active selectedTabId={null} controlState={null} navigationRequest={request} onNavigationRequestHandled={() => setRequest(null)} onWorkspaceStateChange={() => {}} onLocalControlTargetChange={() => {}} surfaceRequest={null} onSurfaceRequestHandled={() => {}} onTabsChange={() => {}} onControllerChange={() => {}} onRequestTabSelection={() => {}} onDeveloperToast={showDeveloperToast} onOpenPreview={async () => {}} chatIntegration={integrated} persistState={false} /><AssistantInspectorDeveloperToast toast={developerToast} onDismiss={dismissDeveloperToast} /></div>
}
function Location() { return <output id="location">{useLocation().pathname}</output> }
const mount = async (node: React.ReactNode) => { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); await flush() }
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) || document.querySelector<HTMLButtonElement>(`button[title="${label}"]`)
const click = async (node: HTMLElement | null) => { check(node, 'click target exists; recent actions=' + JSON.stringify(calls.slice(-3)) + '; buttons=' + [...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent).join('|')); await act(async () => node!.click()); await flush() }
const chooseFilter = async (label: string) => { await click(button('Capture type')); await click([...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(node => node.textContent?.includes(label)) || null) }
const textButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label) || null

;(window as any).captureReview = {
    preview: async (view: string) => {
        const tokens = resolveThemeTokens(getThemeDefinition(view === 'light' ? 'paper-light' : 'vercel').tokens)
        for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty('--color-' + key.replace(/[A-Z]/g, c=>'-'+c.toLowerCase()), value)
        document.documentElement.style.colorScheme = view === 'light' ? 'light' : 'dark'
        document.body.classList.toggle('light', view === 'light')
        document.documentElement.classList.toggle('light', view === 'light')
        document.documentElement.classList.toggle('dark', view !== 'light')
        if (view === 'browser' || view === 'toast') { await mount(<BrowserFixture />); if (view === 'toast') await click(button('Capture screenshot')) }
        else if (view === 'preferences') await mount(<BrowserControlSettings />)
        else { await mount(<BrowserCapturesSettings />); if (view === 'delete') await click(button('Delete capture')) }
    },
    run: async () => {
        await mount(<BrowserCapturesSettings />)
        check(document.querySelectorAll('li').length === 3, 'actual library lists saved captures')
        await click(button('Copy image')); check(calls.at(-1)?.[1].mode === 'image', 'screenshot copies actual image')
        await click(button('Copy video path')); check(calls.at(-1)?.[1].mode === 'path', 'video path copy remains available')
        await click(button('Show in folder')); check(calls.at(-1)?.[0] === 'reveal', 'reveal wired')
        await click(button('Attach to new chat')); check(calls.at(-1)?.[1].sessionId === undefined, 'library attaches to new draft')
        await click(button('Delete capture')); check(!calls.some(c => c[0] === 'delete'), 'deletion requires confirmation')
        await click(textButton('Cancel')); check(!textButton('Delete'), 'cancel preserves capture')
        await click(button('Delete capture')); await click(textButton('Delete')); check(document.querySelectorAll('li').length === 2, 'confirmed deletion refreshes library')
        await chooseFilter('Recordings'); check(document.querySelectorAll('li').length === 1, 'type filter works')
        await chooseFilter('Screenshots'); check(document.querySelectorAll('li').length === 1, 'screenshot filter works')
        captures = Array.from({ length: 13 }, (_, i) => ({ ...recording, artifactId: 'video:' + i })); await chooseFilter('All'); check(document.querySelectorAll('li').length === 12, 'first page bounded')
        await click(textButton('Next')); check(document.querySelectorAll('li').length === 1, 'older captures reachable')
        captures = []; await click(button('Refresh captures')); check(document.body.textContent!.includes('appear here'), 'empty library explained')
        failure = true; await click(button('Refresh captures')); check(document.querySelector('[role=alert]'), 'transport error visible')
        failure = false; captures = [screenshot, recording]; await click(button('Refresh captures')); check(document.querySelectorAll('li').length === 2, 'retry recovers')
        await mount(<BrowserFixture />)
        check(button('Open in default browser'), 'address bar direct external action: ' + document.body.textContent?.slice(0,900))
        await click(button('Open in default browser')); check(calls.at(-1)?.[0] === 'external', 'external action wired')
        await click(button('Capture screenshot')); check(document.querySelector('img[alt="Browser screenshot preview"]'), 'actual screenshot toast previews')
        await click(textButton('Attach to chat')); check(calls.at(-1)?.[1].sessionId === null, 'standalone capture opens new draft')
        await click(button('Annotate page')); check(calls.find(c => c[0] === 'annotate')?.[1].standalone === true, 'standalone selection has contextual wording')
        check(calls.at(-1)?.[0] === 'attach' && calls.at(-1)?.[1].annotation.comment === annotation.comment, 'selection description forwarded intact')
        await mount(null); await mount(<BrowserFixture integrated />); await click(button('Capture screenshot')); await click(textButton('Attach to chat'))
        check(calls.at(-1)?.[1].sessionId === 'session:original', 'chat capture stays in original chat')
        ;(window as any).fixtureSettings.assistantBrowserStandaloneAiTools = false
        await mount(null); await mount(<BrowserFixture />); check(!button('Capture screenshot') && !button('Annotate page'), 'standalone AI tools toggle hides controls')
        ;(window as any).fixtureSettings.assistantBrowserStandaloneAiTools = true
        const received: any[] = []
        const unsubscribe = subscribeAssistantBrowserAnnotationAttachments('session:new', attachment => received.push(attachment))
        pendingDraft = { id: 'draft:1', sessionId: null, reference: 'clipboard://staged.png', artifact: screenshot, annotation }
        await mount(<><BrowserCaptureDraftHost /><Location /></>); window.dispatchEvent(new Event('zyra:browser-capture-draft')); window.dispatchEvent(new Event('zyra:browser-capture-draft')); await flush(); await flush()
        check(created === 1 && received.length === 1, 'one explicit capture creates exactly one draft, including overlapping events')
        check(received[0].text === annotation.comment && received[0].reference === 'clipboard://staged.png', 'editable text and staged file preserved')
        check(decodeURIComponent(document.getElementById('location')?.textContent || '').includes('session:new'), 'draft navigation wired')
        check(!pendingDraft, 'main handoff acknowledged after delivery'); unsubscribe()
        console.log('BROWSER_CAPTURE_REVIEW_PASS')
    }
}
console.log('BROWSER_CAPTURE_REVIEW_READY')
