import path from 'node:path'
import {
  ZYRA_PLUGIN_LIMITS,
  ZYRA_PLUGIN_STATE_VERSION,
  ZyraPluginValidationError,
  assertPluginName,
  normalizeZyraPluginManifest,
} from './plugin-contract.mjs'

function bounded(value, limit = 256) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit) : ''
}

function pathKey(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function pathInside(value, root) {
  const relative = path.relative(pathKey(root), pathKey(value))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function uniqueStrings(value, limit) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const entry of value) {
    const text = bounded(entry, 192)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function boundedStateArray(value, limit, code, label) {
  if (!Array.isArray(value)) return []
  if (value.length > limit) {
    throw new ZyraPluginValidationError(code, `${label} exceeds this Zyra release's capacity.`)
  }
  return value
}

export function createEmptyPluginSet(ownerKind = 'global', ownerId = 'global') {
  return {
    ownerKind,
    ownerId,
    revision: 1,
    pluginIds: [],
    createdAt: '',
    updatedAt: '',
  }
}

export function createEmptyZyraPluginState() {
  return {
    version: ZYRA_PLUGIN_STATE_VERSION,
    revision: 1,
    sources: [],
    plugins: [],
    releases: [],
    pluginSets: [createEmptyPluginSet()],
    chatScopes: [],
  }
}

function normalizedDate(value, fallback = '') {
  const text = bounded(value, 48)
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = bounded(value.id, 128)
  const kind = ['official', 'marketplace', 'local'].includes(value.kind) ? value.kind : 'local'
  const label = bounded(value.label, 120)
  const locator = bounded(value.locator, 2_048)
  if (!id || !label || !locator) return null
  return {
    id,
    kind,
    label,
    locator,
    createdAt: normalizedDate(value.createdAt),
    updatedAt: normalizedDate(value.updatedAt),
  }
}

function normalizeRelease(value, installationRoot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = bounded(value.id, 128)
  const pluginId = bounded(value.pluginId, 128)
  const version = bounded(value.version, 96)
  const contentDigest = bounded(value.contentDigest, 64).toLowerCase()
  const packagePath = path.resolve(String(value.packagePath || ''))
  if (!id || !pluginId || !/^[a-f0-9]{64}$/.test(contentDigest) || !pathInside(packagePath, installationRoot)) return null
  let manifest
  try {
    manifest = normalizeZyraPluginManifest(value.manifest)
  } catch {
    return null
  }
  if (manifest.version !== version) return null
  const skills = Array.isArray(value.skills) ? value.skills.flatMap((skill) => {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) return []
    const name = bounded(skill.name, 64)
    const description = bounded(skill.description, ZYRA_PLUGIN_LIMITS.maxDescriptionCharacters)
    const relativePath = bounded(skill.relativePath, ZYRA_PLUGIN_LIMITS.maxPathCharacters)
    if (!name || !description || !relativePath) return []
    return [{ name, description, relativePath, disableModelInvocation: skill.disableModelInvocation === true }]
  }).slice(0, ZYRA_PLUGIN_LIMITS.maxSkills) : []
  return {
    id,
    pluginId,
    version,
    contentDigest,
    packagePath,
    manifest,
    fileCount: Math.max(0, Math.min(ZYRA_PLUGIN_LIMITS.maxPackageFiles, Number(value.fileCount) || 0)),
    totalBytes: Math.max(0, Math.min(ZYRA_PLUGIN_LIMITS.maxPackageBytes, Number(value.totalBytes) || 0)),
    containsExecutableFiles: value.containsExecutableFiles === true,
    skills,
    installedAt: normalizedDate(value.installedAt),
  }
}

function normalizePlugin(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = bounded(value.id, 128)
  const sourceId = bounded(value.sourceId, 128)
  let name
  try {
    name = assertPluginName(value.name)
  } catch {
    return null
  }
  const state = ['active', 'disabled', 'failed', 'quarantined'].includes(value.state) ? value.state : 'quarantined'
  if (!id || !sourceId) return null
  return {
    id,
    sourceId,
    name,
    state,
    activeReleaseId: bounded(value.activeReleaseId, 128) || null,
    releaseIds: uniqueStrings(value.releaseIds, ZYRA_PLUGIN_LIMITS.maxReleasesPerPlugin),
    createdAt: normalizedDate(value.createdAt),
    updatedAt: normalizedDate(value.updatedAt),
  }
}

function normalizePluginSet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const ownerKind = value.ownerKind === 'project' ? 'project' : 'global'
  const ownerId = ownerKind === 'global' ? 'global' : bounded(value.ownerId, 192)
  if (!ownerId) return null
  return {
    ownerKind,
    ownerId,
    revision: Math.max(1, Number(value.revision) || 1),
    pluginIds: uniqueStrings(value.pluginIds, ZYRA_PLUGIN_LIMITS.maxPlugins),
    createdAt: normalizedDate(value.createdAt),
    updatedAt: normalizedDate(value.updatedAt),
  }
}

