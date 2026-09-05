import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  ZYRA_PLUGIN_LIMITS,
  ZyraPluginValidationError,
  assertPluginName,
  parseZyraPluginManifestText,
  parseZyraPluginMarketplaceText,
  pluginContributionSupport,
  resolvePluginRelativePath,
} from './plugin-contract.mjs'

const EXECUTABLE_FILE_PATTERN = /(?:^|\/)(?:scripts?|bin)\/|\.(?:exe|dll|node|msi|bat|cmd|ps1|sh|bash|py|js|mjs|cjs|ts)$/i
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function fail(code, message, details) {
  throw new ZyraPluginValidationError(code, message, details)
}

function pathKey(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isPathInside(value, root) {
  const candidate = pathKey(value)
  const parent = pathKey(root)
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function portableRelative(root, value) {
  return path.relative(root, value).split(path.sep).join('/')
}

async function readBoundedText(file, maxBytes) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxBytes) fail('PLUGIN_FILE_SIZE', 'Plugin metadata exceeds its read limit.')
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function hashFile(file, expected) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  const after = await stat(file)
  if (!after.isFile() || after.size !== expected.size || after.mtimeMs !== expected.mtimeMs) {
    fail('PLUGIN_PACKAGE_CHANGED', 'Plugin package changed while it was being inspected.')
  }
  return hash.digest('hex')
}

async function assertRealPathInside(value, rootRealPath, label) {
  const resolved = await realpath(value)
  if (!isPathInside(resolved, rootRealPath)) {
    fail('PLUGIN_PATH_ESCAPE', `${label} resolves outside the Plugin package.`)
  }
  return resolved
}

async function walkPluginPackage(packageRoot, rootRealPath) {
  const files = []
  let totalBytes = 0
  const visit = async (directory, depth) => {
    if (depth > ZYRA_PLUGIN_LIMITS.maxDepth) {
      fail('PLUGIN_PACKAGE_DEPTH', `Plugin package exceeds ${ZYRA_PLUGIN_LIMITS.maxDepth} directory levels.`)
    }
    await assertRealPathInside(directory, rootRealPath, 'Plugin directory')
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (!entry.name || CONTROL_CHARACTER_PATTERN.test(entry.name) || entry.name === '.' || entry.name === '..') {
        fail('PLUGIN_PATH_INVALID', 'Plugin package contains an invalid file name.')
      }
      const absolutePath = path.join(directory, entry.name)
      const metadata = await lstat(absolutePath)
      if (metadata.isSymbolicLink()) {
        fail('PLUGIN_LINK_UNSUPPORTED', 'Plugin packages cannot contain symbolic links or junctions.', {
          relativePath: portableRelative(rootRealPath, absolutePath),
        })
      }
      await assertRealPathInside(absolutePath, rootRealPath, 'Plugin entry')
      if (metadata.isDirectory()) {
        await visit(absolutePath, depth + 1)
        continue
      }
      if (!metadata.isFile()) {
        fail('PLUGIN_FILE_KIND', 'Plugin package contains an unsupported file kind.', {
          relativePath: portableRelative(rootRealPath, absolutePath),
        })
      }
      if (metadata.size > ZYRA_PLUGIN_LIMITS.maxFileBytes) {
        fail('PLUGIN_FILE_SIZE', `Plugin files cannot exceed ${ZYRA_PLUGIN_LIMITS.maxFileBytes} bytes.`, {
          relativePath: portableRelative(rootRealPath, absolutePath),
        })
      }
      files.push({
        absolutePath,
        relativePath: portableRelative(rootRealPath, absolutePath),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      })
      totalBytes += metadata.size
      if (files.length > ZYRA_PLUGIN_LIMITS.maxPackageFiles) {
        fail('PLUGIN_PACKAGE_FILES', `Plugin package exceeds ${ZYRA_PLUGIN_LIMITS.maxPackageFiles} files.`)
      }
      if (totalBytes > ZYRA_PLUGIN_LIMITS.maxPackageBytes) {
        fail('PLUGIN_PACKAGE_SIZE', `Plugin package exceeds ${ZYRA_PLUGIN_LIMITS.maxPackageBytes} bytes.`)
      }
    }
  }
  await visit(rootRealPath, 0)
  return { files, totalBytes }
}

