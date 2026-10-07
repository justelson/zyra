import { appendTextAttachments } from './text-attachments.mjs';
import { readAccountLimits } from './account-limits.mjs';
import { projectSessionDetails } from './session-details.mjs';
import { projectCatalogMetadata } from './catalog-metadata.mjs';
import { projectFleetList } from './fleet-projection.mjs';
import { DICTATION_METHODS } from './dictation-session.mjs';
import { PLUGIN_METHODS, PLUGIN_READS } from './plugin-session.mjs';
import { WorkspaceFiles, WORKSPACE_METHODS, WORKSPACE_READS } from './workspace-files.mjs';
import { readReview, REVIEW_METHODS } from './review.mjs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { assert, fault } from './errors.mjs';
import { mobileEvent, projectEvent, replayGap } from './projection.mjs';
const TERMINAL_METHODS = new Set(['terminal.list', 'terminal.create', 'terminal.attach', 'terminal.detach', 'terminal.input', 'terminal.resize', 'terminal.close', 'terminal.clear']);
const VIEW_METHODS = new Set(['session.view']);
const VOICE_METHODS = new Set(['voice.status', 'voice.start', 'voice.stop', 'voice.ingest', 'voice.message', 'voice.recovery.begin', 'voice.recovery.chunk', 'voice.recovery.finish', 'voice.recovery.cancel']);
const READS = new Set(['catalog.project', 'catalog.search', 'catalog.search.context', 'catalog.list', 'catalog.get', 'catalog.history', 'catalog.entry.body', 'catalog.tool-output.search', 'runtime.models']);
const ACTIONS = new Set(['prompt', 'abort', 'steer', 'follow_up', 'compact', 'clear_queue', 'configure', 'preferences.get', 'memory.configure',
  'approval.respond', 'user_input.respond', 'agents.list', 'agents.listDefinitions', 'agents.listRuns', 'agents.status',
  'agents.spawn', 'agents.send', 'agents.stop', 'agents.retry', 'agents.resume', 'agents.transcript',
  'workflows.list', 'workflows.listRuns', 'workflows.status', 'workflows.run', 'workflows.pause', 'workflows.resume', 'workflows.stop']);
