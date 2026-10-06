import assert from 'node:assert/strict'
import { revealAssistantStreamText, getAssistantInitialVisibleText } from '../src/renderer/src/pages/assistant/assistant-text-reveal'
assert.equal(revealAssistantStreamText('', 'An unfinished paragraph is arriving', 'chunks', false), '', 'Chunks must not emit partial words or unfinished lines')
assert.equal(revealAssistantStreamText('', 'A complete paragraph.\n\nNext unfinished', 'chunks', false), 'A complete paragraph.\n\n')
assert.equal(revealAssistantStreamText('', 'One line\nNext unfinished', 'chunks', false), 'One line\n', 'A single closed line is a whole chunk')
assert.equal(revealAssistantStreamText('', 'Only one line, now done', 'chunks', true), 'Only one line, now done', 'Completion flushes the final line atomically')
assert.equal(revealAssistantStreamText('Prefix\n', 'Prefix\nFinal suffix', 'chunks', true), 'Prefix\nFinal suffix')
assert.equal(revealAssistantStreamText('', '🙂 whole row\r\nUnfinished', 'chunks', false), '🙂 whole row\r\n')
assert.equal(getAssistantInitialVisibleText('Saved complete response', false, 'chunks'), 'Saved complete response')
assert.equal(getAssistantInitialVisibleText('Arrived\nStill arriving', true, 'chunks'), 'Arrived\n')
assert.equal(revealAssistantStreamText('', '🙂 done', 'stream', false), '🙂')
assert.equal(getAssistantInitialVisibleText('Existing live prefix', true), 'Existing live prefix', 'Reopening live mode never replays history')
console.log('Text reveal: complete paragraph/line chunks, final flush, CRLF/emoji and immediate saved/live reopening passed')
