import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mock } from 'bun:test'

const real = { ...fs }
const root = await real.mkdtemp(join(tmpdir(), 'zyra-content-swap-'))
const outside = await real.mkdtemp(join(tmpdir(), 'zyra-outside-swap-'))
const target = join(root, 'src', 'candidate.txt')
let swapped = false
let reads = 0
mock.module('node:fs/promises', () => ({ ...real, open: async (filename: any, ...args: any[]) => {
    if (resolve(String(filename)) === resolve(target) && !swapped) {
        swapped = true
        await real.rename(join(root, 'src'), join(root, 'original-src'))
        await real.symlink(outside, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
    }
    const handle = await (real.open as any)(filename, ...args)
    return new Proxy(handle, { get(object, key) {
        if (key === 'read') return (...readArgs: any[]) => { reads++; return object.read(...readArgs) }
        const value = object[key]
        return typeof value === 'function' ? value.bind(object) : value
    } })
} }))
const { searchProjectContents } = await import('../src/main/services/project-content-search')
try {
    execFileSync('git', ['init', '--quiet', root], { windowsHide: true })
    await real.mkdir(join(root, 'src'))
    await real.writeFile(target, 'ordinary project contents')
    await real.writeFile(join(outside, 'candidate.txt'), 'needle synthetic outside-root contents')
    const result = await searchProjectContents({ root, query: 'needle' })
    assert.equal(swapped, true, 'the race occurs exactly after candidate validation and before native open')
    assert.equal(reads, 0, 'an opened descriptor for another file is rejected before any content read')
    assert.deepEqual(result.matches, [], 'a swapped parent symlink or junction cannot surface outside-root contents')
    console.log('Project search native descriptor race: parent replacement is rejected before reading: ok')
} finally {
    mock.restore()
    for (const folder of [root, outside]) {
        assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')))
        await real.rm(folder, { recursive: true, force: true })
    }
}
