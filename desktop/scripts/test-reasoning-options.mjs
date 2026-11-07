import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '../tailwind.config.js';
const desktop = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'zyra-reasoning-options-'));
try {
  const bundle = await build({ absWorkingDir: desktop, entryPoints: ['scripts/fixtures/reasoning-options.tsx'], bundle: true, write: false,
    metafile: true, jsx: 'automatic', format: 'iife', platform: 'browser', logLevel: 'silent',
    alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
    define: { 'import.meta.hot': 'undefined' }, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.ico': 'dataurl', '.woff2': 'dataurl' } });
  const cssSource = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '');
  const content = Object.keys(bundle.metafile.inputs).filter(path => !path.includes('node_modules')).map(path => resolve(desktop, path));
  const css = await postcss([tailwind({ ...config, content })]).process(cssSource, { from: undefined });
  await writeFile(join(temp, 'index.html'), `<!doctype html><style>${css.css}body{margin:0;background:#111;color:#eee}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  const evidence = resolve(desktop, '../docs.local/reviews/reasoning-control-research');
  await mkdir(evidence, { recursive: true });
  await writeFile(join(temp, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(temp,'profile'))});
  const timeout=setTimeout(()=>{console.error('Reasoning fixture timed out');app.exit(1)},30000);
  app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:960,height:600,webPreferences:{offscreen:true,backgroundThrottling:false}});w.webContents.on('paint',()=>{});
    await w.loadFile(${JSON.stringify(join(temp,'index.html'))});const results=await w.webContents.executeJavaScript('window.verifyReasoning');
    for(const result of results)console.log('PASS: '+result);await w.webContents.executeJavaScript('window.showNativeChoices()');require('fs').writeFileSync(${JSON.stringify(join(evidence,'reasoning-options.png'))},(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    w.setSize(360,600);await w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');require('fs').writeFileSync(${JSON.stringify(join(evidence,'reasoning-options-narrow.png'))},(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    clearTimeout(timeout);w.destroy();app.quit();}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const linuxCI = process.platform === 'linux' && Boolean(process.env.CI);
  const args = [...(linuxCI ? ['--no-sandbox'] : []), join(temp, 'main.cjs')];
  const virtual = linuxCI && !process.env.DISPLAY;
  const code = await new Promise((done, reject) => {
    const child = spawn(virtual ? 'xvfb-run' : electron, virtual ? ['--auto-servernum', electron, ...args] : args, { env, cwd: desktop, windowsHide: true, stdio: 'inherit' });
    const watchdog = setTimeout(() => child.kill(), 45000);
    child.once('error', error => { clearTimeout(watchdog); reject(error) });
    child.once('exit', code => { clearTimeout(watchdog); done(code) });
  });
  if (code !== 0) throw Error('Reasoning renderer fixture failed');
} finally {
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('zyra-reasoning-options-')) throw Error('Unexpected fixture cleanup path');
  await rm(temp, { recursive: true, force: true });
}
