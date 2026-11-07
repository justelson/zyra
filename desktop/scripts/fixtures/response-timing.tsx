import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StreamingAssistantMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import ResponseTimingPage from '../../src/renderer/src/pages/settings/ResponseTimingSettings'
import { SettingsPageLink } from '../../src/renderer/src/pages/settings/SettingsPageTabs'
import { SettingsPageContainer, SettingsSection } from '../../src/renderer/src/pages/settings/settings-layout'
import type { ResponseTimingRecord } from '../../src/shared/response-timing'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const waitFor = async (condition: () => unknown, message: string) => {
    for (let i = 0; i < 250 && !condition(); i++) await pause(20)
    check(condition(), message)
}
const root = createRoot(document.getElementById('root')!)
const paintReports: unknown[] = []
let copied = ''
let fail = false
let empty = false
let failCopy = false
const row: ResponseTimingRecord = { turnId: 'assistant-turn-ui', startedAt: Date.now(), model: 'gpt-6.1-sol', effort: 'high', outcome: 'completed',
    mainReceivedMs: 2, dispatchMs: 20, acceptedMs: 30, firstEventMs: 100, firstTextMs: 200,
    firstTextReceivedMs: 210, firstDisplayMs: 250, completedMs: 2000, requestCount: 2, retryCount: 1,
    compactionCount: 0, compactionMs: 0, maxStreamingGapMs: 150, stallCount: 1, mainStallMs: 2000, rendererStallMs: 0, maxStallMs: 2000, requests: [] }
const rows = [row, { ...row, turnId: 'assistant-turn-slow', startedAt: row.startedAt - 1000, firstTextReceivedMs: 3010, firstDisplayMs: 8050 },
    { ...row, turnId: 'assistant-turn-running', startedAt: row.startedAt + 1000, outcome: 'running' as const, firstTextReceivedMs: null, firstDisplayMs: null }]
window.zyraDiagnostics = {
    read: async () => fail ? { success: false, error: 'synthetic read error' } : { success: true, records: empty ? [] : rows, storageLimitBytes: 2 * 1024 * 1024 },
    displayed: async input => { paintReports.push(input); return true }
}
window.devscope = { copyToClipboard: async (text: string) => { if (failCopy) return { success: false }; copied = text; return { success: true } } } as any
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
    flushSync(() => root.render(<MemoryRouter initialEntries={['/settings/data/diagnostics']}><Routes>
        <Route path="/settings/data/diagnostics" element={<SettingsPageContainer title="Diagnostics"><SettingsSection title="Response timings" hideHeader><SettingsPageLink to="/settings/data/diagnostics/response-timings" title="Response timings" /></SettingsSection></SettingsPageContainer>} />
        <Route path="/settings/data/diagnostics/response-timings" element={<ResponseTimingPage />} />
    </Routes></MemoryRouter>))
    await pause(100)
    check(document.querySelectorAll('a').length === 1, 'Diagnostics opens with a single timing entry')
    check(!document.body.innerText.includes('Typical first text'), 'Summary is on its own page')
    document.querySelector('a')!.click()
    await waitFor(() => document.body.innerText.includes('Typical first text'), 'Timing summary finishes loading after navigation')
    check(document.body.innerText.includes('Always on'), 'Local diagnostics have no consent toggle')
    check(document.body.innerText.includes('1.61 s') && document.body.innerText.includes('4.15 s'), `Summary shows actual completed medians, separately for receipt and display: ${document.body.innerText}`)
    check(!document.querySelector('[data-timing-turn]') && !document.querySelector('select'), 'Individual turns and sorting stay out of the initial summary')
    check(!document.querySelector('.zyra-settings-row p'), 'Summary settings have single-line rows without description paragraphs')
    for (const node of document.querySelectorAll<HTMLElement>('.zyra-settings-row')) check(node.getBoundingClientRect().height <= 58, 'Summary rows retain compact geometry at the current width')
    document.querySelector<HTMLButtonElement>('[aria-label="About Local diagnostics"]')!.click(); await pause(40)
    check(document.querySelector('[role="tooltip"]')?.textContent?.includes('credentials'), 'Explanation is available in an info tip')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(40)
    click('View turns'); await pause(80)
    check(document.querySelectorAll('[data-timing-turn]').length === 3, 'History contains every retained record')
    check(document.querySelector('[data-timing-turn]')?.getAttribute('data-timing-turn') === 'assistant-turn-running', 'History defaults to newest first')
    const sort = document.querySelector<HTMLSelectElement>('select[aria-label="Sort turns"]')!
    sort.value = 'first-text'; sort.dispatchEvent(new Event('change', { bubbles: true })); await pause(50)
    check(document.querySelector('[data-timing-turn]')?.getAttribute('data-timing-turn') === 'assistant-turn-slow', 'Optional sorting orders the actual history')
    check(document.body.innerText.includes('210 ms') && document.body.innerText.includes('250 ms'), 'Receipt and display remain distinct')
    document.querySelector<HTMLButtonElement>('[data-timing-turn="assistant-turn-ui"] button')!.click(); await pause(80)
    check(document.body.innerText.includes('First provider event'), 'Details show the measured stages')
    failCopy = true; click('Copy record'); await pause(40)
    check(document.body.innerText.includes('could not be copied'), 'Copy errors are visible within the details dialog')
    failCopy = false
    click('Copy record'); await pause(50)
    check(JSON.parse(copied).turnId === row.turnId, 'Copy uses actual local timing record')
    check(!document.body.innerText.includes('could not be copied'), 'Successful retry clears the copy error')
    click('Back to history'); await pause(40)
    check(document.querySelector('select')?.value === 'first-text', 'Returning from details preserves the chosen history order')
    click('Close'); await pause(50)
    click('Copy timings'); await pause(50)
    check(JSON.parse(copied).length === 3, 'Summary copy retains all raw records, regardless of the selected history sort')
    fail = true; click('Refresh'); await pause(80)
    check(document.body.innerText.includes('could not be loaded'), 'Read failures are visible')
    check(document.body.innerText.includes('1.61 s'), 'Refresh failure preserves previous summary results')
    fail = false; click('Refresh'); await pause(80)
    check(!document.body.innerText.includes('could not be loaded'), 'Refresh recovers')
    empty = true; click('Refresh'); await pause(80)
    check(document.body.innerText.includes('New chat timings'), 'Empty state is honest')
    check(![...document.querySelectorAll('button')].some(button => button.textContent === 'View turns'), 'Empty history is not offered')
    empty = false; click('Refresh'); await pause(80)
    document.querySelector<HTMLAnchorElement>('a')!.click(); await pause(80)
    check(!document.body.innerText.includes('Typical first text'), 'Back navigation returns to the compact diagnostics entry')
    document.querySelector<HTMLAnchorElement>('a')!.click()
    await waitFor(() => document.body.innerText.includes('Typical first text'), 'Timing summary reloads after back navigation')
    check(document.documentElement.scrollWidth <= window.innerWidth, 'Summary does not overflow the viewport')
    return ['hidden/revealed text, first paint only and token updates', 'compact entry, dedicated summary, optional history/sorting, info tips, details/export and recovery']
})()
