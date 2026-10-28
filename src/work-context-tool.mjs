import path from 'node:path';
import { statSync } from 'node:fs';
import { Type } from 'typebox';
import { WORK_KINDS, normalizeWorkContextInput, readChatWorkContext } from './chat-work-context.mjs';

export function createWorkContextController({ onUpdate, canReadFolder }) {
  let previous = null;
  return {
    prepare(value) {
      if (value !== undefined) {
        const saved = readChatWorkContext(value);
        previous = saved ? { folderPath: saved.folderPath, kind: saved.kind } : null;
      }
      return `When substantial work begins or its main folder/category genuinely changes, call set_work_context. Report the specific existing folder where that work is taking place, not merely the repository you briefly read. Use folderPath:null when no specific folder applies; the app uses your current directory as its display fallback. Do not update for temporary cd commands, incidental file reads, greetings, or each tool call. Keep the last work context when work ends. The app finds artwork; never search for icons. This is quiet metadata for this chat only, not permission or a working-directory change. Current saved display metadata: ${JSON.stringify(previous)}.`;
    },
    tool: {
      name: 'set_work_context',
      label: 'Set work context',
      description: 'Quietly report this chat\'s substantial work folder and category. Update only when meaningful work starts or genuinely changes. The app resolves artwork. Does not change cwd, Project membership, permissions, title or focus.',
      parameters: Type.Object({
        folderPath: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 4096, description: 'Absolute existing folder for the main work. Null uses the current agent folder.' }), Type.Null()])),
        kind: Type.Union(WORK_KINDS.map(kind => Type.Literal(kind))),
      }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        if (signal?.aborted) throw new Error('Work context update cancelled.');
        let next = normalizeWorkContextInput(params);
        if (next.folderPath) {
          if (!path.isAbsolute(next.folderPath)) throw new Error('Use an absolute folder path for this operating system.');
          const folder = path.resolve(next.folderPath);
          if (!await canReadFolder(folder)) throw new Error('Work folder is outside the current filesystem scope. Metadata cannot grant access.');
          if (!statSync(folder).isDirectory()) throw new Error('Report an existing folder, not a file.');
          next = normalizeWorkContextInput({ ...next, folderPath: folder });
        }
        if (signal?.aborted) throw new Error('Work context update cancelled.');
        const duplicate = JSON.stringify(previous) === JSON.stringify(next);
        if (!duplicate) {
          await onUpdate(next);
          previous = next;
        }
        return { content: [{ type: 'text', text: duplicate ? 'Work context unchanged.' : 'Work context metadata submitted.' }], details: { hiddenFromTimeline: true } };
      },
    },
  };
}
