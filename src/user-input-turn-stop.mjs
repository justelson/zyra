/** Async questions are durable messages, not a request to terminate the turn. */
export function installDeferredUserInputTurnStop(session) {
  const agent = session?.agent;
  if (!agent) return;
  const previousShouldStop = agent.shouldStopAfterTurn;
  agent.shouldStopAfterTurn = async (context, signal) => {
    const blockingHandoff = Array.isArray(context?.toolResults) && context.toolResults.some(result =>
      result?.toolName === 'request_user_input' && result?.details?.deferred === true && result?.details?.mode !== 'async');
    if (blockingHandoff) return true;
    return typeof previousShouldStop === 'function' ? Boolean(await previousShouldStop(context, signal)) : false;
  };
}
