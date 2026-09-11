export type ZyraMemoryLayer = {
    id: string
    title: string
    filePath: string
    size: number
    updatedAt: number
    summary: string
    content: string
}

export type ZyraMemoryOverview = {
    rootPath: string
    memoryDirectory: string
    sessionsDirectory: string
    cliPath: string
    defaultModel: string
    defaultThinking: string
    memoryLayers: ZyraMemoryLayer[]
    recommendedPrompts: string[]
}

export type ZyraMemoryJobStatus = {
    phase: 'offline' | 'running' | 'waiting' | 'error' | 'idle'
    queued: number
    lastSuccessAt: number | null
    lastCheckedAt: number | null
    lastError: string | null
}

export interface ZyraMemoryApi {
    getJobStatus: () => Promise<{ success: true; status: ZyraMemoryJobStatus } | { success: false; error: string }>
    getOverview: () => Promise<{ success: true; overview: ZyraMemoryOverview } | { success: false; error: string }>
}
