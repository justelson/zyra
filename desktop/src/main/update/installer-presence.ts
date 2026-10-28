import { execFile } from 'node:child_process'
import { join } from 'node:path'

/** Absence must be positively observed. A failed check never permits recovery. */
export async function installerIsAbsent(appName: string): Promise<boolean> {
    if (process.platform !== 'win32' || !/^[a-zA-Z0-9 ._-]{1,80}$/.test(appName)) return false
    const name = `Local\\ZyraAgentUpdate.${appName}`
    const script = `try { $m=[Threading.Mutex]::OpenExisting('${name}'); $m.Dispose(); exit 1 } catch [Threading.WaitHandleCannotBeOpenedException] { exit 0 } catch { exit 2 }`
    return new Promise(resolve => execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5_000, windowsHide: true }, error => resolve(!error)))
}