const CONFIG = ['model', 'thinking', 'profile', 'runtimeMode', 'webSearch', 'webFetch'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
export class HostRouter {
  constructor({ client, owner, cache, projects = [], allProjects = false, hiddenProjects = [], prepareChat, regenerateTitle, review, fleet, accountLimits, usage, resolveScope, searchChats, searchContext, projectPresentation, terminal, voice, plugins, uploads, runtimeStatus }) { this.client = client; this.owner = owner; this.cache = cache; this.projects = projects; this.allProjects = allProjects; this.hiddenProjects = hiddenProjects; this.attached = new Set(); this.prepareChat = prepareChat; this.regenerateTitle = regenerateTitle; this.review = review; this.fleet = fleet; this.accountLimits = accountLimits; this.usage = usage; this.searchChats = searchChats; this.searchContext = searchContext; this.projectPresentation = projectPresentation; this.terminal = terminal; this.voice = voice; this.plugins = plugins; this.uploads = uploads; this.runtimeStatus = runtimeStatus; this.files = new WorkspaceFiles({ projects, resolveScope, allProjects, hiddenProjects, allowsProject: project => this.allowsProject(project) }); }
  allowsProject(project) {
    const key = value => { const normalized = path.resolve(String(value || '.')); return process.platform === 'win32' ? normalized.toLowerCase() : normalized; };
    return !this.hiddenProjects.some(hidden => key(hidden) === key(project)) && (this.allProjects || this.projects.some(shared => key(shared) === key(project)));
  }
  async visibleProjects() {
    const known = this.allProjects ? (await this.client.request('catalog.projects')).projects || [] : [];
    return [...new Set([...this.projects, ...known])].filter(project => this.allowsProject(project));
  }
  async assertChat(selector) {
    const result = await this.client.request('catalog.get', { session: selector, allProjects: true });
    if (!result.chat || result.chat.deleted || !this.allowsProject(result.chat.project)) throw fault('CHAT_NOT_VISIBLE', 'This chat is not shared with this device.');
    return result.chat;
  }
  async dispatch(method, params = {}, operationId) {
    assert(params && typeof params === 'object' && !Array.isArray(params), 'Invalid request parameters.');
    if (method === 'account.limits') return readAccountLimits(this.accountLimits);
    if (method === 'account.usage') {
      assert(this.usage, 'Update Zyra Desktop to view recorded usage.');
      const harness=params.harness || 'zyra', projects=await this.visibleProjects();
      const catalog=harness==='zyra' || harness==='all' ? await this.client.request('catalog.list',{projects,includeArchived:true,limit:2000}) : null;
      return this.usage.read({harness,projects,zyraChats:catalog?.chats?.filter(chat=>this.allowsProject(chat.project)),hiddenProjects:this.hiddenProjects,allProjects:this.allProjects});
    }
    if (method === 'session.details') {
      assert(this.review?.details, 'Update Zyra Desktop to view chat details.');
      assert(typeof params.session === 'string', 'Choose a chat.');
      const chat = await this.assertChat(params.session);
      return projectSessionDetails(await this.review.details(chat.canonicalChatId));
    }
    if (REVIEW_METHODS.has(method)) {
      assert(typeof params.session === 'string', 'Choose a chat.');
      const chat = await this.assertChat(params.session);
      return this.cache.project(this.owner, await readReview(this.review, this.files, method, params, chat, this.hiddenProjects));
    }
    if (PLUGIN_METHODS.has(method)) {
      assert(this.plugins, 'Update Zyra Desktop to manage Plugins on your phone.');
      if (params.scope === 'machine') {
        assert(this.plugins.supportsMachineScope === true, 'Update Zyra Desktop to manage Plugins from Settings.');
        assert(params.session === undefined, 'Choose either a computer or a chat for Plugins.');
        return this.cache.project(this.owner, await this.plugins.dispatch(method, params, null, this.allProjects && this.hiddenProjects.length === 0));
      }
      assert(typeof params.session === 'string' && this.attached.has(params.session), 'Open this chat before managing Plugins.');
      const chat = await this.assertChat(params.session);
      return this.cache.project(this.owner, await this.plugins.dispatch(method, params, chat, this.allProjects && this.hiddenProjects.length === 0));
    }
    if (VOICE_METHODS.has(method) || DICTATION_METHODS.has(method)) {
      assert(this.voice, 'Voice requires an updated Zyra Desktop host.');
      assert(typeof params.session === 'string' && this.attached.has(params.session), 'Open this chat before using Voice.');
      const chat = await this.assertChat(params.session);
      return this.voice.dispatch(method, params, chat);
    }
    if (['upload.begin', 'upload.status', 'upload.chunk', 'upload.finish', 'upload.cancel'].includes(method)) {
      assert(this.uploads, 'File transfer is unavailable on this host.');
      assert(typeof params.session === 'string', 'Choose a chat.');
      const chat = await this.assertChat(params.session), id = chat.canonicalChatId;
      if (method === 'upload.begin') return this.uploads.begin(this.owner, id, params);
      if (method === 'upload.chunk') return this.uploads.chunk(this.owner, id, params);
      if (method === 'upload.status') return this.uploads.status(this.owner, id, params.uploadId);
      if (method === 'upload.finish') return this.uploads.finish(this.owner, id, params.uploadId);
      return this.uploads.cancel(this.owner, id, params.uploadId);
    }
    if (TERMINAL_METHODS.has(method)) {
      assert(this.terminal, 'Terminals require a connected Zyra Desktop host.');
      assert(typeof params.session === 'string', 'Choose a chat.');
      const chat = await this.assertChat(params.session);
      const result = await this.terminal.dispatch(method, params, chat, await this.files.roots(chat));
      if (result?.success === false) throw fault('TERMINAL_FAILED', result.error || 'Terminal action failed.');
      return this.cache.project(this.owner, result);
    }
    if (WORKSPACE_METHODS.has(method)) {
      assert(typeof params.session === 'string', 'Choose a chat.');
      const chat = await this.assertChat(params.session);
      return this.cache.project(this.owner, await this.files.dispatch(method, params, chat));
    }
    if (method === 'catalog.project') {
      assert(typeof params.project === 'string' && params.project.length < 4096, 'Choose a project.');
      assert(this.allowsProject(params.project) && (await this.visibleProjects()).includes(params.project), 'Choose a visible project on this PC.');
      return this.projectPresentation ? await this.projectPresentation(params.project) : { project: params.project };
    }
    if (method === 'catalog.search') {
      const query = String(params.query || '').trim().slice(0, 200);
      if (!this.searchChats || query.length < 2) return { matches: [], available: !!this.searchChats, indexingOlderChats: false };
      const result = await this.searchChats({ query, limit: 50 });
      const matches = [];
      // Search is owned by Desktop's index. Resolve every hit to the canonical
      // catalog before returning text; Desktop local ids are not authority.
      for (const match of (result.matches || []).slice(0, 50)) {
        if (typeof match.canonicalChatId !== 'string') continue;
        try {
          const chat = await this.assertChat(match.canonicalChatId);
          matches.push({ chat, threadId: match.threadId, messageId: match.messageId,
            role: match.role, snippet: String(match.snippet || '').slice(0, 480), createdAt: match.createdAt });
        } catch (error) { if (error.code !== 'CHAT_NOT_VISIBLE') throw error; }
      }
      const projected = await projectCatalogMetadata(matches.map(match=>match.chat),this.review,this.files,this.hiddenProjects);
      matches.forEach((match,index)=>{match.chat=projected[index];});
      return this.cache.project(this.owner, { matches, available: true, indexingOlderChats: result.indexingOlderChats === true, metadataPending:projected.some(chat=>chat.metadataPending),metadataRetryMs:750 });
    }
    if (method === 'catalog.search.context') {
      assert(this.searchContext, 'Update Zyra on this PC to view search context.');
      assert(['session', 'threadId', 'messageId'].every(key => typeof params[key] === 'string' && params[key].length > 0 && params[key].length < 1024), 'Choose a search result.');
      const chat = await this.assertChat(params.session);
      return this.cache.project(this.owner, await this.searchContext({ session: chat.canonicalChatId, threadId: params.threadId, messageId: params.messageId }));
    }
    if (method === 'catalog.list') {
      if (params.project) assert(this.allowsProject(params.project), 'Choose a visible project.');
      const limit = Math.max(1, Math.min(60, Number(params.limit) || 30));
      const result = await this.client.request(method, {
        ...(params.project ? { projects: [params.project] } : this.allProjects ? { allProjects: true, excludedProjects: this.hiddenProjects } : { projects: this.projects }),
        query: String(params.query || '').slice(0, 240), includeArchived: params.includeArchived === true,
        beforeChat: params.beforeChat, limit: limit + 1
      });
      const shared = (result.chats || []).filter(chat => this.allowsProject(chat.project));
      const chats = await projectCatalogMetadata(shared.slice(0, limit),this.review,this.files,this.hiddenProjects), last = chats.at(-1);
      return this.cache.project(this.owner, { chats, metadataPending:chats.some(chat=>chat.metadataPending),metadataRetryMs:750,nextCursor: shared.length > limit && last
        ? { modifiedAt: last.modifiedAt, canonicalChatId: last.canonicalChatId } : null });
    }
    if (method === 'media.chunk') {
      assert(typeof params.session === 'string' && params.session.length > 0, 'Choose a chat.');
      const chat = await this.assertChat(params.session);
      return this.cache.media.chunk(this.owner, chat.canonicalChatId, params.ref, params.offset, this.client);
    }
    if (method === 'body.chunk') return this.cache.chunk(this.owner, params.id, params.offset);
    if (method === 'host.status') {
      const status = await this.client.request('server.status'), runtimeStatus = this.runtimeStatus?.();
      return { version: 1, protocolVersion: status.version, sessions: status.sessions.filter(session => this.attached.has(session.sessionKey)), projects: await this.visibleProjects(), ...(runtimeStatus ? { runtimeStatus } : {}) };
    }
    if (READS.has(method)) {
      let safe = pick(params, ['session', 'query', 'before', 'ref', 'includeArchived', 'project']);
      if (safe.project) assert(this.allowsProject(safe.project), 'Choose a visible project.');
      safe.limit = Math.max(1, Math.min(60, Number(params.limit) || 30));
      if (method.startsWith('catalog.') && method !== 'catalog.list') {
        assert(typeof params.session === 'string' && params.session.length > 0, 'Choose a chat.');
        await this.assertChat(params.session);
      }
      if (method === 'catalog.list') safe.allProjects = true;
      if (method === 'catalog.history') { safe.toolResultBodies = 'lazy-mobile-v1'; safe.entryLocators = true; safe.mediaBodies = 'lazy-v1'; }
      if (method === 'runtime.models') safe = { skipAvailability: false };
      const result = await this.client.request(method, safe, { timeoutMs: 65000 });
      if (method === 'catalog.entry.body' && result.body?.entry && Number.isSafeInteger(params.ref?.entryIndex)) result.body.entry.historyEntryIndex = params.ref.entryIndex;
      if (method === 'catalog.list') result.chats = (result.chats || []).filter(chat => this.projects.includes(chat.project));
      return this.cache.project(this.owner, method.startsWith('catalog.') ? this.cache.media.project(this.owner, params.session, result) : result);
    }
    if (method === 'session.attach') {
      let project = params.project;
      if (params.session) {
        project = (await this.assertChat(params.session)).project;
      }
      assert(this.allowsProject(project) && (params.session || (await this.visibleProjects()).includes(project)), 'Choose a visible project on this PC.');
      const after = Number.isSafeInteger(params.lastSequence) && params.lastSequence >= 0 ? params.lastSequence : 0;
      let attached;
      if (params.session) {
        try { attached = await this.client.request('session.join', { session: params.session, lastSequence: after }); }
        catch (error) { if (error.code !== 'AGENT_SERVER_SESSION_NOT_FOUND') throw error;
          if (this.prepareChat && await this.prepareChat(params.session)) {
            attached = await this.client.request('session.join', { session: params.session, lastSequence: after });
          } }
      }
      attached ||= await this.client.attach({ project, cwd: project, session: params.session || undefined,
        localThreadId: params.session ? params.localThreadId || operationId || randomUUID()
          : 'mobile-create:' + createHash('sha256').update(JSON.stringify([this.owner, project, params.localThreadId || operationId || randomUUID()])).digest('hex'), lastSequence: after,
        ...(!params.session ? pick(params, CONFIG) : {}) });
      this.attached.add(attached.sessionKey);
      return this.cache.project(this.owner, { ...attached,
        liveMessage: attached.liveMessage ? this.cache.project(this.owner, this.cache.media.project(this.owner, attached.sessionKey, attached.liveMessage)) : null,
        pendingTools: (attached.pendingTools || []).map(event => projectEvent(event, this.owner, this.cache, attached.sessionKey)),
        pendingOperations: (attached.pendingOperations || []).map(entry => mobileEvent({ ...entry, sessionKey: attached.sessionKey }, this.owner, this.cache)),
        connected: this.cache.project(this.owner, this.cache.media.project(this.owner, attached.sessionKey, attached.connected)),
        pendingAttention: (attached.pendingAttention || []).map(event => projectEvent(event, this.owner, this.cache, attached.sessionKey)),
        replay: [], snapshotVersion: 1,
        resyncRequired: replayGap(after, attached.latestSequence, attached.replay || []) });
    }
    if (method === 'catalog.regenerateTitle') {
      assert(typeof params.session === 'string' && params.session.length > 0, 'Choose a chat.');
      const chat = await this.assertChat(params.session);
      assert(this.regenerateTitle, 'Update Zyra Desktop to refresh chat titles.');
      return this.regenerateTitle(chat.canonicalChatId);
    }
    if (method === 'catalog.update') {
      assert(typeof params.session === 'string', 'Choose a chat.');
      await this.assertChat(params.session);
      assert(params.title === undefined || (typeof params.title === 'string' && params.title.length <= 240), 'Title is too long.');
      return this.client.request(method, pick(params, ['session', 'title', 'archived']));
    }
    if (method === 'session.detach') {
      assert(this.attached.has(params.sessionKey), 'Open this chat first.');
      await this.voice?.detach(params.sessionKey);
      this.attached.delete(params.sessionKey); return this.client.detach(params.sessionKey);
    }
    if (method === 'session.view') {
      const chat = await this.assertChat(params.session);
      assert(typeof params.viewing === 'boolean', 'Invalid chat view.');
      return this.client.request(method, { session: chat.canonicalChatId, viewId: 'main', viewing: params.viewing });
    }
    if (method === 'fleet.definition') {
      assert(this.attached.has(params.session), 'Open this chat first.');
      assert(['agents', 'workflows'].includes(params.kind), 'Choose agents or workflows.');
      const result = await this.client.request('session.request', { sessionKey: params.session, type: params.kind + '.listDefinitions', payload: {} });
      const entry = result.active?.find(entry => (entry.name || entry.definition?.name) === params.name);
      assert(entry, 'This definition is no longer available.');
      return this.cache.project(this.owner, entry);
    }
    if (method === 'session.request') {
      assert(this.attached.has(params.sessionKey), 'Open this chat first.');
      assert(ACTIONS.has(params.type), 'This action is unavailable on mobile.');
      let payload = params.payload || {};
      let imageUploads = [];
      let fileUploads = [];
      assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'Invalid action.');
      if (payload.imageUploads !== undefined) {
        assert(this.uploads && ['prompt', 'steer', 'follow_up'].includes(params.type) && payload.images === undefined, 'Invalid image attachment action.');
        const { imageUploads: identifiers, ...rest } = payload;
        imageUploads = identifiers;
        payload = { ...rest, images: await this.uploads.images(this.owner, params.sessionKey, imageUploads) };
      }
      if (payload.fileUploads !== undefined) {
        assert(this.uploads && ['prompt', 'steer', 'follow_up'].includes(params.type), 'Invalid file attachment action.');
        const { fileUploads: identifiers, ...rest } = payload;
        assert(Array.isArray(identifiers) && Array.isArray(imageUploads) && identifiers.length + imageUploads.length <= 12 && new Set([...identifiers, ...imageUploads]).size === identifiers.length + imageUploads.length, 'Attach at most 12 distinct files.');
        fileUploads = identifiers;
        payload = { ...rest, prompt: appendTextAttachments(rest.prompt, await this.uploads.files(this.owner, params.sessionKey, fileUploads)) };
      }
      if (params.type === 'configure') assert(Object.keys(payload).every(key => CONFIG.includes(key)), 'Unsupported configuration field.');
      if (params.type === 'preferences.get') assert(Object.keys(payload).length === 0, 'Chat preferences do not accept a scope override.');
      if (params.type === 'memory.configure') assert(Object.keys(payload).every(key => key === 'enabled') && typeof payload.enabled === 'boolean', 'Choose whether this chat can contribute to memory.');
      const fleetRead = /^(agents|workflows)\.(list|listRuns|status|transcript)$/.test(params.type);
      if (fleetRead) await this.assertChat(params.sessionKey);
      const turnId = 'mobile:' + operationId;
      let result; let liveFailure;
      try { result = await this.client.request(method, {
        sessionKey: params.sessionKey, type: params.type, payload: params.type === 'prompt' ? { ...payload, turnId } : params.type === 'user_input.respond' ? { ...payload, continue: true } : payload,
        // Desktop uses the origin to distinguish remote user messages from its
        // own optimistic echo. Derive it from the authenticated paired device.
        ...(['prompt', 'user_input.respond'].includes(params.type) ? { requestContext: { turnId, localThreadId: `mobile-device:${this.owner}` } } : {})
      });
      } catch (error) { if (!fleetRead || !this.fleet) throw error; liveFailure = error; }
      if (fleetRead && this.fleet) {
        try { result = await this.fleet.read(params.sessionKey, params.type, payload, result); }
        catch (error) { if (result == null) throw error; }
      }
      if (liveFailure && result == null) throw liveFailure;
      if (params.type === 'user_input.respond' && payload.cancelled !== true && result?.cancelled !== true && result?.continuation?.state !== 'completed') {
        throw fault('HOST_UPDATE_REQUIRED', 'The answer was received, but this PC needs a Zyra runtime restart to continue it. Open the chat on the PC.');
      }
      for (const id of [...imageUploads, ...fileUploads]) await this.uploads.cancel(this.owner, params.sessionKey, id).catch(() => {});
      return this.cache.project(this.owner, ['agents.list', 'workflows.list'].includes(params.type) ? projectFleetList(result, payload) : result);
    }
    throw fault('METHOD_NOT_ALLOWED', 'This operation is not available through mobile access.');
  }
}
// Voice signaling is tied to a live connection; never replay a prior connection's
// start/stop or persist transient Voice events in the durable command ledger.
export const isRead = (method, params = {}) => ['account.limits', 'account.usage', 'session.details'].includes(method) || REVIEW_METHODS.has(method) || DICTATION_METHODS.has(method) || PLUGIN_READS.has(method) || READS.has(method) || WORKSPACE_READS.has(method) || VOICE_METHODS.has(method) || VIEW_METHODS.has(method) || ['upload.begin', 'upload.status', 'upload.chunk', 'upload.finish', 'upload.cancel', 'fleet.definition', 'host.status', 'operation.status', 'media.chunk', 'body.chunk', 'session.attach', 'session.detach', 'terminal.list', 'terminal.attach', 'terminal.detach', 'terminal.input', 'terminal.resize'].includes(method)
  || (method === 'session.request' && (params.type === 'preferences.get' || /^(agents|workflows)\.(list|listDefinitions|listRuns|status|transcript)$/.test(params.type)));


