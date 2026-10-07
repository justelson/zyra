import { ensureAppearanceFontLoaded, forgetAppearanceManagedFont } from '../../src/renderer/src/lib/appearance-font-runtime'
import { getAppearanceFontResource } from '../../src/renderer/src/lib/appearance-font-faces'
import { getAppearanceManagedFontAlias, getAppearanceUiFontStack, type AppearanceUiFont } from '../../src/renderer/src/lib/settings'

export function installVisualizationFontChecks(render: (content: string, streaming: boolean) => void, until: (predicate: () => unknown) => Promise<void>, waitForFrame: (frame: HTMLIFrameElement) => Promise<void>) {
    const previousFont = document.body.style.fontFamily
    const previousBridge = window.devscope
    let managedReads = 0
    let exported = ''
    let bytes: Uint8Array | undefined
    ;(window as any).visualizationFontCase = async (font: AppearanceUiFont) => {
        const family = getAppearanceUiFontStack(font)
        document.body.style.fontFamily = family
        const parentSample = document.getElementById('font-parent-sample') ?? document.body.appendChild(document.createElement('p'))
        parentSample.id = 'font-parent-sample'
        parentSample.textContent = 'Visualization WWW iii 0123456789'
        const alias = getAppearanceManagedFontAlias('visualization-fixture')
        const content = `<visualization title="App font" summary="App font inheritance and an explicit serif override." height="160">\n<style>@font-face{font-family:"Authored Forbidden";src:url(https://visualization-test.invalid/font.woff2)}@media(min-width:0px){@font-face{font-family:"Nested Forbidden";src:url(data:font/woff2;base64,AA==)}}#font-explicit{font-family:serif}</style><p id="font-default">Visualization WWW iii 0123456789</p><p id="font-explicit">Visualization WWW iii 0123456789</p><svg viewBox="0 0 400 30"><text id="font-svg" x="0" y="20" fill="var(--viz-text)">Visualization WWW iii 0123456789</text></svg>\n</visualization>`
        render(content, false) // Mount before font completion to prove late loads update existing previews.
        ;(window as any).devscope = { ...previousBridge, copyToClipboard: async (value: string) => { exported = value; return { success: true } } }
        if (font.startsWith('managed:')) {
            bytes ??= new Uint8Array(await (await fetch('./font.woff2')).arrayBuffer())
            ;(window as any).devscope.fonts = { ...previousBridge?.fonts,
                readManaged: async () => { managedReads++; return { success: true, faces: [{ data: bytes, style: 'normal', weight: '200 800', format: 'woff2' }] } }
            }
        }
        await Promise.all([ensureAppearanceFontLoaded(font), ensureAppearanceFontLoaded(font)])
        const resource = getAppearanceFontResource(document, family)
        if (!resource) throw new Error('The selected appearance font must have a trusted resource')
        await until(() => document.querySelector('iframe'))
        const frame = document.querySelector('iframe')!
        await waitForFrame(frame)
        const button = document.querySelector('[aria-label="Options for App font"]') as HTMLButtonElement
        button.click()
        await until(() => document.querySelector('[role="menuitem"]'))
        ;(document.querySelector('[role="menuitem"]') as HTMLButtonElement).click()
        await until(() => exported.includes(resource.css))
        if (/Authored Forbidden|Nested Forbidden/.test(exported)) throw new Error('Authored font-loading rules must be removed, including nested rules')
        if (!exported.includes('font-src data:') || !exported.includes("connect-src 'none'")) throw new Error('Only trusted data fonts are allowed')
        if (!exported.includes('font-family: serif') || !exported.includes("script-src 'none'")) throw new Error('Export must preserve explicit family choices and script blocking')
        if (font !== 'managed:visualization-fixture' && exported.includes(alias)) throw new Error('Inactive managed fonts must not be embedded')
        if (font !== 'bricolage' && exported.includes('font-family:"Bricolage Grotesque"')) throw new Error('Inactive built-in fonts must not be embedded')
        if (font === 'managed:visualization-fixture' && managedReads !== 1) throw new Error('Concurrent font loads and previews must share one bridge read')
        return { family, managedReads }
    }
    ;(window as any).visualizationFontExport = async () => {
        const frame = document.querySelector('iframe')!
        await new Promise<void>(resolve => {
            frame.addEventListener('load', () => resolve(), { once: true })
            frame.srcdoc = exported
        })
    }
    ;(window as any).visualizationFontCleanup = () => {
        window.devscope = previousBridge
        document.body.style.fontFamily = previousFont
        document.getElementById('font-parent-sample')?.remove()
        forgetAppearanceManagedFont('visualization-fixture')
        exported = ''
        bytes = undefined
    }
}
