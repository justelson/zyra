import React, { useEffect, useState } from 'react'
import { assistantStore } from '../../src/renderer/src/lib/assistant/assistant-store-core'
import { subscribeCodeContext } from '../../src/renderer/src/pages/assistant/assistant-code-context'
import { subscribeVisualizationContextRouting, useSavedVisualization } from '../../src/renderer/src/pages/assistant/visualization-context'
import { SettingsProvider } from '../../src/renderer/src/lib/settings'
import { createRoot } from 'react-dom/client'
import { VisualizationResourceView } from '../../src/renderer/src/components/ui/visualization-resource/VisualizationResourceView'
import { Scene3DViewer } from '../../src/renderer/src/components/ui/scene3d/Scene3DViewer'
import { VisualizationMessage } from '../../src/renderer/src/components/ui/visualization/VisualizationMessage'
import { AssistantMessageMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import { VisualizationThreadContext } from '../../src/renderer/src/components/ui/visualization/visualization-thread-context'
import { AssistantResourcesWorkspace } from '../../src/renderer/src/pages/assistant/AssistantResourcesWorkspace'
import type { VisualizationResource } from '../../src/shared/visualization-resources'

const scene = JSON.stringify({ schemaVersion: 1, grid: true, objects: [
    { id: 'cube', type: 'box', name: 'Purple cube', position: [-2, 0.5, 0], color: '#a58aff' },
    { id: 'sphere', type: 'sphere', name: 'Teal sphere', position: [0, 0.6, 0], radius: 0.6, color: '#39cbb3' },
    { id: 'pyramid', type: 'pyramid', name: 'Amber pyramid', position: [2, 0, 0], color: '#ffc75b' },
    { id: 'ufo', type: 'group', name: 'UFO', position: [0, 2.3, 0] },
    { id: 'saucer', type: 'sphere', name: 'Pink saucer', parentId: 'ufo', scale: [1.5, 0.22, 1.5], color: '#e98ec8' },
    { id: 'dome', type: 'sphere', name: 'Glass dome', parentId: 'ufo', position: [0, 0.25, 0], radius: 0.4, opacity: 0.6, color: '#a9e5ef' },
], camera: { position: [7, 5, 9], target: [0, 0.9, 0] } }, null, 2)
const id = '12345678-1234-4123-8123-123456789abc'
const html: VisualizationResource = { id, kind: 'html', title: 'Traffic comparison', summary: 'Illustrative weekly visits', threadId: 'fixture-canonical', latestVersion: 2, createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z', versions: [
    { version: 1, parentVersion: null, title: 'Traffic comparison', summary: 'Illustrative visits', height: 240, createdAt: '2026-01-01T12:00:00.000Z', changeNote: 'First version', origin: { threadId: 'fixture-canonical', messageId: 'fixture-origin', offset: 0, turnId: 'fixture-origin-turn' }, source: '<style>.row { display: flex; gap: 12px; align-items: center; margin: 12px 0; } .bar { height: 22px; background: var(--viz-series-1); }</style>\n<div class="row"><span>Week one</span><div class="bar" style="width: 40%"></div><span>40 visits</span></div>\n<p>Original snapshot</p>' },
    { version: 2, parentVersion: 1, title: 'Traffic comparison', summary: 'Illustrative updated visits', height: 240, createdAt: '2026-01-02T12:00:00.000Z', changeNote: 'Added second week', source: '<style>.row { display: flex; gap: 12px; align-items: center; margin: 12px 0; } .bar { height: 22px; background: var(--viz-series-1); }</style>\n<div class="row"><span>Week one</span><div class="bar" style="width: 40%"></div><span>40 visits</span></div>\n<div class="row"><span>Week two</span><div class="bar" style="width: 70%"></div><span>70 visits</span></div>\n<p>Updated snapshot &lt;script&gt; is text</p>' }
] }
const shapes: VisualizationResource = { ...html, id: '23456789-1234-4123-8123-123456789abc', kind: 'scene3d', title: 'Shapes and a UFO', summary: 'Interactive geometry', latestVersion: 1, versions: [{ ...html.versions[0], title: 'Shapes and a UFO', source: scene }] }
const diagram: VisualizationResource = { ...html, id: '34567890-1234-4123-8123-123456789abc', kind: 'mermaid', title: 'Delivery flow', summary: 'A simple diagram', latestVersion: 1, versions: [{ ...html.versions[0], title: 'Delivery flow', source: 'graph LR\nA[Draft] --> B[Review] --> C[Ship]' }] }
const resources = [shapes, html, diagram]
const tallHtml: VisualizationResource = { ...html, id: '45678901-1234-4123-8123-123456789abc', latestVersion: 1, versions: [{ ...html.versions[0], height: 160, source: '<div style="height:960px;width:1200px">Tall saved document</div><p>Final saved section</p>' }] }
const tallDiagram: VisualizationResource = { ...diagram, id: '56789012-1234-4123-8123-123456789abc', versions: [{ ...diagram.versions[0], source: 'graph TB\n' + Array.from({ length: 18 }, (_, i) => `N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`).join('\n') }] }
const wideDiagram: VisualizationResource = { ...diagram, id: '67890123-1234-4123-8123-123456789abc', versions: [{ ...diagram.versions[0], source: tallDiagram.versions[0].source.replace('graph TB', 'graph LR') }] }
const detailResources = [...resources, tallHtml, tallDiagram, wideDiagram]
const listVisualizations = async ({ scope }: { scope: string }) => { (window as any).fixtureScope = scope; return { success: true, resources: resources.map(resource => ({ ...resource, sourceLoaded: false, versions: resource.versions.map(version => ({ ...version, source: '' })) })) } }
Object.assign(window, { devscope: {
    assistant: {
        listVisualizations,
        getVisualization: async ({ id }: { id: string }) => { (window as any).fixtureGetCalls = ((window as any).fixtureGetCalls || 0) + 1; if ((window as any).fixtureFailNextGet) { (window as any).fixtureFailNextGet = false; return { success: false, error: 'Fixture detail failure' } }; if ((window as any).fixturePauseNextGet) { (window as any).fixturePauseNextGet = false; return await new Promise(resolve => { (window as any).fixtureReleaseGet = () => { (window as any).fixtureReleaseGet = null; resolve({ success: true, resource: detailResources.find(resource => resource.id === id) }) } }) }; return { success: true, resource: detailResources.find(resource => resource.id === id) } },
    },
    copyToClipboard: async (text: string) => { (window as any).fixtureCopied = text; return { success: true } },
    preferences: {
        get: async () => ({ success: true, snapshot: { schemaVersion: 1, revision: 1, surface: 'browser', settings: { appearanceThemeMode: 'dark' }, updatedAt: '' } }),
        onChanged: () => () => undefined
    },
}, fixtureUsed: null, fixtureScene: scene })

