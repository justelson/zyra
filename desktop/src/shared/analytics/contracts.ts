import catalog from '../../../../analytics/events.v1.json'

export const ANALYTICS_SCHEMA_VERSION = 1 as const
export const ANALYTICS_CATALOG_ID = catalog.catalogId
export type AnalyticsEventName = keyof typeof catalog.events
export type AnalyticsSource = 'desktop_main' | 'desktop_renderer' | 'cli'
export type AnalyticsWorkspaceKind = 'chat' | 'browser' | 'files' | 'terminal' | 'agents' | 'resources' | 'diff' | 'unknown'
export type AnalyticsOnboardingStep = 'welcome' | 'connection' | 'appearance' | 'projects' | 'finish' | 'unknown'

export function normalizeAnalyticsOnboardingStep(value: unknown): AnalyticsOnboardingStep {
    if (value === 'welcome') return 'welcome'
    if (value === 'connect-openai') return 'connection'
    if (value === 'appearance') return 'appearance'
    if (value === 'projects') return 'projects'
    if (value === 'review') return 'finish'
    return 'unknown'
}

export function normalizeAnalyticsWorkspaceKind(value: string): AnalyticsWorkspaceKind {
    if (value === 'details' || value === 'turn') return 'chat'
    if (value === 'review' || value === 'diff') return 'diff'
    if (value === 'explorer') return 'files'
    if (value === 'browser' || value === 'terminal' || value === 'agents' || value === 'resources') return value
    return 'unknown'
}
export type AnalyticsOutcome = 'started' | 'ready' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'recovered' | 'available' | 'current' | 'unknown' | 'prevented' | 'blocked' | 'allowed' | 'denied' | 'unavailable'

export type AnalyticsEventPropertiesMap = {
    zyra_v1_app_lifecycle: { action: 'launch_ready' | 'shutdown' | 'crash' | 'hang' | 'update_check'; outcome?: AnalyticsOutcome; launch_bucket?: 'cold' | 'warm' | 'unknown'; process_kind?: 'main' | 'renderer' | 'gpu' | 'utility' | 'other'; duration_ms?: number; error_code?: string }
    zyra_v1_onboarding: { action: 'step_started' | 'step_completed' | 'step_back' | 'completed' | 'abandoned' | 'review_started' | 'review_exited'; step?: 'welcome' | 'connection' | 'appearance' | 'projects' | 'finish' | 'unknown'; outcome?: AnalyticsOutcome; error_code?: string }
    zyra_v1_account_connection: { action: 'connect' | 'replace' | 'retry' | 'disconnect'; method?: 'subscription' | 'api' | 'unknown'; outcome?: AnalyticsOutcome; error_code?: string }
    zyra_v1_chat: { action: 'create' | 'send' | 'cancel' | 'complete' | 'fail' | 'recover' | 'context_compaction'; outcome?: AnalyticsOutcome; model_family?: 'openai' | 'anthropic' | 'google' | 'groq' | 'local' | 'other' | 'unknown'; effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'unknown'; runtime_mode?: 'approval_required' | 'auto_review' | 'edits_only' | 'full_access' | 'unknown'; duration_ms?: number; attachment_count?: number; error_code?: string }
    zyra_v1_voice: { action: 'start' | 'connect' | 'first_response' | 'interrupt' | 'stop' | 'fail' | 'duplicate_prevented'; outcome?: AnalyticsOutcome; mode?: 'conversation' | 'voice_lab' | 'unknown'; duration_ms?: number; error_code?: string }
    zyra_v1_project: { action: 'attach' | 'open'; outcome?: AnalyticsOutcome; has_git?: boolean; language_count?: number; package_manager_count?: number; error_code?: string }
    zyra_v1_files: { action: 'mode_open' | 'preview' | 'edit' | 'save' | 'discard' | 'search' | 'fullscreen' | 'tree_reveal'; outcome?: AnalyticsOutcome; preview_kind?: 'text' | 'code' | 'markdown' | 'image' | 'pdf' | 'office' | 'table' | 'audio' | 'video' | 'binary' | 'unknown'; size_bucket?: 'tiny' | 'small' | 'medium' | 'large' | 'very_large' | 'unknown'; duration_ms?: number; result_count?: number; enabled?: boolean; error_code?: string }
    zyra_v1_browser: { action: 'tab_create' | 'new_tab' | 'navigation' | 'popup' | 'download' | 'history_import' | 'ad_block' | 'threat' | 'permission' | 'transfer'; outcome?: AnalyticsOutcome; destination?: 'blank' | 'search' | 'documentation' | 'code_host' | 'local' | 'media' | 'commerce' | 'social' | 'other' | 'unknown'; transfer_target?: 'main' | 'utility' | 'external' | 'unknown'; item_count?: number; duration_ms?: number; error_code?: string }
    zyra_v1_utility_window: { action: 'tab_create' | 'tab_drag' | 'tear_off' | 'merge' | 'close' | 'terminal_transfer'; outcome?: AnalyticsOutcome; tab_kind?: 'chat' | 'browser' | 'files' | 'terminal' | 'agents' | 'resources' | 'diff' | 'unknown'; tab_count?: number; error_code?: string }
    zyra_v1_workspace_ui: { action: 'agent_inbox_disclosure' | 'workspace_select' | 'settings_section' | 'theme_mode' | 'accessibility_toggle'; section?: 'general' | 'appearance' | 'account' | 'connections' | 'assistant' | 'skills' | 'voice' | 'browser_control' | 'files_editor' | 'terminal_runtime' | 'providers' | 'projects' | 'source_control' | 'privacy' | 'memory' | 'archived' | 'diagnostics' | 'about' | 'unknown'; workspace?: 'chat' | 'browser' | 'files' | 'terminal' | 'agents' | 'resources' | 'diff' | 'unknown'; theme_mode?: 'system' | 'light' | 'dark' | 'unknown'; enabled?: boolean }
    zyra_v1_cli: { action: 'startup' | 'slash_command' | 'skill' | 'workspace_command' | 'recovery'; command?: string; skill?: string; outcome?: AnalyticsOutcome; session_mode?: 'new' | 'continue' | 'resume' | 'none' | 'unknown'; runtime?: 'client' | 'embedded' | 'unknown'; error_code?: string }
}

export type AnalyticsEventInput<Name extends AnalyticsEventName = AnalyticsEventName> = Name extends AnalyticsEventName
    ? { event: Name; properties: AnalyticsEventPropertiesMap[Name] }
    : never

export type AnalyticsStatus = {
    requested: boolean
    preferenceSet: boolean
    enabled: boolean
    configured: boolean
    reason: string
    hostCategory: string
    enabledSource: 'environment' | 'persisted'
    canChangeEnabled: boolean
    queueSize: number
    catalogId: string
}

export type AnalyticsStatusResult = { success: true; status: AnalyticsStatus } | { success: false; error: string }
export type AnalyticsCaptureResult = { success: true; accepted: boolean } | { success: false; error: string }

export interface DesktopAnalyticsApi {
    getStatus: () => Promise<AnalyticsStatusResult>
    setEnabled: (enabled: boolean) => Promise<AnalyticsStatusResult>
    capture: <Name extends AnalyticsEventName>(input: AnalyticsEventInput<Name>) => Promise<AnalyticsCaptureResult>
    onStatusChange: (callback: (status: AnalyticsStatus) => void) => () => void
}

export const ANALYTICS_IPC = {
    getStatus: 'zyra:analytics:get-status',
    setEnabled: 'zyra:analytics:set-enabled',
    capture: 'zyra:analytics:capture',
    statusChanged: 'zyra:analytics:status-changed'
} as const
