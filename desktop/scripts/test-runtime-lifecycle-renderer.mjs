import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.js';

const desktop = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'zyra-runtime-lifecycle-ui-'));
const capture = process.argv.includes('--capture') ? resolve(desktop, '../docs.local/ui-review/runtime-lifecycle') : null;
try {
  if (capture) await mkdir(capture, { recursive: true });
  await build({ absWorkingDir: desktop, entryPoints: ['scripts/fixtures/runtime-lifecycle.tsx'], outfile: join(directory, 'renderer.js'),
    bundle: true, format: 'iife', jsx: 'automatic', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false', 'import.meta.hot': 'undefined' },
    alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') } });
  const css = await postcss([tailwindcss({ ...config, content: [join(desktop, 'src/renderer/src/pages/settings/**/*.{ts,tsx}'), join(desktop, 'src/renderer/src/components/updates/**/*.{ts,tsx}')] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
  const componentCss = await readFile(join(directory, 'renderer.css'), 'utf8').catch(() => '');
  const html = await readFile(join(desktop, 'src/renderer/index.html'), 'utf8');
  const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0];
  if (!csp) throw new Error('Application CSP missing');
  await writeFile(join(directory, 'index.html'), `<!doctype html><html><head>${csp}<style>${css.css}\n${componentCss}
:root{--settings-bg:#101318;--settings-text:#dddfe5;--settings-text-secondary:#a7aab4;--settings-text-muted:#858995;--settings-border:#30343c;--settings-row-divider:#292d35;--settings-section:#171b22;--settings-control:#222731;--settings-control-hover:#2b3340;--settings-row-hover:#1d232c;--accent-primary:#a798f0;--status-success:#6bce96;--status-warning:#e5b45f;--status-danger:#ed7b87;--settings-section-highlight:#ffffff08}body{margin:0;background:var(--settings-bg);color:var(--settings-text);font:13px system-ui;padding:24px}#root{max-width:760px;margin:auto}
</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>`);
  await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');const path=require('node:path');const fs=require('node:fs/promises');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
const timer=setTimeout(()=>{console.error('Runtime lifecycle renderer timed out');app.exit(1)},20000);
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:820,height:850,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,reply)=>reply({cancel:true}));
await win.loadFile(path.join(__dirname,'index.html'));
const result=await win.webContents.executeJavaScript('window.runRuntimeLifecycle()');console.log(JSON.stringify({test:'runtime-lifecycle-renderer',...result}));
const capture=${JSON.stringify(capture)};
if(capture)await fs.writeFile(path.join(capture,'wide.png'),(await win.webContents.capturePage()).toPNG());
win.setContentSize(360,900);await new Promise(resolve=>setTimeout(resolve,100));await win.webContents.executeJavaScript('window.runtimeLifecycleGeometry()');
if(capture)await fs.writeFile(path.join(capture,'narrow.png'),(await win.webContents.capturePage()).toPNG());
clearTimeout(timer);win.destroy();app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1)});
`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(electronPath, [join(directory, 'main.cjs')], { cwd: desktop, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => done(code ?? 1));
  });
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