function parseSkillFrontmatter(text, fallbackName) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    fail('PLUGIN_SKILL_INVALID', `Skill ${fallbackName} has no frontmatter.`)
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) fail('PLUGIN_SKILL_INVALID', `Skill ${fallbackName} has malformed frontmatter.`)
  const values = {}
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    let rawValue = match[2].trim()
    if (['|', '>', '|-', '>-'].includes(rawValue)) {
      const block = []
      while (index + 1 < end && /^\s+/.test(lines[index + 1])) {
        index += 1
        block.push(lines[index].trim())
      }
      rawValue = rawValue.startsWith('>') ? block.join(' ') : block.join('\n')
    }
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      rawValue = rawValue.slice(1, -1)
    }
    values[match[1]] = rawValue
  }
  const name = String(values.name || fallbackName).trim()
  const description = String(values.description || '').replace(/\s+/gu, ' ').trim()
  if (!SKILL_NAME_PATTERN.test(name) || name.includes('--') || name.length > 64) {
    fail('PLUGIN_SKILL_INVALID', `Plugin Skill ${name || fallbackName} has an invalid name.`)
  }
  if (!description || description.length > ZYRA_PLUGIN_LIMITS.maxDescriptionCharacters) {
    fail('PLUGIN_SKILL_INVALID', `Plugin Skill ${name} needs a bounded description.`)
  }
  return {
    name,
    description,
    disableModelInvocation: values['disable-model-invocation'] === 'true',
  }
}

