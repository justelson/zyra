import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-timeline-presentation-'))
const screenshots = process.argv.includes('--screenshots') ? join(desktop, '../docs.local/reviews/chat-presentation-stability/screenshots') : null
try {
    await writeFile(join(directory, 'settings.ts'), 'export function useSettings(){ return { settings: { assistantAllowCollapseWhileWorking:false, assistantShowActionStats:false } } }');
    // Exercise real message/stream wrappers without loading unrelated Markdown,
    // file preview and tool-evidence engines into this timing-focused fixture.
    await writeFile(join(directory, 'markdown.tsx'), 'export default function Markdown({content}){return <div>{content}</div>} export function prepareMarkdownRender(){} export function prewarmMarkdownRenders(){}');
    await writeFile(join(directory, 'attachment.tsx'), 'export default function Attachment(){return null}');
    await writeFile(join(directory, 'tools.tsx'), 'export function TimelineToolCallList(){return null}');
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/assistant-timeline-presentation.tsx')],
        bundle: true, write: false, outfile: join(directory, 'renderer.js'), format: 'iife', jsx: 'automatic', platform: 'browser',
        define: { 'import.meta.env.DEV': 'true' },
        nodePaths: [join(desktop, 'node_modules')],
        alias: {
            '@/lib/settings': join(directory, 'settings.ts'),
            '@/components/ui/MarkdownRenderer': join(directory, 'markdown.tsx'),
            '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared')
        },
        plugins: [{ name: 'presentation-only-message-children', setup(build) {
            build.onResolve({ filter: /^\.\/AssistantAttachmentPreviewModal$/ }, () => ({ path: join(directory, 'attachment.tsx') }));
            build.onResolve({ filter: /^\.\/AssistantTimelineToolCalls$/ }, () => ({ path: join(directory, 'tools.tsx') }));
        } }], logLevel: 'silent'
    })
    const html = join(directory, 'index.html')
    await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body,#root{height:100%;margin:0}.h-full{height:100%}.w-full{width:100%}
        .relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}
        .grid{display:grid}.grid-rows-\\[1fr\\]{grid-template-rows:1fr}.grid-rows-\\[0fr\\]{grid-template-rows:0fr}
        .min-h-0{min-height:0}.overflow-hidden{overflow:hidden}
        .transition-\\[grid-template-rows\\]{transition-property:grid-template-rows}
        </style></head><body><div id="root"></div><script>${bundle.outputFiles.find(file => file.path.endsWith('.js')).text}</script></body></html>`)
    if (screenshots) {
        const appCss = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8'))
        appCss.walkAtRules('import', rule => rule.remove())
        const styles = await postcss([tailwindcss({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/pages/assistant/AssistantTimelineRows.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantAttachment*.tsx')] })]).process(appCss.toString(), { from: undefined })
        const tokens = await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8')
        await writeFile(join(directory, 'visual.css'), tokens + '\n' + styles.css)
        await mkdir(screenshots, { recursive: true })
    }
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `
        const { app, BrowserWindow } = require('electron');
        app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
        const timeout = setTimeout(() => { console.error('Timeline presentation timed out'); app.exit(1); }, 20000);
        app.whenReady().then(async () => {
            const window = new BrowserWindow({ show: false, width: 1000, height: 800,
                webPreferences: { backgroundThrottling: false, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
            await window.loadFile(${JSON.stringify(html)});
            const results = await window.webContents.executeJavaScript('window.timelinePresentationCheck');
            for (const result of results) console.log('PASS: ' + result);
            if (${Boolean(screenshots)}) {
                const fs = require('node:fs');
                await window.webContents.executeJavaScript('new Promise(resolve => {const link=document.createElement("link");link.rel="stylesheet";link.href="visual.css";link.onload=resolve;document.head.append(link)})');
                for (const width of [1000,390]) {
                    window.setContentSize(width,700);
                    for (const ready of [false,true]) {
                        await window.webContents.executeJavaScript('window.attachmentPresentationPreview(' + ready + ')');
                        fs.writeFileSync(${JSON.stringify(screenshots)} + '/attachment-' + (ready?'ready':'pending') + '-' + width + '.png', (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
                    }
                }
                console.log('PASS: pending/ready attachment screenshots at desktop and narrow widths');
            }
            clearTimeout(timeout);
            app.quit();
        }).catch(error => { console.error(error); app.exit(1); });
    `)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const useVirtualDisplay = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), harness]
    const code = await new Promise((resolveExit, reject) => {
        const child = spawn(useVirtualDisplay ? 'xvfb-run' : electronPath,
            useVirtualDisplay ? ['--auto-servernum', electronPath, ...args] : args,
            { cwd: desktop, env, stdio: 'inherit', windowsHide: true, shell: false })
        child.once('error', reject)
        child.once('exit', code => resolveExit(code ?? 1))
    })
    process.exitCode = code
    if (code === 0) console.log('Assistant timeline presentation: ok')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-timeline-presentation-')) {
        throw new Error('Unexpected timeline test cleanup path')
    }
    await rm(directory, { recursive: true, force: true })
}
