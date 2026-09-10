import assert from 'node:assert/strict'
import { startAccountOverviewPolling } from '../src/renderer/src/pages/settings/account-overview-polling'

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function fixture() {
    const timers = new Map<number, () => void>()
    const requests: boolean[] = []
    let nextId = 0, visible = true, settle: (() => void) | null = null
    const options = {
        intervalMs: 60_000,
        isVisible: () => visible,
        refresh: (force: boolean) => {
            requests.push(force)
            return new Promise<void>(resolve => { settle = resolve })
        },
        setTimer: (callback: () => void, delay: number) => { assert.equal(delay, 60_000); const id = ++nextId; timers.set(id, callback); return id },
        clearTimer: (id: number) => { timers.delete(id) }
    }
    return { options, timers, requests, hide: () => { visible = false }, show: () => { visible = true }, settle: () => settle?.(), tick: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } } }
}
{
    const f = fixture(), polling = startAccountOverviewPolling(f.options)
    polling.dispose(); await flush()
    assert.equal(f.requests.length, 0, 'StrictMode cleanup before startup cannot launch abandoned work')
    assert.equal(f.timers.size, 0)
}
{
    const f = fixture(), polling = startAccountOverviewPolling(f.options)
    await flush(); assert.deepEqual(f.requests, [false])
    polling.refreshIfVisible(); polling.refreshIfVisible()
    assert.equal(f.requests.length, 1, 'visibility events coalesce with the initial pending read')
    polling.dispose(); f.settle(); await flush()
    assert.equal(f.timers.size, 0, 'a pending read cannot restart polling after navigation')
    polling.refreshIfVisible(); f.tick(); await flush()
    assert.equal(f.requests.length, 1, 'an unmounted Account page never refreshes again')
}
{
    const f = fixture(), polling = startAccountOverviewPolling(f.options)
    await flush(); f.settle(); await flush()
    assert.equal(f.timers.size, 1)
    f.hide(); f.tick(); await flush()
    assert.deepEqual(f.requests, [false], 'hidden tabs do not poll account endpoints')
    assert.equal(f.timers.size, 1)
    f.show(); polling.refreshIfVisible(); await flush()
    assert.deepEqual(f.requests, [false, false], 'returning to a visible tab honors the normal freshness cache')
    f.settle(); await flush(); f.tick(); await flush()
    assert.deepEqual(f.requests, [false, false, true], 'scheduled refresh remains authoritative')
    polling.dispose(); f.settle(); await flush()
    assert.equal(f.timers.size, 0, 'in-flight scheduled refresh also stays stopped after unmount')
}
{
    const f = fixture()
    const polling = startAccountOverviewPolling({ ...f.options, refresh: async () => { throw Error('fixture offline') } })
    await flush(); assert.equal(f.timers.size, 1, 'failed reads retain the quiet retry cadence')
    polling.dispose(); assert.equal(f.timers.size, 0)
}
console.log('Account polling: zero requests/timers after unmount, single-flight visibility, hidden-page quietness and bounded retries: ok')
