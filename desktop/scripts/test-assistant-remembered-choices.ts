import assert from 'node:assert/strict'
import { ASSISTANT_REMEMBERED_CHOICES_KEY, readRememberedChoices, rememberComposerChoices } from '../src/renderer/src/pages/assistant/assistant-remembered-choices'
import { resolveAssistantComposerLaunchConfiguration } from '../src/renderer/src/pages/assistant/assistant-new-chat-composer-config'
const data = new Map<string, string>()
;(globalThis as any).localStorage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) }
data.set('devscope-settings', JSON.stringify({ assistantDefaultModel: 'old', assistantDefaultEffort: 'medium', assistantDefaultRuntimeMode: 'approval-required' }))
assert.deepEqual(readRememberedChoices(), { model: 'old', effort: 'medium', runtimeMode: 'approval-required' })
rememberComposerChoices({ model: 'chosen', effort: 'high', runtimeMode: 'full-access' })
const firstDraft = readRememberedChoices()
rememberComposerChoices({ ...readRememberedChoices(), effort: 'low' })
assert.equal(firstDraft.effort, 'high', 'A created chat owns its copied preferences')
assert.equal(readRememberedChoices().effort, 'low', 'An explicit control change is synchronous before New chat')
data.set('devscope-settings', JSON.stringify({ assistantDefaultModel: 'stale-settings', assistantDefaultEffort: 'off', assistantDefaultRuntimeMode: 'approval-required' }))
assert.equal(readRememberedChoices().model, 'chosen', 'Legacy defaults never overwrite an explicit choice')
const before = data.get(ASSISTANT_REMEMBERED_CHOICES_KEY)
const settings = { assistantDefaultModel: 'ignored', assistantDefaultEffort: 'medium' as const, assistantDefaultRuntimeMode: 'approval-required' as const, assistantDefaultFastMode: false }
const oldChat = { model: 'old-chat', thinking: 'medium', runtimeMode: 'edits-only' } as any
const viewed = resolveAssistantComposerLaunchConfiguration({ useSettingsDefaults: false, settings, thread: oldChat })
assert.equal(viewed.activeModel, 'old-chat')
assert.equal(data.get(ASSISTANT_REMEMBERED_CHOICES_KEY), before, 'Viewing a chat is not a deliberate preference update')
const launched = resolveAssistantComposerLaunchConfiguration({ useSettingsDefaults: true, settings, thread: { model: firstDraft.model, thinking: firstDraft.effort, runtimeMode: firstDraft.runtimeMode } as any })
assert.equal(launched.activeModel, 'chosen')
assert.equal(launched.activeEffort, 'high', 'New draft and first Send retain their creation copy despite newer preferences')
assert.equal(launched.runtimeMode, 'full-access')
assert.equal(readRememberedChoices().model, 'chosen', 'Reading after restart restores the last chosen value')
assert.throws(() => rememberComposerChoices({ model: 'x', effort: 'invalid', runtimeMode: 'root' } as any), /Invalid/)
console.log('Remembered composer choices: one-time migration, immediate choice, copied drafts, old-chat navigation, restart and validation passed')
