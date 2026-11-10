import type { CSSProperties, ReactNode } from 'react'
import { LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { formatAudioTime } from './audio-player-time'
import type { MediaPlayback } from './useMediaPlayback'

export default function MediaPlaybackControls({ player, label, kind, titleControl, sourceControl, showError = true }: {
    player: Omit<MediaPlayback, 'mediaRef' | 'events'>; label: string; kind: 'audio' | 'video'; titleControl?: ReactNode; sourceControl?: ReactNode; showError?: boolean
}) {
    const active = player.playing || player.waiting
    return <>
        <button type="button" className="audio-player-toggle" {...{ [`data-${kind}-action`]: 'play' }} aria-label={`${active ? 'Pause' : 'Play'} ${label}`} onClick={() => { void player.togglePlayback() }}>
            {player.waiting || player.loading ? <LoaderCircle size={16} className="audio-player-spinner" aria-hidden="true" /> : player.playing ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
        </button>
        <span className="audio-player-track">
            <span className="audio-player-heading">
                <span className="audio-player-title" title={label}>{titleControl || label}</span>
                <span className="audio-player-time" aria-live="off">{formatAudioTime(player.position)} <span>/ {player.duration ? formatAudioTime(player.duration) : '--:--'}</span></span>
            </span>
            <input ref={player.seekRef} className="audio-player-seek" type="range" aria-label={`Seek ${label}`}
                aria-valuetext={`${formatAudioTime(player.position)} of ${player.duration ? formatAudioTime(player.duration) : 'unknown duration'}`}
                min={0} max={player.duration || 1} step="any" defaultValue={0} disabled={!player.duration}
                style={{ '--audio-progress': '0%' } as CSSProperties} onChange={event => player.seek(event.currentTarget.valueAsNumber)} />
        </span>
        <button type="button" className="audio-player-tool audio-player-speed" {...{ [`data-${kind}-action`]: 'speed' }} title="Playback speed" aria-label={`Playback speed for ${label}: ${player.rate}x`} onClick={player.cycleRate}>{player.rate}x</button>
        <button type="button" className="audio-player-tool" {...{ [`data-${kind}-action`]: 'mute' }} aria-label={`${player.muted ? 'Unmute' : 'Mute'} ${label}`} aria-pressed={player.muted} onClick={player.toggleMute}>
            {player.muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
        </button>
        {showError && player.error ? <span className="audio-player-error" role="alert">{player.error}
            <button type="button" aria-label={`Retry ${label}`} onClick={player.retry}><RotateCcw size={12} aria-hidden="true" />Retry</button>{sourceControl}
        </span> : null}
    </>
}
