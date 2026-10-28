type InvokeHandler = (...args: any[]) => unknown

/** Only a fresh, main-owned native request can admit update controls before setup.
 * Sender validation stays in trustedIpcMain; plan/consent/cleanup stay in updater.
 */
export function createManualInstallerUpdateGuard(dependencies: {
    hasSetupAccess: () => boolean
    hasCurrentRequest: () => boolean
    blockedResult: () => unknown
}) {
    return <T extends InvokeHandler>(handler: T) => (...args: Parameters<T>) =>
        dependencies.hasSetupAccess() || dependencies.hasCurrentRequest()
            ? handler(...args)
            : dependencies.blockedResult()
}
