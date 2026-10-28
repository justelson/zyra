import { Type } from 'typebox';

export const CONTEXT_TOOL_NAME = 'context';

/** The host binds the caller's own session. No target/session identifier is accepted. */
export function createContextManagementTool({ getSession, getDiagnostics }) {
  if (typeof getSession !== 'function') throw new TypeError('A caller-bound getSession callback is required');
  return {
    name: CONTEXT_TOOL_NAME,
    label: 'Context',
    description: 'Inspect your own context usage or request one safe compaction during this task. compact returns pending immediately; maintenance runs after every result in the current tool batch is recorded. Continue the SAME task afterward. Use inspect to see completion/failure. Never request repeated compaction instead of doing the task.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('inspect'), Type.Literal('compact')]),
      instructions: Type.Optional(Type.String({ maxLength: 4000, description: 'Optional summary focus. Preserve the user goal, constraints, decisions, pending work and exact references.' })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      if (!params || Object.keys(params).some(key => !['action', 'instructions'].includes(key))) {
        throw new Error('context only accepts action and optional instructions for your own session');
      }
      if (params.action !== 'inspect' && params.action !== 'compact') throw new Error('Unknown context action');
      if (params.instructions !== undefined && (typeof params.instructions !== 'string' || params.instructions.length > 4000)) {
        throw new Error('instructions must be a string of at most 4000 characters');
      }
      if (params.action === 'inspect' && params.instructions !== undefined) throw new Error('instructions are only accepted for compact');
      const session = getSession();
      if (!session) throw new Error('Own session is not available');
      const details = params.action === 'inspect'
        ? { ...session.inspectContext(), ...(getDiagnostics ? { diagnostics: await getDiagnostics() } : {}) }
        : session.requestContextCompaction(params.instructions === undefined ? undefined : { instructions: params.instructions });
      const text = params.action === 'inspect'
        ? JSON.stringify(details)
        : `${JSON.stringify(details)}\nCompaction is requested, not finished. Continue this task after the current tool batch; inspect reports its outcome.`;
      return { content: [{ type: 'text', text }], details };
    },
  };
}
