import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Expand, LoaderCircle, Minimize, Play, RotateCcw, VideoOff } from 'lucide-react'
import { useMediaPlayback } from './useMediaPlayback'
import MediaPlaybackControls from './MediaPlaybackControls'
import { readMarkdownMediaGeometry, rememberMarkdownMediaGeometry } from './markdown/markdown-media-geometry'
import './audio-player.css'
import './video-player.css'

type VideoPlayerProps = { src: string; label: string; markdownTarget?: string; sourceControl?: ReactNode }

function VideoPlayerInstance({ src, label, markdownTarget, sourceControl }: VideoPlayerProps) {
    const player = useMediaPlayback<HTMLVideoElement>('video')
    const rootRef = useRef<HTMLSpanElement>(null)
    const [geometry, setGeometry] = useState(() => readMarkdownMediaGeometry(src))
    const [fullscreen, setFullscreen] = useState(false)
    const [fullscreenError, setFullscreenError] = useState<string | null>(null)
    useEffect(() => {
        const document = rootRef.current?.ownerDocument
        if (!document) return
        const sync = () => setFullscreen(document.fullscreenElement === rootRef.current)
        document.addEventListener('fullscreenchange', sync)
        return () => document.removeEventListener('fullscreenchange', sync)
    }, [])
    const toggleFullscreen = async () => {
        const root = rootRef.current
        if (!root) return
        setFullscreenError(null)
        try {
            if (root.ownerDocument.fullscreenElement === root) await root.ownerDocument.exitFullscreen()
            else await root.requestFullscreen()
        } catch { setFullscreenError("Couldn't change fullscreen. Try again.") }
    }
    const state = player.error ? 'error' : player.loading ? 'loading' : player.waiting ? 'buffering' : player.playing ? 'playing' : 'paused'
    return <span ref={rootRef} className="video-player" data-video-player="" data-media-state={state} role="group" aria-label={label}>
        <span className="video-player-stage" style={{ aspectRatio: geometry ? `${geometry.width} / ${geometry.height}` : '16 / 9' }}>
            <video ref={player.mediaRef} src={src} width={geometry?.width} height={geometry?.height} preload="metadata" playsInline data-custom-video="" data-markdown-video-target={markdownTarget}
                aria-label={label} {...player.events} onLoadedMetadata={event => {
                    player.events.onLoadedMetadata(event)
                    const { videoWidth: width, videoHeight: height } = event.currentTarget
                    rememberMarkdownMediaGeometry(src, width, height)
                    if (width > 0 && height > 0) setGeometry({ width, height })
                }} onClick={() => { if (!player.error) void player.togglePlayback() }} />
            {!player.error && !player.loading ? <button type="button" className="video-player-fullscreen" data-video-action="fullscreen"
                aria-label={`${fullscreen ? 'Exit' : 'Enter'} fullscreen for ${label}`} onClick={() => { void toggleFullscreen() }}>
                {fullscreen ? <Minimize size={17} aria-hidden="true" /> : <Expand size={17} aria-hidden="true" />}
            </button> : null}
            {player.error ? <span className="video-player-status" role="alert">
                <VideoOff size={24} strokeWidth={1.5} aria-hidden="true" />
                <span>{player.error}</span>
                <span className="video-player-recovery">
                    <button type="button" onClick={player.retry} aria-label={`Retry ${label}`}><RotateCcw size={13} aria-hidden="true" />Try again</button>
                    {sourceControl}
                </span>
            </span> : player.loading || player.waiting ? <span className="video-player-status" role="status">
                <LoaderCircle size={23} className="audio-player-spinner" aria-hidden="true" />
                <span>{player.waiting ? 'Buffering…' : 'Loading video…'}</span>
            </span> : !player.playing ? <button type="button" className="video-player-center-play" aria-label={`Play ${label}`} onClick={() => { void player.togglePlayback() }}>
                <Play size={25} fill="currentColor" aria-hidden="true" />
            </button> : null}
        </span>
        <span className="audio-player video-player-controls">
            <MediaPlaybackControls player={player} kind="video" label={label} showError={false} />
        </span>
        {fullscreenError ? <span className="video-player-fullscreen-error" role="status">{fullscreenError}</span> : null}
    </span>
}

export default function VideoPlayer(props: VideoPlayerProps) {
    return <VideoPlayerInstance key={props.src} {...props} />
}
