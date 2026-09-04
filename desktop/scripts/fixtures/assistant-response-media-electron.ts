import assert from 'node:assert/strict'
import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'node:path'

const root = process.env.ZYRA_MEDIA_TEST_ROOT
if (!root) throw new Error('ZYRA_MEDIA_TEST_ROOT is required')
app.setPath('userData', join(root, 'profile'))
app.setPath('sessionData', join(root, 'session'))
protocol.registerSchemesAsPrivileged([{ scheme: 'zyra', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
const watchdog = setTimeout(() => app.exit(1), 45_000)

void app.whenReady().then(async () => {
    let window: BrowserWindow | undefined
    try {
        const { registerFileProtocol } = await import('../../src/main/file-protocol')
        registerFileProtocol('zyra')
        window = new BrowserWindow({
            show: false,
            focusable: false,
            skipTaskbar: true,
            webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
        })
        await window.loadFile(join(root, 'response.html'))
        const result = await window.webContents.executeJavaScript(`(async () => {
            const video = document.querySelector('video');
            if (!video) throw new Error('No player in rendered final response');
            async function until(predicate, label) {
                const deadline = performance.now() + 12000;
                while (!predicate()) {
                    if (video.error) throw new Error(label + ': ' + video.error.code + ' ' + video.error.message);
                    if (performance.now() >= deadline) throw new Error(label + ': timed out at readyState ' + video.readyState);
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            }
            await until(() => video.readyState >= 2 && video.videoWidth > 0, 'load video');
            const initial = { paused: video.paused, time: video.currentTime, autoplay: video.autoplay, controls: video.controls, preload: video.preload };
            video.muted = true;
            await video.play();
            await until(() => video.currentTime > 0.15, 'advance playback');
            video.pause();
            const playedTo = video.currentTime;
            const seekTo = video.duration / 2;
            video.currentTime = seekTo;
            await until(() => !video.seeking && Math.abs(video.currentTime - seekTo) < 0.1, 'seek');
            await video.play();
            await until(() => video.currentTime > seekTo + 0.1, 'play after seek');
            video.pause();
            return { initial, playedTo, seekTo, playedAfterSeekTo: video.currentTime, width: video.videoWidth, height: video.videoHeight, duration: video.duration, error: video.error?.code || null };
        })()`, true)
        assert.equal(result.initial.paused, true)
        assert.equal(result.initial.time, 0)
        assert.equal(result.initial.autoplay, false)
        assert.equal(result.initial.controls, true)
        assert.equal(result.initial.preload, 'metadata')
        assert.ok(result.playedTo > 0.15)
        assert.ok(result.playedAfterSeekTo > result.seekTo)
        assert.equal(result.error, null)
        assert.equal(window.isVisible(), false, 'the smoke window must never be shown')
        assert.equal(window.isFocused(), false, 'the smoke window must never receive focus')
        console.log(JSON.stringify({ test: 'assistant-response-media-playback', ...result }))
        clearTimeout(watchdog)
        window.destroy()
        app.exit(0)
    } catch (error) {
        console.error(error)
        clearTimeout(watchdog)
        window?.destroy()
        app.exit(1)
    }
}).catch((error) => {
    console.error(error)
    app.exit(1)
})
