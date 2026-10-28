import {
    checkForAppUpdates,
    downloadAppUpdate,
    getUpdateState,
    preflightAppUpdate,
    deferAppUpdate,
    resumePreviousAgent,
    refreshInstallationRecovery,
    installAppUpdate
} from '../../update/manager'

export async function handleGetUpdateState() {
    await refreshInstallationRecovery()
    return getUpdateState()
}

export async function handleCheckForUpdates() {
    return checkForAppUpdates('renderer')
}

export async function handleDownloadUpdate() {
    return downloadAppUpdate()
}

export async function handlePreflightUpdate() { return preflightAppUpdate() }
export async function handleDeferUpdate() { return deferAppUpdate() }
export async function handleResumePreviousAgent() { return resumePreviousAgent() }
export async function handleInstallUpdate(_event: unknown, input?: import('../../../shared/agent-update').AgentUpdateConfirmation) {
    return installAppUpdate(input)
}
