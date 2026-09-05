import { open, readdir, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeZyraSkillSourceSettings,
  readZyraSkillSourceSettings,
  writeZyraSkillSourceSettings,
  ZYRA_SKILL_SOURCE_DEFINITIONS,
} from './zyra-skill-source-settings.mjs'

export {
  DEFAULT_ZYRA_SKILL_SOURCE_SETTINGS,
  normalizeZyraSkillSourceSettings,
  readZyraSkillSourceSettings,
  writeZyraSkillSourceSettings,
  ZYRA_SKILL_SOURCE_DEFINITIONS,
  zyraSkillSourceSettingsPath,
} from './zyra-skill-source-settings.mjs'

const ROOT = path.resolve(process.env.ZYRA_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const RESOURCE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BUILT_IN_DESKTOP_COMMANDS = [
  { name: 'yolo', description: 'Switch this thread to full access.' },
  { name: 'auto', description: 'Switch this thread to automatic review.' },
  { name: 'edits', description: 'Allow project edits and ask before other actions.' },
  { name: 'safe', description: 'Switch this thread back to supervised access.' },
  { name: 'include', description: 'Add a file path to the composer context shelf.' },
]

export const ZYRA_PROMPT_RESOURCE_LIMITS = Object.freeze({
  maxSources: 64,
  maxDirectories: 192,
  maxFiles: 384,
  maxDepth: 8,
  maxFileBytes: 64 * 1024,
  maxCommands: 128,
  maxSkills: 256,
  maxDescriptionCharacters: 1_024,
  maxDiagnostics: 64,
})

function commandSources(project, options = {}) {
  const root = path.resolve(options.root ?? ROOT)
  const home = path.resolve(options.home ?? os.homedir())
  return [
    { dir: path.join(root, 'commands'), scope: 'built-in', kind: 'zyra' },
    { dir: path.join(home, '.zyra', 'commands'), scope: 'personal', kind: 'zyra' },
    ...(project ? [{ dir: path.join(project, '.zyra', 'commands'), scope: 'project', kind: 'zyra' }] : []),
  ]
}

async function pathIsDirectory(value) {
  try {
    return (await stat(value)).isDirectory()
  } catch {
    return false
  }
}

async function findProjectAgentsSkillDirectories(project) {
  if (!project) return []
  const result = []
  let current = path.resolve(project)
  for (let depth = 0; depth < ZYRA_PROMPT_RESOURCE_LIMITS.maxSources; depth += 1) {
    const candidate = path.join(current, '.agents', 'skills')
    if (await pathIsDirectory(candidate)) result.push(candidate)
    if (await pathIsDirectory(path.join(current, '.git'))) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return result.reverse()
}

async function readProjectTrust(project) {
  if (!project) return false
  try {
    const { text, truncated } = await readBoundedText(path.join(project, '.zyra', 'preferences.json'), 16 * 1024)
    if (truncated) return false
    const parsed = JSON.parse(text)
    return Boolean(parsed && typeof parsed === 'object' && parsed.projectTrusted === true)
  } catch {
    return false
  }
}

function pathInside(value, root) {
  const candidate = path.resolve(value)
  const parent = path.resolve(root)
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function normalizePluginSkillSources(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const dir = String(candidate.dir || '').trim()
    const installationRoot = String(candidate.installationRoot || '').trim()
    const sourceId = String(candidate.sourceId || '').trim().slice(0, 256)
    const sourceLabel = String(candidate.sourceLabel || '').replace(/\s+/gu, ' ').trim().slice(0, 120)
    const pluginId = String(candidate.pluginId || '').trim().slice(0, 128)
    const releaseId = String(candidate.releaseId || '').trim().slice(0, 128)
    const contentDigest = String(candidate.contentDigest || '').trim().toLowerCase()
    if (!path.isAbsolute(dir) || !path.isAbsolute(installationRoot) || !sourceId || !sourceLabel || !pluginId || !releaseId || !/^[a-f0-9]{64}$/.test(contentDigest)) {
      throw new Error('Plugin Skill source metadata is invalid.')
    }
    const [canonicalDir, canonicalRoot] = await Promise.all([realpath(dir), realpath(installationRoot)])
    if (!pathInside(canonicalDir, canonicalRoot)) throw new Error('Plugin Skill source is outside its installation root.')
    const key = process.platform === 'win32' ? canonicalDir.toLowerCase() : canonicalDir
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      dir: canonicalDir,
      scope: candidate.scope === 'project' ? 'project' : 'personal',
      sourceId,
      sourceLabel,
      loaderSource: candidate.scope === 'project' ? 'project' : 'user',
      allowRootMarkdown: false,
      enabled: true,
      pluginId,
      releaseId,
      contentDigest,
    })
    if (result.length >= 24) break
  }
  return result
}

