import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const directory = await mkdtemp(join(tmpdir(), 'zyra-permission-review-'))
const output = resolve('../docs.local/reviews/permission-requests')
await mkdir(output, { recursive: true })
const inspect = async function(entry) {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(entry.id + ': ' + message) }
    const select = document.querySelector('[aria-label="Permission request type"]')
    select.value = entry.id; select.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(180)
    const fixture = document.querySelector('[data-permission-fixture]')
    check(fixture?.getAttribute('data-permission-fixture') === entry.id, 'production fixture mounts')
    check(!document.querySelector('[data-review-receipts]'), 'mounting and inspection never make a permission decision')
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text)
    if (entry.kind === 'account-reset') { button('View resets').click(); await sleep(80); button('Review').click(); await sleep(80); check(button('Approve and use reset'), 'actual irreversible-credit confirmation opens') }
    if (entry.id === 'grant-expired') { button('Allow for this task').click(); await sleep(80); check(document.querySelector('[role="alert"]')?.textContent.includes('expired'), 'expired request fails visibly without creating a grant') }
    if (entry.kind === 'external') check(document.querySelector('[data-review-external]'), 'external owner is stated rather than simulated')
    const root = document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]') || fixture.querySelector('section') || fixture
    const controls = [...root.querySelectorAll('button, input')].filter(node => !node.disabled && node.getAttribute('type') !== 'hidden')
    const misses = controls.flatMap(node => {
        const r = node.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return []
        const x = r.left + r.width / 2, y = r.top + r.height / 2
        if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return [{ label: node.getAttribute('aria-label') || node.textContent.trim() || node.placeholder, reason: 'outside viewport' }]
        const hit = document.elementFromPoint(x, y)
        return node === hit || node.contains(hit) ? [] : [{ label: node.getAttribute('aria-label') || node.textContent.trim() || node.placeholder, reason: 'not pointer reachable', pointerEvents: getComputedStyle(node).pointerEvents }]
    })
    return { id: entry.id, kind: entry.kind, label: entry.label, bodyText: root.textContent.trim().slice(0, 900), pointerMisses: misses, pageOverflow: document.documentElement.scrollWidth > innerWidth }
}
const interactions = async function() {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (v, m) => { if (!v) throw Error(m) }
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text)
    const choose = async (id, outcome = 'success') => {
        const mode = document.querySelector('[aria-label="Synthetic response outcome"]');mode.value=outcome;mode.dispatchEvent(new Event('change',{bubbles:true}))
        const s=document.querySelector('[aria-label="Permission request type"]');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));await sleep(180)
    }
    await choose('command');button('Deny').click();await sleep(220)
    check(document.querySelector('[data-review-receipts]')?.textContent.includes('decline'), 'Deny records the exact synthetic decline')
    await choose('folder-access');document.querySelector('[aria-label="Other approval options"]').click();await sleep(100)
    const scope = document.querySelector('[role="menuitem"]');check(scope?.getAttribute('aria-label')?.includes('until chat reconnects'), 'Folder grant retains its precise duration')
    scope.click();await sleep(220);check(document.querySelector('[data-review-receipts]')?.textContent.includes('acceptForSession'), 'Broader scope is chosen explicitly')
    await choose('queue');button('Deny').click();await sleep(220);check(document.body.textContent.includes('Second queued action'), 'Responding advances the pending queue')
    await choose('grant-zyra-browser-chat','error');button('Allow for this task').click();await sleep(220)
    check(document.querySelector('[role="alert"]')?.textContent.includes('Synthetic response failed'), 'Control failure appears in the actual production panel')
    check(!button('Allow for this task').disabled,'Failure allows retry')
    await choose('grant-zyra-browser-chat','slow');button('Deny').click();await sleep(60)
    check(button('Deny').disabled && button('Allow for this task').disabled, 'Control response locks both decisions while pending')
    await choose('terminal','slow');button('Allow terminal').click();await sleep(60)
    check(button('Allow terminal').disabled && button('Continue without').disabled,'Terminal response locks both choices')
    await choose('command')
    return 'PASS: no implicit decisions, exact deny/scope responses, pending queue, control retry and busy locks using only synthetic callbacks'
}
const harness = join(directory, 'review.cjs')
await writeFile(harness, `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});const timeout=setTimeout(()=>app.exit(1),180000);
app.whenReady().then(async()=>{const errors=[],rows=[];const win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});win.webContents.on('paint',()=>{});win.webContents.setFrameRate(60);win.webContents.startPainting();win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});await win.loadURL('http://127.0.0.1:5187/permissions-review.html');await win.webContents.executeJavaScript("new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector('[aria-label=\\\"Permission request type\\\"]')){clearInterval(t);resolve(true)}else if(++n>100){clearInterval(t);reject(Error('Permission preview did not load'))}},100)})");
const cases=await win.webContents.executeJavaScript("[...document.querySelector('[aria-label=\\\"Permission request type\\\"]').options].map(o=>({id:o.value,kind:o.dataset.kind,label:o.textContent}))");if(cases.length!==109)throw Error('Expected the complete 109-case inventory');
for(const entry of cases){const row=await win.webContents.executeJavaScript('('+${JSON.stringify(inspect.toString())}+')('+JSON.stringify(entry)+')');rows.push(row);fs.writeFileSync(${JSON.stringify(output)}+'/'+entry.id+'.png',(await win.webContents.capturePage()).toPNG())}console.log('PASS: rendered and captured all '+rows.length+' permission/consent cases without implicit decisions');
console.log(await win.webContents.executeJavaScript('('+${JSON.stringify(interactions.toString())}+')()'));
win.setContentSize(390,740);await new Promise(r=>setTimeout(r,100));for(const id of ['command','file-multiple','grant-zyra-browser-chat','action-windows-window-software-install','terminal','project-clone','plugin-executable','device-partial','update-install-blocked']){const entry=cases.find(e=>e.id===id);const row=await win.webContents.executeJavaScript('('+${JSON.stringify(inspect.toString())}+')('+JSON.stringify(entry)+')');rows.push({...row,narrow:true});fs.writeFileSync(${JSON.stringify(output)}+'/'+id+'-narrow.png',(await win.webContents.capturePage()).toPNG())}
fs.writeFileSync(${JSON.stringify(join(output,'audit.json'))},JSON.stringify({cases:cases.length,checks:rows.length,errors,rows},null,2));const misses=rows.filter(row=>row.pointerMisses.length||row.pageOverflow);console.log('REVIEW FINDINGS: '+misses.length+' captures have pointer/layout issues; see docs.local/reviews/permission-requests/audit.json');if(errors.length)throw Error(errors.join('\\n'));clearTimeout(timeout);app.quit();}).catch(error=>{console.error(error);app.exit(1)});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
try {
    process.exitCode = await new Promise((done, reject) => { const child = spawn(electron, [harness], { env, windowsHide: true, stdio: 'inherit' });child.once('error',reject);child.once('exit', code=>done(code??1)) })
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
