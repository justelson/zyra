import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import { PreviewCodeSelection } from '../../src/renderer/src/components/ui/file-preview/PreviewCodeSelection'
import { codeRevision, subscribeCodeContext } from '../../src/renderer/src/pages/assistant/assistant-code-context'

const w = window as any
const sleep = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function waitFor(test: () => unknown, label: string) {
    for (let n = 0; n < 160; n++) { if (test()) return; await sleep() }
    throw new Error(label)
}
async function click(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const request = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, done: false }
    w.__pointer = request
    await waitFor(() => request.done, 'Hidden Electron delivered real action click')
}

w.__selectionUICheck = (async () => {
    w.__fixtureSnapshot = { selectedSessionId: 'original-chat', sessions: [] }
    const path = 'C:/fixture/project/selected.ts'
    const content = 'header\nconst alpha = 1;\nconst beta = 2;\nfooter\nline five\nline six\nline seven\nline eight\nline nine'
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;width:200px;height:200px;left:0;top:0'
    document.body.append(host)
    // Real Monaco model, viewport, cursor selections and scrolled positions. No geometry overrides.
    const model = monaco.editor.createModel(content, 'plaintext')
    const editor = monaco.editor.create(host, { model, automaticLayout: false, minimap: { enabled: false }, lineNumbers: 'off', glyphMargin: false, folding: false, lineDecorationsWidth: 0, lineNumbersMinChars: 0, fontSize: 13, lineHeight: 20, scrollBeyondLastLine: false, wordWrap: 'off', theme: 'vs-dark' })
    const root = createRoot(document.getElementById('root')!)
    flushSync(() => root.render(<PreviewCodeSelection editor={editor} filePath={path} workspaceRoot="C:/fixture/project" />))
    const results: string[] = []
    const received: any[] = [], wrongChat: any[] = []
    const unsubscribe = subscribeCodeContext('original-chat', file => received.push(file))
    const unsubscribeWrong = subscribeCodeContext('other-chat', file => wrongChat.push(file))
    try {
        await sleep(100)
        for (const width of [160, 200, 240]) for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
            const right = corner.endsWith('right'), bottom = corner.startsWith('bottom')
            host.style.width = `${width}px`
            host.style.left = `${right ? innerWidth - width : 0}px`
            host.style.top = `${bottom ? innerHeight - 200 : 0}px`
            editor.layout({ width, height: 200 })
            // Top cases force below-anchor placement; bottom cases exercise above-anchor placement.
            const line = bottom ? 8 : 1
            editor.setSelection(new monaco.Selection(line, 1, line + 1, 1))
            // Cursor updates dismiss the old portal and debounce the next one by 250ms.
            // Do not inspect a stale toolbar from the previous corner before React commits.
            await sleep(320)
            await waitFor(() => document.querySelector('[data-code-selection]'), `${width} ${corner}: toolbar appeared`)
            await sleep(50)
            const toolbar = document.querySelector<HTMLElement>('[data-code-selection]')!
            const rect = toolbar.getBoundingClientRect(), style = getComputedStyle(toolbar)
            check(style.flexWrap === 'nowrap' && style.whiteSpace === 'nowrap', `${width} ${corner}: no-wrap toolbar`)
            check(rect.height <= 48 && rect.width > 130 && rect.width < 310, `${width} ${corner}: compact real toolbar ${rect.width}x${rect.height}`)
            check(rect.left >= 7.5 && rect.top >= 7.5 && rect.right <= innerWidth - 7.5 && rect.bottom <= innerHeight - 7.5, `${width} ${corner}: measured portal stays clamped to viewport ${JSON.stringify(rect.toJSON())}`)
            const label = toolbar.querySelector('span')!.getBoundingClientRect()
            const button = toolbar.querySelector('button')!.getBoundingClientRect()
            check(button.left >= label.right && Math.abs(button.top + button.height / 2 - label.top - label.height / 2) <= 1, `${width} ${corner}: labels remain on one row`)
            check(toolbar.parentElement && getComputedStyle(toolbar.parentElement).visibility === 'visible', 'Real Monaco visible position reveals toolbar')
            results.push(`real Monaco ${width}px ${corner}: compact no-wrap portal and viewport clamping`)
        }
        editor.setSelection(new monaco.Selection(2, 1, 4, 1))
        const selected = 'const alpha = 1;\nconst beta = 2;\n'
        await waitFor(() => document.querySelector('[data-code-selection]')?.textContent?.includes('Lines 2–3'), 'Exact multiline selection rendered')
        let releaseRead: ((value: unknown) => void) | undefined
        let textAtRead = ''
        w.devscope = { readFileContent: (filePath: string) => {
            check(filePath === path, 'Transport receives exact source path')
            textAtRead = model.getValueInRange(editor.getSelection()!)
            return new Promise(resolve => { releaseRead = resolve })
        } }
        await click(document.querySelector<HTMLButtonElement>('[data-code-selection] button')!)
        await waitFor(() => releaseRead, 'Action began async revision check')
        check(textAtRead === selected && model.getValueInRange(editor.getSelection()!) === selected, 'Native pointer action preserves Monaco selected text')
        w.__fixtureSnapshot.selectedSessionId = 'other-chat'
        releaseRead!({ success: true, truncated: false, content: content + '\nchanged on disk' })
        await waitFor(() => received.length === 1, 'Context attaches to original chat after selected chat changes')
        const file = received[0], selection = file.selection
        check(wrongChat.length === 0, 'No context delivered to later selected chat')
        check(file.path === path && selection.filePath === path && selection.workspaceRoot === 'C:/fixture/project', 'Exact path and workspace captured')
        check(selection.startLine === 2 && selection.endLine === 3 && selection.text === selected && selection.side === 'file', 'Exact selected lines and newline-preserved text captured')
        check(selection.sourceRevision === codeRevision(content) && selection.stale === true, 'Original model revision retained; changed disk source marked stale')
        check(file.content.includes(selected) && file.content.includes('Lines: 2–3'), 'Serialized context retains exact code snapshot')
        results.push('native action preserves selected text; actual context pipeline captures exact path/lines/text/revision and original target chat across deferred disk read')
        return results
    } finally { unsubscribe(); unsubscribeWrong(); root.unmount(); editor.dispose(); model.dispose(); host.remove() }
})()
