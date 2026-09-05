import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import initSqlJs, { type Database as SqlDatabase } from 'sql.js/dist/sql-asm.js'
import type { AssistantCreateProjectInput } from '../src/shared/assistant/contracts/project'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import {
    associateAssistantProjectFolder,
    canonicalAssistantFolderKey,
    createAssistantChatScopeForProject,
    createAssistantProject,
    detectAssistantProjectCandidates,
    dismissAssistantProjectCandidate,
    ensureLegacyAssistantProjectForFolder,
    initializeAssistantProjectSchema,
    isAssistantPathInsideRoot,
    migrateLegacyAssistantProjects,
    readAssistantChatScopes,
    readAssistantProjectCatalog,
    removeAssistantProjectFolder,
    updateAssistantProject
} from '../src/main/assistant/assistant-project-persistence'

const SQL = await initSqlJs()
const fixtureRoot = mkdtempSync(join(tmpdir(), 'zyra-project-migration-'))

function createLegacyDatabase(entries: Array<{ id: string; path: string }>) {
    const db = new SQL.Database()
    db.run(`
        CREATE TABLE assistant_sessions (
            id TEXT PRIMARY KEY,
            project_path TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE assistant_threads (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            cwd TEXT
        )
    `)
    entries.forEach((entry, index) => {
        db.run('INSERT INTO assistant_sessions (id, project_path, created_at) VALUES (?, ?, ?)', [
            entry.id,
            entry.path,
            `2026-01-01T00:00:0${index}.000Z`
        ])
        db.run('INSERT INTO assistant_threads (id, session_id, cwd) VALUES (?, ?, ?)', [
            `thread-${entry.id}`,
            entry.id,
            entry.path
        ])
    })
    initializeAssistantProjectSchema(db)
    return db
}

function readCreationState(db: SqlDatabase, homesRoot: string) {
    return {
        catalog: readAssistantProjectCatalog(db),
        folders: db.exec('SELECT * FROM assistant_folders ORDER BY id'),
        homes: existsSync(homesRoot) ? readdirSync(homesRoot).sort() : []
    }
}

