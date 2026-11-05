import { contextBridge, ipcRenderer } from 'electron'
import { RESPONSE_TIMING_IPC, type ResponseTimingApi } from '../shared/response-timing'

export function installResponseTimingDiagnostics(): void {
    const api: ResponseTimingApi = {
        read: () => ipcRenderer.invoke(RESPONSE_TIMING_IPC.read),
        displayed: input => ipcRenderer.invoke(RESPONSE_TIMING_IPC.displayed, input)
    }
    contextBridge.exposeInMainWorld('zyraDiagnostics', api)
}
