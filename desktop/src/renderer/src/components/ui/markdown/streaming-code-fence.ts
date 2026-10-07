/** Inspect the parser's complete code-node source, including its fence. */
export function isUnclosedCodeFence(source: string): boolean {
    const lines = source.trimEnd().split(/\r?\n/)
    const opening = lines[0]?.match(/^\s*(`{3,}|~{3,})/)
    if (!opening) return false
    const fence = opening[1]
    const closing = lines.at(-1)?.match(/^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})\s*$/)
    return lines.length < 2 || !closing || closing[1][0] !== fence[0] || closing[1].length < fence.length
}
