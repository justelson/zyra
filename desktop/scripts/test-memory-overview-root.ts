import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMemoryGetOverview, handleMemoryGetJobStatus } from '../src/main/ipc/handlers/memory-handlers'
const root = await mkdtemp(join(tmpdir(), 'zyra-memory-overview-'))
const previous = process.env.ZYRA_DATA_ROOT
try {
    process.env.ZYRA_DATA_ROOT = root
    const memory = join(root, '.zyra', 'memory')
    await mkdir(memory, { recursive: true })
    await writeFile(join(memory, 'memory_summary.md'), 'Fixture durable memory')
    await writeFile(join(memory, 'notes.md'), 'Fixture notes')
    const result = await handleMemoryGetOverview()
    assert.equal(result.success, true)
    if (!result.success) throw new Error(result.error)
    assert.equal(result.overview.rootPath, root)
    assert.equal(result.overview.memoryDirectory, memory)
    assert.equal(result.overview.memoryLayers[0].id, 'memory_summary')
    assert.equal(result.overview.memoryLayers[0].content, 'Fixture durable memory')
    const statusDirectory = join(root, 'assistant', 'agent-server')
    await mkdir(statusDirectory, { recursive: true })
    const file = join(statusDirectory, 'memory-jobs.json')
    await writeFile(file, JSON.stringify({ phase: 'running', queued: 2, pid: process.pid, lastSuccessAt: 12345, lastError: 'private diagnostic' }))
    const status = handleMemoryGetJobStatus(root)
    assert.ok(status.success)
    if (!status.success) throw new Error(status.error)
    assert.equal(status.status.phase, 'running'); assert.equal(status.status.lastSuccessAt, 12345)
    assert.ok(!JSON.stringify(status).includes('private diagnostic'))
    await writeFile(file, JSON.stringify({ phase: 'running', queued: 2, pid: 2147483646, lastSuccessAt: 12345 }))
    const stopped = handleMemoryGetJobStatus(root)
    assert.ok(stopped.success && stopped.status.phase === 'offline' && stopped.status.queued === 0 && stopped.status.lastSuccessAt === 12345)
    console.log('Memory Settings reads the server data root and prioritizes durable memory: ok')
} finally {
    if (previous === undefined) delete process.env.ZYRA_DATA_ROOT
    else process.env.ZYRA_DATA_ROOT = previous
    await rm(root, { recursive: true, force: true })
}
