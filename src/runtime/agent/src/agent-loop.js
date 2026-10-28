// Generated from the maintained TypeScript in ../source by scripts/build-owned-runtime.mjs.
import {
  EventStream,
  validateToolArguments
} from "../../providers/src/index.js";
import { getDefaultStreamFn } from "./stream-fn.js";
function agentLoop(prompts, context, config, signal, streamFn) {
  const stream = createAgentStream();
  void runAgentLoop(
    prompts,
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn
  ).then((messages) => {
    stream.end(messages);
  });
  return stream;
}
function agentLoopContinue(context, config, signal, streamFn) {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }
  if (context.messages[context.messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }
  const stream = createAgentStream();
  void runAgentLoopContinue(
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn
  ).then((messages) => {
    stream.end(messages);
  });
  return stream;
}
async function runAgentLoop(prompts, context, config, emit, signal, streamFn) {
  const newMessages = [...prompts];
  const currentContext = {
    ...context,
    messages: [...context.messages, ...prompts]
  };
  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }
  await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
  return newMessages;
}
async function runAgentLoopContinue(context, config, emit, signal, streamFn) {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }
  if (context.messages[context.messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }
  const newMessages = [];
  const currentContext = { ...context };
  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
  return newMessages;
}
function createAgentStream() {
  return new EventStream(
    (event) => event.type === "agent_end",
    (event) => event.type === "agent_end" ? event.messages : []
  );
}
async function runLoop(initialContext, newMessages, initialConfig, signal, emit, streamFunction) {
  let currentContext = initialContext;
  let config = initialConfig;
  let firstTurn = true;
  let pendingMessages = await config.getSteeringMessages?.() || [];
  while (true) {
    let hasMoreToolCalls = true;
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!firstTurn) {
        await emit({ type: "turn_start" });
      } else {
        firstTurn = false;
      }
      if (pendingMessages.length > 0) {
        for (const message2 of pendingMessages) {
          await emit({ type: "message_start", message: message2 });
          await emit({ type: "message_end", message: message2 });
          currentContext.messages.push(message2);
          newMessages.push(message2);
        }
        pendingMessages = [];
      }
      const message = await streamAssistantResponse(currentContext, newMessages, config, signal, emit, streamFunction);
      newMessages.push(message);
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "turn_end", message, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }
      const toolCalls = message.content.filter((c) => c.type === "toolCall");
      const toolResults = [];
      hasMoreToolCalls = false;
      if (toolCalls.length > 0) {
        const executedToolBatch = message.stopReason === "length" ? await failToolCallsFromTruncatedMessage(toolCalls, emit) : await executeToolCalls(currentContext, message, config, signal, emit);
        toolResults.push(...executedToolBatch.messages);
        hasMoreToolCalls = !executedToolBatch.terminate;
        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }
      await emit({ type: "turn_end", message, toolResults });
      const nextTurnContext = {
        message,
        toolResults,
        context: currentContext,
        newMessages
      };
      const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
      if (nextTurnSnapshot) {
        currentContext = nextTurnSnapshot.context ?? currentContext;
        config = {
          ...config,
          model: nextTurnSnapshot.model ?? config.model,
          reasoning: nextTurnSnapshot.thinkingLevel === void 0 ? config.reasoning : nextTurnSnapshot.thinkingLevel === "off" ? void 0 : nextTurnSnapshot.thinkingLevel
        };
      }
      if (await config.shouldStopAfterTurn?.({
        message,
        toolResults,
        context: currentContext,
        newMessages
      })) {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }
      pendingMessages = await config.getSteeringMessages?.() || [];
    }
    const followUpMessages = await config.getFollowUpMessages?.() || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }
    break;
  }
  await emit({ type: "agent_end", messages: newMessages });
}
async function streamAssistantResponse(context, newMessages, config, signal, emit, streamFunction) {
  const control = config.modelRequestControl;
  while (true) {
    let requestSignal = signal;
    let partialMessage = null;
    let partialIndex = -1;
    let finalMessage;
    let failure;
    let failed = false;
    const checkCancelled = () => {
      if (requestSignal?.aborted) throw new Error("Model request aborted");
    };
    try {
      checkCancelled();
      let messages = context.messages;
      if (config.transformContext) messages = await config.transformContext(messages, requestSignal);
      checkCancelled();
      const llmMessages = await config.convertToLlm(messages);
      checkCancelled();
      const llmContext = {
        systemPrompt: context.systemPrompt,
        messages: llmMessages,
        tools: context.tools
      };
      const resolvedApiKey = (config.getApiKey ? await config.getApiKey(config.model.provider) : void 0) || config.apiKey;
      checkCancelled();
      requestSignal = control ? await control.begin(signal) : signal;
      checkCancelled();
      const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal: requestSignal
      });
      const result = response.result();
      void result.catch(() => {
      });
      try {
        for await (const event of response) {
          if (requestSignal?.aborted) continue;
          const content = "partial" in event ? event.partial.content : event.type === "done" ? event.message.content : event.type === "error" ? event.error.content : [];
          const unsafe = event.type.startsWith("text_") || event.type.startsWith("toolcall_") || event.type === "done" || event.type === "error" || content.some((part) => part.type === "toolCall" || part.type === "text" && part.text.length > 0);
          await control?.activity(unsafe);
          if (requestSignal?.aborted) continue;
          switch (event.type) {
            case "start":
              partialMessage = { ...event.partial };
              partialIndex = context.messages.length;
              context.messages.push(partialMessage);
              await emit({ type: "message_start", message: partialMessage });
              break;
            case "text_start":
            case "text_delta":
            case "text_end":
            case "thinking_start":
            case "thinking_delta":
            case "thinking_end":
            case "toolcall_start":
            case "toolcall_delta":
            case "toolcall_end":
              if (partialMessage) {
                partialMessage = { ...event.partial };
                context.messages[partialIndex] = partialMessage;
                await emit({ type: "message_update", assistantMessageEvent: event, message: partialMessage });
              }
              break;
          }
        }
      } finally {
        finalMessage = await result;
      }
    } catch (error) {
      failed = true;
      failure = error;
    }
    await control?.flush();
    const recovery = control?.recovery;
    const requestId = control?.requestId;
    if (recovery && requestId && partialMessage) {
      context.messages.splice(partialIndex, 1);
      await emit({ type: "message_discarded", message: partialMessage, reason: "model_ping", requestId });
      partialMessage = null;
      partialIndex = -1;
    }
    await control?.end();
    if (recovery && requestId && !signal?.aborted) {
      await emit({ type: "message_start", message: recovery });
      await emit({ type: "message_end", message: recovery });
      context.messages.push(recovery);
      newMessages.push(recovery);
      if (!signal?.aborted) {
        await emit({ type: "model_ping", requestId, status: "resumed" });
        if (!signal?.aborted) continue;
      }
    }
    if (signal?.aborted) {
      finalMessage = recovery ? abortedModelMessage(config) : {
        ...finalMessage ?? partialMessage ?? abortedModelMessage(config),
        stopReason: "aborted",
        errorMessage: "Operation aborted"
      };
    } else if (failed) {
      throw failure;
    }
    if (!finalMessage) throw new Error("Model request settled without a result");
    if (partialIndex >= 0) context.messages[partialIndex] = finalMessage;
    else context.messages.push(finalMessage);
    if (!partialMessage) await emit({ type: "message_start", message: { ...finalMessage } });
    await emit({ type: "message_end", message: finalMessage });
    return finalMessage;
  }
}
function abortedModelMessage(config) {
  return {
    role: "assistant",
    content: [],
    api: config.model.api,
    provider: config.model.provider,
    model: config.model.id,
    stopReason: "aborted",
    errorMessage: "Operation aborted",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  };
}
async function failToolCallsFromTruncatedMessage(toolCalls, emit) {
  const messages = [];
  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments
    });
    const finalized = {
      toolCall,
      result: createErrorToolResult(
        `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`
      ),
      isError: true
    };
    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }
  return { messages, terminate: false };
}
async function executeToolCalls(currentContext, assistantMessage, config, signal, emit) {
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
  const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential"
  );
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}
async function executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit) {
  const finalizedCalls = [];
  const messages = [];
  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments
    });
    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    let finalized;
    if (preparation.kind === "immediate") {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError
      };
    } else {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal
      );
    }
    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    finalizedCalls.push(finalized);
    messages.push(toolResultMessage);
    if (signal?.aborted) {
      break;
    }
  }
  return {
    messages,
    terminate: shouldTerminateToolBatch(finalizedCalls)
  };
}
async function executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit) {
  const finalizedCalls = [];
  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments
    });
    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    if (preparation.kind === "immediate") {
      const finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError
      };
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      if (signal?.aborted) {
        break;
      }
      continue;
    }
    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal
      );
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
    if (signal?.aborted) {
      break;
    }
  }
  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) => typeof entry === "function" ? entry() : Promise.resolve(entry))
  );
  const messages = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }
  return {
    messages,
    terminate: shouldTerminateToolBatch(orderedFinalizedCalls)
  };
}
function shouldTerminateToolBatch(finalizedCalls) {
  return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}