/**
 * Ordered from broadest to most specific. Later entries win name collisions.
 * Standard project locations are included only after the project trust bit is set.
 */
export async function resolveZyraSkillSources(options = {}) {
  const root = path.resolve(options.root ?? ROOT)
  const home = path.resolve(options.home ?? os.homedir())
  const project = options.project ? path.resolve(options.project) : null
  const projectTrusted = options.projectTrusted ?? await readProjectTrust(project)
  const settings = options.skillSourceSettings
    ? normalizeZyraSkillSourceSettings(options.skillSourceSettings)
    : await readZyraSkillSourceSettings({ home })
  const enabledSourceIds = new Set(settings.enabledSourceIds)
  const definitions = new Map(ZYRA_SKILL_SOURCE_DEFINITIONS.map((source) => [source.id, source]))
  for (const custom of settings.customSources) {
    definitions.set(custom.id, {
      ...custom,
      description: 'Skills from a folder you selected.',
      allowRootMarkdown: false,
      custom: true,
    })
  }
  const orderedSourceIds = [...settings.priority].reverse()
  const projectAgents = projectTrusted && project ? await findProjectAgentsSkillDirectories(project) : []
  const pluginSkillSources = await normalizePluginSkillSources(options.pluginSkillSources)
  const sources = [{
    dir: path.join(root, 'skills'),
    scope: 'built-in',
    sourceId: 'built-in',
    sourceLabel: 'Built-in',
    loaderSource: 'builtin',
    allowRootMarkdown: true,
    enabled: true,
  }]

  for (const sourceId of orderedSourceIds) {
    const definition = definitions.get(sourceId)
    if (!definition || (!options.includeDisabled && !enabledSourceIds.has(sourceId))) continue
    const dir = definition.custom
      ? definition.path
      : path.join(home, ...definition.personalSegments)
    sources.push({
      dir,
      scope: 'personal',
      sourceId,
      sourceLabel: definition.label,
      loaderSource: 'user',
      allowRootMarkdown: definition.allowRootMarkdown === true,
      enabled: enabledSourceIds.has(sourceId),
    })
  }
  sources.push(...pluginSkillSources.filter((source) => source.scope === 'personal'))

  if (project) {
    sources.push(...pluginSkillSources.filter((source) => source.scope === 'project'))
    for (const sourceId of orderedSourceIds) {
      const definition = definitions.get(sourceId)
      if (!definition || definition.custom || (!options.includeDisabled && !enabledSourceIds.has(sourceId))) continue
      if (sourceId !== 'zyra' && !projectTrusted) continue
      const dirs = sourceId === 'agents'
        ? projectAgents
        : [path.join(project, ...definition.projectSegments)]
      for (const dir of dirs) {
        sources.push({
          dir,
          scope: 'project',
          sourceId,
          sourceLabel: definition.label,
          loaderSource: 'project',
          allowRootMarkdown: definition.allowRootMarkdown === true,
          enabled: enabledSourceIds.has(sourceId),
        })
      }
    }
  }
  if (sources.length <= ZYRA_PROMPT_RESOURCE_LIMITS.maxSources) return sources
  return [sources[0], ...sources.slice(1).slice(-(ZYRA_PROMPT_RESOURCE_LIMITS.maxSources - 1))]
}