async function inspectPluginSkills(rootRealPath, skillsPath, files) {
  if (!skillsPath) return []
  const skillsRoot = resolvePluginRelativePath(rootRealPath, skillsPath, 'skills')
  const rootMetadata = await lstat(skillsRoot).catch(() => null)
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail('PLUGIN_CONTRIBUTION_MISSING', 'Declared Plugin Skills directory is missing or invalid.')
  }
  const rootRelative = portableRelative(rootRealPath, skillsRoot)
  const prefix = rootRelative ? `${rootRelative}/` : ''
  const skillFiles = files.filter((file) => file.relativePath.startsWith(prefix) && path.posix.basename(file.relativePath).toLowerCase() === 'skill.md')
  if (skillFiles.length === 0) fail('PLUGIN_SKILL_INVALID', 'Declared Plugin Skills directory contains no SKILL.md files.')
  if (skillFiles.length > ZYRA_PLUGIN_LIMITS.maxSkills) {
    fail('PLUGIN_SKILL_LIMIT', `Plugin contains more than ${ZYRA_PLUGIN_LIMITS.maxSkills} Skills.`)
  }
  const seen = new Set()
  const skills = []
  for (const file of skillFiles) {
    const text = await readBoundedText(file.absolutePath, ZYRA_PLUGIN_LIMITS.maxManifestBytes)
    const fallbackName = path.posix.basename(path.posix.dirname(file.relativePath))
    const skill = parseSkillFrontmatter(text, fallbackName)
    if (seen.has(skill.name)) fail('PLUGIN_SKILL_DUPLICATE', `Plugin contains duplicate Skill ${skill.name}.`)
    seen.add(skill.name)
    skills.push({ ...skill, relativePath: file.relativePath })
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

async function existingPathKind(value) {
  try {
    const metadata = await lstat(value)
    if (metadata.isSymbolicLink()) return 'link'
    if (metadata.isDirectory()) return 'directory'
    if (metadata.isFile()) return 'file'
    return 'other'
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

async function effectiveContributions(rootRealPath, manifest) {
  const result = { ...manifest.contributions }
  const conventions = {
    mcp: './.mcp.json',
    hooks: './hooks.json',
    commands: './commands',
    agents: './agents',
  }
  for (const [kind, relativePath] of Object.entries(conventions)) {
    if (!result[kind] && await existingPathKind(resolvePluginRelativePath(rootRealPath, relativePath, kind))) {
      result[kind] = relativePath
    }
  }
  return result
}

async function validateContributionPaths(rootRealPath, manifest, contributions) {
  const expectedKinds = {
    skills: ['directory'],
    apps: ['file'],
    mcp: ['file'],
    commands: ['directory'],
    agents: ['directory'],
    hooks: ['file'],
    browserExtensions: ['directory', 'file'],
    scheduledTasks: ['directory', 'file'],
  }
  for (const [kind, relativePath] of Object.entries(contributions)) {
    if (!relativePath) continue
    const absolutePath = resolvePluginRelativePath(rootRealPath, relativePath, kind)
    const entryKind = await existingPathKind(absolutePath)
    if (!entryKind || entryKind === 'link' || !expectedKinds[kind]?.includes(entryKind)) {
      fail('PLUGIN_CONTRIBUTION_MISSING', `Plugin contribution ${kind} is missing or has the wrong file kind.`, { kind })
    }
    await assertRealPathInside(absolutePath, rootRealPath, `Plugin contribution ${kind}`)
  }
  for (const field of ['composerIcon', 'logo', 'logoDark']) {
    const relativePath = manifest.interface[field]
    if (!relativePath) continue
    const absolutePath = resolvePluginRelativePath(rootRealPath, relativePath, `interface.${field}`)
    if (await existingPathKind(absolutePath) !== 'file') {
      fail('PLUGIN_ASSET_MISSING', `Plugin asset interface.${field} is missing.`)
    }
    await assertRealPathInside(absolutePath, rootRealPath, `Plugin asset interface.${field}`)
  }
  for (const relativePath of manifest.interface.screenshots) {
    const absolutePath = resolvePluginRelativePath(rootRealPath, relativePath, 'interface.screenshots')
    if (await existingPathKind(absolutePath) !== 'file') fail('PLUGIN_ASSET_MISSING', 'Plugin screenshot is missing.')
    await assertRealPathInside(absolutePath, rootRealPath, 'Plugin screenshot')
  }
}

function contributionDescriptors(contributions) {
  return Object.entries(contributions).flatMap(([kind, relativePath]) => relativePath ? [{
    kind,
    relativePath,
    support: pluginContributionSupport(kind),
  }] : [])
}

export async function inspectZyraPluginPackage(packageRoot, options = {}) {
  const requestedRoot = path.resolve(String(packageRoot || ''))
  const rootMetadata = await lstat(requestedRoot).catch(() => null)
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail('PLUGIN_PACKAGE_INVALID', 'Plugin package root must be a real directory.')
  }
  const rootRealPath = await realpath(requestedRoot)
  const manifestPath = path.join(rootRealPath, '.codex-plugin', 'plugin.json')
  const manifestText = await readBoundedText(manifestPath, ZYRA_PLUGIN_LIMITS.maxManifestBytes).catch((error) => {
    if (error instanceof ZyraPluginValidationError) throw error
    fail('PLUGIN_MANIFEST_MISSING', 'Plugin package has no .codex-plugin/plugin.json manifest.')
  })
  const manifest = parseZyraPluginManifestText(manifestText)
  if (options.expectedName && manifest.name !== assertPluginName(options.expectedName, 'Expected Plugin name')) {
    fail('PLUGIN_IDENTITY_MISMATCH', `Plugin manifest name ${manifest.name} does not match the catalog entry.`)
  }

  const { files, totalBytes } = await walkPluginPackage(requestedRoot, rootRealPath)
  const contributions = await effectiveContributions(rootRealPath, manifest)
  await validateContributionPaths(rootRealPath, manifest, contributions)
  const skills = await inspectPluginSkills(rootRealPath, contributions.skills, files)

  const packageHash = createHash('sha256')
  for (const file of files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const digest = await hashFile(file.absolutePath, file)
    packageHash.update(file.relativePath, 'utf8')
    packageHash.update('\0')
    packageHash.update(String(file.size), 'utf8')
    packageHash.update('\0')
    packageHash.update(digest, 'hex')
    packageHash.update('\0')
  }
  const contentDigest = packageHash.digest('hex')
  const containsExecutableFiles = files.some((file) => EXECUTABLE_FILE_PATTERN.test(file.relativePath))
  const diagnostics = contributionDescriptors(contributions)
    .filter((entry) => entry.support === 'unsupported')
    .slice(0, ZYRA_PLUGIN_LIMITS.maxDiagnostics)
    .map((entry) => ({
      type: 'unsupported-contribution',
      message: `${entry.kind} is recorded but disabled by this Zyra release.`,
      contribution: entry.kind,
    }))

  return {
    schemaVersion: 1,
    packageRoot: rootRealPath,
    manifest: { ...manifest, contributions },
    release: {
      name: manifest.name,
      version: manifest.version,
      contentDigest,
      fileCount: files.length,
      totalBytes,
      containsExecutableFiles,
      skills,
      contributions: contributionDescriptors(contributions),
      diagnostics,
    },
    files: files.map(({ absolutePath: _absolutePath, mtimeMs: _mtimeMs, ...file }) => file),
  }
}

export async function readZyraPluginMarketplace(marketplaceRoot, options = {}) {
  const requestedRoot = path.resolve(String(marketplaceRoot || ''))
  const rootMetadata = await lstat(requestedRoot).catch(() => null)
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail('PLUGIN_MARKETPLACE_INVALID', 'Plugin marketplace root must be a real directory.')
  }
  const rootRealPath = await realpath(requestedRoot)
  const manifestPath = path.join(rootRealPath, '.agents', 'plugins', 'marketplace.json')
  const text = await readBoundedText(manifestPath, ZYRA_PLUGIN_LIMITS.maxMarketplaceBytes).catch((error) => {
    if (error instanceof ZyraPluginValidationError) throw error
    fail('PLUGIN_MARKETPLACE_MISSING', 'Marketplace has no .agents/plugins/marketplace.json file.')
  })
  const marketplace = parseZyraPluginMarketplaceText(text, options)
  const plugins = []
  for (const entry of marketplace.plugins) {
    const packagePath = resolvePluginRelativePath(rootRealPath, entry.source.path, `Marketplace Plugin ${entry.name}`)
    const metadata = await lstat(packagePath).catch(() => null)
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
      fail('PLUGIN_SOURCE_INVALID', `Marketplace Plugin ${entry.name} does not resolve to a real directory.`)
    }
    const packageRealPath = await assertRealPathInside(packagePath, rootRealPath, `Marketplace Plugin ${entry.name}`)
    plugins.push({ ...entry, packageRoot: packageRealPath })
  }
  return { ...marketplace, rootPath: rootRealPath, plugins }
}
