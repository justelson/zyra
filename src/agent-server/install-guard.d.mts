export type InstallGuardPaths = { stateDirectory: string; channel: string; namespaceId: string }
export type StoppedInstallHandoff = { version: 1; prepared: true; instanceId: string; pid: number; leaseId: string; namespaceId: string; root: string; targetVersion: string; revision: string; receiptNonce: string; requiresReceipt: boolean }
export function installSuccessFile(paths: InstallGuardPaths, version: string): string
export function recordInstallHandoff(paths: InstallGuardPaths, root: string, lease: { leaseId: string; instanceId: string }, targetVersion: string, revision: string, receiptNonce?: string): void
export function clearInstallHandoff(paths: InstallGuardPaths, leaseId: string): void
export function readStoppedInstallHandoff(paths: InstallGuardPaths, root: string, alive?: (pid: number) => boolean): StoppedInstallHandoff | null
export function renewStoppedInstallHandoff(paths: InstallGuardPaths, root: string, input: { expectedInstanceId: string; expectedNamespaceId: string; targetVersion: string; operationId?: string }, alive?: (pid: number) => boolean): StoppedInstallHandoff
export function restoreStoppedInstallHandoff(paths: InstallGuardPaths, prior: StoppedInstallHandoff, receiptNonce: string): void
export function inspectInstallRecovery(paths: InstallGuardPaths, root: string): Promise<{ targetVersion: string; leaseId: string } | null>
export function recoverInstallHandoff(paths: InstallGuardPaths, root: string): Promise<string>
export function assertRuntimeStartAllowed(paths: InstallGuardPaths, root: string): Promise<void>
