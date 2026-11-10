import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { BrowserWebStoreInstall } from '../../src/main/browser-web-store-install'
import { renderWebStoreInstall } from '../../src/main/browser-web-store-page'
import { chromeWebStoreIdFromUrl } from '../../src/shared/browser-web-store'
import type { BrowserExtensionRecord } from '../../src/shared/browser-extensions'

app.setPath('userData', process.env.ZYRA_STORE_TEST_PROFILE!)
let window: BrowserWindow | undefined
const timer = setTimeout(() => { console.error('Web Store fixture timed out'); app.exit(1) }, 20000)
const pause = () => new Promise(resolve => setTimeout(resolve, 50))
async function waitFor(check: () => Promise<boolean>) {
    for (let i = 0; i < 80; i++) { if (await check()) return; await pause() }
    throw new Error('Web Store fixture condition did not settle')
}
app.whenReady().then(async () => {
    window = new BrowserWindow({ show: false, focusable: false, width: 900, height: 560, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'web-store-fixture' } })
    const page = window.webContents
    const id = 'a'.repeat(32), other = 'b'.repeat(32)
    const calls: string[] = []
    const theme = { accent: '#ed5145', background: '#002b36', foreground: '#eeeeee', fontFamily: 'system-ui', colorScheme: 'dark' }
    let document = 0
    let installRequestUrl: string | undefined
    page.session.protocol.handle('https', request => {
        assert.equal(new URL(request.url).hostname, 'chromewebstore.google.com', 'fixture never contacts an external site')
        return new Response(`<!doctype html><html style="--gm3-sys-color-primary:#a8c7fa;--gm3-sys-color-on-primary:#062e6f"><head><meta charset="utf-8"></head><body style="margin:0;background:#131414;color:#e3e3e3;font:14px Arial,sans-serif"><header style="padding:24px 36px;border-bottom:1px solid #303030">chrome web store</header><main style="padding:40px 48px"><aside id="chrome-prompt" style="padding:16px;background:#0842a0;border-radius:8px;display:flex;justify-content:space-between"><span>Switch to Chrome to install extensions and themes</span><button>Install Chrome</button></aside><div style="display:flex;align-items:center;justify-content:space-between;gap:28px"><h1 style="font-size:28px;font-weight:500">Example extension</h1><div style="flex-shrink:0"><button id="store-install" disabled style="height:40px;border:0;border-radius:20px;padding:0 24px">Add to Chrome</button></div></div><div style="display:flex;gap:20px;color:#a8c7fa"><span>example.test</span><span>Featured</span><span style="color:#e3e3e3">4.8 ★ (12K ratings)</span></div><p style="margin-top:32px;color:#aaa">Productivity · 100,000 users</p><button id="unrelated" style="margin-top:60px">Share</button><div id="chrome-promo" role="dialog" aria-labelledby="promo-header"><h2 id="promo-header">Switch to Chrome?</h2><a href="https://www.google.com/chrome/">Yes</a></div><div id="other-dialog" role="dialog" aria-labelledby="review-header" style="display:none"><h2 id="review-header">Review</h2>Write a review</div></main></body></html>`, { headers: { 'content-type': 'text/html' } })
    })
    // Test-only closed-shadow access, installed inside the isolated world before injection.
    const inspectShadow = async () => page.executeJavaScriptInIsolatedWorld(998, [{ code: `if(!globalThis.__testAttach){globalThis.__testAttach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const shadow=globalThis.__testAttach.call(this,options);globalThis.__testShadow=shadow;return shadow}};void 0` }])
    const flow = new BrowserWebStoreInstall({
        current: () => ({ url: page.getURL(), document, available: !page.isDestroyed() }),
        installer: {
            inspectWebStore: async requested => { calls.push('download:' + requested); await pause(); return { id: requested, name: 'Example extension', version: '1', permissions: ['storage'], hostPermissions: [], warnings: [] } as unknown as BrowserExtensionRecord },
            approveWebStore: async requested => { calls.push('install:' + requested); return {} as BrowserExtensionRecord },
            discardWebStore: async requested => { calls.push('discard:' + requested) }
        },
        present: async value => {
            if (value) installRequestUrl = value.requestUrl
            await page.executeJavaScriptInIsolatedWorld(998, [{ code: `(${renderWebStoreInstall.toString()})(${JSON.stringify(value)},(${chromeWebStoreIdFromUrl.toString()}),${JSON.stringify(theme)})` }])
        },
        confirm: async review => { calls.push('review:' + review.id); await pause(); return true },
        reportError: async message => { throw new Error(message) }
    })
    page.on('did-start-navigation', (_event, url, inPlace, mainFrame) => { if (mainFrame && !inPlace && !url.startsWith('zyra-extension:')) document++ })
    page.on('did-navigate-in-page', () => { void flow.refresh() })
    await page.loadURL(`https://chromewebstore.google.com/detail/example/${id}`)
    await inspectShadow(); await flow.refresh()
    const read = (code: string) => page.executeJavaScriptInIsolatedWorld(998, [{ code }])
    const label = () => read('globalThis.__testShadow?.querySelector("button")?.textContent')
    assert.equal(await label(), 'Add to Zyra')
    const style = () => read('(() => {const s=getComputedStyle(globalThis.__testShadow.querySelector("button"));return {radius:s.borderRadius,height:s.height,padding:s.padding,border:s.borderWidth,background:s.backgroundColor,color:s.color}})()')
    assert.deepEqual(await style(), {radius:'20px',height:'40px',padding:'0px 24px',border:'0px',background:'rgb(168, 199, 250)',color:'rgb(6, 46, 111)'}, 'Store-shaped filled primary pill uses the Store color tokens')
    assert.equal(await page.executeJavaScript('getComputedStyle(document.querySelector("#store-install")).display'), 'none', 'Chrome-only install control is hidden')
    assert.equal(await page.executeJavaScript('getComputedStyle(document.querySelector("#chrome-prompt")).display'), 'none', 'Chrome promotion banner is hidden')
    assert.notEqual(await page.executeJavaScript('getComputedStyle(document.querySelector("#unrelated")).display'), 'none', 'unrelated actions are preserved')
    assert.equal(await page.executeJavaScript('getComputedStyle(document.querySelector("#chrome-promo")).display'),'none','Chrome promotion popover is hidden')
    assert.equal(await page.executeJavaScript('document.querySelector("#other-dialog").style.display'),'none','unrelated dialog state is preserved')
    assert.equal(await page.executeJavaScript('document.querySelector("#store-install").nextElementSibling?.hasAttribute("data-zyra-web-store-install")'), true, 'Zyra occupies the original install location')
    theme.accent = '#24bfdd'; await flow.refresh()
    assert.equal((await style()).background,'rgb(168, 199, 250)','Store colors stay independent of the app accent')
    await page.executeJavaScript('document.documentElement.style.setProperty("--gm3-sys-color-primary","#0b57d0");document.documentElement.style.setProperty("--gm3-sys-color-on-primary","#ffffff")')
    await waitFor(async () => (await style()).background === 'rgb(11, 87, 208)')
    assert.equal((await style()).background,'rgb(11, 87, 208)','Store theme changes update the existing button')
    await page.executeJavaScript('document.documentElement.style.setProperty("--gm3-sys-color-primary","#a8c7fa");document.documentElement.style.setProperty("--gm3-sys-color-on-primary","#062e6f")')
    await waitFor(async () => (await style()).background === 'rgb(168, 199, 250)')
    assert.equal(await page.executeJavaScript('document.querySelector("[data-zyra-web-store-install]").shadowRoot'), null)
    assert.equal(await page.executeJavaScript('typeof window.require + ":" + typeof window.devscope'), 'undefined:undefined')
    await read('globalThis.__testShadow.querySelector("button").click()')
    await pause(); assert.deepEqual(calls, [], 'synthetic clicks cannot request downloads')
    await page.capturePage(); page.invalidate(); await new Promise(resolve => setTimeout(resolve, 180))
    if (process.env.ZYRA_STORE_TEST_SCREENSHOT) writeFileSync(process.env.ZYRA_STORE_TEST_SCREENSHOT, (await page.capturePage()).toPNG())
    assert.ok(installRequestUrl?.startsWith(`zyra-extension://install/${id}?request=`), 'button receives a scoped, single-use install URL')
    await flow.request(installRequestUrl!)
    assert.equal(await label(), 'Added to Zyra')
    assert.deepEqual(calls, ['download:' + id, 'review:' + id, 'install:' + id], 'request downloads, reviews and installs in order')
    console.log('PASS: Chrome banner/control hidden, filled Store pill and theme tokens, unrelated actions preserved, isolated single-use install feedback')

    await page.executeJavaScript(`history.pushState({}, '', '/detail/second/${other}')`)
    await waitFor(async () => await label() === 'Add to Zyra')
    await page.executeJavaScript('document.querySelector("[data-zyra-web-store-install]").remove()')
    await waitFor(async () => await page.executeJavaScript('!!document.querySelector("[data-zyra-web-store-install]")'))
    assert.equal(await page.executeJavaScript('document.querySelectorAll("[data-zyra-web-store-install]").length'), 1)
    await page.executeJavaScript('document.querySelector("#store-install").textContent="Add to Desktop"')
    await waitFor(async () => await page.executeJavaScript('document.querySelector("#store-install").nextElementSibling?.hasAttribute("data-zyra-web-store-install")'))
    await page.executeJavaScript('document.querySelector("#store-install").textContent="Ajouter à Chrome"')
    await waitFor(async () => await page.executeJavaScript('document.querySelector("h1").nextElementSibling?.hasAttribute("data-zyra-web-store-install")'))
    await page.executeJavaScript('document.querySelector("h1").remove()')
    await waitFor(async () => !await page.executeJavaScript('!!document.querySelector("[data-zyra-web-store-install]")'))
    await page.executeJavaScript('document.body.insertAdjacentHTML("afterbegin", "<h1>Restored listing</h1>")')
    await waitFor(async () => await page.executeJavaScript('!!document.querySelector("[data-zyra-web-store-install]")'))
    await page.executeJavaScript("history.pushState({}, '', '/category/extensions')")
    await waitFor(async () => !(await page.executeJavaScript('!!document.querySelector("[data-zyra-web-store-install]")')))
    assert.notEqual(await page.executeJavaScript('getComputedStyle(document.querySelector("#store-install")).display'),'none','original action restored off listings')
    assert.notEqual(await page.executeJavaScript('getComputedStyle(document.querySelector("#chrome-prompt")).display'),'none','original banner restored off listings')
    console.log('PASS: SPA listing change, DOM replacement, Add to Desktop, localized/missing action fallback, no duplicate buttons and removal off listings')
    clearTimeout(timer); window.destroy(); app.quit()
}).catch(error => { console.error(error); clearTimeout(timer); window?.destroy(); app.exit(1) })
