import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import assert from 'node:assert/strict'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = await readFile(join(desktop, 'src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx'), 'utf8')
assert.doesNotMatch(workspace, /shellOverlayOpen|preparePresentation|usePreparedBrowserOverlay|usePreparedBrowserOmnibox/)
assert.match(workspace, /const pageReplaced = \(!tab.url && tab.status === 'idle'\) \|\| tab.status === 'error'/)
assert.match(workspace, /visible=\{visible && !pageReplaced\}/)
assert.match(workspace, /anchorRef=\{addressContainerRef\} autoFocus=\{false\}/)
assert.match(workspace, /isOverlayEventInside\(event, addressContainerRef.current, omniboxMenuRef.current\)/)
const directory = await mkdtemp(join(tmpdir(), 'zyra-native-overlay-callers-'))
try {
    const stubs = {
        '@/components/ui/FileEntryIcon': 'export const FileEntryIcon=()=>null',
        '@/components/ui/file-preview/utils': 'export const resolvePreviewType=()=>null',
        '@/lib/use-theme-revision': 'export const useThemeRevision=()=>0'
    }
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/native-overlay-callers.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', define: { 'import.meta.hot': 'undefined', 'globalThis.nativeOverlayVisibilityOnly': String(process.argv.includes('--visibility-only')) },
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        plugins: [{ name: 'caller-cosmetic-leaves', setup(build) {
            if (process.argv.includes('--baseline-portal')) build.onLoad({ filter: /native-overlay-portal\.tsx$/ }, async args => ({
                contents: (await readFile(args.path, 'utf8')).replace(/export function NativeOverlayPortal\([\s\S]*?\nfunction PresentedNativeOverlayPortal\(/, 'export function NativeOverlayPortal('),
                loader: 'tsx', resolveDir: dirname(args.path)
            }))
            build.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'fixture' } : undefined)
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }))
        } }]
    })
    const html = join(directory, 'index.html')
    await writeFile(html, `<!doctype html><head><style>body{margin:0}.relative{position:relative}.absolute{position:absolute}.fixed{position:fixed}.bottom-3{bottom:12px}.right-3{right:12px}button{font:12px sans-serif}section[aria-label="Browser downloads"]{top:32px;right:0;width:306px} [role=menu]{background:white}</style></head><body><script>${bundle.outputFiles[0].text}</script>`)
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});let owner;const timer=setTimeout(()=>{console.error('Native overlay callers timed out');app.exit(1)},20000);app.whenReady().then(async()=>{owner=new BrowserWindow({show:false,width:840,height:640,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});await owner.loadFile(${JSON.stringify(html)});const results=await owner.webContents.executeJavaScript('window.nativeOverlayCallerCheck');for(const result of results)console.log('PASS: '+result);clearTimeout(timer);owner.destroy();app.quit()}).catch(error=>{console.error(error);if(owner&&!owner.isDestroyed())owner.destroy();app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const virtual = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), harness]
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args, { cwd: desktop, env, stdio: 'inherit', windowsHide: true, shell: false })
        child.once('error', reject); child.once('exit', code => done(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-native-overlay-callers-')) throw new Error('Unexpected native overlay caller cleanup path')
    await rm(directory, { recursive: true, force: true })
}