const routedContext: unknown[] = []
Object.assign(assistantStore.getState().snapshot, {
    selectedSessionId: 'fixture-session',
    sessions: [
        { id: 'fixture-session', threads: [{ id: 'fixture-local', providerThreadId: 'fixture-canonical' }] },
        { id: 'other-session', threads: [{ id: 'other-local' }] },
    ],
})
subscribeCodeContext('fixture-session', file => routedContext.push({ sessionId: 'fixture-session', file }))
Object.assign(window, { fixtureRouted: routedContext, fixtureSubscribeOther: () => subscribeCodeContext('other-session', file => routedContext.push({ sessionId: 'other-session', file })) })

function Fixture() {
    useEffect(() => subscribeVisualizationContextRouting(), [])
    const [mode, setMode] = useState('library')
    const [revision, setRevision] = useState(0)
    const [streaming, setStreaming] = useState(true)
    const [prompt, setPrompt] = useState(0)
    const [complete, setComplete] = useState(false)
    const source = revision ? scene.replace('"#a58aff"', '"#ff6633"') : scene
    return <main className="flex h-screen min-h-0 flex-col">
        <nav className="flex shrink-0 gap-3 border-b p-3">{['library', 'library-narrow', 'library-unavailable', 'details', 'scene', 'embed', 'embed-tall', 'embed-diagram-tall', 'embed-diagram-wide', 'narrow', 'continuity', 'loading'].map(name => <button key={name} onClick={() => { window.devscope.assistant.listVisualizations = name === 'library-unavailable' ? undefined : listVisualizations as typeof window.devscope.assistant.listVisualizations; if (name === 'loading') { setStreaming(true); setComplete(false) }; setMode(name) }} data-fixture-mode={name}>{name}</button>)}<button onClick={() => setRevision(value => value + 1)} data-fixture-revise>Revise cube color</button><button data-fixture-settle onClick={() => setStreaming(false)}>Settle stream</button><button data-fixture-prompt onClick={() => setPrompt(value => value + 1)}>New prompt</button><button data-fixture-complete onClick={() => setComplete(true)}>Complete reference</button></nav>
        <div className="flex min-h-0 flex-1" id="fixture-content">
        {mode.startsWith('library') ? <div className="flex min-h-0 flex-col" style={{ width: mode === 'library' ? '100%' : 320, maxWidth: '100%' }}><AssistantResourcesWorkspace key={mode} threadId="fixture-local" turns={prompt ? [{ id: `turn-${prompt}`, number: prompt, state: 'completed', reviewStatus: null, prompt: 'A new prompt', promptAvailable: true, promptAttachments: [], response: '', responseAvailable: true, historyUnavailable: false, searchText: '', createdAt: '2026-01-03T12:00:00.000Z', updatedAt: '2026-01-03T12:00:00.000Z', files: [], changes: [], additions: 0, deletions: 0 }] : []} projectPath={null} onOpenPreview={async () => {}} onOpenPreviewInNewTab={async () => {}} onOpenUrl={() => {}} onOpenDiff={() => {}} onOpenTurn={() => {}}/></div> : mode === 'details' || mode === 'narrow' ? <div data-fixture-narrow={mode === 'narrow' ? 'true' : undefined} className="flex min-h-0 flex-col" style={{ width: mode === 'narrow' ? 320 : '100%', maxWidth: '100%' }}><VisualizationResourceView resource={html} threadId="fixture-local" onOpenTurn={turnId => { (window as any).fixtureOpenedTurn = turnId }} onUseVersion={detail => { (window as any).fixtureUsed = detail; useSavedVisualization(detail) }}/></div> : mode === 'scene' ? <Scene3DViewer source={source} expanded/> : mode === 'continuity' || mode === 'loading' ? <VisualizationThreadContext.Provider value="fixture-local"><div className="w-full overflow-auto p-4"><AssistantMessageMarkdown cacheKey="stable-artifact-message" streaming={streaming} content={mode === 'loading' && !complete ? '<visualization-ref id="' + shapes.id + '" version="' : `<visualization-ref id="${shapes.id}" version="1" />\n<visualization-ref id="${id}" version="1" />`} /><div data-fixture-new-prompt>{prompt ? `User prompt ${prompt}` : ''}</div></div></VisualizationThreadContext.Provider> : <VisualizationThreadContext.Provider value="fixture-local"><div className="w-full p-4"><VisualizationMessage content={`Pinned original\n<visualization-ref id="${mode === 'embed-tall' ? tallHtml.id : mode === 'embed-diagram-tall' ? tallDiagram.id : mode === 'embed-diagram-wide' ? wideDiagram.id : id}" version="1" />\nThis message must stay on version one.`} streaming={false} renderMarkdown={text => <p>{text}</p>}/></div></VisualizationThreadContext.Provider>}
        </div>
    </main>
}
class FixtureBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
    state = { error: '' }
    static getDerivedStateFromError(error: Error) { return { error: error.message } }
    componentDidCatch(error: Error) {
        console.error('Fixture failed:', error)
        if (location.protocol.startsWith('http')) void fetch('/fixture-error', { method: 'POST', body: error.stack || error.message })
    }
    render() { return this.state.error ? <pre role="alert">Fixture failed: {this.state.error}</pre> : this.props.children }
}
createRoot(document.getElementById('root')!).render(<FixtureBoundary><SettingsProvider><Fixture/></SettingsProvider></FixtureBoundary>)
