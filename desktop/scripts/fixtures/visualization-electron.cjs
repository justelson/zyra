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
    // DevTools reads the real child DOM/CSS without enabling child scripts or
    // weakening its opaque sandbox. Capture checks also run without screenshots.
    window.webContents.debugger.attach('1.3')
    const cdp = (method, params = {}) => window.webContents.debugger.sendCommand(method, params)
    await cdp('DOM.enable')
    await cdp('CSS.enable')
    const rgb = color => {
        if (color.startsWith('color(srgb ')) return color.slice(11, -1).split(/[ /]+/).slice(0, 3).map(value => Number(value) * 255)
        const channels = color.match(/[\d.]+/g)
        assert(channels?.length >= 3, `supported computed color: ${color}`)
        return channels.slice(0, 3).map(Number)
    }
    const luminance = color => rgb(color).map(value => value / 255).reduce((sum, value, index) => sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), 0)
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
    const rect = quad => ({ x: quad[0], y: quad[1], width: quad[2] - quad[0], height: quad[5] - quad[1] })
    const childDocument = node => node.nodeName === 'IFRAME' && node.contentDocument ? node.contentDocument : (node.children || []).map(childDocument).find(Boolean)
    const openChartDocument = async () => {
        const tree = await cdp('DOM.getDocument', { depth: -1, pierce: true })
        let child = childDocument(tree.root)
        let chartCdp = cdp
        let chartSessionId
        if (!child) {
            // An opaque srcdoc can live in its own renderer process. Inspect
            // that DevTools target without granting script/same-origin access.
            const { targetInfos } = await cdp('Target.getTargets')
            const target = targetInfos.find(target => target.type === 'iframe' && target.url === 'about:srcdoc')
            assert(target, 'sandboxed srcdoc has an inspectable renderer target')
            const { sessionId } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true })
            chartSessionId = sessionId
            chartCdp = (method, params = {}) => window.webContents.debugger.sendCommand(method, params, sessionId)
            await chartCdp('DOM.enable')
            await chartCdp('CSS.enable')
            child = (await chartCdp('DOM.getDocument', { depth: -1, pierce: true })).root
        }
        assert(child, 'live sandboxed iframe DOM is available for layout inspection')
        return { child, chartCdp, chartSessionId }
    }
    const capture = async () => {
        await window.webContents.capturePage()
        await new Promise(resolve => setTimeout(resolve, 200))
        return window.webContents.capturePage()
    }
    for (const mode of ['dark', 'light']) {
        for (const width of [undefined, 320]) {
            const expected = await window.webContents.executeJavaScript(`window.visualizationShowcase('${mode}',${width ?? 'undefined'})`)
            const parent = await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`)
            if (width) assert.equal(parent.width, width, 'narrow chart is rendered at 320px, not scaled down')
            assert.equal(parent.height, 430, 'showcase keeps the requested compact height')
            const { child, chartCdp, chartSessionId } = await openChartDocument()
            // Flush the newly navigated frame's layout before measuring nodes.
            const { cssLayoutViewport } = await chartCdp('Page.getLayoutMetrics')
            if (chartSessionId) {
                assert(Math.abs(cssLayoutViewport.clientWidth - parent.width) < 1, 'the measured frame matches the preview width')
                assert.equal(cssLayoutViewport.clientHeight, parent.height, 'the measured frame matches the preview height')
            }
            const inspectNode = async (nodeId, label) => {
                const style = await chartCdp('CSS.getComputedStyleForNode', { nodeId })
                const css = Object.fromEntries(style.computedStyle.map(({ name, value }) => [name, value]))
                let box
                try { box = await chartCdp('DOM.getBoxModel', { nodeId }) }
                catch (error) { throw new Error(`Box model missing for ${label}: display=${css.display}, visibility=${css.visibility}: ${error.message}`) }
                return { css, box: rect(box.model.content) }
            }
            const inspect = async selector => {
                const { nodeId } = await chartCdp('DOM.querySelector', { nodeId: child.nodeId, selector })
                assert(nodeId, `rendered element exists: ${selector}`)
                const [geometry, markup] = await Promise.all([inspectNode(nodeId, selector), chartCdp('DOM.getOuterHTML', { nodeId })])
                return { ...geometry, markup: markup.outerHTML }
            }
            const body = await inspect('body')
            const bars = await Promise.all(expected.snacks.map((_, index) => inspect(`#snack-${index}`)))
            const tracks = await Promise.all(expected.snacks.map((_, index) => inspect(`.snack:nth-of-type(${index + 1}) .snack-track`)))
            const cells = await Promise.all(expected.heatRows.flatMap((row, r) => row.map((value, c) => inspect(`#heat-${r}-${c}`).then(cell => ({ ...cell, value })))))
            const { nodeIds } = await chartCdp('DOM.querySelectorAll', { nodeId: child.nodeId, selector: '.snack-label,.snack-value,.heat-label,.heat-day,h3,.snack-axis span,.heat-legend' })
            const labels = await Promise.all(nodeIds.map(nodeId => inspectNode(nodeId, 'chart label')))
            for (const element of [...bars, ...tracks, ...cells, ...labels]) {
                assert(element.box.x >= body.box.x - 0.5 && element.box.x + element.box.width <= body.box.x + parent.width + 0.5, `${mode}/${width || 'wide'}: content fits without horizontal clipping`)
                assert(element.box.y + element.box.height <= body.box.y + parent.height + 0.5, `${mode}: content fits the frame height`)
            }
            for (const label of labels) assert(parseFloat(label.css['font-size']) >= 13, 'narrow labels keep readable font sizes')
            for (let index = 0; index < bars.length; index++) assert(Math.abs(bars[index].box.width / tracks[index].box.width * 100 - expected.snacks[index]) < 0.15, 'rendered bar geometry matches the visible value')
            assert.equal(new Set(bars.map(bar => bar.css['background-color'])).size, 3, 'the categories have three distinct computed colors')
            for (const cell of cells) {
                assert(cell.markup.includes(`>${cell.value}</span>`), 'heatmap values survive sanitization and render in their original cells')
                assert(contrast(cell.css.color, cell.css['background-color']) >= 4.5, `${mode}: heatmap label contrast is readable at ${cell.value}`)
                assert(parseFloat(cell.css['font-size']) >= 13, 'heatmap numbers do not shrink at narrow width')
            }
            const ordered = [...cells].sort((a, b) => a.value - b.value)
            for (let index = 1; index < ordered.length; index++) {
                const change = luminance(ordered[index].css['background-color']) - luminance(ordered[index - 1].css['background-color'])
                assert(mode === 'dark' ? change >= -0.00001 : change <= 0.00001, 'heatmap luminance progresses monotonically with the score')
            }
            const image = await capture()
            const size = image.getSize(), bitmap = image.toBitmap()
            const pixel = (x, y) => {
                const offset = (Math.floor(y * size.height / parent.viewportHeight) * size.width + Math.floor(x * size.width / parent.viewportWidth)) * 4
                return [...bitmap.subarray(offset, offset + 3)].reverse()
            }
            for (const mark of [...bars, ...cells]) {
                const actual = pixel(parent.x + mark.box.x - body.box.x + 3, parent.y + mark.box.y - body.box.y + 3)
                const expectedColor = rgb(mark.css['background-color'])
                assert(actual.every((channel, index) => Math.abs(channel - expectedColor[index]) <= 2), `${mode}: painted chart pixel matches computed color ${mark.css['background-color']} (${actual})`)
            }
            assert.deepEqual(pixel(parent.x + parent.width - 2, parent.y + parent.height - 2), pixel(2, 2), `${mode}: the iframe canvas must blend into the page`)
            if (screenshots) await writeFile(path.join(screenshots, `${mode}${width ? '-narrow' : ''}.png`), image.toPNG())
            if (chartSessionId) await cdp('Target.detachFromTarget', { sessionId: chartSessionId })
        }
    }
    console.log('PASS: dark/light and 320px real iframe pixels, data geometry, contrast, monotonic heat scale and palette exports')
    for (const font of ['bricolage', 'hanken', 'managed:visualization-fixture']) {
        await window.webContents.executeJavaScript(`window.visualizationFontCase('${font}')`)
        const parentDocument = (await cdp('DOM.getDocument')).root
        const { nodeId: parentNode } = await cdp('DOM.querySelector', { nodeId: parentDocument.nodeId, selector: '#font-parent-sample' })
        const parentFonts = (await cdp('CSS.getPlatformFontsForNode', { nodeId: parentNode })).fonts.filter(face => face.glyphCount > 0)
        assert(parentFonts.some(face => face.isCustomFont), `${font}: the parent sample must actually render the loaded app font`)
        const parentFamilies = [...new Set(parentFonts.map(face => face.familyName))].sort()
        for (const surface of ['inline', 'export']) {
            if (surface === 'export') await window.webContents.executeJavaScript('window.visualizationFontExport()')
            const { child, chartCdp, chartSessionId } = await openChartDocument()
            await chartCdp('Page.getLayoutMetrics')
            for (const selector of ['#font-default', '#font-svg', '#font-explicit']) {
                const { nodeId } = await chartCdp('DOM.querySelector', { nodeId: child.nodeId, selector })
                assert(nodeId, `${font}/${surface}: rendered font sample exists`)
                let fonts
                for (let attempt = 0; attempt < 40; attempt++) {
                    fonts = (await chartCdp('CSS.getPlatformFontsForNode', { nodeId })).fonts.filter(face => face.glyphCount > 0)
                    if (selector === '#font-explicit' || fonts.some(face => face.isCustomFont)) break
                    await new Promise(resolve => setTimeout(resolve, 20))
                }
                assert(fonts.length > 0, 'font attribution must report actual rendered glyphs')
                const actualFamilies = [...new Set(fonts.map(face => face.familyName))].sort()
                if (selector === '#font-explicit') {
                    assert.notDeepEqual(actualFamilies, parentFamilies, `${font}/${surface}: authored serif override remains effective`)
                } else {
                    assert(fonts.some(face => face.isCustomFont), `${font}/${surface}: embedded font must load, not silently fall back`)
                    assert.deepEqual(actualFamilies, parentFamilies, `${font}/${surface}: actual glyph font matches the parent app`)
                }
            }
            if (chartSessionId) await cdp('Target.detachFromTarget', { sessionId: chartSessionId })
        }
    }
    await window.webContents.executeJavaScript('window.visualizationFontCleanup()')
    assert.equal(requests.length, 0, 'font inheritance never permits authored network requests')
    console.log('PASS: actual bundled/managed app fonts in inline HTML, SVG and exported HTML; overrides and one-read caching preserved')
    window.webContents.debugger.detach()
    if (screenshots) {
        await window.webContents.executeJavaScript(`window.visualizationShowcase('dark')`)
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Options for Fictional robot data"]').click()`)
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
