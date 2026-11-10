import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'

const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75]

/** Source-keyed players own playback intent; late promises cannot resume a replacement. */
export function useMediaPlayback<T extends HTMLMediaElement>(kind: 'audio' | 'video', onError?: () => void) {
    const mediaRef = useRef<T>(null)
    const seekRef = useRef<HTMLInputElement>(null)
    const clockSecondRef = useRef(0)
    const intentRef = useRef(0)
    const pendingRef = useRef(false)
    const [playing, setPlaying] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const [loading, setLoading] = useState(true)
    const [duration, setDuration] = useState(0)
    const [position, setPosition] = useState(0)
    const [muted, setMuted] = useState(false)
    const [rate, setRate] = useState(1)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        const media = mediaRef.current
        return () => { intentRef.current++; pendingRef.current = false; media?.pause() }
    }, [])
    const paintPosition = useCallback((media: HTMLMediaElement) => {
        const total = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0
        const time = Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0
        if (seekRef.current) {
            seekRef.current.value = String(Math.min(time, total))
            seekRef.current.style.setProperty('--audio-progress', `${total ? Math.min(100, time / total * 100) : 0}%`)
        }
        const second = Math.floor(time)
        if (second !== clockSecondRef.current) { clockSecondRef.current = second; setPosition(second) }
    }, [])
    const syncTime = (media: HTMLMediaElement) => {
        setDuration(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0)
        paintPosition(media)
    }
    useEffect(() => {
        const media = mediaRef.current, view = media?.ownerDocument.defaultView
        if (!playing || !media || !view) return
        let frame = 0
        const paint = () => { paintPosition(media); if (!media.paused && !media.ended) frame = view.requestAnimationFrame(paint) }
        frame = view.requestAnimationFrame(paint)
        return () => view.cancelAnimationFrame(frame)
    }, [playing, paintPosition])
    const resetPlayback = () => { intentRef.current++; pendingRef.current = false; setPlaying(false); setWaiting(false) }
    const retry = () => { resetPlayback(); setError(null); setLoading(true); mediaRef.current?.load() }
    const togglePlayback = async () => {
        const media = mediaRef.current
        if (!media) return
        if (!media.paused || pendingRef.current) { media.pause(); resetPlayback(); return }
        const intent = ++intentRef.current
        pendingRef.current = true; setWaiting(true); setError(null)
        if (media.error) media.load()
        try {
            await media.play()
            if (intent !== intentRef.current) return
            pendingRef.current = false; setWaiting(false)
        } catch {
            if (intent !== intentRef.current) return
            resetPlayback(); setError(`Couldn't play ${kind}. Try again.`)
        }
    }
    const events = {
        onLoadedMetadata: (event: SyntheticEvent<T>) => { syncTime(event.currentTarget); setLoading(false); setError(null) },
        onDurationChange: (event: SyntheticEvent<T>) => syncTime(event.currentTarget),
        onTimeUpdate: (event: SyntheticEvent<T>) => syncTime(event.currentTarget),
        onPlay: (event: SyntheticEvent<T>) => {
            for (const other of event.currentTarget.ownerDocument.querySelectorAll<HTMLMediaElement>('audio[data-custom-audio],video[data-custom-video]')) {
                if (other !== event.currentTarget) other.pause()
            }
            setPlaying(true)
        },
        onPlaying: () => { pendingRef.current = false; setWaiting(false); setPlaying(true); setLoading(false) },
        onWaiting: (event: SyntheticEvent<T>) => { if (!event.currentTarget.paused) setWaiting(true) },
        onPause: (event: SyntheticEvent<T>) => { if (event.currentTarget.paused) { syncTime(event.currentTarget); resetPlayback() } },
        onEnded: (event: SyntheticEvent<T>) => { syncTime(event.currentTarget); resetPlayback() },
        onVolumeChange: (event: SyntheticEvent<T>) => setMuted(event.currentTarget.muted || event.currentTarget.volume === 0),
        onRateChange: (event: SyntheticEvent<T>) => setRate(event.currentTarget.playbackRate),
        onEmptied: () => {
            clockSecondRef.current = 0
            if (seekRef.current) { seekRef.current.value = '0'; seekRef.current.style.setProperty('--audio-progress', '0%') }
            setDuration(0); setPosition(0); setLoading(true); resetPlayback()
        },
        onError: () => { resetPlayback(); setLoading(false); setError(`${kind === 'audio' ? 'Audio' : 'Video'} unavailable.`); onError?.() }
    }
    const seek = (next: number) => {
        if (!mediaRef.current || !Number.isFinite(next) || !duration) return
        try { mediaRef.current.currentTime = Math.max(0, Math.min(duration, next)); paintPosition(mediaRef.current) }
        catch { setError(`Couldn't seek in this ${kind}.`) }
    }
    const cycleRate = () => {
        const media = mediaRef.current
        if (media) media.playbackRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(media.playbackRate) + 1) % PLAYBACK_RATES.length]!
    }
    const toggleMute = () => {
        const media = mediaRef.current
        if (!media) return
        const wasMuted = media.muted || media.volume === 0
        if (wasMuted && media.volume === 0) media.volume = 1
        media.muted = !wasMuted
    }
    return { mediaRef, seekRef, playing, waiting, loading, duration, position, muted, rate, error,
        events, seek, cycleRate, toggleMute, retry, togglePlayback }
}

export type MediaPlayback = ReturnType<typeof useMediaPlayback>
