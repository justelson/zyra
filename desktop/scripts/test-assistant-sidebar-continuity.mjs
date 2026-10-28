import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronPath from 'electron'
import { SYNTHETIC_VIDEO_BASE64 } from './fixtures/assistant-video-paste-data.mjs'

const startupReadiness = process.argv.includes('--startup-readiness')
const workContext = process.argv.includes('--work-context')
const voiceRecorderInput = process.argv.includes('--voice-recorder-input')
const userInputForm = process.argv.includes('--user-input-form')
const settlementToast = process.argv.includes('--settlement-toast')
const toolMedia = process.argv.includes('--tool-media')
const videoPaste = process.argv.includes('--video-paste')
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-sidebar-continuity-'))
try {
    const settledWindow = process.argv.includes('--settled-window') || process.argv.includes('--settled-window-stress')
    await writeFile(join(directory, 'settings.ts'), `export {getAppearanceCodeFontStack,getThemeAppearance} from ${JSON.stringify(join(desktop, 'src/renderer/src/lib/settings.tsx'))};import {loadSettings} from ${JSON.stringify(join(desktop, 'src/renderer/src/lib/settings.tsx'))};const settings={...loadSettings({}),assistantAllowCollapseWhileWorking:false,assistantShowActionStats:false${userInputForm || voiceRecorderInput ? ",assistantTranscriptionEnabled:true,assistantTranscriptionEngine:'codex'" : ''}};export function useSettings(){return {settings}}`)
    const fixture = process.argv.includes('--tool-disclosure') ? 'tool-disclosure.tsx' : settledWindow ? 'sidebar-settled-window.tsx' : workContext ? 'assistant-work-context.tsx' : videoPaste ? 'assistant-video-paste.tsx' : toolMedia ? 'assistant-read-media.tsx' : settlementToast ? 'settlement-toast.tsx' : userInputForm ? 'pending-user-input-review.tsx' : voiceRecorderInput ? 'voice-recorder-review.tsx' : startupReadiness ? 'assistant-launch-readiness.tsx' : process.argv.includes('--settlement-navigation') ? 'sidebar-settlement-navigation.tsx' : 'assistant-sidebar-continuity.tsx'
    if (toolMedia) console.log('Tool media: bundling the isolated read viewer')
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures', fixture)],
        bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', define: { ...((settledWindow || process.argv.includes('--tool-disclosure')) ? { 'process.env.NODE_ENV': '"production"' } : {}), 'import.meta.env.DEV': 'false', '__ZYRA_BUILD_METADATA__': JSON.stringify({ distribution: startupReadiness ? 'preview' : 'stable', sourceSha: null, sourceRepository: null, runId: null }), 'import.meta.url': JSON.stringify(pathToFileURL(join(directory, 'fixture.js')).href) },
        alias: { '@/lib/settings': join(directory, 'settings.ts'), '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, loader: { '.ico': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty', '.ttf': 'dataurl', '.woff2': 'dataurl' },
        plugins: [{ name: 'unused-attachment-preview', setup(builder) {
            if (toolMedia || videoPaste) {
                // The real captured-read shell and media viewer are exercised.
                // Monaco editor wiring is covered separately by the SSR/source tests.
                builder.onResolve({ filter: /(?:^|\/)SyntaxPreview$/ }, () => ({ path: 'read-source', namespace: 'test-captured-source' }))
                builder.onLoad({ filter: /.*/, namespace: 'test-captured-source' }, () => ({ contents: 'import React from "react";export default function SyntaxPreview(props){window.fixtureSyntaxPreviewProps=props;return React.createElement("pre",{"data-test-source":true},props.content)}', loader: 'js', resolveDir: desktop }))
            }
            {
                // These sidebar/question checks never open the workspace menu.
                // Its Vite-only diff worker is covered by developer-workflow tests.
                builder.onResolve({ filter: /DeveloperWorkspaceMenu$/ }, () => ({ path: 'workspace-menu', namespace: 'test-unused-workspace' }))
                builder.onLoad({ filter: /.*/, namespace: 'test-unused-workspace' }, () => ({ contents: 'export function DeveloperWorkspaceMenu(){return null}', loader: 'js' }))
            }
            // This fixture opens no attachment editors. Keep Vite-only Monaco
            // workers out while exercising the actual message/footer renderer.
            if (!videoPaste) builder.onResolve({ filter: /AssistantAttachmentPreviewModal$/ }, () => ({ path: 'attachment-preview', namespace: 'test-unused' }))
            builder.onLoad({ filter: /.*/, namespace: 'test-unused' }, () => ({ contents: userInputForm ? 'export default function UnusedPreview(props){window.fixtureAttachmentPreview=props.file;return null}' : 'export default function UnusedPreview(){return null}', loader: 'js' }))
            builder.onResolve({ filter: /monaco\/runtime$/ }, () => ({ path: 'editor-runtime', namespace: 'test-editor-runtime' }))
            builder.onLoad({ filter: /.*/, namespace: 'test-editor-runtime' }, () => ({ contents: 'export const monaco = {}; export function ensureMonacoRuntime(){throw new Error("Unexpected editor in agent message fixture")}', loader: 'js' }))
            // The header imports developer diffs, but these message fixtures do
            // not open them. Fail if a worker is requested instead of requiring
            // Vite's worker loader just to import the real header.
            builder.onResolve({ filter: /^@pierre\/diffs\/worker\/worker\.js\?worker$/ }, () => ({ path: 'diff-worker', namespace: 'test-unused-diff-worker' }))
            builder.onLoad({ filter: /.*/, namespace: 'test-unused-diff-worker' }, () => ({ contents: 'export default class UnusedDiffWorker { constructor(){throw new Error("Unexpected diff worker in sidebar continuity fixture")} }', loader: 'js' }))
        } }], logLevel: 'silent' })
    if (toolMedia) console.log('Tool media: compiling scoped application styles')
    // Compile the actual app styles, but keep test fonts/assets entirely local.
    const source = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '')
    const css = await postcss([tailwind({ ...tailwindConfig, content: process.argv.includes('--tool-disclosure') ? [join(desktop, 'src/renderer/src/pages/assistant/assistant-action-row-layout.ts'), join(desktop, 'src/renderer/src/pages/assistant/PluginToolCallCard.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantTimeline*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantActionBatchScroll.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantInlineDiffStats.tsx'), join(desktop, 'src/renderer/src/components/ui/AnimatedHeight.tsx')] : settledWindow ? [join(desktop, 'src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx'), join(desktop, 'scripts/fixtures/sidebar-settled-window.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantSessionTitleText.tsx')] : workContext ? [join(desktop, 'src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantWorkContextIcon.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantProjectIcon.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantSessionTitleText.tsx'), join(desktop, 'src/renderer/src/pages/assistant/Assistant*PresenceIndicator.tsx'), join(desktop, 'src/renderer/src/components/ui/ProjectIcon.tsx'), join(desktop, 'src/renderer/src/components/ui/FileActionsMenu.tsx'), join(desktop, 'src/renderer/src/pages/settings/SettingsProviderIcon.tsx')] : toolMedia || videoPaste ? [join(desktop, 'src/renderer/src/pages/assistant/AssistantAttachment*.tsx'), join(desktop, 'scripts/fixtures/assistant-video-paste.tsx'), join(desktop, 'src/renderer/src/components/ui/file-preview/**/*.{ts,tsx}'), join(desktop, 'src/renderer/src/components/ui/FilePreviewModal.tsx'), join(desktop, 'src/renderer/src/components/ui/FileEntryIcon.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantTimeline*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantReadFilePreview.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantActionBatchScroll.tsx'), join(desktop, 'src/renderer/src/pages/assistant/assistant-action-row-layout.ts'), join(desktop, 'scripts/fixtures/assistant-read-media.tsx')] : userInputForm ? [join(desktop, 'src/renderer/src/pages/assistant/AssistantPendingUserInput*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/*Composer*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantAsyncQuestionCard.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantQuestionPicker.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantQuestionDatePicker.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantQuestionTransition.tsx'), join(desktop, 'src/renderer/src/components/ui/AnchoredMenuPopover.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantVoiceRecorderBar.tsx'), join(desktop, 'src/renderer/src/pages/assistant/ComposerSendButton.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantAttachmentCards.tsx')] : voiceRecorderInput ? [join(desktop, 'src/renderer/src/pages/assistant/AssistantVoiceRecorderBar.tsx'), join(desktop, 'src/renderer/src/pages/assistant/assistant-composer-focus.ts'), join(desktop, 'scripts/fixtures/voice-recorder-input.tsx')] : [join(desktop, 'src/renderer/**/*.{ts,tsx}'), join(desktop, 'scripts/fixtures/*.tsx')] })]).process(source, { from: undefined })
    const html = join(directory, 'index.html')
    if (videoPaste) await writeFile(join(directory, 'synthetic-video.mp4'), Buffer.from(SYNTHETIC_VIDEO_BASE64, 'base64'))
    if (toolMedia) await writeFile(join(directory, 'canonical-capture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="288"><rect width="512" height="288" fill="#245ba0"/><text x="30" y="150" font-size="40" fill="white">Canonical captured image</text></svg>')
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css.css}
        :root{--color-text:#ebeef2;--color-text-secondary:#acb5c3;--color-text-muted:#828c96;--color-bg:#0a0f14;--text-primary:235 238 242;--text-secondary:172 181 195;--text-muted:130 140 150;--bg-primary:10 15 20;--surface-hover:#202833;--surface-active:#2b3a4b;--surface-divider:#303844;--accent-primary:#f29540;--accent-primary-rgb:242 149 64;--accent-secondary:#ab87ff;--status-success:#44cf92}
        :root{--color-secondary:#dd9448;--agent-presence-accent:#ab87ff;${toolMedia || videoPaste ? '--bg-secondary:17 24 32;--color-card:#111820;' : ''}}
        html,body,#root{height:100%;margin:0}body{background:#0a0f14;color:#ebeff2}
        </style></head><body><div id="root"></div><script>window.sidebarStressOnly=${process.argv.includes('--settled-window-stress')};${videoPaste ? `window.fixtureVideoURL=${JSON.stringify(pathToFileURL(join(directory, 'synthetic-video.mp4')).href)};` : ''}${toolMedia ? `window.fixtureMediaCaptureURL=${JSON.stringify(pathToFileURL(join(directory, 'canonical-capture.svg')).href)};` : ''}window.addEventListener('error',event=>{window.__fixtureError=String(event.error?.stack||event.message);console.error(window.__fixtureError)})</script><script src="./fixture.js"></script></body></html>`)
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `const {app,BrowserWindow}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
        const timeout=setTimeout(()=>{console.error('Sidebar check timed out');app.exit(1)},30000);
        app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:${Number(process.env.ZYRA_QA_WIDTH) || 1000},height:800,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        window.webContents.setZoomFactor(${Number(process.env.ZYRA_QA_ZOOM) || 1});
        window.webContents.on('console-message',(event,level,message)=>{if(level>=2)console.error(message)});
        await window.loadFile(${JSON.stringify(html)},${JSON.stringify(process.argv.includes('--settlement-navigation') ? { query: { settlementNavigation: '1' } } : process.argv.includes('--chat-order') ? { query: { chatOrder: '1' } } : process.argv.includes('--thread-messages') ? { query: { threadMessages: '1' } } : process.argv.includes('--unread-completion') ? { query: { unreadCompletion: '1' } } : process.argv.includes('--agent-colors') ? { query: { agentColors: '1' } } : process.argv.includes('--row-hover-actions') ? { query: { rowHoverActions: '1' } } : process.argv.includes('--voice-recorder-input') ? { query: { voiceRecorderInput: '1' } } : process.argv.includes('--conversation-markers') ? { query: { conversationMarkers: '1' } } : {})});
        let debuggerDocument=null;
        let pumping=true;const pointerPump=(async()=>{while(pumping){
            const request=await window.webContents.executeJavaScript('window.sidebarPointerRequest && !window.sidebarPointerRequest.done ? {x:window.sidebarPointerRequest.x,y:window.sidebarPointerRequest.y,click:window.sidebarPointerRequest.click,focusSelector:window.sidebarPointerRequest.focusSelector,pseudoClass:window.sidebarPointerRequest.pseudoClass,enabled:window.sidebarPointerRequest.enabled} : null');
            if(request){
                if(request.focusSelector){if(!window.webContents.debugger.isAttached()){window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('DOM.enable');await window.webContents.debugger.sendCommand('CSS.enable')}
                    // Reuse frontend node IDs so clearing an emulated keyboard
                    // state releases the same node that was forced earlier.
                    debuggerDocument ||= await window.webContents.debugger.sendCommand('DOM.getDocument');
                    const node=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:debuggerDocument.root.nodeId,selector:request.focusSelector});
                    await window.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:node.nodeId,forcedPseudoClasses:request.enabled?[request.pseudoClass||'focus-visible']:[]})}
                else {const point={x:Math.round(request.x),y:Math.round(request.y)};window.webContents.sendInputEvent({type:'mouseMove',...point});
                    if(request.click){window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})}}
                await window.webContents.executeJavaScript('window.sidebarPointerRequest.done=true')}
            await new Promise(resolve=>setTimeout(resolve,16));
        }})();
        let results;try{results=await window.webContents.executeJavaScript('window.sidebarContinuityCheck || Promise.reject(new Error(window.__fixtureError || "Fixture did not initialize"))')}finally{pumping=false;await pointerPump}

        for(const result of results)console.log('PASS: '+result);${toolMedia || videoPaste || workContext ? 'window.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,100));' : ''}${process.env.ZYRA_QA_SCREENSHOT ? `require('node:fs').writeFileSync(${JSON.stringify(process.env.ZYRA_QA_SCREENSHOT)},(await window.webContents.capturePage()).toPNG());` : ''}clearTimeout(timeout);app.quit()}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((resolveExit, reject) => {
        const child = spawn(electronPath, [harness], { cwd: desktop, env, windowsHide: true, shell: false, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-sidebar-continuity-')) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
}
