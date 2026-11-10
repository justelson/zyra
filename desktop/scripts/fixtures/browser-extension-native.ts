import assert from 'node:assert/strict';
import { app, BrowserWindow, session } from 'electron';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserExtensionManager } from '../../src/main/browser-extension-manager';
import { fixtureExtension } from './signed-extension';
app.setPath('userData', process.env.ZYRA_EXTENSION_TEST_PROFILE!);
let window: BrowserWindow | undefined;
const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><head><title>Extension check</title></head><body style="background:white;color:black;padding:50px;font:20px sans-serif"><h1>Browser extension check</h1><p>This isolated page verifies extension content scripts.</p></body></html>'); });
app.on('web-contents-created', (_event, contents) => contents.setWindowOpenHandler(() => ({ action: 'deny' })));
const deadline = setTimeout(() => { console.error('Extension native fixture timed out'); app.exit(1); }, 40000);
app.whenReady().then(async () => {
    const profile = app.getPath('userData'), browserSession = session.fromPartition('persist:extension-install-test');
    if (process.env.ZYRA_EXTENSION_TEST_CRX)
        browserSession.serviceWorkers.on('console-message', (_event, details) => console.log('Extension worker:', details));
    const manager = new BrowserExtensionManager(browserSession), restart = process.env.ZYRA_EXTENSION_TEST_RESTART === '1', live = process.env.ZYRA_EXTENSION_TEST_CRX;
    let id: string;
    if (restart) {
        id = JSON.parse(await readFile(join(profile, 'fixture-receipt.json'), 'utf8')).id;
        await manager.loadEnabled();
    }
    else {
        const pack = live ? { bytes: await readFile(live), id: process.env.ZYRA_EXTENSION_TEST_ID! } : fixtureExtension();
        id = pack.id;
        assert.match(id, /^[a-p]{32}$/);
        const fetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => { const url = new URL(String(input)); if (url.hostname === 'clients2.google.com' && url.pathname === '/service/update2/crx')
            return new Response(new Uint8Array(pack.bytes)); return fetch(input, init); };
        if ('repack' in pack) {
            const original = pack.bytes;
            pack.bytes = pack.repack({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Compatibility review', version: '1', optional_permissions: ['contextMenus'] }) }).bytes;
            const cancelled = await manager.inspectWebStore(id);
            assert.ok(cancelled.warnings.some(warning => warning.includes('contextMenus')));
            assert.ok(cancelled.warnings.some(warning => warning.includes('Optional permission prompts')));
            await manager.discardWebStore(id);
            assert.equal((await manager.list()).length, 0);
            assert.equal(browserSession.extensions.getAllExtensions().length, 0, 'cancelled review never executes');
            pack.bytes = original;
        }
        const review = await manager.inspectWebStore(id);
        assert.equal(review.id, id);
        assert.equal(browserSession.extensions.getAllExtensions().length, 0, 'review cannot execute the extension');
        const installed = await manager.approveWebStore(id);
        assert.equal(installed.id, id, 'runtime identity matches the requested store extension');
        await writeFile(join(profile, 'fixture-receipt.json'), JSON.stringify({ id }));
        if ('repack' in pack)
            pack.bytes = pack.repack({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Zyra install check', version: '2.0.0', content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }), 'content.js': 'document.documentElement.dataset.zyraInstalled=chrome.runtime.id;document.documentElement.dataset.zyraVersion="2";' }).bytes;
        const previousPath = installed.path;
        const again = await manager.inspectWebStore(id);
        const reinstalled = await manager.approveWebStore(again.id);
        assert.equal(reinstalled.id, id);
        assert.equal((await manager.list()).length, 1, 'reinstall is idempotent');
        await assert.rejects(stat(previousPath), { code: 'ENOENT' }, 'approved update retires the old package');
        if (!live)
            assert.equal(browserSession.extensions.getAllExtensions()[0]?.version, '2.0.0', 'the approved update replaces the running version immediately');
    }
    assert.equal(browserSession.extensions.getAllExtensions()[0]?.id, id);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as {
        port: number;
    };
    window = new BrowserWindow({ show: false, focusable: false, width: 900, height: 600, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadURL(`http://127.0.0.1:${address.port}/`);
    const liveProbes: Record<string, string> = { 'eimadpbcbfnmbkopoojfekhnkhdbieeh': `document.documentElement.getAttribute('data-darkreader-scheme')==='dark'`, 'fmkadmapgofadopljbjfkapdkoienihi': `typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.inject==='function'` };
    if (live)
        assert.ok(liveProbes[id], 'A live canary must have an explicit operation check');
    const applied = async () => window!.webContents.executeJavaScript(live ? liveProbes[id] : `document.documentElement.dataset.zyraInstalled===${JSON.stringify(id)}`);
    for (let i = 0; i < 120 && !await applied(); i++)
        await new Promise(resolve => setTimeout(resolve, 50));
    if (live && !await applied()) {
        console.log('Live canary: initial navigation preceded dynamic script registration; checking after website reload');
        await window.loadURL(`http://127.0.0.1:${address.port}/second`);
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    assert.equal(await applied(), true, 'installed extension actually operates on the Browser page');
    if (!restart) {
        await manager.setEnabled(id, false);
        await window.webContents.reload();
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!live)
            assert.equal(await applied(), false);
        await manager.setEnabled(id, true);
        await manager.reload(id);
    }
    else {
        await manager.remove(id);
        assert.equal((await manager.list()).length, 0);
        assert.equal(browserSession.extensions.getAllExtensions().length, 0);
    }
    assert.equal(window.isVisible(), false);
    assert.equal(window.isFocused(), false);
    console.log('PASS: ' + (restart ? 'actual process restart, extension operation and removal' : 'permission staging, signed install, stable ID, reinstall, content scripts, disable/enable and reload') + (live ? ' (real signed Store package ' + id + ')' : ''));
    clearTimeout(deadline);
    server.close();
    window.destroy();
    app.quit();
}).catch(error => { console.error(error); clearTimeout(deadline); server.close(); window?.destroy(); app.exit(1); });
