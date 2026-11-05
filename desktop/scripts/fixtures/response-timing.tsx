import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter } from 'react-router-dom'
import { StreamingAssistantMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import { ResponseTimingSettings } from '../../src/renderer/src/pages/settings/ResponseTimingSettings'
import type { ResponseTimingRecord } from '../../src/shared/response-timing'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const root = createRoot(document.getElementById('root')!)
const paintReports: unknown[] = []
let copied = ''
let fail = false
const row: ResponseTimingRecord = { turnId: 'assistant-turn-ui', startedAt: Date.now(), model: 'gpt-6.1-sol', effort: 'high', outcome: 'completed',
    mainReceivedMs: 2, dispatchMs: 20, acceptedMs: 30, firstEventMs: 100, firstTextMs: 200,
    firstTextReceivedMs: 210, firstDisplayMs: 250, completedMs: 2000, requestCount: 2, retryCount: 1,
    compactionCount: 0, compactionMs: 0, maxStreamingGapMs: 150, stallCount: 1, mainStallMs: 2000, rendererStallMs: 0, maxStallMs: 2000, requests: [] }
window.zyraDiagnostics = {
    read: async () => fail ? { success: false, error: 'synthetic read error' } : { success: true, records: [row], storageLimitBytes: 2 * 1024 * 1024 },
    displayed: async input => { paintReports.push(input); return true }
}
window.devscope = { copyToClipboard: async (text: string) => { copied = text; return { success: true } } } as any
const renderText = (visible: boolean, content = 'Visible response text.', clipped = false) => flushSync(() => root.render(<div style={{ display: visible ? 'block' : 'none', ...(clipped ? { overflow: 'hidden', height: 0 } : {}) }}>
    <StreamingAssistantMarkdown content={content} cacheKey="timing-ui" turnId="assistant-turn-ui" />
</div>))
const click = (label: string) => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
    check(button, `Missing button: ${label}`)
    button!.click()
}
;(window as any).responseTimingCheck = (async () => {
    check(document.visibilityState === 'visible', 'Offscreen test must provide actual visible-page lifecycle')
    renderText(false)
    await pause(300)
    check(!paintReports.length, 'Hidden text cannot be acknowledged')
    renderText(true, 'Visible response text.', true)
    await pause(100)
    check(!paintReports.length, 'Text clipped inside a disclosure cannot be acknowledged')
    renderText(true)
    window.dispatchEvent(new Event('scroll'))
    for (let i = 0; i < 50 && !paintReports.length; i++) await pause(20)
    check(paintReports.length === 1, 'Visible rendered text must be acknowledged once')
    renderText(true, 'Visible response text. More tokens.')
    await pause(100)
    check(paintReports.length === 1, 'More tokens do not generate more paint events')
    flushSync(() => root.render(<MemoryRouter><ResponseTimingSettings /></MemoryRouter>))
    await pause(150)
    check(document.body.innerText.includes('Always on'), 'Local diagnostics have no consent toggle')
    check(document.body.innerText.includes('gpt-6.1-sol'), 'Stored model timing renders')
    check(document.body.innerText.includes('210 ms') && document.body.innerText.includes('250 ms'), 'Receipt and display remain distinct')
    click('Details'); await pause(100)
    check(document.body.innerText.includes('First provider event'), 'Details show the measured stages')
    click('Copy record'); await pause(50)
    check(JSON.parse(copied).turnId === row.turnId, 'Copy uses actual local timing record')
    click('Close'); await pause(50)
    fail = true; click('Refresh'); await pause(80)
    check(document.body.innerText.includes('could not be loaded'), 'Read failures are visible')
    check(document.body.innerText.includes('gpt-6.1-sol'), 'Refresh failure preserves previous results')
    fail = false; click('Refresh'); await pause(80)
    check(!document.body.innerText.includes('could not be loaded'), 'Refresh recovers')
    return ['hidden/revealed text, first paint only and token updates', 'actual settings, details, copy, error recovery and local-only controls']
})()
