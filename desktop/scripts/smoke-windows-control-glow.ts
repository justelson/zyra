import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { WINDOWS_CONTROL_SAFETY_HTML, WINDOWS_CONTROL_CURSOR_HTML } from '../src/main/agent-control/windows-control-overlay-document'

// Exercise the shipped document in a hidden Chromium window, with no native
// control, provider, user profile, screen capture or focus changes.
void app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    try {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(WINDOWS_CONTROL_SAFETY_HTML)}`)
        const run = (script: string) => window.webContents.executeJavaScript(script)
        assert.equal(await run('typeof globalThis.hideZyraSafety'), 'function', 'the glow needs a graceful stop path')
        await run(`globalThis.updateZyraSafety({application:'Test app',key:'Esc'},true)`)
        await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
        await run(`document.querySelector('.edge').getAnimations().forEach(a=>a.finish())`)
        const active = await run(`(() => {const edge=getComputedStyle(document.querySelector('.edge'));const wave=getComputedStyle(document.querySelector('.wave'));return {opacity:Number(edge.opacity),depth:parseFloat(wave.height),blur:wave.filter,active:document.documentElement.dataset.active,animations:document.querySelector('.edge').getAnimations().map(a=>({time:a.currentTime,state:a.playState,timing:a.effect.getComputedTiming()}))}})()`)
        assert.equal(active.active, 'true')
        assert.equal(active.opacity, 1, JSON.stringify(active))
        assert(active.depth >= 240, 'light should reach well inside the display')
        assert.match(active.blur, /blur\(/, 'wave lobes should blend through a soft falloff')
        await run('globalThis.hideZyraSafety()')
        assert.equal(await run("getComputedStyle(document.querySelector('.indicator')).opacity"), '0', 'stop copy clears immediately when authority ends')
        await run(`getComputedStyle(document.querySelector('.edge')).opacity;const fade=document.querySelector('.edge').getAnimations()[0];if(!fade)throw Error('Missing exit transition');fade.pause();fade.currentTime=150`)
        const fading = await run("Number(getComputedStyle(document.querySelector('.edge')).opacity)")
        assert(fading > 0 && fading < 1, 'stop should fade the glow instead of cutting it off')
        await run(`document.querySelector('.edge').getAnimations().forEach(a=>a.finish())`)
        assert.equal(await run("getComputedStyle(document.querySelector('.edge')).opacity"), '0')
        await run(`globalThis.updateZyraSafety({application:'Next app',reduceMotion:true},true)`)
        assert.equal(await run("getComputedStyle(document.querySelector('.edge')).opacity"), '1')
        await run('globalThis.hideZyraSafety()')
        assert.equal(await run("getComputedStyle(document.querySelector('.edge')).opacity"), '0', 'reduced motion also hides stopped glow')
        await run(`globalThis.updateZyraSafety({application:'Next app',reduceMotion:false},true)`)
        await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
        await run(`document.querySelector('.edge').getAnimations().forEach(a=>a.finish())`)
        assert.equal(await run("getComputedStyle(document.querySelector('.edge')).opacity"), '1', 'reactivation restores the glow')
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(WINDOWS_CONTROL_CURSOR_HTML)}`)
        await run(`updateZyraCursor({x:450,y:250,durationMs:120})`)
        assert.equal(await run("getComputedStyle(document.querySelector('.cursor')).transitionDuration"), '0s', 'first show cannot fly from the origin')
        await run(`updateZyraCursor({x:480,y:265,durationMs:0,phase:'dragging'})`)
        assert.equal(await run("getComputedStyle(document.querySelector('.cursor')).transitionDuration"), '0s', 'native progress must not trail behind an added easing curve')
        await run(`updateZyraCursor({x:520,y:280,durationMs:80})`)
        assert.equal(await run("getComputedStyle(document.querySelector('.cursor')).transitionDuration"), '0.08s', 'semantic cursor movement retains smoothing')
        console.log('Glow document: deep soft light, entrance, graceful stop, reduced motion and reactivation passed.')
    } finally { window.destroy(); app.quit() }
}).catch(error => { console.error(error); app.exit(1) })
