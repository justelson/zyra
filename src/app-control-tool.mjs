import { Type } from 'typebox';
import { defineZyraTool } from './agents/define-zyra-tool.mjs';

/** Domain operations, never an arbitrary Desktop IPC or JavaScript escape hatch. */
export function createAppControlTools(client) {
  if (!client) return [];
  const object = Type.Record(Type.String(), Type.Unknown());
  const tool = (name, description, domain, actions) => defineZyraTool({
    name, label: name === 'app' ? 'Zyra app' : name === 'usage' ? 'Usage and limits' : name === 'settings' ? 'Zyra settings' : 'Settings action',
    description,
    parameters: Type.Object({ action: Type.Union(actions.map(value => Type.Literal(value))),
      area: Type.Optional(Type.String({ maxLength: 80 })),
      target: Type.Optional(Type.String({ maxLength: 512, description: 'Exact authorized Chat/Project ID, or current. Discover targets first.' })),
      surface: Type.Optional(Type.Union([Type.Literal('desktop'), Type.Literal('browser')])),
      query: Type.Optional(Type.String({ maxLength: 2000 })),
      keys: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      patch: Type.Optional(object),
      expectedRevision: Type.Optional(Type.Number()),
      input: Type.Optional(object),
    }),
    execute: async (toolCallId, params) => {
      const { action, ...input } = params;
      const result = await client.request({ action: 'app', domain, operation: action, params: input, dedupeKey: toolCallId });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { appOperation: true } };
    },
  });
  return [
    tool('settings', 'Discover and manage Zyra settings through their actual owning service. List/get show constraints, supported scope, saved/effective/default values and effect timing. Preview before changing persistent preferences; apply/reset require expectedRevision. Current Chat changes do not change remembered new-Chat choices unless explicitly requested. Do not change settings for your convenience without user intent. Secrets never enter arguments or results. Protected changes use real user approval; confirmed:true is not approval. history/undo provide redacted, revision-checked receipts. Desktop-only operations fail visibly when its owner is unavailable.', 'settings', ['list', 'get', 'preview', 'apply', 'reset', 'history', 'undo', 'open']),
    tool('settings_action', 'Discover named Zyra operations beyond preferences. Use list and preview to inspect prerequisites, exact targets, disruptive effects and approval. run invokes only a registered operation selected with area; no arbitrary IPC, shell or JavaScript. Credentials and privacy consent use their secure UI. Destructive actions, executable trust, access increases, paid actions and runtime activation require actual user approval and cannot be self-approved.', 'settings_action', ['list', 'preview', 'run']),
    tool('app', 'Inspect and operate authorized Zyra objects: chats, projects, work, queues, resources, models, plugins, skills, connections, navigation and runtime. Start with list/inspect to discover capabilities and exact targets. Rename or reorder only when user-directed; title changes preserve manual ownership and never restart work. Chat order is the actual sidebar order; moving preserves unmentioned chats and uses expectedRevision. Current means this tool caller Chat, not whichever Chat the user is viewing. Default scope is its Project, or this Chat when projectless. For a user-directed cross-Project operation, request input.appScope=installation; the server obtains real consent for that exact operation, including expanded reads. This never grants filesystem access. Search is scoped, not a dump of private history. A fork needs input.entryId from persisted history or an exact Desktop message ID; input.worktree is shared or isolated. Shared keeps current files; isolated creates a real Git worktree at current HEAD, not at the history date. Forking never restores historical files, selects the fork or sends a prompt. Browser/computer/files/Git/workflow actions reuse existing scoped tools. Never grant yourself access, approve your own requests, answer for the user, steal focus or silently restart work.', 'app', ['list', 'inspect', 'search', 'read', 'preview', 'rename', 'refresh_title', 'move', 'reorder', 'pin', 'unpin', 'settle', 'restore', 'archive', 'unarchive', 'create', 'fork', 'update', 'hold', 'resume', 'remove', 'stop', 'undo', 'open']),
    tool('usage', 'Read first-class usage, limits and capacity for authorized connected accounts and Chats. Reports each available window, percent used/left, reset timestamp/countdown, duration, account/routing readiness, last-check freshness, model context and token/cost consumption. Missing provider data stays unknown; estimates are labeled. Refresh is read-only and never redeems credits, signs in or changes routing. Use area accounts, chat, models or runtime; target defaults to current Chat.', 'usage', ['get', 'refresh']),
  ];
}
