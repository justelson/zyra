const LIMIT = 86_400_000;
const MODELS = new Set(['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5']);
const EFFORTS = new Set(['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const ms = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(LIMIT, value))) : null;
const modelName = value => { const name = String(value || '').split('/').at(-1); return MODELS.has(name) ? name : 'other'; };
const effortName = value => EFFORTS.has(value) ? value : 'unknown';
const fields = ['mainReceivedMs', 'dispatchMs', 'acceptedMs', 'firstEventMs', 'firstTextMs', 'firstTextReceivedMs', 'firstDisplayMs', 'completedMs',
  'requestCount', 'retryCount', 'compactionCount', 'compactionMs', 'maxStreamingGapMs', 'stallCount', 'mainStallMs', 'rendererStallMs', 'maxStallMs'];

/** Shared stage names with Desktop. Provider stages use only the host clock;
 * receipt and display use only the client's monotonic clock. Never subtract
 * a phone timestamp from a PC timestamp. No transcript content is retained. */
export class ClientResponseTiming {
  constructor({ now = () => performance.timeOrigin + performance.now(), changed = () => {}, capture = () => {}, displayKind = 'terminal-write' } = {}) {
    this.now = now; this.changed = changed; this.capture = capture; this.displayKind = displayKind;
    this.records = new Map(); this.active = new Map(); this.timers = new Map();
  }
  start(turnId, model, effort) {
    if (typeof turnId !== 'string' || !/^[a-z0-9:._-]{1,256}$/i.test(turnId) || this.records.has(turnId)) return;
    const row = { turnId, startedAt: this.now(), model: modelName(model), effort: effortName(effort), outcome: 'running',
      ...Object.fromEntries(fields.map(key => [key, ['requestCount', 'retryCount', 'compactionCount', 'mainReceivedMs', 'compactionMs'].includes(key) ? 0 : null])),
      providerTimingOrigin: 'host-acceptance', displayKind: this.displayKind, requests: [] };
    this.records.set(turnId, row); this.active.set(turnId, { row, retries: new Set(), requestId: null, hostAnchor: null });
    if (this.active.size > 64) this.finish(this.active.keys().next().value, 'unfinished');
    this.trim(); this.changed(true);
  }
  dispatch(turnId) { const state = this.active.get(turnId); if (state) { state.row.dispatchMs ??= ms(this.now() - state.row.startedAt); this.changed(true); } }
  observe(turnId, event, replay = false) {
    const state = this.active.get(turnId); if (!state || replay || !event) return;
    const row = state.row, elapsed = ms(this.now() - row.startedAt), hadText = row.firstTextReceivedMs !== null;
    if (event.type === 'zyra_server_prompt_accepted') { row.acceptedMs ??= elapsed; state.hostAnchor ??= Number.isFinite(event.timingStartedAt) ? event.timingStartedAt : null; }
    if (event.type === 'model_request_progress') {
      const p = event.progress;
      if (p && typeof p.requestId === 'string') {
        if (state.requestId !== p.requestId) {
          state.requestId = p.requestId; row.requestCount++;
          row.requests.push({ startedMs: state.hostAnchor === null ? null : ms(p.startedAt - state.hostAnchor), firstEventMs: null, firstTextMs: null, lastEventMs: null, durationMs: null, maxGapMs: null });
          if (row.requests.length > 32) row.requests.shift();
        }
        const request = row.requests.at(-1);
        if (typeof p.firstEventAt === 'number') { request.firstEventMs ??= ms(p.firstEventAt - p.startedAt); if (state.hostAnchor !== null) row.firstEventMs ??= ms(p.firstEventAt - state.hostAnchor); }
        if (typeof p.firstTextAt === 'number') { request.firstTextMs ??= ms(p.firstTextAt - p.startedAt); if (state.hostAnchor !== null) row.firstTextMs ??= ms(p.firstTextAt - state.hostAnchor); }
        request.lastEventMs = typeof p.lastActivityAt === 'number' ? ms(p.lastActivityAt - p.startedAt) : request.lastEventMs;
        if (Number.isFinite(p.maxActivityGapMs)) { request.maxGapMs = ms(p.maxActivityGapMs); row.maxStreamingGapMs = Math.max(row.maxStreamingGapMs || 0, request.maxGapMs || 0); }
        if (p.phase === 'completed') request.durationMs = request.lastEventMs;
      } else state.requestId = null;
    }
    const message = event.message;
    const text = typeof message?.content === 'string' ? message.content : message?.content?.some?.(part => part?.type === 'text' && part.text);
    const delta = event.assistantMessageEvent;
    if ((message?.role === 'assistant' && text && ['message_start', 'message_update', 'message_end'].includes(event.type))
      || event.type === 'text_delta' && event.delta || delta?.type === 'text_delta' && delta.delta) row.firstTextReceivedMs ??= elapsed;
    if (event.type === 'compaction_start' && state.compactionAt == null) { state.compactionAt = this.now(); row.compactionCount++; }
    if (event.type === 'compaction_end' && state.compactionAt != null) { row.compactionMs += ms(this.now() - state.compactionAt); state.compactionAt = null; }
    if (event.type === 'auto_retry_start' && !event.transportOnly) {
      const key = `${event.recoveryKind}:${event.attempt}`;
      if (!state.retries.has(key)) { state.retries.add(key); row.retryCount++; }
    }
    if (event.type === 'zyra_server_turn_completed') return this.finish(turnId, event.outcome === 'interrupted' ? 'cancelled' : event.outcome === 'failed' ? 'failed' : 'completed');
    this.changed(!hadText && row.firstTextReceivedMs !== null || event.type === 'zyra_server_prompt_accepted');
  }
  displayed(turnId) {
    const row = this.records.get(turnId);
    if (!row || row.firstTextReceivedMs === null || row.firstDisplayMs !== null) return false;
    row.firstDisplayMs = ms(this.now() - row.startedAt); this.changed(true); return true;
  }
  reconcile(presence) {
    const turn = presence?.latestTurn;
    if (turn?.id && ['completed', 'error', 'failed', 'interrupted'].includes(turn.state) && this.active.has(turn.id)) {
      this.finish(turn.id, turn.state === 'interrupted' ? 'cancelled' : turn.state === 'error' ? 'failed' : turn.state, false);
    }
  }
  finish(turnId, outcome, observed = true) {
    const state = this.active.get(turnId); if (!state) return;
    state.row.outcome = ['completed', 'cancelled', 'failed'].includes(outcome) ? outcome : 'unfinished';
    state.row.completedMs = observed ? ms(this.now() - state.row.startedAt) : null;
    if (state.compactionAt != null) state.row.compactionMs += ms(this.now() - state.compactionAt);
    this.active.delete(turnId); this.changed(true);
    const timer = setTimeout(() => { this.timers.delete(turnId); try { this.capture(this.summary(state.row)); } catch {} }, 1500);
    timer.unref?.(); this.timers.set(turnId, timer); this.trim();
  }
  summary(row) {
    const names = { mainReceivedMs: 'main_received_ms', dispatchMs: 'dispatch_ms', acceptedMs: 'accepted_ms', firstEventMs: 'first_event_ms', firstTextMs: 'first_text_ms', firstTextReceivedMs: 'first_text_received_ms', firstDisplayMs: 'first_display_ms', completedMs: 'duration_ms', requestCount: 'request_count', retryCount: 'retry_count', compactionCount: 'compaction_count', compactionMs: 'compaction_ms', maxStreamingGapMs: 'max_streaming_gap_ms' };
    return { model_name: row.model, effort: row.effort, outcome: row.outcome, ...Object.fromEntries(Object.entries(names).filter(([key]) => row[key] !== null).map(([key, name]) => [name, row[key]])) };
  }
  trim() { const keep = new Set([...this.active.keys(), ...[...this.records.values()].filter(row => !this.active.has(row.turnId)).sort((a, b) => b.startedAt - a.startedAt).slice(0, 200 - this.active.size).map(row => row.turnId)]); for (const key of this.records.keys()) if (!keep.has(key)) this.records.delete(key); }
  read() { return structuredClone([...this.records.values()].sort((a, b) => b.startedAt - a.startedAt)); }
  restore(rows) {
    if (!Array.isArray(rows)) return;
    for (const input of rows.slice(0, 200)) {
      if (!input || typeof input.turnId !== 'string' || !/^[a-z0-9:._-]{1,256}$/i.test(input.turnId) || !Number.isFinite(input.startedAt) || this.records.has(input.turnId)) continue;
      const row = { turnId: input.turnId, startedAt: input.startedAt, model: modelName(input.model), effort: effortName(input.effort), outcome: ['completed', 'failed', 'cancelled'].includes(input.outcome) ? input.outcome : 'unfinished',
        ...Object.fromEntries(fields.map(key => [key, ms(input[key])])), providerTimingOrigin: 'host-acceptance', displayKind: this.displayKind,
        requests: Array.isArray(input.requests) ? input.requests.slice(-32).filter(value => value && typeof value === 'object').map(value => Object.fromEntries(['startedMs', 'firstEventMs', 'firstTextMs', 'lastEventMs', 'durationMs', 'maxGapMs'].map(key => [key, ms(value[key])]))) : [] };
      this.records.set(row.turnId, row);
    }
    this.trim();
  }
  dispose() { for (const [id, timer] of this.timers) { clearTimeout(timer); try { this.capture(this.summary(this.records.get(id))); } catch {} } this.timers.clear(); }
}
