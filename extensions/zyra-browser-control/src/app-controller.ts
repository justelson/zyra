import { Controller } from './extension/control'
import { parseOperation, type Grant } from './shared/protocol'
import { pageUrl, safeUrl, safeText } from './shared/safety'
import { sendEvent } from './pairing'
import { redactExtensionObservation } from './redaction'

type Request = { type: string; tabId: number; documentId?: string; url?: string; observationRevision?: number; includeScreenshot?: boolean; allowWindowFocus?: boolean; bounds?: { maxElements?: number }; action?: Record<string, any> }
type Binding = { discovered?: boolean; browserName?: string; targetId?: string; documentId: string; mode: Grant['mode'] }

/** Adapt the app's scoped broker protocol to the trusted Chrome controller. */
export class AppController {
  readonly control: Controller
  private readonly bindings = new Map<number, Binding>()
  private readonly revisions = new Map<number, number>()
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly changed: () => void, private readonly browserName: () => string = () => 'Chrome') {
    this.control = new Controller(() => { void this.synchronize().catch(() => undefined); this.changed() })
  }
  private synchronize() {
    const next = this.tail.then(async () => {
      const grants = this.control.list()
      for (const [tabId] of this.bindings) {
        if (this.bindings.get(tabId)?.discovered || grants.some((grant) => grant.tabId === tabId)) continue
        this.bindings.delete(tabId); this.revisions.delete(tabId)
        await sendEvent({ type: 'tab.closed', tabId }).catch(() => undefined)
      }
      for (const grant of grants) {
        if (this.bindings.get(grant.tabId)?.mode === grant.mode && this.bindings.get(grant.tabId)?.browserName === this.browserName()) continue
        const binding: Binding = { browserName: this.browserName(), documentId: crypto.randomUUID(), mode: grant.mode }
        const registration = await sendEvent({ type: 'tab.register', browserName: this.browserName(), tabId: grant.tabId, documentId: binding.documentId, mode: grant.mode, url: grant.url, title: grant.title })
        binding.targetId = registration.targetId
        this.bindings.set(grant.tabId, binding)
      }
      await chrome.storage.session.set({ grantedIds: grants.map((grant) => grant.tabId) })
    })
    this.tail = next.catch(() => undefined)
    return next
  }
  private async discover() {
    await this.synchronize()
    const tabs = (await chrome.tabs.query({})).filter(tab => {
      try { pageUrl(tab.url || ''); return !tab.incognito && tab.id !== undefined } catch { return false }
    }).slice(0, 200)
    for (const [tabId, binding] of this.bindings) {
      if (binding.discovered && !tabs.some(tab => tab.id === tabId)) await this.release(tabId)
    }
    const added = tabs.filter(tab => !this.bindings.has(tab.id!) || (this.bindings.get(tab.id!)?.discovered && this.bindings.get(tab.id!)?.browserName !== this.browserName())).map(tab => {
      const url = safeUrl(tab.url!)
      return {tabId:tab.id!, documentId:crypto.randomUUID(), mode:'control' as const,
        browserName:this.browserName(), url:url.length <= 1024 ? url : pageUrl(url).origin,
        title:safeText(tab.title || '', 256)}
    })
    if (added.length) {
      const result = await sendEvent({type:'tabs.discover', tabs:added})
      for (const tab of added) this.bindings.set(tab.tabId, {...tab, discovered:true, targetId:result.targets?.find((target: {tabId:number; targetId?:string}) => target.tabId === tab.tabId)?.targetId})
    }
    return {count:tabs.length}
  }
  async refresh() { await this.synchronize(); if ([...this.bindings.values()].some(binding => binding.discovered)) await this.discover() }
  targetId(tabId: number) { return this.bindings.get(tabId)?.targetId }
  async grant(tabId: number, mode: Grant['mode'], scope: 'site' | 'tab' = 'site') { await this.control.grant(tabId, mode, scope); await this.synchronize() }
  async release(tabId?: number) {
    await this.control.release(tabId)
    for (const [id, binding] of this.bindings) if (binding.discovered && (tabId === undefined || tabId === id)) {
      this.bindings.delete(id); this.revisions.delete(id)
      await sendEvent({type:'tab.closed', tabId:id}).catch(() => undefined)
    }
    await this.synchronize()
  }
  async execute(request: Request, signal: AbortSignal) {
    signal.throwIfAborted()
    if (request.type === 'discover-tabs') return this.discover()
    if (request.type === 'revoke-tab') { await this.release(request.tabId); return { revoked: true } }
    const binding = this.bindings.get(request.tabId)
    if (!binding || binding.documentId !== request.documentId) throw new Error('This Chrome tab is no longer shared with Zyra. Share it again from the extension.')
    if (request.type === 'open-tab') {
      if (binding.mode !== 'control') throw new Error('This browser target has read-only access.')
      const url = pageUrl(request.url || '').href
      const anchor = await chrome.tabs.get(request.tabId)
      if (anchor.incognito) throw new Error('Private browsing is unavailable.')
      signal.throwIfAborted()
      const created = await chrome.tabs.create({ windowId: anchor.windowId, url, active: false })
      if (created.id === undefined) throw new Error('Chrome did not create the requested tab.')
      try {
        signal.throwIfAborted()
        const documentId = crypto.randomUUID()
        const registration = await sendEvent({ type: 'tab.register', browserName: this.browserName(), tabId: created.id, documentId,
          mode: 'control', url: safeUrl(url), title: safeText(created.title || '', 256) })
        this.bindings.set(created.id, { discovered: true, browserName: this.browserName(), documentId, mode: 'control', targetId: registration.targetId })
        signal.throwIfAborted()
        return { tabId: created.id }
      } catch (error) {
        await this.release(created.id).catch(() => undefined)
        await chrome.tabs.remove(created.id).catch(() => undefined)
        throw error
      }
    }
    const run = (method: string, params: object = {}) => this.control.execute(parseOperation({ method, params: { tabId: request.tabId, ...params } }), signal)
    if (request.type === 'observe') {
      // Discovery exposes metadata only. The desktop broker has checked the
      // user's grant before it can send this first observation request.
      if (binding.discovered && !this.control.list().some(grant => grant.tabId === request.tabId)) {
        await this.control.grant(request.tabId, 'control', 'tab')
        signal.throwIfAborted()
      }
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
          actions: element.sensitive || element.interactive === false ? [] : ['click', ...(/textbox|combobox/.test(element.role) ? ['type'] : []), ...(element.options ? ['select'] : [])],
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
