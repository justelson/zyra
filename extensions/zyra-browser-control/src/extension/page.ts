/** Runs entirely inside an isolated world in the granted tab. No module dependencies. */
export function pageTask(command: string, args: Record<string, unknown>): unknown {
  type Stored = { element: Element; label: string; tag: string; identity: string };
  type PageState = { revision: string; refs: Map<string, Stored> };
  const scope = globalThis as typeof globalThis & { __zyraBrowser?: PageState };
  const fail = (code: string, message: string): never => { throw new Error(`${code}: ${message}`); };
  const label = (el: Element): string => {
    const e = el as HTMLInputElement;
    const ids = el.getAttribute('aria-labelledby');
    return (el.getAttribute('aria-label') || (ids && ids.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ')) || el.getAttribute('alt') || (e.labels?.length ? [...e.labels].map(l => l.textContent).join(' ') : '') || el.getAttribute('title') || (el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  };
  const sensitive = (el: Element) => /password|file/i.test((el as HTMLInputElement).type || '') || /password|passcode|secret|token|credential|cc-number|cc-csc|one-time-code|credit.?card|\bcvv\b|\botp\b/i.test(`${el.getAttribute('autocomplete')} ${el.id} ${el.getAttribute('name')} ${label(el)}`);
  const identity = (el: Element) => ['href','type','role','formaction'].map(a => el.getAttribute(a) || '').join('|');
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect(), s = el.ownerDocument.defaultView!.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && !el.closest('[inert],[aria-hidden="true"]');
  };
  const role = (e: Element) => e.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: (e as HTMLInputElement).type === 'checkbox' ? 'checkbox' : (e as HTMLInputElement).type === 'radio' ? 'radio' : 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', IMG: 'image', IFRAME: 'iframe', SUMMARY: 'button' } as Record<string, string>)[e.tagName] || 'generic';
  const point = (el: Element) => {
    const r = el.getBoundingClientRect(); let x = r.x + r.width / 2, y = r.y + r.height / 2;
    let win = el.ownerDocument.defaultView;
    while (win && win !== window) {
      const frame = win.frameElement; if (!frame) break;
      const f = frame.getBoundingClientRect(); x += f.x + (frame as HTMLElement).clientLeft; y += f.y + (frame as HTMLElement).clientTop; win = frame.ownerDocument.defaultView;
    }
    return { x, y };
  };
  if (command === 'app-point' || command === 'app-input-target') {
    const coordinate = Number.isFinite(args.x) && Number.isFinite(args.y);
    const x = Number(args.x), y = Number(args.y);
    if (coordinate && (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)) return fail('OUT_OF_BOUNDS', 'The point is outside the observed page.');
    let el = coordinate ? document.elementFromPoint(x, y) : document.activeElement;
    if (!el) return fail('NO_TARGET', 'There is no target at this point.');
    while (el.shadowRoot?.elementFromPoint(x, y)) el = el.shadowRoot.elementFromPoint(x, y)!;
    if (el.tagName === 'IFRAME') return fail('FRAME_TARGET', 'Use an observed element reference to interact inside a frame.');
    if (sensitive(el) || el.closest('input[type="password"],input[type="file"]')) return fail('SENSITIVE', 'Sensitive fields are protected.');
    if (el.closest('[inert],[aria-hidden="true"]')) return fail('NOT_VISIBLE', 'This target is unavailable.');
    if (command === 'app-input-target' && args.typing) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)) return fail('WRONG_ELEMENT', 'Choose an editable field before typing.');
      if (coordinate) (el as HTMLElement).focus();
      if (el !== document.activeElement) return fail('FOCUS_CHANGED', 'The input lost focus. Observe the page again.');
    }
    return coordinate ? { x, y } : point(el);
  }
  if (command === 'app-wait') {
    const condition = args.condition as Record<string, any>;
    if (condition.type === 'target-ready') return document.readyState === 'complete';
    if (condition.type === 'url-changed') return location.href !== condition.from;
    if (condition.type === 'element-absent') return !scope.__zyraBrowser?.refs.get(condition.elementRef)?.element.isConnected;
    if (condition.type === 'element-present') return [...document.querySelectorAll('*')].some(el => visible(el) && (!condition.role || role(el) === condition.role) && (!condition.name || label(el).includes(condition.name)));
    return false;
  }
  if (command === 'snapshot') {
    const state: PageState = { revision: crypto.randomUUID(), refs: new Map() }; scope.__zyraBrowser = state;
    const nodes: unknown[] = []; let count = 0; let frameCount = 0; const max = Number(args.maxElements || 400);
    const walk = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
        if (el.tagName === 'IFRAME') { try { const doc = (el as HTMLIFrameElement).contentDocument; if (doc) { frameCount++; walk(doc); } } catch {} }
        if (!el.matches('a,button,input,textarea,select,summary,[contenteditable="true"],[role],[tabindex],h1,h2,h3,h4,img,iframe') || !visible(el)) continue;
        count++; if (nodes.length >= max) continue;
        const name = label(el), id = `${state.revision}:${nodes.length + 1}`, e = el as HTMLInputElement;
        state.refs.set(id, { element: el, label: name, tag: el.tagName, identity: identity(el) });
        const r = el.getBoundingClientRect();
        nodes.push({ ref: id, role: role(el), name, sensitive: sensitive(el), value: sensitive(el) ? undefined : typeof e.value === 'string' ? e.value.slice(0, 2000) : undefined,
          bounds: { x: point(el).x - r.width / 2, y: point(el).y - r.height / 2, width: r.width, height: r.height }, focused: el.ownerDocument.activeElement === el,
          disabled: !!e.disabled || el.getAttribute('aria-disabled') === 'true', checked: e.checked, expanded: el.getAttribute('aria-expanded'),
          inViewport: r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0,
          options: el.tagName === 'SELECT' ? [...(el as HTMLSelectElement).options].slice(0, 100).map(o => ({ value: o.value, label: o.label, selected: o.selected })) : undefined });
      }
    };
    walk(document);
    return { title: document.title, url: location.origin + location.pathname, revision: state.revision, text: document.body.innerText.slice(0, 16000), elements: nodes, totalElements: count, truncated: count > nodes.length, sameOriginFrames: frameCount, viewport: { width: innerWidth, height: innerHeight } };
  }
  if (command === 'text') return { text: document.body.innerText.slice(0, 100000), url: location.origin + location.pathname };
  const state = scope.__zyraBrowser;
  const stored = state?.refs.get(String(args.ref));
  if (!stored) return fail('STALE_REF', 'Take a new snapshot before interacting with this element.');
  const el = stored.element as HTMLElement;
  if (!el.isConnected || el.tagName !== stored.tag || label(el) !== stored.label || identity(el) !== stored.identity) return fail('STALE_REF', 'The element changed after the snapshot. Take a fresh snapshot.');
  if (!visible(el)) return fail('NOT_VISIBLE', 'The element is not visible.');
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return fail('DISABLED', 'The element is disabled.');
  if (command === 'select') {
    if (el.tagName !== 'SELECT') return fail('WRONG_ELEMENT', 'Select requires a native select element.');
    const select = el as HTMLSelectElement, values = args.values as string[];
    if (values.some(v => ![...select.options].some(o => o.value === v))) return fail('INVALID_OPTION', 'One of the requested options does not exist.');
    if (!select.multiple && values.length !== 1) return fail('INVALID_OPTION', 'This select only accepts one value.');
    for (const option of select.options) option.selected = values.includes(option.value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: values };
  }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const p = point(el);
  if (command === 'prepare-input') {
    if (sensitive(el)) return fail('SENSITIVE_FIELD', 'Enter credentials and payment details yourself.');
    if (!(el.matches('input,textarea,[contenteditable="true"]'))) return fail('NOT_EDITABLE', 'This element is not an editable field.');
    if ((el as HTMLInputElement).readOnly) return fail('READ_ONLY_FIELD', 'This field is read-only.');
    el.focus();
    return { ...p, editable: true };
  }
  if (command === 'prepare-key') { if (sensitive(el)) return fail('SENSITIVE_FIELD', 'Keyboard input is unavailable on this field.'); el.focus(); return p; }
  if (command === 'prepare-pointer') {
    const r = el.getBoundingClientRect(); const hit = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const root = el.getRootNode();
    const shadowHit = root instanceof ShadowRoot ? root.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    if (hit && hit !== el && !el.contains(hit) && shadowHit !== el && !el.contains(shadowHit)) return fail('OBSCURED', 'Another element covers this target.');
    let win = el.ownerDocument.defaultView;
    let frameX = r.x + r.width / 2, frameY = r.y + r.height / 2;
    while (win && win !== window) {
      const frame = win.frameElement as HTMLElement | null; if (!frame) break;
      const parent = frame.ownerDocument;
      const frameRect = frame.getBoundingClientRect();
      frameX += frameRect.x + frame.clientLeft; frameY += frameRect.y + frame.clientTop;
      const covering = parent.elementFromPoint(frameX, frameY);
      if (covering && covering !== frame && !frame.contains(covering)) return fail('OBSCURED', 'Another element covers the embedded frame.');
      win = parent.defaultView;
    }
    return p;
  }
  return p;
}
