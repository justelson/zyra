import type { IpcMainInvokeEvent } from 'electron'
import type { ProjectContentSearchInput } from '../../../shared/contracts/project-content-search'
import { searchProjectContents } from '../../services/project-content-search'

const pending = new Map<number, AbortController>()

export async function handleSearchProjectContents(event: IpcMainInvokeEvent, input: ProjectContentSearchInput) {
    pending.get(event.sender.id)?.abort()
    const controller = new AbortController()
    pending.set(event.sender.id, controller)
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try {
        return { success: true as const, ...await searchProjectContents(input, controller.signal) }
    } catch (error) {
        return { success: false as const, cancelled: controller.signal.aborted, error: controller.signal.aborted ? 'Search cancelled.' : error instanceof Error ? error.message : 'Could not search project files.' }
    } finally {
        event.sender.removeListener('destroyed', destroyed)
        if (pending.get(event.sender.id) === controller) pending.delete(event.sender.id)
    }
}
