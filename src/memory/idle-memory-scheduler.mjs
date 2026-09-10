/** One idle job per session; foreground activity cancels pending and active work. */
export function createIdleMemoryScheduler({ run, idleMs = 60_000, cooldownMs = 15 * 60_000, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, onError = () => {} }) {
  let timer, active, disposed = false, idleRequested = false, lastRun = -Infinity;
  function busy() { idleRequested = false; if (timer) clearTimer(timer); timer = undefined; active?.abort(); }
  function idle() {
    if (disposed || timer) return;
    if (active) { idleRequested = true; return; }
    idleRequested = false;
    timer = setTimer(async () => {
      timer = undefined;
      if (disposed) return;
      const controller = new AbortController();
      active = controller;
      lastRun = now();
      try { await run(controller.signal); } catch (error) { if (!controller.signal.aborted) onError(error); }
      finally { if (active === controller) active = undefined; if (idleRequested) idle(); }
    }, Math.max(idleMs, cooldownMs - (now() - lastRun)));
    timer?.unref?.();
  }
  return { busy, idle, dispose() { disposed = true; busy(); } };
}
