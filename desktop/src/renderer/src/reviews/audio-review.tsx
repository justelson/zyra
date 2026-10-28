import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Moon, Sun } from 'lucide-react'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { THEMES } from '@/lib/settings-theme-catalog'
import '@/index.css'

// Only synthetic local audio. No app bridge, personal files, provider or microphone.
function AudioReview() {
    const [light, setLight] = useState(false)
    const params = new URLSearchParams(location.search)
    const [mode, setMode] = useState<'grouped' | 'individual' | 'short'>(params.get('view') === 'short' ? 'short' : params.get('grouped') === '1' ? 'grouped' : 'individual')
    useLayoutEffect(() => {
        const theme = THEMES.find(candidate => candidate.id === (light ? 'light' : 'vercel'))!
        for (const [key, value] of Object.entries(theme.tokens)) {
            document.documentElement.style.setProperty(`--color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value)
        }
        document.documentElement.style.setProperty('--theme-foreground-rgb', light ? '23 23 23' : '237 237 237')
        document.documentElement.style.setProperty('--theme-background-rgb', light ? '255 255 255' : '0 0 0')
        document.body.classList.toggle('light', light)
    }, [light])
    const origin = location.origin
    const content = mode === 'short'
        ? `A short audio clip.\n\n[Short clip](${origin}/__audio-preview__/short.wav)`
        : `Rendered the audio version. Original speed.\n\n[Listen to the MP3](${origin}/__audio-preview__/sample.mp3)\n\n[WAV](${origin}/__audio-preview__/sample.wav)\n\nAudio only.`
    return <div className="flex h-screen flex-col bg-sparkle-bg text-sparkle-text">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-sparkle-border px-5 text-xs text-sparkle-text-dark">
            <span>Audio embeds</span>
            <select aria-label="Preview layout" value={mode} onChange={event => setMode(event.target.value as typeof mode)} className="ml-auto mr-3 rounded border-0 bg-sparkle-card px-2 py-1 text-xs">
                <option value="individual">Two-player test</option><option value="grouped">Message</option><option value="short">Short clip</option>
            </select>
            <button type="button" aria-label={light ? 'Use dark theme' : 'Use light theme'} onClick={() => setLight(value => !value)} className="flex size-7 items-center justify-center rounded hover:bg-white/5">{light ? <Moon size={14} /> : <Sun size={14} />}</button>
        </header>
        <main className="custom-scrollbar flex-1 overflow-y-auto px-5 py-12 sm:px-10">
            <div className="mx-auto w-full max-w-3xl">
                <MarkdownRenderer content={content} mediaMode="images-and-videos" audioPresentation={mode === 'individual' ? 'individual' : 'grouped'} />
            </div>
        </main>
    </div>
}
createRoot(document.getElementById('root')!).render(<AudioReview />)
