import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { formatAudioTime } from './audio-player-time'
import './audio-player.css'

type AudioPlayerProps = {
    src: string
    label: string
    /** Keep the authored target available to Markdown interactions and diagnostics. */
    markdownTarget?: string
    onError?: () => void
    titleControl?: ReactNode
}

const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75]

function AudioPlayerInstance({ src, label, markdownTarget, onError, titleControl }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const seekRef = useRef<HTMLInputElement>(null)
    const clockSecondRef = useRef(0)
    const intentRef = useRef(0)
    const pendingRef = useRef(false)
    const [playing, setPlaying] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const [duration, setDuration] = useState(0)
    const [position, setPosition] = useState(0)
    const [muted, setMuted] = useState(false)
    const [rate, setRate] = useState(1)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const audio = audioRef.current
        return () => {
            intentRef.current += 1
            pendingRef.current = false
            audio?.pause()
        }
    }, [])

    const paintPosition = useCallback((audio: HTMLAudioElement) => {
        const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
        const time = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0
        const range = seekRef.current
        if (range) {
            range.value = String(Math.min(time, total))
            range.style.setProperty('--audio-progress', `${total ? Math.min(100, time / total * 100) : 0}%`)
        }
        const second = Math.floor(time)
        if (second !== clockSecondRef.current) { clockSecondRef.current = second; setPosition(second) }
    }, [])
    const syncTime = (audio: HTMLAudioElement) => {
        setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0)
        paintPosition(audio)
    }
    useEffect(() => {
        const audio = audioRef.current
        const view = audio?.ownerDocument.defaultView
        if (!playing || !audio || !view) return
        let frame = 0
        const paint = () => {
            paintPosition(audio)
            if (!audio.paused && !audio.ended) frame = view.requestAnimationFrame(paint)
        }
        frame = view.requestAnimationFrame(paint)
        return () => view.cancelAnimationFrame(frame)
    }, [playing, paintPosition])
    const resetPlayback = () => {
        intentRef.current += 1
        pendingRef.current = false
        setPlaying(false)
        setWaiting(false)
    }
    const togglePlayback = async () => {
        const audio = audioRef.current
        if (!audio) return
        if (!audio.paused || pendingRef.current) {
            intentRef.current += 1
            pendingRef.current = false
            audio.pause()
            resetPlayback()
            return
        }
        const intent = ++intentRef.current
        pendingRef.current = true
        setWaiting(true)
        setError(null)
        if (audio.error) audio.load()
        try {
            await audio.play()
            if (intent !== intentRef.current) return
            pendingRef.current = false
            setWaiting(false)
        } catch {
            if (intent !== intentRef.current) return
            resetPlayback()
            setError("Couldn't play audio. Try again.")
        }
    }
    const active = playing || waiting

    return (
        <span className="audio-player" data-audio-player="" role="group" aria-label={label}>
            <audio
                ref={audioRef}
                hidden
                preload="metadata"
                src={src}
                data-custom-audio=""
                data-markdown-audio-target={markdownTarget}
                aria-label={label}
                onLoadedMetadata={event => syncTime(event.currentTarget)}
                onDurationChange={event => syncTime(event.currentTarget)}
                onTimeUpdate={event => syncTime(event.currentTarget)}
                onPlay={event => {
                    for (const other of event.currentTarget.ownerDocument.querySelectorAll<HTMLAudioElement>('audio[data-custom-audio]')) {
                        if (other !== event.currentTarget) other.pause()
                    }
                    setPlaying(true)
                }}
                onPlaying={() => { pendingRef.current = false; setWaiting(false); setPlaying(true) }}
                onWaiting={event => { if (!event.currentTarget.paused) setWaiting(true) }}
                onPause={event => { if (event.currentTarget.paused) { syncTime(event.currentTarget); resetPlayback() } }}
                onEnded={event => { syncTime(event.currentTarget); resetPlayback() }}
                onVolumeChange={event => setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
                onRateChange={event => setRate(event.currentTarget.playbackRate)}
                onEmptied={() => { setDuration(0); setPosition(0); resetPlayback() }}
                onError={() => { resetPlayback(); setError('Audio unavailable.'); onError?.() }}
            />
            <button type="button" className="audio-player-toggle" data-audio-action="play" aria-label={`${active ? 'Pause' : 'Play'} ${label}`} onClick={() => { void togglePlayback() }}>
                {waiting ? <LoaderCircle size={16} className="audio-player-spinner" aria-hidden="true" /> : playing ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
            </button>
            <span className="audio-player-track">
                <span className="audio-player-heading">
                    <span className="audio-player-title" title={label}>{titleControl || label}</span>
                    <span className="audio-player-time" aria-live="off">{formatAudioTime(position)} <span>/ {duration ? formatAudioTime(duration) : '--:--'}</span></span>
                </span>
                <input
                    ref={seekRef}
                    className="audio-player-seek"
                    type="range"
                    aria-label={`Seek ${label}`}
                    aria-valuetext={`${formatAudioTime(position)} of ${duration ? formatAudioTime(duration) : 'unknown duration'}`}
                    min={0}
                    max={duration || 1}
                    step="any"
                    defaultValue={0}
                    disabled={!duration}
                    style={{ '--audio-progress': '0%' } as CSSProperties}
                    onChange={event => {
                        const next = event.currentTarget.valueAsNumber
                        if (!audioRef.current || !Number.isFinite(next) || !duration) return
                        try { audioRef.current.currentTime = Math.max(0, Math.min(duration, next)); paintPosition(audioRef.current) }
                        catch { setError("Couldn't seek in this audio.") }
                    }}
                />
            </span>
            <button type="button" className="audio-player-tool audio-player-speed" data-audio-action="speed" title="Playback speed" aria-label={`Playback speed for ${label}: ${rate}x`} onClick={() => {
                const audio = audioRef.current
                if (audio) audio.playbackRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(audio.playbackRate) + 1) % PLAYBACK_RATES.length]
            }}>{rate}x</button>
            <button type="button" className="audio-player-tool" data-audio-action="mute" aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`} aria-pressed={muted} onClick={() => {
                const audio = audioRef.current
                if (!audio) return
                const wasMuted = audio.muted || audio.volume === 0
                if (wasMuted && audio.volume === 0) audio.volume = 1
                audio.muted = !wasMuted
            }}>{muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}</button>
            {error ? <span className="audio-player-error" role="alert">{error}<button type="button" aria-label={`Retry ${label}`} onClick={() => {
                intentRef.current += 1
                setError(null)
                audioRef.current?.load()
            }}><RotateCcw size={12} aria-hidden="true" />Retry</button></span> : null}
        </span>
    )
}

/** A new source owns a new playback intent. Old play promises cannot update its UI. */
export default function AudioPlayer(props: AudioPlayerProps) {
    return <AudioPlayerInstance key={props.src} {...props} />
}
