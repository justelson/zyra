import { Type } from 'typebox';

export const ASSISTANT_ACTION_BATCH_TOOL_NAME = 'begin_action_batch';
export const ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH = 72;

export function normalizeAssistantActionBatchIntent(value) {
  const normalized = typeof value === 'string'
    ? value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/^[#>*_`\s-]+|[#>*_`\s-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
  if (!normalized) return null;
  return normalized.slice(0, ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH).trimEnd() || null;
}

export function createAssistantActionBatchTool() {
  return {
    name: ASSISTANT_ACTION_BATCH_TOOL_NAME,
    label: 'Begin Action batch',
    description: 'Declare the short intent shown after the next consecutive group of Actions settles. Call immediately before the Actions, after any user-facing narration. This marker is hidden from the Work timeline.',
    parameters: Type.Object({
      title: Type.String({
        description: 'A concise present-participle phrase describing the shared intent, such as “Reviewing timeline behavior”.',
        minLength: 1,
        maxLength: ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH,
      }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      const actionBatchIntent = normalizeAssistantActionBatchIntent(params?.title);
      if (!actionBatchIntent) throw new Error('Action batch title is required.');
      return {
        content: [{ type: 'text', text: `Action batch intent set to: ${actionBatchIntent}` }],
        details: {
          actionBatchIntent,
          hiddenFromTimeline: true,
        },
      };
    },
  };
}
