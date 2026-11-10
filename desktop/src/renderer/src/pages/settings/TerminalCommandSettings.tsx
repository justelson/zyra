import { useEffect, useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { isPreviewDistribution } from '@shared/distribution-identity'
import type { DevScopeTerminalCommandStatus } from '@shared/contracts/devscope-api'
import {
    SettingsButton,
    SettingsNotice,
    SettingsRow,
    SettingsSection
} from './settings-layout'

export function TerminalCommandSettings() {
    const [terminalCommand, setTerminalCommand] = useState<DevScopeTerminalCommandStatus | null>(null)
    const [terminalCommandBusy, setTerminalCommandBusy] = useState(false)
    const [terminalCommandError, setTerminalCommandError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        void window.devscope.window.getTerminalCommandStatus().then((result) => {
            if (cancelled) return
            if (result.success) setTerminalCommand(result.status)
            else setTerminalCommandError(result.error || 'Command status is unavailable.')
        }).catch((error) => {
            if (!cancelled) setTerminalCommandError(error instanceof Error ? error.message : 'Command status is unavailable.')
        })
        return () => { cancelled = true }
    }, [])

    const toggleTerminalCommand = async () => {
        setTerminalCommandBusy(true)
        setTerminalCommandError(null)
        try {
            const result = terminalCommand?.installed
                ? await window.devscope.window.removeTerminalCommand()
                : await window.devscope.window.installTerminalCommand()
            if (!result.success) throw new Error(result.error)
            setTerminalCommand(result.status)
        } catch (error) {
            setTerminalCommandError(error instanceof Error ? error.message : 'Could not update the terminal command.')
        } finally {
            setTerminalCommandBusy(false)
        }
    }

    return (
        <SettingsSection title="Command-line access" searchSection="Terminal">
            {terminalCommandError ? <SettingsNotice tone="error">{terminalCommandError}</SettingsNotice> : null}
            <SettingsRow
                title={isPreviewDistribution() ? 'zyra-dev command' : 'zyra command'}
                description={terminalCommand?.canManage === false
                    ? isPreviewDistribution()
                        ? 'Preview cannot change the global zyra command. Terminals opened here use this isolated Preview.'
                        : 'Manage the global command in installed Zyra. Terminals opened here use this development instance.'
                    : 'Run the bundled Zyra TUI from your terminal.'}
                info={terminalCommand?.installed ? <code className="break-all text-[11px]">{terminalCommand.path}</code> : undefined}
                status={!terminalCommand ? terminalCommandError ? 'Unavailable' : 'Checking…' : terminalCommand.installed ? (terminalCommand.pathConfigured ? 'Ready' : 'Add folder to PATH') : 'Not installed'}
                control={<SettingsButton onClick={() => void toggleTerminalCommand()} disabled={terminalCommandBusy || !terminalCommand || terminalCommand.canManage === false}><SquareTerminal size={12} />{terminalCommandBusy ? 'Updating…' : terminalCommand?.installed ? 'Remove' : 'Install'}</SettingsButton>}
            />
        </SettingsSection>
    )
}