function createBudget() {
  return { directories: 0, files: 0, stopped: false }
}

function addDiagnostic(diagnostics, type, message) {
  if (diagnostics.length >= ZYRA_PROMPT_RESOURCE_LIMITS.maxDiagnostics) return
  diagnostics.push({ type, message: String(message || 'Prompt resource warning').slice(0, 512) })
}

async function readBoundedText(file, maxBytes = ZYRA_PROMPT_RESOURCE_LIMITS.maxFileBytes) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return {
      text: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8'),
      truncated: bytesRead > maxBytes,
    }
  } finally {
    await handle.close()
  }
}

function unquote(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replaceAll("''", "'")
  }
  return text
}

function parseFrontmatter(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { values: {}, malformed: false }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return { values: {}, malformed: true }

  const values = {}
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const rawValue = match[2].trim()
    if ((rawValue === '|' || rawValue === '>' || rawValue === '|-' || rawValue === '>-') && index + 1 < end) {
      const block = []
      while (index + 1 < end && /^\s+/.test(lines[index + 1])) {
        index += 1
        block.push(lines[index].trim())
      }
      values[key] = rawValue.startsWith('>') ? block.join(' ') : block.join('\n')
      continue
    }
    values[key] = unquote(rawValue)
  }
  return { values, malformed: false }
}

function validResourceName(value) {
  const name = String(value || '').trim()
  return name.length >= 1 && name.length <= 64 && RESOURCE_NAME_PATTERN.test(name) && !name.includes('--')
}

function extractCommandDescription(text) {
  const parsed = parseFrontmatter(text)
  const frontmatterDescription = String(parsed.values.description || '').trim()
  if (frontmatterDescription) return frontmatterDescription
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const inlineDescription = lines.find((line) => line.toLowerCase().startsWith('description:'))
  if (inlineDescription) return unquote(inlineDescription.slice('description:'.length).trim())
  const heading = lines.find((line) => line.startsWith('#'))
  if (heading) return heading.replace(/^#+\s*/, '').trim()
  return lines[0] || 'custom prompt'
}

function boundedDescription(value) {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim()
  return normalized.slice(0, ZYRA_PROMPT_RESOURCE_LIMITS.maxDescriptionCharacters)
}

async function safeEntries(dir, budget, diagnostics) {
  if (budget.stopped) return []
  if (budget.directories >= ZYRA_PROMPT_RESOURCE_LIMITS.maxDirectories) {
    budget.stopped = true
    addDiagnostic(diagnostics, 'limit', 'Prompt resource directory limit reached; remaining entries were skipped.')
    return []
  }
  budget.directories += 1
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      addDiagnostic(diagnostics, 'warning', 'A prompt resource directory could not be read.')
    }
    return []
  }
}

async function loadCommandFile(file, name, scope, diagnostics) {
  if (!validResourceName(name)) {
    addDiagnostic(diagnostics, 'warning', `Invalid command name: ${name || '(missing)'}`)
    return null
  }
  try {
    const { text, truncated } = await readBoundedText(file)
    if (truncated) addDiagnostic(diagnostics, 'warning', `Command ${name} exceeded the metadata read limit.`)
    return {
      name,
      description: boundedDescription(extractCommandDescription(text)) || 'custom prompt',
      scope,
    }
  } catch {
    addDiagnostic(diagnostics, 'warning', `Command ${name} could not be read.`)
    return null
  }
}

