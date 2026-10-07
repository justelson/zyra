import assert from 'node:assert/strict'
import { loadSettings } from '../src/renderer/src/lib/settings'

assert.equal(loadSettings({ settingsSchemaVersion: 5 }).assistantAgentInboxSidebarEnabled, true, 'new users start with Agent Inbox')
assert.equal(loadSettings({ settingsSchemaVersion: 5, assistantAgentInboxSidebarEnabled: false }).assistantAgentInboxSidebarEnabled, false, 'an explicit saved opt-out remains off')
assert.equal(loadSettings({ settingsSchemaVersion: 5, assistantAgentInboxSidebarEnabled: true }).assistantAgentInboxSidebarEnabled, true)
assert.equal(loadSettings({ settingsSchemaVersion: 5, assistantAgentInboxSidebarEnabled: 'false' }).assistantAgentInboxSidebarEnabled, true, 'invalid stored values use the current default')
console.log('Agent Inbox defaults and saved choices: ok')
