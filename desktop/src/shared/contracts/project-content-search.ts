export interface ProjectContentSearchInput {
    root: string
    query: string
    fileFilter?: string
    caseSensitive?: boolean
    limit?: number
}

export interface ProjectContentMatch {
    path: string
    relativePath: string
    line: number
    column: number
    text: string
}

export interface ProjectContentSearchResult {
    matches: ProjectContentMatch[]
    truncated: boolean
    scannedFiles: number
}
