import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildZyraMonacoWidgetColors } from '../src/renderer/src/lib/monaco/zyra-widget-theme'

const dark = buildZyraMonacoWidgetColors({
    isLightTheme: false,
    text: '#f0f4f8',
    textSecondary: '#7e92a9',
    card: '#131c2c',
    background: '#0c121f',
    border: '#1f2a3d',
    accent: '#3b82f6'
})

assert.equal(dark['menu.background'], '#131c2c')
assert.equal(dark['menu.foreground'], '#f0f4f8')
assert.equal(dark['menu.selectionBackground'], '#3b82f62b')
assert.equal(dark['menu.border'], '#1f2a3d')
assert.equal(dark['quickInput.background'], '#131c2c')
assert.equal(dark['quickInputTitle.background'], '#0c121f')
assert.equal(dark['quickInputList.focusBackground'], '#3b82f62b')
assert.equal(dark['input.background'], '#0c121f')
assert.equal(dark['focusBorder'], '#3b82f6')
assert.equal(dark['keybindingLabel.foreground'], '#7e92a9')
assert.equal(dark['widget.shadow'], '#00000070')

const light = buildZyraMonacoWidgetColors({
    isLightTheme: true,
    text: '#1e293b',
    textSecondary: '#64748b',
    card: '#ffffff',
    background: '#f9fafb',
    border: '#e2e8f0',
    accent: '#2563eb'
})
assert.equal(light['menu.selectionBackground'], '#2563eb1f')
assert.equal(light['quickInputList.focusIconForeground'], '#2563eb')
assert.equal(light['widget.shadow'], '#00000029')

const previewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/MonacoPreviewEditor.tsx', import.meta.url), 'utf8')
assert.match(previewSource, /\.\.\.buildZyraMonacoWidgetColors\(\{/)

console.log('Monaco built-in widget theme: ok')
