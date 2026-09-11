import { ipcRenderer } from 'electron'
import { RUNTIME_ACTIVATION_GET, RUNTIME_ACTIVATION_CHANGED, type RuntimeActivationStatus } from '../../shared/runtime-activation'
export function createRuntimeActivationAdapter() {
    return {
        getState: (): Promise<RuntimeActivationStatus> => ipcRenderer.invoke(RUNTIME_ACTIVATION_GET),
        onStateChange: (listener: (state: RuntimeActivationStatus) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, state: RuntimeActivationStatus) => listener(state)
            ipcRenderer.on(RUNTIME_ACTIVATION_CHANGED, handler)
            return () => { ipcRenderer.removeListener(RUNTIME_ACTIVATION_CHANGED, handler) }
        }
    }
}
