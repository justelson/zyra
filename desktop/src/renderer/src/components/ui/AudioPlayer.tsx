import type { ReactNode } from 'react'
import { useMediaPlayback } from './useMediaPlayback'
import MediaPlaybackControls from './MediaPlaybackControls'
import './audio-player.css'

type AudioPlayerProps = {
    src: string
    label: string
    /** Keep the authored target available to Markdown interactions and diagnostics. */
    markdownTarget?: string
    onError?: () => void
    titleControl?: ReactNode
    sourceControl?: ReactNode
}

function AudioPlayerInstance({ src, label, markdownTarget, onError, titleControl, sourceControl }: AudioPlayerProps) {
    const player = useMediaPlayback<HTMLAudioElement>('audio', onError)
    return <span className="audio-player" data-audio-player="" data-media-state={player.error ? 'error' : player.loading ? 'loading' : player.waiting ? 'buffering' : player.playing ? 'playing' : 'paused'} role="group" aria-label={label}>
        <audio ref={player.mediaRef} hidden preload="metadata" src={src} data-custom-audio="" data-markdown-audio-target={markdownTarget} aria-label={label} {...player.events} />
        <MediaPlaybackControls player={player} label={label} kind="audio" titleControl={titleControl} sourceControl={sourceControl} />
    </span>
}

/** A new source owns a new playback intent. Old play promises cannot update its UI. */
export default function AudioPlayer(props: AudioPlayerProps) {
    return <AudioPlayerInstance key={props.src} {...props} />
}
