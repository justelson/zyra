import './AssistantAgentUseOverlay.css'

export function AssistantAgentUseOverlay({ application, shortcut = 'Ctrl+Alt+Esc' }: {
    application: string
    shortcut?: string
}) {
    return (
        <div className="assistant-agent-use-overlay" role="status" aria-label={`Zyra is using ${application}. Press ${shortcut} to stop.`}>
            <div className="assistant-agent-use-edge" aria-hidden="true">
                <i className="assistant-agent-use-wave assistant-agent-use-wave-top" />
                <i className="assistant-agent-use-wave assistant-agent-use-wave-right" />
                <i className="assistant-agent-use-wave assistant-agent-use-wave-bottom" />
                <i className="assistant-agent-use-wave assistant-agent-use-wave-left" />
            </div>
            <div className="assistant-agent-use-indicator">
                <span className="assistant-agent-use-label">
                    <span>Zyra is using</span>
                    <strong>{application}</strong>
                </span>
                <span className="assistant-agent-use-stop">
                    <kbd>{shortcut}</kbd>
                    <span>to stop</span>
                </span>
            </div>
        </div>
    )
}
