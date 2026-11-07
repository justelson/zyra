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
    // Native textareas also use the application's global scrollbar rules.
    const scrollbars = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).nodes
        .filter(node => node.type === 'rule' && node.selectors.every(selector => selector.startsWith('::-webkit-scrollbar')))
        .map(node => node.toString()).join('\n')
    const css = await postcss([tailwindcss({ ...tailwindConfig, content: ['AssistantComposerQueue', 'AssistantComposerMenuSurface', 'AssistantQuestionTransition'].map(name => join(desktop, 'src/renderer/src/pages/assistant', `${name}.tsx`)) })])
        .process(`${await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8')}\n@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${scrollbars}`, { from: undefined })
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
            const capture = async (path) => {
                await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                await window.webContents.executeJavaScript('Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))');
                const rect = await window.webContents.executeJavaScript(
                    '(() => { const r = document.querySelector("[data-composer-drawer]").getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.x) - 8), y: Math.max(0, Math.floor(r.y) - 8), width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 }; })()');
                require('node:fs').writeFileSync(path, (await window.webContents.capturePage(rect)).toPNG());
            };
            await capture(${JSON.stringify(screenshot)});
            await window.webContents.executeJavaScript('document.querySelectorAll("[data-queued-message-preview]")[1].click()');
            await capture(${JSON.stringify(screenshot.replace(/\.png$/i, '-expanded.png'))});
            await window.webContents.executeJavaScript('document.querySelectorAll("[data-queued-message-preview]")[1].click(); document.querySelector("[data-composer-drawer]").parentElement.style.width = "360px"');
            await capture(${JSON.stringify(screenshot.replace(/\.png$/i, '-narrow.png'))});
            await window.webContents.executeJavaScript(${JSON.stringify('document.querySelector("[data-composer-drawer]").parentElement.style.width = "560px"; Array.from(document.querySelectorAll("button")).filter(button => button.getAttribute("aria-label") === "Edit queued message")[1].click()')});
            await capture(${JSON.stringify(screenshot.replace(/\.png$/i, '-editing.png'))});
            await window.webContents.executeJavaScript('document.querySelector("[data-composer-drawer]").parentElement.style.width = "360px"');
            await capture(${JSON.stringify(screenshot.replace(/\.png$/i, '-editing-narrow.png'))});
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
