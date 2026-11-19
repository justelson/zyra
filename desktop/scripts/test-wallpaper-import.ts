import assert from 'node:assert/strict'
import { mkdtemp, link, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDownloadsWallpaper } from '../src/main/assistant/wallpaper-import'

const downloads = await mkdtemp(join(tmpdir(), 'zyra-image-reader-'))
try {
    const png = Buffer.from('89504e470d0a1a0a', 'hex') // Only the signature is consumed by main; renderer handles full decode.
    const name = 'sample.png'
    await writeFile(join(downloads, name), png)
    assert.deepEqual(await readDownloadsWallpaper(downloads, name), { mime: 'image/png', bytes: png.toString('base64') })
    for (const invalid of ['../sample.png', 'sub\\sample.png', '/sample.png', 'https://example.com/a.png', 'sample.png:other.png', 'NUL.png', 'sample.svg']) {
        await assert.rejects(readDownloadsWallpaper(downloads, invalid), /one PNG/)
    }
    await writeFile(join(downloads, 'mismatch.jpg'), png)
    await assert.rejects(readDownloadsWallpaper(downloads, 'mismatch.jpg'), /do not match/)
    await writeFile(join(downloads, 'large.png'), Buffer.alloc(12 * 1024 * 1024 + 1))
    await assert.rejects(readDownloadsWallpaper(downloads, 'large.png'), /under 12 MB/)
    await link(join(downloads, name), join(downloads, 'linked.png'))
    await assert.rejects(readDownloadsWallpaper(downloads, 'linked.png'), /not a link/)
    console.log('Downloads wallpaper reader: named raster, path restriction, contents, size and link checks passed')
} finally {
    await rm(downloads, { recursive: true, force: true })
}