function prepareToolCallArguments(tool, toolCall) {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  return {
    ...toolCall,
    arguments: preparedArguments
  };
}
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true
    };
  }
  try {
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    const validatedArgs = validateToolArguments(tool, preparedToolCall);
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext
        },
        signal
      );
      if (signal?.aborted) {
        return {
          kind: "immediate",
          result: createErrorToolResult("Operation aborted"),
          isError: true
        };
      }
      if (beforeResult?.block) {
        const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
        if (beforeResult.terminate === true) {
          result.terminate = true;
        }
        return {
          kind: "immediate",
          result,
          isError: true
        };
      }
    }
    if (signal?.aborted) {
      return {
        kind: "immediate",
        result: createErrorToolResult("Operation aborted"),
        isError: true
      };
    }
    return {
      kind: "prepared",
      toolCall,
      tool,
      args: validatedArgs
    };
  } catch (error) {
    return {
      kind: "immediate",
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true
    };
  }
}
async function executePreparedToolCall(prepared, signal, emit) {
  const updateEvents = [];
  let acceptingUpdates = true;
  try {
    const result = await prepared.tool.execute(
      prepared.toolCall.id,
      prepared.args,
      signal,
      (partialResult) => {
        if (!acceptingUpdates) return;
        updateEvents.push(
          Promise.resolve(
            emit({
              type: "tool_execution_update",
              toolCallId: prepared.toolCall.id,
              toolName: prepared.toolCall.name,
              args: prepared.toolCall.arguments,
              partialResult
            })
          )
        );
      }
    );
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return { result, isError: false };
  } catch (error) {
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return {
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true
    };
  } finally {
    acceptingUpdates = false;
  }
}
async function finalizeExecutedToolCall(currentContext, assistantMessage, prepared, executed, config, signal) {
  let result = executed.result;
  let isError = executed.isError;
  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall(
        {
          assistantMessage,
          toolCall: prepared.toolCall,
          args: prepared.args,
          result,
          isError,
          context: currentContext
        },
        signal
      );
      if (afterResult) {
        result = {
          ...result,
          content: afterResult.content ?? result.content,
          details: afterResult.details ?? result.details,
          usage: afterResult.usage ?? result.usage,
          terminate: afterResult.terminate ?? result.terminate
        };
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      result = createErrorToolResult(error instanceof Error ? error.message : String(error));
      isError = true;
    }
  }
  return {
    toolCall: prepared.toolCall,
    result,
    isError
  };
}
function createErrorToolResult(message) {
  return {
    content: [{ type: "text", text: message }],
    details: {}
  };
}
async function emitToolExecutionEnd(finalized, emit) {
  await emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError
  });
}
function createToolResultMessage(finalized) {
  return {
    role: "toolResult",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    // Untyped tools (JS extensions) can return results without content; normalize
    // so the null never enters session history or provider payloads.
    content: finalized.result.content ?? [],
    details: finalized.result.details,
    usage: finalized.result.usage,
    ...finalized.result.addedToolNames?.length ? { addedToolNames: finalized.result.addedToolNames } : {},
    isError: finalized.isError,
    timestamp: Date.now()
  };
}
async function emitToolResultMessage(toolResultMessage, emit) {
  await emit({ type: "message_start", message: toolResultMessage });
  await emit({ type: "message_end", message: toolResultMessage });
}
export {
  agentLoop,
  agentLoopContinue,
  runAgentLoop,
  runAgentLoopContinue
};
