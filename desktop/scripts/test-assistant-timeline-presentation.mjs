import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-timeline-presentation-'))
try {
    await writeFile(join(directory, 'settings.ts'), 'export function useSettings(){ return { settings: { assistantAllowCollapseWhileWorking:false, assistantShowActionStats:false } } }');
    // Exercise real message/stream wrappers without loading unrelated Markdown,
    // file preview and tool-evidence engines into this timing-focused fixture.
    await writeFile(join(directory, 'markdown.tsx'), 'export default function Markdown({content}){return <div>{content}</div>} export function prepareMarkdownRender(){} export function prewarmMarkdownRenders(){}');
    await writeFile(join(directory, 'attachment.tsx'), 'export default function Attachment(){return null}');
    await writeFile(join(directory, 'tools.tsx'), 'export function TimelineToolCallList(){return null}');
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/assistant-timeline-presentation.tsx')],
        bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser',
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
        </style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`)
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
