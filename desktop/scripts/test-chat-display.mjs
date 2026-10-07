import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import electron from 'electron'
import tailwindConfig from '../tailwind.config.js'

const run = promisify(execFile)
const desktop = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(path.join(desktop, 'node_modules', '.chat-display-'))
const screenshots = process.argv.includes('--screenshots') ? path.resolve(process.argv[process.argv.indexOf('--screenshots') + 1]) : ''
let fixtureError
try {
    if (screenshots) await mkdir(screenshots, { recursive: true })
    await build({ absWorkingDir: desktop, entryPoints: ['scripts/fixtures/chat-display.tsx'], outfile: path.join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.woff2': 'dataurl' }, alias: { '@': path.join(desktop, 'src/renderer/src'), '@shared': path.join(desktop, 'src/shared') }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.hot': 'undefined', 'import.meta.env': '{}', '__ZYRA_DESKTOP_VERSION__': '"0.0.0-test"' }, logLevel: 'silent' })
    const stylesheet = postcss.parse(await readFile(path.join(desktop, 'src/renderer/src/index.css'), 'utf8'))
    stylesheet.walkAtRules('import', rule => rule.remove())
    const source = stylesheet.toString()
    const css = await postcss([tailwind({ ...tailwindConfig, content: [path.join(desktop, 'src/renderer/src/components/ui/**/*.tsx'), path.join(desktop, 'src/renderer/src/pages/assistant/AssistantTimelineText.tsx')] })]).process(source, { from: path.join(desktop, 'src/renderer/src/index.css') })
    await writeFile(path.join(directory, 'fixture.css'), css.css)
    await cp(path.join(desktop, 'node_modules/katex/dist/katex.min.css'), path.join(directory, 'katex.css'))
    await cp(path.join(desktop, 'node_modules/katex/dist/fonts'), path.join(directory, 'fonts'), { recursive: true })
    const tokens = await readFile(path.join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8')
    await writeFile(path.join(directory, 'tokens.css'), tokens)
    const shell = await readFile(path.join(desktop, 'src/renderer/index.html'), 'utf8')
    const policy = shell.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
    assert(policy, 'The real renderer CSP must be present')
    await writeFile(path.join(directory, 'index.html'), `<!doctype html><html><head>${policy}<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="fixture.css"><link rel="stylesheet" href="katex.css"></head><body style="margin:0;background:#171717;color:#eee;font:16px system-ui"><div id="root" style="padding:40px;max-width:760px" class="markdown-body"></div><script src="fixture.js"></script></body></html>`)
    await writeFile(path.join(directory, 'main.cjs'), String.raw`
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
app.setPath('userData', path.join(__dirname, 'profile'));
if (process.env.ZYRA_TEST_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration();
if (process.env.ZYRA_CHAT_REDUCED === '1') app.commandLine.appendSwitch('force-prefers-reduced-motion');
const startedAt = Date.now();
let window, stage = 'app ready', diagnostics, lastRendererState;
const trace = (name, detail) => console.log('CHAT_MAIN: ' + (Date.now() - startedAt) + 'ms ' + name + (detail ? ' ' + JSON.stringify(detail) : ''));
const timer = setTimeout(() => {
    console.error('Chat display fixture 20000ms deadline: ' + JSON.stringify({ stage, renderer: lastRendererState,
        painting: window && !window.isDestroyed() ? window.webContents.isPainting() : null }));
    app.exit(1);
}, 20000);
app.on('child-process-gone', (_event, detail) => trace('child-process-gone', detail));
app.whenReady().then(async () => {
    trace('app ready', { reduced: process.env.ZYRA_CHAT_REDUCED === '1', software: process.env.ZYRA_TEST_SOFTWARE_RENDERING === '1' });
    window = new BrowserWindow({ show: false, width: 900, height: 700,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    const messages = [];
    window.webContents.on('console-message', (event) => {
        const message = event.message;
        messages.push(message);
        if (typeof message === 'string' && message.startsWith('CHAT_PROGRESS: ')) stage = message.slice('CHAT_PROGRESS: '.length);
        trace('renderer console', message);
    });
    window.webContents.on('render-process-gone', (_event, detail) => trace('render-process-gone', detail));
    window.webContents.on('unresponsive', () => trace('renderer unresponsive'));
    window.webContents.on('responsive', () => trace('renderer responsive'));
    window.webContents.on('did-fail-load', (_event, code, description) => trace('did-fail-load', { code, description }));
    window.webContents.on('dom-ready', () => trace('dom-ready'));
    window.webContents.on('did-finish-load', () => trace('did-finish-load'));
    trace('window created', { offscreen: window.webContents.isOffscreen(), backgroundThrottling: window.webContents.getBackgroundThrottling(), painting: window.webContents.isPainting(), frameRate: window.webContents.getFrameRate() });
    await window.loadFile(path.join(__dirname, 'index.html'));
    trace('loadFile returned');
    if (process.env.ZYRA_CHAT_TRACE_RENDERER === '1') {
    await window.webContents.executeJavaScript('window.chatDisplayFrameProbe = { scheduled: performance.now(), fired: null }; requestAnimationFrame(() => { window.chatDisplayFrameProbe.fired = performance.now() })');
    let readingState = false;
    diagnostics = setInterval(async () => {
        if (readingState || window.isDestroyed()) return;
        readingState = true;
        try {
            lastRendererState = await window.webContents.executeJavaScript('({ progress: window.chatDisplayProgress, frame: window.chatDisplayFrameProbe, fonts: document.fonts.status, visibility: document.visibilityState, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })');
            trace('renderer state', lastRendererState);
        } catch (error) { trace('renderer state error', String(error)); }
        finally { readingState = false; }
    }, 1000);
    }
    const checks = await window.webContents.executeJavaScript('window.chatDisplayCheck');
    if (!Array.isArray(checks)) throw Error('Fixture did not run: ' + messages.join(' | '));
    for (const check of checks) console.log('PASS: ' + check);
    if (process.env.ZYRA_CHAT_SCREENSHOTS) {
        stage = 'showcase screenshot';
        await window.webContents.executeJavaScript('window.chatDisplayShowcase()');
        await window.webContents.capturePage();
        await new Promise(resolve => setTimeout(resolve, 200));
        await fs.writeFile(path.join(process.env.ZYRA_CHAT_SCREENSHOTS, 'math.png'), (await window.webContents.capturePage()).toPNG());
    }
    clearTimeout(timer); clearInterval(diagnostics);
    trace('completed'); window.destroy(); app.quit();
}).catch(error => {
    console.error(error); clearTimeout(timer); clearInterval(diagnostics);
    if (window && !window.isDestroyed()) window.destroy(); app.exit(1);
});
`)
    const env = { ...process.env, ZYRA_CHAT_SCREENSHOTS: screenshots, ZYRA_CHAT_REDUCED: process.argv.includes('--reduced-motion') ? '1' : '' }
    delete env.ELECTRON_RUN_AS_NODE
    const executing = run(electron, [path.join(directory, 'main.cjs')], { cwd: desktop, env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
    executing.child.stdout.on('data', chunk => process.stdout.write(chunk))
    executing.child.stderr.on('data', chunk => process.stderr.write(chunk))
    const result = await executing
    assert.match(result.stdout, /PASS: actual live Markdown/)
} catch (error) {
    fixtureError = error
    throw error
} finally {
    if (path.dirname(path.resolve(directory)) !== path.join(desktop, 'node_modules') || !path.basename(directory).startsWith('.chat-display-')) throw new Error('Unexpected chat-display fixture cleanup path')
    try {
        await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 })
    } catch (error) {
        if (!fixtureError) throw error
        console.error('Fixture cleanup also failed; preserving the original test error:', error)
    }
}