async function loadSkillFile(file, scope, diagnostics) {
  try {
    const { text, truncated } = await readBoundedText(file)
    if (truncated) addDiagnostic(diagnostics, 'warning', 'A skill exceeded the metadata read limit.')
    const parsed = parseFrontmatter(text)
    if (parsed.malformed) {
      addDiagnostic(diagnostics, 'warning', 'A skill has malformed frontmatter.')
      return null
    }
    const name = String(parsed.values.name || path.basename(path.dirname(file))).trim()
    const description = String(parsed.values.description || '').trim()
    if (!validResourceName(name)) {
      addDiagnostic(diagnostics, 'warning', `Invalid skill name: ${name || '(missing)'}`)
      return null
    }
    if (!description) {
      addDiagnostic(diagnostics, 'warning', `Skill ${name} has no description.`)
      return null
    }
    if (description.length > ZYRA_PROMPT_RESOURCE_LIMITS.maxDescriptionCharacters) {
      addDiagnostic(diagnostics, 'warning', `Skill ${name} description is too long.`)
    }
    return {
      name,
      description: boundedDescription(description),
      scope,
      disableModelInvocation: parsed.values['disable-model-invocation'] === true
        || parsed.values['disable-model-invocation'] === 'true',
    }
  } catch {
    addDiagnostic(diagnostics, 'warning', 'A skill could not be read.')
    return null
  }
}

async function discoverSkills(source, budget, diagnostics) {
  const skills = []
  const visitedDirectories = new Set()
  const entryKind = async (entry, fullPath) => {
    if (entry.isDirectory()) return 'directory'
    if (entry.isFile()) return 'file'
    if (!entry.isSymbolicLink()) return null
    try {
      const linked = await stat(fullPath)
      if (linked.isDirectory()) return 'directory'
      if (linked.isFile()) return 'file'
    } catch {
      return null
    }
    return null
  }
  const visit = async (dir, depth, includeRootFiles) => {
    if (budget.stopped || depth > ZYRA_PROMPT_RESOURCE_LIMITS.maxDepth) {
      if (depth > ZYRA_PROMPT_RESOURCE_LIMITS.maxDepth) {
        addDiagnostic(diagnostics, 'limit', 'Prompt resource depth limit reached; nested entries were skipped.')
      }
      return
    }
    try {
      const canonical = await realpath(dir)
      const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical
      if (visitedDirectories.has(key)) return
      visitedDirectories.add(key)
    } catch {
      // safeEntries reports readable-directory failures without leaking paths.
    }
    const entries = await safeEntries(dir, budget, diagnostics)
    const declared = entries.find((entry) => entry.name === 'SKILL.md')
    if (declared && await entryKind(declared, path.join(dir, declared.name)) === 'file') {
      budget.files += 1
      const skill = await loadSkillFile(path.join(dir, declared.name), source.scope, diagnostics)
      if (skill) skills.push({
        ...skill,
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        ...(source.pluginId ? {
          pluginId: source.pluginId,
          pluginReleaseId: source.releaseId,
          pluginContentDigest: source.contentDigest,
        } : {}),
      })
      return
    }
    for (const entry of entries) {
      if (budget.files >= ZYRA_PROMPT_RESOURCE_LIMITS.maxFiles) {
        budget.stopped = true
        addDiagnostic(diagnostics, 'limit', 'Prompt resource file limit reached; remaining entries were skipped.')
        return
      }
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      const kind = await entryKind(entry, fullPath)
      if (kind === 'directory') {
        await visit(fullPath, depth + 1, false)
      } else if (kind === 'file' && includeRootFiles && entry.name.toLowerCase().endsWith('.md')) {
        budget.files += 1
        const skill = await loadSkillFile(fullPath, source.scope, diagnostics)
        if (skill) skills.push({
          ...skill,
          sourceId: source.sourceId,
          sourceLabel: source.sourceLabel,
          ...(source.pluginId ? {
            pluginId: source.pluginId,
            pluginReleaseId: source.releaseId,
            pluginContentDigest: source.contentDigest,
          } : {}),
        })
      }
      if (skills.length >= ZYRA_PROMPT_RESOURCE_LIMITS.maxSkills) return
    }
  }
  await visit(source.dir, 0, source.allowRootMarkdown)
  return skills
}

