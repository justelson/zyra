import { Controller } from './extension/control'
import { parseOperation, type Grant } from './shared/protocol'
import { sendEvent } from './pairing'
import { redactExtensionObservation } from './redaction'

type Request = { type: string; tabId: number; documentId?: string; observationRevision?: number; includeScreenshot?: boolean; allowWindowFocus?: boolean; bounds?: { maxElements?: number }; action?: Record<string, any> }
type Binding = { documentId: string; mode: Grant['mode'] }

/** Adapt the app's scoped broker protocol to the trusted Chrome controller. */
export class AppController {
  readonly control: Controller
  private readonly bindings = new Map<number, Binding>()
  private readonly revisions = new Map<number, number>()
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly changed: () => void) {
    this.control = new Controller(() => { void this.synchronize().catch(() => undefined); this.changed() })
  }
  private synchronize() {
    const next = this.tail.then(async () => {
      const grants = this.control.list()
      for (const [tabId] of this.bindings) {
        if (grants.some((grant) => grant.tabId === tabId)) continue
        this.bindings.delete(tabId); this.revisions.delete(tabId)
        await sendEvent({ type: 'tab.closed', tabId }).catch(() => undefined)
      }
      for (const grant of grants) {
        if (this.bindings.get(grant.tabId)?.mode === grant.mode) continue
        const binding = { documentId: crypto.randomUUID(), mode: grant.mode }
        await sendEvent({ type: 'tab.register', tabId: grant.tabId, documentId: binding.documentId, mode: grant.mode, url: grant.url, title: grant.title })
        this.bindings.set(grant.tabId, binding)
      }
      await chrome.storage.session.set({ grantedIds: grants.map((grant) => grant.tabId) })
    })
    this.tail = next.catch(() => undefined)
    return next
  }
  async grant(tabId: number, mode: Grant['mode']) { await this.control.grant(tabId, mode); await this.synchronize() }
  async release(tabId?: number) { await this.control.release(tabId); await this.synchronize() }
  async execute(request: Request, signal: AbortSignal) {
    signal.throwIfAborted()
    if (request.type === 'revoke-tab') { await this.release(request.tabId); return { revoked: true } }
    const binding = this.bindings.get(request.tabId)
    if (!binding || binding.documentId !== request.documentId) throw new Error('This Chrome tab is no longer shared with Zyra. Share it again from the extension.')
    const run = (method: string, params: object = {}) => this.control.execute(parseOperation({ method, params: { tabId: request.tabId, ...params } }), signal)
    if (request.type === 'observe') {
      const snapshot = await run('snapshot', { maxElements: Math.min(1000, request.bounds?.maxElements || 400) }) as Record<string, any>
      this.revisions.set(request.tabId, Number(request.observationRevision))
      let screenshotData: string | undefined
      if (request.includeScreenshot) {
        const screenshot = await run('screenshot') as { data: string }
        screenshotData = await boundScreenshot(screenshot.data) || undefined
      }
      signal.throwIfAborted()
      const observation = redactExtensionObservation({
        url: snapshot.url, title: snapshot.title, viewport: { ...snapshot.viewport, scale: 1 }, targetState: 'ready',
        elements: snapshot.elements.map((element: any) => ({ ...element, elementRef: element.ref,
          states: [element.disabled && 'disabled', element.checked && 'checked', element.focused && 'focused'].filter(Boolean),
          actions: element.sensitive ? [] : ['click', ...(/textbox|combobox/.test(element.role) ? ['type'] : []), ...(element.options ? ['select'] : [])],
          description: element.options ? element.options.map((option: any) => `${option.value}: ${option.label}`).join('; ').slice(0, 512) : undefined,
        })),
        focusedElementRef: snapshot.elements.find((element: any) => element.focused)?.ref,
        truncation: snapshot.truncated ? { totalElements: snapshot.totalElements, returnedElements: snapshot.elements.length } : undefined,
        screenshotData, redactions: request.includeScreenshot && !screenshotData ? ['screenshot-size-limit'] : [],
      })
      const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
      const totalElements = snapshot.totalElements || snapshot.elements.length
      while (observation.elements.length && byteLength(observation) > 490 * 1024) {
        observation.elements.pop()
      }
      if (observation.elements.length < totalElements) observation.truncation = { totalElements, returnedElements: observation.elements.length }
      return observation
    }
    if (request.type !== 'action' || !request.action) throw new Error('Unsupported Chrome broker request.')
    if (this.revisions.get(request.tabId) !== request.observationRevision) throw new Error('Stale observation. Observe this Chrome tab again before using it.')
    if (binding.mode !== 'control' && request.action.type !== 'wait') throw new Error('This tab has read-only access. Choose Control in Zyra Browser to interact.')
    const action = request.action
    if ((action.type === 'drag' || action.type === 'stroke') && request.allowWindowFocus) await run('focus')
    if (action.type === 'click' && action.elementRef && action.button !== 'middle') {
      await run('click', { ref: action.elementRef, count: action.clickCount || 1, button: action.button || 'left' })
    } else if (action.type === 'type' && action.elementRef) {
      await run(action.replace ? 'fill' : 'type', { ref: action.elementRef, text: action.text })
    } else if (action.type === 'select') {
      await run('select', { ref: action.elementRef, values: action.values })
    } else if (action.type === 'navigate') {
      await run('navigate', { url: action.url })
    } else if (action.type === 'focus') {
      await run('focus')
    } else {
      await this.control.executeAppInput(request.tabId, action, signal)
    }
    return { changed: action.type !== 'wait' }
  }
}

async function boundScreenshot(encoded: string): Promise<string | null> {
  const binaryData = atob(encoded)
  const source = new Blob([Uint8Array.from(binaryData, character => character.charCodeAt(0))], { type: 'image/jpeg' })
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, 1440 / bitmap.width, 900 / bitmap.height)
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); return null }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.62 })
  if (blob.size > 290 * 1024) return null
  let binary = ''
  for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
  return btoa(binary)
}
