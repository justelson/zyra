import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isZyraAppToolActivity } from '../src/renderer/src/pages/assistant/assistant-app-tool'
import type { AssistantActivity } from '../src/shared/assistant/contracts'
const activity = (toolName: string, kind = 'tool-call') => ({ id: 'test', kind, tone: 'tool', summary: 'Test', turnId: null, createdAt: '', payload: { toolName } }) as AssistantActivity
for (const tool of ['settings', 'settings_action', 'app', 'usage', 'context', 'functions.settings', 'zyra.app']) assert.equal(isZyraAppToolActivity(activity(tool)), true, tool)
for (const tool of ['read', 'bash', 'plugin_mcp', 'browser_use', 'my_settings_tool', 'set_chat_title']) assert.equal(isZyraAppToolActivity(activity(tool)), false, tool)
const source = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineToolCallCard.tsx', import.meta.url), 'utf8')
assert.match(source, /isZyraAppToolActivity\(activity\)\) return <Settings size=\{13\}/)
assert.match(source, /return <Wrench size=\{13\}/)
console.log('App operation icon classification and gear/wrench rendering wiring: ok')
