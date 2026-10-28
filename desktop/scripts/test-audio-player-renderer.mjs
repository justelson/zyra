import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'vite'

const desktop = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'zyra-audio-player-'))
let server
try {
    await mkdir(join(scratch, 'profile'))
    let url = process.env.ZYRA_AUDIO_PREVIEW_URL
    if (!url) {
        server = await createServer({ configFile: join(desktop, 'scripts/audio-player-preview.config.ts'), cacheDir: join(desktop, 'node_modules/.cache/vite-audio-player-test'), logLevel: 'error', server: { port: 0, host: '127.0.0.1', strictPort: false } })
        await server.listen()
        url = `http://127.0.0.1:${server.httpServer.address().port}/audio-review.html`
    }
    if (new URL(url).hostname !== '127.0.0.1') throw new Error('Audio review checks require the isolated loopback preview.')
    const electron = (await import('electron')).default
    const env = { ...process.env, ZYRA_AUDIO_PREVIEW_URL: url, ZYRA_AUDIO_TEST_ROOT: scratch }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(electron, [join(desktop, 'scripts/fixtures/audio-player-electron.cjs')], { cwd: desktop, env, windowsHide: true, timeout: 115_000, maxBuffer: 2_000_000 })
    process.stdout.write(result.stdout)
} catch (error) {
    if (error.stdout) process.stderr.write(error.stdout)
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
} finally {
    try {
        if (server) {
            let deadline
            try {
                server.httpServer?.closeAllConnections()
                await Promise.race([server.close(), new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Temporary audio server did not close')), 10_000) })])
            } finally { clearTimeout(deadline) }
        }
    } finally {
        await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    console.log('Audio renderer: temporary server and profile closed')
}
// Vite can retain worker handles after its server closes. Only a fully successful,
// cleaned-up single-use runner reaches here; thrown assertions still exit nonzero.
await new Promise(resolve => process.stdout.write('', resolve))
process.exit(0)
