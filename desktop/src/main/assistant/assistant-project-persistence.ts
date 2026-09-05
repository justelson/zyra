import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join, normalize, parse, resolve, sep } from 'node:path'
import type { Database as SqlDatabase, SqlValue } from 'sql.js/dist/sql-asm.js'
import type {
    AssistantChatScope,
    AssistantAssociateProjectFolderInput,
    AssistantChatScopeRoot,
    AssistantCreateProjectFolderInput,
    AssistantCreateProjectInput,
    AssistantDismissProjectCandidateInput,
    AssistantProject,
    AssistantProjectCatalog,
    AssistantProjectFolder,
    AssistantProjectFolderAccess,
    AssistantProjectMigrationCandidate,
    AssistantRemoveProjectFolderInput,
    AssistantUpdateProjectInput
} from '../../shared/assistant/contracts'

export const ASSISTANT_PROJECT_MIGRATION_VERSION = 1
const PROJECT_NAME_LIMIT = 120
const INITIAL_PROJECT_FOLDER_LIMIT = 32

function sqlString(value: SqlValue | null | undefined): string {
    return typeof value === 'string' ? value : ''
}

function sqlNumber(value: SqlValue, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sqlBoolean(value: SqlValue): boolean {
    return sqlNumber(value) === 1
}

function parseJson<T>(value: SqlValue, fallback: T): T {
    if (typeof value !== 'string' || !value) return fallback
    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

function runTransaction<T>(db: SqlDatabase, work: () => T): T {
    db.run('BEGIN')
    try {
        const result = work()
        db.run('COMMIT')
        return result
    } catch (error) {
        db.run('ROLLBACK')
        throw error
    }
}

export function canonicalAssistantFolderKey(value: string): string {
    const resolved = normalize(resolve(String(value || '').trim()))
    const absolute = resolved === parse(resolved).root ? resolved : resolved.replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

export function isAssistantPathInsideRoot(value: string, root: string): boolean {
    const candidateKey = canonicalAssistantFolderKey(value)
    const rootKey = canonicalAssistantFolderKey(root)
    const rootPrefix = rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`
    return candidateKey === rootKey || candidateKey.startsWith(rootPrefix)
}

function deterministicId(prefix: string, value: string): string {
    return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}

function projectName(value: string, fallback = 'Project'): string {
    const name = basename(String(value || '').replace(/[\\/]+$/, '')).replace(/\s+/g, ' ').trim()
    return (name || fallback).slice(0, PROJECT_NAME_LIMIT)
}

function nowIso(now?: () => Date): string {
    return (now?.() || new Date()).toISOString()
}

function accessValue(value: unknown): AssistantProjectFolderAccess {
    return value === 'read-only' ? 'read-only' : 'read-write'
}

function isExistingDirectory(value: string): boolean {
    try {
        return statSync(value).isDirectory()
    } catch {
        return false
    }
}

export function initializeAssistantProjectSchema(db: SqlDatabase): void {
    db.run(`
        CREATE TABLE IF NOT EXISTS assistant_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            home_path TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_folders (
            id TEXT PRIMARY KEY,
            canonical_path TEXT NOT NULL UNIQUE,
            display_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_project_folders (
            association_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            folder_id TEXT NOT NULL,
            label TEXT NOT NULL,
            access TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(project_id, folder_id),
            FOREIGN KEY(project_id) REFERENCES assistant_projects(id) ON DELETE CASCADE,
            FOREIGN KEY(folder_id) REFERENCES assistant_folders(id) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS assistant_chat_scopes (
            session_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            working_root_path TEXT NOT NULL,
            roots_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES assistant_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(project_id) REFERENCES assistant_projects(id) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS assistant_project_candidates (
            id TEXT PRIMARY KEY,
            canonical_path TEXT NOT NULL UNIQUE,
            display_path TEXT NOT NULL,
            suggested_name TEXT NOT NULL,
            status TEXT NOT NULL,
            project_id TEXT,
            detected_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES assistant_projects(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assistant_projects_updated ON assistant_projects(archived, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_assistant_project_folders_project ON assistant_project_folders(project_id, created_at ASC, association_id ASC);
        CREATE INDEX IF NOT EXISTS idx_assistant_project_candidates_status ON assistant_project_candidates(status, updated_at DESC, id DESC);
    `)
}

export function migrateLegacyAssistantProjects(
    db: SqlDatabase,
    options: {
        projectHomesRoot: string
        excludedLegacyProjectPaths?: readonly string[]
        globalWorkspaceRoot?: string
        now?: () => Date
    }
): { changed: boolean; migratedSessionCount: number; clearedInternalSessionCount: number; projectHomePaths: string[] } {
    initializeAssistantProjectSchema(db)
    const previousMigrationVersion = Number(db.exec(
        "SELECT value FROM assistant_meta WHERE key = 'projectMigrationVersion'"
    )[0]?.values?.[0]?.[0]) || 0
    const occurredAt = nowIso(options.now)
    const excludedPathKeys = new Set((options.excludedLegacyProjectPaths || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map(canonicalAssistantFolderKey))
    const sessionRows = db.exec(`
        SELECT id, project_path
        FROM assistant_sessions
        WHERE project_path IS NOT NULL AND TRIM(project_path) <> ''
        ORDER BY created_at ASC, id ASC
    `)[0]?.values || []
    let migratedSessionCount = 0
    let clearedInternalSessionCount = 0
    const projectHomePaths = new Set<string>()

    runTransaction(db, () => {
        for (const row of sessionRows) {
            const sessionId = sqlString(row[0])
            const displayPath = normalize(resolve(sqlString(row[1])))
            if (!sessionId || !displayPath) continue
            const canonicalPath = canonicalAssistantFolderKey(displayPath)
            if ([...excludedPathKeys].some((rootKey) => isAssistantPathInsideRoot(canonicalPath, rootKey))) {
                db.run('DELETE FROM assistant_chat_scopes WHERE session_id = ?', [sessionId])
                db.run('UPDATE assistant_sessions SET project_path = NULL WHERE id = ?', [sessionId])
                if (options.globalWorkspaceRoot) {
                    db.run('UPDATE assistant_threads SET cwd = ? WHERE session_id = ?', [options.globalWorkspaceRoot, sessionId])
                }
                const internalProjectId = deterministicId('project', canonicalPath)
                db.run(`
                    DELETE FROM assistant_projects
                    WHERE id = ?
                    AND NOT EXISTS (
                        SELECT 1 FROM assistant_chat_scopes WHERE assistant_chat_scopes.project_id = assistant_projects.id
                    )
                `, [internalProjectId])
                clearedInternalSessionCount += 1
                continue
            }
            const projectId = deterministicId('project', canonicalPath)
            const folderId = deterministicId('folder', canonicalPath)
            const associationId = deterministicId('association', `${projectId}\0${folderId}`)
            const homePath = join(options.projectHomesRoot, projectId)
            const label = projectName(displayPath)
            projectHomePaths.add(homePath)

            db.run(`
                INSERT OR IGNORE INTO assistant_projects (
                    id, name, home_path, archived, revision, created_at, updated_at
                ) VALUES (?, ?, ?, 0, 1, ?, ?)
            `, [projectId, label, homePath, occurredAt, occurredAt])
            db.run(`
                INSERT OR IGNORE INTO assistant_folders (
                    id, canonical_path, display_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
            `, [folderId, canonicalPath, displayPath, occurredAt, occurredAt])
            db.run(`
                INSERT OR IGNORE INTO assistant_project_folders (
                    association_id, project_id, folder_id, label, access, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'read-write', ?, ?)
            `, [associationId, projectId, folderId, label, occurredAt, occurredAt])

            const roots: AssistantChatScopeRoot[] = [
                {
                    id: `home:${projectId}`,
                    kind: 'project-home',
                    path: homePath,
                    label: 'Project home',
                    access: 'read-write'
                },
                {
                    id: associationId,
                    kind: 'associated-folder',
                    path: displayPath,
                    label,
                    access: 'read-write'
                }
            ]
            const before = db.exec('SELECT session_id FROM assistant_chat_scopes WHERE session_id = ?', [sessionId])[0]?.values?.[0]
            db.run(`
                INSERT OR IGNORE INTO assistant_chat_scopes (
                    session_id, project_id, revision, working_root_path, roots_json, created_at, updated_at
                ) VALUES (?, ?, 1, ?, ?, ?, ?)
            `, [sessionId, projectId, displayPath, JSON.stringify(roots), occurredAt, occurredAt])
            if (!before) migratedSessionCount += 1
        }
        db.run('INSERT OR REPLACE INTO assistant_meta (key, value) VALUES (?, ?)', [
            'projectMigrationVersion',
            String(ASSISTANT_PROJECT_MIGRATION_VERSION)
        ])
    })

    return {
        changed: previousMigrationVersion < ASSISTANT_PROJECT_MIGRATION_VERSION
            || migratedSessionCount > 0
            || clearedInternalSessionCount > 0,
        migratedSessionCount,
        clearedInternalSessionCount,
        projectHomePaths: [...projectHomePaths]
    }
}

export function ensureAssistantProjectHomeDirectories(paths: readonly string[]): void {
    for (const path of paths) mkdirSync(path, { recursive: true })
}

export function ensureLegacyAssistantProjectForFolder(
    db: SqlDatabase,
    folderPath: string,
    options: { projectHomesRoot: string; now?: () => Date }
): AssistantProject {
    initializeAssistantProjectSchema(db)
    const requestedPath = String(folderPath || '').trim()
    if (!requestedPath) throw new Error('Legacy Project folder path is required.')
    const displayPath = normalize(resolve(requestedPath))
    const canonicalPath = canonicalAssistantFolderKey(displayPath)
    const projectId = deterministicId('project', canonicalPath)
    const folderId = deterministicId('folder', canonicalPath)
    const associationId = deterministicId('association', `${projectId}\0${folderId}`)
    const homePath = join(options.projectHomesRoot, projectId)
    const label = projectName(displayPath)
    const occurredAt = nowIso(options.now)
    runTransaction(db, () => {
        db.run(`
            INSERT OR IGNORE INTO assistant_projects (
                id, name, home_path, archived, revision, created_at, updated_at
            ) VALUES (?, ?, ?, 0, 1, ?, ?)
        `, [projectId, label, homePath, occurredAt, occurredAt])
        db.run(`
            INSERT OR IGNORE INTO assistant_folders (
                id, canonical_path, display_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
        `, [folderId, canonicalPath, displayPath, occurredAt, occurredAt])
        db.run(`
            INSERT OR IGNORE INTO assistant_project_folders (
                association_id, project_id, folder_id, label, access, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'read-write', ?, ?)
        `, [associationId, projectId, folderId, label, occurredAt, occurredAt])
        db.run(`
            UPDATE assistant_project_candidates
            SET status = 'imported', project_id = ?, updated_at = ?
            WHERE canonical_path = ? AND status = 'pending'
        `, [projectId, occurredAt, canonicalPath])
    })
    mkdirSync(homePath, { recursive: true })
    const project = readAssistantProjectCatalog(db).projects.find((entry) => entry.id === projectId)
    if (!project) throw new Error('Migrated Project could not be read back.')
    return project
}

export function readAssistantChatScopes(db: SqlDatabase): Map<string, AssistantChatScope> {
    const result = new Map<string, AssistantChatScope>()
    const rows = db.exec(`
        SELECT session_id, project_id, revision, working_root_path, roots_json, created_at, updated_at
        FROM assistant_chat_scopes
    `)[0]?.values || []
    for (const row of rows) {
        const sessionId = sqlString(row[0])
        const projectId = sqlString(row[1])
        const workingRoot = sqlString(row[3])
        const roots = parseJson<AssistantChatScopeRoot[]>(row[4], []).flatMap((root) => {
            if (!root || typeof root !== 'object') return []
            const path = String(root.path || '').trim()
            const id = String(root.id || '').trim()
            if (!id || !path) return []
            return [{
                id,
                kind: root.kind === 'project-home' ? 'project-home' as const : 'associated-folder' as const,
                path,
                label: String(root.label || projectName(path)).slice(0, PROJECT_NAME_LIMIT),
                access: accessValue(root.access)
            }]
        })
        if (!sessionId || !projectId || !workingRoot || roots.length === 0) continue
        result.set(sessionId, {
            projectId,
            revision: Math.max(1, sqlNumber(row[2], 1)),
            workingRoot,
            roots,
            createdAt: sqlString(row[5]),
            updatedAt: sqlString(row[6])
        })
    }
    return result
}

export function upsertAssistantChatScope(db: SqlDatabase, sessionId: string, scope?: AssistantChatScope | null): void {
    if (!scope) {
        db.run('DELETE FROM assistant_chat_scopes WHERE session_id = ?', [sessionId])
        return
    }
    db.run(`
        INSERT INTO assistant_chat_scopes (
            session_id, project_id, revision, working_root_path, roots_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            project_id = excluded.project_id,
            revision = excluded.revision,
            working_root_path = excluded.working_root_path,
            roots_json = excluded.roots_json,
            updated_at = excluded.updated_at
    `, [
        sessionId,
        scope.projectId,
        Math.max(1, scope.revision),
        scope.workingRoot,
        JSON.stringify(scope.roots),
        scope.createdAt,
        scope.updatedAt
    ])
}

function readProjectFolders(db: SqlDatabase): Map<string, AssistantProjectFolder[]> {
    const byProject = new Map<string, AssistantProjectFolder[]>()
    const rows = db.exec(`
        SELECT
            project_folders.association_id,
            project_folders.folder_id,
            project_folders.project_id,
            folders.display_path,
            project_folders.label,
            project_folders.access,
            project_folders.created_at,
            project_folders.updated_at
        FROM assistant_project_folders AS project_folders
        INNER JOIN assistant_folders AS folders ON folders.id = project_folders.folder_id
        ORDER BY project_folders.created_at ASC, project_folders.association_id ASC
    `)[0]?.values || []
    for (const row of rows) {
        const projectId = sqlString(row[2])
        const path = sqlString(row[3])
        const entry: AssistantProjectFolder = {
            associationId: sqlString(row[0]),
            folderId: sqlString(row[1]),
            projectId,
            path,
            label: sqlString(row[4]) || projectName(path),
            access: accessValue(row[5]),
            available: existsSync(path),
            createdAt: sqlString(row[6]),
            updatedAt: sqlString(row[7])
        }
        const current = byProject.get(projectId) || []
        current.push(entry)
        byProject.set(projectId, current)
    }
    return byProject
}

export function readAssistantProjectCatalog(db: SqlDatabase): AssistantProjectCatalog {
    initializeAssistantProjectSchema(db)
    const foldersByProject = readProjectFolders(db)
    const projectRows = db.exec(`
        SELECT id, name, home_path, archived, revision, created_at, updated_at
        FROM assistant_projects
        ORDER BY archived ASC, updated_at DESC, id DESC
    `)[0]?.values || []
    const projects: AssistantProject[] = projectRows.map((row) => ({
        id: sqlString(row[0]),
        name: sqlString(row[1]) || 'Project',
        homePath: sqlString(row[2]),
        archived: sqlBoolean(row[3]),
        revision: Math.max(1, sqlNumber(row[4], 1)),
        folders: foldersByProject.get(sqlString(row[0])) || [],
        createdAt: sqlString(row[5]),
        updatedAt: sqlString(row[6])
    }))
    const candidateRows = db.exec(`
        SELECT id, display_path, suggested_name, status, project_id, detected_at, updated_at
        FROM assistant_project_candidates
        ORDER BY status ASC, updated_at DESC, id DESC
    `)[0]?.values || []
    const candidates: AssistantProjectMigrationCandidate[] = candidateRows.map((row) => ({
        id: sqlString(row[0]),
        path: sqlString(row[1]),
        suggestedName: sqlString(row[2]) || projectName(sqlString(row[1])),
        status: ['imported', 'dismissed'].includes(sqlString(row[3])) ? sqlString(row[3]) as 'imported' | 'dismissed' : 'pending',
        projectId: sqlString(row[4]) || null,
        detectedAt: sqlString(row[5]),
        updatedAt: sqlString(row[6])
    }))
    const migrationVersionValue = db.exec("SELECT value FROM assistant_meta WHERE key = 'projectMigrationVersion'")[0]?.values?.[0]?.[0]
    return {
        migrationVersion: Math.max(0, Number(migrationVersionValue) || 0),
        projects,
        candidates
    }
}

export function detectAssistantProjectCandidates(
    db: SqlDatabase,
    rootPaths: readonly string[],
    now?: () => Date,
    excludedPaths: readonly string[] = []
): AssistantProjectMigrationCandidate[] {
    initializeAssistantProjectSchema(db)
    const occurredAt = nowIso(now)
    const excludedPathKeys = new Set(excludedPaths.map(canonicalAssistantFolderKey))
    const existingFolderKeys = new Set((db.exec('SELECT canonical_path FROM assistant_folders')[0]?.values || [])
        .map((row) => sqlString(row[0])))
    const detected = new Map<string, { id: string; path: string; suggestedName: string }>()
    for (const rootValue of rootPaths) {
        const rootPath = String(rootValue || '').trim()
        if (!rootPath || !existsSync(rootPath)) continue
        let entries: Array<{ name: string; isDirectory(): boolean }>
        try {
            entries = readdirSync(rootPath, { withFileTypes: true, encoding: 'utf8' })
        } catch {
            continue
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
            const displayPath = join(rootPath, entry.name)
            const canonicalPath = canonicalAssistantFolderKey(displayPath)
            if (
                [...excludedPathKeys].some((rootKey) => isAssistantPathInsideRoot(canonicalPath, rootKey))
                || existingFolderKeys.has(canonicalPath)
                || detected.has(canonicalPath)
            ) continue
            detected.set(canonicalPath, {
                id: deterministicId('candidate', canonicalPath),
                path: displayPath,
                suggestedName: projectName(displayPath)
            })
        }
    }
    runTransaction(db, () => {
        for (const [canonicalPath, candidate] of detected) {
            db.run(`
                INSERT INTO assistant_project_candidates (
                    id, canonical_path, display_path, suggested_name, status, project_id, detected_at, updated_at
                ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)
                ON CONFLICT(canonical_path) DO UPDATE SET
                    display_path = excluded.display_path,
                    suggested_name = excluded.suggested_name,
                    updated_at = excluded.updated_at
            `, [candidate.id, canonicalPath, candidate.path, candidate.suggestedName, occurredAt, occurredAt])
        }
    })
    return readAssistantProjectCatalog(db).candidates.filter((candidate) => candidate.status === 'pending')
}

export function findAssistantProjectByFolderPath(db: SqlDatabase, folderPath: string): AssistantProject | null {
    const canonicalPath = canonicalAssistantFolderKey(folderPath)
    const row = db.exec(`
        SELECT project_folders.project_id
        FROM assistant_project_folders AS project_folders
        INNER JOIN assistant_folders AS folders ON folders.id = project_folders.folder_id
        INNER JOIN assistant_projects AS projects ON projects.id = project_folders.project_id
        WHERE folders.canonical_path = ? AND projects.archived = 0
        ORDER BY projects.updated_at DESC, projects.id DESC
        LIMIT 1
    `, [canonicalPath])[0]?.values?.[0]
    const projectId = sqlString(row?.[0])
    return projectId
        ? readAssistantProjectCatalog(db).projects.find((project) => project.id === projectId) || null
        : null
}

export function createAssistantProject(
    db: SqlDatabase,
    input: AssistantCreateProjectInput,
    options: {
        projectHomesRoot: string
        now?: () => Date
        candidateId?: string
        allowUnavailableFolder?: boolean
        validateFolderPath?: (path: string) => void
    }
): AssistantProject {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Project input must be an object.')
    }
    const hasExplicitFolders = input.folders !== undefined
    const requestedFolders: AssistantCreateProjectFolderInput[] = []
    if (hasExplicitFolders) {
        if (!Array.isArray(input.folders)) throw new Error('Project folders must be an array.')
        if (input.folders.length > INITIAL_PROJECT_FOLDER_LIMIT) {
            throw new Error(`A Project can start with at most ${INITIAL_PROJECT_FOLDER_LIMIT} folders.`)
        }
        for (const folder of input.folders) {
            if (
                !folder || typeof folder !== 'object' || Array.isArray(folder)
                || typeof folder.path !== 'string' || !folder.path.trim()
            ) throw new Error('Each Project folder must include a non-empty path string.')
            if (folder.access !== undefined && folder.access !== 'read-only' && folder.access !== 'read-write') {
                throw new Error('Project folder access must be read-only or read-write.')
            }
            requestedFolders.push({ path: folder.path.trim(), access: folder.access })
        }
    }
    initializeAssistantProjectSchema(db)
    const occurredAt = nowIso(options.now)
    const candidateRow = options.candidateId
        ? db.exec(`
            SELECT display_path, status
            FROM assistant_project_candidates
            WHERE id = ?
            LIMIT 1
        `, [options.candidateId])[0]?.values?.[0]
        : null
    if (options.candidateId && (!candidateRow || sqlString(candidateRow[1]) !== 'pending')) {
        throw new Error('Detected Project candidate was not found or has already been reviewed.')
    }
    const candidatePath = sqlString(candidateRow?.[0])
    if (!hasExplicitFolders) {
        const requestedFolderPath = String(input.folderPath || '').trim()
        if (
            candidatePath
            && requestedFolderPath
            && canonicalAssistantFolderKey(candidatePath) !== canonicalAssistantFolderKey(requestedFolderPath)
        ) throw new Error('Detected Project candidate does not match the requested folder.')
        const folderPath = candidatePath || requestedFolderPath
        if (folderPath) requestedFolders.push({ path: folderPath, access: input.folderAccess })
    }
    const folders = new Map<string, { displayPath: string; access: AssistantProjectFolderAccess }>()
    for (const folder of requestedFolders) {
        const displayPath = normalize(resolve(folder.path))
        const canonicalPath = canonicalAssistantFolderKey(displayPath)
        options.validateFolderPath?.(displayPath)
        // Unavailable legacy roots remain supported; reviewed folder lists must all exist.
        if ((hasExplicitFolders || !options.allowUnavailableFolder) && !isExistingDirectory(displayPath)) {
            throw new Error('Associated folder was not found or is not a directory.')
        }
        // Keep the first selection's access when Windows path variants identify the same folder.
        if (!folders.has(canonicalPath)) {
            folders.set(canonicalPath, { displayPath, access: accessValue(folder.access) })
        }
    }
    if (candidatePath && !folders.has(canonicalAssistantFolderKey(candidatePath))) {
        throw new Error('Detected Project candidate does not match the requested folders.')
    }
    const projectId = `project_${randomUUID()}`
    const homePath = join(options.projectHomesRoot, projectId)
    const firstFolderPath = folders.values().next().value?.displayPath || ''
    const name = (String(input.name || '').replace(/\s+/g, ' ').trim() || projectName(firstFolderPath)).slice(0, PROJECT_NAME_LIMIT)
    runTransaction(db, () => {
        db.run(`
            INSERT INTO assistant_projects (id, name, home_path, archived, revision, created_at, updated_at)
            VALUES (?, ?, ?, 0, 1, ?, ?)
        `, [projectId, name, homePath, occurredAt, occurredAt])
        for (const [canonicalPath, { displayPath, access }] of folders) {
            const folderId = deterministicId('folder', canonicalPath)
            const associationId = deterministicId('association', `${projectId}\0${folderId}`)
            db.run(`
                INSERT OR IGNORE INTO assistant_folders (id, canonical_path, display_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `, [folderId, canonicalPath, displayPath, occurredAt, occurredAt])
            db.run(`
                INSERT INTO assistant_project_folders (
                    association_id, project_id, folder_id, label, access, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [associationId, projectId, folderId, projectName(displayPath), access, occurredAt, occurredAt])
            db.run(`
                UPDATE assistant_project_candidates
                SET status = 'imported', project_id = ?, updated_at = ?
                WHERE canonical_path = ? AND status = 'pending'
            `, [projectId, occurredAt, canonicalPath])
        }
    })
    mkdirSync(homePath, { recursive: true })
    const project = readAssistantProjectCatalog(db).projects.find((entry) => entry.id === projectId)
    if (!project) throw new Error('Created Project could not be read back.')
    return project
}

export function associateAssistantProjectFolder(
    db: SqlDatabase,
    input: AssistantAssociateProjectFolderInput,
    now?: () => Date
): AssistantProject {
    initializeAssistantProjectSchema(db)
    const project = readAssistantProjectCatalog(db).projects.find((entry) => entry.id === input.projectId && !entry.archived)
    if (!project) throw new Error('Project not found or archived.')
    const requestedPath = String(input.path || '').trim()
    if (!requestedPath) throw new Error('Folder path is required.')
    const displayPath = normalize(resolve(requestedPath))
    if (!isExistingDirectory(displayPath)) throw new Error('Associated folder was not found or is not a directory.')
    const canonicalPath = canonicalAssistantFolderKey(displayPath)
    const folderId = deterministicId('folder', canonicalPath)
    const associationId = deterministicId('association', `${project.id}\0${folderId}`)
    const access = accessValue(input.access)
    const occurredAt = nowIso(now)
    const existing = project.folders.find((folder) => folder.folderId === folderId)
    runTransaction(db, () => {
        db.run(`
            INSERT INTO assistant_folders (id, canonical_path, display_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(canonical_path) DO UPDATE SET
                display_path = excluded.display_path,
                updated_at = excluded.updated_at
        `, [folderId, canonicalPath, displayPath, occurredAt, occurredAt])
        db.run(`
            INSERT INTO assistant_project_folders (
                association_id, project_id, folder_id, label, access, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, folder_id) DO UPDATE SET
                label = excluded.label,
                access = excluded.access,
                updated_at = excluded.updated_at
        `, [associationId, project.id, folderId, projectName(displayPath), access, occurredAt, occurredAt])
        if (!existing || existing.access !== access || existing.path !== displayPath) {
            db.run('UPDATE assistant_projects SET revision = revision + 1, updated_at = ? WHERE id = ?', [occurredAt, project.id])
        }
        db.run(`
            UPDATE assistant_project_candidates
            SET status = 'imported', project_id = ?, updated_at = ?
            WHERE canonical_path = ? AND status = 'pending'
        `, [project.id, occurredAt, canonicalPath])
    })
    return readAssistantProjectCatalog(db).projects.find((entry) => entry.id === project.id) || project
}

export function removeAssistantProjectFolder(
    db: SqlDatabase,
    input: AssistantRemoveProjectFolderInput,
    now?: () => Date
): AssistantProject {
    initializeAssistantProjectSchema(db)
    const project = readAssistantProjectCatalog(db).projects.find((entry) => entry.id === input.projectId)
    if (!project) throw new Error('Project not found.')
    const existing = project.folders.find((folder) => folder.folderId === input.folderId)
    if (!existing) return project
    const occurredAt = nowIso(now)
    runTransaction(db, () => {
        db.run('DELETE FROM assistant_project_folders WHERE project_id = ? AND folder_id = ?', [project.id, input.folderId])
        db.run('UPDATE assistant_projects SET revision = revision + 1, updated_at = ? WHERE id = ?', [occurredAt, project.id])
    })
    return readAssistantProjectCatalog(db).projects.find((entry) => entry.id === project.id) || project
}

export function dismissAssistantProjectCandidate(
    db: SqlDatabase,
    input: AssistantDismissProjectCandidateInput,
    now?: () => Date
): void {
    initializeAssistantProjectSchema(db)
    const occurredAt = nowIso(now)
    db.run(`
        UPDATE assistant_project_candidates
        SET status = 'dismissed', project_id = NULL, updated_at = ?
        WHERE id = ? AND status = 'pending'
    `, [occurredAt, input.candidateId])
}

export function updateAssistantProject(
    db: SqlDatabase,
    input: AssistantUpdateProjectInput,
    now?: () => Date
): AssistantProject {
    initializeAssistantProjectSchema(db)
    const project = readAssistantProjectCatalog(db).projects.find((entry) => entry.id === input.projectId)
    if (!project) throw new Error('Project not found.')
    const name = input.name === undefined
        ? project.name
        : String(input.name).replace(/\s+/g, ' ').trim().slice(0, PROJECT_NAME_LIMIT)
    if (!name) throw new Error('Project name is required.')
    const archived = input.archived === undefined ? project.archived : input.archived
    const occurredAt = nowIso(now)
    db.run(`
        UPDATE assistant_projects
        SET name = ?, archived = ?, updated_at = ?
        WHERE id = ?
    `, [name, archived ? 1 : 0, occurredAt, project.id])
    return readAssistantProjectCatalog(db).projects.find((entry) => entry.id === project.id) || project
}

export function createAssistantChatScopeForProject(
    db: SqlDatabase,
    projectId: string,
    requestedWorkingRoot?: string | null,
    now?: () => Date
): AssistantChatScope {
    const project = readAssistantProjectCatalog(db).projects.find((entry) => entry.id === projectId && !entry.archived)
    if (!project) throw new Error('Project not found or archived.')
    const roots: AssistantChatScopeRoot[] = [
        {
            id: `home:${project.id}`,
            kind: 'project-home',
            path: project.homePath,
            label: 'Project home',
            access: 'read-write'
        },
        ...project.folders.map((folder) => ({
            id: folder.associationId,
            kind: 'associated-folder' as const,
            path: folder.path,
            label: folder.label,
            access: folder.access
        }))
    ]
    const requestedKey = requestedWorkingRoot ? canonicalAssistantFolderKey(requestedWorkingRoot) : ''
    const requested = requestedKey
        ? roots.find((root) => (
            canonicalAssistantFolderKey(root.path) === requestedKey
            && (root.kind === 'project-home' || project.folders.some((folder) => folder.available && folder.associationId === root.id))
        ))
        : null
    const availableWritableFolder = project.folders.find((folder) => folder.available && folder.access === 'read-write')
    const workingRoot = requested?.path || availableWritableFolder?.path || project.homePath
    const occurredAt = nowIso(now)
    return {
        projectId: project.id,
        revision: project.revision,
        workingRoot,
        roots,
        createdAt: occurredAt,
        updatedAt: occurredAt
    }
}
