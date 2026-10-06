/** Desktop bridge first; browser clipboard or a local selection fallback otherwise. */
export async function copyTextToClipboard(value: string): Promise<void> {
    const bridge = typeof window !== 'undefined' ? window.devscope?.copyToClipboard : undefined
    if (bridge) {
        const result = await bridge(value)
        if (result.success === false) throw new Error(result.error || 'Failed to copy text')
        return
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
    }
    if (typeof document === 'undefined') throw new Error('Clipboard is unavailable')
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    try { if (!document.execCommand('copy')) throw new Error('Failed to copy text') }
    finally { textarea.remove() }
}