function testInitialProjectFolders(): void {
    const db = createLegacyDatabase([])
    const roots = join(fixtureRoot, 'initial-folders')
    const homesRoot = join(fixtureRoot, 'initial-folder-homes')
    const sourceRoot = join(roots, 'source')
    const referenceRoot = join(roots, 'reference')
    const candidateRoot = join(roots, 'candidate')
    const missingRoot = join(roots, 'missing')
    const filePath = join(roots, 'file.txt')
    for (const path of [sourceRoot, referenceRoot, candidateRoot]) mkdirSync(path, { recursive: true })
    writeFileSync(filePath, 'not a directory')
    const options = { projectHomesRoot: homesRoot }
    const assertRejected = (input: unknown, error: RegExp, candidateId?: string, allowUnavailableFolder = false) => {
        const before = readCreationState(db, homesRoot)
        assert.throws(() => createAssistantProject(db, input as AssistantCreateProjectInput, {
            ...options, candidateId, allowUnavailableFolder
        }), error)
        assert.deepEqual(readCreationState(db, homesRoot), before, 'rejection must leave Projects, folder records, candidates and homes unchanged')
    }
    try {
        // Exercise rejection before even the first home exists.
        assertRejected({ folders: [{ path: sourceRoot }, { path: missingRoot }] }, /not found or is not a directory/i)
        assert.equal(existsSync(homesRoot), false)
        const legacyProject = createAssistantProject(db, {
            folderPath: sourceRoot, folderAccess: 'read-only'
        }, options)
        assert.equal(legacyProject.name, 'source')
        assert.equal(legacyProject.folders[0]?.access, 'read-only')
        const archivedProject = updateAssistantProject(db, { projectId: legacyProject.id, archived: true })
        const multiProject = createAssistantProject(db, {
            name: '  Reviewed   Project  ',
            folders: [{ path: sourceRoot }, { path: referenceRoot, access: 'read-only' }]
        }, options)
        assert.equal(multiProject.name, 'Reviewed Project')
        assert.equal(multiProject.revision, 1, 'all initial associations belong to the first Project revision')
        assert.equal(multiProject.archived, false)
        assert.equal(multiProject.folders.length, 2)
        assert.equal(readAssistantProjectCatalog(db).projects.length, 2, 'multi-folder creation adds exactly one Project')
        assert.equal(multiProject.folders.find((folder) => folder.path === sourceRoot)?.access, 'read-write')
        assert.equal(multiProject.folders.find((folder) => folder.path === referenceRoot)?.access, 'read-only')
        assert.equal(multiProject.folders.find((folder) => folder.path === sourceRoot)?.folderId, legacyProject.folders[0]?.folderId)
        assert.deepEqual(readAssistantProjectCatalog(db).projects.find((project) => project.id === archivedProject.id), archivedProject)
        assert.ok(existsSync(multiProject.homePath))
        const scope = createAssistantChatScopeForProject(db, multiProject.id)
        assert.equal(scope.roots.length, 3)
        assert.equal(scope.workingRoot, sourceRoot)
        assert.throws(() => createAssistantChatScopeForProject(db, archivedProject.id), /archived/i)
        assert.throws(() => associateAssistantProjectFolder(db, {
            projectId: archivedProject.id, path: referenceRoot, access: 'read-write'
        }), /archived/i)

        const duplicatePath = process.platform === 'win32'
            ? `${sourceRoot.toUpperCase().replace(/\\/g, '/')}/`
            : `${sourceRoot}/`
        const folderRowsBeforeDuplicates = db.exec('SELECT * FROM assistant_folders ORDER BY id')
        const deduplicated = createAssistantProject(db, {
            folders: [
                { path: sourceRoot, access: 'read-only' },
                { path: duplicatePath, access: 'read-write' },
                { path: `${sourceRoot}/../source/.`, access: 'read-write' }
            ]
        }, options)
        assert.equal(deduplicated.folders.length, 1, 'case, slash, trailing separator and dot variants share folder identity')
        assert.equal(deduplicated.folders[0]?.access, 'read-only', 'the first reviewed selection wins for duplicate identities')
        assert.deepEqual(db.exec('SELECT * FROM assistant_folders ORDER BY id'), folderRowsBeforeDuplicates)

        for (const input of [{}, { name: 'Folderless', folders: [] }, { folderPath: sourceRoot, folders: [] }]) {
            const project = createAssistantProject(db, input, options)
            assert.equal(project.folders.length, 0, 'an explicit empty list never falls back to the legacy selection')
            assert.ok(existsSync(project.homePath))
            assert.equal(createAssistantChatScopeForProject(db, project.id).workingRoot, project.homePath)
        }
        const boundedProject = createAssistantProject(db, {
            folders: Array.from({ length: 32 }, () => ({ path: sourceRoot }))
        }, options)
        assert.equal(boundedProject.folders.length, 1)
        assertRejected({ folders: Array.from({ length: 33 }, () => ({ path: sourceRoot })) }, /at most 32/i)
        for (const input of [null, [], 'invalid', 42]) assertRejected(input, /input must be an object/i)
        for (const folders of [null, {}, 'invalid', 42]) assertRejected({ folders }, /folders must be an array/i)
        for (const folder of [null, [], 'invalid', 42, {}, { path: null }, { path: 42 }, { path: '   ' }]) {
            assertRejected({ folders: [{ path: sourceRoot }, folder] }, /non-empty path string/i)
        }
        assertRejected({ folders: new Array(1) }, /non-empty path string/i)
        for (const access of [null, 'write', false, 1, {}]) {
            assertRejected({ folders: [{ path: sourceRoot }, { path: duplicatePath, access }] }, /folder access must be/i)
        }
        for (const path of [missingRoot, filePath]) {
            assertRejected({ folders: [{ path: sourceRoot }, { path }] }, /not found or is not a directory/i)
        }
        assertRejected({ folders: [{ path: missingRoot }] }, /not found or is not a directory/i, undefined, true)
        assertRejected({ folderPath: missingRoot }, /not found or is not a directory/i)

        const candidate = detectAssistantProjectCandidates(db, [roots]).find((entry) => entry.path === candidateRoot)
        assert.ok(candidate)
        assertRejected({ folders: [{ path: sourceRoot }] }, /does not match/i, candidate.id)
        assertRejected({ folders: [] }, /does not match/i, candidate.id)
        assertRejected({ folderPath: candidateRoot, folders: [{ path: sourceRoot }] }, /does not match/i, candidate.id)
        assertRejected({ folders: [{ path: candidateRoot }, { path: missingRoot }] }, /not found or is not a directory/i, candidate.id)
        assertRejected({ folders: [{ path: candidateRoot }] }, /not found or has already been reviewed/i, 'unknown-candidate')

        const transactionFailureRoot = join(roots, 'transaction-failure')
        mkdirSync(transactionFailureRoot)
        db.run(`
            CREATE TRIGGER reject_initial_folder BEFORE INSERT ON assistant_project_folders
            WHEN NEW.label = 'transaction-failure'
            BEGIN SELECT RAISE(ABORT, 'fixture association failure'); END;
        `)
        try {
            assertRejected({ folders: [{ path: candidateRoot }, { path: transactionFailureRoot }] }, /fixture association failure/i, candidate.id)
        } finally {
            db.run('DROP TRIGGER reject_initial_folder')
        }
        const secondCandidate = detectAssistantProjectCandidates(db, [roots]).find((entry) => entry.path === transactionFailureRoot)
        assert.ok(secondCandidate)
        const imported = createAssistantProject(db, {
            folders: [
                { path: referenceRoot },
                { path: process.platform === 'win32' ? candidateRoot.toUpperCase() : candidateRoot, access: 'read-only' },
                { path: transactionFailureRoot }
            ]
        }, { ...options, candidateId: candidate.id })
        assert.equal(imported.folders.length, 3, 'the selected candidate can be any folder in the reviewed list')
        for (const id of [candidate.id, secondCandidate.id]) {
            const reviewed = readAssistantProjectCatalog(db).candidates.find((entry) => entry.id === id)
            assert.equal(reviewed?.status, 'imported')
            assert.equal(reviewed?.projectId, imported.id, 'every included pending candidate resolves to the one created Project')
        }
        assertRejected({ folders: [{ path: candidateRoot }] }, /already been reviewed/i, candidate.id)

        const autofillRoot = join(roots, 'autofill')
        const dismissedRoot = join(roots, 'dismissed')
        for (const path of [autofillRoot, dismissedRoot]) mkdirSync(path)
        const pending = detectAssistantProjectCandidates(db, [roots])
        const autofillCandidate = pending.find((entry) => entry.path === autofillRoot)
        const dismissedCandidate = pending.find((entry) => entry.path === dismissedRoot)
        assert.ok(autofillCandidate)
        assert.ok(dismissedCandidate)
        const autofilled = createAssistantProject(db, {}, { ...options, candidateId: autofillCandidate.id })
        assert.equal(autofilled.folders[0]?.path, autofillRoot, 'legacy empty input still auto-fills its candidate folder')
        assert.equal(autofilled.folders[0]?.access, 'read-write')
        dismissAssistantProjectCandidate(db, { candidateId: dismissedCandidate.id })
        assertRejected({ folders: [{ path: dismissedRoot }] }, /already been reviewed/i, dismissedCandidate.id)
        createAssistantProject(db, { folders: [{ path: dismissedRoot }] }, options)
        assert.equal(readAssistantProjectCatalog(db).candidates.find((entry) => entry.id === dismissedCandidate.id)?.status, 'dismissed')
        const unavailableLegacy = createAssistantProject(db, { folderPath: missingRoot }, { ...options, allowUnavailableFolder: true })
        assert.equal(unavailableLegacy.folders[0]?.available, false)

        const reopened = new SQL.Database(db.export())
        try {
            assert.deepEqual(readAssistantProjectCatalog(reopened), readAssistantProjectCatalog(db), 'export/reopen retains every folder, access, association, candidate and archived Project')
        } finally {
            reopened.close()
        }
    } finally {
        db.close()
    }
}