const SKILL_SCOPE_PRIORITY = Object.freeze({ 'built-in': 0, personal: 1, project: 2 })

function selectSkillCandidate(candidates, settings) {
  if (!candidates.length) return null
  const highestScope = Math.max(...candidates.map((candidate) => SKILL_SCOPE_PRIORITY[candidate.scope] ?? -1))
  const scoped = candidates.filter((candidate) => (SKILL_SCOPE_PRIORITY[candidate.scope] ?? -1) === highestScope)
  const preferredSourceId = settings.preferredSourceBySkill[scoped[0].name]
  if (preferredSourceId) {
    const preferred = scoped.filter((candidate) => candidate.sourceId === preferredSourceId)
    if (preferred.length) return preferred[0]
  }
  return scoped[0]
}

function describeSkillCollision(name, candidates, winner) {
  const sources = [...new Set(candidates.map((candidate) => `${candidate.sourceLabel} ${candidate.scope}`))]
  return `Skill ${name} is available from ${sources.join(', ')}; ${winner.sourceLabel} ${winner.scope} wins.`
}

function buildSkillConflicts(candidatesByName, settings) {
  const conflicts = []
  for (const [name, candidates] of candidatesByName) {
    const sourceIds = [...new Set(candidates.map((candidate) => candidate.sourceId))]
    if (sourceIds.length < 2) continue
    const winner = selectSkillCandidate(candidates, settings)
    if (!winner) continue
    const sources = []
    const seen = new Set()
    for (const candidate of candidates) {
      if (seen.has(candidate.sourceId)) continue
      seen.add(candidate.sourceId)
      sources.push({ id: candidate.sourceId, label: candidate.sourceLabel })
    }
    conflicts.push({
      name,
      winnerSourceId: winner.sourceId,
      winnerSourceLabel: winner.sourceLabel,
      preferredSourceId: settings.preferredSourceBySkill[name] || null,
      sources,
    })
  }
  return conflicts.sort((left, right) => left.name.localeCompare(right.name))
}

export async function listZyraPromptResourceManifest(options = {}) {
  const project = options.project ? path.resolve(options.project) : null
  const home = path.resolve(options.home ?? os.homedir())
  const skillSourceSettings = options.skillSourceSettings
    ? normalizeZyraSkillSourceSettings(options.skillSourceSettings)
    : await readZyraSkillSourceSettings({ home })
  const diagnostics = []
  const commandsByName = new Map(BUILT_IN_DESKTOP_COMMANDS.map((command) => [command.name, {
    ...command,
    scope: 'built-in',
  }]))
  const reservedCommandNames = new Set(commandsByName.keys())
  const commandBudget = createBudget()

  for (const source of commandSources(project, options)) {
    const entries = await safeEntries(source.dir, commandBudget, diagnostics)
    for (const entry of entries) {
      if (commandBudget.files >= ZYRA_PROMPT_RESOURCE_LIMITS.maxFiles) break
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.toLowerCase().endsWith('.md')) continue
      commandBudget.files += 1
      const name = path.basename(entry.name, '.md').toLowerCase()
      const command = await loadCommandFile(path.join(source.dir, entry.name), name, source.scope, diagnostics)
      if (!command) continue
      if (reservedCommandNames.has(name)) {
        addDiagnostic(diagnostics, 'collision', `Command ${name} cannot override the built-in Desktop command.`)
        continue
      }
      const existing = commandsByName.get(name)
      if (!existing && commandsByName.size >= ZYRA_PROMPT_RESOURCE_LIMITS.maxCommands) continue
      if (existing) addDiagnostic(diagnostics, 'collision', `Command ${name} from ${command.scope} overrides ${existing.scope}.`)
      commandsByName.set(name, command)
    }
  }

  const skillCandidatesByName = new Map()
  const skillBudget = createBudget()
  const skillSources = await resolveZyraSkillSources({
    ...options,
    project,
    home,
    skillSourceSettings,
  })
  // Scan high-priority sources first so lower-priority folders cannot exhaust
  // the shared discovery budget before a configured winner is inspected.
  for (const source of [...skillSources].reverse()) {
    const skills = await discoverSkills(source, skillBudget, diagnostics)
    for (const skill of skills) {
      const candidates = skillCandidatesByName.get(skill.name) || []
      candidates.push(skill)
      skillCandidatesByName.set(skill.name, candidates)
      if (skillCandidatesByName.size >= ZYRA_PROMPT_RESOURCE_LIMITS.maxSkills) break
    }
    if (skillCandidatesByName.size >= ZYRA_PROMPT_RESOURCE_LIMITS.maxSkills || skillBudget.stopped) break
  }

  const skills = []
  for (const [name, candidates] of skillCandidatesByName) {
    const winner = selectSkillCandidate(candidates, skillSourceSettings)
    if (!winner) continue
    if (candidates.length > 1) addDiagnostic(diagnostics, 'collision', describeSkillCollision(name, candidates, winner))
    skills.push(winner)
  }

  return {
    commands: [...commandsByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    skills: skills.sort((left, right) => left.name.localeCompare(right.name)),
    skillConflicts: buildSkillConflicts(skillCandidatesByName, skillSourceSettings),
    diagnostics,
  }
}

