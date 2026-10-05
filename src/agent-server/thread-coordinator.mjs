import path from 'node:path';
import { createHash } from 'node:crypto';
import { ThreadMailbox } from './thread-mailbox.mjs';
import { getAgentConversationKind } from '../agents/contracts.mjs';
import { resolveThreadStartSettings, threadStartOptions } from '../threads/start-settings.mjs';

const sameProject = (a, b) => { const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); return Boolean(a && b && normalize(a) === normalize(b)); };
const startFingerprint = input => JSON.stringify(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));

/** Coordinates messages without moving working contexts between conversations. */
export class AgentThreadCoordinator {
  constructor(server) { this.server = server; this.mailbox = new ThreadMailbox(path.join(server.paths.stateDirectory, 'thread-messages', server.paths.namespaceId)); this.registered = new Set(); this.starting = new Map(); }
  sender(source, agentRunId) {
    if (source.disposed || source.revocationPromise || !source.connectedResult) throw new Error('The sending thread is unavailable.');
    const project = source.connectedResult.project || source.connectedResult.cwd;
    const agent = agentRunId ? source.latestFleetSnapshot?.agents?.[agentRunId] : null;
    if (agentRunId && (!agent || !['starting', 'running', 'waiting', 'completed'].includes(agent.status))) throw new Error('The sending agent is unavailable.');
    return { project, senderThreadId: agent ? `agent-run:${agent.agentRunId}` : source.sessionKey, senderLabel: agent?.label || source.connectedResult.sessionName || 'Zyra', senderCanonicalThreadId: agent?.providerSessionId || source.sessionKey, agent };
  }
  async request(source, message) {
    const sender = this.sender(source, message.agentRunId);
    const input = message.input || {};
    if (input.action === 'models') {
      const response = await source.worker.request('agents.models', { provider: input.provider, modelQuery: input.modelQuery });
      return { ...(response.result || response), ...threadStartOptions(sender, source.connectedResult) };
    }
    if (input.action === 'list') {
      const chats = await this.server.catalog.list({ project: sender.project, limit: 100 });
      const threads = chats.filter(chat => !chat.deleted).map(chat => ({ threadId: chat.canonicalChatId, label: chat.title, state: this.server.sessionPresence(chat.canonicalChatId)?.state || 'detached' }));
      for (const owner of new Set(this.server.sessions.values())) if (sameProject(sender.project, owner.connectedResult?.project || owner.connectedResult?.cwd)) {
        for (const agent of Object.values(owner.latestFleetSnapshot?.agents || {})) threads.push({ threadId: `agent-run:${agent.agentRunId}`, canonicalThreadId: agent.providerSessionId || null, label: agent.label, task: String(agent.goal || '').slice(0, 240), state: agent.status, model: agent.selectedModel, role: agent.agentId });
      }
      return { threads: threads.slice(0, 200), senderThreadId: sender.senderThreadId };
    }
    if (input.action === 'start') {
      if (!String(input.prompt || '').trim()) throw new Error('A new agent thread needs a task.');
      if (!input.dedupeKey) throw new Error('A stable thread creation operation id is required.');
      const digest = createHash('sha256').update(`${sender.senderThreadId}\0${input.dedupeKey}`).digest('hex');
      const agentRunId = `thread-${digest}`;
      const existing = source.latestFleetSnapshot?.agents?.[agentRunId];
      if (existing) {
        if (existing.goal !== String(input.prompt)) throw new Error('Thread creation operation was reused with another task.');
        if (['model', 'effort', 'permissionMode'].some(key => input[key] != null && (key === 'effort' && input[key] === 'none' ? 'off' : input[key]) !== existing[key === 'model' ? 'requestedModel' : key])) throw new Error('Thread creation operation was reused with different settings.');
        return { agentRunId, threadId: `agent-run:${agentRunId}`, status: existing.status, configuration: { model: existing.selectedModel, effort: existing.effort, permissionMode: existing.permissionMode } };
      }
      if (this.starting.has(agentRunId)) {
        const pending = this.starting.get(agentRunId);
        if (pending.configuration !== startFingerprint(input)) throw new Error('Thread creation operation was reused with another task or settings.');
        return pending.operation;
      }
      if (Object.keys(source.latestFleetSnapshot?.agents || {}).length >= 128) throw new Error('This fleet has reached its agent thread limit.');
      const inherited = sender.agent;
      if (inherited?.workflowRunId) throw new Error('This agent belongs to a budgeted workflow. Start additional work through its workflow scheduler.');
      if (Buffer.byteLength(String(input.prompt)) > 64 * 1024) throw new Error('Agent thread task is too long.');
      const settings = resolveThreadStartSettings(input, sender, source.connectedResult);
      const operation = source.worker.request('agents.spawn', {
        agentRunId, goal: String(input.prompt), label: String(input.label || 'Agent thread').slice(0, 120),
        ...settings,
        conversationKind: 'thread', background: true, returnHandle: true,
      }).then(result => { const handle = result.result || result; return { ...handle, threadId: `agent-run:${handle.agentRunId}`, configuration: { model: handle.model || settings.model, effort: handle.effort ?? settings.effort, permissionMode: handle.permissionMode || settings.permissionMode } }; });
      this.starting.set(agentRunId, { operation, configuration: startFingerprint(input) });
      try { return await operation; } finally { this.starting.delete(agentRunId); }
    }
    if (input.action === 'status') {
      const receipt = this.mailbox.get(String(input.messageId || ''), sender.senderThreadId);
      if (!receipt) throw new Error('Thread message receipt is unavailable.');
      return receipt;
    }
    if (input.action !== 'send') throw new Error('Unknown thread operation.');
    const canonicalId = this.server.catalog.resolveAlias(String(input.threadId || ''));
    const recipient = await this.findRecipient(canonicalId, sender.project);
    if (!recipient) throw new Error('Recipient thread is unavailable in this project. Read thread list to choose a current recipient.');
    if (canonicalId === sender.senderThreadId || canonicalId === sender.senderCanonicalThreadId) throw new Error('Choose another thread as the recipient.');
    const { agent, ...identity } = sender;
    const receipt = this.mailbox.enqueue(identity, { ...input, threadId: canonicalId });
    void this.pump().catch(error => this.server.emit('worker-error', { sessionKey: source.sessionKey, error }));
    return { messageId: receipt.messageId, status: receipt.status, recipientThreadId: receipt.recipientThreadId };
  }
  async findRecipient(id, project) {
    for (const owner of new Set(this.server.sessions.values())) {
      if (!sameProject(project, owner.connectedResult?.project || owner.connectedResult?.cwd) || owner.disposed) continue;
      const agent = Object.values(owner.latestFleetSnapshot?.agents || {}).find(agent => id === `agent-run:${agent.agentRunId}` || id === agent.providerSessionId);
      if (agent) return { owner, agent };
      if (id === owner.sessionKey) return { owner };
    }
    const chat = await this.server.catalog.find(id, { project });
    return chat && !chat.deleted && sameProject(project, chat.project) ? { chat } : null;
  }
  async pump() {
    for (const receipt of this.mailbox.messages.values()) {
      if (receipt.status !== 'queued' || this.mailbox.delivering.has(receipt.messageId)) continue;
      const recipient = await this.findRecipient(receipt.recipientThreadId, receipt.project);
      if (!recipient?.owner || recipient.owner.revocationPromise) continue;
      if (recipient.agent && !['running', 'waiting', 'completed'].includes(recipient.agent.status)) continue;
      void this.mailbox.deliver(receipt, async message => {
        const owner = recipient.owner;
        const result = recipient.agent
          ? await owner.request({ clientId: 'thread-mailbox', internalThreadMailbox: true }, 'agents.receiveThreadMessage', { agentRunId: recipient.agent.agentRunId, message })
          : await owner.request({ clientId: 'thread-mailbox', internalThreadMailbox: true }, 'thread_message.receive', { message }, { turnId: message.messageId });
        this.server.broadcastCatalogChanged({ canonicalChatId: recipient.agent?.providerSessionId || owner.sessionKey, threadMessage: true });
        return result;
      }).catch(error => this.server.emit('worker-error', { sessionKey: recipient.owner.sessionKey, error }));
    }
  }
  registerAgentThreads(owner) {
    for (const agent of Object.values(owner.latestFleetSnapshot?.agents || {})) {
      if (!agent.providerSessionId || !agent.sessionFile || this.registered.has(agent.providerSessionId)) continue;
      const project = owner.connectedResult?.project || owner.connectedResult?.cwd;
      if (!project) continue;
      try {
        this.server.ensureAgentView(owner, agent);
        const conversationKind = getAgentConversationKind(agent);
        // Workers stay addressable through their fleet without becoming chats.
        if (conversationKind === 'thread') this.server.catalog.index?.registerAgentThread?.(agent.sessionFile, project);
        this.registered.add(agent.providerSessionId);
        if (conversationKind === 'thread' || this.server.catalog.index?.get?.(agent.providerSessionId)) {
          void this.server.catalog.updateChat(agent.providerSessionId, { title: agent.label, agentCreatedBy: owner.sessionKey, agentLabel: agent.label,
            agentRunId: agent.agentRunId, agentConversationKind: conversationKind }).then(() => this.server.broadcastCatalogChanged({ canonicalChatId: agent.providerSessionId, agentThread: conversationKind === 'thread' })).catch(() => {});
        }
      } catch { /* In-memory/transient child sessions have no canonical sidebar entry. */ }
    }
  }
}
