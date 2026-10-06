import { useLayoutEffect } from 'react'
import { checkExtensionSettings } from './extension-settings-check'
import { installBrowserDevscopeAdapter } from '../../src/renderer/src/lib/browser-devscope-adapter'
import { supportsNativeOverlay } from '../../src/renderer/src/components/ui/native-overlay-host'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { VisualizationMessage } from '../../src/renderer/src/components/ui/visualization/VisualizationMessage'
import { buildVisualizationDocument, DEFAULT_VISUALIZATION_THEME, getVisualizationDocumentCacheStats } from '../../src/renderer/src/components/ui/visualization/visualization-document'
import { ZYRA_THEME_CHANGED_EVENT } from '../../src/renderer/src/lib/theme-events'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const root = createRoot(document.querySelector('#root')!)
const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate: () => unknown) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await wait() } throw new Error('Visualization did not settle') }
const render = (content: string, streaming: boolean) => flushSync(() => root.render(<VisualizationMessage content={content} streaming={streaming} renderMarkdown={text => <p>{text}</p>} />))
const body = `<style>.plot { border:1px solid var(--viz-border); background-image:url(https://visualization-test.invalid/style.png) }</style>
<div class="plot">Network probe</div>
<svg viewBox="0 0 240 100" role="img" aria-label="Illustrative chart"><rect width="120" height="80" fill="var(--viz-accent)"/><rect x="130" width="100" height="40" fill="#e76f51"/><text x="8" y="96">Two series</text></svg>
<script>parent.document.body.dataset.compromised='yes';fetch('https://visualization-test.invalid/script')</script>
<img src="https://visualization-test.invalid/image" onerror="alert(1)"><a href="https://visualization-test.invalid/navigate">External</a>
<iframe src="https://visualization-test.invalid/frame"></iframe><meta http-equiv="refresh" content="0;url=https://visualization-test.invalid/refresh"><form action="https://visualization-test.invalid/form"><input type="file"></form>
<svg><foreignObject><iframe srcdoc="bad"></iframe></foreignObject><animate attributeName="href" values="javascript:alert(1)"/></svg>`
const opening = '<visualization title="Chart" summary="Illustrative values, 80 and 40." height="240">\n'
let initialPreviewHeight = 0
function InitialHeightProbe() {
    useLayoutEffect(() => {
        initialPreviewHeight = document.querySelector('figure > div')?.getBoundingClientRect().height ?? 0
    }, [])
    return <VisualizationMessage content={opening + '<p>Height probe</p>\n</visualization>'} streaming={false} renderMarkdown={text => <p>{text}</p>} />
}
;(window as any).visualizationCheck = (async () => {
    const originalOpen = window.open
    let unexpectedWindows = 0
    if (location.protocol === 'chrome-extension:') {
        window.open = () => { unexpectedWindows++; return null }
        installBrowserDevscopeAdapter()
        assert(!supportsNativeOverlay(), 'the real browser adapter must not advertise Desktop-owned native overlays')
        const liveAdapter = window.devscope
        const originalHash = location.hash
        history.replaceState(null, '', '#/assistant/dev/full-chat')
        ;(window as any).devscope = undefined
        installBrowserDevscopeAdapter()
        assert(!supportsNativeOverlay(), 'the offline browser adapter must also use in-page controls')
        history.replaceState(null, '', location.pathname + location.search + originalHash)
        window.devscope = liveAdapter
        await checkExtensionSettings(root)
    }
    flushSync(() => root.render(<InitialHeightProbe />))
    assert(initialPreviewHeight === 240, 'initial preparation reserves the complete preview height before effects')
    render('Before\n' + opening + body, true)
    assert(document.body.textContent?.includes('Creating visualization'), 'streaming shows a compact placeholder')
    assert(!document.querySelector('iframe'), 'partial HTML never renders')
    assert(!document.body.textContent?.includes('parent.document'), 'streaming never dumps source')
    render('Before\n' + opening + body + '\n</visualization>\nAfter', false)
    await until(() => document.querySelector('iframe')?.srcdoc)
    const frame = document.querySelector('iframe')!
    const figure = document.querySelector('figure')!
    assert(!/\b(border|rounded|bg-sparkle-card)/.test(figure.className), 'visualization sits on the page without an enclosing card')
    assert(!figure.querySelector('details, pre, figcaption'), 'description and HTML are not inline')
    assert(frame.srcdoc.includes('padding:0;background:transparent'), 'inline document has no padded background panel')
    assert(frame.srcdoc.includes(';--viz-border:#343b46}*{'), 'theme rule closes before document layout rules')
    assert(!document.body.textContent?.includes('Illustrative values'), 'description stays hidden until requested')
    const info = document.querySelector('[aria-label="Options for Chart"]') as HTMLButtonElement
    assert(info, 'small options trigger sits beside the title')
    info.click()
    await until(() => document.querySelector('[role="menu"]'))
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    assert(items.length === 2 && items[0].textContent === 'Copy HTML' && items[1].textContent === 'Download HTML', 'the menu contains exactly the two requested actions')
    assert(!document.body.textContent?.includes('Expand') && !document.body.textContent?.includes('Collapse') && !document.querySelector('dialog'), 'no expansion controls or source dialog remain')
    let copied = ''
    const originalBridge = window.devscope?.copyToClipboard
    ;(window as any).devscope = { ...window.devscope, copyToClipboard: async (text: string) => { copied = text; return { success: true } } }
    items[0].click()
    await until(() => Boolean(copied))
    assert(copied.includes('<!doctype html>') && copied.includes('Two series') && !copied.includes('<script>'), 'Copy HTML exports the sanitized self-contained document')
    ;(window as any).devscope.copyToClipboard = originalBridge
    await until(() => !document.querySelector('[role="menu"]'))
    assert(document.activeElement === info, 'copy returns focus to the trigger')
    assert(frame.style.height === '240px', 'the authored preview height stays fixed')
    frame.loading = 'eager'
    await wait(120)
    assert(frame.getAttribute('sandbox') === '', 'opaque scriptless sandbox')
    assert(frame.referrerPolicy === 'no-referrer', 'no referrer leakage')
    assert(!/<script|<iframe|<meta[^>]+refresh|onerror|<form|<input|foreignObject|<animate/i.test(frame.srcdoc), 'active elements and handlers are removed')
    assert(!/href="https:|src="https:/i.test(frame.srcdoc), 'external navigation and image sources are removed')
    assert(frame.srcdoc.includes("default-src 'none'") && frame.srcdoc.includes("connect-src 'none'"), 'network is denied by CSP')
    assert(frame.srcdoc.includes('.plot') && frame.srcdoc.includes('viewBox') && frame.srcdoc.includes('Two series'), 'styles and SVG survive sanitization')
    assert(document.body.textContent?.includes('Before') && document.body.textContent?.includes('After'), 'text around the visualization stays in order')
    assert(!document.body.dataset.compromised, 'authored HTML cannot change the host')
    info.focus()
    info.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await until(() => document.activeElement?.textContent === 'Copy HTML')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    assert(document.activeElement?.textContent === 'Download HTML', 'arrow navigation reaches the second action')
    let downloaded: Blob | null = null
    const originalCreateURL = URL.createObjectURL, originalAnchorClick = HTMLAnchorElement.prototype.click
    URL.createObjectURL = blob => { downloaded = blob as Blob; return 'blob:fixture-download' }
    HTMLAnchorElement.prototype.click = function () { assert(this.download === 'Chart.html', 'download uses the chart title') }
    ;(document.activeElement as HTMLButtonElement).click()
    assert(downloaded && (await (downloaded as Blob).text()).includes('Two series'), 'Download HTML exports a real standalone document')
    URL.createObjectURL = originalCreateURL; HTMLAnchorElement.prototype.click = originalAnchorClick
    info.click()
    await until(() => document.querySelector('[role="menu"]'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await until(() => !document.querySelector('[role="menu"]'))
    assert(document.activeElement === info, 'Escape restores trigger focus')
    const oldSource = frame.srcdoc
    document.body.classList.add('light')
    document.documentElement.style.setProperty('--color-bg', '#ffffff')
    document.documentElement.style.setProperty('--color-text', '#18212b')
    document.documentElement.style.setProperty('--accent-primary', '#245acc')
    window.dispatchEvent(new Event(ZYRA_THEME_CHANGED_EVENT))
    await until(() => frame.srcdoc !== oldSource)
    assert(frame.srcdoc.includes('--viz-bg:#ffffff') && frame.srcdoc.includes('--viz-text:#18212b'), 'current theme reaches an existing preview')
    assert(frame.srcdoc.includes('#e76f51'), 'explicit authored colors remain intact')
    const exported = buildVisualizationDocument('<h2>Saved</h2><script>alert(1)</script>', 'Export <safe>', DEFAULT_VISUALIZATION_THEME)
    assert(exported.includes('Export &lt;safe&gt;') && !exported.includes('<script>'), 'saved HTML is sanitized and has the same CSP')
    assert(exported.includes('padding:16px;background:var(--viz-bg)'), 'saved documents retain a standalone page background')
    const cacheBefore = getVisualizationDocumentCacheStats()
    const recolored = buildVisualizationDocument(body + '\n', 'A different title', { ...DEFAULT_VISUALIZATION_THEME, accent: '#ff8800' })
    const cacheAfter = getVisualizationDocumentCacheStats()
    assert(cacheAfter.hits === cacheBefore.hits + 1 && cacheAfter.misses === cacheBefore.misses, 'theme/title/export changes reuse immutable sanitized HTML')
    assert(recolored.includes('A different title') && recolored.includes('--viz-accent:#ff8800') && !recolored.includes('<script>'), 'cached content keeps current title/theme and security filtering')
    for (let i = 0; i < 60; i++) buildVisualizationDocument(`<p>Eviction ${i}</p>`, 'Eviction', DEFAULT_VISUALIZATION_THEME)
    assert(getVisualizationDocumentCacheStats().entries <= 48, 'cache entry count is bounded')
    for (let i = 0; i < 24; i++) buildVisualizationDocument(`<p>${i}:${'x'.repeat(48000)}</p>`, 'Byte budget', DEFAULT_VISUALIZATION_THEME)
    assert(getVisualizationDocumentCacheStats().bytes <= 2 * 1024 * 1024, 'raw keys plus sanitized values respect the byte budget')
    const evictedBefore = getVisualizationDocumentCacheStats()
    buildVisualizationDocument(body + '\n', 'Rebuilt safely', DEFAULT_VISUALIZATION_THEME)
    assert(getVisualizationDocumentCacheStats().misses === evictedBefore.misses + 1, 'evicted content is sanitized again rather than reused unsafely')
    render(opening + body, false)
    assert(document.body.textContent?.includes('Visualization incomplete.'), 'stopped generation does not spin forever')
    assert(!document.querySelector('iframe'), 'incomplete historical content cannot render')
    render('```html\n' + opening + '<b>Example</b>\n</visualization>\n```', false)
    assert(!document.querySelector('figure'), 'fenced examples remain literal')
    render(opening + '<h2>Back in an existing thread</h2>\n</visualization>', false)
    await until(() => document.querySelector('iframe')?.srcdoc.includes('Back in an existing thread'))
    document.querySelector('iframe')!.loading = 'eager'
    await wait(120)
    assert(unexpectedWindows === 0, 'browser menus and source dialogs never open native companion windows')
    window.open = originalOpen
    return [...(location.protocol === 'chrome-extension:' ? ['real browser adapter uses in-page controls; no native companion windows', 'extension settings destinations, quota, errors, keyboard and bridged font loading'] : []), 'stable initial preview height and bounded immutable sanitization cache', 'unboxed fixed-height preview and two-action keyboard menu', 'streaming and cancellation', 'sandbox, sanitizer, network policy and SVG/CSS', 'theme updates and authored colors', 'copy and download safe export document', 'fenced examples and historical messages']
})()

;(window as any).visualizationShowcase = async (mode: 'dark' | 'light') => {
    document.body.classList.toggle('light', mode === 'light')
    const colors = mode === 'light' ? ['#f6f7f9', '#ffffff', '#20242b', '#626974', '#386fdb', '#e4e6eb', '#edf0f4'] : ['#101318', '#181c22', '#eef1f6', '#a8b0bd', '#568cff', '#343b46', '#2b323d']
    ;['--color-bg', '--color-card', '--color-text', '--color-text-muted', '--accent-primary', '--surface-divider', '--surface-hover'].forEach((name, index) => document.documentElement.style.setProperty(name, colors[index]))
    render('Here is how the stages compare.\n<visualization title="Time by stage" summary="Illustrative values: research 3 hours, build 5 hours, verify 2 hours." height="230">\n<svg viewBox="0 0 600 210" width="600" role="img" aria-label="Illustrative hours by stage"><g fill="var(--viz-text)" font-size="14"><text x="0" y="36">Research</text><text x="0" y="96">Build</text><text x="0" y="156">Verify</text></g><g fill="var(--viz-accent)"><rect x="100" y="15" width="240" height="30" rx="3"/><rect x="100" y="75" width="400" height="30" rx="3"/><rect x="100" y="135" width="160" height="30" rx="3"/></g><g fill="var(--viz-text)" font-size="14"><text x="350" y="36">3 h</text><text x="510" y="96">5 h</text><text x="270" y="156">2 h</text></g></svg>\n</visualization>\nBuild takes the longest in this example.', false)
    await until(() => document.querySelector('iframe')?.srcdoc.includes('Illustrative hours') && document.querySelector('iframe')?.srcdoc.includes('--viz-bg:' + colors[0]))
    document.querySelector('iframe')!.loading = 'eager'
    await wait(250)
}
