import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMemoryGetOverview } from '../src/main/ipc/handlers/memory-handlers'
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
    console.log('Memory Settings reads the server data root and prioritizes durable memory: ok')
} finally {
    if (previous === undefined) delete process.env.ZYRA_DATA_ROOT
    else process.env.ZYRA_DATA_ROOT = previous
    await rm(root, { recursive: true, force: true })
}
