export function getSettingsUpdateAction(status: string, enabled: boolean, busy: boolean) {
    const id = status === 'available' ? 'download' : status === 'downloaded' ? 'install' : 'check'
    return {
        id,
        label: id === 'download' ? 'Download update' : id === 'install' ? 'Restart to install' : status === 'checking' ? 'Checking…' : status === 'downloading' ? 'Downloading…' : 'Check for updates',
        disabled: busy || !enabled || !['idle', 'up-to-date', 'error', 'available', 'downloaded'].includes(status)
    }
}
