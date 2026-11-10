import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MobileBrowserCaptures } from '../src/main/mobile-browser-captures'

const directory = await mkdtemp(join(tmpdir(), 'zyra-mobile-captures-'))
try {
    const id = 'browser-screenshot:11111111-1111-4111-8111-111111111111'
    const file = join(directory, '11111111-1111-4111-8111-111111111111.png')
    const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(60_000)])
    await writeFile(file, bytes)
    await writeFile(join(directory, 'unmanaged.txt'), 'Keep this file')
    const access = new MobileBrowserCaptures(directory)
    assert.equal(access.reference(id).destination, file.replaceAll('\\', '/'))
    assert.throws(() => access.reference('../../unmanaged.txt'))
    const page = access.list()
    assert.equal(page.captures.length, 1)
    assert(!JSON.stringify(page).includes(directory))
    const { mediaRef: ref } = await access.get(id)
    const chunks: Buffer[] = []
    for (let offset = 0; offset < ref.bytes;) {
        const part = await access.chunk(ref, offset); chunks.push(Buffer.from(part.base64, 'base64')); offset = part.next
    }
    assert.deepEqual(Buffer.concat(chunks), bytes)
    await writeFile(file, Buffer.concat([bytes, Buffer.from('changed')]))
    await assert.rejects(access.chunk(ref, 0), /changed/)
    await assert.rejects(access.get('../../unmanaged.txt'))
    access.delete(id)
    assert.equal(access.list().captures.length, 0)
    assert.equal(await readFile(join(directory, 'unmanaged.txt'), 'utf8'), 'Keep this file')
    console.log('Mobile Browser captures: managed IDs, bounded transfer, change detection, safe metadata and scoped deletion passed')
} finally { await rm(directory, { recursive: true, force: true }) }
