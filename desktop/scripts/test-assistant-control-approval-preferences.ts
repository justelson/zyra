import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clearRetiredAssistantPermissionPreferences } from '../src/renderer/src/pages/assistant/assistant-control-approval-preferences'

class MemoryStorage {
    private readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    removeItem(key: string): void {
        this.values.delete(key)
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
}

const storage = new MemoryStorage()
storage.setItem('zyra:browser-control-approval-preferences:v1', '[{"origin":"https://example.com"}]')
storage.setItem('zyra-ui:full-access-confirm-suppressed:v1', 'true')
storage.setItem('unrelated', 'keep')
clearRetiredAssistantPermissionPreferences(storage)

assert.equal(storage.getItem('zyra:browser-control-approval-preferences:v1'), null)
assert.equal(storage.getItem('zyra-ui:full-access-confirm-suppressed:v1'), null)
assert.equal(storage.getItem('unrelated'), 'keep')

const hookSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAgentControlState.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/renderer/src/pages/settings/BrowserControlSettings.tsx', import.meta.url), 'utf8')
const browserSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx', import.meta.url), 'utf8')

assert.ok(hookSource.includes('clearRetiredAssistantPermissionPreferences()'), 'opening a controlled chat clears retired permission memory')
assert.equal(settingsSource.includes('Forget sites'), false, 'Settings has no remembered-site permission policy')
assert.equal(browserSource.includes('rememberBrowserControlApproval'), false, 'Browser grants do not use remembered-site approvals')

console.log('Retired assistant permission preferences migrate cleanly.')
