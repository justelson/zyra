import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { canonicalFolderKey } from '../canonical-folder-key'

/** The caller supplies the OS Documents location, including redirected folders. */
export async function ensureDefaultChatWorkspace(folder: string): Promise<string> {
    try {
        if (!isAbsolute(folder)) throw new Error('not-absolute')
        await mkdir(folder, { recursive: true })
        if (!(await stat(folder)).isDirectory()) throw new Error('not-directory')
        return folder
    } catch {
        throw new Error(`Zyra could not create its chat folder at ${folder}. Choose another folder in setup.`)
    }
}

/** Called at runtime activation, rather than coupling preferences to filesystem access. */
export async function prepareDefaultChatWorkspace(cwd: string, configuredFolder?: string | null): Promise<void> {
    if (!configuredFolder) return
    if (canonicalFolderKey(cwd) === canonicalFolderKey(configuredFolder)) await ensureDefaultChatWorkspace(configuredFolder)
}
