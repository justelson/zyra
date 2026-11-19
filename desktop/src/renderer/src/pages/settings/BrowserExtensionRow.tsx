import { useState } from 'react'
import { Ellipsis, Puzzle, RefreshCw, Shield, Trash2, X } from 'lucide-react'
import type { BrowserExtensionRecord } from '@shared/browser-extensions'
import { FileActionsMenu } from '@/components/ui/FileActionsMenu'
import { SettingsSwitch } from './settings-layout'

export function BrowserExtensionRow({ extension, busy, onToggle, onReload, onRemove }: {
    extension: BrowserExtensionRecord
    busy: boolean
    onToggle: (value: boolean) => Promise<void>
    onReload: () => Promise<void>
    onRemove: () => Promise<void>
}) {
    const [permissionsOpen, setPermissionsOpen] = useState(false)
    const permissions = [...extension.permissions, ...extension.hostPermissions]
    return <div className="border-t border-[var(--settings-border)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
            {extension.iconDataUrl
                ? <img src={extension.iconDataUrl} alt="" width={28} height={28} className="size-7 shrink-0 object-contain" />
                : <Puzzle size={24} aria-hidden className="mx-0.5 shrink-0 text-[var(--settings-text-faint)]" />}
            <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" title={extension.name}>{extension.name}</div>
                {extension.description && <p className="truncate text-xs text-[var(--settings-text-secondary)]" title={extension.description}>{extension.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <SettingsSwitch checked={extension.enabled} disabled={busy} onCheckedChange={onToggle} label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} />
                <FileActionsMenu presentation="portal" density="compact" menuWidth={166} disabled={busy} title={`Options for ${extension.name}`}
                    triggerIcon={<Ellipsis size={16} />} items={[
                        { id: 'permissions', label: 'Permissions', icon: <Shield size={14} />, onSelect: () => setPermissionsOpen(true) },
                        { id: 'reload', label: 'Reload', icon: <RefreshCw size={14} />, onSelect: onReload },
                        { id: 'remove', label: 'Remove', icon: <Trash2 size={14} />, danger: true, onSelect: onRemove }
                    ]} />
            </div>
        </div>
        {permissionsOpen && <section aria-label={`Permissions for ${extension.name}`} className="mt-2 rounded-md bg-[var(--surface-hover)] p-3 text-xs">
            <div className="flex items-center justify-between"><strong>Permissions</strong><button type="button" autoFocus aria-label="Close permissions" onClick={() => setPermissionsOpen(false)}><X size={14} /></button></div>
            <p className="my-1 text-[var(--settings-text-faint)]">Version {extension.version}</p>
            {extension.warnings.map(warning => <p key={warning} className="my-1 text-amber-500">{warning}</p>)}
            <p className="break-words text-[var(--settings-text-secondary)]">{permissions.join(', ') || 'No declared permissions.'}</p>
        </section>}
    </div>
}
