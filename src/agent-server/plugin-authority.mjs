import { AgentServerProtocolError, assertAgentServerIdentifier } from './protocol.mjs';

function sourceKey(source) {
  const directory = String(source?.dir || '').trim();
  return JSON.stringify([
    String(source?.pluginId || ''), String(source?.releaseId || ''), String(source?.contentDigest || ''),
    process.platform === 'win32' ? directory.toLowerCase() : directory,
    source?.scope === 'project' ? 'project' : 'personal'
  ]);
}

// The Desktop owns registry mutations. These restrictions also cover detached workers
// and stale attachments from other clients, without changing ordinary detach semantics.
export class ServerPluginAuthority {
  disabledPlugins = new Set();
  chatSources = new Map();

  update(input, resolveAlias) {
    const pluginId = input.pluginId === undefined ? null : assertAgentServerIdentifier(input.pluginId, 'Plugin id');
    if (pluginId && !['active', 'disabled'].includes(input.state)) throw new AgentServerProtocolError('Plugin state is invalid.');
    if (!Array.isArray(input.chats) || input.chats.length > 2048) throw new AgentServerProtocolError('Plugin authority Chat list is invalid.');
    const chats = input.chats.map((chat) => {
      const sessionKey = resolveAlias(assertAgentServerIdentifier(chat.sessionKey, 'Chat id'));
      if (chat.sources !== null && (!Array.isArray(chat.sources) || chat.sources.length > 24)) throw new AgentServerProtocolError('Plugin Skill sources are invalid.');
      return [sessionKey, chat.sources === null ? null : new Set(chat.sources.map(sourceKey))];
    });
    if (new Set([...this.chatSources.keys(), ...chats.map(([key]) => key)]).size > 10000
      || pluginId && input.state === 'disabled' && !this.disabledPlugins.has(pluginId) && this.disabledPlugins.size >= 256) {
      throw new AgentServerProtocolError('Plugin authority capacity exceeded.');
    }
    if (pluginId) {
      if (input.state === 'disabled') this.disabledPlugins.add(pluginId);
      else this.disabledPlugins.delete(pluginId);
    }
    for (const [key, sources] of chats) this.chatSources.set(key, sources);
  }

  bindCanonicalKey(previousKey, canonicalKey) {
    if (previousKey === canonicalKey || !this.chatSources.has(previousKey)) return;
    const previous = this.chatSources.get(previousKey);
    const current = this.chatSources.get(canonicalKey);
    this.chatSources.set(canonicalKey, !this.chatSources.has(canonicalKey) ? previous
      : previous === null || current === null ? null : new Set([...previous].filter((key) => current.has(key))));
    this.chatSources.delete(previousKey);
  }

  allows(sessionKey, sources = []) {
    if (!Array.isArray(sources)) return false;
    if (sources.some((source) => this.disabledPlugins.has(String(source?.pluginId || '')))) return false;
    if (!this.chatSources.has(sessionKey)) return true;
    const allowed = this.chatSources.get(sessionKey);
    return allowed !== null && sources.every((source) => allowed.has(sourceKey(source)));
  }

  assertAllowed(sessionKey, sources) {
    if (!this.allows(sessionKey, sources)) {
      throw new AgentServerProtocolError('Chat Plugin authority was revoked. Refresh its Plugin scope before reconnecting.', 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED');
    }
  }
}
