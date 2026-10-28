import { createRoot } from 'react-dom/client'
import { VoiceHistorySettings } from '../../src/renderer/src/pages/settings/VoiceHistorySettings'

declare const VOICE_TEST_AUDIO: string[]

const recordings = new Map<string, string>()
const revoked = new Set<string>()
const createUrl = URL.createObjectURL.bind(URL)
const revokeUrl = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => {
    const url = createUrl(blob)
    recordings.set(url, blob.type)
    return url
}
URL.revokeObjectURL = url => { revoked.add(url); revokeUrl(url) }
const requests: string[] = []
const playErrors: string[] = []
const nativePlay = HTMLMediaElement.prototype.play
HTMLMediaElement.prototype.play = function () {
    return nativePlay.call(this).catch(error => { playErrors.push(`${error.name}: ${error.message}`); throw error })
}
let pendingRecording: (() => void) | undefined
let deferRecording = false
const entries = VOICE_TEST_AUDIO.map((_, index) => ({
    id: `recording-${index}`, createdAt: '2026-01-01T00:00:00Z', engine: 'codex' as const,
    status: 'failed' as const, durationMs: index === 1 ? 10 : 2000,
    transcript: null, error: 'Synthetic transcription failure.', hasRecording: true
}))
Object.assign(window, { devscope: { assistant: {
    listVoiceHistory: async () => ({ success: true, entries: entries.slice(), page: 1, pageSize: 20, totalCount: entries.length, totalPages: 1 }),
    getFailedVoiceRecording: async (id: string) => {
        requests.push(id)
        if (deferRecording) await new Promise<void>(resolve => { pendingRecording = resolve })
        return { success: true, audioBase64: VOICE_TEST_AUDIO[Number(id.split('-')[1])] }
    },
    deleteVoiceHistory: async (id: string) => { const index = entries.findIndex(entry => entry.id === id); if (index >= 0) entries.splice(index, 1); return { success: true } }
} } })
const root = createRoot(document.getElementById('root')!)
root.render(<VoiceHistorySettings />)

const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label) }
async function until(predicate: () => boolean, label: string) {
    const deadline = performance.now() + 5000
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error(`Timed out: ${label}; ${JSON.stringify(Array.from(document.querySelectorAll('audio')).map(audio => ({ src: audio.src.slice(0, 40), paused: audio.paused, time: audio.currentTime, duration: audio.duration, ready: audio.readyState, error: audio.error?.message }))) }; alert: ${document.querySelector('[role="alert"]')?.textContent}; play errors: ${playErrors.join('; ')}`)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}
Object.assign(window, { runVoicePlaybackSmoke: async () => {
    await until(() => document.querySelectorAll('article').length === 3, 'history loaded')
    const first = document.querySelector('article')!
    const audio = first.querySelector('audio')!
    audio.muted = true
    const play = () => first.querySelector<HTMLButtonElement>('button[title="Play"],button[title="Pause"]')!.click()
    play()
    await until(() => audio.currentTime > 0.15, 'playback advances')
    check(audio.src.startsWith('blob:'), 'recording uses a CSP-allowed blob URL')
    check(recordings.get(audio.src) === 'audio/wav', 'WAV MIME type retained')
    check(!document.querySelector('[role="alert"]'), 'no playback error')
    await until(() => Boolean(first.querySelector('[aria-label="Pause recording"]')), 'pause control')
    play()
    check(audio.paused, 'pause works')
    const range = first.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '1')
    range.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => !audio.seeking && Math.abs(audio.currentTime - 1) < 0.1, 'seek via custom control')
    play()
    await until(() => audio.ended, 'playback ends')
    await until(() => Boolean(first.querySelector('[aria-label="Play recording"]')), 'play control returns')
    play()
    await until(() => !audio.paused && audio.currentTime > 0.1 && audio.currentTime < 1, 'replay works')
    play()
    check(requests.filter(id => id === 'recording-0').length === 1, 'replay reuses loaded recording')

    const short = document.querySelectorAll('article')[1]
    const shortAudio = short.querySelector('audio')!
    shortAudio.muted = true
    short.querySelector<HTMLButtonElement>('button[title="Play"]')!.click()
    await until(() => shortAudio.ended, 'very short saved recording plays')
    check(Math.abs(shortAudio.duration - 0.01) < 0.001, 'short recording duration decoded')
    const firstUrl = audio.src
    first.querySelector<HTMLButtonElement>('button[title="Delete entry"]')!.click()
    await until(() => Boolean(document.querySelector('[role="dialog"]')), 'delete confirmation')
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === 'Delete entry')!.click()
    await until(() => document.querySelectorAll('article').length === 2, 'entry removed')
    check(revoked.has(firstUrl), 'delete releases recording URL')

    deferRecording = true
    const pending = document.querySelectorAll('article')[1]
    const pendingAudio = pending.querySelector('audio')!
    pendingAudio.muted = true
    pending.querySelector<HTMLButtonElement>('button[title="Play"]')!.click()
    await until(() => Boolean(pendingRecording), 'in-flight recording request')
    root.unmount()
    pendingRecording!()
    await new Promise(resolve => setTimeout(resolve, 60))
    check(shortAudio.paused && pendingAudio.paused, 'leaving history stops playback and late loads')
    check([...recordings.keys()].every(url => revoked.has(url)), 'all object URLs released on unmount')
    return { played: true, paused: true, sought: true, replayed: true, shortRecording: true, cleanedUp: true }
} })
