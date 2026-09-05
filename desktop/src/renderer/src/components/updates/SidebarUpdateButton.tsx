import { AlertCircle, Download, LoaderCircle, PackageCheck } from 'lucide-react'
import { getUpdateActionLabel, useAppUpdates } from '@/lib/app-updates'
import { sidebarUpdatePresentation } from '@/lib/app-update-presentation'
import './sidebar-update.css'

export function SidebarUpdateButton() {
    const { updateState, pendingAction, actionError, checkForUpdates, downloadUpdate, installUpdate, openModal, clearSkippedVersion } = useAppUpdates()
    const view = sidebarUpdatePresentation(updateState, pendingAction, actionError)
    const Icon = view.busy ? LoaderCircle : view.status === 'error' ? AlertCircle : view.status === 'downloaded' ? PackageCheck : Download
    const description = view.status === 'installing' ? 'Restarting Zyra to install the update' : actionError || getUpdateActionLabel(updateState)
    const actionLabel = view.action === 'download' ? 'Download update' : view.action === 'install' ? 'Install update' : view.action === 'check' ? 'Check for updates' : description
    const onClick = () => {
        if (view.action === 'download') void downloadUpdate()
        else if (view.action === 'install') void installUpdate()
        else if (view.action === 'check') { clearSkippedVersion(); void checkForUpdates() }
        else openModal()
    }
    return <div className="sidebar-update-control">
        <button type="button" className="sidebar-update-button" data-state={view.status} disabled={view.disabled} aria-label={actionLabel} aria-busy={view.busy || undefined} title={description} onClick={onClick}>
            <Icon size={16} strokeWidth={1.8} className={view.busy ? 'sidebar-update-spinner' : undefined} aria-hidden="true" />
            <span className="sidebar-update-label" aria-hidden="true">{view.label}</span>
        </button>
        {view.status === 'downloading' ? <span className="sr-only" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent ?? undefined} /> : null}
    </div>
}
