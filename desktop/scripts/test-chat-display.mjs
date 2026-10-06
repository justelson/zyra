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
try {
    if (screenshots) await mkdir(screenshots, { recursive: true })
    await build({ absWorkingDir: desktop, entryPoints: ['scripts/fixtures/chat-display.tsx'], outfile: path.join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.join(desktop, 'src/renderer/src'), '@shared': path.join(desktop, 'src/shared') }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.hot': 'undefined', 'import.meta.env': '{}', '__ZYRA_DESKTOP_VERSION__': '"0.0.0-test"' }, logLevel: 'silent' })
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
    await writeFile(path.join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs/promises'); app.setPath('userData', path.join(__dirname,'profile')); if(process.env.ZYRA_CHAT_REDUCED==='1')app.commandLine.appendSwitch('force-prefers-reduced-motion'); let window; const timer=setTimeout(()=>app.exit(1),20000); app.whenReady().then(async()=>{window=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});const messages=[];window.webContents.on('console-message',event=>messages.push(event.message));await window.loadFile(path.join(__dirname,'index.html'));const checks=await window.webContents.executeJavaScript('window.chatDisplayCheck');if(!Array.isArray(checks))throw Error('Fixture did not run: '+messages.join(' | '));for(const check of checks)console.log('PASS: '+check);if(process.env.ZYRA_CHAT_SCREENSHOTS){await window.webContents.executeJavaScript('window.chatDisplayShowcase()');await window.webContents.capturePage();await new Promise(resolve=>setTimeout(resolve,200));await fs.writeFile(path.join(process.env.ZYRA_CHAT_SCREENSHOTS,'math.png'),(await window.webContents.capturePage()).toPNG())}clearTimeout(timer);window.destroy();app.quit()}).catch(error=>{console.error(error);clearTimeout(timer);if(window)window.destroy();app.exit(1)});`)
    const env = { ...process.env, ZYRA_CHAT_SCREENSHOTS: screenshots, ZYRA_CHAT_REDUCED: process.argv.includes('--reduced-motion') ? '1' : '' }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await run(electron, [path.join(directory, 'main.cjs')], { cwd: desktop, env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
    assert.match(result.stdout, /PASS: actual live Markdown/)
    process.stdout.write(result.stdout)
} finally { await rm(directory, { recursive: true, force: true }) }
