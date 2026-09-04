import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const execute = promisify(execFile)
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(join(tmpdir(), 'zyra-response-media-'))
try {
    await mkdir(join(root, 'profile'))
    await mkdir(join(root, 'session'))
    // Optional real media stays read-only and is never copied into the repository.
    let mediaPath = process.env.ZYRA_MEDIA_TEST_FILE
    if (!mediaPath) {
        mediaPath = join(root, 'chat debug (100%).mp4')
        await execute(process.env.FFMPEG_PATH || 'ffmpeg', [
            '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
            '-t', '2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath
        ], { timeout: 30_000, windowsHide: true })
    }
    const env = { ...process.env, ZYRA_MEDIA_TEST_FILE: mediaPath, ZYRA_MEDIA_TEST_HTML: join(root, 'response.html'), ZYRA_MEDIA_TEST_ROOT: root }
    delete env.ELECTRON_RUN_AS_NODE
    const rendered = await execute(process.execPath, ['scripts/test-assistant-response-media.tsx'], { cwd: desktop, env, timeout: 60_000, windowsHide: true })
    process.stdout.write(rendered.stdout)
    const child = join(root, 'media-test.cjs')
    await build({
        absWorkingDir: desktop,
        entryPoints: ['scripts/fixtures/assistant-response-media-electron.ts'],
        outfile: child,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron']
    })
    const electron = (await import('electron')).default as unknown as string
    const played = await execute(electron, [child], { cwd: desktop, env, timeout: 50_000, windowsHide: true })
    process.stdout.write(played.stdout)
} catch (error) {
    const details = error as { stdout?: string; stderr?: string }
    if (details.stdout) process.stderr.write(details.stdout)
    if (details.stderr) process.stderr.write(details.stderr)
    throw error
} finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
