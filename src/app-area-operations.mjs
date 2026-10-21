/** Public area verbs are explicit. A read/preview can never fall through to a mutation. */
export const APP_AREA_OPERATIONS = Object.freeze({
  chats: ['list', 'inspect', 'search', 'read', 'preview', 'rename', 'refresh_title', 'move', 'reorder', 'pin', 'unpin', 'settle', 'restore', 'archive', 'unarchive', 'create', 'fork', 'undo', 'open'],
  order: ['list', 'inspect', 'preview', 'move', 'reorder', 'pin', 'unpin', 'undo'],
  queues: ['list', 'inspect', 'read', 'update', 'move', 'remove', 'hold', 'resume', 'stop'],
  navigation: ['open'], projects: ['list', 'inspect', 'preview', 'create', 'update'],
  models: ['list', 'inspect'], plugins: ['list', 'inspect'], skills: ['list', 'inspect'], connections: ['inspect'],
  work: ['inspect', 'read', 'stop'], attention: ['inspect'], agents: ['inspect'], workflows: ['inspect'],
  resources: ['list', 'read'], runtime: ['inspect'], files: [], git: [], browser: [], computer: [],
});
export function isAppAreaOperation(area, operation) {
  return !area ? operation === 'list' : Object.hasOwn(APP_AREA_OPERATIONS, area) && APP_AREA_OPERATIONS[area].includes(operation);
}
