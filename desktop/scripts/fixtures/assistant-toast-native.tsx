import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantTransientToast, useAssistantTransientToast, type AssistantToastInput } from '../../src/renderer/src/pages/assistant/AssistantToast'

const check = (value: unknown, message: string) => { if (!value) throw Error(message) }
const sleep = (ms = 30) => new Promise<void>(resolve => setTimeout(resolve, ms))
const until = async (test: () => unknown, label: string) => {
    const started = performance.now()
    while (!test()) { if (performance.now() - started > 4000) throw Error('Timed out: ' + label); await sleep(10) }
}
const reduced = new URLSearchParams(location.search).get('reduced') === 'true'
type Bounds = { x: number; y: number; width: number; height: number }
type Call = { visible: boolean; focus: boolean; bounds: Bounds | null }
type Sample = { at: number; message: string; opacity: number; dy: number; width: number; height: number; position: string }
const calls: Call[] = [], samples: Sample[] = [], checks: string[] = []
let frame: HTMLIFrameElement | undefined, childDocument: Document | undefined, closed = false
let preparation: (() => void) | undefined
let recording = true
const evidence = { calls, samples, checks, reduced, motion: null as unknown, geometry: [] as unknown[], resizes: [] as Array<{ requestedWidth: number; requestedHeight: number; width: number; height: number }> }
;(window as any).toastNativeEvidence = evidence
;(window as any).devscope = {
    prepareNativeOverlay: async () => {
        // Deliberately stay cold well past the hook's 10ms visibility timer.
        await new Promise<void>(resolve => { preparation = resolve })
        return { success: true, frameName: 'toast-native-fixture' }
    },
    setNativeOverlayVisible: async (value: Call) => {
        calls.push({ visible: value.visible, focus: value.focus, bounds: value.bounds && { ...value.bounds } })
        if (frame && value.visible) {
            const bounds = value.bounds ?? { x: 0, y: 0, width: innerWidth, height: innerHeight }
            // Critical: resize the actual child viewport, not just the host root.
            Object.assign(frame.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${Math.max(1, bounds.width)}px`, height: `${Math.max(1, bounds.height)}px` })
        }
        if (frame) frame.style.visibility = value.visible ? 'visible' : 'hidden'
        return { success: true, bounds: value.bounds }
    },
    onNativeOverlayDismiss: () => () => {}
}
window.open = (() => {
    frame = document.createElement('iframe')
    frame.title = 'Synthetic native toast child'
    frame.style.cssText = `position:fixed;left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;border:0;visibility:hidden;z-index:200`
    document.body.append(frame)
    const child = frame.contentWindow!
    childDocument = child.document
    closed = false
    return new Proxy(child, { get(target, key) {
        if (key === 'closed') return closed
        if (key === 'close') return () => { closed = true; frame?.remove() }
        return Reflect.get(target, key, target)
    } })
}) as typeof window.open
const visual = () => childDocument?.querySelector<HTMLElement>('[data-assistant-toast]')
const region = () => childDocument?.querySelector<HTMLElement>('[data-assistant-toast-region]') || visual()
const sample = () => {
    const node = visual()
    if (node) {
        const style = node.ownerDocument.defaultView!.getComputedStyle(node), rect = region()!.getBoundingClientRect()
        samples.push({ at: performance.now(), message: node.textContent || '', opacity: Number(style.opacity), dy: style.transform === 'none' ? 0 : new DOMMatrix(style.transform).m42, width: rect.width, height: rect.height, position: style.position })
    }
    if (recording) requestAnimationFrame(sample)
}
requestAnimationFrame(sample)
let show: (input: AssistantToastInput) => void = () => { throw Error('App not ready') }
let dismiss: () => void = () => {}
function App() {
    const { toast, showToast, dismissToast } = useAssistantTransientToast()
    const [present, setPresent] = useState(true)
    show = showToast; dismiss = dismissToast
    ;(window as any).unmountToast = () => setPresent(false)
    return present ? <AssistantTransientToast toast={toast} onDismiss={dismissToast} /> : null
}
const root = createRoot(document.querySelector('#root')!)
flushSync(() => root.render(<App />))
const shown = () => visual()?.getAttribute('aria-hidden') === 'false'
const action = () => [...(childDocument?.querySelectorAll<HTMLButtonElement>('[data-assistant-toast] button') || [])].find(button => button.textContent === 'Undo')!
const emitPointer = (enter: boolean) => {
    const node = visual()!, view = node.ownerDocument.defaultView!
    node.dispatchEvent(new view.MouseEvent(enter ? 'mouseover' : 'mouseout', { bubbles: true, relatedTarget: node.ownerDocument.body }))
}
const remove = async () => { dismiss(); await until(() => !visual(), 'toast removed after exit') }
const resize = async (width: number, height: number) => {
    const request = { type: 'resize', width, height, done: false }
    ;(window as any).toastNativeRequest = request
    // Windows offscreen Electron can include a 2px non-client inset even with
    // useContentSize. Geometry assertions use the actual owner viewport below.
    try {
        await until(() => request.done, 'hidden harness delivered owner resize command')
        await until(() => Math.abs(innerWidth - width) <= 2 && Math.abs(innerHeight - height) <= 2, 'hidden owner viewport resized')
    } catch (error) {
        throw Error(`${String(error)}; requested ${width}x${height}, actual ${innerWidth}x${innerHeight}, command delivered=${request.done}`)
    } finally {
        evidence.resizes.push({ requestedWidth: width, requestedHeight: height, width: innerWidth, height: innerHeight })
    }
    await sleep(150)
}
const lastBounds = () => [...calls].reverse().find(call => call.visible)?.bounds
const assertGeometry = (label: string) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const expected = Math.min(24 * rem, innerWidth - 2 * rem)
    const bounds = lastBounds(), rect = region()!.getBoundingClientRect()
    const anchor = region()!.parentElement!.parentElement!
    evidence.geometry.push({ label, owner: { width: innerWidth, height: innerHeight, rem }, expected, bounds,
        region: rect.toJSON(), anchor: anchor.getBoundingClientRect().toJSON(), anchorStyle: anchor.getAttribute('style'),
        cropRootStyle: childDocument?.querySelector('#zyra-native-overlay-root')?.getAttribute('style') })
    check(bounds && Math.abs(bounds.width - expected) < 1, `${label}: expected owner-sized ${expected}px toast, got ${bounds?.width}px (child viewport ${frame?.contentWindow?.innerWidth}px)`)
    check(Math.abs(rect.width - expected) < 1 && Math.abs(rect.x) < 1 && Math.abs(rect.y) < 1, `${label}: cropped child keeps the stable measured outer box at local origin`)
    check(Math.abs(bounds!.x - (innerWidth - rem - expected)) < 1 && Math.abs(bounds!.y + bounds!.height - (innerHeight - rem)) < 1, `${label}: crop preserves owner bottom/right coordinates`)
    check(frame!.contentWindow!.innerWidth <= Math.ceil(expected), `${label}: iframe really has the cropped viewport`)
}

;(window as any).toastNativeCheck = (async () => {
    console.log('toast-native renderer started; exercising cold preparation')
    const ownerInput = document.querySelector<HTMLInputElement>('#owner-input')!
    ownerInput.focus()
    show({ message: 'Chat settled', action: { label: 'Undo', run: () => {} }, durationMs: 10000 })
    await until(() => preparation, 'cold portal preparation')
    await sleep(120)
    check(!visual(), 'cold preparation holds actual toast mount beyond the visibility timer')
    preparation!()
    console.log('toast-native cold preparation released; awaiting actual portal mount/crop')
    await until(() => shown(), 'cold portal toast visible')
    await sleep(320)
    console.log('toast-native mounted; inspecting repeated crop geometry', JSON.stringify(lastBounds()))
    assertGeometry('Repeated native crop')
    const cold = samples.filter(sample => sample.message.includes('Chat settled'))
    const childView = visual()!.ownerDocument.defaultView!
    const motionStyle = childView.getComputedStyle(visual()!)
    const motion = { ownerReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        childReduced: childView.matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionProperty: motionStyle.transitionProperty, transitionDuration: motionStyle.transitionDuration,
        classes: visual()!.className }
    evidence.motion = motion
    console.log('toast-native real motion media/CSS', JSON.stringify(motion))
    check(cold.some(sample => sample.opacity === 0 && sample.dy >= 15), 'cold mount paints a hidden, translated entrance frame')
    if (reduced) {
        check(cold.every(sample => sample.opacity === 0 || sample.opacity === 1), 'reduced motion has no intermediate opacity frames')
        check(motion.ownerReduced && motion.childReduced, 'real reduced-motion media matches in both owner and resized native child')
        // Tailwind transition-none sets transition-property:none; duration-200
        // can remain 0.2s without animating any property.
        check(motion.transitionProperty === 'none', 'reduced motion disables every real CSS transition property')
    } else {
        check(cold.some(sample => sample.opacity > 0 && sample.opacity < 1 && sample.dy > 0 && sample.dy < 16), 'entrance has actual intermediate opacity/translation frames')
    }
    check(cold.at(-1)!.opacity === 1 && cold.at(-1)!.dy === 0, 'entrance settles fully visible and unshifted')
    check(cold.every(sample => Math.abs(sample.width - 384) < 1), 'animation never changes measured native crop width')
    check(document.activeElement === ownerInput && calls.every(call => !call.focus), 'arrival never requests native or DOM autofocus')
    check(document.elementFromPoint(30, 70)?.id === 'owner-action', 'outside-toast owner action is not intercepted by the native crop')
    const hit = action().getBoundingClientRect()
    check(action().contains(childDocument!.elementFromPoint(hit.x + hit.width / 2, hit.y + hit.height / 2)), 'Undo is genuinely hit-testable inside the resized iframe')
    console.log('toast-native cold entrance/geometry checks passed')
    checks.push('real cropped viewport reproducer, stable owner width/coordinates, cold entrance initial/intermediate/final, no focus theft or outside input interception')

    for (let index = 0; index < 4; index++) {
        frame!.style.width = '420px'; frame!.style.height = '160px'
        const child = frame!.contentWindow!
        child.dispatchEvent(new child.Event('resize'))
        await sleep(35)
        check(Math.abs(region()!.getBoundingClientRect().width - 384) < 1, 'temporary child viewport expansion does not change owner-sized toast')
        await (window as any).devscope.setNativeOverlayVisible({ visible: true, focus: false, bounds: lastBounds() })
        await sleep(35)
        assertGeometry('Repeated child-only resize ' + index)
    }
    await resize(390, 640); assertGeometry('Narrow owner resize')
    document.documentElement.style.fontSize = '20px'
    await resize(1200, 860); assertGeometry('Owner resize with 20px root rem')
    document.documentElement.style.fontSize = '16px'
    await resize(1000, 800); assertGeometry('Owner dimensions restored')
    checks.push('repeated child crop/resize cannot feed back; real narrow/wide owner resize and owner rem determine geometry')
    console.log('toast-native owner resize checks passed; checking dismissal/expiry/actions')
    const exitStart = samples.length
    dismiss(); await until(() => !shown(), 'dismiss begins exit'); await sleep(100)
    if (!reduced) check(samples.slice(exitStart).some(sample => sample.opacity > 0 && sample.opacity < 1 && sample.dy > 0), 'dismiss animates intermediate exit frames')
    await until(() => !visual(), 'dismiss removes toast after exit')

    show({ message: 'Hover expiry', durationMs: 180 })
    await until(shown, 'hover toast'); emitPointer(true); await sleep(240)
    check(shown(), 'hover pauses expiry'); emitPointer(false)
    await until(() => !visual(), 'hover leave resumes expiry')
    show({ message: 'Focus expiry', durationMs: 180, action: { label: 'Undo', run: () => {} } })
    await until(shown, 'focus toast')
    action().focus()
    check(childDocument!.activeElement === action(), 'keyboard focus reaches the actual child action')
    // The disposable hidden window cannot receive OS focus. Deliver the native
    // focus-in signal explicitly, as in the existing settlement-toast fixture.
    const focusView = childDocument!.defaultView!
    action().dispatchEvent(new focusView.FocusEvent('focusin', { bubbles: true }))
    await sleep(240)
    check(shown(), 'focus pauses expiry')
    show({ message: 'Focused replacement', durationMs: 180, action: { label: 'Undo', run: () => {} } })
    await sleep(250); check(shown() && visual()!.textContent!.includes('Focused replacement'), 'replacement retains existing keyboard focus pause')
    await remove(); ownerInput.focus()
    show({ message: 'Old expiry', durationMs: 180 }); await until(shown, 'old expiry'); await sleep(90)
    show({ message: 'New expiry', durationMs: 350 }); await sleep(180)
    check(shown() && visual()!.textContent!.includes('New expiry'), 'old expiry does not dismiss replacement'); await remove()
    checks.push('dismiss/exit, idle expiry, hover/focus pause, focus-preserving replacement and stale expiry')

    show({ message: 'Undo failure', action: { label: 'Undo', run: () => { throw Error('Synthetic action failure') } } })
    await until(shown, 'failure toast'); action().click()
    await until(() => visual()?.getAttribute('role') === 'alert' && visual()?.textContent?.includes('Synthetic action failure'), 'action failure stays visible as an alert')
    await remove()
    let finish: (() => void) | undefined, count = 0
    show({ message: 'Pending Undo', durationMs: 90, action: { label: 'Undo', run: () => { count++; return new Promise<void>(resolve => { finish = resolve }) } } })
    await until(shown, 'pending toast'); action().click(); action().click(); await sleep(180)
    check(count === 1 && shown() && action().disabled, 'action is single-flight, disabled and expiry-paused while pending')
    show({ message: 'Newer notification', durationMs: 2000 }); await until(() => shown() && visual()?.textContent?.includes('Newer notification'), 'replacement visible')
    finish!(); await sleep(60)
    check(shown() && visual()!.textContent!.includes('Newer notification'), 'old action completion cannot dismiss replacement'); await remove()
    show({ message: 'Successful Undo', action: { label: 'Undo', run: () => {} } })
    await until(shown, 'successful action toast'); action().click(); await until(() => !visual(), 'successful action dismisses')
    checks.push('action failure/error alert, asynchronous single-flight/expiry pause, successful dismissal and stale action completion')
    show({ message: 'Chat settled', action: { label: 'Undo', run: () => {} }, durationMs: 10000 })
    await until(shown, 'final evidence toast'); await sleep(240); assertGeometry('Final evidence')
    recording = false
    return checks
})().catch(error => { recording = false; throw error })
