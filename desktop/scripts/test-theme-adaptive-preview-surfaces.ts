import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const officeContent = source('../src/renderer/src/components/ui/file-preview/OfficePreviewContent.tsx')
const officeToolbar = source('../src/renderer/src/components/ui/file-preview/OfficePreviewToolbar.tsx')
const officeViewer = source('../src/renderer/src/components/ui/file-preview/officePreviewViewer.ts')
const pdfPreview = source('../src/renderer/src/components/ui/file-preview/PdfPreviewContent.tsx')
const themeCss = source('../src/renderer/src/index.css')
const toolSources = [
    source('../src/renderer/src/pages/assistant/AssistantTimelineToolCallCard.tsx'),
    source('../src/renderer/src/pages/assistant/AssistantTimelineToolCalls.tsx'),
    source('../src/renderer/src/pages/assistant/AssistantTimelineActionBatch.tsx'),
    source('../src/renderer/src/pages/assistant/AssistantTimelineActionShell.tsx'),
    source('../src/renderer/src/pages/assistant/AssistantTimelineSubagentActivityCard.tsx'),
    source('../src/renderer/src/pages/assistant/assistant-timeline-path-ui.tsx'),
    source('../src/renderer/src/pages/assistant/AssistantInlineDiffPreview.tsx'),
    source('../src/renderer/src/pages/assistant/AssistantFileChangeStatusPill.tsx')
].join('\n')

assert.match(officeContent, /useThemeRevision\(\)/, 'an open Office preview reinitializes its canvas renderer when the Zyra theme changes')
assert.match(officeContent, /office-preview-root/, 'Office preview chrome has a scoped theme surface')
assert.match(officeToolbar, /var\(--surface-chrome\)/, 'Office controls use the active theme chrome')
assert.match(officeToolbar, /var\(--surface-divider\)/, 'Office controls use the active theme dividers')
assert.match(officeViewer, /var\(--office-preview-desk\)/, 'the WASM viewer desk is supplied through live CSS variables')
assert.match(pdfPreview, /useThemeRevision\(\)/, 'the embedded PDF viewer receives theme updates')
assert.match(pdfPreview, /style=\{\{ colorScheme \}\}/, 'PDF browser chrome receives the active light or dark color scheme')
assert.match(themeCss, /body\.light \.document-preview-root/, 'document surfaces declare an explicit light color scheme')
assert.match(themeCss, /--office-preview-page-border:/, 'Office page boundaries derive from current theme text')

assert.doesNotMatch(toolSources, /(?:text-white\/|border-white\/|bg-white\/|bg-black\/|bg-\[#[0-9a-f]+\]|text-(?:emerald|red|amber|sky|violet)-[123]\d\d)/i, 'tool-call surfaces contain no dark-only neutral or status colors')
assert.match(toolSources, /var\(--surface-divider\)/, 'tool-call borders follow theme surface tokens')
assert.match(toolSources, /var\(--status-success\)/, 'tool-call success states use semantic theme colors')
assert.match(toolSources, /var\(--status-danger\)/, 'tool-call failure states use semantic theme colors')
assert.match(toolSources, /var\(--status-warning\)/, 'tool-call running states use semantic theme colors')
assert.match(toolSources, /var\(--color-text\)/, 'tool-call text contrast is mixed against active theme text')

console.log('Theme-adaptive document and tool surfaces: ok')