async function testInitialFolderFacadeGuards(): Promise<void> {
    const userDataPath = join(fixtureRoot, 'facade-profile')
    const assistantDir = join(userDataPath, 'assistant')
    const homesRoot = join(assistantDir, 'project-homes')
    const globalRoot = join(assistantDir, 'global-workspace')
    const installParent = join(fixtureRoot, 'facade-programs')
    const installRoot = join(installParent, 'Zyra')
    const safeRoot = join(fixtureRoot, 'facade-user-folder')
    const safeSibling = `${globalRoot}-user-folder`
    const internalPaths = [installRoot, join(installRoot, 'resources'), globalRoot, join(globalRoot, 'nested')]
    for (const path of [...internalPaths, safeRoot, safeSibling]) mkdirSync(path, { recursive: true })
    // Seed stale internal candidates only in a temporary database, as an older installation could have done.
    const seed = new SQL.Database()
    initializeAssistantPersistenceSchema(seed)
    const staleCandidates = detectAssistantProjectCandidates(seed, [installParent, assistantDir])
        .filter((candidate) => internalPaths.includes(candidate.path))
    assert.equal(staleCandidates.length, 2)
    writeFileSync(join(assistantDir, 'assistant-state.sqlite'), seed.export())
    seed.close()

    mock.module('electron', () => ({
        app: {
            isPackaged: true,
            getPath: (name: string) => {
                if (name === 'userData') return userDataPath
                if (name === 'exe') return join(installRoot, 'Zyra.exe')
                throw new Error(`Unexpected Electron path request in Project fixture: ${name}`)
            }
        }
    }))
    mock.module('electron-log', () => ({ default: { error() {}, warn() {}, debug() {}, info() {} } }))
    const { AssistantPersistence } = await import('../src/main/assistant/persistence')
    const persistence = new AssistantPersistence()
    let projectId = ''
    try {
        const catalogBefore = await persistence.listProjects()
        for (const path of internalPaths) {
            await assert.rejects(persistence.createProject({ folderPath: path }), /cannot become Projects/i)
            for (const folders of [[{ path }, { path: safeRoot }], [{ path: safeRoot }, { path }]]) {
                await assert.rejects(persistence.createProject({ name: 'Blocked', folders }), /cannot become Projects/i)
            }
        }
        for (const candidate of staleCandidates) {
            await assert.rejects(persistence.createProject({}, candidate.id), /cannot become Projects/i)
            await assert.rejects(persistence.createProject({ folders: [{ path: safeRoot }, { path: candidate.path }] }, candidate.id), /cannot become Projects/i)
        }
        await assert.rejects(persistence.createProject({ folders: [{ path: safeRoot }, { path: join(fixtureRoot, 'absent') }] }), /not found or is not a directory/i)
        await assert.rejects(persistence.createProject({ folders: [null] } as unknown as AssistantCreateProjectInput), /non-empty path string/i)
        assert.deepEqual(await persistence.listProjects(), catalogBefore, 'facade rejection must leave all candidates pending and create no Project')
        assert.equal(existsSync(homesRoot), false, 'facade rejection must create no Project home')
        const safeCandidate = catalogBefore.candidates.find((candidate) => candidate.path === safeSibling)
        assert.ok(safeCandidate)
        const created = await persistence.createProject({
            name: 'Facade multi-folder', folders: [{ path: safeRoot }, { path: safeSibling, access: 'read-only' }]
        }, safeCandidate.id)
        assert.equal(created.folders.length, 2, 'a sibling sharing an internal path prefix is still a valid user folder')
        assert.equal((await persistence.listProjects()).candidates.find((candidate) => candidate.id === safeCandidate.id)?.projectId, created.id)
        projectId = created.id
    } finally {
        await persistence.close()
    }
    const persisted = new SQL.Database(readFileSync(join(assistantDir, 'assistant-state.sqlite')))
    try {
        const project = readAssistantProjectCatalog(persisted).projects.find((entry) => entry.id === projectId)
        assert.equal(project?.folders.length, 2, 'the facade flush persists the complete folder list')
        assert.equal(project?.folders.find((folder) => folder.path === safeSibling)?.access, 'read-only')
    } finally {
        persisted.close()
    }
}

