import { useAppUpdates } from '@/lib/app-updates'
import { AgentUpdateDialog } from './AgentUpdateDialog'

export function UpdateInstallConfirmation() {
    const { installConfirmationVersion, installPlan, installPreflightPending, pendingAction, actionError,
        cancelInstallUpdate, confirmInstallUpdate, refreshInstallPlan } = useAppUpdates()
    return installConfirmationVersion ? <AgentUpdateDialog key={installConfirmationVersion} kind="install" plan={installPlan}
        checking={installPreflightPending} busy={pendingAction === 'install'} error={actionError}
        onLater={cancelInstallUpdate} onRefresh={() => void refreshInstallPlan()}
        onConfirm={stopBlockers => { void confirmInstallUpdate(stopBlockers) }} /> : null
}
