import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-rendering-review-'))
const screenshots = process.argv[2] ? resolve(process.argv[2]) : join(directory, 'screenshots')
try {
    await mkdir(screenshots, { recursive: true })
    const env = { ...process.env, ZYRA_REVIEW_PROFILE: join(directory, 'profile'), ZYRA_REVIEW_SCREENSHOTS: screenshots }
    delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(electron, [join(desktop, 'scripts/fixtures/rendering-review-electron.cjs')], { env, stdio: 'inherit', windowsHide: true })
        child.once('error', reject)
        child.once('exit', code => done(code ?? 1))
    })
} finally { await rm(directory, { recursive: true, force: true }) }
