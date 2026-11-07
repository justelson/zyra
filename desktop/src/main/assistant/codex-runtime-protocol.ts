import { nativeReasoningValue } from '../../../../src/reasoning-choices.mjs'
import type readline from 'node:readline'
import type {
    AssistantApprovalRequestType,
    AssistantInteractionMode,
    AssistantReasoningEffort,
    AssistantRuntimeMode,
    AssistantThread
} from '../../shared/assistant/contracts'
import {
    asRecord,
    asString,
    buildToolActivity,
    extractItemPaths,
    normalizeItemType,
    readNumericValue,
    readStringArray,
    readTextValue,
    readToolOutput,
    readToolTiming
} from './codex-runtime-value-utils'
import {
    isAssistantItemType as isAssistantItemTypeImpl,
    mapRuntimeMode as mapRuntimeModeImpl,
    readTurnUsage as readTurnUsageImpl,
    toApprovalRequestType as toApprovalRequestTypeImpl,
    toUserInputQuestions as toUserInputQuestionsImpl
} from './codex-runtime-session-utils'

export {
    asRecord,
    asString,
    buildToolActivity,
    extractItemPaths,
    normalizeItemType,
    readNumericValue,
    readStringArray,
    readTextValue,
    readToolOutput,
    readToolTiming
}

export type JsonRpcId = string | number
export type JsonRpcMessage = Record<string, unknown>

export interface PendingRpc {
    method: string
    timer: NodeJS.Timeout
    resolve: (value: unknown) => void
    reject: (error: Error) => void
}

export interface PendingApprovalRequest {
    requestId: string
    jsonRpcId: JsonRpcId
    requestType: AssistantApprovalRequestType
    threadId: string
    turnId?: string
    itemId?: string
}

export interface PendingUserInputRequest {
    requestId: string
    jsonRpcId: JsonRpcId
    threadId: string
    turnId?: string
    itemId?: string
}

export interface SessionContext {
    output: readline.Interface
    pending: Map<string, PendingRpc>
    pendingApprovals: Map<string, PendingApprovalRequest>
    pendingUserInputs: Map<string, PendingUserInputRequest>
    fileChangeRevisionByItemId: Map<string, number>
    nextRequestId: number
    stopping: boolean
    thread: AssistantThread
}

export function readTurnUsage(turn: Record<string, unknown> | undefined, payload: Record<string, unknown>) {
    return readTurnUsageImpl(turn, payload, readNumericValue, asRecord)
}

export function isAssistantItemType(itemType: string): boolean {
    return isAssistantItemTypeImpl(itemType)
}

export function toUserInputQuestions(value: unknown) {
    return toUserInputQuestionsImpl(value, asRecord, asString)
}

export function toApprovalRequestType(method: string) {
    return toApprovalRequestTypeImpl(method)
}

export function mapRuntimeMode(mode: AssistantRuntimeMode) {
    return mapRuntimeModeImpl(mode)
}

const CODEX_WINDOWS_SHELL_DEVELOPER_INSTRUCTIONS = `## Windows Shell Rules

You are running on Windows. When you use shell commands, treat PowerShell as the default shell unless you intentionally invoke a different shell.

- Do not use bash-style escaping such as \\" inside PowerShell command strings.
- Prefer single-quoted PowerShell strings or PowerShell here-strings when the command contains quotes, braces, colons, or regex.
- If a PowerShell command starts getting quote-heavy or nested, split it into smaller commands instead of forcing one fragile one-liner.
- For formatted output in PowerShell, prefer format expressions like ('=== {0} @ {1} ===' -f $id, $line) instead of embedded escaped quotes.
- Prefer PowerShell-native commands for Windows filesystem work. Do not compose bash pipelines unless you are explicitly running bash.
- Before sending a shell command, sanity-check that the command is valid for PowerShell syntax on Windows.
`

const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS = `<collaboration_mode># Collaboration Mode: Default

There is no separate planning mode. Inspect, ask, plan, and implement in the normal conversation according to the user's request and the work's risk.

## Requesting user input

Use request_user_input only after inspecting available context and only when a user decision materially blocks useful work. Appropriate cases include meaningful tradeoffs, missing scope, risky targets, and unresolved contradictions.

Do not ask for facts that can be discovered from the repository or system. Never ask for secrets. Use as many materially necessary questions as needed, but do not manufacture questions or turn routine work into a questionnaire.

Choose the control that fits the decision: text for open answers, single select for an obvious bounded choice, multi-select for several choices, confirm for a true yes/no decision, file select for user choice among known project paths, number or date when validation matters, and ranking when order is the decision. Allow a custom select answer only when the listed choices may reasonably be incomplete.

If Playground lab setup is declined, answer normally without filesystem access instead of retrying the same lab request.

## Plan cards

Use a <proposed_plan> block when the user explicitly asks for a plan or specification, or when broad or high-risk work needs an approval handoff before implementation. Inspect first and make the plan actionable. Do not emit plan cards for routine fixes or progress checklists.

Use Markdown inside the block. Include a clear title, concise scope, important interfaces or data flow, verification, assumptions, and any genuinely open decisions. Produce at most one <proposed_plan> block per turn.
</collaboration_mode>`

function buildDeveloperInstructions(): string {
    if (process.platform !== 'win32') return CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS
    return `${CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS}\n\n${CODEX_WINDOWS_SHELL_DEVELOPER_INSTRUCTIONS}`
}

function buildCollaborationMode(model: string | undefined, effort?: AssistantReasoningEffort) {
    return {
        mode: 'default',
        settings: {
            ...(model ? { model } : {}),
            reasoning_effort: effort === 'default' ? null : nativeReasoningValue(effort) || 'medium',
            developer_instructions: buildDeveloperInstructions()
        }
    }
}

export function buildTurnParams(
    thread: AssistantThread,
    prompt: string,
    model?: string,
    runtimeMode?: AssistantRuntimeMode,
    interactionMode?: AssistantInteractionMode,
    effort?: AssistantReasoningEffort,
    serviceTier?: 'fast'
) {
    const effectiveModel = model || thread.model
    void interactionMode
    const params: Record<string, unknown> = {
        threadId: thread.providerThreadId,
        input: [{ type: 'text', text: prompt }],
        approvalPolicy: mapRuntimeMode(runtimeMode || thread.runtimeMode).approvalPolicy,
        collaborationMode: buildCollaborationMode(effectiveModel, effort)
    }
    if (effectiveModel) params['model'] = effectiveModel
    if (effort && effort !== 'default') params['effort'] = nativeReasoningValue(effort)
    if (serviceTier) params['serviceTier'] = serviceTier
    return params
}
