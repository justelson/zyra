import { act } from 'react'
import { AssistantBrowserBackgroundPicker } from '../../src/renderer/src/pages/assistant/AssistantBrowserBackgroundPicker'
import { AssistantBrowserHistoryPanel } from '../../src/renderer/src/pages/assistant/AssistantBrowserHistoryPanel'
import { AssistantBrowserBookmarksPanel } from '../../src/renderer/src/pages/assistant/AssistantBrowserBookmarksPanel'
import { NativeOverlayPortal, NativeOverlayVisibilityScope } from '../../src/renderer/src/components/ui/native-overlay-portal'
import { useFilePreviewChrome } from '../../src/renderer/src/components/ui/file-preview/useFilePreviewChrome'
import { createRoot } from 'react-dom/client'
import { AssistantBrowserDownloadsButton, type BrowserDownloadsApi } from '../../src/renderer/src/pages/assistant/AssistantBrowserDownloadsButton'
import { AssistantBrowserDeviceToolbar } from '../../src/renderer/src/pages/assistant/AssistantBrowserDeviceToolbar'
import { AssistantDatePicker } from '../../src/renderer/src/pages/assistant/AssistantDatePicker'
import { FileActionsMenu } from '../../src/renderer/src/components/ui/FileActionsMenu'
import { AssistantInspectorDeveloperToast, useAssistantInspectorDeveloperToast } from '../../src/renderer/src/pages/assistant/AssistantInspectorDeveloperToast'
import { useEffect } from 'react'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const delay = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
async function settle(predicate: () => boolean, message: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
        await act(async () => { await delay() })
        if (predicate()) return
    }
    throw new Error(message)
}
const iframe = document.createElement('iframe')
iframe.style.cssText = 'position:absolute;left:0;top:0;width:840px;height:640px;border:0'
document.body.append(iframe)
const child = iframe.contentWindow!
const childDocument = iframe.contentDocument!
const passiveIframe = iframe.cloneNode() as HTMLIFrameElement
document.body.append(passiveIframe)
const passiveChild = passiveIframe.contentWindow!
const passiveDocument = passiveIframe.contentDocument!
let prepared!: () => void
const preparation = new Promise<void>(resolve => { prepared = resolve })
const visibility: boolean[] = []
let nativeBounds: { x: number; y: number; width: number; height: number } | null = null
const focusRequests: Array<boolean | undefined> = []
Object.assign(window, { devscope: {
    prepareNativeOverlay: async ({ kind }: { kind: string }) => { await preparation; return { success: true, frameName: `synthetic-native-${kind}` } },
    setNativeOverlayVisible: async ({ visible, focus, bounds }: { visible: boolean; focus?: boolean; bounds?: typeof nativeBounds }) => { nativeBounds = bounds ?? null; visibility.push(visible); if (visible) focusRequests.push(focus); return { success: true, bounds: nativeBounds } },
    onNativeOverlayDismiss: () => () => {}
} })
// The real native host/portal is exercised across documents; window ownership and IPC
// are covered by test-native-overlay, so this fixture controls only window.open.
window.open = (_url, frameName) => frameName?.includes('passive') ? passiveChild : child
const host = document.createElement('div')
host.style.cssText = 'position:relative;width:840px;height:640px'
document.body.append(host)
const ownerInput = document.createElement('input')
ownerInput.setAttribute('aria-label', 'Owner address input')
document.body.append(ownerInput)
const root = createRoot(host)
const results: string[] = []
async function checkWorkspaceOverlayVisibility() {
    const scoped = (visible: boolean) => <NativeOverlayVisibilityScope visible={visible}>
        <NativeOverlayPortal><div data-scoped-browser-overlay>Browser menu</div></NativeOverlayPortal>
        <NativeOverlayPortal passive><div data-scoped-browser-progress>Loading</div></NativeOverlayPortal>
    </NativeOverlayVisibilityScope>
    await act(async () => root.render(scoped(true)))
    await settle(() => Boolean(childDocument.querySelector('[data-scoped-browser-overlay]')) && Boolean(passiveDocument.querySelector('[data-scoped-browser-progress]')), 'visible browser owns native interactive and passive overlays')
    await act(async () => root.render(scoped(false)))
    await settle(() => !childDocument.querySelector('[data-scoped-browser-overlay]') && !passiveDocument.querySelector('[data-scoped-browser-progress]'), 'hidden browser removes both native overlays across documents')
    await settle(() => visibility.at(-1) === false, 'hidden browser releases native input interception')
    await act(async () => root.render(scoped(true)))
    await settle(() => Boolean(passiveDocument.querySelector('[data-scoped-browser-progress]')), 'returning to the browser restores its overlays')
    results.push('hidden browser visibility scope removes passive and interactive native overlays and releases input')
}
const click = async (element: Element | null) => {
    check(element, 'expected an interactive control')
    const target = element!
    const owner = target.ownerDocument.defaultView!
    // Keep pointerdown and activation in separate React turns, as a native cross-document
    // click does. Collapsing them hid portal listener cleanup between an Escape close and
    // the next activation on Windows.
    await act(async () => { target.dispatchEvent(new owner.PointerEvent('pointerdown', { bubbles: true })) })
    check(target.isConnected, 'interactive control remained mounted through pointerdown')
    await act(async () => { (target as HTMLElement).click() })
}
const key = async (element: Element, value: string, shiftKey = false) => {
    await act(async () => element.dispatchEvent(new element.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })))
}
const download = { id: 'fixture-download', filename: 'fixture.txt', status: 'completed', totalBytes: 40, receivedBytes: 40, risk: 'normal', exists: true } as const
const actions: string[] = []
const api: BrowserDownloadsApi = {
    list: async () => ({ success: true, downloads: [download as never] }),
    subscribe: () => () => {},
    act: async action => { actions.push(action.type); return { success: true, downloads: [download as never] } }
}
const resizeCommits: number[] = []
const commitResize = (_side: 'left' | 'right', width: number) => resizeCommits.push(width)
function PreviewChromeFixture() {
    const chrome = useFilePreviewChrome({ defaultStartExpanded: false, defaultLeftPanelOpen: true, defaultRightPanelOpen: false,
        defaultCsvDistinctColorsEnabled: false, defaultEditorWordWrap: 'off', defaultEditorMinimapEnabled: false, defaultEditorFontSize: 12,
        onPanelWidthCommit: commitResize })
    return <div ref={chrome.previewSurfaceRef}><button data-preview-resize-side="left">Resize preview</button><output data-preview-width>{chrome.leftPanelWidth}</output></div>
}
function ToastFixture() {
    const { developerToast, showDeveloperToast, dismissDeveloperToast } = useAssistantInspectorDeveloperToast()
    useEffect(() => { showDeveloperToast({ message: 'Page appearance is light.' }) }, [showDeveloperToast])
    return <AssistantInspectorDeveloperToast toast={developerToast} onDismiss={dismissDeveloperToast} />
}
Object.assign(window, { nativeOverlayCallerCheck: (async () => {
    if ((globalThis as any).nativeOverlayVisibilityOnly) {
        prepared()
        await checkWorkspaceOverlayVisibility()
        await act(async () => root.unmount())
        return results
    }
    let active = true, scopeKey = 'workspace:tab-a'
    const renderDownloads = async () => act(async () => root.render(<AssistantBrowserDownloadsButton api={api} active={active} scopeKey={scopeKey} />))
    const trigger = () => host.querySelector('[aria-label="Downloads"]')
    const panel = () => childDocument.querySelector('[aria-label="Browser downloads"]')
    await renderDownloads()
    ownerInput.focus()
    await click(trigger())
    check(!panel(), 'cold native document remains unmounted until ready')
    await click(trigger())
    prepared()
    await act(async () => { await preparation; await delay(80) })
    check(!panel(), 'second click cancels a cold portal without stale reopening')
    await click(trigger())
    await settle(() => Boolean(panel()), 'Downloads should open in the native document')
    check(!host.querySelector('[aria-label="Browser downloads"]'), 'Downloads is absent from the original DOM')
    check(panel()!.ownerDocument !== document, 'Downloads owns a separate DOM realm')
    check(document.activeElement === ownerInput, 'native popup presentation preserves an address-like owner input focus')
    check(focusRequests.every(focus => focus === false), 'native presentation explicitly requests no focus theft')
    const optionTrigger = () => childDocument.querySelector('button[aria-label="Options for fixture.txt"]')
    const options = () => childDocument.querySelector('[role="menu"][aria-label="Options for fixture.txt"]')
    await click(optionTrigger())
    await settle(() => Boolean(options()), 'nested options should mount in the native document').catch(error => { throw new Error(`${error.message}; panel=${Boolean(panel())}; expanded=${optionTrigger()?.getAttribute('aria-expanded')}; menus=${childDocument.querySelectorAll('[role=menu]').length}; originalMenus=${document.querySelectorAll('[role=menu]').length}; text=${childDocument.body.textContent?.slice(-600)}`) })
    check(Boolean(panel()), 'cross-realm pointer inside the Downloads panel must not dismiss it')
    await key(options()!, 'Escape')
    await settle(() => !options(), 'Escape closes nested options')
    check(Boolean(panel()), 'nested Escape preserves Downloads')
    // Observe the mounted child-document trigger's committed closed state before reopening.
    // The menu's removal alone does not state that its trigger is ready for a new interaction.
    await settle(() => {
        const trigger = optionTrigger()
        return Boolean(panel() && trigger?.isConnected && trigger.getAttribute('aria-expanded') === 'false')
    }, 'options trigger is ready to reopen')
    await click(optionTrigger())
    await settle(() => Boolean(options()), 'options reopen').catch(error => { throw new Error(`${error.message}; panel=${Boolean(panel())}; triggerConnected=${optionTrigger()?.isConnected}; expanded=${optionTrigger()?.getAttribute('aria-expanded')}; menus=${childDocument.querySelectorAll('[role=menu]').length}; originalMenus=${document.querySelectorAll('[role=menu]').length}; text=${childDocument.body.textContent?.slice(-600)}`) })
    await click([...options()!.querySelectorAll('button')].find(button => button.textContent?.includes('Show in folder'))!)
    check(actions.includes('reveal'), 'a real nested options click reaches the download API')
    await click(trigger())
    await settle(() => Boolean(panel()), 'Downloads reopens after action')
    scopeKey = 'workspace:tab-b'; await renderDownloads()
    await settle(() => !panel(), 'tab/scope switch closes the open native menu')
    await click(trigger()); await settle(() => Boolean(panel()), 'new scope opens')
    active = false; await renderDownloads(); await settle(() => !panel(), 'inactive browser closes menu')
    await click(trigger()); await act(async () => { await delay(40) }); check(!panel(), 'inactive browser cannot open menu')
    active = true; await renderDownloads(); await click(trigger()); await settle(() => Boolean(panel()), 'active menu opens')
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    await settle(() => !panel(), 'outside pointer in original document dismisses native menu')
    results.push('actual Downloads: cold cancellation, cross-document nested clicks/Escape, quick toggle, tab/active changes and outside dismissal')

    let presetChanges = 0
    await act(async () => root.render(<AssistantBrowserDeviceToolbar viewport={{ mode: 'freeform', width: 390, height: 844, presetId: null, aspectRatio: null }} onViewportChange={() => presetChanges++} onClose={() => {}} />))
    await click(host.querySelector('[aria-label="Browser device preset"]'))
    await settle(() => Boolean(childDocument.querySelector('[aria-label="Standard Browser devices"]')), 'device listbox mounts')
    await click(childDocument.querySelector('[aria-label="Standard Browser devices"] button'))
    check(presetChanges === 1, 'device selection survives the cross-document outside-click boundary')
    results.push('actual device menu: anchored native listbox selection reaches viewport callback')

    await act(async () => root.render(<AssistantDatePicker value="2026-09-13" max="2026-09-13" onChange={() => {}} />))
    await click(host.querySelector('button'))
    await settle(() => Boolean(childDocument.querySelector('[aria-label="Choose import start date"]')), 'date picker mounts')
    const dialog = childDocument.querySelector('[aria-label="Choose import start date"]')!
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    buttons.at(-1)!.focus()
    await key(buttons.at(-1)!, 'Tab')
    check(childDocument.activeElement === buttons[0], 'date picker Tab trap reads its own document')
    await key(buttons[0], 'Escape')
    await settle(() => !childDocument.querySelector('[aria-label="Choose import start date"]'), 'date picker Escape closes')
    results.push('actual date picker: child-document Tab wrap and Escape')

    const noop = () => {}
    for (const kind of ['backgrounds', 'history', 'bookmarks']) {
        let closed = 0
        const onClose = () => { closed++ }
        const view = () => kind === 'history'
            ? <AssistantBrowserHistoryPanel entries={[]} loading={false} query="" onQueryChange={noop} onClose={onClose} onNavigate={noop} onOpenInNewTab={noop} onClear={noop} onImport={noop} />
            : kind === 'bookmarks'
                ? <AssistantBrowserBookmarksPanel entries={[]} onClose={onClose} onNavigate={noop} onOpenInNewTab={noop} onRemove={noop} />
                : <AssistantBrowserBackgroundPicker controller={{ mode: 'off', providerStatus: null, visibleBackgrounds: [], setMode: noop } as never} onClose={onClose} />
        await act(async () => root.render(view()))
        const label = kind === 'history' ? 'Browser history' : kind === 'bookmarks' ? 'Browser bookmarks' : 'New Tab backgrounds'
        await settle(() => Boolean(childDocument.querySelector(`[aria-label="${label}"]`)) && nativeBounds !== null, `${kind} mounts with scoped input bounds`)
        const browserDialog = childDocument.querySelector(`[aria-label="${label}"]`)!
        const rect = host.getBoundingClientRect()
        check(nativeBounds?.x === rect.left && nativeBounds?.width === rect.width, `${kind} limits the native surface to its browser anchor`)
        check(browserDialog.getAttribute('aria-modal') === 'false', `${kind} does not mark unrelated app controls as inaccessible`)
        await click(browserDialog.parentElement)
        await act(async () => { await delay(260) })
        check(closed === (kind === 'backgrounds' ? 0 : 1), `${kind} backdrop dismissal matches its panel behavior`)
        if (kind !== 'backgrounds') {
            await act(async () => root.render(null))
            await act(async () => root.render(view()))
            await settle(() => Boolean(childDocument.querySelector(`[aria-label="${label}"]`)), `${kind} reopens after outside click`)
        }
        await key(ownerInput, 'Escape')
        await act(async () => { await delay(260) })
        check(closed === (kind === 'backgrounds' ? 0 : 1), `${kind} ignores keyboard events outside the browser dialog`)
        await key(childDocument.querySelector(`[aria-label="${label}"]`)!, 'Escape')
        await settle(() => closed === (kind === 'backgrounds' ? 1 : 2), `${kind} still closes with Escape inside its own dialog`)
        await act(async () => root.render(null))
    }
    results.push('actual Backgrounds, History and Bookmarks: scoped bounds, outside dismissal and Escape')

    await act(async () => root.render(<ToastFixture />))
    await settle(() => Boolean(childDocument.querySelector('[role="status"]')) && nativeBounds !== null, 'Browser toast mounts in the native document')
    check(nativeBounds!.width < 400 && nativeBounds!.height < 100, 'toast limits native input interception to the card instead of the Browser window')
    check(Boolean(childDocument.querySelector('svg')), 'informational notice includes a visible icon')
    await act(async () => ownerInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    await settle(() => !childDocument.querySelector('[role="status"]'), 'outside click dismisses toast without intercepting the owner control')
    await act(async () => root.render(null))
    await act(async () => root.render(<ToastFixture />))
    await settle(() => Boolean(childDocument.querySelector('[role="status"]')), 'Browser toast reopens for swipe')
    const toastCard = childDocument.querySelector<HTMLElement>('[role="status"]')!
    toastCard.setPointerCapture = () => {}
    toastCard.hasPointerCapture = () => true
    toastCard.releasePointerCapture = () => {}
    await act(async () => toastCard.dispatchEvent(new child.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 200 })))
    await act(async () => toastCard.dispatchEvent(new child.PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 100 })))
    await act(async () => toastCard.dispatchEvent(new child.PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 100 })))
    await settle(() => !childDocument.querySelector('[role="status"]'), 'swiping the text toast dismisses it')
    await act(async () => root.render(null))
    results.push('Browser toast: scoped input, icon, outside dismissal, and swipe')

    let selected = 0
    await act(async () => root.render(<FileActionsMenu title="Add fixture tab" items={[{ id: 'first', label: 'First action', onSelect: () => { selected++ } }]} />))
    await key(host.querySelector('button')!, 'ArrowDown')
    await settle(() => Boolean(childDocument.querySelector('[role="menu"]')), 'shared FileActions menu opens by keyboard')
    const firstAction = [...childDocument.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent === 'First action')!
    await settle(() => childDocument.activeElement === firstAction, 'keyboard focus waits for actual native portal mount')
    await click(firstAction)
    check(selected === 1, 'shared FileActions action fires once')
    let contextDismissals = 0
    await act(async () => root.render(<FileActionsMenu key="chat-context" title="Chat context" density="compact" containEscape
        contextAnchor={{ x: 150, y: 100 }} onDismiss={() => { contextDismissals++ }}
        items={[{ id: 'thread', label: 'Thread', submenuOnly: true, onSelect: () => {}, choicesLabel: 'Thread actions',
            choices: [{ id: 'new-thread', label: 'New thread', onSelect: () => { selected++ } }] }]} />))
    await settle(() => Boolean(childDocument.querySelector('[aria-label="Chat context"]')), 'chat context opens in native child document')
    const threadParent = childDocument.querySelector<HTMLButtonElement>('[data-submenu-id="thread"]')!
    await key(threadParent, 'ArrowRight')
    await settle(() => Boolean(childDocument.querySelector('[aria-label="Thread actions"]')), 'chat submenu mounts in native child document')
    const threadAction = [...childDocument.querySelectorAll<HTMLButtonElement>('[aria-label="Thread actions"] button')][0]
    await settle(() => childDocument.activeElement === threadAction, 'keyboard focuses native submenu after mount')
    await key(threadAction, 'ArrowLeft')
    await settle(() => childDocument.activeElement === threadParent && !childDocument.querySelector('[aria-label="Thread actions"]'), 'keyboard returns to native submenu parent')
    await key(threadParent, 'ArrowRight')
    await settle(() => Boolean(childDocument.querySelector('[aria-label="Thread actions"]')), 'native submenu reopens')
    await click(childDocument.querySelector<HTMLButtonElement>('[aria-label="Thread actions"] button')!)
    check(selected === 2 && contextDismissals === 1, 'native context submenu fires once and dismisses its owner')
    results.push('actual chat context submenu: child-document positioning, keyboard focus/return, one action and dismissal')
    await act(async () => root.render(<NativeOverlayPortal><PreviewChromeFixture /></NativeOverlayPortal>))
    await settle(() => Boolean(childDocument.querySelector('[data-preview-resize-side]')), 'preview resize handle mounts')
    const separator = childDocument.querySelector('[data-preview-resize-side]')!
    await key(separator, 'ArrowRight')
    check(childDocument.querySelector('[data-preview-width]')?.textContent === '264', 'native preview separator keyboard changes width')
    await act(async () => separator.dispatchEvent(new child.PointerEvent('pointerdown', { bubbles: true, clientX: 100 })))
    check(childDocument.body.style.cursor === 'col-resize', 'drag cursor belongs to the preview document')
    await act(async () => {
        childDocument.dispatchEvent(new child.PointerEvent('pointermove', { bubbles: true, clientX: 140 }))
        childDocument.dispatchEvent(new child.PointerEvent('pointerup', { bubbles: true, clientX: 140 }))
    })
    check(childDocument.querySelector('[data-preview-width]')?.textContent === '304', 'native preview pointer drag flushes its final width')
    check(resizeCommits.join(',') === '264,304', 'preview keyboard and pointer commits each fire once')
    check(childDocument.body.style.cursor === '', 'preview drag releases its cursor')
    results.push('actual preview chrome hook: child-document separator keyboard, drag, width commits and cursor cleanup')
    await checkWorkspaceOverlayVisibility()
    await act(async () => root.unmount())
    await act(async () => { await delay(50) })
    check(!childDocument.querySelector('[role="menu"]'), 'unmount leaves no stale menu')
    check(visibility.includes(true), 'real portal host presented committed content')
    results.push('actual shared FileActions: ArrowDown focus after mount, one action and clean unmount')
    return results
})().finally(() => { host.remove(); ownerInput.remove(); iframe.remove(); passiveIframe.remove() }) })
