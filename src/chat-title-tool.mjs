import { Type } from 'typebox';

export const CHAT_TITLE_TOOL_NAME = 'set_chat_title';

/** Unknown existing titles are locked. Only a new, unnamed chat opts in. */
export function initialChatTitleState(chat, metadata = {}) {
  const source = metadata.titleSource;
  return {
    title: String(chat?.title || ''),
    eligible: source === 'initial' || source === 'provisional'
      || (!source && !metadata.title && Number(chat?.messageCount) === 0
        && /^(?:new chat|new session|untitled(?: chat| session)?|)$/i.test(String(chat?.title || '').trim())),
  };
}

export function createChatTitleController(onTitle) {
  let state = { eligible: false, title: '' };
  return {
    prepare(value) {
      state = { eligible: value?.eligible === true, title: String(value?.title || '') };
      return state.eligible
        ? 'Before any visible response or other tool call, call set_chat_title with a concise title under 60 characters describing the user\'s actual task. This is hidden chat metadata, never message text. If the user only greets you or has not given a concrete topic, set provisional:true; replace that title when a real task becomes clear. Do not narrate or repeat the title. Later title refreshes belong to a separate utility, not this tool.'
        : 'The chat title is already set or manually named. Do not call set_chat_title or print a title in your response.';
    },
    tool: {
      name: CHAT_TITLE_TOOL_NAME,
      label: 'Set chat title',
      description: 'Set the initial chat title as hidden metadata before your first visible response. Only available while the title is initial or provisional. Never repeat the title in chat.',
      parameters: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 60, description: 'Concrete, concise chat title. No markdown, URLs or commentary.' }),
        provisional: Type.Optional(Type.Boolean({ description: 'True for a greeting or an unclear task, so the next concrete request can replace it.' })),
      }, { additionalProperties: false }),
      async execute(_id, params) {
        const title = String(params?.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!title || title.length > 60 || /https?:\/\//i.test(title)) throw new Error('Provide a concise title under 60 characters, not a URL.');
        if (!state.eligible) return { content: [{ type: 'text', text: 'Chat title is already owned. Continue with the user request.' }], details: { hiddenFromTimeline: true } };
        const previous = state;
        state = { ...state, eligible: false };
        try {
          await onTitle({ title, titleSource: params.provisional === true ? 'provisional' : 'model', expectedTitle: previous.title });
        } catch (error) {
          state = previous;
          throw error;
        }
        return { content: [{ type: 'text', text: 'Chat title metadata submitted.' }], details: { hiddenFromTimeline: true } };
      },
    },
  };
}