try {
    const discoveryRoot = join(fixtureRoot, 'discovery')
    const legacyRoot = join(discoveryRoot, 'LegacyProject')
    const nestedRoot = join(legacyRoot, 'packages', 'nested-app')
    const detectedRoot = join(discoveryRoot, 'DetectedProject')
    const manualRoot = join(discoveryRoot, 'ManualProject')
    const associatedReadOnlyRoot = join(fixtureRoot, 'shared-reference')
    const systemInstallRoot = join(fixtureRoot, 'Programs', 'Zyra')
    const globalWorkspaceRoot = join(fixtureRoot, 'Zyra-dev', 'assistant', 'global-workspace')
    for (const folder of [legacyRoot, nestedRoot, detectedRoot, associatedReadOnlyRoot, systemInstallRoot, globalWorkspaceRoot]) {
        mkdirSync(folder, { recursive: true })
    }

    assert.equal(
        isAssistantPathInsideRoot(join(systemInstallRoot, 'resources'), systemInstallRoot),
        true,
        'internal installation descendants are excluded along with the installation root'
    )

    if (process.platform === 'win32') {
        assert.equal(
            canonicalAssistantFolderKey(legacyRoot.toUpperCase()),
            canonicalAssistantFolderKey(legacyRoot.toLowerCase()),
            'Windows Project identity must be case-insensitive'
        )
    }

    const legacyEntries = [
        { id: 'chat-a', path: legacyRoot },
        { id: 'chat-a-case-variant', path: process.platform === 'win32' ? legacyRoot.toUpperCase() : legacyRoot },
        { id: 'chat-nested', path: nestedRoot },
        { id: 'chat-system-glitch', path: systemInstallRoot }
    ]
    const devDb = createLegacyDatabase(legacyEntries)
    const devHomesRoot = join(fixtureRoot, 'Zyra-dev', 'assistant', 'project-homes')
    const migrationOptions = {
        projectHomesRoot: devHomesRoot,
        excludedLegacyProjectPaths: [systemInstallRoot, globalWorkspaceRoot],
        globalWorkspaceRoot
    }
    const firstMigration = migrateLegacyAssistantProjects(devDb, migrationOptions)
    assert.equal(firstMigration.migratedSessionCount, 3)
    assert.equal(firstMigration.clearedInternalSessionCount, 1, 'the installed Zyra folder is repaired as a global Chat, not migrated as a Project')

    const devCatalog = readAssistantProjectCatalog(devDb)
    assert.equal(devCatalog.projects.length, 2, 'nested legacy paths remain separate Projects initially')
    assert.ok(devCatalog.projects.every((project) => project.homePath.startsWith(devHomesRoot)))
    assert.ok(devCatalog.projects.every((project) => project.folders.length === 1))

    const migratedScopes = readAssistantChatScopes(devDb)
    assert.equal(migratedScopes.size, 3)
    assert.equal(
        devDb.exec("SELECT project_path FROM assistant_sessions WHERE id = 'chat-system-glitch'")[0]?.values?.[0]?.[0],
        null
    )
    assert.equal(
        devDb.exec("SELECT cwd FROM assistant_threads WHERE session_id = 'chat-system-glitch'")[0]?.values?.[0]?.[0],
        globalWorkspaceRoot,
        'affected global Chats receive a neutral managed runtime directory'
    )
    assert.equal(migratedScopes.get('chat-a')?.projectId, migratedScopes.get('chat-a-case-variant')?.projectId)
    assert.equal(migratedScopes.get('chat-a')?.workingRoot, legacyRoot)
    assert.deepEqual(
        migratedScopes.get('chat-a')?.roots.map((root) => root.kind),
        ['project-home', 'associated-folder']
    )

    const secondMigration = migrateLegacyAssistantProjects(devDb, migrationOptions)
    assert.equal(secondMigration.migratedSessionCount, 0, 'migration must be idempotent')
    assert.equal(readAssistantProjectCatalog(devDb).projects.length, 2)

    const pendingCandidates = detectAssistantProjectCandidates(devDb, [discoveryRoot])
    assert.deepEqual(
        pendingCandidates.map((candidate) => candidate.path),
        [detectedRoot],
        'configured discovery locations create review candidates without importing Projects'
    )
    assert.equal(readAssistantProjectCatalog(devDb).projects.length, 2)
    assert.throws(() => createAssistantProject(devDb, {
        name: 'Wrong import',
        folderPath: associatedReadOnlyRoot
    }, {
        projectHomesRoot: devHomesRoot,
        candidateId: pendingCandidates[0]?.id
    }), /does not match/i)

    const importedProject = createAssistantProject(devDb, {
        name: pendingCandidates[0]?.suggestedName,
        folderPath: pendingCandidates[0]?.path,
        folderAccess: 'read-write'
    }, {
        projectHomesRoot: devHomesRoot,
        candidateId: pendingCandidates[0]?.id
    })
    assert.equal(importedProject.folders[0]?.path, detectedRoot)
    assert.equal(
        readAssistantProjectCatalog(devDb).candidates.find((candidate) => candidate.id === pendingCandidates[0]?.id)?.status,
        'imported'
    )

    mkdirSync(manualRoot, { recursive: true })
    const manualCandidate = detectAssistantProjectCandidates(devDb, [discoveryRoot])
        .find((candidate) => candidate.path === manualRoot)
    assert.ok(manualCandidate)
    const manuallyCreatedProject = createAssistantProject(devDb, {
        name: 'Manual Project',
        folderPath: manualRoot
    }, { projectHomesRoot: devHomesRoot })
    assert.equal(
        readAssistantProjectCatalog(devDb).candidates.find((candidate) => candidate.id === manualCandidate?.id)?.status,
        'imported',
        'manual creation resolves an already-detected candidate for the same Folder'
    )
    const deterministicLegacyProject = ensureLegacyAssistantProjectForFolder(devDb, manualRoot, {
        projectHomesRoot: devHomesRoot
    })
    assert.notEqual(deterministicLegacyProject.id, manuallyCreatedProject.id)
    assert.equal(
        deterministicLegacyProject.folders[0]?.folderId,
        manuallyCreatedProject.folders[0]?.folderId,
        'late canonical imports preserve deterministic legacy identity while sharing the physical Folder record'
    )

    const scopeBeforeAssociation = createAssistantChatScopeForProject(devDb, importedProject.id, detectedRoot)
    const expandedProject = associateAssistantProjectFolder(devDb, {
        projectId: importedProject.id,
        path: associatedReadOnlyRoot,
        access: 'read-only'
    })
    assert.equal(expandedProject.revision, importedProject.revision + 1)
    const expandedScope = createAssistantChatScopeForProject(devDb, importedProject.id, detectedRoot)
    assert.equal(expandedScope.revision, expandedProject.revision)
    assert.equal(
        expandedScope.roots.find((root) => canonicalAssistantFolderKey(root.path) === canonicalAssistantFolderKey(associatedReadOnlyRoot))?.access,
        'read-only'
    )
    assert.equal(
        scopeBeforeAssociation.roots.some((root) => canonicalAssistantFolderKey(root.path) === canonicalAssistantFolderKey(associatedReadOnlyRoot)),
        false,
        'existing Chat scopes do not silently gain later folder associations'
    )

    const detachedProject = removeAssistantProjectFolder(devDb, {
        projectId: importedProject.id,
        folderId: expandedProject.folders.find((folder) => folder.path === associatedReadOnlyRoot)?.folderId || ''
    })
    assert.equal(detachedProject.folders.some((folder) => folder.path === associatedReadOnlyRoot), false)
    assert.equal(expandedScope.roots.some((root) => root.path === associatedReadOnlyRoot), true, 'saved Chat scopes survive later detachment')

    const prodDb = createLegacyDatabase([{ id: 'prod-chat', path: legacyRoot }])
    const prodHomesRoot = join(fixtureRoot, 'Zyra', 'assistant', 'project-homes')
    migrateLegacyAssistantProjects(prodDb, {
        projectHomesRoot: prodHomesRoot,
        excludedLegacyProjectPaths: [join(fixtureRoot, 'ProductionPrograms', 'Zyra')],
        globalWorkspaceRoot: join(fixtureRoot, 'Zyra', 'assistant', 'global-workspace')
    })
    const prodProject = readAssistantProjectCatalog(prodDb).projects[0]
    const devLegacyProject = readAssistantProjectCatalog(devDb).projects.find((project) => (
        project.folders.some((folder) => canonicalAssistantFolderKey(folder.path) === canonicalAssistantFolderKey(legacyRoot))
    ))
    assert.equal(prodProject?.id, devLegacyProject?.id, 'legacy path identity is deterministic per installation')
    assert.ok(prodProject?.homePath.startsWith(prodHomesRoot))
    assert.notEqual(prodProject?.homePath, devLegacyProject?.homePath, 'development and production keep separate managed homes')

    const reopenedDevDb = new SQL.Database(devDb.export())
    assert.equal(readAssistantProjectCatalog(reopenedDevDb).projects.length, readAssistantProjectCatalog(devDb).projects.length)
    assert.equal(readAssistantChatScopes(reopenedDevDb).size, migratedScopes.size, 'Project catalog and Chat scopes survive database reopen')

    reopenedDevDb.close()
    devDb.close()
    prodDb.close()
    testInitialProjectFolders()
    await testInitialFolderFacadeGuards()
    console.log('Assistant Project migration and initial folders: ok')
} finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
}
