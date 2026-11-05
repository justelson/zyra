import assert from 'node:assert/strict'
import { reportHangIncident } from '../src/main/diagnostics/hang-analytics'

const cases = [
    { privateTarget: true, anyPrivate: false, kind: 'renderer', id: 2, reports: 0, correlations: 0 },
    { privateTarget: false, anyPrivate: true, kind: 'main', id: null, reports: 0, correlations: 0 },
    { privateTarget: false, anyPrivate: false, kind: 'renderer', id: 2, reports: 1, correlations: 0 },
    { privateTarget: false, anyPrivate: false, kind: 'renderer', id: 1, reports: 1, correlations: 1 },
    { privateTarget: false, anyPrivate: false, kind: 'main', id: null, reports: 1, correlations: 1 }
] as const
for (const scenario of cases) {
    let reports = 0, correlations = 0, contextReads = 0
    reportHangIncident({ reason: 'renderer-unresponsive', processKind: scenario.kind, webContentsId: scenario.id, durationMs: 2100 }, {
        isIncognitoWebContents: () => scenario.privateTarget, hasIncognitoContents: () => scenario.anyPrivate,
        getMainWebContentsId: () => 1,
        getSelectedThreadId: () => { contextReads++; return 'selected-thread' },
        correlate: (incident, threadId) => { assert.equal(threadId, 'selected-thread'); assert.equal(incident.durationMs, 2100); correlations++ },
        capture: event => { assert.equal(event.event, 'zyra_v1_app_lifecycle'); reports++ }
    })
    assert.equal(reports, scenario.reports)
    assert.equal(correlations, scenario.correlations, 'incognito and unrelated Browser WebContents cannot contaminate chat timing summaries')
    assert.equal(contextReads, scenario.correlations, 'private/suppressed incidents never fetch chat context')
}
console.log('Hang correlation privacy: incognito suppression precedes both analytics paths; only app renderer/main stalls annotate chat turns: ok')
