export const ASSISTANT_READ_PREVIEW_MAX_LINES = 50

export interface AssistantReadMetadata {
    readStartLine: number
    readEndLine?: number
    readLineCount?: number
    readTotalLines?: number
    readRequestedLimit?: number
    readComplete: boolean
    readTruncated: boolean
    readIsImage: boolean
}

export interface AssistantReadOutputParts {
    content: string
    continuationNotice: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function finitePositiveInteger(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined
}

function resultContainsImage(value: unknown): boolean {
    const record = asRecord(value)
    const content = Array.isArray(record?.['content']) ? record['content'] : []
    return content.some((entry) => asRecord(entry)?.['type'] === 'image')
}

function countReadContentLines(content: string): number {
    return content.length > 0 ? content.split(/\r?\n/).length : 0
}

export function splitAssistantReadOutput(output: string): AssistantReadOutputParts {
    const text = String(output || '')
    const match = text.match(/\r?\n(\[(?:Showing lines \d+-\d+ of \d+[^\]]*|\d+ more lines? in file[^\]]*)\])\s*$/i)
    if (!match || match.index === undefined) {
        return { content: text, continuationNotice: null }
    }
    return {
        content: text.slice(0, match.index),
        continuationNotice: match[1] || null
    }
}

export function analyzeAssistantReadResult(input: {
    args?: unknown
    result?: unknown
    partialResult?: unknown
    output?: string
    status?: 'running' | 'completed' | 'failed' | string
}): AssistantReadMetadata {
    const args = asRecord(input.args)
    const result = asRecord(input.result)
    const partialResult = asRecord(input.partialResult)
    const details = asRecord(result?.['details']) || asRecord(partialResult?.['details'])
    const truncation = asRecord(details?.['truncation'])
    const startLine = finitePositiveInteger(args?.['offset']) || 1
    const requestedLimit = finitePositiveInteger(args?.['limit'])
    const status = String(input.status || '').trim().toLowerCase()
    const readIsImage = resultContainsImage(result) || resultContainsImage(partialResult)
    const outputParts = splitAssistantReadOutput(String(input.output || ''))
    const countedOutputLines = readIsImage || status === 'running' || status === 'failed'
        ? undefined
        : countReadContentLines(outputParts.content)

    const showingMatch = outputParts.continuationNotice?.match(/Showing lines (\d+)-(\d+) of (\d+)/i)
    const remainingMatch = outputParts.continuationNotice?.match(/(\d+) more lines? in file/i)
    let readStartLine = startLine
    let readEndLine = countedOutputLines && countedOutputLines > 0
        ? startLine + countedOutputLines - 1
        : undefined
    let readLineCount = countedOutputLines
    let readTotalLines: number | undefined

    if (showingMatch) {
        readStartLine = Number(showingMatch[1])
        readEndLine = Number(showingMatch[2])
        readLineCount = Math.max(0, readEndLine - readStartLine + 1)
        readTotalLines = Number(showingMatch[3])
    } else if (remainingMatch && readLineCount !== undefined) {
        readLineCount = requestedLimit || readLineCount
        readEndLine = readLineCount > 0 ? readStartLine + readLineCount - 1 : undefined
        readTotalLines = Math.max(0, readStartLine - 1) + readLineCount + Number(remainingMatch[1])
    } else if (status === 'completed' && readLineCount !== undefined && !truncation?.['truncated']) {
        readTotalLines = Math.max(0, readStartLine - 1) + readLineCount
    } else {
        const truncatedOutputLines = finitePositiveInteger(truncation?.['outputLines'])
        const truncatedTotalLines = finitePositiveInteger(truncation?.['totalLines'])
        if (truncatedOutputLines !== undefined) {
            readLineCount = truncatedOutputLines
            readEndLine = readStartLine + truncatedOutputLines - 1
        }
        if (truncatedTotalLines !== undefined) {
            readTotalLines = Math.max(0, readStartLine - 1) + truncatedTotalLines
        }
    }

    const readTruncated = Boolean(outputParts.continuationNotice) || truncation?.['truncated'] === true
    const coveredWholeFile = readStartLine === 1
        && readLineCount !== undefined
        && readTotalLines !== undefined
        && readLineCount === readTotalLines
    const readComplete = status === 'completed' && !readIsImage && !readTruncated && coveredWholeFile

    return {
        readStartLine,
        readEndLine,
        readLineCount,
        readTotalLines,
        readRequestedLimit: requestedLimit,
        readComplete,
        readTruncated,
        readIsImage
    }
}

export function buildAssistantReadPreview(
    output: string,
    maxLines = ASSISTANT_READ_PREVIEW_MAX_LINES
): {
    text: string
    displayedLines: number
    totalReadLines: number
    presentationTruncated: boolean
    continuationNotice: string | null
} {
    const parts = splitAssistantReadOutput(output)
    const lines = parts.content.length > 0 ? parts.content.split(/\r?\n/) : []
    const boundedMaxLines = Math.max(1, Math.floor(maxLines))
    const displayedLines = Math.min(lines.length, boundedMaxLines)
    return {
        text: lines.slice(0, boundedMaxLines).join('\n'),
        displayedLines,
        totalReadLines: lines.length,
        presentationTruncated: lines.length > boundedMaxLines,
        continuationNotice: parts.continuationNotice
    }
}
