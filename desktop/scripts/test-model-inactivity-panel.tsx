import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    AssistantModelInactivityPanel,
    getModelInactivityDeadline,
    MODEL_INACTIVITY_DELAY_MS,
    type AssistantModelInactivityProgress
} from '../src/renderer/src/pages/assistant/AssistantModelInactivityPanel'

const progress: AssistantModelInactivityProgress = {
    requestId: 'model-request-fixture', startedAt: 1_000, lastActivityAt: 2_000,
    phase: 'waiting', canPing: true
}
const originalNow = Date.now
let now = 2_000
Date.now = () => now
let calls = 0
const render = (snapshot: AssistantModelInactivityProgress | null = progress, turnId: string | null = 'turn-fixture') =>
    renderToStaticMarkup(<AssistantModelInactivityPanel progress={snapshot} turnId={turnId}
        onPing={async () => { calls++ }} onStop={async () => { calls++ }} />)

try {
    assert.equal(MODEL_INACTIVITY_DELAY_MS, 120_000)
    assert.equal(render(), '', 'no early reminder')
    now = 121_999
    assert.equal(render(), '', 'not visible one millisecond before two minutes of silence')
    now = 122_000
    const html = render()
    assert.ok(html.includes('No model activity received for 2 minutes.'))
    assert.ok(html.includes('>Stop</button>'))
    assert.ok(html.includes('>Ping</button>'))
    assert.ok(html.includes('>Keep waiting</button>'))
    assert.equal((html.match(/<button /g) || []).length, 3)
    assert.ok(!html.includes(progress.requestId), 'request identity stays out of user-facing copy')
    assert.doesNotMatch(html, /autofocus|role="dialog"|aria-modal|backdrop/i, 'non-modal and no focus theft')
    assert.ok(html.includes('data-assistant-composer-hitbox="true"'))

    now = 9_000_000
    assert.equal(render(null), '', 'no model request means no timer for tools, compaction or idle')
    assert.equal(render(progress, null), '', 'no active turn means no reminder')
    assert.equal(render({ ...progress, lastActivityAt: now }), '', 'fresh activity resets the silence clock')
    assert.equal(render({ ...progress, requestId: 'next', startedAt: now, lastActivityAt: now }), '', 'new request gets its own clock')
    assert.equal(render({ ...progress, lastActivityAt: Number.NaN }), '', 'invalid timestamps fail closed')
    for (const phase of ['waiting', 'streaming', 'recovering'] as const) {
        assert.ok(render({ ...progress, phase }).includes('No model activity'), phase + ' is eligible')
    }
    const recovering = render({ ...progress, phase: 'recovering' })
    assert.ok(recovering.includes('Pinging the model…'), 'canonical recovery is acknowledged')
    assert.match(recovering, /<button[^>]*disabled=""[^>]*>Ping<\/button>/, 'no duplicate Ping during recovery')
    assert.ok(recovering.includes('>Stop</button>'), 'canonical recovery leaves Stop available')
    const recoveringWithoutPing = render({ ...progress, phase: 'recovering', canPing: false })
    assert.ok(recoveringWithoutPing.includes('Pinging the model…'))
    assert.ok(!recoveringWithoutPing.includes('Ping is available before'), 'recovery does not imply partial output')
    assert.ok(!recoveringWithoutPing.includes('aria-describedby'), 'recovery has no dangling partial-output description')
    const partial = render({ ...progress, canPing: false })
    assert.match(partial, /<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"[^>]*>Ping<\/button>/)
    assert.ok(partial.includes('Ping is available before the model starts an answer or tool call.'))
    assert.ok(partial.includes('>Stop</button>') && partial.includes('>Keep waiting</button>'))
    assert.equal(calls, 0, 'rendering never pings or stops')

    assert.equal(getModelInactivityDeadline(progress), 122_000)
    const snooze = now + MODEL_INACTIVITY_DELAY_MS
    assert.equal(getModelInactivityDeadline(progress, snooze), snooze, 'Keep waiting extends this request by two minutes')
    assert.ok(now < getModelInactivityDeadline(progress, snooze), 'snooze hides the reminder immediately')
    assert.equal(snooze, getModelInactivityDeadline(progress, snooze), 'snooze expires, it is not permanent dismissal')
    assert.equal(getModelInactivityDeadline({ ...progress, lastActivityAt: snooze + 1 }, snooze), snooze + 120_001,
        'new activity always owns the deadline')
    assert.equal(getModelInactivityDeadline({ ...progress, startedAt: 3_000, lastActivityAt: 2_000 }), 123_000,
        'clock cannot start before the request')

    const css = await readFile(new URL('../src/renderer/src/pages/assistant/assistant-model-inactivity.css', import.meta.url), 'utf8')
    assert.ok(html.includes('data-composer-drawer="true"'), 'uses the actual skills/files drawer surface')
    assert.ok(html.includes('bottom-full') && html.includes('-mb-[17px]'), 'tucks 17px behind the composer instead of a spaced sibling card')
    assert.doesNotMatch(css, /border-radius: 12px|background: var\(--color-card\)|margin: 0 auto/, 'the shared drawer owns the surface and seam')
    assert.ok(css.includes('flex-wrap: wrap') && css.includes(':focus-visible'), 'narrow wrapping and keyboard focus styling')
    assert.doesNotMatch(css, /position:\s*(fixed|absolute)|z-index/, 'ordinary composer flow, no viewport overlay')
    console.log('Model inactivity panel: SSR visibility, request clocks, finite snooze, disabled Ping, non-modal controls: ok')
} finally {
    Date.now = originalNow
}
