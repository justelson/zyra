import type { ReactNode } from 'react'

export type CommandPaletteDomain = 'projects' | 'files' | 'mixed'

export type CommandPaletteResult = {
    id: string
    title: string
    subtitle?: string
    badge?: string
    contentMatch?: {
        source: 'user' | 'assistant'
        snippet: string
        query: string
    }
    icon?: ReactNode
    action: () => void
    group: string
}
