import { Globe2 } from 'lucide-react'
import './AssistantAgentUseOverlay.css'

export function AssistantAgentUseOverlay({ application, shortcut = 'Ctrl Alt Esc' }: {
    application: string
    shortcut?: string
}) {
    return (
        <div className="assistant-agent-use-overlay" role="status" aria-label={`Zyra is using ${application}`}>
            <div className="assistant-agent-use-edge" aria-hidden="true">
                <i className="assistant-agent-use-wave assistant-agent-use-wave-top" />
                <i className="assistant-agent-use-wave assistant-agent-use-wave-right" />
                <i className="assistant-agent-use-wave assistant-agent-use-wave-bottom" />
                <i className="assistant-agent-use-wave assistant-agent-use-wave-left" />
            </div>
            <div className="assistant-agent-use-indicator">
                <i className="assistant-agent-use-signal" aria-hidden="true" />
                <span className="assistant-agent-use-app-icon" aria-hidden="true"><Globe2 size={12} strokeWidth={2} /></span>
                <span className="assistant-agent-use-label">Zyra is using <strong>{application}</strong></span>
                <i className="assistant-agent-use-divider" aria-hidden="true" />
                <span className="assistant-agent-use-stop"><span>Stop</span><kbd>{shortcut}</kbd></span>
            </div>
        </div>
    )
}
