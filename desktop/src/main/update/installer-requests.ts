import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Fixed per-installation directory. CLI flags never supply a path or executable. */
export function createInstallerRequests(directory: string, now = Date.now) {
    let current: { id: string; version: string; expiresAt: number } | null = null
    const file = (id: string, suffix: string) => join(directory, `${id}.${suffix}`)
    return {
        current: () => current,
        accept(argv: string[], _installedVersion: string): boolean {
            const flag = argv.find(value => value.startsWith('--zyra-prepare-update='))
            if (!flag) return false
            if (current && (current.expiresAt <= now() || !existsSync(file(current.id, 'request')))) current = null
            if (current) return false
            const id = flag.slice('--zyra-prepare-update='.length)
            if (!/^\{?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$/i.test(id)) return false
            try {
                const request = file(id, 'request'), info = statSync(request)
                if (!info.isFile() || info.size > 128 || now() - info.mtimeMs > 240_000 || info.mtimeMs > now() + 5_000) return false
                const version = readFileSync(request, 'utf8').trim()
                if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) return false
                current = { id, version, expiresAt: info.mtimeMs + 240_000 }
                return true
            } catch { return false }
        },
        assertCurrent() {
            if (!current || current.expiresAt <= now() || !existsSync(file(current.id, 'request'))) throw new Error('The installer request expired. Open the installer again.')
            return current
        },
        ready() {
            if (!current) throw new Error('No installer request is active.')
            const request = current
            // Called only from will-quit, after normal Desktop save/shutdown.
            writeFileSync(file(request.id, 'ready'), request.version, { mode: 0o600 })
        },
        later() {
            if (current) writeFileSync(file(current.id, 'later'), '', { mode: 0o600 })
            current = null
        }
    }
}
