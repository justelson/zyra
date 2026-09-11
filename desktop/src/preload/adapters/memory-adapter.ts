import { ipcRenderer } from 'electron'

export function createMemoryAdapter() {
    return {
        memory: {
            getJobStatus: () => ipcRenderer.invoke('zyra:memory:getJobStatus'),
            getOverview: () => ipcRenderer.invoke('zyra:memory:getOverview')
        }
    }
}
