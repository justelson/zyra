import { randomBytes } from 'node:crypto';
import { requestV2 } from './harness-v2-client.mjs';
import { currentV2Messages } from './harness-v2-turn.mjs';
import { subscribeHarnessEvents } from './harness-events.mjs';
import { harnessImageFiles, harnessToolContext, harnessToolResults } from './harness-tool-context.mjs';
import { HarnessToolOutput } from './harness-tool-output.mjs';

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

/** Native tools pause here. Zyra executes their ordinary tool calls exactly once. */
export class HarnessToolConversation {
  constructor({ pollMs = 250, idleMs = 5 * 60_000, timeoutMs = 11 * 60_000 } = {}) {
    Object.assign(this, { pollMs, idleMs, timeoutMs });
    this.record = null;
    this.busy = false;
    this.disposed = false;
  }

  async rpc(record, method, input = {}, signal, timeoutMs = 10_000) {
    const response = await requestV2(record.client, `/rpc/zyra.tools/${method}`, { method: 'POST', signal, timeoutMs,
      body: { input: { sessionID: record.id, token: record.token, ...input } } });
    return response?.output;
  }

  async step({ client, modelId, variant, context, signal, onProgress, onDelta, onMetric }) {
    if (this.busy || this.disposed) throw new Error('OpenCode tool conversation is unavailable.');
    this.busy = true; clearTimeout(this.timer);
    const started = performance.now();
    let events, wake, dirty = false, finished = false, firstText = false;
    const metric = (phase, extra = {}) => { try { onMetric?.({ phase, elapsedMs: Math.round(performance.now() - started), ...extra }); } catch {} };
    const identity = JSON.stringify([client.baseUrl, client.password, client.cwd, modelId, variant]);
    try {
      signal?.throwIfAborted();
      if (this.record?.identity !== identity) await this.clear();
      const binding = harnessToolContext(context);
      if (!this.record) {
        const slash = modelId.indexOf('/');
        if (slash < 1) throw new Error('OpenCode requires a provider/model address.');
        const model = { providerID: modelId.slice(0, slash), id: modelId.slice(slash + 1), ...(variant ? { variant } : {}) };
        const created = await requestV2(client, '/session', { method: 'POST', signal,
          body: { title: 'Zyra conversation', agent: 'zyra-managed', model, location: { directory: client.cwd } } });
        if (!created?.data?.id) throw new Error('OpenCode did not create the tool conversation.');
        this.record = { id: created.data.id, client, identity, token: randomBytes(32).toString('hex'), pending: [], offsets: new Map(), usageByMessage: new Map(), images: new Set(), active: false };
        metric('native-session', { reused: false, replayedMessages: 0 });
      } else metric('native-session', { reused: true, replayedMessages: 0 });
      const record = this.record;
      const output = new HarnessToolOutput(record.offsets, parts => {
        if (!firstText && parts.some(part => part.type === 'text' && part.text)) { firstText = true; metric('first-text'); }
        onProgress?.(parts);
      }, onDelta && ((type, delta) => {
        if (!firstText && type === 'text' && delta) { firstText = true; metric('first-text'); }
        onDelta(type, delta);
      }));
      // Bind the exact current schemas and canonical history before releasing
      // suspended calls. Dynamically discovered tools appear on the next request.
      const bound = await this.rpc(record, 'bind', binding, signal);
      if (bound?.bound !== true) throw new Error('OpenCode did not acknowledge the Zyra tool binding.');
      const base = `/session/${encodeURIComponent(record.id)}`;
      const permissionKey = binding.tools.map(tool => tool.name).sort().join('\0');
      if (permissionKey !== record.permissionKey) {
        await requestV2(client, base, { method: 'PATCH', signal, body: { permissions: [
          { action: '*', resource: '*', effect: 'deny' },
          ...binding.tools.map(tool => ({ action: tool.name, resource: '*', effect: 'allow' })),
        ] } });
        record.permissionKey = permissionKey;
      }
      const images = harnessImageFiles(context, record.images);
      const userCount = context.messages.filter(message => message.role === 'user').length;
      let delivered = record.active;
      events = subscribeHarnessEvents(client, { fetchImpl: client.fetch ?? fetch, signal, onDisconnect: () => output.disconnected(), onEvent: event => {
        if (event.data?.sessionID !== record.id || finished) return;
        if (event.type === 'session.inbox.delivered' && event.data.inboxID === record.inputId) delivered = true;
        if ((delivered && output.delta(event)) || ['rpc.zyra.tools.ready', 'session.tool.started', 'session.step.ended', 'session.step.failed'].includes(event.type)) {
          dirty = true; wake?.();
        }
      } });
      if (record.pending.length) {
        if (userCount > record.userCount || images.files.length) {
          // Steering joins the existing native execution before its next model
          // step; the request hook retains the exact canonical user message.
          const id = `msg_${randomBytes(16).toString('hex')}`;
          const admitted = await requestV2(client, `${base}/prompt`, { method: 'POST', signal,
            body: { id, text: 'Apply the latest Zyra steering.', delivery: 'steer', files: images.files } });
          if (admitted?.data?.id !== id) throw new Error('OpenCode did not acknowledge the steering input.');
        }
        const results = harnessToolResults(context, record.pending);
        const deliveredResults = await this.rpc(record, 'results', { results }, signal);
        if (deliveredResults?.delivered !== true) throw new Error('OpenCode did not acknowledge the Zyra tool results.');
        record.pending = [];
      } else if (!record.active) {
        record.inputId = `msg_${randomBytes(16).toString('hex')}`;
        record.admittedAt = Date.now();
        record.boundaryId = null; record.usageByMessage.clear(); record.offsets.clear();
        // The request hook supplies structured canonical messages, including the
        // unchanged user prompt. This text is only native inbox attribution.
        const admitted = await requestV2(client, `${base}/prompt`, { method: 'POST', signal,
          body: { id: record.inputId, text: 'Continue the current Zyra request.', files: images.files } });
        if (admitted?.data?.id !== record.inputId) throw new Error('OpenCode did not acknowledge the requested input.');
        record.active = true;
      }
      record.userCount = userCount;
      record.images = images.keys;
      let failures = 0;
      for (;;) {
        signal?.throwIfAborted();
        if (performance.now() - started > this.timeoutMs) throw new Error('OpenCode model response exceeded its time limit. The completed Zyra tools were retained.');
        let snapshot, mailbox, status;
        try {
          // These reads are observational and safe to retry. Never resubmit a prompt.
          [snapshot, mailbox, status] = await Promise.all([
            currentV2Messages(client, record.id, record.inputId, { signal, fetchImpl: client.fetch ?? fetch, timeoutMs: 10_000, includeBoundaryId: record.boundaryId }),
            this.rpc(record, 'poll', {}, signal),
            requestV2(client, base, { signal, timeoutMs: 10_000 }),
          ]);
          failures = 0;
        } catch (error) {
          if (signal?.aborted || ++failures >= 3) throw error;
          await this.delay(signal); continue;
        }
        const assistants = snapshot.found ? snapshot.messages.filter(message => message.type === 'assistant') : [];
        const session = status?.data;
        const idleAt = typeof session?.time?.idle === 'number' ? session.time.idle : Date.parse(session?.time?.idle ?? '');
        if (['failed', 'interrupted'].includes(session?.outcome) && idleAt >= record.admittedAt) {
          throw new Error(assistants.find(message => message.error)?.error?.message || `The native OpenCode request ${session.outcome}. Check the provider connection.`);
        }
        const content = output.snapshot(assistants);
        for (const message of assistants) record.usageByMessage.set(message.id, message.tokens ?? {});
        if (!Array.isArray(mailbox?.calls)) throw new Error('OpenCode returned an invalid Zyra tool mailbox.');
        const calls = mailbox.calls;
        const last = assistants.at(-1);
        if (calls.length || last?.time?.completed && (last.error || ['stop', 'length'].includes(last.finish))) {
          output.commit();
          if (calls.length) {
            for (const call of calls) {
              if (!binding.tools.some(tool => tool.name === call.name)) throw new Error('OpenCode requested a tool outside this chat.');
              content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments });
            }
            record.pending = calls;
            record.boundaryId = last?.id;
            metric('tool-boundary', { toolCount: calls.length });
            return { content, stopReason: 'toolUse', usage: emptyUsage() };
          }
          const error = assistants.find(message => message.error)?.error;
          if (error) throw new Error(error.message || 'OpenCode generation failed.');
          record.active = false;
          const usage = emptyUsage();
          for (const tokens of record.usageByMessage.values()) {
            usage.input += tokens.input ?? 0; usage.output += tokens.output ?? 0;
            usage.cacheRead += tokens.cache?.read ?? 0; usage.cacheWrite += tokens.cache?.write ?? 0;
          }
          usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
          this.timer = setTimeout(() => { void this.clear(); }, this.idleMs); this.timer.unref?.();
          return { content, stopReason: assistants.at(-1)?.finish === 'length' ? 'length' : 'stop', usage };
        }
        if (dirty) { dirty = false; await this.delay(signal, 25); continue; }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(done, events.connected ? Math.max(1000, this.pollMs) : this.pollMs);
          const aborted = () => { cleanup(); reject(signal.reason); };
          function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', aborted); wake = null; }
          function done() { cleanup(); resolve(); }
          wake = done;
          signal?.addEventListener('abort', aborted, { once: true });
          if (signal?.aborted) aborted();
        });
      }
    } catch (error) {
      await this.clear();
      if (signal?.aborted) throw error;
      // Do not classify a failed observation as a fresh, retryable user turn.
      throw Object.assign(new Error(`OpenCode response interrupted; completed tools were kept. ${error?.message ?? error}`), { retryable: false });
    } finally { finished = true; events?.close(); wake?.(); this.busy = false; metric('finished'); }
  }

  async delay(signal, duration = this.pollMs) {
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
      const timer = setTimeout(done, duration);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }

  async clear() {
    clearTimeout(this.timer);
    const record = this.record; this.record = null;
    if (!record) return;
    const base = `/session/${encodeURIComponent(record.id)}`;
    const signal = AbortSignal.timeout(2000);
    // Revoke native permissions before removing proxy definitions. Even if an
    // interrupt fails, unbinding must never reveal an allowed native file tool.
    const [revoked, interrupted] = await Promise.allSettled([
      requestV2(record.client, base, { method: 'PATCH', signal, body: { permissions: [{ action: '*', resource: '*', effect: 'deny' }] } }),
      record.active ? requestV2(record.client, `${base}/interrupt`, { method: 'POST', signal }) : Promise.resolve(),
    ]);
    await Promise.allSettled([
      ...(revoked.status === 'fulfilled' || interrupted.status === 'fulfilled' ? [this.rpc(record, 'unbind', {}, signal)] : []),
      requestV2(record.client, base, { method: 'DELETE', signal }),
    ]);
  }

  dispose() { this.disposed = true; return this.clear(); }
}
