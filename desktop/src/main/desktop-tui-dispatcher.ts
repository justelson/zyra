import { app } from 'electron'
import os from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { isPreviewDistribution } from '../shared/distribution-identity'
import { installDesktopTui } from '../../../src/desktop-tui-install.mjs'
import { resolveDesktopAgentServerNamespace } from './assistant/agent-server-namespace'

export function isDesktopTuiDispatch(argv = process.argv): boolean {
    return argv.includes('--tui')
}

export async function dispatchDesktopTui(argv = process.argv): Promise<number> {
    const marker = argv.indexOf('--tui')
    const forwarded = marker >= 0 ? argv.slice(marker + 1) : []
    const namespace = resolveDesktopAgentServerNamespace(app.getPath('userData'))
    const options = { directory: join(process.resourcesPath, 'zyra-tui'), channel: isPreviewDistribution() ? 'preview' as const : 'stable' as const, version: app.getVersion() }
    const installed = await installDesktopTui(options)
    const result = installed.installed ? installed : await installDesktopTui({ ...options, publishCommand: false, namespace })
    if (!result.installed) throw new Error('The matching terminal payload is unavailable.')
    const executable = result.executable
    return new Promise<number>((resolve, reject) => {
        const child = spawn(executable, forwarded, {
            cwd: process.cwd(),
            stdio: 'inherit',
            windowsHide: false,
            env: {
                ...process.env,
                ZYRA_DATA_ROOT: process.env.ZYRA_DATA_ROOT || os.homedir(),
                ZYRA_CALLER_CWD: process.cwd(),
                ZYRA_DISTRIBUTION: 'desktop-bundle',
                ZYRA_STATE_DIR: process.env.ZYRA_STATE_DIR || result.namespace.stateDirectory,
                ZYRA_AGENT_SERVER_CHANNEL: process.env.ZYRA_AGENT_SERVER_CHANNEL || (process.env.ZYRA_STATE_DIR ? 'default' : result.namespace.channel),
                ZYRA_DESKTOP_TUI_SOURCE_NAMESPACE: result.sourceNamespace ? '1' : '',
                ELECTRON_RUN_AS_NODE: '',
                ZYRA_DESKTOP_TUI_PAYLOAD: join(executable, '..')
            }
        })
        child.once('error', reject)
        child.once('exit', (code) => resolve(code ?? 1))
    })
}

export function desktopTuiLauncherCommand(): { executable: string; args: string[] } {
    return { executable: app.getPath('exe'), args: ['--tui'] }
}
