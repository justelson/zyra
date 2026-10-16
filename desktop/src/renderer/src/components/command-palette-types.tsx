import type { ReactNode } from 'react'

export type CommandPaletteDomain = 'projects' | 'files' | 'mixed'

export type CommandPaletteResult = {
    id: string
    title: string
    titleContent?: ReactNode
    subtitle?: string
    badge?: string
    detail?: ReactNode
    trailing?: ReactNode
    keepOpen?: boolean
    contentMatch?: {
        source: 'user' | 'assistant'
        snippet: string
        query: string
    }
    icon?: ReactNode
    action: () => void
    group: string
}
