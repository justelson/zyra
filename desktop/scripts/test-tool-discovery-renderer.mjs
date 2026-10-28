import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.js';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'zyra-tool-discovery-'));
const screenshot = process.env.ZYRA_TOOL_DISCOVERY_SCREENSHOT ? resolve(process.env.ZYRA_TOOL_DISCOVERY_SCREENSHOT) : null;
try {
  await writeFile(join(directory, 'settings.ts'), 'export function useSettings(){return {settings:{assistantShowActionStats:false}}}');
  // Keep the real list/router, action grouping, loader row, control row and
  // disclosure shell. Unrelated evidence renderers are outside this scenario.
  const unrelated = ['AssistantTimelineNetworkRecovery', 'AssistantTimelineIssueList', 'AssistantTimelineAgentAction', 'AssistantTimelineReadAction', 'AssistantTimelineSearchAction', 'AssistantTimelineSkillAction', 'AssistantTimelineWebAction', 'AssistantTimelineToolCallCard', 'PluginToolCallCard', 'AssistantTimelineThreadMessage'];
  const exports = ['AssistantTimelineNetworkRecovery', 'TimelineIssueList', 'AssistantTimelineAgentAction', 'AssistantTimelineReadAction', 'AssistantTimelineSearchAction', 'AssistantTimelineSkillAction', 'AssistantTimelineWebAction', 'TimelineToolCallCard', 'PluginToolCallCard', 'AssistantTimelineThreadMessage'];
  await writeFile(join(directory, 'unrelated.tsx'), exports.map(name => `export function ${name}(){return null}`).join('\n'));
  await build({
    entryPoints: [join(desktop, 'scripts/fixtures/tool-discovery-row.tsx')], outfile: join(directory, 'fixture.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@/lib/settings': join(directory, 'settings.ts'), '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.hot': 'undefined' },
    plugins: [{ name: 'unrelated-action-evidence', setup(builder) {
      builder.onResolve({ filter: /^\.\/[^/]+$/ }, args => unrelated.includes(args.path.slice(2)) ? { path: join(directory, 'unrelated.tsx') } : null);
    } }], logLevel: 'silent'
  });
  const css = await postcss([tailwindcss({ ...tailwindConfig, content: [
    join(desktop, 'src/renderer/src/pages/assistant/AssistantTimelineActionShell.tsx'),
    join(desktop, 'src/renderer/src/pages/assistant/AssistantTimelineToolDiscovery.tsx'),
    join(desktop, 'src/renderer/src/pages/assistant/assistant-action-row-layout.ts'),
    join(desktop, 'src/renderer/src/components/ui/AnimatedHeight.tsx')
  ] })]).process('@tailwind base;@tailwind utilities;', { from: undefined });
  await writeFile(join(directory, 'fixture.css'), css.css + '\n:root{--color-bg:#111418;--color-text:#dadbd7;--color-text-secondary:#aaa;--color-text-muted:#777;--surface-hover:#ffffff08;--status-danger:#dc6e72;--status-warning:#deb773}body{margin:0;background:#111418;color:#dadbd7;font-family:Arial,sans-serif}');
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><script src="fixture.js"></script></body></html>');
  if (screenshot) await mkdir(dirname(screenshot), { recursive: true });
  await writeFile(join(directory, 'run.cjs'), `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
const deadline=setTimeout(()=>{console.error('Tool discovery renderer timed out');app.exit(1)},20000);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:960,height:420,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
 for(const width of [960,360]){window.setSize(width,420);await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
  const results=await window.webContents.executeJavaScript('globalThis.__toolDiscoveryCheck');for(const result of results)console.log('PASS '+width+'px: '+result);
  ${screenshot ? `if(width===960)fs.writeFileSync(${JSON.stringify(screenshot)},(await window.webContents.capturePage()).toPNG());` : ''}
 }clearTimeout(deadline);app.quit();
}).catch(error=>{console.error(error);app.exit(1)});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const linuxCI = process.platform === 'linux' && Boolean(process.env.CI);
  const args = [...(linuxCI ? ['--no-sandbox'] : []), join(directory, 'run.cjs')];
  const virtual = linuxCI && !process.env.DISPLAY;
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args, { cwd: desktop, env, stdio: 'inherit', windowsHide: true });
    const watchdog = setTimeout(() => child.kill(), 30000);
    child.once('error', error => { clearTimeout(watchdog); reject(error); });
    child.once('exit', code => { clearTimeout(watchdog); done(code ?? 1); });
  });
} finally {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-tool-discovery-')) throw new Error('Unexpected fixture cleanup path');
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
