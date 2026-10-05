import { EventEmitter } from 'node:events';

/** A child view uses its fleet's one transcript writer, never another process. */
export class ChildThreadWorker extends EventEmitter {
  constructor(owner, agentRunId) {
    super();
    this.owner = owner;
    this.agentRunId = agentRunId;
    this.disposed = false;
    this.onExit = event => this.emit('exit', event);
    owner.worker.on('exit', this.onExit);
  }
  isAlive() { return !this.disposed && !this.owner.disposed && this.owner.worker.isAlive(); }
  async request(type, payload = {}) {
    if (!this.isAlive()) throw new Error('The owning agent fleet is unavailable. Reopen its parent chat.');
    if (type === 'connect') return this.owner.worker.request('agents.inspectSession', { agentRunId: this.agentRunId });
    if (type === 'prompt') return this.owner.worker.request('agents.chatPrompt', { agentRunId: this.agentRunId, prompt: payload.prompt });
    if (type === 'abort') return this.owner.worker.request('agents.stop', { agentRunId: this.agentRunId, interruption: { kind: 'stopped', source: 'user' } });
    if (type === 'steer' || type === 'follow_up') return this.owner.worker.request('agents.send', { agentRunId: this.agentRunId, message: payload.prompt });
    if (type === 'thread_message.receive') return this.owner.worker.request('agents.receiveThreadMessage', { agentRunId: this.agentRunId, message: payload.message });
    if (type === 'managed_bash.list' || type === 'managed_bash.stop') {
      return this.owner.worker.request(type, { ...payload, ownerAgentRunId: this.agentRunId });
    }
    if (type === 'preferences.get') return { memoryMode: 'off', memoryEnabled: false };
    if (type === 'auth.refresh') return this.owner.worker.request(type, payload);
    throw new Error(`An agent thread retains its fleet model, permissions and scope. ${type} is unavailable here; use the owning fleet to change its configuration.`);
  }
  sendControlResponse(message) { return this.owner.worker.sendControlResponse(message); }
  publish(event) { if (!this.disposed) this.emit('event', event); }
  dispose() {
    this.disposed = true;
    this.owner.worker.off('exit', this.onExit);
    this.removeAllListeners();
    this.owner.scheduleIdleStop();
  }
}
