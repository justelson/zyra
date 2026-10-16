import assert from 'node:assert/strict'
import type { AssistantMessage } from '../src/shared/assistant/contracts'
import { visibleSkillContextMessages } from '../src/shared/assistant/skill-context-presentation'

const message = (id: string, text: string): AssistantMessage => ({ id, role: 'user', text, turnId: null, streaming: false, createdAt: '2026-10-13T16:10:00Z', updatedAt: '2026-10-13T16:10:00Z' })
const invocation = message('local-user', '/skill:background-terminals whats this for?')
const expanded = message('assistant-message-user-zyra-message:user:2', 'Use the background-terminals skill for this request.\n\nSkill location: C:\\fixture\\skills\\background-terminals\\SKILL.md\n\n# Internal instructions\n\nUser: whats this for?')
const history = [invocation, expanded]
assert.deepEqual(visibleSkillContextMessages(history), [invocation], 'A paired native expansion leaves only the original skill invocation visible')
assert.equal(history.length, 2, 'Historical data remains unchanged')
for (const candidate of [
    message('real-user-quote', expanded.text),
    message(expanded.id, expanded.text.replace('whats this for?', 'different request')),
    message(expanded.id, expanded.text.replace('background-terminals skill', 'another-skill skill')),
    message(expanded.id, expanded.text.replace('C:\\fixture\\skills\\background-terminals\\SKILL.md', 'not-a-skill-path'))
]) {
    const messages = [invocation, candidate]
    assert.equal(visibleSkillContextMessages(messages), messages, 'Unproven or independently authored messages remain visible')
}
const standalone = [expanded]
assert.equal(visibleSkillContextMessages(standalone), standalone, 'A standalone quoted instruction is never hidden by its content alone')
console.log('Legacy skill context presentation: paired native expansion hidden; user text and history preserved')
