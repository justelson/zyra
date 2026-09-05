// Isolated UI acceptance fixture. Folder selection and IPC are fakes; no user data is written.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '../../src/renderer/src/lib/settings'
import type { AssistantCreateProjectInput, AssistantProject, AssistantProjectCatalog } from '../../src/shared/assistant/contracts'
import { ProjectCreationProvider, useProjectCreation } from '../../src/renderer/src/lib/projects/project-creation'
import { useAssistantProjectCatalog } from '../../src/renderer/src/pages/assistant/useAssistantProjectCatalog'
import { AssistantNewChatProjectChip } from '../../src/renderer/src/pages/assistant/AssistantNewChatProjectChip'
import { resolveAssistantProjectLabel } from '../../src/renderer/src/pages/assistant/assistant-project-label'
import '../../src/renderer/src/index.css'

const catalog: AssistantProjectCatalog = { migrationVersion: 1, projects: [], candidates: [] }
const menuPreview = new URLSearchParams(location.search).has('menu')
const seedId = 'project_0123456789abcdef0123456789abcdef'
if (menuPreview) catalog.projects.push({ id: seedId, name: 'Website', homePath: `C:/Fixture/project-homes/${seedId}`, archived: false, revision: 1, folders: [], createdAt: '', updatedAt: '' })
const calls: Array<{ input: AssistantCreateProjectInput; candidateId?: string }> = []
let browsePath: string | null = null
let browseCalls = 0
let failNext = false
let deferNext = false
let settle: (() => void) | null = null
let catalogReads = 0
Object.defineProperty(window, 'devscope', { configurable: true, value: {
    preferences: {
        get: async () => ({ success: true, snapshot: { schemaVersion: 1, revision: 1, surface: 'browser', settings: { appearanceThemeMode: 'dark' }, updatedAt: '' } }),
        onChanged: () => () => undefined
    },
    getProjectDetails: async () => ({ success: false, error: 'No metadata in the isolated fixture.' }),
    selectFolder: async () => { browseCalls += 1; return browsePath ? { success: true, folderPath: browsePath } : { success: true, cancelled: true } },
    assistant: {
        listProjects: async () => { catalogReads += 1; return { success: true, catalog: structuredClone(catalog) } },
        createProject: async (input: AssistantCreateProjectInput, candidateId?: string) => {
            calls.push({ input: structuredClone(input), candidateId })
            if (deferNext) { deferNext = false; await new Promise<void>((resolve) => { settle = resolve }) }
            if (failNext) { failNext = false; return { success: false, error: 'The selected folder is unavailable.' } }
            const id = `fixture-project-${catalog.projects.length + 1}`
            const now = new Date().toISOString()
            const project: AssistantProject = { id, name: input.name!, homePath: `/fixture/homes/${id}`, archived: false, revision: 1, createdAt: now, updatedAt: now, folders: (input.folders || []).map((folder, index) => ({ associationId: `${id}-${index}`, folderId: `folder-${index}`, projectId: id, path: folder.path, label: folder.path.split(/[\\/]/).at(-1)!, access: folder.access || 'read-write', available: true, createdAt: now, updatedAt: now })) }
            catalog.projects.push(project)
            return { success: true, project }
        }
    }
} })
Object.assign(window, { __projectFixture: { calls, catalog, setBrowse: (path: string | null) => { browsePath = path }, failNext: () => { failNext = true }, deferNext: () => { deferNext = true }, settle: () => { settle?.(); settle = null }, catalogReads: () => catalogReads, browseCalls: () => browseCalls } })
function Fixture() {
    const request = useProjectCreation()
    const { catalog } = useAssistantProjectCatalog()
    const [selected, setSelected] = useState('None')
    const [projectId, setProjectId] = useState<string | null>(menuPreview ? seedId : null)
    const project = catalog.projects.find((entry) => entry.id === projectId) || null
    const label = resolveAssistantProjectLabel(project?.name, projectId, project?.homePath)
    return <main style={{ padding: 32, color: 'var(--color-text)' }}>
        <h1 style={{ fontSize: 18 }}>Project setup acceptance fixture</h1>
        <button id="fixture-new-project" style={{ padding: '12px 0' }} onClick={() => void request().then((project) => { if (project) setSelected(project.name) })}>New project</button>
        <button id="fixture-import" style={{ marginLeft: 20 }} onClick={() => void request({ name: 'Detected project', folderPaths: ['C:/Projects/detected'], candidateId: 'candidate-1', candidatePath: 'C:/Projects/detected' })}>Review detected folder</button>
        <output id="fixture-selected" style={{ display: 'block' }}>{selected}</output>
        <ul id="fixture-catalog">{catalog.projects.map((project) => <li key={project.id}>{project.name}: {project.folders.length} folders</li>)}</ul>
        {menuPreview ? <section style={{ width: 640, maxWidth: '90vw', margin: '120px auto 0' }}>
            <h2 id="fixture-project-greeting" style={{ textAlign: 'center', fontSize: 24, marginBottom: 28 }}>{label ? `Ready to open up ${label}?` : 'What are we working on?'}</h2>
            <div style={{ position: 'relative', height: 140, border: '1px solid var(--surface-divider)', borderRadius: 16, background: 'var(--surface-floating)' }}>
                <AssistantNewChatProjectChip projectId={projectId} projectName={project?.name} projectPath={project?.homePath || null}
                    projectChoices={catalog.projects.map((entry) => ({ projectId: entry.id, label: entry.name, path: entry.homePath, rootLabel: 'Project home' }))}
                    onSelectProject={(id) => setProjectId(id)}
                    onCreateProject={async () => { const created = await request(); if (created) setProjectId(created.id) }} />
            </div>
        </section> : null}
    </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><SettingsProvider><ProjectCreationProvider><Fixture /></ProjectCreationProvider></SettingsProvider></StrictMode>)
