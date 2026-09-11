import { resolveZyraDataRoot } from '../../zyra/zyra-data-root'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { ZyraMemoryLayer, ZyraMemoryOverview, ZyraMemoryJobStatus } from '../../../shared/contracts/memory-contracts'
import { resolveZyraRoot } from '../../zyra/zyra-root'

function toTitle(fileName: string): string {
    return basename(fileName, '.md')
        .split(/[-_]+/g)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ')
}

function firstMeaningfulLine(text: string): string {
    const lines = text
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
    const heading = lines.find((line) => line.startsWith('#'))
    const first = heading || lines[0] || ''
    return first.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').slice(0, 160)
}

function parseRecommendedPrompts(content: string): string[] {
    return content
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .map((line) => line.replace(/^Prompt:\s*/i, '').trim())
        .filter(Boolean)
        .slice(0, 8)
}

function readMemoryLayers(memoryDirectory: string): ZyraMemoryLayer[] {
    if (!existsSync(memoryDirectory)) return []

    return readdirSync(memoryDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => {
            const filePath = join(memoryDirectory, entry.name)
            const stats = statSync(filePath)
            const content = readFileSync(filePath, 'utf8')
            return {
                id: basename(entry.name, '.md'),
                title: toTitle(entry.name),
                filePath,
                size: stats.size,
                updatedAt: stats.mtimeMs,
                summary: firstMeaningfulLine(content),
                content
            }
        })
        .sort((left, right) => {
            const priority = (id: string) => id === 'memory_summary' ? 0 : id === 'MEMORY' ? 1 : 2
            return priority(left.id) - priority(right.id) || left.title.localeCompare(right.title)
        })
}

export async function handleMemoryGetOverview() {
    try {
        const rootPath = resolveZyraDataRoot()
        const memoryDirectory = join(rootPath, '.zyra', 'memory')
        const sessionsDirectory = join(rootPath, '.zyra', 'sessions')
        const memoryLayers = readMemoryLayers(memoryDirectory)
        const recommendedLayer = memoryLayers.find((layer) => layer.id === 'recommended-prompts')
        const overview: ZyraMemoryOverview = {
            rootPath,
            memoryDirectory,
            sessionsDirectory,
            cliPath: join(resolveZyraRoot(), 'bin', 'zyra.mjs'),
            defaultModel: 'openai-codex/gpt-5.5',
            defaultThinking: 'medium',
            memoryLayers,
            recommendedPrompts: recommendedLayer ? parseRecommendedPrompts(recommendedLayer.content) : []
        }

        return { success: true as const, overview }
    } catch (error) {
        return {
            success: false as const,
            error: error instanceof Error ? error.message : 'Failed to read Zyra memory.'
        }
    }
}

export function handleMemoryGetJobStatus(userDataPath: string) {
    const empty: ZyraMemoryJobStatus = { phase: 'offline', queued: 0, lastSuccessAt: null, lastCheckedAt: null, lastError: null }
    try {
        const file = join(userDataPath, 'assistant', 'agent-server', 'memory-jobs.json')
        if (!existsSync(file)) return { success: true as const, status: empty }
        const value = JSON.parse(readFileSync(file, 'utf8'))
        const timestamp = (input: unknown) => typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : null
        const phase = ['running', 'waiting', 'error', 'idle'].includes(value.phase) ? value.phase : 'offline'
        let alive = false
        if (Number.isSafeInteger(value.pid) && value.pid > 0) { try { process.kill(value.pid, 0); alive = true } catch {} }
        return { success: true as const, status: { phase: alive ? phase : 'offline', queued: alive ? Math.min(1000, Math.max(0, Number(value.queued) || 0)) : 0,
            lastSuccessAt: timestamp(value.lastSuccessAt), lastCheckedAt: timestamp(value.lastCheckedAt),
            lastError: value.lastError ? 'Memory could not update. Check the connected model and try again after chatting.' : null } as ZyraMemoryJobStatus }
    } catch { return { success: false as const, error: 'Memory update status could not be read.' } }
}
