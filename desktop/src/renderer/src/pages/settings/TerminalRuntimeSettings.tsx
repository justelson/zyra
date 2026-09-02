import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { DevScopeInstalledPackageRuntime, DevScopePackageRuntimeId } from '@shared/contracts/devscope-api'
import { useSettings, type PackageRuntimePreference } from '@/lib/settings'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import { useWindowChrome } from '@/lib/useWindowChrome'
import {
    SettingsButton,
    SettingsInput,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSelect,
    SettingsSwitch
} from './settings-layout'

let cachedPackageRuntimes: DevScopeInstalledPackageRuntime[] | null = null
let pendingPackageRuntimes: { generation: number; promise: Promise<DevScopeInstalledPackageRuntime[]> } | null = null
let packageRuntimeGeneration = 0

async function loadPackageRuntimes(forceRefresh = false): Promise<DevScopeInstalledPackageRuntime[]> {
    if (!forceRefresh && cachedPackageRuntimes) return cachedPackageRuntimes
    const previous = pendingPackageRuntimes
    if (previous) {
        if (!forceRefresh && previous.generation === packageRuntimeGeneration) return previous.promise
        await previous.promise.catch(() => undefined)
        if (pendingPackageRuntimes === previous) pendingPackageRuntimes = null
    }
    const generation = packageRuntimeGeneration
    const request = window.devscope.listInstalledPackageRuntimes().then((result) => {
        if (!result.success) throw new Error(result.error || 'Runtime detection failed.')
        if (generation === packageRuntimeGeneration) cachedPackageRuntimes = result.runtimes
        return result.runtimes
    })
    const pending = { generation, promise: request }
    pendingPackageRuntimes = pending
    void request.finally(() => {
        if (pendingPackageRuntimes === pending) pendingPackageRuntimes = null
    }).catch(() => undefined)
    return request
}

registerSettingsCacheClearer('settings-package-runtimes', () => {
    packageRuntimeGeneration += 1
    cachedPackageRuntimes = null
    pendingPackageRuntimes = null
})

const RUNTIME_OPTIONS: Array<{ value: PackageRuntimePreference; runtimeId?: DevScopePackageRuntimeId; label: string }> = [
    { value: 'auto', label: 'Auto (project lockfile)' },
    { value: 'node', runtimeId: 'node', label: 'Node.js' },
    { value: 'npm', runtimeId: 'npm', label: 'npm' },
    { value: 'pnpm', runtimeId: 'pnpm', label: 'pnpm' },
    { value: 'yarn', runtimeId: 'yarn', label: 'Yarn' },
    { value: 'bun', runtimeId: 'bun', label: 'Bun' }
]

export default function TerminalRuntimeSettings() {
    const { settings, updateSettings } = useSettings()
    const { runtime } = useWindowChrome()
    const [runtimes, setRuntimes] = useState<DevScopeInstalledPackageRuntime[]>(() => cachedPackageRuntimes || [])
    const [runtimeLoading, setRuntimeLoading] = useState(false)
    const [runtimeError, setRuntimeError] = useState<string | null>(null)

    const refreshRuntimes = async (forceRefresh = false) => {
        setRuntimeLoading(!cachedPackageRuntimes || forceRefresh)
        setRuntimeError(null)
        try {
            setRuntimes(await loadPackageRuntimes(forceRefresh))
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : 'Runtime detection failed.')
        } finally {
            setRuntimeLoading(false)
        }
    }

    useEffect(() => { void refreshRuntimes() }, [])
    const runtimeById = useMemo(() => new Map(runtimes.map((runtime) => [runtime.id, runtime])), [runtimes])

    return (
        <SettingsPageContainer title="Terminal & runtime" backTo="/settings/workspace" backLabel="Workspace">
            <SettingsSection title="Terminal">
                <SettingsRow
                    title="Default shell"
                    description={runtime.platform === 'win32' ? 'Choose the Windows shell used for terminal actions.' : 'Zyra uses the operating system login shell for terminal actions.'}
                    control={runtime.platform === 'win32' ? (
                        <SettingsSegmented value={settings.defaultShell} options={[{ value: 'powershell', label: 'PowerShell' }, { value: 'cmd', label: 'Command Prompt' }]} onChange={(defaultShell) => updateSettings({ defaultShell })} label="Default shell" />
                    ) : (
                        <span className="text-xs font-medium text-sparkle-text-secondary">
                            {runtime.platform === 'darwin' ? 'System shell · Terminal' : runtime.platform === 'linux' ? 'System shell' : 'Desktop system shell'}
                        </span>
                    )}
                />
                <SettingsRow title="Font size" description="Apply the terminal text size to Assistant and file-preview terminals." control={<SettingsInput type="number" min={10} max={24} value={settings.terminalFontSize} onChange={(event) => updateSettings({ terminalFontSize: Math.max(10, Math.min(24, Math.round(Number(event.target.value) || 12))) })} className="sm:w-24" aria-label="Terminal font size" />} />
                <SettingsRow title="Blinking cursor" description="Blink the cursor in embedded terminals." control={<SettingsSwitch checked={settings.terminalCursorBlink} onCheckedChange={(terminalCursorBlink) => updateSettings({ terminalCursorBlink })} label="Blinking terminal cursor" />} />
                <SettingsRow title="Scrollback" description="Lines retained by each embedded terminal, from 1,000 to 50,000." control={<SettingsInput type="number" min={1000} max={50000} step={1000} value={settings.terminalScrollback} onChange={(event) => updateSettings({ terminalScrollback: Math.max(1_000, Math.min(50_000, Math.round(Number(event.target.value) || 5_000))) })} className="sm:w-28" aria-label="Terminal scrollback lines" />} />
                <SettingsRow title="Preview panel height" description="Default height, in pixels, for the file-preview terminal panel." control={<SettingsInput type="number" min={140} max={720} value={settings.filePreviewTerminalPanelHeight} onChange={(event) => updateSettings({ filePreviewTerminalPanelHeight: Math.max(140, Math.min(720, Number(event.target.value) || 220)) })} className="sm:w-24" aria-label="Terminal panel height" />} />
            </SettingsSection>

            <SettingsSection title="Package runtime" headerAction={<SettingsButton variant="ghost" onClick={() => void refreshRuntimes(true)} disabled={runtimeLoading}><RefreshCw size={12} className={runtimeLoading ? 'animate-spin' : ''} />Refresh</SettingsButton>}>
                <SettingsRow
                    title="Project script runner"
                    description="Choose the runtime used by project script actions. Auto follows project lockfiles."
                    status={runtimeError ? 'Unavailable' : runtimeLoading ? 'Checking' : null}
                    statusTone={runtimeError ? 'danger' : 'info'}
                    statusTitle={runtimeError || undefined}
                    control={
                        <SettingsSelect value={settings.packageRuntimePreference} onChange={(event) => updateSettings({ packageRuntimePreference: event.target.value as PackageRuntimePreference })} aria-label="Package runtime">
                            {RUNTIME_OPTIONS.map((option) => {
                                const runtime = option.runtimeId ? runtimeById.get(option.runtimeId) : null
                                const installed = option.value === 'auto' || runtime?.installed === true
                                return <option key={option.value} value={option.value} disabled={!installed}>{option.label}{runtime?.version ? ` · ${runtime.version}` : installed ? '' : ' · not installed'}</option>
                            })}
                        </SettingsSelect>
                    }
                />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
