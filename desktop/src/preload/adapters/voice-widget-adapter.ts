import { ipcRenderer } from 'electron'
import { VOICE_WIDGET_IPC as IPC, type VoiceWidgetApi } from '../../shared/assistant/voice-widget'

export function createVoiceWidgetAdapter(): VoiceWidgetApi {
    return {
        getState: () => ipcRenderer.invoke(IPC.getState),
        open: (launch, expectedCallId) => ipcRenderer.invoke(IPC.open, launch, expectedCallId),
        command: command => ipcRenderer.invoke(IPC.command, command),
        publish: (callId, state) => ipcRenderer.invoke(IPC.publish, callId, state),
        complete: (commandId, result) => ipcRenderer.invoke(IPC.complete, commandId, result),
        onState: listener => {
            const receive = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
            ipcRenderer.on(IPC.state, receive)
            return () => { ipcRenderer.removeListener(IPC.state, receive) }
        },
        onCommand: listener => {
            const receive = (_event: Electron.IpcRendererEvent, command: Parameters<typeof listener>[0]) => listener(command)
            ipcRenderer.on(IPC.receive, receive)
            return () => { ipcRenderer.removeListener(IPC.receive, receive) }
        }
    }
}
