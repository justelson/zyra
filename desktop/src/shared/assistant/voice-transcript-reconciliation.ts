function normalizeVoiceTranscriptPrefix(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase('en-US')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
}

export function isExtendedVoiceTranscriptPrefix(previousValue: string, nextValue: string): boolean {
    const previous = normalizeVoiceTranscriptPrefix(previousValue)
    const next = normalizeVoiceTranscriptPrefix(nextValue)
    return Boolean(previous && next.length > previous.length && next.startsWith(`${previous} `))
}
