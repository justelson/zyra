import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import assert from 'node:assert/strict'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-capture-ipc-'))
try {
    await build({ stdin: { contents: `export * from './src/main/ipc/handlers/browser-preview-developer-handlers';export * from './src/main/browser-capture-handoff';export {resolveAssistantClipboardAttachment} from './src/main/assistant/clipboard-attachments'`, resolveDir: desktop, loader: 'ts' }, outfile: join(directory, 'handlers.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', external: ['electron'], define: { 'import.meta.url': JSON.stringify(new URL('../src/main/zyra/zyra-root.ts', import.meta.url).href) } })
    await writeFile(join(directory, 'main.cjs'), `process.env.NODE_PATH=${JSON.stringify(join(desktop, 'node_modules'))};require('node:module').Module._initPaths();const{app,BrowserWindow,nativeImage}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const{randomUUID}=require('node:crypto');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const deadline=setTimeout(()=>app.exit(1),20000);app.whenReady().then(async()=>{
const api=require('./handlers.cjs');const main=new BrowserWindow({show:false});const other=new BrowserWindow({show:false});const event={sender:main.webContents},stranger={sender:other.webContents};const root=path.join(app.getPath('userData'),'browser-preview/artifacts');await fs.mkdir(root,{recursive:true});const id=randomUUID(),videoId=randomUUID();const png=nativeImage.createFromBitmap(Buffer.alloc(16,180),{width:2,height:2}).toPNG();await fs.writeFile(path.join(root,id+'.png'),png);await fs.writeFile(path.join(root,videoId+'.webm'),'synthetic-video');let launches=0;api.configureBrowserCaptureHandoff(()=>launches++,()=>main.webContents.id);
let result=await api.handleListBrowserCaptures(event,{});assert.equal(result.success,true);assert.equal(result.total,2);assert(result.captures.every(c=>!('path'in c)&&!('ownerWebContentsId'in c)));const image=result.captures.find(c=>c.kind==='screenshot');assert(image.thumbnailDataUrl.startsWith('data:image/png'));assert.equal(image.width,2);assert.equal((await api.handleStageBrowserPreviewArtifactForAssistant(stranger,image.artifactId)).success,false,'unlisted captures remain private to authorized windows');
const staged=await api.handleStageBrowserPreviewArtifactForAssistant(event,image.artifactId);assert.equal(staged.success,true);const stagedPath=await api.resolveAssistantClipboardAttachment(staged.reference);assert.deepEqual(await fs.readFile(stagedPath),png);
const video=result.captures.find(c=>c.kind==='recording');const stagedVideo=await api.handleStageBrowserPreviewArtifactForAssistant(event,video.artifactId);assert.equal(stagedVideo.success,true);assert(stagedVideo.reference.endsWith('.webm'));assert.equal(await fs.readFile(await api.resolveAssistantClipboardAttachment(stagedVideo.reference),'utf8'),'synthetic-video');
assert.equal((await api.handleAttachBrowserCaptureToChat(event,{artifactId:video.artifactId,sessionId:'session:original'})).success,true);assert.equal(launches,1);assert.equal((await api.handleReadBrowserCaptureDraft(stranger)).success,false);const received=await api.handleReadBrowserCaptureDraft(event);assert.equal(received.draft.sessionId,'session:original');assert.equal('path'in received.draft.artifact,false);await api.handleAcknowledgeBrowserCaptureDraft(event,received.draft.id);assert.equal((await api.handleReadBrowserCaptureDraft(event)).draft,null);
assert.equal((await api.handleDeleteBrowserCapture(stranger,image.artifactId)).success,false);assert.equal((await api.handleDeleteBrowserCapture(event,'../../outside')).success,false);assert.equal((await api.handleDeleteBrowserCapture(event,image.artifactId)).success,true);assert.deepEqual(await fs.readFile(stagedPath),png,'deleting library original preserves staged chat attachments');assert.equal((await api.handleListBrowserCaptures(event,{})).total,1);assert.equal((await api.handleStageBrowserPreviewArtifactForAssistant(event,image.artifactId)).success,false);main.destroy();other.destroy();clearTimeout(deadline);console.log('Browser capture IPC: real managed files, PNG thumbnail, video staging, owner grants, draft routing and deletion pass');app.quit()
}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env, NODE_PATH: join(desktop, 'node_modules') }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((accept, reject) => { const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', accept) })
    assert.equal(code, 0)
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-capture-ipc-')) throw Error('Unexpected capture IPC cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
