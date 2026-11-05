import type { AnalyticsEventInput } from '../../shared/analytics/contracts'

type Incident = { reason: string; processKind: 'main' | 'renderer' | 'other'; webContentsId: number | null; durationMs?: number }
type Dependencies = {
    isIncognitoWebContents: (id: number) => boolean
    hasIncognitoContents: () => boolean
    getMainWebContentsId: () => number | null
    getSelectedThreadId: () => string | null
    correlate: (incident: Incident, threadId: string | null) => void
    capture: (input: AnalyticsEventInput<'zyra_v1_app_lifecycle'>) => void
}

/** Both direct analytics and analytics-bound correlation share this privacy gate.
 * The incident recorder has already kept its independent local evidence. */
export function reportHangIncident(incident: Incident, deps: Dependencies): void {
    if (incident.reason.includes('process-gone')) return
    if (incident.webContentsId !== null && deps.isIncognitoWebContents(incident.webContentsId)) return
    if (deps.hasIncognitoContents()) return
    if (incident.processKind === 'main' || (incident.processKind === 'renderer' && incident.webContentsId === deps.getMainWebContentsId())) {
        deps.correlate(incident, deps.getSelectedThreadId())
    }
    deps.capture({ event: 'zyra_v1_app_lifecycle', properties: {
        action: 'hang', outcome: 'completed', process_kind: incident.processKind,
        ...(incident.durationMs === undefined ? {} : { duration_ms: incident.durationMs })
    } })
}
