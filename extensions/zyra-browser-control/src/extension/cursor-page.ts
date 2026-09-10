export type CursorAppearance = {
  light: { primary: string; secondary: string };
  dark: { primary: string; secondary: string };
  reduceMotion: boolean;
};
export type CursorPoint = { x: number; y: number };
export type CursorFrame = Partial<CursorPoint> & {
  from?: CursorPoint;
  durationMs?: number;
  phase?: 'moving' | 'pressing' | 'typing' | 'scrolling' | 'dragging' | 'idle';
  appearance?: CursorAppearance;
};

/** Bundled local code, executed only in the granted tab's isolated world. */
export function cursorPageTask(command: string, frame: CursorFrame): unknown {
  type State = {
    host: HTMLDivElement; pointer: HTMLDivElement; visual: HTMLDivElement;
    appearance: CursorAppearance; timer?: ReturnType<typeof setTimeout>;
    dispose: () => void; applyAppearance: () => void;
  };
  const scope = globalThis as typeof globalThis & { __zyraCursor?: State };
  if (command === 'cursor:destroy') { scope.__zyraCursor?.dispose(); return { removed: true }; }
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let state = scope.__zyraCursor;
  if (state && !state.host.isConnected) { state.dispose(); state = undefined; }
  // Theme updates must never create a cursor or extend its lifetime.
  if (command === 'cursor:appearance') {
    if (state && frame.appearance) { state.appearance = frame.appearance; state.applyAppearance(); }
    return { updated: !!state };
  }
  if (!state) {
    if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y) || !frame.appearance) return { durationMs: 0 };
    const host = document.createElement('div');
    host.dataset.zyraBrowserCursor = '';
    host.setAttribute('aria-hidden', 'true');
    const styles: Record<string, string> = {
      all: 'initial', position: 'fixed', inset: '0', width: '100%', height: '100%',
      margin: '0', padding: '0', border: '0', background: 'transparent',
      'pointer-events': 'none', 'z-index': '2147483647', overflow: 'hidden',
      transform: 'none', filter: 'none', opacity: '1', visibility: 'visible', display: 'block',
      'contain': 'strict', 'isolation': 'isolate', 'color-scheme': 'normal'
    };
    for (const [key, value] of Object.entries(styles)) host.style.setProperty(key, value, 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    // Exact pointer silhouette and visual treatment from Zyra's Browser/Windows cursor.
    style.textContent = `
      :host{pointer-events:none!important}*{box-sizing:border-box;pointer-events:none!important}
      .cursor{position:absolute;left:0;top:0;will-change:transform;transition-property:transform;transition-timing-function:cubic-bezier(.2,.7,.2,1)}
      .visual{position:absolute;left:0;top:0;transform-origin:4px 4px;transition:transform 100ms cubic-bezier(.2,.7,.2,1)}
      .cursor[data-phase="pressing"] .visual{transform:scale(.92)}
      .cursor[data-phase="dragging"] .visual{transform:scale(1.03)}
      svg{position:absolute;left:-4px;top:-4px;width:24px;height:24px;color:var(--zyra-cursor-secondary);filter:drop-shadow(0 1px 2px rgb(0 0 0/.72)) drop-shadow(0 0 5px color-mix(in srgb,var(--zyra-cursor-primary) 38%,transparent))}
      :host([data-reduce-motion="true"]) .cursor,:host([data-reduce-motion="true"]) .visual{transition:none!important}
      @media(prefers-reduced-motion:reduce){.cursor,.visual{transition:none!important}}
    `;
    const pointer = document.createElement('div'); pointer.className = 'cursor';
    const visual = document.createElement('div'); visual.className = 'visual';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width:'24',height:'24',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round' })) svg.setAttribute(key,value);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z');
    svg.append(path); visual.append(svg); pointer.append(visual); shadow.append(style, pointer);
    const events = new AbortController();
    const created: State = {
      host, pointer, visual, appearance: frame.appearance,
      dispose: () => { clearTimeout(created.timer); events.abort(); host.remove(); if (scope.__zyraCursor === created) delete scope.__zyraCursor; },
      applyAppearance: () => {
        const colors = dark.matches ? created.appearance.dark : created.appearance.light;
        host.style.setProperty('--zyra-cursor-primary', colors.primary);
        host.style.setProperty('--zyra-cursor-secondary', colors.secondary);
        host.dataset.reduceMotion = String(created.appearance.reduceMotion || motion.matches);
      }
    };
    dark.addEventListener('change', created.applyAppearance, { signal: events.signal });
    motion.addEventListener('change', created.applyAppearance, { signal: events.signal });
    window.addEventListener('pagehide', created.dispose, { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) created.dispose(); }, { signal: events.signal });
    scope.__zyraCursor = state = created;
    document.documentElement.append(host);
    const from = frame.from || { x: frame.x!, y: frame.y! };
    pointer.style.transform = `translate3d(${from.x}px,${from.y}px,0)`;
    created.applyAppearance();
    // Commit the starting position before changing the transition target.
    pointer.getBoundingClientRect();
  }
  if (frame.appearance) state.appearance = frame.appearance;
  state.applyAppearance();
  const durationMs = state.host.dataset.reduceMotion === 'true' ? 0 : Math.max(0, Math.min(320, frame.durationMs || 0));
  if (Number.isFinite(frame.x) && Number.isFinite(frame.y)) {
    state.pointer.style.transitionDuration = `${durationMs}ms`;
    state.pointer.style.transform = `translate3d(${frame.x}px,${frame.y}px,0)`;
  }
  state.pointer.dataset.phase = frame.phase || 'idle';
  clearTimeout(state.timer);
  // A detached debugger cannot send cleanup. A bounded in-page lease removes orphaned overlays.
  state.timer = setTimeout(state.dispose, 2500);
  return { durationMs };
}
