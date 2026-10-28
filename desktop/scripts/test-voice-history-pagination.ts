import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'zyra-voice-pages-'))
try {
    const outfile = join(directory, 'test.cjs')
    await build({
        stdin: { resolveDir: resolve(import.meta.dirname, '..'), contents: `
import assert from 'node:assert/strict'
import { queryVoiceHistoryPage } from './src/main/assistant/voice-history'
import { openNativeSqliteDatabase } from './src/main/assistant/native-sqlite-adapter'
async function main() {
const db = await openNativeSqliteDatabase(':memory:')
try {
    db.run('CREATE TABLE voice_history (id TEXT PRIMARY KEY, created_at TEXT, engine TEXT, status TEXT, duration_ms INTEGER, transcript TEXT, error TEXT, failed_audio BLOB)')
    assert.deepEqual(queryVoiceHistoryPage(db), { entries: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 1 })
    // All timestamps tie: the secondary key must prevent overlaps and missing rows.
    for (let index = 0; index < 241; index++) db.run('INSERT INTO voice_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [String(index).padStart(4, '0'), '2026-01-01T00:00:00Z', 'codex', 'success', 1000, 'text-' + index, null, null])
    const queries = []
    const execute = db.exec.bind(db)
    db.exec = (sql, params) => { queries.push({ sql, params }); return execute(sql, params) }
    const seen = []
    for (let page = 1; page <= 13; page++) {
        queries.length = 0
        const result = queryVoiceHistoryPage(db, { page })
        assert.equal(result.totalCount, 241)
        assert.equal(result.totalPages, 13)
        assert.equal(result.page, page)
        assert.equal(result.entries.length, page === 13 ? 1 : 20)
        assert.equal(queries.length, 2, 'only count and requested bounded page queried')
        assert.match(queries[1].sql, /ORDER BY created_at DESC, id DESC LIMIT \\? OFFSET \\?/)
        assert.deepEqual(queries[1].params, [20, (page - 1) * 20])
        seen.push(...result.entries.map(entry => entry.id))
    }
    assert.deepEqual(seen, Array.from({ length: 241 }, (_, index) => String(240 - index).padStart(4, '0')))
    assert.equal(new Set(seen).size, 241, 'all records beyond old 200-row boundary are reachable')
    db.run('DELETE FROM voice_history WHERE id = ?', ['0000'])
    const clamped = queryVoiceHistoryPage(db, { page: 13 })
    assert.equal(clamped.page, 12, 'deleting final entry returns previous page')
    assert.equal(clamped.entries.length, 20)
    assert.equal(clamped.totalCount, 240)
    for (const page of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => queryVoiceHistoryPage(db, { page }), /Invalid/)
    assert.equal(queryVoiceHistoryPage(db, { page: 999 }).page, 12)
    console.log('Voice history native SQLite: 241 rows, stable ties, bounded queries, counts and final-page deletion: ok')
} finally { db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
` },
        outfile, bundle: true, platform: 'node', format: 'cjs',
        plugins: [{ name: 'isolate-profile-and-provider', setup(builder) {
            builder.onResolve({ filter: /^(electron)$|codex-voice-transcription$/ }, args => ({ path: args.path, namespace: 'isolated' }))
            builder.onLoad({ filter: /.*/, namespace: 'isolated' }, () => ({ contents: 'export const app = {}; export const decodeCodexVoiceInput = () => {}; export const transcribeVoiceWithCodex = () => {}' }))
        } }]
    })
    const output = execFileSync('node', [outfile], { encoding: 'utf8' })
    assert.match(output, /241 rows/)
    process.stdout.write(output)
} finally {
    await rm(directory, { recursive: true, force: true })
}
