import type { Database as SqlDatabase } from 'sql.js/dist/sql-asm.js'
import type { FleetSnapshot } from '../../shared/assistant/contracts'
import { shouldApplyAssistantFleetSnapshot } from './fleet-projection'
import { jsonStringify, runSqlTransaction } from './persistence-utils'

export function projectFleetSnapshot(db: SqlDatabase, threadId: string, snapshot: FleetSnapshot): void {
    if (!shouldApplyAssistantFleetSnapshot(readFleetSnapshot(db, threadId), snapshot)) return
    runSqlTransaction(db, () => writeFleetSnapshot(db, threadId, snapshot))
}

/** Caller owns the transaction and freshness decision. */
export function writeFleetSnapshot(db: SqlDatabase, threadId: string, snapshot: FleetSnapshot): void {
    db.run('DELETE FROM assistant_agent_relationships WHERE root_thread_id = ?', [threadId])
    db.run('DELETE FROM assistant_agent_artifacts WHERE root_thread_id = ?', [threadId])
    db.run('DELETE FROM assistant_workflow_calls WHERE root_thread_id = ?', [threadId])
    db.run('DELETE FROM assistant_workflow_phases WHERE root_thread_id = ?', [threadId])
    db.run('DELETE FROM assistant_workflow_runs WHERE root_thread_id = ?', [threadId])
    db.run('DELETE FROM assistant_agent_runs WHERE root_thread_id = ?', [threadId])
    for (const run of Object.values(snapshot.agents)) {
        db.run('INSERT INTO assistant_agent_runs (agent_run_id, root_thread_id, status, parent_agent_run_id, workflow_run_id, session_file, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [run.agentRunId, threadId, run.status, run.parentAgentRunId, run.workflowRunId, run.sessionFile, run.completedAt || run.startedAt || run.createdAt, jsonStringify(run)])
    }
    for (const run of Object.values(snapshot.workflows)) {
        db.run('INSERT INTO assistant_workflow_runs (workflow_run_id, root_thread_id, status, definition_name, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)', [run.workflowRunId, threadId, run.status, run.definitionName, run.completedAt || run.startedAt || run.createdAt, jsonStringify(run)])
        for (const phase of Object.values(run.phases)) db.run('INSERT INTO assistant_workflow_phases (workflow_run_id, root_thread_id, phase_id, status, payload_json) VALUES (?, ?, ?, ?, ?)', [run.workflowRunId, threadId, phase.phaseId, phase.status, jsonStringify(phase)])
        for (const call of Object.values(run.calls)) db.run('INSERT INTO assistant_workflow_calls (workflow_run_id, root_thread_id, call_id, agent_run_id, status, payload_json) VALUES (?, ?, ?, ?, ?, ?)', [run.workflowRunId, threadId, call.callId, call.agentRunId ?? null, call.status, jsonStringify(call)])
    }
    for (const edge of snapshot.relationships) db.run('INSERT INTO assistant_agent_relationships (root_thread_id, child_agent_run_id, parent_agent_run_id, workflow_run_id, workflow_phase_id) VALUES (?, ?, ?, ?, ?)', [threadId, edge.childAgentRunId, edge.parentAgentRunId, edge.workflowRunId, edge.workflowPhaseId])
    for (const artifact of snapshot.artifacts) db.run('INSERT INTO assistant_agent_artifacts (artifact_id, root_thread_id, agent_run_id, workflow_run_id, kind, path, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [artifact.artifactId, threadId, artifact.agentRunId, artifact.workflowRunId, artifact.kind, artifact.path, artifact.createdAt, jsonStringify(artifact)])
    db.run('INSERT OR REPLACE INTO assistant_fleet_snapshots (root_thread_id, sequence, updated_at, payload_json) VALUES (?, ?, ?, ?)', [threadId, snapshot.lastAppliedSequence, snapshot.updatedAt, jsonStringify(snapshot)])
}

export function deleteFleetProjection(db: SqlDatabase, threadId: string): void {
    runSqlTransaction(db, () => {
        for (const table of ['assistant_agent_relationships', 'assistant_agent_artifacts', 'assistant_workflow_calls', 'assistant_workflow_phases', 'assistant_workflow_runs', 'assistant_agent_runs', 'assistant_fleet_snapshots']) {
            db.run(`DELETE FROM ${table} WHERE root_thread_id = ?`, [threadId])
        }
    })
}

export function readFleetSnapshot(db: SqlDatabase, threadId: string): FleetSnapshot | null {
    const value = db.exec('SELECT payload_json FROM assistant_fleet_snapshots WHERE root_thread_id = ?', [threadId])[0]?.values?.[0]?.[0]
    if (typeof value !== 'string') return null
    try { return JSON.parse(value) as FleetSnapshot } catch { return null }
}

/** Bounded parameter batches work with both native SQLite and the SQL.js fallback. */
export function readFleetSnapshots(db: SqlDatabase, threadIds: readonly string[]): Record<string, FleetSnapshot> {
    const snapshots: Record<string, FleetSnapshot> = Object.create(null)
    const ids = [...new Set(threadIds)]
    for (let offset = 0; offset < ids.length; offset += 900) {
        const batch = ids.slice(offset, offset + 900)
        const rows = db.exec(`SELECT root_thread_id, payload_json FROM assistant_fleet_snapshots WHERE root_thread_id IN (${batch.map(() => '?').join(',')})`, batch)[0]?.values || []
        for (const [threadId, value] of rows) {
            if (typeof threadId !== 'string' || typeof value !== 'string') continue
            try {
                const snapshot = JSON.parse(value) as FleetSnapshot | null
                if (snapshot) snapshots[threadId] = snapshot
            } catch {}
        }
    }
    return snapshots
}
