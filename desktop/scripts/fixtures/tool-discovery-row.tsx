import { createRoot } from 'react-dom/client'
import type { AssistantActivity } from '../../src/shared/assistant/contracts'
import { TimelineToolCallList } from '../../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'

const host = document.createElement('main')
host.style.cssText = 'max-width:760px;margin:32px auto;padding:0 16px'
document.body.append(host)
const root = createRoot(host)
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const settled = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
const activity = (name: string, status = 'completed'): AssistantActivity => ({
    id: name, kind: name === 'browser_use' ? 'browser-control' : 'tool-call', tone: 'tool',
    summary: 'Private loader details', turnId: 'fixture-turn', createdAt: '2026-10-27T12:00:00Z',
    payload: { toolName: name, args: { action: 'load', query: 'Windows computer use' }, status,
        output: 'PRIVATE TOOL DEFINITIONS', historyBodyRef: { private: 'must not hydrate' } }
})
;(globalThis as any).__toolDiscoveryCheck = (async () => {
    const results: string[] = []
    for (const mode of ['minimal', 'detailed'] as const) {
        for (const name of ['tool_search', 'zyra_tool_search', 'browser_use']) {
            for (const status of ['running', 'completed', 'failed']) {
                root.render(<TimelineToolCallList activities={[activity(name, status)]} displayMode={mode} />)
                await settled()
                const row = host.querySelector<HTMLButtonElement>('[data-assistant-action-row]')!
                check(row?.disabled, `${name}/${mode}/${status} is a plain non-interactive row`)
                check(row.textContent?.includes(status === 'failed' ? "Couldn't get available tools" : 'Getting available tools'), 'Plain label matches lifecycle')
                check(!host.querySelector('[aria-expanded], pre'), 'Discovery has no details disclosure or payload')
                row.click()
                await settled()
                check(!host.textContent?.includes('PRIVATE') && !host.querySelector('[aria-expanded]'), 'Clicking cannot expose definitions')
                check(row.getBoundingClientRect().height < 42, 'Discovery occupies one compact row')
            }
        }
        const ordinary = (id: string): AssistantActivity => ({
            id: `${mode}-${id}`, kind: 'command', tone: 'tool', turnId: 'fixture-turn', createdAt: '2026-10-27T12:00:00Z',
            summary: 'Fixture command', payload: { toolName: 'exec_command', command: 'echo fixture', status: 'completed', actionBatchIntent: 'Checking fixture actions' }
        })
        const before = [ordinary('before-one'), ordinary('before-two')]
        const after = [ordinary('after-one'), ordinary('after-two')]
        root.render(<TimelineToolCallList activities={before} displayMode={mode} />)
        await settled()
        const firstBatch = host.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')!
        check(firstBatch?.getAttribute('aria-expanded') === 'false', 'Ordinary actions start collapsed')
        const loader = { ...activity('tool_search'), id: `${mode}-loader` }
        root.render(<TimelineToolCallList activities={[...before, loader]} displayMode={mode} />)
        await settled()
        check(host.querySelector('[data-assistant-action-batch-trigger]') === firstBatch, 'Appending a loader preserves the existing batch DOM identity')
        check(firstBatch.getAttribute('aria-expanded') === 'false', 'Appending a loader preserves its collapsed state')
        check(!host.textContent?.includes('Getting available tools'), 'Discovery is inside the collapsed work block')
        firstBatch.click()
        await settled()
        root.render(<TimelineToolCallList activities={[...before, loader, ...after]} displayMode={mode} />)
        await settled()
        const batches = host.querySelectorAll<HTMLButtonElement>('[data-assistant-action-batch-trigger]')
        check(batches.length === 1 && batches[0] === firstBatch, 'Actions on both sides of the loader share one stable batch')
        check(firstBatch.getAttribute('aria-expanded') === 'true' && host.textContent?.includes('Getting available tools'), 'Streaming keeps the reader choice and quiet discovery row visible')
        for (const kind of ['thread-message', 'thread-collaboration'] as const) {
            root.render(<TimelineToolCallList activities={[...before, { id: kind, kind, tone: 'tool', summary: 'Fixture message boundary', createdAt: before[0]!.createdAt }, ...after]} displayMode={mode} />)
            await settled()
            check(host.querySelectorAll('[data-assistant-action-batch-trigger]').length === 2, 'Message boundaries preserve neighboring action batches')
        }
        const controls = ['one', 'two'].map(id => ({ ...ordinary(`control-${id}`), kind: 'browser-control' as const, payload: {
            toolName: 'browser_act', status: 'completed', args: { action: { type: 'click' } }
        } }))
        root.render(<TimelineToolCallList activities={controls} displayMode={mode} />)
        await settled()
        const controlBatch = host.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')!
        check(controlBatch, 'Consecutive browser controls keep their own batch')
        controlBatch.click()
        await settled()
        root.render(<TimelineToolCallList activities={[...controls, loader]} displayMode={mode} />)
        await settled()
        const outer = host.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')!
        check(outer.getAttribute('aria-expanded') === 'true' && host.querySelector('[data-assistant-control-run] button') === controlBatch && controlBatch.getAttribute('aria-expanded') === 'true', 'Appending a loader preserves the expanded outer shell and nested control batch')
        results.push(`${mode}: streamed loaders join one block and preserve nested batches, disclosure state and message boundaries`)
        results.push(`${mode}: current/legacy browser and computer discovery stays plain through running, completion and failure`)
    }
    const control: AssistantActivity = { ...activity('browser_act'), kind: 'browser-control', payload: {
        toolName: 'browser_act', status: 'completed', args: { action: { type: 'click' } }, output: 'Actual control result'
    } }
    root.render(<TimelineToolCallList activities={[control]} />)
    await settled()
    const action = host.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!
    check(action, 'Real browser actions keep their disclosure')
    action.click()
    await settled()
    check(host.querySelector('[aria-expanded="true"]') && host.textContent?.includes('Actual control result'), 'Real action details still open')
    results.push('Real browser control details remain expandable')
    const work = (id: string): AssistantActivity => ({ ...activity('exec_command'), id, kind: 'command', payload: {
        toolName: 'exec_command', status: 'completed', command: 'echo fixture', actionBatchIntent: 'Styling and checking the page'
    } })
    root.render(<section><p style={{ fontSize: 13, color: '#aaa' }}>Consecutive work, including tool discovery</p>
        <TimelineToolCallList activities={[work('styling'), activity('tool_search'), work('checking')]} />
        <p style={{ fontSize: 13, color: '#aaa', marginTop: 24 }}>Discovery on its own</p>
        {['tool_search', 'browser_use', 'zyra_tool_search'].map((name, index) => <TimelineToolCallList key={name} activities={[activity(name, index === 1 ? 'running' : 'completed')]} />)}
        <TimelineToolCallList activities={[activity('tool_search', 'failed')]} />
    </section>)
    await settled()
    check(host.scrollWidth <= host.clientWidth, 'Rows fit the viewport')
    return results
})()
