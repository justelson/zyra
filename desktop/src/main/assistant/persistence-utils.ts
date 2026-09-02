import type { Database as SqlDatabase, SqlValue } from 'sql.js/dist/sql-asm.js'
import type {
    AssistantDomainEvent,
    AssistantSession,
    AssistantSnapshot
} from '../../shared/assistant/contracts'
import { initializeAssistantProjectSchema } from './assistant-project-persistence'

export interface AssistantPersistenceRecord {
    version: number
    snapshot: AssistantSnapshot
    events: AssistantDomainEvent[]
}

export interface AssistantMetaRow {
    snapshotSequence: number
    updatedAt: string
    selectedSessionId: string | null
    playgroundRootPath: string | null
    knownModels: AssistantSnapshot['knownModels']
}

export const PERSISTENCE_VERSION = 7
export const PERSISTENCE_FLUSH_DEBOUNCE_MS = 1500

export function jsonStringify(value: unknown): string {
    return JSON.stringify(value ?? null)
}

export function parseJson<T>(value: SqlValue, fallback: T): T {
    if (typeof value !== 'string' || !value) return fallback
    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

export function sqlBool(value: boolean): number {
    return value ? 1 : 0
}

export function toNullableString(value: SqlValue): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

export function toNumber(value: SqlValue, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readAssistantMetaValue(db: SqlDatabase, key: string): string | null {
    const row = db.exec('SELECT value FROM assistant_meta WHERE key = ?', [key])[0]?.values?.[0] || null
    return typeof row?.[0] === 'string' && row[0].length > 0 ? row[0] : null
}

export function readAssistantPersistenceVersion(db: SqlDatabase): number | null {
    const value = readAssistantMetaValue(db, 'persistenceVersion')
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function normalizeAssistantPath(value?: string | null): string {
    return String(value || '').trim()
}

function resolveSessionProjectPath(session: AssistantSession): string {
    if (normalizeAssistantPath(session.projectPath)) return normalizeAssistantPath(session.projectPath)
    for (const thread of session.threads) {
        const cwd = normalizeAssistantPath(thread.cwd)
        if (cwd) return cwd
    }
    return ''
}

function hasSessionMessages(session: AssistantSession): boolean {
    return session.threads.some((thread) => {
        const summarizedCount = Number.isFinite(thread.messageCount) ? thread.messageCount : 0
        return summarizedCount > 0 || thread.messages.length > 0
    })
}

export function shouldPersistAssistantSession(session: AssistantSession): boolean {
    if (session.mode !== 'playground') return true
    return hasSessionMessages(session)
}

export function shouldDeleteInvalidSession(session: AssistantSession): boolean {
    return !resolveSessionProjectPath(session) && !hasSessionMessages(session)
}

export function runSqlTransaction(db: SqlDatabase, work: () => void): void {
    db.run('BEGIN')
    try {
        work()
        db.run('COMMIT')
    } catch (error) {
        db.run('ROLLBACK')
        throw error
    }
}

export function initializeAssistantPersistenceSchema(db: SqlDatabase): void {
    db.run('PRAGMA foreign_keys = ON;')
    db.run(`
        CREATE TABLE IF NOT EXISTS assistant_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'work',
            project_path TEXT,
            playground_lab_id TEXT,
            pending_lab_request_json TEXT,
            archived INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            active_thread_id TEXT
        );
        CREATE TABLE IF NOT EXISTS assistant_threads (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            provider_thread_id TEXT,
            source TEXT NOT NULL DEFAULT 'root',
            parent_thread_id TEXT,
            provider_parent_thread_id TEXT,
            subagent_depth INTEGER,
            agent_nickname TEXT,
            agent_role TEXT,
            model TEXT NOT NULL,
            thinking TEXT,
            profile TEXT,
            cwd TEXT,
            message_count INTEGER NOT NULL,
            last_seen_completed_turn_id TEXT,
            runtime_mode TEXT NOT NULL,
            interaction_mode TEXT NOT NULL,
            web_search INTEGER,
            web_fetch INTEGER,
            state TEXT NOT NULL,
            canonical_presence_json TEXT,
            canonical_history_modified_at TEXT,
            canonical_history_entry_count INTEGER,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            latest_turn_json TEXT,
            active_plan_json TEXT,
            FOREIGN KEY(session_id) REFERENCES assistant_sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_turns (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            model TEXT NOT NULL,
            state TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            assistant_message_id TEXT,
            effort TEXT,
            service_tier TEXT,
            usage_json TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            turn_id TEXT,
            streaming INTEGER NOT NULL,
            timeline_sequence INTEGER,
            provider_item_id TEXT,
            modality TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_activities (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            tone TEXT NOT NULL,
            summary TEXT NOT NULL,
            detail TEXT,
            turn_id TEXT,
            timeline_sequence INTEGER,
            created_at TEXT NOT NULL,
            payload_json TEXT,
            FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_proposed_plans (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            turn_id TEXT,
            plan_markdown TEXT NOT NULL,
            timeline_sequence INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_pending_approvals (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            request_id TEXT NOT NULL UNIQUE,
            request_type TEXT NOT NULL,
            title TEXT,
            detail TEXT,
            command TEXT,
            paths_json TEXT,
            status TEXT NOT NULL,
            decision TEXT,
            turn_id TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_pending_user_inputs (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            request_id TEXT NOT NULL UNIQUE,
            questions_json TEXT NOT NULL,
            status TEXT NOT NULL,
            answers_json TEXT,
            turn_id TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assistant_playground_labs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            root_path TEXT NOT NULL,
            source TEXT NOT NULL,
            repo_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_fleet_snapshots (
            root_thread_id TEXT PRIMARY KEY,
            sequence INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_agent_runs (
            agent_run_id TEXT PRIMARY KEY,
            root_thread_id TEXT NOT NULL,
            status TEXT NOT NULL,
            parent_agent_run_id TEXT,
            workflow_run_id TEXT,
            session_file TEXT,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_workflow_runs (
            workflow_run_id TEXT PRIMARY KEY,
            root_thread_id TEXT NOT NULL,
            status TEXT NOT NULL,
            definition_name TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_workflow_phases (
            workflow_run_id TEXT NOT NULL,
            root_thread_id TEXT NOT NULL,
            phase_id TEXT NOT NULL,
            status TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY(workflow_run_id, phase_id)
        );
        CREATE TABLE IF NOT EXISTS assistant_workflow_calls (
            workflow_run_id TEXT NOT NULL,
            root_thread_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            agent_run_id TEXT,
            status TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY(workflow_run_id, call_id)
        );
        CREATE TABLE IF NOT EXISTS assistant_agent_relationships (
            root_thread_id TEXT NOT NULL,
            child_agent_run_id TEXT NOT NULL,
            parent_agent_run_id TEXT,
            workflow_run_id TEXT,
            workflow_phase_id TEXT,
            PRIMARY KEY(root_thread_id, child_agent_run_id)
        );
        CREATE TABLE IF NOT EXISTS assistant_agent_artifacts (
            artifact_id TEXT PRIMARY KEY,
            root_thread_id TEXT NOT NULL,
            agent_run_id TEXT,
            workflow_run_id TEXT,
            kind TEXT NOT NULL,
            path TEXT,
            created_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assistant_threads_session ON assistant_threads(session_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_turns_thread ON assistant_turns(thread_id, requested_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages(thread_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_activities_thread ON assistant_activities(thread_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_plans_thread ON assistant_proposed_plans(thread_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_approvals_thread ON assistant_pending_approvals(thread_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_user_inputs_thread ON assistant_pending_user_inputs(thread_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_playground_labs_updated ON assistant_playground_labs(updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_agent_runs_root ON assistant_agent_runs(root_thread_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_agent_runs_parent ON assistant_agent_runs(parent_agent_run_id);
        CREATE INDEX IF NOT EXISTS idx_assistant_agent_runs_workflow ON assistant_agent_runs(workflow_run_id);
        CREATE INDEX IF NOT EXISTS idx_assistant_workflows_root ON assistant_workflow_runs(root_thread_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_workflow_calls_agent ON assistant_workflow_calls(agent_run_id);
        CREATE INDEX IF NOT EXISTS idx_assistant_artifacts_root ON assistant_agent_artifacts(root_thread_id, created_at DESC);
    `)
    initializeAssistantProjectSchema(db)
    ensureTableColumn(db, 'assistant_sessions', 'mode', `TEXT NOT NULL DEFAULT 'work'`)
    ensureTableColumn(db, 'assistant_sessions', 'playground_lab_id', 'TEXT')
    ensureTableColumn(db, 'assistant_sessions', 'pending_lab_request_json', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'source', `TEXT NOT NULL DEFAULT 'root'`)
    ensureTableColumn(db, 'assistant_threads', 'parent_thread_id', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'provider_parent_thread_id', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'subagent_depth', 'INTEGER')
    ensureTableColumn(db, 'assistant_threads', 'agent_nickname', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'agent_role', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'thinking', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'profile', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'canonical_presence_json', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'canonical_history_modified_at', 'TEXT')
    ensureTableColumn(db, 'assistant_threads', 'canonical_history_entry_count', 'INTEGER')
    ensureTableColumn(db, 'assistant_threads', 'web_search', 'INTEGER')
    ensureTableColumn(db, 'assistant_threads', 'web_fetch', 'INTEGER')
    ensureTableColumn(db, 'assistant_messages', 'timeline_sequence', 'INTEGER')
    ensureTableColumn(db, 'assistant_messages', 'provider_item_id', 'TEXT')
    ensureTableColumn(db, 'assistant_messages', 'modality', 'TEXT')
    ensureTableColumn(db, 'assistant_activities', 'timeline_sequence', 'INTEGER')
    ensureTableColumn(db, 'assistant_proposed_plans', 'timeline_sequence', 'INTEGER')
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_history ON assistant_messages(thread_id, created_at DESC, timeline_sequence DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_activities_history ON assistant_activities(thread_id, created_at DESC, timeline_sequence DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_plans_history ON assistant_proposed_plans(thread_id, created_at DESC, timeline_sequence DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_history_order_v2 ON assistant_messages(thread_id, created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_activities_history_order_v2 ON assistant_activities(thread_id, created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_plans_history_order_v2 ON assistant_proposed_plans(thread_id, created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_user_history_v2 ON assistant_messages(thread_id, role, created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_turn ON assistant_messages(thread_id, turn_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_activities_turn ON assistant_activities(thread_id, turn_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_plans_turn ON assistant_proposed_plans(thread_id, turn_id, created_at ASC, id ASC);
    `)
}

function ensureTableColumn(db: SqlDatabase, tableName: string, columnName: string, definition: string): void {
    const rows = db.exec(`PRAGMA table_info(${tableName})`)[0]?.values || []
    const hasColumn = rows.some((row) => String(row[1] || '') === columnName)
    if (hasColumn) return
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}