function normalizeScopePlugin(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const pluginId = bounded(value.pluginId, 128)
  const releaseId = bounded(value.releaseId, 128)
  const name = bounded(value.name, 64)
  const version = bounded(value.version, 96)
  const contentDigest = bounded(value.contentDigest, 64).toLowerCase()
  if (!pluginId || !releaseId || !name || !version || !/^[a-f0-9]{64}$/.test(contentDigest)) return null
  return {
    pluginId,
    releaseId,
    name,
    version,
    contentDigest,
    skillsPath: bounded(value.skillsPath, ZYRA_PLUGIN_LIMITS.maxPathCharacters) || null,
    capabilityCeiling: uniqueStrings(value.capabilityCeiling, 32),
  }
}

function normalizeChatScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sessionId = bounded(value.sessionId, 192)
  const ownerKind = value.ownerKind === 'project' ? 'project' : 'global'
  const ownerId = ownerKind === 'global' ? 'global' : bounded(value.ownerId, 192)
  if (!sessionId || !ownerId) return null
  const seen = new Set()
  const plugins = (Array.isArray(value.plugins) ? value.plugins : []).flatMap((entry) => {
    const plugin = normalizeScopePlugin(entry)
    if (!plugin || seen.has(plugin.pluginId)) return []
    seen.add(plugin.pluginId)
    return [plugin]
  }).slice(0, ZYRA_PLUGIN_LIMITS.maxPlugins)
  return {
    sessionId,
    ownerKind,
    ownerId,
    pluginSetRevision: Math.max(1, Number(value.pluginSetRevision) || 1),
    scopeRevision: Math.max(1, Number(value.scopeRevision) || 1),
    plugins,
    createdAt: normalizedDate(value.createdAt),
    updatedAt: normalizedDate(value.updatedAt),
  }
}

export function normalizeZyraPluginState(value, options = {}) {
  const installationRoot = path.resolve(options.installationRoot || process.cwd())
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const version = Number(input.version) || 0
  if (version > ZYRA_PLUGIN_STATE_VERSION) {
    throw new ZyraPluginValidationError('PLUGIN_STATE_NEWER', `Plugin state version ${version} is newer than this Zyra release.`)
  }
  const sources = boundedStateArray(
    input.sources,
    ZYRA_PLUGIN_LIMITS.maxPlugins,
    'PLUGIN_SOURCE_LIMIT',
    'Plugin source state',
  ).map(normalizeSource).filter(Boolean)
  const releases = boundedStateArray(
    input.releases,
    ZYRA_PLUGIN_LIMITS.maxPlugins * ZYRA_PLUGIN_LIMITS.maxReleasesPerPlugin,
    'PLUGIN_RELEASE_LIMIT',
    'Plugin release state',
  ).map((entry) => normalizeRelease(entry, installationRoot)).filter(Boolean)
  const sourceIds = new Set(sources.map((source) => source.id))
  const releaseById = new Map(releases.map((release) => [release.id, release]))
  const plugins = boundedStateArray(
    input.plugins,
    ZYRA_PLUGIN_LIMITS.maxPlugins,
    'PLUGIN_INSTALLATION_LIMIT',
    'Plugin installation state',
  ).map(normalizePlugin).filter(Boolean).filter((plugin) => sourceIds.has(plugin.sourceId)).map((plugin) => {
    const ownsRelease = (releaseId) => releaseById.get(releaseId)?.pluginId === plugin.id
    return {
      ...plugin,
      releaseIds: plugin.releaseIds.filter(ownsRelease),
      activeReleaseId: ownsRelease(plugin.activeReleaseId) ? plugin.activeReleaseId : null,
      state: ownsRelease(plugin.activeReleaseId) ? plugin.state : 'quarantined',
    }
  })
  const pluginIds = new Set(plugins.map((plugin) => plugin.id))
  const pluginSets = boundedStateArray(
    input.pluginSets,
    ZYRA_PLUGIN_LIMITS.maxPluginSets,
    'PLUGIN_SET_LIMIT',
    'Project Plugin set state',
  ).map(normalizePluginSet).filter(Boolean).map((set) => ({
    ...set,
    pluginIds: set.pluginIds.filter((pluginId) => pluginIds.has(pluginId)),
  }))
  if (!pluginSets.some((set) => set.ownerKind === 'global')) {
    if (pluginSets.length >= ZYRA_PLUGIN_LIMITS.maxPluginSets) {
      throw new ZyraPluginValidationError('PLUGIN_SET_LIMIT', 'Project Plugin set state leaves no capacity for the global Plugin set.')
    }
    pluginSets.unshift(createEmptyPluginSet())
  }
  const chatScopes = boundedStateArray(
    input.chatScopes,
    ZYRA_PLUGIN_LIMITS.maxChatScopes,
    'PLUGIN_SCOPE_LIMIT',
    'Chat Plugin scope state',
  ).map(normalizeChatScope).filter(Boolean)
  return {
    version: ZYRA_PLUGIN_STATE_VERSION,
    revision: Math.max(1, Number(input.revision) || 1),
    sources,
    plugins,
    releases,
    pluginSets,
    chatScopes,
  }
}
