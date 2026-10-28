import assert from 'node:assert/strict'
import { formatQuestionDate, parseQuestionDate, questionCalendarDays, shiftQuestionMonth } from '../src/renderer/src/pages/assistant/assistant-question-date'
import { isAssistantUserInputAnswerComplete } from '../src/renderer/src/pages/assistant/assistant-pending-user-input'

for (const iso of ['2026-10-22', '2024-02-29', '2000-02-29', '0099-01-01', '0001-01-01', '9999-12-31']) {
    assert.equal(formatQuestionDate(parseQuestionDate(iso)!), iso, `Local calendar date round-trips: ${iso}`)
}
for (const iso of ['', '2026-02-29', '2026-02-31', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '2026-1-1', 'tomorrow', '2026-01-01T00:00:00Z']) {
    assert.equal(parseQuestionDate(iso), null, `Invalid date is rejected: ${iso}`)
}
assert.equal(formatQuestionDate(shiftQuestionMonth(parseQuestionDate('2024-01-31')!, 1)), '2024-02-29')
assert.equal(formatQuestionDate(shiftQuestionMonth(parseQuestionDate('2026-01-31')!, 1)), '2026-02-28')
assert.equal(formatQuestionDate(shiftQuestionMonth(parseQuestionDate('2024-02-29')!, 12)), '2025-02-28')
assert.equal(formatQuestionDate(shiftQuestionMonth(parseQuestionDate('2026-01-15')!, -1)), '2025-12-15')
const days = questionCalendarDays(parseQuestionDate('2024-02-15')!)
assert.equal(days.length, 42)
assert.equal(days[0].getDay(), 0)
assert.equal(days[41].getDay(), 6)
assert.equal(new Set(days.map(formatQuestionDate)).size, 42)
assert(days.some(day => formatQuestionDate(day) === '2024-02-29'))
const question = { id: 'date', header: 'Date', question: 'When?', type: 'date', options: [], required: true } as const
assert.equal(isAssistantUserInputAnswerComplete({ ...question, options: [] }, '2026-02-31', true), false)
assert.equal(isAssistantUserInputAnswerComplete({ ...question, options: [] }, '2024-02-29', true), true)
assert.equal(isAssistantUserInputAnswerComplete({ ...question, options: [] }, '', true), false)
assert.equal(isAssistantUserInputAnswerComplete({ ...question, options: [], required: false }, '', true), true)
console.log('PASS: local date round-trips, leap years, invalid dates, month/year shifts, calendar grid and answer validation')
