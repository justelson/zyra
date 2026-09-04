export type AgentSurfaceKind = 'command' | 'file-change' | 'file-read' | 'search' | 'web-search' | 'web-fetch' | 'skill' | 'agent' | 'workflow' | 'browser-control' | 'computer-control' | 'tool'
export type AgentSurfaceLifecycle = 'running' | 'completed' | 'failed' | 'stopped'
export type AgentSurfacePhase = 'start' | 'update' | 'end'

export interface AgentSurfaceDescriptor {
    version: 1
    kind: AgentSurfaceKind
    lifecycle: AgentSurfaceLifecycle
    phase?: AgentSurfacePhase
    toolName: string
    toolKey: string
    primaryText: string
    command?: string
    query?: string
    url?: string
    action?: string
    paths: string[]
    summary: string
}

const AGENT_SURFACE_KINDS = new Set<AgentSurfaceKind>(['command', 'file-change', 'file-read', 'search', 'web-search', 'web-fetch', 'skill', 'agent', 'workflow', 'browser-control', 'computer-control', 'tool'])
const AGENT_SURFACE_LIFECYCLES = new Set<AgentSurfaceLifecycle>(['running', 'completed', 'failed', 'stopped'])

/** Validate the versioned descriptor crossing the root Zyra runtime -> desktop boundary. */
export function parseAgentSurfaceDescriptor(value: unknown): AgentSurfaceDescriptor | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const descriptor = value as Record<string, unknown>
    if (descriptor.version !== 1) return null
    if (!AGENT_SURFACE_KINDS.has(descriptor.kind as AgentSurfaceKind)) return null
    if (!AGENT_SURFACE_LIFECYCLES.has(descriptor.lifecycle as AgentSurfaceLifecycle)) return null
    if (descriptor.phase !== undefined && descriptor.phase !== 'start' && descriptor.phase !== 'update' && descriptor.phase !== 'end') return null
    if (typeof descriptor.toolName !== 'string' || typeof descriptor.toolKey !== 'string') return null
    if (typeof descriptor.primaryText !== 'string' || typeof descriptor.summary !== 'string') return null
    if (!Array.isArray(descriptor.paths) || descriptor.paths.some((entry) => typeof entry !== 'string')) return null
    if (descriptor.command !== undefined && typeof descriptor.command !== 'string') return null
    if (descriptor.query !== undefined && typeof descriptor.query !== 'string') return null
    if (descriptor.url !== undefined && typeof descriptor.url !== 'string') return null
    if (descriptor.action !== undefined && typeof descriptor.action !== 'string') return null
    return descriptor as unknown as AgentSurfaceDescriptor
}
