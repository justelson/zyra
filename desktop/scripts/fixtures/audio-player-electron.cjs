const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { join } = require('node:path')

app.setPath('userData', join(process.env.ZYRA_AUDIO_TEST_ROOT, 'profile'))
const timeout = setTimeout(() => app.exit(1), 105000)
let win
const run = expression => win.webContents.executeJavaScript(expression, true)
async function until(expression, label) {
    for (let attempt = 0; attempt < 600; attempt++) {
        if (await run(expression)) return
        await new Promise(resolve => setTimeout(resolve, 40))
    }
    throw new Error(`Timed out: ${label}. ${await run('document.body.innerText')}`)
}
async function pointer(selector, fraction = 0.5, index = 0) {
    const point = await run(`(()=>{const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();const x=r.left+r.width*${fraction},y=r.top+r.height/2;if(document.elementFromPoint(x,y)!==el&&!el.contains(document.elementFromPoint(x,y)))throw Error('Player control is covered');return{x,y}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 })
}
void app.whenReady().then(async () => {
    try {
        win = new BrowserWindow({ width: 1000, height: 700, show: false, focusable: false, skipTaskbar: true, webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } })
        // Decode and advance real audio without making sound on the user's speakers.
        win.webContents.setAudioMuted(true)
        await win.loadURL(process.env.ZYRA_AUDIO_PREVIEW_URL)
        await until("document.querySelectorAll('[data-audio-player]').length===2&&[...document.querySelectorAll('audio')].every(a=>a.readyState>=1)", 'MP3/WAV metadata')
        assert.equal(await run("[...document.querySelectorAll('audio')].every(a=>!a.controls&&!a.autoplay&&a.paused&&a.currentTime===0&&a.duration>7)"), true)
        assert.equal(await run("[...document.querySelectorAll('[data-audio-player]')].every(p=>p.getBoundingClientRect().height<90&&p.querySelectorAll('[data-audio-action=play]').length===1)"), true)
        await pointer('[data-audio-action="play"]')
        await until("document.querySelector('audio').currentTime>0.15", 'custom Play advances real MP3')
        await pointer('[data-audio-action="play"]')
        await until("document.querySelector('audio').paused", 'custom Pause')
        await pointer('.audio-player-seek', 0.6)
        await until("document.querySelector('audio').currentTime>3&&!document.querySelector('audio').seeking", 'native-pointer seek through custom range')
        const beforeKey = await run("document.querySelector('audio').currentTime")
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
        await until(`document.querySelector('audio').currentTime>${beforeKey + 0.04}`, 'keyboard seek')
        await pointer('[data-audio-action="speed"]')
        await until("document.querySelector('audio').playbackRate===1.25&&document.querySelector('[data-audio-action=speed]').textContent==='1.25x'", 'speed control')
        await pointer('[data-audio-action="mute"]')
        await until("document.querySelector('audio').muted&&document.querySelector('[data-audio-action=mute]').getAttribute('aria-pressed')==='true'", 'mute control')
        await pointer('[data-audio-action="play"]')
        await until("!document.querySelector('audio').paused", 'resume first audio')
        await pointer('[data-audio-action="play"]', 0.5, 1)
        await until("document.querySelector('audio').paused&&!document.querySelectorAll('audio')[1].paused&&document.querySelectorAll('audio')[1].currentTime>0.15", 'one-at-a-time real WAV playback')
        await run("document.querySelectorAll('[data-audio-action=play]')[1].click()")
        const screenshot = async name => {
            if (!process.env.ZYRA_QA_SCREENSHOT_DIR) return
            await fs.mkdir(process.env.ZYRA_QA_SCREENSHOT_DIR, { recursive: true })
            win.webContents.invalidate()
            await new Promise(resolve => setTimeout(resolve, 100))
            await fs.writeFile(join(process.env.ZYRA_QA_SCREENSHOT_DIR, name), (await win.webContents.capturePage()).toPNG())
        }
        await screenshot('desktop.png')
        win.setSize(390, 700)
        await until("innerWidth===390", 'narrow viewport')
        assert.equal(await run("document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('[data-audio-player]')].every(p=>p.getBoundingClientRect().right<=innerWidth&&p.querySelector('.audio-player-seek').getBoundingClientRect().width>65)"), true)
        await screenshot('narrow.png')
        await run("document.querySelector('[aria-label=\"Use light theme\"]').click()")
        await until("document.body.classList.contains('light')", 'light theme')
        await screenshot('light.png')
        await run("(()=>{document.querySelector('[aria-label=\"Use dark theme\"]').click();const mode=document.querySelector('[aria-label=\"Preview layout\"]');mode.value='grouped';mode.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await until("document.querySelectorAll('[data-audio-player]').length===1&&document.querySelector('[aria-label=\"Audio file\"]')?.options.length===2&&document.querySelector('audio').readyState>=1", 'one real-message player with both formats')
        await pointer('[data-audio-action="play"]')
        await until("!document.querySelector('audio').paused", 'grouped source playback')
        await run("(()=>{window.__oldAudio=document.querySelector('audio');const select=document.querySelector('[aria-label=\"Audio file\"]');select.focus();select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await until("document.querySelector('audio')!==window.__oldAudio&&document.querySelector('audio').readyState>=1", 'alternate source selected')
        assert.equal(await run("window.__oldAudio.paused&&document.querySelector('audio').paused&&document.querySelector('audio').currentTime===0&&document.querySelector('audio').src.endsWith('sample.wav')&&document.activeElement===document.querySelector('[aria-label=\"Audio file\"]')"), true)
        await screenshot('grouped.png')
        await run("(()=>{const mode=document.querySelector('[aria-label=\"Preview layout\"]');mode.value='short';mode.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await until("document.querySelector('audio')?.src.endsWith('short.wav')&&document.querySelector('audio').readyState>=1", 'one-second sample')
        assert.equal(await run("document.querySelector('audio').paused&&document.querySelector('audio').duration<=1.01"), true)
        await pointer('[data-audio-action="play"]')
        await until("document.querySelector('audio').currentTime>0.08", 'short sample begins')
        const frames = await run(`new Promise(resolve=>{
            const audio=document.querySelector('audio'),range=document.querySelector('.audio-player-seek'),values=[];
            const block=event=>event.stopImmediatePropagation();
            audio.addEventListener('timeupdate',block,true);
            const end=performance.now()+550;
            const sample=()=>{values.push(Number(range.value));if(performance.now()<end)requestAnimationFrame(sample);else{audio.removeEventListener('timeupdate',block,true);resolve(values)}};
            requestAnimationFrame(sample);
        })`)
        assert.ok(frames.length>=4, 'the test must observe several rendered frames')
        assert.ok(new Set(frames).size>frames.length/2, 'the playhead must advance on frames, even with coarse timeupdate delivery blocked')
        await run("if(!document.querySelector('audio').paused)document.querySelector('[data-audio-action=play]').click()")
        await screenshot('short.png')
        const stopped = await run("document.querySelector('.audio-player-seek').value")
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(await run("document.querySelector('.audio-player-seek').value"), stopped, 'paused playhead remains still')
        assert.equal(win.isVisible(), false)
        assert.equal(win.isFocused(), false)
        console.log('PASS: actual inline MP3/WAV, custom pointer Play/Pause/seek, keyboard seek, speed/mute, exclusive playback, one-message grouping/source switching, smooth one-second playhead without timeupdate, no native controls/autoplay, desktop/narrow/light geometry')
        clearTimeout(timeout)
        win.destroy()
        app.exit(0)
    } catch (error) {
        console.error(error)
        clearTimeout(timeout)
        win?.destroy()
        app.exit(1)
    }
})
