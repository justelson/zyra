import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-chat-notification-'))
try {
    await build({ entryPoints: [join(desktop, 'src/main/assistant/chat-notifications.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'policy.cjs') })
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `const {app,Notification}=require('electron');
const {ChatNotifications}=require('./policy.cjs');
app.setPath('userData',${JSON.stringify(join(directory,'profile'))});app.setAppUserModelId('app.zyra.desktop.dev');
const timeout=setTimeout(()=>{console.error('Native notification check timed out');app.exit(1)},20000);
app.whenReady().then(async()=>{
 if(!Notification.isSupported()) throw new Error('Native notifications are unsupported on this system');
 let shown=0;let failure=null;let attention=null;
 const manager=new ChatNotifications({readChat:async()=>({title:'Zyra notification test (synthetic chat)',presence:{viewers:[],attention,latestTurn:{id:'test-turn',state:'completed'}}}),
 create:options=>{const toast=new Notification(options);toast.on('show',()=>{shown++;console.log('Native show event: '+options.title)});return toast},
 openChat:async()=>{},failed:error=>{failure=error||'Native notification failed'}});
 await manager.receive({canonicalChatId:'synthetic',token:'native-done',kind:'completed',turnId:'test-turn'});
 while(shown<1&&!failure)await new Promise(r=>setTimeout(r,50));if(failure)throw new Error(String(failure));
 attention='user-input';await manager.receive({canonicalChatId:'synthetic',token:'native-input',kind:'input',turnId:'test-turn'});
 while(shown<2&&!failure)await new Promise(r=>setTimeout(r,50));if(failure)throw new Error(String(failure));
 await new Promise(r=>setTimeout(r,700));manager.dispose();
 console.log('PASS: Windows native completion and input notifications emitted show events; test toasts closed');clearTimeout(timeout);app.quit();
}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((resolveExit, reject) => {
        const child = spawn(electron, [harness], { cwd: desktop, env, windowsHide: true, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-chat-notification-')) throw new Error('Unexpected notification check directory')
    await rm(directory, { recursive: true, force: true })
}
