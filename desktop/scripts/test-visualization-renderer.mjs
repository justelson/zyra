import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { resolveViewportDimensions } from '../src/renderer/src/components/ui/visualization/visualization-viewport-runtime.js'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import config from '../tailwind.config.js'
import { visualizationFrameDocument } from './maint/visualization-frame-document.mjs'

const viewport = { width: 320, height: 160, vertical: false }
assert.equal(resolveViewportDimensions('height:calc(100vh + 5vmin);--h:2e1v\\68;', viewport), 'height:calc(160px + 8px);--h:32px;')
assert.equal(resolveViewportDimensions('width:50dvw;height:100svh;min-height:100lvh;max-height:100dvh', viewport), 'width:160px;height:160px;min-height:160px;max-height:160px')
assert.equal(resolveViewportDimensions('content:"100vh";font-family:vh;/*100vh*/background:url("data:text/plain,100vh");--width100vh:10px', viewport), 'content:"100vh";font-family:vh;/*100vh*/background:url("data:text/plain,100vh");--width100vh:10px')
assert.equal(resolveViewportDimensions('width:100vi;height:100vb', { ...viewport, vertical: true }), 'width:160px;height:320px')

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionSurface = process.argv.includes('--extension')
const screenshotArgument = process.argv.slice(2).find(arg => !arg.startsWith('--'))
const screenshotDirectory = screenshotArgument ? resolve(screenshotArgument) : null
const temporary = await mkdtemp(join(tmpdir(), 'zyra-visualization-'))
try {
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures/visualization-renderer.tsx')], bundle: true, write: false, outfile: join(temporary, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.woff2': 'dataurl' }, define: { 'import.meta.url': 'window.location.href', 'import.meta.hot': 'undefined', 'import.meta.env': '{}', '__ZYRA_DESKTOP_VERSION__': '"0.0.0-test"' }, alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') } })
    const shell = await readFile(join(desktop, 'src/renderer/index.html'), 'utf8')
    const policy = shell.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
    if (!policy) throw new Error('Missing real renderer CSP')
    if (extensionSurface) {
        const manifest = JSON.parse(await readFile(join(desktop, '../extensions/zyra-browser-control/manifest.json'), 'utf8'))
        await writeFile(join(temporary, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Zyra isolated preview check', version: '1.0', content_security_policy: manifest.content_security_policy, sandbox: { pages: ['visualization-frame.html'] } }))
    }
    await cp(join(desktop, '../extensions/zyra-browser-control/assets/font.woff2'), join(temporary, 'font.woff2'))
    await writeFile(join(temporary, 'fixture.js'), bundle.outputFiles[0].text)
    await writeFile(join(temporary, 'visualization-frame.html'), visualizationFrameDocument())
    const css = await postcss([tailwind({ ...config, content: [join(desktop, 'src/renderer/src/components/ui/visualization/*.tsx'), join(desktop, 'src/renderer/src/components/ui/ArtifactCreationState.tsx')] })]).process('@tailwind base; @tailwind utilities;', { from: undefined })
    await writeFile(join(temporary, 'index.html'), `<!doctype html><html><head>${extensionSurface ? '' : policy}<style>${css.css}\n:root{--color-bg:#101318;--color-card:#181c22;--color-text:#eef1f6;--color-text-muted:#a8b0bd;--accent-primary:#568cff;--surface-divider:#343b46;--surface-hover:#2b323d}body{margin:0;padding:32px;background:var(--color-bg);color:var(--color-text);font:14px system-ui}#root{max-width:680px;margin:auto}</style></head><body><div id="root"></div><script src="./fixture.js"></script></body></html>`)
    if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true })
    const env = { ...process.env, ZYRA_VISUALIZATION_FIXTURE: temporary, ZYRA_VISUALIZATION_EXTENSION: extensionSurface ? '1' : '', ZYRA_VISUALIZATION_SCREENSHOTS: screenshotDirectory || '' }
    delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(electronPath, [join(desktop, 'scripts/fixtures/visualization-electron.cjs')], { cwd: desktop, env, stdio: 'inherit', windowsHide: true })
        child.once('error', reject)
        child.once('exit', code => done(code ?? 1))
    })
} finally { await rm(temporary, { recursive: true, force: true }) }
