import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { AgentControlBridgeClient } from '../agent-control/bridge-client.mjs';
import { CONTROL_BOUNDS } from '../agent-control/contracts.mjs';
import { getProjectSessionsDir } from '../project-paths.mjs';
import { ZyraSessionManager } from './zyra-session-manager.mjs';
import { AgentServerProtocolError, assertAgentServerIdentifier } from './protocol.mjs';

const OPERATIONS = new Set(['list_targets', 'open_tab', 'reveal_tab', 'close_tab', 'refresh_tab', 'open_external',
  'set_tab_layout', 'resize_inspector', 'open_app', 'list_windows', 'use_app', 'request_grant', 'observe',
  'act', 'act_sequence', 'perform', 'plan_status', 'resume_plan', 'cancel_plan', 'release']);

// External harnesses borrow Desktop drivers, never its authority proof or model runtime.
export class ExternalToolSessions {
  constructor(server, options = {}) {
    this.server = server;
    this.sessions = new Map();
    this.opening = new Map();
    this.retiredRequests = new Map();
    this.createChat = options.createChat || ((input) => this.createCanonicalChat(input));
  }

  desktop() {
    return [...this.server.clients.values()].find(client => client.authenticated && client.canControl && client.socket.writable);
  }

  status() {
    return { available: Boolean(this.desktop()), requires: 'connected Zyra Desktop control host', activeSessions: this.sessions.size };
  }

  async open(client, params) {
    const project = path.resolve(String(params.project || ''));
    if (!params.project || !existsSync(project) || !statSync(project).isDirectory()) throw new AgentServerProtocolError('The tool-session project folder is unavailable.');
    const sourceSessionId = assertAgentServerIdentifier(params.sourceSessionId, 'source session id');
    const key = `${client.connectionId}:${sourceSessionId}`;
    const existing = [...this.sessions.values()].find(session => session.key === key);
    if (existing) return this.presentation(existing);
    if (this.opening.has(key)) return this.opening.get(key);
    const opening = this.openNew(client, { ...params, project, sourceSessionId, key });
    this.opening.set(key, opening);
    try { return await opening; } finally { this.opening.delete(key); }
  }

  async openNew(client, input) {
    const chat = await this.createChat({ ...input, surface: client.surface, displayName: client.displayName });
    this.server.assertWorkAdmission?.();
    if (!client.socket.writable) throw new AgentServerProtocolError('The tool client disconnected.', 'AGENT_SERVER_DISCONNECTED');
    const id = `external-tool:${randomUUID()}`;
    const turnId = `external-turn:${randomUUID()}`;
    const session = { id, key: input.key, client, chat, turnId, owners: new Map(), closed: false };
    session.bridge = new AgentControlBridgeClient({ send: message => this.route(session, message) });
    this.sessions.set(id, session);
    this.server.notifyDesktopWorkspaceTurn(chat.canonicalChatId, turnId);
    return this.presentation(session);
  }

  presentation(session) {
    return { toolSessionId: session.id, canonicalChatId: session.chat.canonicalChatId,
      turnId: session.turnId, ...this.status() };
  }

  async createCanonicalChat(input) {
    const hash = createHash('sha256').update(`${input.surface}\0${input.sourceSessionId}\0${input.project}`).digest('hex').slice(0, 32);
    return this.server.withCanonicalMessageLock(`external-create:${hash}`, async () => this.persistCanonicalChat(input, hash));
  }

  async persistCanonicalChat(input, hash) {
    const alias = `external-tools:${hash}`;
    const found = await this.server.catalog.find(alias, { allProjects: true });
    if (found) return found;
    const manager = ZyraSessionManager.create(input.project, getProjectSessionsDir(input.project), { id: `zyra_tools_${hash}` });
    const title = `${input.displayName || input.surface || 'External agent'} · tool verification`;
    manager.appendSessionInfo(title);
    manager.appendCustomEntry('zyra_external_tool_session', { surface: input.surface, sourceSessionId: input.sourceSessionId });
    const canonicalChatId = manager.getSessionId();
    this.server.catalog.recordAttachment({ canonicalChatId, project: input.project, aliases: [alias], surface: input.surface });
    this.server.broadcastCatalogChanged({ canonicalChatId });
    return { canonicalChatId, project: input.project, sessionPath: manager.getSessionFile(), title };
  }

