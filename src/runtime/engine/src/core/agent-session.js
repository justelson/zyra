// Generated from the maintained TypeScript in ../source by scripts/build-owned-runtime.mjs.
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { contentText } from "../../../providers/src/index.js";
import {
  clampThinkingLevel,
  cleanupSessionResources,
  getSupportedThinkingLevels,
  isContextOverflow,
  isRecoverableLength,
  isRetryableAssistantError,
  modelsAreEqual,
  resetApiProviders,
  streamSimple
} from "../../../providers/src/compat.js";
import { getThemeByName, theme } from "../modes/interactive/theme/theme.js";
import { stripFrontmatter } from "../utils/frontmatter.js";
import { sleep } from "../utils/sleep.js";
import { normalizeToolResultImages } from "../utils/tool-result-images.js";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.js";
import { executeBashWithOperations } from "./bash-executor.js";
import {
  calculateContextTokens,
  collectEntriesForBranchSummary,
  compact,
  estimateContextTokens,
  estimateTokens,
  generateBranchSummary,
  prepareCompaction,
  shouldCompact
} from "./compaction/index.js";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "./defaults.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.js";
import {
  ExtensionRunner,
  wrapRegisteredTools
} from "./extensions/index.js";
import { emitSessionShutdownEvent } from "./extensions/runner.js";
import { ModelRegistry } from "./model-registry.js";
import { expandPromptTemplate } from "./prompt-templates.js";
import { exportSessionToJsonl } from "./session-export.js";
import { getLatestCompactionEntry } from "./session-manager.js";
import { createSyntheticSourceInfo } from "./source-info.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createLocalBashOperations } from "./tools/bash.js";
import { createAllToolDefinitions } from "./tools/index.js";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.js";
import { addUsageToTotals, createUsageTotals } from "./usage-totals.js";
function parseSkillBlock(text) {
  const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || void 0
  };
}
function withoutDeletedHeaders(headers) {
  return headers ? Object.fromEntries(Object.entries(headers).filter((entry) => entry[1] !== null)) : void 0;
}
function estimateMessagesTokens(messages) {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateTokens(message);
  }
  return tokens;
}
class AgentSession {
  agent;
  sessionManager;
  settingsManager;
  _scopedModels;
  // Event subscription state
  _unsubscribeAgent;
  _eventListeners = [];
  _isAgentRunActive = false;
  _agentRunAbortEpoch = 0;
  _idleWaitPromise;
  _resolveIdleWait;
  /** Tracks pending steering messages for UI display. Removed when delivered. */
  _steeringMessages = [];
  /** Tracks pending follow-up messages for UI display. Removed when delivered. */
  _followUpMessages = [];
  /** Messages queued to be included with the next user prompt as context ("asides"). */
  _pendingNextTurnMessages = [];
  // Compaction state
  _compactionAbortController = void 0;
  _autoCompactionAbortController = void 0;
  _overflowRecoveryAttempted = false;
  // Branch summarization state
  _branchSummaryAbortController = void 0;
  // Retry state
  _retryAbortController = void 0;
  _retryAttempt = 0;
  // Bash execution state
  _bashAbortControllers = /* @__PURE__ */ new Set();
  _pendingBashMessages = [];
  // Extension system
  _extensionRunner;
  _turnIndex = 0;
  _resourceLoader;
  _customTools;
  _baseToolDefinitions = /* @__PURE__ */ new Map();
  _cwd;
  _extensionRunnerRef;
  _initialActiveToolNames;
  _allowedToolNames;
  _excludedToolNames;
  _baseToolsOverride;
  _sessionStartEvent;
  _extensionUIContext;
  _extensionMode = "print";
  _extensionCommandContextActions;
  _extensionAbortHandler;
  _extensionShutdownHandler;
  _extensionErrorListener;
  _extensionErrorUnsubscriber;
  _modelRuntime;
  // Tool registry for extension getTools/setTools
  _toolRegistry = /* @__PURE__ */ new Map();
  _toolDefinitions = /* @__PURE__ */ new Map();
  _toolPromptSnippets = /* @__PURE__ */ new Map();
  _toolPromptGuidelines = /* @__PURE__ */ new Map();
  // Base system prompt (without extension appends) - used to apply fresh appends each turn
  _baseSystemPrompt = "";
  _baseSystemPromptOptions;
  _systemPromptOverride;
  constructor(config) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
    this._scopedModels = config.scopedModels ?? [];
    this._resourceLoader = config.resourceLoader;
    this._customTools = config.customTools ?? [];
    this._cwd = config.cwd;
    this._modelRuntime = config.modelRuntime;
    this._extensionRunnerRef = config.extensionRunnerRef;
    this._initialActiveToolNames = config.initialActiveToolNames;
    this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : void 0;
    this._excludedToolNames = config.excludedToolNames ? new Set(config.excludedToolNames) : void 0;
    this._baseToolsOverride = config.baseToolsOverride;
    this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
    this._installAgentToolHooks();
    this._installAgentNextTurnRefresh();
    this._buildRuntime({
      activeToolNames: this._initialActiveToolNames,
      includeAllExtensionTools: true
    });
  }
  get modelRuntime() {
    return this._modelRuntime;
  }
  async _getRequiredRequestAuth(model) {
    let result;
    try {
      result = await this._modelRuntime.getAuth(model);
    } catch (error) {
      const cause = error instanceof Error ? error.cause : void 0;
      if (cause instanceof Error && cause.message === "authHeader requires a resolved API key") {
        throw new Error(formatNoApiKeyFoundMessage(model.provider));
      }
      throw error;
    }
    if (result && (result.auth.apiKey || result.auth.headers)) {
      const requestModel = result.auth.baseUrl ? { ...model, baseUrl: result.auth.baseUrl } : model;
      return {
        model: requestModel,
        apiKey: result.auth.apiKey,
        headers: withoutDeletedHeaders(result.auth.headers),
        env: result.env
      };
    }
    const isOAuth = this._modelRuntime.isUsingOAuth(model.provider);
    if (isOAuth) {
      throw new Error(
        `Authentication failed for "${model.provider}". Credentials may have expired or network is unavailable. Run '/login ${model.provider}' to re-authenticate.`
      );
    }
    throw new Error(formatNoApiKeyFoundMessage(model.provider));
  }
  async _getSummarizationRequestAuth(model) {
    if (this.agent.streamFunction === streamSimple) {
      return this._getRequiredRequestAuth(model);
    }
    try {
      const result = await this._modelRuntime.getAuth(model);
      if (!result) return { model };
      const requestModel = result.auth.baseUrl ? { ...model, baseUrl: result.auth.baseUrl } : model;
      return {
        model: requestModel,
        apiKey: result.auth.apiKey,
        headers: withoutDeletedHeaders(result.auth.headers),
        env: result.env
      };
    } catch {
      return { model };
    }
  }
  /**
   * Install tool hooks once on the Agent instance.
   *
   * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
   * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
   * registered tool execution to the extension context. Tool call and tool result interception now
   * happens here instead of in wrappers.
   */
  _installAgentToolHooks() {
    this.agent.beforeToolCall = async ({ toolCall, args }) => {
      const runner = this._extensionRunner;
      if (!runner.hasHandlers("tool_call")) {
        return void 0;
      }
      try {
        return await runner.emitToolCall({
          type: "tool_call",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          input: args
        });
      } catch (err) {
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(`Extension failed, blocking execution: ${String(err)}`);
      }
    };
    this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
      const runner = this._extensionRunner;
      const hookResult = runner.hasHandlers("tool_result") ? await runner.emitToolResult({
        type: "tool_result",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        input: args,
        content: result.content,
        details: result.details,
        isError,
        usage: result.usage
      }) : void 0;
      const content = hookResult?.content ?? result.content ?? [];
      const normalizedContent = await normalizeToolResultImages(content, {
        autoResizeImages: this.settingsManager.getImageAutoResize()
      });
      if (!hookResult && normalizedContent === content) {
        return void 0;
      }
      return {
        content: normalizedContent,
        details: hookResult?.details,
        isError: hookResult?.isError ?? isError,
        usage: hookResult?.usage
      };
    };
  }
  _installAgentNextTurnRefresh() {
    const previousPrepareNextTurnWithContext = this.agent.prepareNextTurnWithContext ?? (this.agent.prepareNextTurn ? async (_turn, signal) => await this.agent.prepareNextTurn?.(signal) : void 0);
    this.agent.prepareNextTurnWithContext = async (turn, signal) => {
      const previousSnapshot = await previousPrepareNextTurnWithContext?.(turn, signal);
      const previousContext = previousSnapshot?.context ?? turn.context;
      return {
        ...previousSnapshot,
        context: {
          ...previousContext,
          systemPrompt: this._systemPromptOverride ?? this._baseSystemPrompt,
          tools: this.agent.state.tools.slice()
        },
        model: this.agent.state.model,
        thinkingLevel: this.agent.state.thinkingLevel
      };
    };
  }
  // =========================================================================
  // Event Subscription
  // =========================================================================
  /** Emit an event to all listeners */
  _emit(event) {
    for (const l of this._eventListeners) {
      l(event);
    }
  }
  _emitQueueUpdate() {
    this._emit({
      type: "queue_update",
      steering: [...this._steeringMessages],
      followUp: [...this._followUpMessages]
    });
  }
  async _emitSessionCompactFailed(event) {
    if (this._extensionRunner.hasHandlers("session_compact_failed")) {
      await this._extensionRunner.emit({ type: "session_compact_failed", ...event });
    }
  }
  _getIdleWaitPromise() {
    if (!this._idleWaitPromise) {
      this._idleWaitPromise = new Promise((resolve) => {
        this._resolveIdleWait = resolve;
      });
    }
    return this._idleWaitPromise;
  }
  _resolveIdleWaitIfIdle() {
    if (this._isAgentRunActive || !this._resolveIdleWait) {
      return;
    }
    const resolve = this._resolveIdleWait;
    this._idleWaitPromise = void 0;
    this._resolveIdleWait = void 0;
    resolve();
  }
  async _emitAgentSettled() {
    this._isAgentRunActive = false;
    try {
      await this._extensionRunner.emit({ type: "agent_settled" });
      this._emit({ type: "agent_settled" });
    } finally {
      this._resolveIdleWaitIfIdle();
    }
  }
  // Track last assistant message for auto-compaction check
  _lastAssistantMessage = void 0;
  /** Internal handler for agent events - shared by subscribe and reconnect */
  _handleAgentEvent = async (event) => {
    if (event.type === "message_start" && event.message.role === "user") {
      this._overflowRecoveryAttempted = false;
      const messageText = contentText(event.message.content, "");
      if (messageText) {
        const steeringIndex = this._steeringMessages.indexOf(messageText);
        if (steeringIndex !== -1) {
          this._steeringMessages.splice(steeringIndex, 1);
          this._emitQueueUpdate();
        } else {
          const followUpIndex = this._followUpMessages.indexOf(messageText);
          if (followUpIndex !== -1) {
            this._followUpMessages.splice(followUpIndex, 1);
            this._emitQueueUpdate();
          }
        }
      }
    }
    await this._emitExtensionEvent(event);
    this._emit(event.type === "agent_end" ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) } : event);
    if (event.type === "message_end") {
      if (event.message.role === "custom") {
        this.sessionManager.appendCustomMessageEntry(
          event.message.customType,
          event.message.content,
          event.message.display,
          event.message.details
        );
      } else if (event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult") {
        this.sessionManager.appendMessage(event.message);
      }
      if (event.message.role === "assistant") {
        this._lastAssistantMessage = event.message;
        const assistantMsg = event.message;
        if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length") {
          this._overflowRecoveryAttempted = false;
        }
        if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
          this._emit({
            type: "auto_retry_end",
            success: true,
            attempt: this._retryAttempt
          });
          this._retryAttempt = 0;
        }
      }
    }
  };
  _willRetryAfterAgentEnd(event) {
    const settings = this.settingsManager.getRetrySettings();
    if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
      return false;
    }
    for (let i = event.messages.length - 1; i >= 0; i--) {
      const message = event.messages[i];
      if (message.role === "assistant") {
        return this._isRetryableError(message);
      }
    }
    return false;
  }
  /** Find the last assistant message in agent state (including aborted ones) */
  _findLastAssistantMessage() {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        return msg;
      }
    }
    return void 0;
  }
  _replaceMessageInPlace(target, replacement) {
    if (target === replacement) {
      return;
    }
    const targetRecord = target;
    for (const key of Object.keys(targetRecord)) {
      delete targetRecord[key];
    }
    Object.assign(targetRecord, replacement);
  }
  /** Emit extension events based on agent events */
  async _emitExtensionEvent(event) {
    if (event.type === "agent_start") {
      this._turnIndex = 0;
      await this._extensionRunner.emit({ type: "agent_start" });
    } else if (event.type === "agent_end") {
      await this._extensionRunner.emit({ type: "agent_end", messages: event.messages });
    } else if (event.type === "turn_start") {
      const extensionEvent = {
        type: "turn_start",
        turnIndex: this._turnIndex,
        timestamp: Date.now()
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "turn_end") {
      const extensionEvent = {
        type: "turn_end",
        turnIndex: this._turnIndex,
        message: event.message,
        toolResults: event.toolResults
      };
      await this._extensionRunner.emit(extensionEvent);
      this._turnIndex++;
    } else if (event.type === "message_start") {
      const extensionEvent = {
        type: "message_start",
        message: event.message
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "message_update") {
      const extensionEvent = {
        type: "message_update",
        message: event.message,
        assistantMessageEvent: event.assistantMessageEvent
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "message_end") {
      const extensionEvent = {
        type: "message_end",
        message: event.message
      };
      const replacement = await this._extensionRunner.emitMessageEnd(extensionEvent);
      if (replacement) {
        const normalized = (replacement.role === "user" || replacement.role === "assistant" || replacement.role === "toolResult" || replacement.role === "custom") && replacement.content == null ? { ...replacement, content: [] } : replacement;
        this._replaceMessageInPlace(event.message, normalized);
      }
    } else if (event.type === "tool_execution_start") {
      const extensionEvent = {
        type: "tool_execution_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "tool_execution_update") {
      const extensionEvent = {
        type: "tool_execution_update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "tool_execution_end") {
      const extensionEvent = {
        type: "tool_execution_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError
      };
      await this._extensionRunner.emit(extensionEvent);
    }
  }
  /**
   * Subscribe to agent events.
   * Session persistence is handled internally (saves messages on message_end).
   * Multiple listeners can be added. Returns unsubscribe function for this listener.
   */
  subscribe(listener) {
    this._eventListeners.push(listener);
    return () => {
      const index = this._eventListeners.indexOf(listener);
      if (index !== -1) {
        this._eventListeners.splice(index, 1);
      }
    };
  }
  /** Disconnect from agent events during disposal. */
  _disconnectFromAgent() {
    if (this._unsubscribeAgent) {
      this._unsubscribeAgent();
      this._unsubscribeAgent = void 0;
    }
  }
  /**
   * Remove all listeners and disconnect from agent.
   * Call this when completely done with the session.
   */
  dispose() {
    this._agentRunAbortEpoch++;
    try {
      this.abortRetry();
      this.abortCompaction();
      this.abortBranchSummary();
      this.abortBash();
      this.agent.abort();
    } catch {
    }
    this._extensionRunner.invalidate(
      "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload()."
    );
    this._disconnectFromAgent();
    this._eventListeners = [];
    cleanupSessionResources(this.sessionId);
  }
  // =========================================================================
  // Read-only State Access
  // =========================================================================
  /** Full agent state */
  get state() {
    return this.agent.state;
  }
  /** Current model (may be undefined if not yet selected) */
  get model() {
    return this.agent.state.model;
  }
  /** Current thinking level */
  get thinkingLevel() {
    return this.agent.state.thinkingLevel;
  }
  /** Whether the session is currently processing an agent run or post-run continuation. */
  get isStreaming() {
    return this._isAgentRunActive;
  }
  /** Whether the session has no active agent run, retry, auto-compaction, or queued continuation. */
  get isIdle() {
    return !this._isAgentRunActive;
  }
  /** Current effective system prompt (includes any per-turn extension modifications) */
  get systemPrompt() {
    return this.agent.state.systemPrompt;
  }
  /** Current retry attempt (0 if not retrying) */
  get retryAttempt() {
    return this._retryAttempt;
  }
  /**
   * Get the names of currently active tools.
   * Returns the names of tools currently set on the agent.
   */
  getActiveToolNames() {
    return this.agent.state.tools.map((t) => t.name);
  }
  /**
   * Get all configured tools with name, description, parameter schema, prompt guidelines, and source metadata.
   */
  getAllTools() {
    return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      promptGuidelines: definition.promptGuidelines,
      sourceInfo
    }));
  }
  getToolDefinition(name) {
    return this._toolDefinitions.get(name)?.definition;
  }
  /**
   * Set active tools by name.
   * Only tools in the registry can be enabled. Unknown tool names are ignored.
   * Also rebuilds the system prompt to reflect the new tool set.
   * Changes take effect on the next agent turn.
   */
  setActiveToolsByName(toolNames) {
    const tools = [];
    const validToolNames = [];
    for (const name of toolNames) {
      const tool = this._toolRegistry.get(name);
      if (tool) {
        tools.push(tool);
        validToolNames.push(name);
      }
    }
    this.agent.state.tools = tools;
    this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames);
    this.agent.state.systemPrompt = this._systemPromptOverride ?? this._baseSystemPrompt;
  }
  /** Whether compaction or branch summarization is currently running */
  get isCompacting() {
    return this._autoCompactionAbortController !== void 0 || this._compactionAbortController !== void 0 || this._branchSummaryAbortController !== void 0;
  }
  /** All messages including custom types like BashExecutionMessage */
  get messages() {
    return this.agent.state.messages;
  }
  /** Current steering mode */
  get steeringMode() {
    return this.agent.steeringMode;
  }
  /** Current follow-up mode */
  get followUpMode() {
    return this.agent.followUpMode;
  }
  /** Current session file path, or undefined if sessions are disabled */
  get sessionFile() {
    return this.sessionManager.getSessionFile();
  }
  /** Current session ID */
  get sessionId() {
    return this.sessionManager.getSessionId();
  }
  /** Current session display name, if set */
  get sessionName() {
    return this.sessionManager.getSessionName();
  }
  /** Scoped models for cycling (from --models flag) */
  get scopedModels() {
    return this._scopedModels;
  }
  /** Update scoped models for cycling */
  setScopedModels(scopedModels) {
    this._scopedModels = scopedModels;
  }
  /** File-based prompt templates */
  get promptTemplates() {
    return this._resourceLoader.getPrompts().prompts;
  }
  _normalizePromptSnippet(text) {
    if (!text) return void 0;
    const oneLine = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    return oneLine.length > 0 ? oneLine : void 0;
  }
  _normalizePromptGuidelines(guidelines) {
    if (!guidelines || guidelines.length === 0) {
      return [];
    }
    const unique = /* @__PURE__ */ new Set();
    for (const guideline of guidelines) {
      const normalized = guideline.trim();
      if (normalized.length > 0) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  }
  _rebuildSystemPrompt(toolNames) {
    const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
    const toolSnippets = {};
    const promptGuidelines = [];
    for (const name of validToolNames) {
      const snippet = this._toolPromptSnippets.get(name);
      if (snippet) {
        toolSnippets[name] = snippet;
      }
      const toolGuidelines = this._toolPromptGuidelines.get(name);
      if (toolGuidelines) {
        promptGuidelines.push(...toolGuidelines);
      }
    }
    const loaderSystemPrompt = this._resourceLoader.getSystemPrompt();
    const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
    const appendSystemPrompt = loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : void 0;
    const loadedSkills = this._resourceLoader.getSkills().skills;
    const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;
    this._baseSystemPromptOptions = {
      cwd: this._cwd,
      skills: loadedSkills,
      contextFiles: loadedContextFiles,
      customPrompt: loaderSystemPrompt,
      appendSystemPrompt,
      selectedTools: validToolNames,
      toolSnippets,
      promptGuidelines
    };
    return buildSystemPrompt(this._baseSystemPromptOptions);
  }
  // =========================================================================
  // Prompting
  // =========================================================================
  async _runAgentPrompt(messages) {
    const abortEpoch = this._agentRunAbortEpoch;
    this._isAgentRunActive = true;
    try {
      await this.agent.prompt(messages);
      while (abortEpoch === this._agentRunAbortEpoch && await this._handlePostAgentRun()) {
        if (abortEpoch !== this._agentRunAbortEpoch) break;
        await this.agent.continue();
      }
    } finally {
      this._systemPromptOverride = void 0;
      this._flushPendingBashMessages();
      await this._emitAgentSettled();
    }
  }
  async _handlePostAgentRun() {
    const msg = this._lastAssistantMessage;
    this._lastAssistantMessage = void 0;
    if (!msg || msg.stopReason === "aborted") {
      return false;
    }
    if (this._isRetryableError(msg) && await this._prepareRetry(msg)) {
      return true;
    }
    if (msg.stopReason === "error" && this._retryAttempt > 0) {
      this._emit({
        type: "auto_retry_end",
        success: false,
        attempt: this._retryAttempt,
        finalError: msg.errorMessage
      });
      this._retryAttempt = 0;
    }
    if (await this._checkCompaction(msg)) {
      return true;
    }
    return this.agent.hasQueuedMessages();
  }
  /**
   * Send a prompt to the agent.
   * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
   * - Expands file-based prompt templates by default
   * - During streaming, queues via steer() or followUp() based on streamingBehavior option
   * - Validates model and API key before sending (when not streaming)
   * @throws Error if streaming and no streamingBehavior specified
   * @throws Error if no model selected or no API key available (when not streaming)
   */
  async prompt(text, options) {
    const expandPromptTemplates = options?.expandPromptTemplates ?? true;
    const preflightResult = options?.preflightResult;
    let messages;
    try {
      if (expandPromptTemplates && text.startsWith("/")) {
        const handled = await this._tryExecuteExtensionCommand(text);
        if (handled) {
          preflightResult?.(true);
          return;
        }
      }
      if (this._compactionAbortController !== void 0) {
        throw new Error(
          "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry."
        );
      }
      let currentText = text;
      let currentImages = options?.images;
      if (this._extensionRunner.hasHandlers("input")) {
        const inputResult = await this._extensionRunner.emitInput(
          currentText,
          currentImages,
          options?.source ?? "interactive",
          this.isStreaming ? options?.streamingBehavior : void 0
        );
        if (inputResult.action === "handled") {
          preflightResult?.(true);
          return;
        }
        if (inputResult.action === "transform") {
          currentText = inputResult.text;
          currentImages = inputResult.images ?? currentImages;
        }
      }
      let expandedText = currentText;
      if (expandPromptTemplates) {
        expandedText = this._expandSkillCommand(expandedText);
        expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
      }
      const contextMessages = (options?.contextMessages ?? []).map((message) => ({
        role: "custom",
        customType: message.customType,
        content: message.content ?? [],
        display: message.display,
        details: message.details,
        timestamp: Date.now()
      }));
      if (this.isStreaming) {
        if (!options?.streamingBehavior) {
          throw new Error(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."
          );
        }
        if (options.streamingBehavior === "followUp") {
          this._queueFollowUp(expandedText, currentImages, contextMessages);
        } else {
          this._queueSteer(expandedText, currentImages, contextMessages);
        }
        preflightResult?.(true);
        return;
      }
      this._flushPendingBashMessages();
      if (!this.model) {
        throw new Error(formatNoModelSelectedMessage());
      }
      const hasConfiguredAuth = this._modelRuntime.hasConfiguredAuth(this.model.provider) || await this._modelRuntime.checkAuth(this.model.provider) !== void 0;
      if (!hasConfiguredAuth) {
        const isOAuth = this._modelRuntime.isUsingOAuth(this.model.provider);
        if (isOAuth) {
          throw new Error(
            `Authentication failed for "${this.model.provider}". Credentials may have expired or network is unavailable. Run '/login ${this.model.provider}' to re-authenticate.`
          );
        }
        throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
      }
      const lastAssistant = this._findLastAssistantMessage();
      if (lastAssistant) {
        await this._checkCompaction(lastAssistant, false);
      }
      messages = [];
      const userContent = [{ type: "text", text: expandedText }];
      if (currentImages) {
        userContent.push(...currentImages);
      }
      messages.push({
        role: "user",
        content: userContent,
        timestamp: Date.now()
      });
      messages.push(...contextMessages);
      for (const msg of this._pendingNextTurnMessages) {
        messages.push(msg);
      }
      this._pendingNextTurnMessages = [];
      const result = await this._extensionRunner.emitBeforeAgentStart(
        expandedText,
        currentImages,
        this._baseSystemPrompt,
        this._baseSystemPromptOptions
      );
      if (result?.messages) {
        for (const msg of result.messages) {
          messages.push({
            role: "custom",
            customType: msg.customType,
            // Untyped extensions can pass null/missing content; normalize at ingestion.
            content: msg.content ?? [],
            display: msg.display,
            details: msg.details,
            timestamp: Date.now()
          });
        }
      }
      if (result?.systemPrompt !== void 0) {
        this._systemPromptOverride = result.systemPrompt;
        this.agent.state.systemPrompt = result.systemPrompt;
      } else {
        this._systemPromptOverride = void 0;
        this.agent.state.systemPrompt = this._baseSystemPrompt;
      }
    } catch (error) {
      preflightResult?.(false);
      throw error;
    }
    if (!messages) {
      return;
    }
    preflightResult?.(true);
    await this._runAgentPrompt(messages);
  }
  /**
   * Try to execute an extension command. Returns true if command was found and executed.
   */
  async _tryExecuteExtensionCommand(text) {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
    const command = this._extensionRunner.getCommand(commandName);
    if (!command) return false;
    const ctx = this._extensionRunner.createCommandContext();
    try {
      await command.handler(args, ctx);
      return true;
    } catch (err) {
      this._extensionRunner.emitError({
        extensionPath: `command:${commandName}`,
        event: "command",
        error: err instanceof Error ? err.message : String(err)
      });
      return true;
    }
  }
  /**
   * Expand skill commands (/skill:name args) to their full content.
   * Returns the expanded text, or the original text if not a skill command or skill not found.
   * Emits errors via extension runner if file read fails.
   */
  _expandSkillCommand(text) {
    if (!text.startsWith("/skill:")) return text;
    const spaceIndex = text.indexOf(" ");
    const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
    const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
    if (!skill) return text;
    try {
      const content = readFileSync(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">
References are relative to ${skill.baseDir}.

${body}
</skill>`;
      return args ? `${skillBlock}

${args}` : skillBlock;
    } catch (err) {
      this._extensionRunner.emitError({
        extensionPath: skill.filePath,
        event: "skill_expansion",
        error: err instanceof Error ? err.message : String(err)
      });
      return text;
    }
  }
  /**
   * Queue a steering message while the agent is running.
   * Delivered after the current assistant turn finishes executing its tool calls,
   * before the next LLM call.
   * Expands skill commands and prompt templates. Errors on extension commands.
   * @param images Optional image attachments to include with the message
   * @throws Error if text is an extension command
   */
  async steer(text, images) {
    if (text.startsWith("/")) {
      this._throwIfExtensionCommand(text);
    }
    let expandedText = this._expandSkillCommand(text);
    expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
    await this._queueSteer(expandedText, images);
  }
  /**
   * Queue a follow-up message to be processed after the agent finishes.
   * Delivered only when agent has no more tool calls or steering messages.
   * Expands skill commands and prompt templates. Errors on extension commands.
   * @param images Optional image attachments to include with the message
   * @throws Error if text is an extension command
   */
  async followUp(text, images) {
    if (text.startsWith("/")) {
      this._throwIfExtensionCommand(text);
    }
    let expandedText = this._expandSkillCommand(text);
    expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
    await this._queueFollowUp(expandedText, images);
  }
  /**
   * Internal: Queue a steering message (already expanded, no extension command check).
   */
  _queueSteer(text, images, contextMessages = []) {
    this._steeringMessages.push(text);
    this._emitQueueUpdate();
    const content = [{ type: "text", text }];
    if (images) {
      content.push(...images);
    }
    const message = { role: "user", content, timestamp: Date.now() };
    this.agent.steer(contextMessages.length ? [message, ...contextMessages] : message);
  }
  /**
   * Internal: Queue a follow-up message (already expanded, no extension command check).
   */
  _queueFollowUp(text, images, contextMessages = []) {
    this._followUpMessages.push(text);
    this._emitQueueUpdate();
    const content = [{ type: "text", text }];
    if (images) {
      content.push(...images);
    }
    const message = { role: "user", content, timestamp: Date.now() };
    this.agent.followUp(contextMessages.length ? [message, ...contextMessages] : message);
  }
  /**
   * Throw an error if the text is an extension command.
   */
  _throwIfExtensionCommand(text) {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const command = this._extensionRunner.getCommand(commandName);
    if (command) {
      throw new Error(
        `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`
      );
    }
  }
  /**
   * Send a custom message to the session. Creates a CustomMessageEntry.
   *
   * Handles three cases:
   * - Streaming: queues message, processed when loop pulls from queue
   * - Not streaming + triggerTurn: appends to state/session, starts new turn
   * - Not streaming + no trigger: appends to state/session, no turn
   *
   * @param message Custom message with customType, content, display, details
   * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
   * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
   */
  async sendCustomMessage(message, options) {
    const appMessage = {
      role: "custom",
      customType: message.customType,
      // Untyped extensions can pass null/missing content; normalize at ingestion.
      content: message.content ?? [],
      display: message.display,
      details: message.details,
      timestamp: Date.now()
    };
    if (options?.deliverAs === "nextTurn") {
      this._pendingNextTurnMessages.push(appMessage);
    } else if (this.isStreaming && options?.triggerTurn !== false) {
      if (options?.deliverAs === "followUp") {
        this.agent.followUp(appMessage);
      } else {
        this.agent.steer(appMessage);
      }
    } else if (options?.triggerTurn) {
      await this._runAgentPrompt(appMessage);
    } else {
      this.agent.state.messages.push(appMessage);
      this.sessionManager.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details
      );
      this._emit({ type: "message_start", message: appMessage });
      this._emit({ type: "message_end", message: appMessage });
    }
  }
  /**
   * Send a user message to the agent. Always triggers a turn.
   * When the agent is streaming, use deliverAs to specify how to queue the message.
   *
   * @param content User message content (string or content array)
   * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
   * @param options.expandPromptTemplates Whether to dispatch extension commands and expand skill commands and prompt templates. Default: false.
   */
  async sendUserMessage(content, options) {
    let text;
    let images;
    if (typeof content === "string") {
      text = content;
    } else {
      const textParts = [];
      images = [];
      for (const part of content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else {
          images.push(part);
        }
      }
      text = textParts.join("\n");
      if (images.length === 0) images = void 0;
    }
    await this.prompt(text, {
      expandPromptTemplates: options?.expandPromptTemplates ?? false,
      streamingBehavior: options?.deliverAs,
      images,
      source: "extension"
    });
  }
  /**
   * Clear all queued messages and return them.
   * Useful for restoring to editor when user aborts.
   * @returns Object with steering and followUp arrays
   */
  clearQueue() {
    const steering = [...this._steeringMessages];
    const followUp = [...this._followUpMessages];
    this._steeringMessages = [];
    this._followUpMessages = [];
    this.agent.clearAllQueues();
    this._emitQueueUpdate();
    return { steering, followUp };
  }
  /** Number of pending messages (includes both steering and follow-up) */
  get pendingMessageCount() {
    return this._steeringMessages.length + this._followUpMessages.length;
  }
  /** Get pending steering messages (read-only) */
  getSteeringMessages() {
    return this._steeringMessages;
  }
  /** Get pending follow-up messages (read-only) */
  getFollowUpMessages() {
    return this._followUpMessages;
  }
  get resourceLoader() {
    return this._resourceLoader;
  }
  /**
   * Abort current operation and wait for agent to become idle.
   */
  async abort() {
    this._agentRunAbortEpoch++;
    this.abortRetry();
    this.agent.abort();
    await this.waitForIdle();
  }
  async waitForIdle() {
    if (this.isIdle) {
      return;
    }
    await this._getIdleWaitPromise();
  }
  // =========================================================================
  // Model Management
  // =========================================================================
  async _emitModelSelect(nextModel, previousModel, source) {
    if (modelsAreEqual(previousModel, nextModel)) return;
    await this._extensionRunner.emit({
      type: "model_select",
      model: nextModel,
      previousModel,
      source
    });
  }
  /**
   * Set model directly.
   * Validates that auth is configured and saves to the session transcript.
   * Persists to global defaults only when options.persist is true.
   * @throws Error if no auth is configured for the model
   */
  async setModel(model, options = {}) {
    if (!await this._modelRuntime.checkAuth(model.provider)) {
      throw new Error(`No API key for ${model.provider}/${model.id}`);
    }
    const previousModel = this.model;
    const thinkingLevel = this._getThinkingLevelForModelSwitch(model);
    this.agent.state.model = model;
    this.sessionManager.appendModelChange(model.provider, model.id);
    if (options.persist) {
      this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
    }
    this.setThinkingLevel(thinkingLevel);
    await this._emitModelSelect(model, previousModel, "set");
  }
  /**
   * Cycle to next/previous model.
   * Uses scoped models (from --models flag) if available, otherwise all available models.
   * @param direction - "forward" (default) or "backward"
   * @returns The new model info, or undefined if only one model available
   */
  async cycleModel(direction = "forward", options = {}) {
    if (this._scopedModels.length > 0) {
      return this._cycleScopedModel(direction, options);
    }
    return this._cycleAvailableModel(direction, options);
  }
  async _cycleScopedModel(direction, options) {
    const availableIds = new Set(
      this._modelRuntime.getAvailableSnapshot().map((model) => `${model.provider}\0${model.id}`)
    );
    const scopedModels = this._scopedModels.filter(
      (scoped) => availableIds.has(`${scoped.model.provider}\0${scoped.model.id}`)
    );
    if (scopedModels.length <= 1) return void 0;
    const currentModel = this.model;
    let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));
    if (currentIndex === -1) currentIndex = 0;
    const len = scopedModels.length;
    const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
    const next = scopedModels[nextIndex];
    const thinkingLevel = this._getThinkingLevelForModelSwitch(next.model, next.thinkingLevel);
    this.agent.state.model = next.model;
    this.sessionManager.appendModelChange(next.model.provider, next.model.id);
    if (options.persist) {
      this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
    }
    this.setThinkingLevel(thinkingLevel);
    await this._emitModelSelect(next.model, currentModel, "cycle");
    return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
  }
  async _cycleAvailableModel(direction, options) {
    const availableModels = this._modelRuntime.getAvailableSnapshot();
    if (availableModels.length <= 1) return void 0;
    const currentModel = this.model;
    let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));
    if (currentIndex === -1) currentIndex = 0;
    const len = availableModels.length;
    const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
    const nextModel = availableModels[nextIndex];
    const thinkingLevel = this._getThinkingLevelForModelSwitch(nextModel);
    this.agent.state.model = nextModel;
    this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
    if (options.persist) {
      this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
    }
    this.setThinkingLevel(thinkingLevel);
    await this._emitModelSelect(nextModel, currentModel, "cycle");
    return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
  }
  // =========================================================================
  // Thinking Level Management
  // =========================================================================
  /**
   * Set thinking level.
   * Clamps to model capabilities based on available thinking levels.
   * Saves the clamped level to the session transcript only if the level actually changes.
   * Persists the requested level to global defaults only when options.persist is true.
   */
  setThinkingLevel(level, options = {}) {
    const availableLevels = this.getAvailableThinkingLevels();
    const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
    const previousLevel = this.agent.state.thinkingLevel;
    const isChanging = effectiveLevel !== previousLevel;
    this.agent.state.thinkingLevel = effectiveLevel;
    if (options.persist) {
      this.settingsManager.setDefaultThinkingLevel(level);
    }
    if (isChanging) {
      this.sessionManager.appendThinkingLevelChange(effectiveLevel);
      this._emit({ type: "thinking_level_changed", level: effectiveLevel });
      void this._extensionRunner.emit({
        type: "thinking_level_select",
        level: effectiveLevel,
        previousLevel
      });
    }
  }
  /**
   * Cycle to next thinking level.
   * @returns New level, or undefined if model doesn't support thinking
   */
  cycleThinkingLevel(options = {}) {
    if (!this.supportsThinking()) return void 0;
    const levels = this.getAvailableThinkingLevels();
    const currentIndex = levels.indexOf(this.thinkingLevel);
    const nextIndex = (currentIndex + 1) % levels.length;
    const nextLevel = levels[nextIndex];
    this.setThinkingLevel(nextLevel, options);
    return nextLevel;
  }
  /**
   * Get available thinking levels for current model.
   * The provider will clamp to what the specific model supports internally.
   */
  getAvailableThinkingLevels() {
    if (!this.model) return [...THINKING_LEVEL_OPTIONS];
    return getSupportedThinkingLevels(this.model);
  }
  /**
   * Check if current model supports thinking/reasoning.
   */
  supportsThinking() {
    return !!this.model?.reasoning;
  }
  _getThinkingLevelForModelSwitch(targetModel, explicitLevel) {
    if (explicitLevel !== void 0) {
      return explicitLevel;
    }
    if (targetModel) {
      const perModel = this.settingsManager.getModelThinkingLevel(targetModel.provider, targetModel.id);
      if (perModel !== void 0) {
        return perModel;
      }
    }
    return this.settingsManager.getDefaultThinkingLevel() ?? this.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
  }
  _clampThinkingLevel(level, _availableLevels) {
    return this.model ? clampThinkingLevel(this.model, level) : "off";
  }
  // =========================================================================
  // Queue Mode Management
  // =========================================================================
  syncQueueModesFromSettings() {
    this.agent.steeringMode = this.settingsManager.getSteeringMode();
    this.agent.followUpMode = this.settingsManager.getFollowUpMode();
  }
  /**
   * Set steering message mode.
   * Saves to settings.
   */
  setSteeringMode(mode) {
    this.agent.steeringMode = mode;
    this.settingsManager.setSteeringMode(mode);
  }
  /**
   * Set follow-up message mode.
   * Saves to settings.
   */
  setFollowUpMode(mode) {
    this.agent.followUpMode = mode;
    this.settingsManager.setFollowUpMode(mode);
  }
  // =========================================================================
  // Compaction
  // =========================================================================
  /** Generate Pi's built-in compaction summary for manual and automatic compaction. */
  async _runDefaultCompaction(preparation, requestModel, apiKey, headers, customInstructions, signal, env, reason) {
    return compact(
      preparation,
      requestModel,
      apiKey,
      headers,
      customInstructions,
      signal,
      this.thinkingLevel,
      this.agent.streamFunction,
      env,
      this.settingsManager.getRetrySettings(),
      this._summarizationRetryCallbacks({ source: "compaction", reason }),
      void 0
      // sessionId
    );
  }
  /**
   * Manually compact the session context.
   *
   * This is the manual entry point used by `/compact`, RPC, and extensions. It is
   * separate from automatic threshold/overflow compaction, which enters through
   * `_checkCompaction()` and `_runAutoCompaction()`. After preparation and the
   * `session_before_compact` hook, both paths call the lower-level `compact()`
   * function imported from `./compaction/index.ts`, unless the hook cancels or
   * supplies a custom result.
   *
   * Aborts the current agent operation first. Manual compaction never retries or
   * continues the interrupted agent turn.
   *
   * @param customInstructions Optional instructions for the compaction summary
   */
  async compact(customInstructions) {
    await this.abort();
    this._compactionAbortController = new AbortController();
    this._emit({ type: "compaction_start", reason: "manual" });
    let fromExtension = false;
    try {
      if (!this.model) {
        throw new Error(formatNoModelSelectedMessage());
      }
      const { model: requestModel, apiKey, headers, env } = await this._getSummarizationRequestAuth(this.model);
      const pathEntries = this.sessionManager.getBranch();
      const settings = this.settingsManager.getCompactionSettings();
      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        const lastEntry = pathEntries[pathEntries.length - 1];
        if (lastEntry?.type === "compaction") {
          throw new Error("Already compacted");
        }
        throw new Error("Nothing to compact (session too small)");
      }
      let extensionCompaction;
      if (this._extensionRunner.hasHandlers("session_before_compact")) {
        const result = await this._extensionRunner.emit({
          type: "session_before_compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions,
          reason: "manual",
          willRetry: false,
          signal: this._compactionAbortController.signal
        });
        if (result?.cancel) {
          throw new Error("Compaction cancelled");
        }
        if (result?.compaction) {
          extensionCompaction = result.compaction;
          fromExtension = true;
        }
      }
      let summary;
      let firstKeptEntryId;
      let tokensBefore;
      let usage;
      let details;
      if (extensionCompaction) {
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        usage = extensionCompaction.usage;
        details = extensionCompaction.details;
      } else {
        const result = await this._runDefaultCompaction(
          preparation,
          requestModel,
          apiKey,
          headers,
          customInstructions,
          this._compactionAbortController.signal,
          env,
          "manual"
        );
        summary = result.summary;
        firstKeptEntryId = result.firstKeptEntryId;
        tokensBefore = result.tokensBefore;
        usage = result.usage;
        details = result.details;
      }
      if (this._compactionAbortController.signal.aborted) {
        throw new Error("Compaction cancelled");
      }
      this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
      const newEntries = this.sessionManager.getEntries();
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;
      const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages);
      const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
      if (this._extensionRunner && savedCompactionEntry) {
        await this._extensionRunner.emit({
          type: "session_compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
          reason: "manual",
          willRetry: false
        });
      }
      const compactionResult = {
        summary,
        firstKeptEntryId,
        tokensBefore,
        estimatedTokensAfter,
        usage,
        details
      };
      this._compactionAbortController = void 0;
      this._emit({
        type: "compaction_end",
        reason: "manual",
        result: compactionResult,
        aborted: false,
        willRetry: false
      });
      return compactionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = message === "Compaction cancelled" || error instanceof Error && error.name === "AbortError";
      const errorMessage = aborted ? void 0 : `Compaction failed: ${message}`;
      this._compactionAbortController = void 0;
      this._emit({
        type: "compaction_end",
        reason: "manual",
        result: void 0,
        aborted,
        willRetry: false,
        errorMessage
      });
      await this._emitSessionCompactFailed({
        reason: "manual",
        errorMessage,
        aborted,
        willRetry: false,
        fromExtension
      });
      throw error;
    } finally {
      this._compactionAbortController = void 0;
    }
  }
  /**
   * Cancel in-progress compaction (manual or auto).
   */
  abortCompaction() {
    this._compactionAbortController?.abort();
    this._autoCompactionAbortController?.abort();
  }
  /**
   * Cancel in-progress branch summarization.
   */
  abortBranchSummary() {
    this._branchSummaryAbortController?.abort();
  }
  /**
   * Dispatch automatic compaction after `agent_end` or before prompt submission.
   * Manual compaction does not call this method; it enters through `compact()`.
   *
   * Automatic cases:
   * 1. Overflow with retry: a context-overflow error or recoverable length stop;
   *    remove the failed assistant message, compact, and retry the turn once.
   * 2. Overflow without retry: a successful response exceeded the configured
   *    context window; compact but preserve the completed response.
   * 3. Threshold without retry: valid or estimated context usage crossed the
   *    configured threshold; compact without retrying the completed response.
   *
   * Each case calls `_runAutoCompaction()`. After preparation and the
   * `session_before_compact` hook, that method calls the lower-level `compact()`
   * function imported from `./compaction/index.ts`, unless the hook cancels or
   * supplies a custom result.
   *
   * @param assistantMessage The assistant message to check
   * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
   * @returns Whether the post-run loop should call `agent.continue()` for overflow recovery or queued messages
   */
  async _checkCompaction(assistantMessage, skipAbortedCheck = true) {
    const settings = this.settingsManager.getCompactionSettings();
    if (!settings.enabled) return false;
    if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;
    const contextWindow = this.model?.contextWindow ?? 0;
    const sameModel = this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;
    const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
    const assistantIsFromBeforeCompaction = compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
    if (assistantIsFromBeforeCompaction) {
      return false;
    }
    const contextOverflow = sameModel && isContextOverflow(assistantMessage, contextWindow);
    const recoverableLength = sameModel && isRecoverableLength(assistantMessage, this.model?.maxTokens ?? 0);
    if (contextOverflow || recoverableLength) {
      const willRetry = assistantMessage.stopReason !== "stop";
      if (!willRetry) {
        return await this._runAutoCompaction("overflow", false);
      }
      if (this._overflowRecoveryAttempted) {
        const errorMessage = contextOverflow ? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model." : "Truncated response recovery failed after one compact-and-retry attempt.";
        this._emit({
          type: "compaction_end",
          reason: "overflow",
          result: void 0,
          aborted: false,
          willRetry: false,
          errorMessage
        });
        await this._emitSessionCompactFailed({
          reason: "overflow",
          errorMessage,
          aborted: false,
          willRetry: false,
          fromExtension: false
        });
        return false;
      }
      this._overflowRecoveryAttempted = true;
      const messages = this.agent.state.messages;
      if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
        this.agent.state.messages = messages.slice(0, -1);
      }
      return await this._runAutoCompaction("overflow", willRetry);
    }
    let contextTokens;
    const directContextTokens = assistantMessage.usage ? calculateContextTokens(assistantMessage.usage) : 0;
    if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
      const messages = this.agent.state.messages;
      const estimate = estimateContextTokens(messages);
      if (estimate.lastUsageIndex !== null) {
        const usageMsg = messages[estimate.lastUsageIndex];
        if (compactionEntry && usageMsg.role === "assistant" && usageMsg.timestamp <= new Date(compactionEntry.timestamp).getTime()) {
          return false;
        }
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = directContextTokens;
    }
    if (shouldCompact(contextTokens, contextWindow, settings)) {
      return await this._runAutoCompaction("threshold", false);
    }
    return false;
  }
  /**
   * Execute threshold or overflow compaction. Manual compaction uses
   * `AgentSession.compact()` instead. Both paths call the lower-level `compact()`
   * function imported from `./compaction/index.ts` after preparation and extension
   * interception.
   *
   * @param reason Automatic trigger selected by `_checkCompaction()`
   * @param willRetry Whether to continue the interrupted turn after overflow compaction
   * @returns Whether the post-run loop should call `agent.continue()`
   */
  async _runAutoCompaction(reason, willRetry) {
    const settings = this.settingsManager.getCompactionSettings();
    let started = false;
    let fromExtension = false;
    try {
      if (!this.model) {
        return false;
      }
      const { model: requestModel, apiKey, headers, env } = await this._getSummarizationRequestAuth(this.model);
      const pathEntries = this.sessionManager.getBranch();
      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        return false;
      }
      this._emit({ type: "compaction_start", reason });
      this._autoCompactionAbortController = new AbortController();
      started = true;
      let extensionCompaction;
      if (this._extensionRunner.hasHandlers("session_before_compact")) {
        const extensionResult = await this._extensionRunner.emit({
          type: "session_before_compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions: void 0,
          reason,
          willRetry,
          signal: this._autoCompactionAbortController.signal
        });
        if (extensionResult?.cancel) {
          this._emit({
            type: "compaction_end",
            reason,
            result: void 0,
            aborted: true,
            willRetry: false
          });
          await this._emitSessionCompactFailed({
            reason,
            aborted: true,
            willRetry: false,
            fromExtension: false
          });
          return false;
        }
        if (extensionResult?.compaction) {
          extensionCompaction = extensionResult.compaction;
          fromExtension = true;
        }
      }
      let summary;
      let firstKeptEntryId;
      let tokensBefore;
      let usage;
      let details;
      if (extensionCompaction) {
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        usage = extensionCompaction.usage;
        details = extensionCompaction.details;
      } else {
        const compactResult = await this._runDefaultCompaction(
          preparation,
          requestModel,
          apiKey,
          headers,
          void 0,
          this._autoCompactionAbortController.signal,
          env,
          reason
        );
        summary = compactResult.summary;
        firstKeptEntryId = compactResult.firstKeptEntryId;
        tokensBefore = compactResult.tokensBefore;
        usage = compactResult.usage;
        details = compactResult.details;
      }
      if (this._autoCompactionAbortController.signal.aborted) {
        this._emit({
          type: "compaction_end",
          reason,
          result: void 0,
          aborted: true,
          willRetry: false
        });
        await this._emitSessionCompactFailed({
          reason,
          aborted: true,
          willRetry: false,
          fromExtension
        });
        return false;
      }
      this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
      const newEntries = this.sessionManager.getEntries();
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;
      const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages);
      const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
      if (this._extensionRunner && savedCompactionEntry) {
        await this._extensionRunner.emit({
          type: "session_compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
          reason,
          willRetry
        });
      }
      const result = {
        summary,
        firstKeptEntryId,
        tokensBefore,
        estimatedTokensAfter,
        usage,
        details
      };
      this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });
      if (willRetry) {
        const messages = this.agent.state.messages;
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "assistant" && (lastMsg.stopReason === "error" || lastMsg.stopReason === "length")) {
          this.agent.state.messages = messages.slice(0, -1);
        }
        return true;
      }
      return this.agent.hasQueuedMessages();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "compaction failed";
      if (started) {
        const formattedErrorMessage = reason === "overflow" ? `Context overflow recovery failed: ${errorMessage}` : `Auto-compaction failed: ${errorMessage}`;
        this._emit({
          type: "compaction_end",
          reason,
          result: void 0,
          aborted: false,
          willRetry: false,
          errorMessage: formattedErrorMessage
        });
        await this._emitSessionCompactFailed({
          reason,
          errorMessage: formattedErrorMessage,
          aborted: false,
          willRetry: false,
          fromExtension
        });
      }
      return false;
    } finally {
      this._autoCompactionAbortController = void 0;
    }
  }
  /**
   * Toggle auto-compaction setting.
   */
  setAutoCompactionEnabled(enabled) {
    this.settingsManager.setCompactionEnabled(enabled);
  }
  /** Whether auto-compaction is enabled */
  get autoCompactionEnabled() {
    return this.settingsManager.getCompactionEnabled();
  }
  async bindExtensions(bindings) {
    if (bindings.uiContext !== void 0) {
      this._extensionUIContext = bindings.uiContext;
    }
    if (bindings.mode !== void 0) {
      this._extensionMode = bindings.mode;
    }
    if (bindings.commandContextActions !== void 0) {
      this._extensionCommandContextActions = bindings.commandContextActions;
    }
    if (bindings.abortHandler !== void 0) {
      this._extensionAbortHandler = bindings.abortHandler;
    }
    if (bindings.shutdownHandler !== void 0) {
      this._extensionShutdownHandler = bindings.shutdownHandler;
    }
    if (bindings.onError !== void 0) {
      this._extensionErrorListener = bindings.onError;
    }
    this._applyExtensionBindings(this._extensionRunner);
    await this._extensionRunner.emit(this._sessionStartEvent);
    await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
  }
  async extendResourcesFromExtensions(reason) {
    if (!this._extensionRunner.hasHandlers("resources_discover")) {
      return;
    }
    const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(
      this._cwd,
      reason
    );
    if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
      return;
    }
    const extensionPaths = {
      skillPaths: this.buildExtensionResourcePaths(skillPaths),
      promptPaths: this.buildExtensionResourcePaths(promptPaths),
      themePaths: this.buildExtensionResourcePaths(themePaths)
    };
    this._resourceLoader.extendResources(extensionPaths);
    this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
    this.agent.state.systemPrompt = this._baseSystemPrompt;
  }
  buildExtensionResourcePaths(entries) {
    return entries.map((entry) => {
      const source = this.getExtensionSourceLabel(entry.extensionPath);
      const baseDir = entry.extensionPath.startsWith("<") ? void 0 : dirname(entry.extensionPath);
      return {
        path: entry.path,
        metadata: {
          source,
          scope: "temporary",
          origin: "top-level",
          baseDir
        }
      };
    });
  }
  getExtensionSourceLabel(extensionPath) {
    if (extensionPath.startsWith("<")) {
      return `extension:${extensionPath.replace(/[<>]/g, "")}`;
    }
    const base = basename(extensionPath);
    const name = base.replace(/\.(ts|js)$/, "");
    return `extension:${name}`;
  }
  _applyExtensionBindings(runner) {
    runner.setUIContext(this._extensionUIContext, this._extensionMode);
    runner.bindCommandContext(this._extensionCommandContextActions);
    this._extensionErrorUnsubscriber?.();
    this._extensionErrorUnsubscriber = this._extensionErrorListener ? runner.onError(this._extensionErrorListener) : void 0;
  }
  _refreshCurrentModelFromRegistry() {
    const currentModel = this.model;
    if (!currentModel) {
      return;
    }
    const refreshedModel = this._modelRuntime.getModel(currentModel.provider, currentModel.id);
    if (!refreshedModel || refreshedModel === currentModel) {
      return;
    }
    this.agent.state.model = refreshedModel;
  }
  _bindExtensionCore(runner) {
    const getCommands = () => {
      const extensionCommands = runner.getRegisteredCommands().map((command) => ({
        name: command.invocationName,
        description: command.description,
        source: "extension",
        sourceInfo: command.sourceInfo
      }));
      const templates = this.promptTemplates.map((template) => ({
        name: template.name,
        description: template.description,
        source: "prompt",
        sourceInfo: template.sourceInfo
      }));
      const skills = this._resourceLoader.getSkills().skills.map((skill) => ({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
        sourceInfo: skill.sourceInfo
      }));
      return [...extensionCommands, ...templates, ...skills];
    };
    runner.bindCore(
      {
        sendMessage: (message, options) => {
          this.sendCustomMessage(message, options).catch((err) => {
            runner.emitError({
              extensionPath: "<runtime>",
              event: "send_message",
              error: err instanceof Error ? err.message : String(err)
            });
          });
        },
        sendUserMessage: (content, options) => {
          this.sendUserMessage(content, options).catch((err) => {
            runner.emitError({
              extensionPath: "<runtime>",
              event: "send_user_message",
              error: err instanceof Error ? err.message : String(err)
            });
          });
        },
        appendEntry: (customType, data) => {
          const entryId = this.sessionManager.appendCustomEntry(customType, data);
          const entry = this.sessionManager.getEntry(entryId);
          if (entry) {
            this._emit({ type: "entry_appended", entry });
          }
        },
        setSessionName: (name) => {
          this.setSessionName(name);
        },
        getSessionName: () => {
          return this.sessionManager.getSessionName();
        },
        setLabel: (entryId, label) => {
          this.sessionManager.appendLabelChange(entryId, label);
        },
        getActiveTools: () => this.getActiveToolNames(),
        getAllTools: () => this.getAllTools(),
        setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
        refreshTools: () => this._refreshToolRegistry(),
        getCommands,
        setModel: async (model) => {
          if (!this._modelRuntime.hasConfiguredAuth(model.provider)) return false;
          await this.setModel(model);
          return true;
        },
        getThinkingLevel: () => this.thinkingLevel,
        setThinkingLevel: (level) => this.setThinkingLevel(level)
      },
      {
        getModel: () => this.model,
        getScopedModels: () => this._scopedModels,
        isIdle: () => this.isIdle,
        isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
        getSignal: () => this.agent.signal,
        abort: () => {
          if (this._extensionAbortHandler) {
            this._extensionAbortHandler();
            return;
          }
          void this.abort();
        },
        hasPendingMessages: () => this.pendingMessageCount > 0,
        shutdown: () => {
          this._extensionShutdownHandler?.();
        },
        getContextUsage: () => this.getContextUsage(),
        compact: (options) => {
          void (async () => {
            try {
              const result = await this.compact(options?.customInstructions);
              options?.onComplete?.(result);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              options?.onError?.(err);
            }
          })();
        },
        getSystemPrompt: () => this.systemPrompt,
        getSystemPromptOptions: () => this._baseSystemPromptOptions
      },
      {
        registerProvider: (name, config) => {
          this._modelRuntime.registerProvider(name, config);
          this._refreshCurrentModelFromRegistry();
        },
        registerNativeProvider: (provider) => {
          this._modelRuntime.registerNativeProvider(provider);
          this._refreshCurrentModelFromRegistry();
        },
        unregisterProvider: (name) => {
          this._modelRuntime.unregisterProvider(name);
          this._refreshCurrentModelFromRegistry();
        }
      }
    );
  }
  _refreshToolRegistry(options) {
    const previousRegistryNames = new Set(this._toolRegistry.keys());
    const previousActiveToolNames = this.getActiveToolNames();
    const allowedToolNames = this._allowedToolNames;
    const excludedToolNames = this._excludedToolNames;
    const isAllowedTool = (name) => (!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);
    const registeredTools = this._extensionRunner.getAllRegisteredTools();
    const allCustomTools = [
      ...registeredTools,
      ...this._customTools.map((definition) => ({
        definition,
        sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" })
      }))
    ].filter((tool) => isAllowedTool(tool.definition.name));
    const definitionRegistry = new Map(
      Array.from(this._baseToolDefinitions.entries()).filter(([name]) => isAllowedTool(name)).map(([name, definition]) => [
        name,
        {
          definition,
          sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" })
        }
      ])
    );
    for (const tool of allCustomTools) {
      definitionRegistry.set(tool.definition.name, {
        definition: tool.definition,
        sourceInfo: tool.sourceInfo
      });
    }
    this._toolDefinitions = definitionRegistry;
    this._toolPromptSnippets = new Map(
      Array.from(definitionRegistry.values()).map(({ definition }) => {
        const snippet = this._normalizePromptSnippet(definition.promptSnippet);
        return snippet ? [definition.name, snippet] : void 0;
      }).filter((entry) => entry !== void 0)
    );
    this._toolPromptGuidelines = new Map(
      Array.from(definitionRegistry.values()).map(({ definition }) => {
        const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
        return guidelines.length > 0 ? [definition.name, guidelines] : void 0;
      }).filter((entry) => entry !== void 0)
    );
    const runner = this._extensionRunner;
    const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
    const wrappedBuiltInTools = wrapRegisteredTools(
      Array.from(this._baseToolDefinitions.values()).filter((definition) => isAllowedTool(definition.name)).map((definition) => ({
        definition,
        sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" })
      })),
      runner
    );
    const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
    for (const tool of wrappedExtensionTools) {
      toolRegistry.set(tool.name, tool);
    }
    this._toolRegistry = toolRegistry;
    const nextActiveToolNames = (options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]).filter((name) => isAllowedTool(name));
    if (allowedToolNames) {
      for (const toolName of this._toolRegistry.keys()) {
        if (allowedToolNames.has(toolName)) {
          nextActiveToolNames.push(toolName);
        }
      }
    } else if (options?.includeAllExtensionTools) {
      for (const tool of wrappedExtensionTools) {
        nextActiveToolNames.push(tool.name);
      }
    } else if (!options?.activeToolNames) {
      for (const toolName of this._toolRegistry.keys()) {
        if (!previousRegistryNames.has(toolName)) {
          nextActiveToolNames.push(toolName);
        }
      }
    }
    this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
  }
  _buildRuntime(options) {
    const autoResizeImages = this.settingsManager.getImageAutoResize();
    const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
    const shellPath = this.settingsManager.getShellPath();
    const baseToolDefinitions = this._baseToolsOverride ? Object.fromEntries(
      Object.entries(this._baseToolsOverride).map(([name, tool]) => [
        name,
        createToolDefinitionFromAgentTool(tool)
      ])
    ) : createAllToolDefinitions(this._cwd, {
      read: { autoResizeImages },
      bash: { commandPrefix: shellCommandPrefix, shellPath }
    });
    this._baseToolDefinitions = new Map(
      Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool])
    );
    const extensionsResult = this._resourceLoader.getExtensions();
    if (options.flagValues) {
      for (const [name, value] of options.flagValues) {
        extensionsResult.runtime.flagValues.set(name, value);
      }
    }
    this._extensionRunner = new ExtensionRunner(
      extensionsResult.extensions,
      extensionsResult.runtime,
      this._cwd,
      this.sessionManager,
      new ModelRegistry(this._modelRuntime)
    );
    if (this._extensionRunnerRef) {
      this._extensionRunnerRef.current = this._extensionRunner;
    }
    this._bindExtensionCore(this._extensionRunner);
    this._applyExtensionBindings(this._extensionRunner);
    const defaultActiveToolNames = this._baseToolsOverride ? Object.keys(this._baseToolsOverride) : ["read", "bash", "edit", "write"];
    const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
    this._refreshToolRegistry({
      activeToolNames: baseActiveToolNames,
      includeAllExtensionTools: options.includeAllExtensionTools
    });
  }
  async reload(options) {
    const oldRunner = this._extensionRunner;
    const previousFlagValues = oldRunner.getFlagValues();
    await emitSessionShutdownEvent(oldRunner, { type: "session_shutdown", reason: "reload" });
    oldRunner.invalidate();
    await this.settingsManager.reload();
    this.syncQueueModesFromSettings();
    resetApiProviders();
    await this._resourceLoader.reload();
    this._buildRuntime({
      activeToolNames: this.getActiveToolNames(),
      flagValues: previousFlagValues,
      includeAllExtensionTools: true
    });
    const hasBindings = this._extensionUIContext || this._extensionCommandContextActions || this._extensionShutdownHandler || this._extensionErrorListener;
    if (hasBindings) {
      await options?.beforeSessionStart?.();
      await this._extensionRunner.emit({ type: "session_start", reason: "reload" });
      await this.extendResourcesFromExtensions("reload");
    }
  }
  // =========================================================================
  // Auto-Retry
  // =========================================================================
  /**
   * Check if an error is retryable (overloaded, rate limit, server errors).
   * Context overflow errors are NOT retryable (handled by compaction instead).
   */
  _isRetryableError(message) {
    if (isContextOverflow(message, this.model?.contextWindow ?? 0)) return false;
    return isRetryableAssistantError(message);
  }
  /**
   * Retry policy + callbacks shared by compaction and branch-summary summarization calls.
   * Uses the same `settings.retry` budget/backoff as agent-turn retries so a single transient
   * stream drop no longer fails the whole operation. `source` carries the context
   * the TUI needs to render the retry and recreate the underlying indicator.
   */
  _summarizationRetryCallbacks(source) {
    return {
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
        this._emit({
          type: "summarization_retry_scheduled",
          attempt,
          maxAttempts,
          delayMs,
          errorMessage
        });
      },
      onRetryAttemptStart: () => {
        this._emit({
          type: "summarization_retry_attempt_start",
          ...source
        });
      },
      onRetryFinished: () => {
        this._emit({ type: "summarization_retry_finished" });
      }
    };
  }
  /**
   * Prepare a retryable error for continuation with exponential backoff.
   * @returns true if the caller should continue the agent, false otherwise
   */
  async _prepareRetry(message) {
    const settings = this.settingsManager.getRetrySettings();
    if (!settings.enabled) {
      return false;
    }
    this._retryAttempt++;
    if (this._retryAttempt > settings.maxRetries) {
      this._retryAttempt--;
      return false;
    }
    const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);
    this._emit({
      type: "auto_retry_start",
      attempt: this._retryAttempt,
      maxAttempts: settings.maxRetries,
      delayMs,
      errorMessage: message.errorMessage || "Unknown error"
    });
    const messages = this.agent.state.messages;
    if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
      this.agent.state.messages = messages.slice(0, -1);
    }
    this._retryAbortController = new AbortController();
    try {
      await sleep(delayMs, this._retryAbortController.signal);
    } catch {
      const attempt = this._retryAttempt;
      this._retryAttempt = 0;
      this._emit({
        type: "auto_retry_end",
        success: false,
        attempt,
        finalError: "Retry cancelled"
      });
      return false;
    } finally {
      this._retryAbortController = void 0;
    }
    return true;
  }
  /**
   * Cancel in-progress retry.
   */
  abortRetry() {
    this._retryAbortController?.abort();
  }
  /** Whether auto-retry is currently in progress */
  get isRetrying() {
    return this._retryAbortController !== void 0;
  }
  /** Whether auto-retry is enabled */
  get autoRetryEnabled() {
    return this.settingsManager.getRetryEnabled();
  }
  /**
   * Toggle auto-retry setting.
   */
  setAutoRetryEnabled(enabled) {
    this.settingsManager.setRetryEnabled(enabled);
  }
  // =========================================================================
  // Bash Execution
  // =========================================================================
  /**
   * Execute a bash command.
   * Adds result to agent context and session.
   * @param command The bash command to execute
   * @param onChunk Optional streaming callback for output
   * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
   * @param options.id Optional identifier included in bash execution update events
   * @param options.operations Custom BashOperations for remote execution
   */
  async executeBash(command, onChunk, options) {
    const abortController = new AbortController();
    this._bashAbortControllers.add(abortController);
    const prefix = this.settingsManager.getShellCommandPrefix();
    const shellPath = this.settingsManager.getShellPath();
    const resolvedCommand = prefix ? `${prefix}
${command}` : command;
    try {
      const result = await executeBashWithOperations(
        resolvedCommand,
        this.sessionManager.getCwd(),
        options?.operations ?? createLocalBashOperations({ shellPath }),
        {
          onChunk: (delta) => {
            onChunk?.(delta);
            this._emit({ type: "bash_execution_update", id: options?.id, delta });
          },
          signal: abortController.signal
        }
      );
      this.recordBashResult(command, result, options);
      return result;
    } finally {
      this._bashAbortControllers.delete(abortController);
    }
  }
  /**
   * Record a bash execution result in session history.
   * Used by executeBash and by extensions that handle bash execution themselves.
   */
  recordBashResult(command, result, options) {
    const bashMessage = {
      role: "bashExecution",
      command,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled,
      truncated: result.truncated,
      fullOutputPath: result.fullOutputPath,
      timestamp: Date.now(),
      excludeFromContext: options?.excludeFromContext
    };
    if (this.isStreaming) {
      this._pendingBashMessages.push(bashMessage);
    } else {
      this.agent.state.messages.push(bashMessage);
      this.sessionManager.appendMessage(bashMessage);
    }
  }
  /**
   * Cancel running bash command.
   */
  abortBash() {
    for (const abortController of [...this._bashAbortControllers]) {
      abortController.abort();
    }
  }
  /** Whether a bash command is currently running */
  get isBashRunning() {
    return this._bashAbortControllers.size > 0;
  }
  /** Whether there are pending bash messages waiting to be flushed */
  get hasPendingBashMessages() {
    return this._pendingBashMessages.length > 0;
  }
  /**
   * Flush pending bash messages to agent state and session.
   * Called after agent turn completes to maintain proper message ordering.
   */
  _flushPendingBashMessages() {
    if (this._pendingBashMessages.length === 0) return;
    for (const bashMessage of this._pendingBashMessages) {
      this.agent.state.messages.push(bashMessage);
      this.sessionManager.appendMessage(bashMessage);
    }
    this._pendingBashMessages = [];
  }
  // =========================================================================
  // Session Management
  // =========================================================================
  /**
   * Set a display name for the current session.
   */
  setSessionName(name) {
    this.sessionManager.appendSessionInfo(name);
    const event = { type: "session_info_changed", name: this.sessionManager.getSessionName() };
    this._emit(event);
    void this._extensionRunner.emit(event);
  }
  // =========================================================================
  // Tree Navigation
  // =========================================================================
  /**
   * Navigate to a different node in the session tree.
   * Unlike fork() which creates a new session file, this stays in the same file.
   *
   * @param targetId The entry ID to navigate to
   * @param options.summarize Whether user wants to summarize abandoned branch
   * @param options.customInstructions Custom instructions for summarizer
   * @param options.replaceInstructions If true, customInstructions replaces the default prompt
   * @param options.label Label to attach to the branch summary entry
   * @returns Result with editorText (if user message) and cancelled status
   */
  async navigateTree(targetId, options = {}) {
    if (this.isStreaming) {
      throw new Error("Wait for the current response to finish before navigating the session tree.");
    }
    const oldLeafId = this.sessionManager.getLeafId();
    if (targetId === oldLeafId) {
      return { cancelled: false };
    }
    if (options.summarize && !this.model) {
      throw new Error("No model available for summarization");
    }
    const targetEntry = this.sessionManager.getEntry(targetId);
    if (!targetEntry) {
      throw new Error(`Entry ${targetId} not found`);
    }
    const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
      this.sessionManager,
      oldLeafId,
      targetId
    );
    let customInstructions = options.customInstructions;
    let replaceInstructions = options.replaceInstructions;
    let label = options.label;
    const preparation = {
      targetId,
      oldLeafId,
      commonAncestorId,
      entriesToSummarize,
      userWantsSummary: options.summarize ?? false,
      customInstructions,
      replaceInstructions,
      label
    };
    this._branchSummaryAbortController = new AbortController();
    try {
      let extensionSummary;
      let fromExtension = false;
      if (this._extensionRunner.hasHandlers("session_before_tree")) {
        const result = await this._extensionRunner.emit({
          type: "session_before_tree",
          preparation,
          signal: this._branchSummaryAbortController.signal
        });
        if (result?.cancel) {
          return { cancelled: true };
        }
        if (result?.summary && options.summarize) {
          extensionSummary = result.summary;
          fromExtension = true;
        }
        if (result?.customInstructions !== void 0) {
          customInstructions = result.customInstructions;
        }
        if (result?.replaceInstructions !== void 0) {
          replaceInstructions = result.replaceInstructions;
        }
        if (result?.label !== void 0) {
          label = result.label;
        }
      }
      let summaryText;
      let summaryDetails;
      let summaryUsage;
      if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
        const model = this.model;
        const { model: requestModel, apiKey, headers, env } = await this._getSummarizationRequestAuth(model);
        const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
        const result = await generateBranchSummary(entriesToSummarize, {
          model: requestModel,
          apiKey,
          headers,
          env,
          signal: this._branchSummaryAbortController.signal,
          customInstructions,
          replaceInstructions,
          reserveTokens: branchSummarySettings.reserveTokens,
          streamFn: this.agent.streamFunction,
          retry: this.settingsManager.getRetrySettings(),
          callbacks: this._summarizationRetryCallbacks({ source: "branchSummary" })
        });
        if (result.aborted) {
          return { cancelled: true, aborted: true };
        }
        if (result.error) {
          throw new Error(result.error);
        }
        summaryText = result.summary;
        summaryUsage = result.usage;
        summaryDetails = {
          readFiles: result.readFiles || [],
          modifiedFiles: result.modifiedFiles || []
        };
      } else if (extensionSummary) {
        summaryText = extensionSummary.summary;
        summaryDetails = extensionSummary.details;
        summaryUsage = extensionSummary.usage;
      }
      let newLeafId;
      let editorText;
      if (targetEntry.type === "message" && targetEntry.message.role === "user") {
        newLeafId = targetEntry.parentId;
        editorText = contentText(targetEntry.message.content, "");
      } else if (targetEntry.type === "custom_message") {
        newLeafId = targetEntry.parentId;
        editorText = contentText(targetEntry.content, "");
      } else {
        newLeafId = targetId;
      }
      let summaryEntry;
      if (summaryText) {
        const summaryId = this.sessionManager.branchWithSummary(
          newLeafId,
          summaryText,
          summaryDetails,
          fromExtension,
          summaryUsage
        );
        summaryEntry = this.sessionManager.getEntry(summaryId);
        if (label) {
          this.sessionManager.appendLabelChange(summaryId, label);
        }
      } else if (newLeafId === null) {
        this.sessionManager.resetLeaf();
      } else {
        this.sessionManager.branch(newLeafId);
      }
      if (label && !summaryText) {
        this.sessionManager.appendLabelChange(targetId, label);
      }
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;
      await this._extensionRunner.emit({
        type: "session_tree",
        newLeafId: this.sessionManager.getLeafId(),
        oldLeafId,
        summaryEntry,
        fromExtension: summaryText ? fromExtension : void 0
      });
      return { editorText, cancelled: false, summaryEntry };
    } finally {
      this._branchSummaryAbortController = void 0;
    }
  }
  /**
   * Get all user messages from session for fork selector.
   */
  getUserMessagesForForking() {
    const entries = this.sessionManager.getEntries();
    const result = [];
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      if (entry.message.role !== "user") continue;
      const text = contentText(entry.message.content, "");
      if (text) {
        result.push({ entryId: entry.id, text });
      }
    }
    return result;
  }
  /**
   * Get session statistics. Aggregates over ALL session entries (including
   * history that was compacted away), so token/cost totals reflect what was
   * actually billed across the session.
   */
  getSessionStats() {
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let totalMessages = 0;
    let toolCalls = 0;
    const usageTotals = createUsageTotals();
    for (const entry of this.sessionManager.getEntries()) {
      if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
        addUsageToTotals(usageTotals, entry.usage);
      }
      if (entry.type !== "message") continue;
      totalMessages++;
      const message = entry.message;
      if (message.role === "user") {
        userMessages++;
      } else if (message.role === "toolResult") {
        toolResults++;
        if (message.usage) {
          addUsageToTotals(usageTotals, message.usage);
        }
      } else if (message.role === "assistant") {
        assistantMessages++;
        const assistantMsg = message;
        if (Array.isArray(assistantMsg.content)) {
          toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
        }
        addUsageToTotals(usageTotals, assistantMsg.usage);
      }
    }
    return {
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages,
      tokens: {
        input: usageTotals.input,
        output: usageTotals.output,
        cacheRead: usageTotals.cacheRead,
        cacheWrite: usageTotals.cacheWrite,
        total: usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite
      },
      cost: usageTotals.cost,
      contextUsage: this.getContextUsage()
    };
  }
  getContextUsage() {
    const model = this.model;
    if (!model) return void 0;
    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return void 0;
    const branchEntries = this.sessionManager.getBranch();
    const latestCompaction = getLatestCompactionEntry(branchEntries);
    if (latestCompaction) {
      const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
      let hasPostCompactionUsage = false;
      for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
        const entry = branchEntries[i];
        if (entry.type === "message" && entry.message.role === "assistant") {
          const assistant = entry.message;
          if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
            const contextTokens = calculateContextTokens(assistant.usage);
            if (contextTokens > 0) {
              hasPostCompactionUsage = true;
              break;
            }
          }
        }
      }
      if (!hasPostCompactionUsage) {
        return { tokens: null, contextWindow, percent: null };
      }
    }
    const estimate = estimateContextTokens(this.messages);
    const percent = estimate.tokens / contextWindow * 100;
    return {
      tokens: estimate.tokens,
      contextWindow,
      percent
    };
  }
  /**
   * Export session to HTML.
   * @param outputPath Optional output path (defaults to session directory)
   * @param options Optional export presentation settings
   * @returns Path to exported file
   */
  async exportToHtml(outputPath, options = {}) {
    const themeName = [options.themeName, this.settingsManager.getTheme()].find(
      (candidate) => candidate !== void 0 && getThemeByName(candidate) !== void 0
    );
    const toolRenderer = createToolHtmlRenderer({
      getToolDefinition: (name) => this.getToolDefinition(name),
      theme,
      cwd: this.sessionManager.getCwd()
    });
    return await exportSessionToHtml(this.sessionManager, this.state, {
      outputPath,
      themeName,
      toolRenderer
    });
  }
  /**
   * Export the current session branch to a JSONL file.
   * Writes the session header followed by all entries on the current branch path.
   * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
   * @returns The resolved output file path.
   */
  exportToJsonl(outputPath) {
    return exportSessionToJsonl(this.sessionManager, outputPath);
  }
  // =========================================================================
  // Utilities
  // =========================================================================
  /**
   * Get text content of last assistant message.
   * Useful for /copy command.
   * @returns Text content, or undefined if no assistant message exists
   */
  getLastAssistantText() {
    const lastAssistant = this.messages.slice().reverse().find((m) => {
      if (m.role !== "assistant") return false;
      const msg = m;
      if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
      return true;
    });
    if (!lastAssistant) return void 0;
    let text = "";
    for (const content of lastAssistant.content) {
      if (content.type === "text") {
        text += content.text;
      }
    }
    return text.trim() || void 0;
  }
  // =========================================================================
  // Extension System
  // =========================================================================
  createReplacedSessionContext() {
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext())
    );
    context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
    context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
    return context;
  }
  /**
   * Check if extensions have handlers for a specific event type.
   */
  hasExtensionHandlers(eventType) {
    return this._extensionRunner.hasHandlers(eventType);
  }
  /**
   * Get the extension runner (for setting UI context and error handlers).
   */
  get extensionRunner() {
    return this._extensionRunner;
  }
}
export {
  AgentSession,
  parseSkillBlock
};
