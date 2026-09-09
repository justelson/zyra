import type { PluginDownloadState } from './plugin-download-controller'

function size(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

export function PluginDownloadPanel({ state, displayName, onCancel, onRetry }: {
    state: PluginDownloadState
    displayName?: string
    onCancel: () => void
    onRetry: () => void
}) {
    if (!state.name || ['idle', 'ready', 'installing'].includes(state.phase)) return null
    const progress = state.download?.progress
    const downloading = state.phase === 'preparing' && progress?.phase === 'downloading'
    const label = state.phase === 'failed' ? state.error || 'Could not prepare this Plugin.'
        : state.phase === 'cancelling' ? 'Cancelling…'
        : progress?.phase === 'inspecting' ? 'Checking this release…'
        : downloading && progress.totalFiles ? `Downloading and verifying ${progress.completedFiles} of ${progress.totalFiles} files`
        : 'Finding this release…'
    return <section className="plugin-install-job" aria-label={`Install ${displayName || state.name}`}>
        <div className="plugin-install-job-heading">
            <h2>{displayName || state.name}</h2>
            <div className="plugin-directory-actions">
                {state.phase === 'failed' ? <button type="button" className="plugin-button" onClick={onRetry}>Retry</button> : null}
                <button type="button" className="plugin-text-button" disabled={state.phase === 'cancelling'} onClick={onCancel}>{state.phase === 'failed' ? 'Dismiss' : 'Cancel'}</button>
            </div>
        </div>
        <p className="plugin-description" role={state.phase === 'failed' ? 'alert' : 'status'}>{label}</p>
        {state.phase === 'preparing' ? <>
            <progress aria-label="Plugin preparation progress" max={downloading && progress.totalFiles ? progress.totalFiles : undefined} value={downloading && progress.totalFiles ? progress.completedFiles : undefined} />
            {downloading && progress ? <p className="plugin-meta">{size(progress.completedBytes)} / {size(progress.totalBytes)}{progress.cacheHits ? ` · ${progress.cacheHits} files reused` : ''}</p> : null}
        </> : null}
    </section>
}
