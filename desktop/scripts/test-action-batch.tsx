import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ASSISTANT_ACTION_ICON_CLASS, ASSISTANT_ACTION_ROW_CLASS } from '../src/renderer/src/pages/assistant/assistant-action-row-layout'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantActivity } from '../src/shared/assistant/contracts'

mock.module('../src/renderer/src/lib/settings', () => ({ useSettings: () => ({ settings: { assistantShowActionStats: false } }) }))
const { AssistantTimelineActionBatch } = await import('../src/renderer/src/pages/assistant/AssistantTimelineActionBatch')
const edit = (id: string, additions: number, deletions: number, status = 'completed'): AssistantActivity => ({
    id, kind: 'file-change', tone: 'tool', summary: 'Edited file', createdAt: '2026-09-29T12:00:00Z',
    payload: { additions, deletions, status, actionBatchIntent: 'Updating settings' }
})
const render = (activities: AssistantActivity[]) => renderToStaticMarkup(<AssistantTimelineActionBatch activities={activities}>
    {Array.from({ length: 150 }, (_, index) => <div key={index} data-fixture-action={index}>Action {index}</div>)}
</AssistantTimelineActionBatch>)
const html = render([edit('one', 12, 4), edit('two', 8, 2), edit('failed', 100, 100, 'failed'), edit('running', 100, 100, 'running')])
const trigger = html.split('data-assistant-action-batch-trigger="true"')[1]!.split('</button>')[0]!
assert.match(trigger, /data-assistant-action-diff-stats="true"/, 'collapsed titles expose edit totals without enabling Action statistics')
assert.match(trigger, /data-diff-additions="20"/)
assert.match(trigger, /data-diff-deletions="6"/)
assert.match(trigger, /data-rolling-diff-number="20"/)
assert.match(trigger, /data-rolling-diff-number="6"/)
assert.match(trigger, /var\(--status-success\)/)
assert.match(trigger, /var\(--status-danger\)/)
assert.match(trigger, /aria-label="20 lines added, 6 lines removed"/)
assert.match(trigger, /Failed action in batch/, 'failure indicator survives the change summary')
assert.match(html, /data-assistant-action-batch-scroll="true"/)
assert.match(html, /overflow-y-auto overscroll-y-contain/)
assert.match(html, /max-height:min\(16rem, 35vh\)/)
assert.ok(html.includes(ASSISTANT_ACTION_ROW_CLASS))
assert.ok(html.includes(ASSISTANT_ACTION_ICON_CLASS))
for (const name of ['AssistantTimelineActionShell', 'AssistantTimelineToolCallCard', 'AssistantTimelineNetworkRecovery']) {
    const source = readFileSync(new URL(`../src/renderer/src/pages/assistant/${name}.tsx`, import.meta.url), 'utf8')
    assert.match(source, /ASSISTANT_ACTION_ROW_CLASS/, `${name} uses the same padding, height and gap`)
    assert.match(source, /ASSISTANT_ACTION_ICON_CLASS/, `${name} centers its icon in the same fixed slot`)
}
assert.doesNotMatch(readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineToolCallCard.tsx', import.meta.url), 'utf8'), /assistant-tool-call-card px-/, 'tool cards do not add extra horizontal padding outside the common row grid')
assert.match(html, /tabindex="0"/, 'expanded list supports keyboard scrolling')
assert.equal((html.match(/data-fixture-action=/g) || []).length, 150, 'the list retains every item, with no pagination or last-N slice')
assert.doesNotMatch(html, /Show more|Next page|Load more/)
assert.doesNotMatch(render([edit('failed', 12, 4, 'failed')]).split('data-assistant-action-batch-trigger="true"')[1]!.split('</button>')[0]!, /data-assistant-action-diff-stats/, 'failed edits do not report applied changes')
assert.doesNotMatch(render([edit('zero', 0, 0)]), /data-assistant-action-diff-stats/, 'zero line changes do not add empty counters')
assert.doesNotMatch(render([{ ...edit('read', 50, 50), kind: 'file-read' }]), /data-assistant-action-diff-stats/, 'only file changes contribute')
assert.doesNotMatch(render([{ ...edit('unknown', 0, 0), payload: { status: 'completed' } }]), /data-assistant-action-diff-stats/, 'unknown counts are not invented')
const managedServer: AssistantActivity = {
    ...edit('server', 0, 0, 'running'), kind: 'command',
    payload: { status: 'running', jobId: 'cmd-server', background: true, toolLifecyclePhase: 'end', command: 'npm run dev', actionBatchIntent: 'Starting the preview' }
}
assert.doesNotMatch(render([managedServer]), /assistant-title-shimmer|motion-safe:animate-spin/, 'a background server cannot keep the finished action batch Working')
assert.match(render([managedServer]), /data-settled-action-intent="Starting the preview"/)
assert.match(render([{ ...managedServer, kind: 'command.checkpoint', payload: { ...managedServer.payload, background: false, toolLifecyclePhase: 'start' } }]), /assistant-title-shimmer/, 'a real foreground status check still shows progress')
console.log('Action batch: successful edit totals, semantic colors, bounded keyboard-scrollable full list and preserved failures: ok')
