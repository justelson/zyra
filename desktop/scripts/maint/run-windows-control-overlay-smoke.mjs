import { build } from 'esbuild'
import electronPath from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const runDirectory = join(tmpdir(), `zyra-windows-overlay-bundle-${process.pid}`)
const output = join(runDirectory, 'smoke.mjs')
await mkdir(runDirectory, { recursive: true })
await build({
    entryPoints: [fileURLToPath(new URL('../smoke-windows-control-overlay.ts', import.meta.url))],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
    logLevel: 'warning'
})
const child = spawn(electronPath, [output], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env, ZYRA_WINDOWS_CONTROL_OVERLAY_SMOKE: '1' }
})
const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
})
await rm(runDirectory, { recursive: true, force: true })
process.exitCode = Number(exitCode)
