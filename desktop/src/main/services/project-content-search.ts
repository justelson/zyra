import { execFile } from 'node:child_process'
import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ProjectContentSearchInput, ProjectContentSearchResult } from '../../shared/contracts/project-content-search'

import { isPathInsideRoot, readProjectSearchFile } from './project-search-file'

const exec = promisify(execFile)
const MAX_FILES = 5_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', '.venv', '__pycache__', 'dist', 'build', 'target', 'vendor'])

async function hasGitMetadata(root: string): Promise<boolean> {
    if (process.env.GIT_DIR || process.env.GIT_COMMON_DIR || process.env.GIT_WORK_TREE) return true
    for (let folder = root; ; folder = path.dirname(folder)) {
        try { await lstat(path.join(folder, '.git')); return true }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (path.dirname(folder) === folder) return false
    }
}

async function candidates(root: string, signal?: AbortSignal): Promise<{ files: string[]; truncated: boolean }> {
    try {
        const { stdout } = await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
            cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 8_000, signal
        })
        const files = [...new Set(stdout.split('\0').filter(Boolean))]
        return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
    } catch (error) {
        if (signal?.aborted) throw error
        if (await hasGitMetadata(root)) throw new Error('Could not list repository files while preserving Git ignore rules.', { cause: error })
        const files: string[] = []
        const folders = ['']
        let visited = 0
        while (folders.length && files.length < MAX_FILES && visited++ < MAX_FILES) {
            signal?.throwIfAborted()
            const relative = folders.shift()!
            for (const entry of await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => [])) {
                if (entry.isSymbolicLink()) continue
                const name = path.join(relative, entry.name)
                if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) folders.push(name)
                else if (entry.isFile()) files.push(name)
                if (files.length >= MAX_FILES) break
            }
        }
        return { files, truncated: folders.length > 0 || files.length >= MAX_FILES }
    }
}

export async function searchProjectContents(input: ProjectContentSearchInput, signal?: AbortSignal): Promise<ProjectContentSearchResult> {
    if (!input || typeof input.root !== 'string' || !path.isAbsolute(input.root)) throw new Error('Choose a working folder to search.')
    if (typeof input.query !== 'string' || input.query.length > 500) throw new Error('Search text must contain at most 500 characters.')
    const query = input.query.trim()
    if (!query) return { matches: [], truncated: false, scannedFiles: 0 }
    const root = await realpath(input.root)
    const listing = await candidates(root, signal)
    const limit = Math.min(300, Math.max(1, Number.isFinite(input.limit) ? Math.floor(input.limit!) : 200))
    const filter = String(input.fileFilter || '').trim().slice(0, 200)
    const pattern = filter ? new RegExp(`^${filter.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i') : null
    const needle = input.caseSensitive ? query : query.toLocaleLowerCase()
    const result: ProjectContentSearchResult = { matches: [], truncated: listing.truncated, scannedFiles: 0 }
    let totalBytes = 0
    const deadline = Date.now() + 8_000
    for (const relativePath of listing.files) {
        signal?.throwIfAborted()
        if (Date.now() > deadline || totalBytes >= MAX_TOTAL_BYTES) { result.truncated = true; break }
        if (pattern && !pattern.test(relativePath.replace(/\\/g, '/'))) continue
        const filename = path.resolve(root, relativePath)
        if (!isPathInsideRoot(root, filename)) continue
        try {
            const bytes = await readProjectSearchFile(root, filename, MAX_FILE_BYTES, signal)
            if (!bytes) continue
            totalBytes += bytes.length
            if (bytes.includes(0)) continue
            result.scannedFiles++
            const lines = bytes.toString('utf8').split(/\r\n|\n|\r/)
            for (let index = 0; index < lines.length; index++) {
                const column = (input.caseSensitive ? lines[index] : lines[index].toLocaleLowerCase()).indexOf(needle)
                if (column < 0) continue
                result.matches.push({ path: filename, relativePath: relativePath.replace(/\\/g, '/'), line: index + 1, column: column + 1, text: lines[index].slice(Math.max(0, column - 80), column + query.length + 160) })
                if (result.matches.length >= limit) { result.truncated = true; return result }
            }
        } catch (error) {
            if (signal?.aborted) throw error
            // A file can be removed or become unreadable between listing and reading.
        }
    }
    return result
}
