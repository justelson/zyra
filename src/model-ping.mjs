// Internal recovery instruction, never a second user submission or a model tool.
export const MODEL_PING_MESSAGE_TYPE = 'zyra.model-ping.v1';
export function pingActiveModel(runtime, requestId) {
  if (!runtime?.session || runtime.session.isCompacting) throw new Error('The model is not available for Ping.');
  if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw new Error('An exact model request is required.');
  const progress = runtime.session.agent.modelRequestProgress;
  if (!progress || progress.requestId !== requestId || !progress.canPing) throw new Error('That model request is no longer available for Ping.');
  if (Date.now() - progress.lastActivityAt < 120_000) throw new Error('The model has received activity again. Keep waiting.');
  const message = {
    role: 'custom', customType: MODEL_PING_MESSAGE_TYPE, display: false,
    content: [{ type: 'text', text: '[User requested recovery of this turn after suspected model inactivity.] Give a brief, concrete progress update before continuing the original task. Continue from the completed work and tool results already in context. Do not repeat completed actions, expand the task, or claim the interrupted request succeeded. This is a recovery instruction inside the existing turn, not a new task.' }],
    timestamp: Date.now(), details: { requestId },
  };
  runtime.session.agent.pingModel(requestId, message);
  return { accepted: true, requestId };
}