  require(client, id) {
    const session = this.sessions.get(String(id || ''));
    if (!session || session.client !== client || session.closed) {
      throw new AgentServerProtocolError('This tool session does not belong to the connected client.', 'CONTROL_PRINCIPAL_MISMATCH');
    }
    return session;
  }

  async control(client, params) {
    const session = this.require(client, params.toolSessionId);
    const operation = params.operation;
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !OPERATIONS.has(operation.operation)
      || operation.principal || Buffer.byteLength(JSON.stringify(operation)) > CONTROL_BOUNDS.maxBridgeMessageBytes) {
      throw new AgentServerProtocolError('Invalid external control operation.', 'CONTROL_VALIDATION_ERROR');
    }
    const timeoutMs = Math.max(100, Math.min(600_000, Number(params.timeoutMs) || CONTROL_BOUNDS.defaultActionTimeoutMs));
    return session.bridge.request(operation, { timeoutMs });
  }

  route(session, message) {
    if (message.type === 'control.cancel') {
      const owner = session.owners.get(message.requestId);
      if (owner) {
        this.retireRequest(session, message.requestId, owner);
        this.server.send(owner, { ...message, sessionKey: session.chat.canonicalChatId });
      }
      session.owners.delete(message.requestId);
      return;
    }
    const owner = this.desktop();
    if (!owner) {
      session.bridge.handleResponse({ requestId: message.requestId, ok: false,
        error: { code: 'CONTROL_DRIVER_UNAVAILABLE', message: 'Open Zyra Desktop to use browser, Chrome or computer tools.', retryable: true } });
      return;
    }
    session.owners.set(message.requestId, owner);
    this.server.send(owner, { ...message, sessionKey: session.chat.canonicalChatId,
      externalToolSessionId: session.id,
      requestContext: { turnId: session.turnId },
      principal: { type: 'root', threadId: session.chat.canonicalChatId, turnId: session.turnId } });
  }

  handleResponse(client, message) {
    const retired = this.retiredRequests.get(message.requestId);
    if (retired) {
      if (retired.owner !== client || retired.sessionKey !== message.sessionKey) throw new AgentServerProtocolError('Late tool response has the wrong owner.', 'AGENT_SERVER_AUTH_FAILED');
      return true;
    }
    // Older Desktop clients echo only sessionKey. Match the unique request ID as well.
    const session = [...this.sessions.values()].find(candidate => candidate.owners.has(message.requestId));
    if (!session) return false;
    if (session.owners.get(message.requestId) !== client || message.sessionKey !== session.chat.canonicalChatId) {
      throw new AgentServerProtocolError('Tool response came from a different control owner.', 'AGENT_SERVER_AUTH_FAILED');
    }
    session.owners.delete(message.requestId);
    session.bridge.handleResponse(message);
    return true;
  }

  retireRequest(session, requestId, owner) {
    this.retiredRequests.set(requestId, { owner, sessionKey: session.chat.canonicalChatId });
    if (this.retiredRequests.size > 512) this.retiredRequests.delete(this.retiredRequests.keys().next().value);
  }

  cancel(client, params) {
    const session = this.require(client, params.toolSessionId);
    // Cancelling a turn also revokes its grants; no actions survive a stopped Pi run.
    this.closeSession(session);
    return { closed: true };
  }

  closeSession(session) {
    if (session.closed) return;
    session.closed = true;
    for (const [requestId, owner] of session.owners) {
      this.retireRequest(session, requestId, owner);
      this.server.send(owner, { type: 'control.cancel', requestId, sessionKey: session.chat.canonicalChatId });
    }
    session.owners.clear();
    session.bridge.dispose('External tool turn ended.');
    this.server.notifyDesktopWorkspaceTurnEnded(session.chat.canonicalChatId, session.turnId);
    this.sessions.delete(session.id);
  }

  dropClient(client) {
    for (const session of this.sessions.values()) {
      if (session.client === client) this.closeSession(session);
      else for (const [requestId, owner] of session.owners) if (owner === client) {
        session.owners.delete(requestId);
        session.bridge.handleResponse({ requestId, ok: false, error: { code: 'CONTROL_DRIVER_UNAVAILABLE', message: 'Zyra Desktop disconnected.', retryable: true } });
      }
    }
  }

  dispose() { for (const session of this.sessions.values()) this.closeSession(session); }
}
