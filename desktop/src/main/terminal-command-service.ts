import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { resolveDesktopAgentServerNamespace } from './assistant/agent-server-namespace'
import { isPreviewDistribution } from '../shared/distribution-identity'

const execFileAsync = promisify(execFile)
const terminalChannel = () => isPreviewDistribution() ? 'preview' as const : 'stable' as const
async function installer() { return import('../../../src/desktop-tui-install.mjs') }

export type TerminalCommandStatus = {
    path: string
    installed: boolean
    managed: boolean
    pathConfigured: boolean
    canManage: boolean
}

export async function getTerminalCommandStatus(): Promise<TerminalCommandStatus> {
    const target = launcherPath()
    const tools = await installer()
    const owned = await tools.inspectDesktopTuiLauncher(tools.desktopTuiPaths({ channel: terminalChannel() }))
    return {
        path: target,
        installed: owned.exists,
        managed: Boolean(owned.kind),
        pathConfigured: pathEntries().includes(path.dirname(target).toLowerCase()),
        canManage: app.isPackaged
    }
}

export async function installTerminalCommand(): Promise<TerminalCommandStatus> {
    if (!app.isPackaged) throw new Error('Manage the terminal command from the installed app, not a development instance.')
    const current = await getTerminalCommandStatus()
    if (current.installed && !current.managed) throw new Error(`Refusing to replace an unmanaged command at ${current.path}.`)
    const result = await (await installer()).installDesktopTui({ directory: path.join(process.resourcesPath, 'zyra-tui'), channel: terminalChannel(), version: app.getVersion(), namespace: resolveDesktopAgentServerNamespace(app.getPath('userData')) })
    if (!result.installed) throw new Error('The terminal command is owned by another application.')
    if (process.platform === 'win32' && !current.pathConfigured) await addWindowsUserPath(path.dirname(current.path))
    return getTerminalCommandStatus()
}

export async function removeTerminalCommand(): Promise<TerminalCommandStatus> {
    if (!app.isPackaged) throw new Error('Manage the terminal command from the installed app, not a development instance.')
    const current = await getTerminalCommandStatus()
    if (current.installed && !current.managed) throw new Error(`Refusing to remove an unmanaged command at ${current.path}.`)
    await (await installer()).removeDesktopTui({ channel: terminalChannel(), version: app.getVersion(), directory: path.join(process.resourcesPath, 'zyra-tui') })
    // Stable and Dev share the bin directory. Removing one must not remove the
    // other's PATH entry. Keeping an empty user bin is harmless.
    return getTerminalCommandStatus()
}

/** Repair only already-owned launchers on ordinary app startup (Unix upgrades
 * replace the app bundle without running a Windows installation hook). */
export async function syncInstalledTerminalCommand(): Promise<void> {
    if (!app.isPackaged) return
    const current = await getTerminalCommandStatus()
    if (current.installed && current.managed && await (await installer()).desktopTuiNeedsUpdate(path.join(process.resourcesPath, 'zyra-tui'), { channel: terminalChannel(), version: app.getVersion() })) await installTerminalCommand()
}
function launcherPath(): string {
    const name = terminalChannel() === 'preview' ? 'zyra-dev' : 'zyra'
    if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Zyra', 'bin', `${name}.cmd`)
    return path.join(os.homedir(), '.local', 'bin', name)
}

function pathEntries(): string[] {
    return String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry).toLowerCase())
}

async function addWindowsUserPath(directory: string): Promise<void> {
    const script = [
        '$dir=$args[0]',
        '$current=[Environment]::GetEnvironmentVariable("Path","User")',
        '$parts=@($current -split ";" | Where-Object { $_ })',
        'if($parts -notcontains $dir){[Environment]::SetEnvironmentVariable("Path",(($parts+$dir)-join ";"),"User")}'
    ].join(';')
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, directory], { windowsHide: true })
    if (!pathEntries().includes(path.resolve(directory).toLowerCase())) process.env.PATH = `${process.env.PATH || ''}${path.delimiter}${directory}`
}
