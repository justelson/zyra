import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (file: string) => readFileSync(new URL(`../src/renderer/src/pages/assistant/${file}`, import.meta.url), 'utf8')
const page = source('AssistantPage.tsx')
const panel = source('AssistantDiffPanel.tsx')
assert.match(page, /import \{ AssistantDiffPanel,/)
assert.doesNotMatch(page, /loadAssistantDiffPanel|Opening inspector/, 'opening cannot wait on an empty lazy panel')
assert.match(panel, /const AssistantTurnReview = lazy/)
assert.doesNotMatch(panel, /import \{ AssistantTurnReview \} from/, 'heavy diff rendering must stay off the shell startup path')
assert.equal((panel.match(/<Suspense fallback=\{<PreviewContentSkeleton label="Opening turn"/g) || []).length, 2, 'both detailed review surfaces suspend inside the shell')
assert.match(panel, /const AssistantBrowserWorkspace = lazy/)
assert.match(panel, /const AssistantTerminalWorkspace = lazy/)
assert.match(panel, /const AssistantFilesWorkspace = lazy/)
assert.match(page, /inspectorMounted \|\| inspectorOpen/, 'opening stays mounted for quick repeated access')
console.log('Eager shell and isolated heavy workspace boundaries passed')
