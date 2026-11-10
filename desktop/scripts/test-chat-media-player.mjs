import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'vite'

const desktop = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'zyra-chat-media-'))
const evidence = resolve(desktop, '../docs.local/reviews/chat-media-player/screenshots')
let server
try {
    await mkdir(evidence, { recursive: true })
    await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '8', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(scratch, 'sample.mp4')], { timeout: 30000, windowsHide: true })
    const bytes = await readFile(join(scratch, 'sample.mp4'))
    let unavailableRequests = 0, loadingRequests = 0
    server = await createServer({ configFile: join(desktop, 'scripts/audio-player-preview.config.ts'), logLevel: 'error',
        cacheDir: join(desktop, 'node_modules/.cache/vite-chat-media-player-test'), server: { host: '127.0.0.1', port: 0, strictPort: false },
        plugins: [{ name: 'synthetic-video-fixture', configureServer(vite) {
            vite.middlewares.use((request, response, next) => {
                if (!request.url?.startsWith('/__media-preview__/')) return next()
                if (request.url.includes('unavailable') && unavailableRequests++ === 0) { response.statusCode = 404; response.end(); return }
                const serve = () => {
                    if (response.destroyed) return
                    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
                    const start = range ? Number(range[1]) : 0
                    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
                    response.setHeader('Content-Type', 'video/mp4'); response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store')
                    if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`) }
                    response.setHeader('Content-Length', end - start + 1); response.end(bytes.subarray(start, end + 1))
                }
                if (request.url.includes('loading') && loadingRequests++ === 0) { const timer = setTimeout(serve, 3000); response.once('close', () => clearTimeout(timer)) }
                else serve()
            })
        } }] })
    await server.listen()
    const url = `http://127.0.0.1:${server.httpServer.address().port}/audio-review.html?view=media`
    const env = { ...process.env, ZYRA_MEDIA_PREVIEW_URL: url, ZYRA_MEDIA_TEST_ROOT: scratch, ZYRA_QA_SCREENSHOT_DIR: evidence }
    delete env.ELECTRON_RUN_AS_NODE
    const electron = (await import('electron')).default
    const code = await new Promise((done, reject) => {
        const child = spawn(electron, [join(desktop, 'scripts/fixtures/chat-media-player-electron.cjs')], { cwd: desktop, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const timer = setTimeout(() => child.kill(), 170000)
        child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data))
        child.once('error', reject); child.once('exit', code => { clearTimeout(timer); done(code ?? 1) })
    })
    if (code !== 0) throw new Error(`Chat media checks exited ${code}`)
} finally {
    if (server) { server.httpServer?.closeAllConnections(); await server.close() }
    if (dirname(scratch) !== resolve(tmpdir()) || !basename(scratch).startsWith('zyra-chat-media-')) throw new Error('Unexpected cleanup path')
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
console.log(`Chat media player checks passed; screenshots: ${evidence}`)
process.exit(0)
