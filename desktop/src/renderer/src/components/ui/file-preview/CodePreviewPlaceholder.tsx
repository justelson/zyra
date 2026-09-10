/** Show the already-read file immediately while the editor module initializes. */
export function CodePreviewPlaceholder({ content, fontSize = 13, wordWrap = 'on' }: { content: string; fontSize?: number; wordWrap?: 'on' | 'off' }) {
    const text = content.slice(0, 48_000)
    return <div className="h-full w-full overflow-auto" aria-busy="true" aria-label="Preparing code editor">
        <pre className="m-0 py-3 pl-12 pr-4 text-sparkle-text" style={{ fontFamily: 'var(--font-code, ui-monospace, monospace)', fontSize, lineHeight: '20px', whiteSpace: wordWrap === 'off' ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre>
        {content.length > text.length ? <p className="px-4 text-[11px] text-sparkle-text-muted">The rest of the file will appear when the editor is ready.</p> : null}
    </div>
}
