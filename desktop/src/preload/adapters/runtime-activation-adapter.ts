import { ipcRenderer } from 'electron'
import { RUNTIME_ACTIVATION_GET, RUNTIME_ACTIVATION_CHANGED, RUNTIME_ACTIVATION_REFRESH, RUNTIME_ACTIVATION_APPLY, type RuntimeActivationStatus } from '../../shared/runtime-activation'
export function createRuntimeActivationAdapter() {
    return {
        getState: (): Promise<RuntimeActivationStatus> => ipcRenderer.invoke(RUNTIME_ACTIVATION_GET),
        refresh: (): Promise<RuntimeActivationStatus> => ipcRenderer.invoke(RUNTIME_ACTIVATION_REFRESH),
        activateUpdate: (options?: { expectedInstanceId: string; stopBlockers: boolean }): Promise<RuntimeActivationStatus> => ipcRenderer.invoke(RUNTIME_ACTIVATION_APPLY, options),
        onStateChange: (listener: (state: RuntimeActivationStatus) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, state: RuntimeActivationStatus) => listener(state)
            ipcRenderer.on(RUNTIME_ACTIVATION_CHANGED, handler)
            return () => { ipcRenderer.removeListener(RUNTIME_ACTIVATION_CHANGED, handler) }
        }
    }
}
