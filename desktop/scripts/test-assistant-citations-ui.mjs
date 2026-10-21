// Reuse the disposable hidden Electron harness, selecting only the citation fixture.
process.argv.push('--citations')
await import('./test-code-selection-toolbar.mjs')