export async function getZyraSkillSourceOverview(options = {}) {
  const project = options.project ? path.resolve(options.project) : null
  const home = path.resolve(options.home ?? os.homedir())
  const settings = options.skillSourceSettings
    ? normalizeZyraSkillSourceSettings(options.skillSourceSettings)
    : await readZyraSkillSourceSettings({ home })
  const diagnostics = []
  const budget = createBudget()
  const sourcePaths = new Map()
  const skillNamesBySource = new Map()
  const activeCandidatesByName = new Map()

  const overviewSources = await resolveZyraSkillSources({
    ...options,
    project,
    home,
    skillSourceSettings: settings,
    includeDisabled: true,
  })
  for (const source of [...overviewSources].reverse()) {
    if (source.sourceId === 'built-in') continue
    const paths = sourcePaths.get(source.sourceId) || []
    paths.push({
      path: source.dir,
      scope: source.scope,
      detected: await pathIsDirectory(source.dir),
    })
    sourcePaths.set(source.sourceId, paths)

    const skills = await discoverSkills(source, budget, diagnostics)
    const names = skillNamesBySource.get(source.sourceId) || new Set()
    for (const skill of skills) {
      names.add(skill.name)
      if (!source.enabled) continue
      const candidates = activeCandidatesByName.get(skill.name) || []
      candidates.push(skill)
      activeCandidatesByName.set(skill.name, candidates)
    }
    skillNamesBySource.set(source.sourceId, names)
    if (budget.stopped) break
  }

  const definitionById = new Map(ZYRA_SKILL_SOURCE_DEFINITIONS.map((source) => [source.id, source]))
  for (const custom of settings.customSources) {
    definitionById.set(custom.id, {
      ...custom,
      description: 'Skills from a folder you selected.',
    })
  }

  return {
    settings,
    sources: settings.priority.map((id, priority) => {
      const definition = definitionById.get(id)
      const paths = sourcePaths.get(id) || []
      return {
        id,
        label: definition?.label || 'Skill folder',
        description: definition?.description || 'Compatible skills from a selected folder.',
        enabled: settings.enabledSourceIds.includes(id),
        priority,
        detected: paths.some((entry) => entry.detected),
        skillCount: skillNamesBySource.get(id)?.size || 0,
        paths,
        custom: settings.customSources.some((source) => source.id === id),
      }
    }),
    conflicts: buildSkillConflicts(activeCandidatesByName, settings),
    diagnostics,
  }
}

export async function updateZyraSkillSourceSettings(value, options = {}) {
  const settings = await writeZyraSkillSourceSettings(value, options)
  return getZyraSkillSourceOverview({ ...options, skillSourceSettings: settings })
}
