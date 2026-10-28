import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database, SqlValue } from 'sql.js/dist/sql-asm.js'
import type { AssistantTranscribeVoiceInput, AssistantVoiceHistoryEntry } from '../../shared/assistant/contracts'
import { openNativeSqliteDatabase } from './native-sqlite-adapter'
import { decodeCodexVoiceInput, transcribeVoiceWithCodex } from './codex-voice-transcription'
import { insertVoiceHistoryEntry, MAX_FAILED_VOICE_HISTORY_RECORDINGS } from './voice-history-storage'

let databasePromise: Promise<Database> | null = null

async function database(): Promise<Database> {
    if (!databasePromise) databasePromise = (async () => {
        const directory = join(app.getPath('userData'), 'assistant')
        await mkdir(directory, { recursive: true })
        const db = await openNativeSqliteDatabase(join(directory, 'voice-history.sqlite'))
        db.run('PRAGMA secure_delete = ON')
        db.run(`CREATE TABLE IF NOT EXISTS voice_history (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            engine TEXT NOT NULL CHECK (engine IN ('browser', 'codex')),
            status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
            duration_ms INTEGER NOT NULL,
            transcript TEXT,
            error TEXT,
            failed_audio BLOB
        )`)
        db.run('CREATE INDEX IF NOT EXISTS voice_history_created ON voice_history(created_at DESC)')
        return db
    })().catch(error => { databasePromise = null; throw error })
    return databasePromise
}

export type SaveVoiceHistoryInput = {
    engine: 'browser' | 'codex'
    recording: AssistantTranscribeVoiceInput
    transcript?: string
    error?: string
}

export async function saveVoiceHistory(input: SaveVoiceHistoryInput): Promise<void> {
    const audio = decodeCodexVoiceInput(input.recording)
    const transcript = input.transcript?.trim() || null
    const db = await database()
    insertVoiceHistoryEntry(db, {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        engine: input.engine,
        durationMs: input.recording.durationMs,
        transcript,
        error: input.error || null,
        audio: transcript ? null : audio
    })
}

export interface VoiceHistoryPage {
    entries: AssistantVoiceHistoryEntry[]
    page: number
    pageSize: number
    totalCount: number
    totalPages: number
}

// Kept separate from profile access so the exact bounded query can be tested with native SQLite.
export function queryVoiceHistoryPage(db: Database, input: { page?: number } = {}): VoiceHistoryPage {
    const pageSize = 20
    const requestedPage = input.page ?? 1
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) throw new Error('Invalid voice history page.')
    const totalCount = Number(db.exec('SELECT COUNT(*) FROM voice_history')[0]?.values[0]?.[0] || 0)
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
    const page = Math.min(requestedPage, totalPages)
    const entries = readVoiceHistoryRows(db, pageSize, (page - 1) * pageSize)
    return { entries, page, pageSize, totalCount, totalPages }
}

function voiceHistoryEntryFromRow(row: SqlValue[]): AssistantVoiceHistoryEntry {
    return {
        id: String(row[0]), createdAt: String(row[1]), engine: row[2] === 'browser' ? 'browser' : 'codex',
        status: row[3] === 'success' ? 'success' : 'failed', durationMs: Number(row[4]),
        transcript: typeof row[5] === 'string' ? row[5] : null,
        error: typeof row[6] === 'string' ? row[6] : null, hasRecording: Boolean(row[7])
    }
}

function readVoiceHistoryRows(db: Database, limit: number, offset: number): AssistantVoiceHistoryEntry[] {
    const rows = db.exec('SELECT id, created_at, engine, status, duration_ms, transcript, error, failed_audio IS NOT NULL FROM voice_history ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [limit, offset])[0]?.values || []
    return rows.map(voiceHistoryEntryFromRow)
}

// Legacy bridge consumers still receive their existing array shape.
export function listVoiceHistory(): Promise<AssistantVoiceHistoryEntry[]>
export function listVoiceHistory(input: { page?: number }): Promise<VoiceHistoryPage>
export async function listVoiceHistory(input?: { page?: number }): Promise<AssistantVoiceHistoryEntry[] | VoiceHistoryPage> {
    const db = await database()
    if (input) return queryVoiceHistoryPage(db, input)
    // Older bridge callers cannot page; keep retained failed audio reachable there too.
    const rows = db.exec(`SELECT id, created_at, engine, status, duration_ms, transcript, error, failed_audio IS NOT NULL
        FROM voice_history WHERE id IN (SELECT id FROM voice_history ORDER BY created_at DESC, id DESC LIMIT 200)
        OR id IN (SELECT id FROM voice_history WHERE failed_audio IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ?)
        ORDER BY created_at DESC, id DESC`, [MAX_FAILED_VOICE_HISTORY_RECORDINGS])[0]?.values || []
    return rows.map(voiceHistoryEntryFromRow)
}

export async function getFailedVoiceRecording(id: string): Promise<string | null> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return null
    const db = await database()
    const value = db.exec('SELECT failed_audio FROM voice_history WHERE id = ? AND status = ?', [id, 'failed'])[0]?.values?.[0]?.[0]
    return value instanceof Uint8Array ? Buffer.from(value).toString('base64') : null
}

export async function deleteVoiceHistory(id: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid voice history entry.')
    const db = await database()
    db.run('DELETE FROM voice_history WHERE id = ?', [id])
    db.run('PRAGMA wal_checkpoint(TRUNCATE)')
}

export async function transcribeVoiceAndSave(input: AssistantTranscribeVoiceInput, signal?: AbortSignal): Promise<string> {
    try {
        const text = await transcribeVoiceWithCodex(input, signal)
        await saveVoiceHistory({ engine: 'codex', recording: input, transcript: text })
        return text
    } catch (error) {
        // An explicit discard stays a discard; losing a renderer/client must retain its audio.
        if (signal?.aborted && (signal.reason as { code?: string } | undefined)?.code !== 'VOICE_OWNER_CLOSED') throw error
        await saveVoiceHistory({ engine: 'codex', recording: input, error: error instanceof Error ? error.message : 'Voice transcription failed.' })
        throw error
    }
}
