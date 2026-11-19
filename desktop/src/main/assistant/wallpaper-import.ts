import { open, lstat, realpath } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'

/** Import one direct Downloads child. No directory enumeration, remote URL, link, or arbitrary path. */
export async function readDownloadsWallpaper(downloads: string, filename: unknown) {
    if (typeof filename !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f]{1,240}\.(?:png|jpe?g|webp)$/i.test(filename) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) throw Error('Choose one PNG, JPEG or WebP filename directly in Downloads.')
    const root = await realpath(downloads), path = join(root, filename)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.nlink !== 1 || dirname(await realpath(path)) !== root) throw Error('Choose a regular local image, not a link.')
    const handle = await open(path,'r')
    try {
        const info = await handle.stat()
        if (stat.dev !== info.dev || stat.ino !== info.ino || !info.isFile() || !info.size || info.size > 12*1024*1024) throw Error('Choose a local image under 12 MB.')
        const bytes = Buffer.alloc(info.size); let offset = 0
        while (offset < bytes.length) { const {bytesRead} = await handle.read(bytes,offset,bytes.length-offset,offset); if (!bytesRead) throw Error('Image changed during import.'); offset += bytesRead }
        const ext = extname(filename).toLowerCase()
        const mime = ext === '.png' && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'image/png' : /^\.jpe?g$/.test(ext) && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 ? 'image/jpeg' : ext==='.webp' && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' ? 'image/webp' : null
        if (!mime) throw Error('Image contents do not match the file type.')
        return { mime, bytes: bytes.toString('base64') }
    } finally { await handle.close() }
}
