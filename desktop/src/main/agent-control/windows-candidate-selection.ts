import { AgentControlError } from './control-errors'

export async function selectExactWindowsCandidate<T>(input: {
    windowToken: string
    select: () => Promise<T>
    listCurrent: () => Promise<Array<{ windowToken: string }>>
}): Promise<T> {
    try {
        return await input.select()
    } catch (error) {
        if (!isExpiredWindowTokenError(error)) throw error
        const current = await input.listCurrent()
        if (!current.some((candidate) => candidate.windowToken === input.windowToken)) throw error
        return input.select()
    }
}

export function isExpiredWindowTokenError(error: unknown): boolean {
    return error instanceof AgentControlError
        && error.code === 'CONTROL_DRIVER_UNAVAILABLE'
        && /window token is unknown or expired/i.test(error.message)
}
