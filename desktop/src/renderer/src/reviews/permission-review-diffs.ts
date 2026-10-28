type PreviewLine = readonly [kind: ' ' | '+' | '-', text: string]

// Fictional patches for the isolated layout preview, never read from the working tree.
export function permissionReviewDiff(displayPath: string) {
    const lines: PreviewLine[] = displayPath.endsWith('.css') ? [
        [' ', '.composer {'], ['-', '  gap: 16px;'], ['+', '  gap: 8px;'],
        ['-', '  padding: 20px;'], ['+', '  padding: 12px;'], [' ', '}'],
    ] : displayPath.includes('test') ? [
        [' ', "import { describe, expect, it } from 'vitest'"],
        [' ', "import { normalizeSettings } from './settings'"],
        [' ', ''],
        [' ', "describe('settings', () => {"],
        ...Array.from({ length: 12 }, (_, index): PreviewLine[] => [
            ['+', `  it('keeps the draft for request ${index + 1}', () => {`],
            ['+', `    const settings = normalizeSettings({ timeout: ${1000 + index * 100} })`],
            ['+', '    expect(settings.keepDraft).toBe(true)'],
            ['+', '  })'],
        ]).flat(),
        [' ', '})'],
    ] : [
        [' ', "import { useState } from 'react'"],
        ['+', "import { PreviewSettings } from './settings'"],
        [' ', ''],
        [' ', 'export function App() {'],
        ['-', '  const timeout = 1000'],
        ['+', '  const timeout = 5000'],
        ['+', '  const [keepDraft, setKeepDraft] = useState(true)'],
        [' ', ''],
        [' ', '  return ('],
        ['-', '    <main className="page">'],
        ['+', '    <main className="page compact">'],
        [' ', '      <h1>Project workspace</h1>'],
        ['+', '      <PreviewSettings'],
        ['+', '        timeout={timeout}'],
        ['+', '        keepDraft={keepDraft}'],
        ['+', '        onKeepDraftChange={setKeepDraft}'],
        ['+', '      />'],
        [' ', '    </main>'],
        [' ', '  )'],
        [' ', '}'],
    ]
    const additions = lines.filter(([kind]) => kind === '+').length
    const deletions = lines.filter(([kind]) => kind === '-').length
    const oldCount = lines.length - additions
    const newCount = lines.length - deletions
    const patch = [`diff --git a/${displayPath} b/${displayPath}`, `--- a/${displayPath}`, `+++ b/${displayPath}`, `@@ -1,${oldCount} +1,${newCount} @@`, ...lines.map(([kind, text]) => kind + text)].join('\n')
    return { patch, additions, deletions }
}
