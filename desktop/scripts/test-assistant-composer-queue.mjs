import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-composer-queue-'))
try {
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/assistant-composer-queue.tsx')],
        bundle: true, write: false, outfile: join(directory, 'renderer.js'), format: 'iife', jsx: 'automatic', platform: 'browser',
        define: { 'import.meta.env.DEV': 'true', 'process.env.NODE_ENV': '"development"' },
        nodePaths: [join(desktop, 'node_modules')],
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, logLevel: 'silent'
    })
    const css = await postcss([tailwindcss({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/pages/assistant/AssistantComposerQueue.tsx')] })])
        .process(`${await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8')}\n@tailwind base;\n@tailwind components;\n@tailwind utilities;`, { from: undefined })
    await writeFile(join(directory, 'renderer.css'), css.css)
    const screenshot = resolve(process.env.ZYRA_QUEUE_SCREENSHOT || join(desktop, '../docs.local/qa/assistant-composer-queue.png'))
    await mkdir(dirname(screenshot), { recursive: true })
    const html = join(directory, 'index.html')
    await writeFile(join(directory, 'renderer.js'), bundle.outputFiles.find(file => file.path.endsWith('.js')).text)
    await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body style="background:var(--color-bg);color:var(--color-text);font-family:system-ui"><script src="renderer.js"></script></body></html>')
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `
        const { app, BrowserWindow } = require('electron');
        app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
        const timeout = setTimeout(() => { console.error('Composer queue test timed out'); app.exit(1); }, 20000);
        app.whenReady().then(async () => {
            const window = new BrowserWindow({ show: false, width: 800, height: 600,
                webPreferences: { backgroundThrottling: false, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
            await window.loadFile(${JSON.stringify(html)});
            const results = await window.webContents.executeJavaScript('window.runComposerQueueChecks()');
            for (const result of results) console.log('PASS: ' + result);
            await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            require('node:fs').writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
            console.log('Queue screenshot: ' + ${JSON.stringify(screenshot)});
            clearTimeout(timeout); app.quit();
        }).catch(error => { console.error(error); app.exit(1); });
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const virtualDisplay = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), harness]
    process.exitCode = await new Promise((resolveExit, reject) => {
        const child = spawn(virtualDisplay ? 'xvfb-run' : electronPath,
            virtualDisplay ? ['--auto-servernum', electronPath, ...args] : args,
            { cwd: desktop, env, stdio: 'inherit', windowsHide: true, shell: false })
        child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-composer-queue-')) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
}
