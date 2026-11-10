import { existsSync, lstatSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { DevScopeBrowserCaptureArtifact } from '../shared/contracts/devscope-api'

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const FILE = new RegExp(`^(${UUID})\\.(png|webm|mp4)$`, 'i')
const ID = new RegExp(`^browser-(screenshot|recording):(${UUID})$`, 'i')
export type LibraryCapture = DevScopeBrowserCaptureArtifact & { path: string }

/** The managed files are the durable catalog, including captures from older builds. */
export class BrowserCaptureLibrary {
    constructor(readonly directory: string) {}
    get(artifactId: string): LibraryCapture {
        const match = ID.exec(String(artifactId))
        if (!match || !existsSync(this.directory)) throw new Error('Capture is unavailable.')
        const kind = match[1].toLowerCase() as 'screenshot' | 'recording'
        const extensions = kind === 'screenshot' ? ['png'] : ['webm', 'mp4']
        for (const extension of extensions) {
            const file = join(this.directory, `${match[2]}.${extension}`)
            if (!existsSync(file)) continue
            const stats = lstatSync(file)
            if (!stats.isFile() || stats.isSymbolicLink() || dirname(realpathSync(file)) !== realpathSync(this.directory)) throw new Error('Capture is outside the managed folder.')
            return { artifactId, tabId: 'capture-library', kind, path: file,
                mimeType: extension === 'png' ? 'image/png' : `video/${extension}`, sizeBytes: stats.size,
                createdAt: (stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime).toISOString() }
        }
        throw new Error('Capture file is missing.')
    }
    list(input: { offset?: number; limit?: number; kind?: 'screenshot' | 'recording' } = {}) {
        const limit = Math.max(1, Math.min(24, (Number.isFinite(input.limit) ? Math.floor(input.limit!) : 12)))
        const offset = Math.max(0, (Number.isFinite(input.offset) ? Math.floor(input.offset!) : 0))
        const entries = existsSync(this.directory) ? readdirSync(this.directory).flatMap(name => {
            const match = FILE.exec(name)
            if (!match) return []
            const kind = match[2].toLowerCase() === 'png' ? 'screenshot' : 'recording'
            if (input.kind && kind !== input.kind) return []
            try { return [this.get(`browser-${kind}:${match[1]}`)] } catch { return [] }
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.artifactId.localeCompare(b.artifactId)) : []
        return { captures: entries.slice(offset, offset + limit), total: entries.length, offset, limit }
    }
    delete(artifactId: string) {
        const capture = this.get(artifactId)
        if (dirname(resolve(capture.path)) !== resolve(this.directory) || !FILE.test(basename(capture.path))) throw new Error('Invalid managed capture.')
        unlinkSync(capture.path)
    }
}
