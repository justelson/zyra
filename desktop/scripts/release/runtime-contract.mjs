import { createHash } from 'node:crypto'
import { readFile, readdir, lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export const RUNTIME_SOURCE_DIRECTORIES = Object.freeze(['src', 'analytics', 'prompts', 'agents', 'workflows', 'bin'])
export const RUNTIME_OPTIONAL_DIRECTORIES = Object.freeze(['commands', 'themes'])
export const NODE_RELEASE_RUNTIME_VERSION = '22.22.0'
export const RUNTIME_METADATA_FILES = Object.freeze([
    'package.json',
    'package-lock.json',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'THIRD_PARTY_LICENSES.txt'
])
export const RUNTIME_MANIFEST_FILE = 'zyra-runtime-manifest.json'

const REQUIRED_RUNTIME_FILES = Object.freeze([
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'THIRD_PARTY_LICENSES.txt',
    'analytics/events.v1.json',
    'src/analytics/client.mjs',
    'src/analytics/contracts.mjs',
    'src/analytics/cli.mjs',
    'src/zyra-sdk.mjs',
    'src/zyra-ui-bridge.mjs',
    'src/agent-server/main.mjs',
    'bin/zyra.mjs',
    'prompts/zyra_system_prompt.md',
    'prompts/inspect-project.md',
    'agents/bug-analyzer.md',
    'agents/code-reviewer.md',
    'workflows/review-changes.mjs'
])

async function exists(target) {
    try {
        await lstat(target)
        return true
    } catch {
        return false
    }
}

async function listFiles(root, relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory)
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    const files = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)
        if (entry.isSymbolicLink()) {
            throw new Error(`Runtime staging does not accept source symlinks: ${relativePath}`)
        }
        if (entry.isDirectory()) {
            files.push(...await listFiles(root, relativePath))
        } else if (entry.isFile()) {
            files.push(relativePath)
        }
    }
    return files
}

async function hashFile(file) {
    return createHash('sha256').update(await readFile(file)).digest('hex')
}

export async function getRuntimeSourceDirectories(root) {
    const optional = []
    for (const directory of RUNTIME_OPTIONAL_DIRECTORIES) {
        if (await exists(path.join(root, directory))) optional.push(directory)
    }
    return [...RUNTIME_SOURCE_DIRECTORIES, ...optional]
}

export async function buildRuntimeManifest(runtimeRoot) {
    const packageJson = JSON.parse(await readFile(path.join(runtimeRoot, 'package.json'), 'utf8'))
    const packageLock = JSON.parse(await readFile(path.join(runtimeRoot, 'package-lock.json'), 'utf8'))
    const sourceDirectories = await getRuntimeSourceDirectories(runtimeRoot)
    const sourceFiles = []
    for (const directory of sourceDirectories) {
        for (const relativePath of await listFiles(runtimeRoot, directory)) {
            const absolutePath = path.join(runtimeRoot, ...relativePath.split('/'))
            const stats = await lstat(absolutePath)
            sourceFiles.push({
                path: relativePath,
                size: stats.size,
                sha256: await hashFile(absolutePath)
            })
        }
    }
    for (const relativePath of RUNTIME_METADATA_FILES) {
        const absolutePath = path.join(runtimeRoot, relativePath)
        const stats = await lstat(absolutePath)
        sourceFiles.push({
            path: relativePath,
            size: stats.size,
            sha256: await hashFile(absolutePath)
        })
    }
    sourceFiles.sort((left, right) => left.path.localeCompare(right.path))

    const dependencies = Object.fromEntries(
        Object.entries(packageJson.dependencies || {}).sort(([left], [right]) => left.localeCompare(right))
    )
    return {
        schemaVersion: 1,
        name: packageJson.name,
        version: packageJson.version,
        lockfileVersion: packageLock.lockfileVersion,
        sourceDirectories,
        dependencies,
        sourceFiles
    }
}

