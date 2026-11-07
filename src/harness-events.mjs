/** Authenticated loopback SSE. A broken stream falls back to snapshot reads. */
export function subscribeHarnessEvents(client, { fetchImpl = fetch, signal, onEvent, onDisconnect } = {}) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let connected = false;
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const timer = setTimeout(() => controller.abort(), 30_000);
  timer.unref?.();
  const finished = (async () => {
    let reader;
    try {
      const response = await fetchImpl(`${client.baseUrl}${client.apiVersion === 2 ? '/api/event' : '/event'}`, {
        signal: combined, redirect: 'error', headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${client.password}`).toString('base64')}`,
          Accept: 'text/event-stream',
          ...(client.cwd ? { 'x-opencode-directory': encodeURIComponent(client.cwd) } : {}),
        },
      });
      clearTimeout(timer);
      if (!response.ok || !response.headers?.get('content-type')?.includes('text/event-stream') || !response.body) return;
      connected = true;
      readyResolve(true);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!combined.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 2 * 1024 * 1024) throw new Error('Harness event exceeded the stream limit.');
        let boundary;
        while ((boundary = pending.search(/\r?\n\r?\n/)) >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + (pending[boundary] === '\r' ? 4 : 2));
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let event;
          try { event = JSON.parse(data); } catch { continue; }
          onEvent?.(event.payload ?? event);
        }
      }
    } catch { /* Snapshots and the final POST remain authoritative. */ }
    finally {
      const wasConnected = connected;
      connected = false;
      readyResolve(false);
      clearTimeout(timer);
      await reader?.cancel().catch(() => {});
      onDisconnect?.(wasConnected);
    }
  })();
  return { get connected() { return connected; }, ready, finished, close() { controller.abort(); } };
}

/** Reject old turns and foreign chats before publishing any text or tool. */
export function createHarnessEventAccumulator({ sessionId, messageID, onProgress, onPermissionRequest }) {
  const messages = new Map();
  const parts = new Map();
  const permissions = new Map();
  const publishedTools = new Map();
  const current = part => messages.get(part.messageID)?.parentID === messageID && messages.get(part.messageID)?.role === 'assistant';
  const publish = () => {
    const owned = [...parts.values()].filter(current);
    for (const type of ['reasoning', 'text']) {
      const text = owned.filter(part => part.type === type).map(part => part.text || '').join('');
      if (text) onProgress?.({ type, text });
    }
    for (const part of owned) if (part.type === 'tool' && publishedTools.get(part.id) !== part) {
      publishedTools.set(part.id, part);
      onProgress?.({ type: 'tool', part });
    }
    for (const request of permissions.values()) {
      const callID = request.tool?.callID ?? request.metadata?.callID ?? request.metadata?.callId;
      const part = owned.find(part => part.type === 'tool' && part.callID === callID
        && (!request.tool?.messageID || part.messageID === request.tool.messageID));
      if (part) onPermissionRequest?.(request, owned);
    }
  };
  return event => {
    const properties = event?.properties ?? {};
    if (event?.type === 'message.updated') {
      const info = properties.info;
      if (info?.sessionID !== sessionId || !info.id) return;
      if (messages.size >= 1024 && !messages.has(info.id)) return;
      messages.set(info.id, info);
    } else if (event?.type === 'message.part.updated') {
      const part = properties.part;
      if (part?.sessionID !== sessionId || !part.id) return;
      if (parts.size >= 2048 && !parts.has(part.id)) return;
      parts.set(part.id, part);
    } else if (event?.type === 'message.part.delta') {
      if (properties.sessionID !== sessionId) return;
      const part = parts.get(properties.partID);
      if (properties.messageID && properties.messageID !== part?.messageID) return;
      if (!part || !['text', 'reasoning'].includes(part.type) || properties.field !== 'text' || typeof properties.delta !== 'string') return;
      parts.set(part.id, { ...part, text: (part.text || '') + properties.delta });
    } else if (event?.type === 'permission.asked') {
      if (properties.sessionID !== sessionId || !properties.id || permissions.size >= 1024) return;
      permissions.set(properties.id, properties);
    } else if (event?.type === 'permission.replied') {
      if (properties.sessionID !== sessionId) return;
      permissions.delete(properties.requestID);
    } else return;
    publish();
  };
}
