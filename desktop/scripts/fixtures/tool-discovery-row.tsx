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
    root.render(<section><p style={{ fontSize: 13, color: '#aaa' }}>Available tools</p>
        {['tool_search', 'browser_use', 'zyra_tool_search'].map((name, index) => <TimelineToolCallList key={name} activities={[activity(name, index === 1 ? 'running' : 'completed')]} />)}
        <TimelineToolCallList activities={[activity('tool_search', 'failed')]} />
    </section>)
    await settled()
    check(host.scrollWidth <= host.clientWidth, 'Rows fit the viewport')
    return results
})()
