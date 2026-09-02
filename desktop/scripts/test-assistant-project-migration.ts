import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import {
    associateAssistantProjectFolder,
    canonicalAssistantFolderKey,
    createAssistantChatScopeForProject,
    createAssistantProject,
    detectAssistantProjectCandidates,
    ensureLegacyAssistantProjectForFolder,
    initializeAssistantProjectSchema,
    isAssistantPathInsideRoot,
    migrateLegacyAssistantProjects,
    readAssistantChatScopes,
    readAssistantProjectCatalog,
    removeAssistantProjectFolder
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
    console.log('Assistant Project migration: ok')
} finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
}
