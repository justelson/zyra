import { AppController } from './app-controller'
import { pairWithZyra, getPairingSession, clearPairingSession, sendEvent, startPolling, stopPolling } from './pairing'
import { errorInfo, type Activity, type ExtensionState } from './shared/protocol'
import { pageUrl, safeUrl } from './shared/safety'
import { appearanceFromPreferences, isThemePreference, unavailableAppearance, type ThemePreference } from './shared/appearance'

let connected = false, connecting = false, portNumber = 0, lastError: string | null = null
let theme: ThemePreference = 'zyra', tabsLayout: 'list' | 'grid' = 'list', appearance = unavailableAppearance
const ports = new Set<chrome.runtime.Port>(), activity: Activity[] = [], active = new Map<string, AbortController>()
const controller = new AppController(broadcast)
const state = (): ExtensionState => ({ connected, connecting, port: portNumber, grants: controller.control.list(), activity, lastError, theme, zyraAppearance: appearance, tabsLayout })
function broadcast() {
  controller.control.setCursorAppearance(theme, appearance)
  for (const port of ports) { try { port.postMessage(state()) } catch { ports.delete(port) } }
  void chrome.action.setBadgeText({ text: controller.control.list().length ? String(controller.control.list().length) : '' })
}
function abortAll() { for (const abort of active.values()) abort.abort(new Error('Browser access ended.')); active.clear() }
async function disconnect(notify = true) {
  stopPolling(); abortAll(); connected = false
  await controller.release()
  if (notify) await sendEvent({ type: 'session.disconnect' }).catch(() => undefined)
  await clearPairingSession(); broadcast()
}
function beginPolling() {
  startPolling(async (operation: any, request: { requestId: string; deadline?: number }) => {
    if (operation.type === 'cancel') { active.get(operation.requestId)?.abort(new Error('Zyra cancelled this action.')); return { cancelled: true } }
    const abort = new AbortController(), startedAt = Date.now()
    const remaining = (request.deadline || startedAt + 15000) - startedAt
    if (remaining <= 0) throw new Error('This Browser request expired before it could start.')
    const timer = setTimeout(() => abort.abort(new Error('Browser action timed out.')), Math.min(30_000, remaining))
    active.set(request.requestId, abort)
    let failure: ReturnType<typeof errorInfo> | null = null
    try { return await controller.execute(operation, abort.signal) }
    catch (reason) { failure = errorInfo(reason); throw reason }
    finally {
      clearTimeout(timer); active.delete(request.requestId)
      activity.push({ id: request.requestId, method: operation.action?.type || operation.type, tabId: operation.tabId, startedAt, durationMs: Date.now() - startedAt, outcome: failure ? 'error' : 'ok', ...(failure ? { code: failure.code } : {}) })
      if (activity.length > 150) activity.splice(0, activity.length - 150)
      broadcast()
    }
  }, async () => {
    lastError = 'Connection ended. Connect again from Zyra Settings.'
    await disconnect(false)
  }, (value: unknown) => {
    try { const next = appearanceFromPreferences({ schemaVersion: 1, shared: value }); if (JSON.stringify(next) !== JSON.stringify(appearance)) { appearance = next; void chrome.storage.local.set({ zyraAppearance: next }); broadcast() } } catch {}
  })
}
const ready = (async () => {
  const saved = await chrome.storage.session.get('grantedIds')
  // Worker restart keeps the connection but never silently restores input authority.
  for (const tabId of saved.grantedIds || []) { await chrome.debugger.detach({ tabId }).catch(() => {}); await sendEvent({ type:'tab.closed', tabId }).catch(() => {}) }
  await chrome.storage.session.remove('grantedIds')
  const preferences = await chrome.storage.local.get(['themePreference','tabsLayout','port'])
  theme = isThemePreference(preferences.themePreference) ? preferences.themePreference : 'zyra'
  tabsLayout = preferences.tabsLayout === 'grid' ? 'grid' : 'list'
  portNumber = Number(preferences.port) || 0
  const session = await getPairingSession()
  if (session) { connected = true; portNumber = session.port; beginPolling() }
})()
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'zyra-ui' || !port.sender?.url?.startsWith(chrome.runtime.getURL(''))) return
  ports.add(port); void ready.then(() => port.postMessage(state()))
  port.onDisconnect.addListener(() => ports.delete(port))
})
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return
  void ready.then(() => handle(message)).then((result) => reply({ok:true,result}), (reason) => reply({ok:false,error:errorInfo(reason)}))
  return true
})
async function handle(message: Record<string, unknown>) {
  switch(message.type) {
    case 'status': return state()
    case 'connect':
      await disconnect(); connecting = true; lastError = null; broadcast()
      try {
        portNumber = Number(message.port)
        await pairWithZyra({port:portNumber, code:String(message.code || '').replace(/[\s-]/g,'')})
        connected = true; await chrome.storage.local.set({port:portNumber}); beginPolling()
      } finally { connecting = false; broadcast() }
      return state()
    case 'disconnect': await disconnect(); return state()
    case 'tabs': return (await chrome.tabs.query({})).filter(tab => { try { pageUrl(tab.url || ''); return !tab.incognito } catch { return false } }).map(tab => ({id:tab.id!,title:tab.title || '',url:safeUrl(tab.url || ''),active:tab.active,windowId:tab.windowId}))
    case 'grant':
      if (!connected) throw new Error('Connect Zyra Browser from the Zyra app first.')
      if (!Number.isInteger(message.tabId) || !['read','control'].includes(String(message.mode))) throw new Error('Invalid tab access request.')
      await controller.grant(Number(message.tabId), message.mode as 'read' | 'control'); broadcast(); return state()
    case 'release': abortAll(); await controller.release(typeof message.tabId === 'number' ? message.tabId : undefined); broadcast(); return state()
    case 'theme': if (!isThemePreference(message.theme)) throw new Error('Unknown theme.'); theme=message.theme; await chrome.storage.local.set({themePreference:theme}); broadcast(); return state()
    case 'tabs-layout': if (message.layout!=='list' && message.layout!=='grid') throw new Error('Unknown tab layout.'); tabsLayout=message.layout; await chrome.storage.local.set({tabsLayout}); broadcast(); return state()
    case 'clear-activity': activity.splice(0); broadcast(); return state()
    case 'open-console': await chrome.runtime.openOptionsPage(); return {opened:true}
    default: throw new Error('Unknown interface command.')
  }
}
