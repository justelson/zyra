import assert from 'node:assert/strict'
import { prepareAgentForkWorkspace } from '../src/main/assistant/agent-fork-preparation'
import type { AssistantProject, AssistantChatScope } from '../src/shared/assistant/contracts'

// No Git or running Desktop required. The real worktree owner's rollback is
// tested separately by test-assistant-worktree-cleanup.ts; these tests exercise
// preparation ownership, cleanup ordering and refusal propagation.
function fixture(options: { existing?: boolean; associated?: boolean; referenced?: boolean; changed?: boolean; associationFailure?: boolean; scopeFailure?: boolean } = {}) {
    const path = '/new-fork', events: string[] = []
    const folder = { associationId: 'introduced', folderId: 'folder', projectId: 'project', path, label: 'fork', access: 'read-write' as const, available: true, createdAt: '', updatedAt: '' }
    const project = { id: 'project', folders: options.associated ? [folder] : [] } as unknown as AssistantProject
    const scope = { projectId: 'project', workingRoot: path, roots: [] } as unknown as AssistantChatScope
    let cleanup: (() => Promise<void>) | undefined
    const run = () => prepareAgentForkWorkspace({
        prepare: async () => ({ path, ...(!options.existing ? { rollback: async () => {
            events.push('rollback')
            if (options.changed) throw new Error('changed or protected worktree retained')
        } } : {}) }),
        project: async () => structuredClone(project),
        associate: async () => {
            events.push('associate')
            if (!project.folders.length) project.folders.push(folder)
            if (options.associationFailure) throw new Error('association failed after persistence')
            return project
        },
        remove: async id => { assert.equal(id, 'folder'); events.push('remove'); project.folders = [] },
        scope: async () => { events.push('scope'); if (options.scopeFailure) throw new Error('scope failed'); return scope },
        referenced: async () => Boolean(options.referenced),
        ready: rollback => { cleanup = rollback }
    })
    return { run, events, project, cleanup: () => cleanup!() }
}
for (const failure of ['associationFailure', 'scopeFailure'] as const) {
    const test = fixture({ [failure]: true })
    await assert.rejects(test.run(), /failed/)
    assert.deepEqual(test.events.slice(-2), ['rollback', 'remove'])
    assert.equal(test.project.folders.length, 0, 'only the newly introduced association is removed after confirmed safe rollback')
}
for (const options of [{ existing: true }, { associated: true }, { changed: true }, { referenced: true }]) {
    const test = fixture({ ...options, scopeFailure: true })
    await assert.rejects(test.run(), /failed/)
    assert.equal(test.events.includes('remove'), false, 'existing, changed or published workspace keeps its association')
    if (!options.changed) assert.equal(test.events.includes('rollback'), false)
    assert.equal(test.project.folders.length, 1)
}
const success = fixture()
await success.run()
assert.equal(success.events.includes('rollback'), false, 'successful preparation never cleans itself')
await success.cleanup()
assert.deepEqual(success.events.slice(-2), ['rollback', 'remove'])
await assert.rejects(success.cleanup(), /already attempted/, 'cleanup is non-replayable')
console.log('Agent fork preparation: association/scope failure rollback, existing/changed/published retention and single-use cleanup passed')
