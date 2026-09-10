import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** Match the agent-server data root, independently of the installed code location. */
export function resolveZyraDataRoot(): string {
    return resolve(process.env.ZYRA_DATA_ROOT || homedir())
}