function packageNameForSpecifier(specifier) {
    if (specifier.startsWith('node:') || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) return null
    const parts = specifier.split('/')
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function isContained(root, target) {
    const relative = path.relative(root, target)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

// Resolve existing ancestors even in source-only stages, where dependencies may be absent.
async function canonicalImportPath(target) {
    try {
        return await realpath(target)
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
        // A dangling link must not be treated as an absent dependency directory.
        if (await exists(target)) throw new Error(`Unsafe runtime import: dangling link at ${target}`)
        const parent = path.dirname(target)
        if (parent === target) throw error
        return path.join(await canonicalImportPath(parent), path.basename(target))
    }
}

function resolveRelativeImport(sourcePath, specifier) {
    // Do not let URL escapes or platform-specific separators bypass segment checks.
    if (/[\\\\%?#]/.test(specifier)) throw new Error(`Unsafe runtime import: ${sourcePath} -> ${specifier}`)
    const segments = path.posix.dirname(sourcePath).split('/')
    let dependencyDepth = 0
    for (const segment of specifier.split('/')) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            if (segments.length === 0 || (dependencyDepth && segments.length <= dependencyDepth)) {
                throw new Error(`Unsafe runtime import: ${sourcePath} -> ${specifier}`)
            }
            segments.pop()
        } else {
            segments.push(segment)
            // Once an import enters node_modules, it cannot traverse out of its package.
            if (segments[0] === 'node_modules' && segments.length <= 3) {
                dependencyDepth = segments[1]?.startsWith('@') ? Math.min(segments.length, 3) : Math.min(segments.length, 2)
            }
        }
    }
    return segments.join('/')
}

async function validateDependencyImport(runtimeRoot, resolved, dependencies, requireDependencies) {
    const parts = resolved.split('/')
    const packageName = packageNameForSpecifier(parts.slice(1).join('/'))
    if (!packageName || !Object.hasOwn(dependencies, packageName)) {
        throw new Error(`Runtime source imports undeclared production dependency: ${packageName || resolved}`)
    }
    const modulesRoot = path.join(runtimeRoot, 'node_modules')
    const dependencyRoot = path.join(modulesRoot, ...packageName.split('/'))
    const target = path.join(runtimeRoot, ...parts)
    const canonicalRuntime = await realpath(runtimeRoot)
    const canonicalModules = await canonicalImportPath(modulesRoot)
    const canonicalDependency = await canonicalImportPath(dependencyRoot)
    const canonicalTarget = await canonicalImportPath(target)
    if (!isContained(canonicalRuntime, canonicalModules)
        || !isContained(canonicalModules, canonicalDependency)
        || !isContained(canonicalDependency, canonicalTarget)) {
        throw new Error(`Unsafe runtime import: dependency path escapes staged root: ${resolved}`)
    }
    if (requireDependencies) {
        let stats
        try {
            stats = await stat(target)
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
            throw new Error(`Staged runtime dependency import is missing: ${resolved}`)
        }
        if (!stats.isFile()) throw new Error(`Staged runtime dependency import is not a file: ${resolved}`)
    }
}

async function validateSourceImports(runtimeRoot, sourceFiles, dependencies, requireDependencies) {
    const sourceSet = new Set(sourceFiles.map((entry) => entry.path))
    const externalImports = new Set()
    const declarationPattern = /^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']/gm
    const dynamicPattern = /\b(?:import\s*\(|import\.meta\.resolve\s*\()\s*["']([^"']+)["']/g

    for (const entry of sourceFiles.filter((item) => item.path.startsWith('src/') && item.path.endsWith('.mjs'))) {
        const sourcePath = path.join(runtimeRoot, ...entry.path.split('/'))
        if (!isContained(await realpath(runtimeRoot), await realpath(sourcePath))) {
            throw new Error(`Unsafe runtime import: source escapes staged root: ${entry.path}`)
        }
        const source = await readFile(sourcePath, 'utf8')
        const specifiers = [
            ...source.matchAll(declarationPattern),
            ...source.matchAll(dynamicPattern)
        ].map((match) => match[1])
        for (const specifier of specifiers) {
            if (specifier.startsWith('.')) {
                const resolved = resolveRelativeImport(entry.path, specifier)
                if (resolved.startsWith('node_modules/')) {
                    await validateDependencyImport(runtimeRoot, resolved, dependencies, requireDependencies)
                    continue
                }
                if (!sourceSet.has(resolved)) {
                    throw new Error(`Staged runtime import is missing: ${entry.path} -> ${specifier}`)
                }
                if (!isContained(await realpath(runtimeRoot), await realpath(path.join(runtimeRoot, ...resolved.split('/'))))) {
                    throw new Error(`Unsafe runtime import: source escapes staged root: ${resolved}`)
                }
                continue
            }
            const packageName = packageNameForSpecifier(specifier)
            if (packageName) externalImports.add(packageName)
        }
    }

    for (const packageName of externalImports) {
        if (!Object.hasOwn(dependencies, packageName)) {
            throw new Error(`Runtime source imports undeclared production dependency: ${packageName}`)
        }
    }
}

export async function validateRuntimeStage(runtimeRoot, options = {}) {
    const expectedVersion = options.expectedVersion || null
    const requireDependencies = options.requireDependencies !== false
    const manifestPath = path.join(runtimeRoot, RUNTIME_MANIFEST_FILE)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const rebuiltManifest = await buildRuntimeManifest(runtimeRoot)

    if (JSON.stringify(manifest) !== JSON.stringify(rebuiltManifest)) {
        throw new Error('Staged runtime source does not match zyra-runtime-manifest.json')
    }
    if (expectedVersion && manifest.version !== expectedVersion) {
        throw new Error(`Staged runtime version ${manifest.version} does not match expected ${expectedVersion}`)
    }

    const packageJson = JSON.parse(await readFile(path.join(runtimeRoot, 'package.json'), 'utf8'))
    const packageLock = JSON.parse(await readFile(path.join(runtimeRoot, 'package-lock.json'), 'utf8'))
    if (packageJson.version !== packageLock.version || packageJson.version !== packageLock.packages?.['']?.version) {
        throw new Error('Staged package.json and package-lock.json versions are not lockstep')
    }
    if (packageJson.name !== packageLock.name || packageJson.name !== packageLock.packages?.['']?.name) {
        throw new Error('Staged package identity does not match package-lock.json')
    }
    if (packageJson.license !== 'Apache-2.0') {
        throw new Error(`Staged runtime must declare Apache-2.0; got ${packageJson.license || 'missing'}`)
    }

    const sourceFileSet = new Set(manifest.sourceFiles.map((entry) => entry.path))
    for (const requiredFile of REQUIRED_RUNTIME_FILES) {
        if (!sourceFileSet.has(requiredFile)) throw new Error(`Staged runtime is missing required file: ${requiredFile}`)
    }
    await validateSourceImports(runtimeRoot, manifest.sourceFiles, manifest.dependencies, requireDependencies)

    if (requireDependencies) {
        for (const dependency of Object.keys(manifest.dependencies)) {
            const dependencyPackage = path.join(runtimeRoot, 'node_modules', ...dependency.split('/'), 'package.json')
            if (!(await exists(dependencyPackage))) {
                throw new Error(`Staged runtime dependency is missing: ${dependency}`)
            }
        }
    }

    return manifest
}
