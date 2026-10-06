const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const { writeFile } = require('node:fs/promises')
const directory = process.env.ZYRA_VISUALIZATION_FIXTURE
app.setPath('userData', path.join(directory, 'profile'))
let window
const timer = setTimeout(() => { console.error('Visualization fixture timed out'); app.exit(1) }, 25000)
app.whenReady().then(async () => {
    window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const diagnostics = []
    window.webContents.on('console-message', (event) => { if (diagnostics.length < 12) diagnostics.push(event.message) })
    const requests = []
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['*://visualization-test.invalid/*'] }, (details, callback) => { requests.push(details.url); callback({ cancel: true }) })
    if (process.env.ZYRA_VISUALIZATION_EXTENSION === '1') {
        const extension = await window.webContents.session.extensions.loadExtension(directory)
        await window.loadURL(`chrome-extension://${extension.id}/index.html`)
    } else await window.loadFile(path.join(directory, 'index.html'))
    const result = await window.webContents.executeJavaScript('window.visualizationCheck')
    assert(Array.isArray(result), 'fixture script must execute under the real app CSP: ' + JSON.stringify(diagnostics))
    for (let i = 0; i < 100 && !window.webContents.mainFrame.frames.some(frame => frame.url === 'about:srcdoc'); i++) await new Promise(resolve => setTimeout(resolve, 25))
    const frame = window.webContents.mainFrame.frames.find(frame => frame.url === 'about:srcdoc')
    assert(frame, 'srcdoc renders under the actual parent CSP: ' + JSON.stringify({ frames: window.webContents.mainFrame.frames.map(frame => frame.url), diagnostics }))
    const isolation = await window.webContents.executeJavaScript(`(()=>{const child=document.querySelector('iframe');try{void child.contentWindow.document;return false}catch{return child.contentDocument===null}})()`)
    assert.equal(isolation, true, 'sandbox has an opaque origin, not the app origin')
    let scriptBlocked = false
    try { await frame.executeJavaScript('1 + 1') } catch (error) { scriptBlocked = /Script not run/i.test(String(error)) }
    assert.equal(scriptBlocked, true, 'even direct child script execution is blocked by the sandbox')
    assert.equal(requests.length, 0, 'CSP blocks remote requests before the network layer')
    for (const check of result) console.log('PASS: ' + check)
    console.log('PASS: real renderer CSP, rendered srcdoc, opaque origin and zero external requests')
    const screenshots = process.env.ZYRA_VISUALIZATION_SCREENSHOTS
    if (screenshots) {
        const capture = async () => {
            await window.webContents.capturePage()
            await new Promise(resolve => setTimeout(resolve, 200))
            return window.webContents.capturePage()
        }
        for (const mode of ['dark', 'light']) {
            await window.webContents.executeJavaScript(`window.visualizationShowcase('${mode}')`)
            const image = await capture()
            const point = await window.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('iframe').getBoundingClientRect();return {x:rect.right-2,y:rect.bottom-2,width:innerWidth,height:innerHeight}})()`)
            const size = image.getSize()
            const bitmap = image.toBitmap()
            const pixel = (x, y) => { const offset = (Math.floor(y * size.height / point.height) * size.width + Math.floor(x * size.width / point.width)) * 4; return [...bitmap.subarray(offset, offset + 3)] }
            assert.deepEqual(pixel(point.x, point.y), pixel(2, 2), `${mode}: the iframe canvas must blend into the page`)
            await writeFile(path.join(screenshots, `${mode}.png`), image.toPNG())
        }
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Options for Time by stage"]').click()`)
        await new Promise(resolve => setTimeout(resolve, 180))
        await writeFile(path.join(screenshots, 'menu.png'), (await capture()).toPNG())
    }
    clearTimeout(timer)
    window.destroy()
    app.quit()
}).catch(error => {
    console.error(error)
    clearTimeout(timer)
    if (window && !window.isDestroyed()) window.destroy()
    app.exit(1)
})
