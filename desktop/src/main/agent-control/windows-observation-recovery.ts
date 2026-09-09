import { AgentControlError } from './control-errors'
import { isExpiredWindowTokenError } from './windows-candidate-selection'

type NativeObservation = Record<string, unknown>

// Retry observation only, never input. A replacement window needs a new exact
// selection and grant; matching executable/process identities do not transfer it.
export async function observeExactWindowsTarget(input: {
    windowToken: string
    observe: () => Promise<NativeObservation>
    listCurrent: () => Promise<Array<{ windowToken: string }>>
    wait: (milliseconds: number) => Promise<void>
}): Promise<NativeObservation> {
    let latest: NativeObservation = { targetState: 'blocked', elements: [], redactions: ['window-token-unavailable'] }
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            latest = await input.observe()
            const unavailable = latest.targetState === 'blocked' && Array.isArray(latest.redactions)
                && latest.redactions.some(entry => String(entry).startsWith('uia-unavailable:'))
            if (!unavailable) return latest
            // Partial UIA trees after a provider failure cannot authorize input.
            latest = { ...latest, elements: [], focusedElementRef: undefined }
        } catch (error) {
            if (error instanceof AgentControlError && error.code === 'CONTROL_DRIVER_UNAVAILABLE' && /selected window closed/i.test(error.message)) return closedObservation()
            if (!isExpiredWindowTokenError(error)) throw error
        }
        const current = await input.listCurrent()
        if (!current.some(candidate => candidate.windowToken === input.windowToken)) return closedObservation()
        if (attempt < 2) await input.wait(100 * (attempt + 1))
    }
    return latest
}

function closedObservation(): NativeObservation {
    return { targetState: 'closed', elements: [], redactions: ['stale-window-references-discarded'] }
}
