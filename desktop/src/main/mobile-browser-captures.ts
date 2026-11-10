import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { BrowserCaptureLibrary } from './browser-capture-library'

const LIMIT = 64 * 1024 * 1024
const CHUNK = 48 * 1024
const stamp = (value: { size: number; mtimeMs: number; ctimeMs: number }) => `${value.size}:${value.mtimeMs}:${value.ctimeMs}`

/** Managed IDs are the only selectors. A path is disclosed only for an explicit chat attachment. */
export class MobileBrowserCaptures {
    private readonly library: BrowserCaptureLibrary
    constructor(directory: string) { this.library = new BrowserCaptureLibrary(directory) }
    list(input: { offset?: number; limit?: number } = {}) {
        const page = this.library.list(input)
        return { ...page, captures: page.captures.map(({ artifactId, kind, mimeType, sizeBytes, createdAt }) => ({ artifactId, kind, mimeType, sizeBytes, createdAt })) }
    }
    reference(artifactId: string) {
        const capture = this.library.get(artifactId)
        return { destination: capture.path.replaceAll('\\', '/'), title: capture.kind === 'recording' ? 'Browser recording' : 'Browser screenshot' }
    }
    delete(artifactId: string) { this.library.delete(artifactId); return { deleted: true } }
    async get(artifactId: string) {
        const capture = this.library.get(artifactId)
        const handle = await open(capture.path, 'r')
        try {
            const before = await handle.stat()
            if (!before.isFile() || before.size < 1 || before.size > LIMIT) throw new Error('Captures can be up to 64 MB on mobile.')
            const hash = createHash('sha256'), bytes = Buffer.alloc(CHUNK)
            let offset = 0
            while (offset < before.size) {
                const { bytesRead } = await handle.read(bytes, 0, Math.min(CHUNK, before.size - offset), offset)
                if (!bytesRead) throw new Error('Capture changed. Refresh the library.')
                hash.update(bytes.subarray(0, bytesRead)); offset += bytesRead
            }
            if (stamp(await handle.stat()) !== stamp(before)) throw new Error('Capture changed. Refresh the library.')
            return { mediaRef: { version: 2, mimeType: capture.mimeType, bytes: before.size, sha256: hash.digest('hex'), source: { kind: 'capture', artifactId, etag: stamp(before) } } }
        } finally { await handle.close() }
    }
    async chunk(ref: { source?: { kind?: string; artifactId?: string; etag?: string }; bytes?: number; sha256?: string; mimeType?: string }, offset: number) {
        if (ref.source?.kind !== 'capture' || typeof ref.source.artifactId !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256 || '')
            || !Number.isSafeInteger(ref.bytes) || ref.bytes! < 1 || ref.bytes! > LIMIT || !Number.isSafeInteger(offset) || offset < 0 || offset >= ref.bytes!) throw new Error('Invalid capture reference.')
        const capture = this.library.get(ref.source.artifactId)
        if (capture.mimeType !== ref.mimeType) throw new Error('Capture changed. Refresh the library.')
        const handle = await open(capture.path, 'r')
        try {
            const metadata = await handle.stat()
            if (metadata.size !== ref.bytes || stamp(metadata) !== ref.source.etag) throw new Error('Capture changed. Refresh the library.')
            const bytes = Buffer.alloc(Math.min(CHUNK, metadata.size - offset))
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset)
            if (!bytesRead || stamp(await handle.stat()) !== ref.source.etag) throw new Error('Capture changed. Refresh the library.')
            return { base64: bytes.subarray(0, bytesRead).toString('base64'), next: offset + bytesRead, total: metadata.size, sha256: ref.sha256 }
        } finally { await handle.close() }
    }
}
