import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import tailwindConfig from '../tailwind.config.js';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'zyra-response-timing-ui-'));
const capturePath = process.argv.find(arg => arg.startsWith('--capture='))?.slice(10);
const openHistoryScript = "(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='View turns').click();for(let i=0;i<100&&!document.querySelector('table');i++)await new Promise(resolve=>setTimeout(resolve,20));if(!document.querySelector('table'))throw new Error('History did not open');if(document.documentElement.scrollWidth>innerWidth)throw new Error('History viewport overflow')})()";
try {
    await build({ entryPoints: [join(desktop, 'scripts/fixtures/response-timing.tsx')], bundle: true,
        outfile: join(directory, 'renderer.js'), format: 'iife', jsx: 'automatic', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.hot': 'undefined' },
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, loader: { '.woff2': 'dataurl' },
        plugins: [{ name: 'unused-route-prefetch', setup(builder) {
            // The fixture mounts its real routes explicitly. Hover prefetch is
            // unrelated and would pull every lazy Settings page into this check.
            builder.onResolve({ filter: /settings-route-loaders$/ }, () => ({ path: 'prefetch', namespace: 'timing-prefetch' }));
            builder.onLoad({ filter: /.*/, namespace: 'timing-prefetch' }, () => ({ contents: 'export function preloadSettingsRoute() {}', loader: 'js' }));
        } }], logLevel: 'silent' });
    const css = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8'));
    css.walkAtRules('import', rule => rule.remove());
    const result = await postcss([tailwind({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/pages/settings/*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantTimelineText.tsx')] })]).process(css.toString(), { from: undefined });
    await writeFile(join(directory, 'style.css'), result.css);
    await writeFile(join(directory, 'tokens.css'), await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css')));
    await writeFile(join(directory, 'index.html'), '<!doctype html><html class="dark"><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="style.css"></head><body style="margin:0;background:#101010;color:#eee;font:14px system-ui"><main id="root" style="max-width:850px;margin:32px auto"></main><script src="renderer.js"></script></body></html>');
    await writeFile(join(directory, 'run.cjs'), `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');let window;
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
const timer=setTimeout(()=>{console.error('Response timing UI timed out');app.exit(1)},20000);
app.whenReady().then(async()=>{
 window=new BrowserWindow({show:false,width:Number(process.env.ZYRA_QA_WIDTH)||1000,height:850,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
 const results=await window.webContents.executeJavaScript('window.responseTimingCheck');
 for(const result of results)console.log('PASS: '+result);
 ${process.argv.includes('--history') ? 'await window.webContents.executeJavaScript(' + JSON.stringify(openHistoryScript) + ');' : ''}
 ${capturePath ? `fs.writeFileSync(${JSON.stringify(resolve(capturePath))},(await window.webContents.capturePage()).toPNG());` : ''}
 clearTimeout(timer);window.destroy();app.quit();
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1)});
`);
    if (capturePath) await mkdir(dirname(resolve(capturePath)), { recursive: true });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const virtual = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY;
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(directory, 'run.cjs')];
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args, { cwd: desktop, env, stdio: 'inherit', windowsHide: true, shell: false });
        child.once('error', reject); child.once('exit', code => done(code ?? 1));
    });
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-response-timing-ui-')) throw new Error('Unexpected cleanup path');
    await rm(directory, { recursive: true, force: true });
}
