import { BridgeError, readMethods, type Grant, type Operation } from '../shared/protocol';
import { pageUrl, safeText, safeUrl, sameOrigin } from '../shared/safety';
import { pageTask } from './page';
import { CursorController, cursorDelay } from './cursor';
import { cursorPageTask, type CursorFrame } from './cursor-page';
import type { ThemePreference, ZyraAppearance } from '../shared/appearance';

type Diagnostic = { time: number; type: string; message?: string; url?: string; status?: number };
export class Controller {
  readonly grants = new Map<number, Grant>();
  private worlds = new Map<number, number>();
  private logs = new Map<number, Diagnostic[]>();
  private epochs = new Map<number, number>();
  private cursor = new CursorController((id, command, frame) => this.cursorPage(id, command, frame));
  constructor(private changed: () => void) {
    chrome.debugger.onDetach.addListener(({ tabId }, reason) => { if (tabId) { this.forget(tabId); this.changed(); } });
    chrome.tabs.onRemoved.addListener(id => { this.forget(id); this.changed(); });
    chrome.tabs.onUpdated.addListener((id, change) => {
      const grant = this.grants.get(id); if (!grant) return;
      if (change.status === 'loading') this.invalidate(id);
      if (change.url) { try { sameOrigin(change.url, grant.origin); grant.url = safeUrl(change.url); } catch { void this.release(id); } }
      if (change.title) grant.title = change.title.slice(0, 1000);
      this.changed();
    });
    chrome.webNavigation.onCommitted.addListener(details => {
      if (details.frameId !== 0 || !this.grants.has(details.tabId)) return;
      this.invalidate(details.tabId);
      try { sameOrigin(details.url, this.grants.get(details.tabId)!.origin); } catch { void this.release(details.tabId); }
    });
    chrome.debugger.onEvent.addListener((source, method, raw) => {
      const id = source.tabId; if (!id || !this.grants.has(id)) return;
      const p = raw as Record<string, any>;
      if (method === 'Runtime.executionContextsCleared') this.invalidate(id);
      if (method === 'Runtime.executionContextDestroyed' && this.worlds.get(id) === p.executionContextId) this.invalidate(id);
      if (method === 'Page.frameNavigated' && !p.frame?.parentId) this.invalidate(id);
      if (method === 'Runtime.exceptionThrown') this.log(id, { type: 'exception', message: safeText(p.exceptionDetails?.text || 'JavaScript exception'), time: Date.now() });
      if (method === 'Log.entryAdded' && ['error','warning'].includes(p.entry?.level)) this.log(id, { type: p.entry.level, message: safeText(p.entry.text || ''), time: Date.now() });
      if (method === 'Network.responseReceived') this.log(id, { type: 'response', url: safeUrl(p.response?.url || ''), status: p.response?.status, time: Date.now() });
      if (method === 'Network.loadingFailed') this.log(id, { type: 'network-error', message: safeText(p.errorText || ''), time: Date.now() });
    });
  }
  list() { return [...this.grants.values()]; }
  setCursorAppearance(theme: ThemePreference, appearance: ZyraAppearance) { this.cursor.setAppearance(theme, appearance); }
  private async cursorPage(id: number, command: string, frame: CursorFrame) {
    // Cleanup never attaches a debugger or creates another execution world.
    if (command === 'cursor:destroy') return this.worlds.has(id) ? this.page(id, command, frame, false) : undefined;
    const grant = this.grants.get(id), epoch = this.epochs.get(id) || 0;
    await this.require(id, 'hover');
    return this.page(id, command, frame, false, () => {
      if (!grant || this.grants.get(id) !== grant || grant.mode !== 'control' || (this.epochs.get(id) || 0) !== epoch)
        throw new BridgeError('PAGE_CHANGED', 'Cursor access ended during this action.');
    });
  }
  private log(id: number, entry: Diagnostic) { const items = this.logs.get(id) || []; items.push(entry); if (items.length > 100) items.shift(); this.logs.set(id, items); }
  private invalidate(id: number) { this.cursor.forget(id); this.worlds.delete(id); this.epochs.set(id, (this.epochs.get(id) || 0) + 1); }
  private forget(id: number) { this.cursor.forget(id); this.grants.delete(id); this.worlds.delete(id); this.logs.delete(id); this.epochs.delete(id); }
  async grant(id: number, mode: Grant['mode']) {
    const tab = await chrome.tabs.get(id), url = pageUrl(tab.url || '');
    if (tab.incognito) throw new BridgeError('INCOGNITO', 'Private browsing tabs cannot be shared.');
    if (this.grants.has(id)) { this.grants.get(id)!.mode = mode; if (mode === 'read') await this.cursor.destroy(id); this.changed(); return; }
    if (this.grants.size >= 20) throw new BridgeError('TAB_LIMIT', 'Release a tab before sharing more than twenty tabs.');
    await chrome.debugger.attach({ tabId: id }, '1.3');
    try {
      // Check again after attachment so a navigation race cannot grant a different site.
      const current = await chrome.tabs.get(id); sameOrigin(current.url || '', url.origin);
      for (const domain of ['Page','Runtime','Log','Network']) await chrome.debugger.sendCommand({ tabId: id }, `${domain}.enable`);
      this.grants.set(id, { tabId: id, origin: url.origin, url: safeUrl(current.url || ''), title: (current.title || url.hostname).slice(0, 1000), mode, grantedAt: Date.now() });
      this.changed();
    } catch (error) { await chrome.debugger.detach({ tabId: id }).catch(() => {}); throw error; }
  }
  async release(id?: number) {
    const ids = id === undefined ? [...this.grants.keys()] : [id];
    for (const tabId of ids) {
      this.grants.delete(tabId);
      await this.cursor.destroy(tabId);
      this.forget(tabId); await chrome.debugger.detach({ tabId }).catch(() => {});
    }
    this.changed(); return { released: ids };
  }
  private async require(id: number, method: Operation['method']) {
    const grant = this.grants.get(id);
    if (!grant) throw new BridgeError('TAB_NOT_GRANTED', 'Grant this tab from the extension before using it.');
    const tab = await chrome.tabs.get(id);
    if (this.grants.get(id) !== grant) throw new BridgeError('TAB_NOT_GRANTED', 'Access ended during this action.');
    try { sameOrigin(tab.url || '', grant.origin); } catch (error) { await this.release(id); throw error; }
    if (!readMethods.has(method) && grant.mode !== 'control') throw new BridgeError('READ_ONLY', 'This tab has read-only access. Change its access mode in the extension.');
    return grant;
  }
  private async cdp(id: number, method: string, params: object = {}) {
    const started = Date.now();
    this.log(id, { type: 'command-start', message: method, time: started });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        chrome.debugger.sendCommand({ tabId: id }, method, params),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new BridgeError('CHROME_TIMEOUT', `Chrome did not answer ${method} within 8000ms. Inspect the page before retrying.`)), 8000); }),
      ]);
      this.log(id, { type: 'command-complete', message: `${method} (${Date.now() - started}ms)`, time: Date.now() });
      return result as any;
    } catch (error) {
      this.log(id, { type: 'command-error', message: `${method}: ${safeText(String(error))}`, time: Date.now() });
      throw error;
    } finally { clearTimeout(timer); }
  }
  private async page(id: number, command: string, args: object = {}, retry = true, validate?: () => void): Promise<any> {
    let world = this.worlds.get(id);
    if (!world) {
      const tree = await this.cdp(id, 'Page.getFrameTree');
      world = (await this.cdp(id, 'Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'zyra-browser-v1' })).executionContextId as number;
      this.worlds.set(id, world);
    }
    let response;
    try {
      validate?.();
      const task = command.startsWith('cursor:') ? cursorPageTask : pageTask;
      response = await this.cdp(id, 'Runtime.evaluate', { expression: `(${task.toString()})(${JSON.stringify(command)},${JSON.stringify(args)})`, contextId: world, returnByValue: true, awaitPromise: false, timeout: 5000 });
    } catch (error) {
      if (/Cannot find context|Execution context was destroyed/.test(String(error))) {
        this.worlds.delete(id);
        // Observations can be retried after a document swap. Input is never replayed.
        if (retry && ['snapshot','text'].includes(command)) { await this.require(id, 'snapshot'); return this.page(id, command, args, false); }
        throw new BridgeError('PAGE_CHANGED', 'The document changed. Take a fresh snapshot before continuing.');
      }
      throw error;
    }
    if (response.exceptionDetails) {
      const message = String(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      const match = /\b([A-Z_]{3,}): ([^\n]+)/.exec(message);
      throw new BridgeError(match?.[1] || 'PAGE_ERROR', match?.[2] || message.slice(0, 500));
    }
    return response.result.value as any;
  }
  /** App-only input adapter. The desktop broker owns grants, bounds and side-effect approval. */
  async executeAppInput(id: number, action: Record<string, any>, signal: AbortSignal): Promise<void> {
    const grant = await this.require(id, action.type === 'wait' ? 'wait' : 'click');
    const epoch = this.epochs.get(id) || 0;
    const guard = async () => {
      signal.throwIfAborted();
      if (await this.require(id, action.type === 'wait' ? 'wait' : 'click') !== grant || (action.type !== 'wait' && (this.epochs.get(id) || 0) !== epoch))
        throw new BridgeError('PAGE_CHANGED', 'The page changed during input. Observe it again.');
      signal.throwIfAborted();
    };
    const pointer = async (x: number, y: number) => {
      await guard();
      await this.page(id, 'app-point', { x, y }, false);
      await guard();
    };
    const dispatchKey = async (key: string, modifiers = 0, text?: string) => {
      const codes: Record<string, number> = { Enter:13, Tab:9, Escape:27, Backspace:8, Delete:46, ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, Home:36, End:35, PageUp:33, PageDown:34, Space:32 };
      const input = { key: key === 'Space' ? ' ' : key, modifiers, windowsVirtualKeyCode: codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined), text };
      await guard();
      try { await this.cdp(id, 'Input.dispatchKeyEvent', { type:'keyDown', ...input }); }
      finally { await this.cdp(id, 'Input.dispatchKeyEvent', { type:'keyUp', ...input }).catch(() => {}); }
    };
    if (action.type === 'wait') {
      const timeout = Math.max(0, Math.min(20_000, Number(action.timeoutMs) || 0));
      if (action.condition?.type === 'delay') { await cursorDelay(Math.min(timeout, action.condition.durationMs), signal); await guard(); return; }
      const until = Date.now() + timeout;
      do { await guard(); if (await this.page(id, 'app-wait', { condition: action.condition })) return; await cursorDelay(100, signal); } while (Date.now() < until);
      throw new BridgeError('WAIT_TIMEOUT', 'The requested page condition did not appear.');
    }
    try {
      if (action.type === 'key' || action.type === 'type') {
        const point = await this.page(id, 'app-input-target', { x: action.x, y: action.y, typing: action.type === 'type' }, false);
        await this.cursor.move(id, point, signal); await guard();
        await this.page(id, 'app-input-target', { typing: action.type === 'type' }, false);
        if (action.type === 'type') {
          if (action.replace) { await dispatchKey('a', 2); await dispatchKey('Backspace'); }
          await guard(); await this.cdp(id, 'Input.insertText', { text: String(action.text).slice(0, 50_000) });
        } else {
          const mods: Record<string, number> = { alt:1, control:2, ctrl:2, meta:4, shift:8 };
          const modifiers = (action.modifiers || []).reduce((value: number, mod: string) => value | (mods[mod.toLowerCase()] || 0), 0);
          await dispatchKey(action.key, modifiers, action.key === 'Enter' ? '\r' : action.key === 'Space' ? ' ' : undefined);
        }
        return;
      }
      if (action.type === 'scroll') {
        const point = action.elementRef ? await this.page(id, 'point', { ref: action.elementRef }) : { x: action.x ?? 160, y: action.y ?? 160 };
        await pointer(point.x, point.y); await this.cursor.move(id, point, signal); await guard();
        await this.cdp(id, 'Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:action.deltaX, deltaY:action.deltaY }); return;
      }
      if (action.type === 'move' || action.type === 'click') {
        const point = action.elementRef ? await this.page(id, 'prepare-pointer', { ref:action.elementRef }) : { x:action.x, y:action.y };
        await pointer(point.x, point.y); await this.cursor.move(id, point, signal); await pointer(point.x, point.y);
        await this.cdp(id, 'Input.dispatchMouseEvent', { type:'mouseMoved', ...point });
        if (action.type === 'click') for (let count=1; count<=Math.min(2,action.clickCount || 1); count++) {
          await guard(); await this.cursor.phase(id,'pressing');
          try { await this.cdp(id,'Input.dispatchMouseEvent',{ type:'mousePressed', ...point, button:action.button || 'left', clickCount:count }); await cursorDelay(50,signal); }
          finally { await this.cdp(id,'Input.dispatchMouseEvent',{ type:'mouseReleased', ...point, button:action.button || 'left', clickCount:count }).catch(() => {}); }
        }
        return;
      }
      if (action.type === 'drag' || action.type === 'stroke') {
        // Chrome paces background-tab pointer dispatch at roughly one second per point.
        // The app may foreground it only when the grant includes window.focus.
        if (!(await chrome.tabs.get(id)).active) throw new BridgeError('TAB_NOT_ACTIVE', 'Focus this Chrome tab before drawing. Include window.focus in the Browser access request for automatic focus. No stroke was sent.');
        const points: Array<{x:number;y:number}> = action.type === 'stroke' ? action.points : Array.from({length:25},(_,i)=>({x:action.fromX+(action.toX-action.fromX)*i/24,y:action.fromY+(action.toY-action.fromY)*i/24}));
        if (!Array.isArray(points) || points.length<2 || points.length>512) throw new BridgeError('INVALID_STROKE','Provide between 2 and 512 stroke points.');
        const first=points[0]; await pointer(first.x,first.y); await this.cursor.move(id,first,signal); await guard();
        let last=first; const button=action.button || 'left';
        try {
          await this.cdp(id,'Input.dispatchMouseEvent',{type:'mousePressed',...first,button,clickCount:1});
          await this.cursor.phase(id,'dragging');
          for(const point of points.slice(1)) {
            await pointer(point.x,point.y); last=point;
            await this.cdp(id,'Input.dispatchMouseEvent',{type:'mouseMoved',...point,button,buttons:button === 'right' ? 2 : button === 'middle' ? 4 : 1});
            await this.cursor.move(id,point,signal,Math.min(40, Math.max(0, (action.durationMs || 400) / points.length)), 'dragging');
          }
        } finally { await this.cdp(id,'Input.dispatchMouseEvent',{type:'mouseReleased',...last,button,clickCount:1}).catch(() => {}); }
        return;
      }
      throw new BridgeError('UNSUPPORTED_ACTION','This browser action is unavailable.');
    } finally { await this.cursor.phase(id,'idle').catch(() => {}); }
  }
  async execute(op: Operation, signal: AbortSignal): Promise<unknown> {
    if (op.method === 'release') return this.release(op.params.tabId);
    if (op.method === 'tabs') return { tabs: this.list() };
    const id = op.params.tabId;
    const grant = await this.require(id, op.method);
    const epoch = this.epochs.get(id) || 0;
    const guard = async () => { signal.throwIfAborted(); const current = await this.require(id, op.method); signal.throwIfAborted(); if (current !== grant || (!readMethods.has(op.method) && (this.epochs.get(id) || 0) !== epoch)) throw new BridgeError('PAGE_CHANGED', 'The page navigated during this action. Take a fresh snapshot.'); };
    const target = async (command: string) => {
      const point = await this.page(id, command, op.params); await guard();
      await this.cursor.move(id, point, signal); await guard();
      // Animation gives the page time to move. Re-resolve before delivering input.
      const current = await this.page(id, command, op.params); await guard();
      if (Math.abs(current.x - point.x) > 1 || Math.abs(current.y - point.y) > 1)
        throw new BridgeError('TARGET_MOVED', 'The target moved during this action. Take a fresh snapshot.');
      return current;
    };
    const idle = async () => {
      // A successful input may navigate. Finishing its visual state must not replay or fail it.
      if (this.grants.get(id) === grant && grant.mode === 'control' && (this.epochs.get(id) || 0) === epoch)
        await this.cursor.phase(id, 'idle').catch(() => {});
    };
    await guard();
    try {
    switch (op.method) {
      case 'snapshot': { const value = await this.page(id, 'snapshot', op.params); await guard(); sameOrigin(value.url, grant.origin); value.text = safeText(value.text, 16000); return value; }
      case 'screenshot': {
        const before = (await this.cdp(id, 'Page.getFrameTree')).frameTree.frame;
        sameOrigin(before.url, grant.origin);
        const result = await this.cdp(id, 'Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: false });
        const after = (await this.cdp(id, 'Page.getFrameTree')).frameTree.frame;
        await guard(); sameOrigin(after.url, grant.origin);
        if (before.loaderId !== after.loaderId) throw new BridgeError('PAGE_CHANGED', 'The document changed while taking the screenshot. Capture it again.');
        if (result.data.length > 5_000_000) throw new BridgeError('SCREENSHOT_TOO_LARGE', 'Reduce the browser window size before taking a screenshot.');
        return { mimeType: 'image/jpeg', data: result.data };
      }
      case 'diagnostics': return { entries: this.logs.get(id) || [] };
      case 'focus': { const tab = await chrome.tabs.update(id, { active: true }); await guard(); if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }); return { focused: true }; }
      case 'navigate': sameOrigin(op.params.url, grant.origin); await this.cursor.destroy(id); await guard(); this.invalidate(id); { const result = await this.cdp(id, 'Page.navigate', { url: op.params.url }); if (result.errorText) throw new BridgeError('NAVIGATION_FAILED', result.errorText); } return { navigating: true };
      case 'reload': await this.cursor.destroy(id); await guard(); this.invalidate(id); await this.cdp(id, 'Page.reload'); return { navigating: true };
      case 'back': case 'forward': {
        const history = await this.cdp(id, 'Page.getNavigationHistory');
        const entry = history.entries[history.currentIndex + (op.method === 'back' ? -1 : 1)];
        if (!entry) throw new BridgeError('NO_HISTORY', 'No page in that direction.');
        sameOrigin(entry.url, grant.origin); await this.cursor.destroy(id); await guard(); this.invalidate(id); await this.cdp(id, 'Page.navigateToHistoryEntry', { entryId: entry.id }); return { navigating: true };
      }
      case 'wait': {
        const until = Date.now() + op.params.timeoutMs;
        while (Date.now() < until) { await guard(); const result = await this.page(id, 'text'); sameOrigin(result.url, grant.origin); if (result.text.includes(op.params.text)) return { found: true }; await new Promise(r => setTimeout(r, 150)); }
        throw new BridgeError('WAIT_TIMEOUT', 'The requested text did not appear within the timeout.');
      }
      case 'select': {
        await target('prepare-pointer'); await this.cursor.phase(id, 'pressing'); await guard();
        const result = await this.page(id, 'select', op.params); await idle(); return result;
      }
      case 'click': case 'hover': {
        const p = await target('prepare-pointer');
        await this.cdp(id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
        if (op.method === 'click') {
          for (let count = 1; count <= op.params.count; count++) {
            await this.cursor.phase(id, 'pressing'); await guard();
            try {
              await this.cdp(id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: op.params.button, clickCount: count });
              await cursorDelay(70, signal);
            } finally {
              await this.cdp(id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: op.params.button, clickCount: count });
            }
          }
        }
        await idle();
        return { completed: true };
      }
      case 'fill': case 'type': {
        await target('prepare-input'); await this.cursor.phase(id, 'typing'); await guard();
        if (op.method === 'fill') {
          await this.cdp(id, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
          await this.cdp(id, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
          await this.cdp(id, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
          await this.cdp(id, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
        }
        await guard(); await this.cdp(id, 'Input.insertText', { text: op.params.text }); await idle(); return { completed: true };
      }
      case 'press': {
        await target('prepare-key'); await this.cursor.phase(id, 'typing'); await guard();
        const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32 };
        const mods: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
        const modifiers = op.params.modifiers.reduce((sum, m) => sum | mods[m], 0);
        const key = op.params.key === 'Space' ? ' ' : op.params.key;
        await this.cdp(id, 'Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: codes[op.params.key], modifiers, text: op.params.key === 'Enter' ? '\r' : op.params.key === 'Space' ? ' ' : undefined });
        await this.cdp(id, 'Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: codes[op.params.key], modifiers }); await idle(); return { completed: true };
      }
      case 'scroll': {
        const p = op.params.ref ? await target('point') : { x: 300, y: 300 };
        if (!op.params.ref) await this.cursor.move(id, p, signal);
        await this.cursor.phase(id, 'scrolling'); await guard();
        await this.cdp(id, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: op.params.x, deltaY: op.params.y }); await idle(); return { completed: true };
      }
    }
    } catch (error) {
      if (!readMethods.has(op.method)) await this.cursor.destroy(id);
      throw error;
    }
  }
}
