import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const smokeScript = join(scriptDirectory, 'assistant-native-view-reparent-smoke.cjs')
const userDataPath = await mkdtemp(join(tmpdir(), 'zyra-browser-reparent-'))
try {
    const captureModule = join(userDataPath, 'capture.cjs')
    await build({ entryPoints: [join(scriptDirectory, '../src/main/browser-page-capture.ts')], outfile: captureModule, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
    const exitCode = await new Promise((resolveExit, reject) => {
        const useVirtualDisplay = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
        const electronArgs = [
            ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
            smokeScript
        ]
        const child = spawn(
            useVirtualDisplay ? 'xvfb-run' : electronPath,
            useVirtualDisplay ? ['--auto-servernum', electronPath, ...electronArgs] : electronArgs,
            {
                cwd: resolve(scriptDirectory, '..'),
                env: { ...process.env, ZYRA_REPARENT_SMOKE_USER_DATA: userDataPath, ZYRA_REPARENT_CAPTURE_MODULE: captureModule },
                stdio: 'inherit',
                shell: false,
                windowsHide: true
            }
        )
        child.once('error', reject)
        child.once('exit', (code) => resolveExit(code ?? 1))
    })

    if (exitCode !== 0) process.exit(exitCode)
    console.log('Assistant native WebContentsView reparent: ok')
} finally {
    await rm(userDataPath, { recursive: true, force: true }).catch(() => undefined)
}
