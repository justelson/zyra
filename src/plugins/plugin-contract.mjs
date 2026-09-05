import path from 'node:path'

export const ZYRA_PLUGIN_STATE_VERSION = 1
export const ZYRA_PLUGIN_MANIFEST_FORMAT = 'openai-codex-plugin-v1'

export const ZYRA_PLUGIN_LIMITS = Object.freeze({
  maxManifestBytes: 64 * 1024,
  maxMarketplaceBytes: 2 * 1024 * 1024,
  maxMarketplaceEntries: 512,
  maxPackageFiles: 2_048,
  maxPackageBytes: 128 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxDepth: 12,
  maxSkills: 256,
  maxActiveSkillPlugins: 24,
  maxReleasesPerPlugin: 8,
  maxPlugins: 256,
  maxPluginSets: 256,
  maxChatScopes: 2_000,
  maxDiagnostics: 64,
  maxDescriptionCharacters: 1_024,
  maxPathCharacters: 512,
  maxUrlCharacters: 2_048,
})

export const ZYRA_PLUGIN_INSTALLATION_STATES = Object.freeze([
  'active',
  'disabled',
  'failed',
  'quarantined',
])

export const ZYRA_PLUGIN_CONTRIBUTION_SUPPORT = Object.freeze({
  skills: 'supported',
  mcp: 'planned',
  commands: 'planned',
  apps: 'planned',
  agents: 'unsupported',
  hooks: 'unsupported',
  browserExtensions: 'unsupported',
  scheduledTasks: 'unsupported',
})

const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const CONTRIBUTION_FIELDS = Object.freeze({
  skills: ['skills'],
  apps: ['apps'],
  mcp: ['mcp', 'mcpServers', 'mcp_servers'],
  commands: ['commands'],
  agents: ['agents'],
  hooks: ['hooks'],
  browserExtensions: ['browserExtensions', 'browser_extensions'],
  scheduledTasks: ['scheduledTasks', 'scheduled_tasks'],
})

export class ZyraPluginValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ZyraPluginValidationError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new ZyraPluginValidationError(code, message, details)
}

export function asPluginRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function boundedPluginString(value, limit, fallback = '') {
  const normalized = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  return (normalized || fallback).slice(0, limit)
}

export function assertPluginName(value, field = 'Plugin name') {
  const name = boundedPluginString(value, 64)
  if (!name || !PLUGIN_NAME_PATTERN.test(name) || name.includes('--')) {
    fail('PLUGIN_MANIFEST_INVALID', `${field} must use lowercase kebab-case.`, { field })
  }
  return name
}

export function assertPluginVersion(value) {
  const version = boundedPluginString(value, 96)
  if (!SEMVER_PATTERN.test(version)) {
    fail('PLUGIN_MANIFEST_INVALID', 'Plugin version must be semantic versioning.', { field: 'version' })
  }
  return version
}

export function normalizePluginRelativePath(value, field) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  if (raw.length > ZYRA_PLUGIN_LIMITS.maxPathCharacters || CONTROL_CHARACTER_PATTERN.test(raw)) {
    fail('PLUGIN_PATH_INVALID', `${field} has an invalid path.`, { field })
  }
  if (raw.includes('\\') || raw.startsWith('/') || /^[a-z]:/i.test(raw) || raw.startsWith('//')) {
    fail('PLUGIN_PATH_INVALID', `${field} must be a package-relative POSIX path.`, { field })
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    fail('PLUGIN_PATH_INVALID', `${field} cannot be a URL or protocol path.`, { field })
  }
  const withoutPrefix = raw.replace(/^\.\//, '').replace(/\/+$/, '')
  const segments = withoutPrefix.split('/')
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || CONTROL_CHARACTER_PATTERN.test(segment))) {
    fail('PLUGIN_PATH_INVALID', `${field} cannot escape or ambiguously address the package.`, { field })
  }
  const normalized = path.posix.normalize(segments.join('/'))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail('PLUGIN_PATH_INVALID', `${field} cannot escape the package.`, { field })
  }
  return `./${normalized}`
}

export function resolvePluginRelativePath(packageRoot, relativePath, field = 'Plugin contribution') {
  const normalized = normalizePluginRelativePath(relativePath, field)
  if (!normalized) return null
  const root = path.resolve(packageRoot)
  const resolved = path.resolve(root, ...normalized.slice(2).split('/'))
  const relative = path.relative(root, resolved)
  if (!relative || relative === '.') return resolved
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('PLUGIN_PATH_ESCAPE', `${field} resolves outside the package.`, { field })
  }
  return resolved
}

function normalizeHttpsUrl(value, field) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  if (raw.length > ZYRA_PLUGIN_LIMITS.maxUrlCharacters || CONTROL_CHARACTER_PATTERN.test(raw)) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function normalizeAuthor(value) {
  const input = asPluginRecord(value)
  const name = boundedPluginString(input.name, 120)
  if (!name) return null
  const email = boundedPluginString(input.email, 254)
  const url = normalizeHttpsUrl(input.url, 'author.url')
  return {
    name,
    ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
    ...(url ? { url } : {}),
  }
}

function normalizeStringArray(value, options = {}) {
  if (!Array.isArray(value)) return []
  const limit = Math.max(0, Number(options.limit) || 20)
  const maxCharacters = Math.max(1, Number(options.maxCharacters) || 160)
  const seen = new Set()
  const result = []
  for (const item of value) {
    const text = boundedPluginString(item, maxCharacters)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function normalizePathArray(value, field, limit = 12) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const normalized = normalizePluginRelativePath(item, field)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= limit) break
  }
  return result
}

function contributionValue(input, aliases, field) {
  for (const alias of aliases) {
    if (input[alias] !== undefined) return normalizePluginRelativePath(input[alias], field)
  }
  return null
}

function normalizePluginInterface(value, fallbackDescription) {
  const input = asPluginRecord(value)
  const defaultPrompt = Array.isArray(input.defaultPrompt)
    ? normalizeStringArray(input.defaultPrompt, { limit: 8, maxCharacters: 500 })
    : boundedPluginString(input.defaultPrompt, 500)
      ? [boundedPluginString(input.defaultPrompt, 500)]
      : []
  const brandColor = boundedPluginString(input.brandColor, 16)
  return {
    displayName: boundedPluginString(input.displayName, 120),
    shortDescription: boundedPluginString(input.shortDescription, 240, fallbackDescription),
    longDescription: boundedPluginString(input.longDescription, 2_000),
    developerName: boundedPluginString(input.developerName, 120),
    category: boundedPluginString(input.category, 80),
    capabilities: normalizeStringArray(input.capabilities, { limit: 24, maxCharacters: 80 }),
    websiteUrl: normalizeHttpsUrl(input.websiteURL ?? input.websiteUrl, 'interface.websiteURL'),
    privacyPolicyUrl: normalizeHttpsUrl(input.privacyPolicyURL ?? input.privacyPolicyUrl, 'interface.privacyPolicyURL'),
    termsOfServiceUrl: normalizeHttpsUrl(input.termsOfServiceURL ?? input.termsOfServiceUrl, 'interface.termsOfServiceURL'),
    defaultPrompt,
    composerIcon: normalizePluginRelativePath(input.composerIcon, 'interface.composerIcon'),
    logo: normalizePluginRelativePath(input.logo, 'interface.logo'),
    logoDark: normalizePluginRelativePath(input.logoDark, 'interface.logoDark'),
    screenshots: normalizePathArray(input.screenshots, 'interface.screenshots', 12),
    brandColor: HEX_COLOR_PATTERN.test(brandColor) ? brandColor.toLowerCase() : null,
  }
}

export function normalizeZyraPluginManifest(value) {
  const input = asPluginRecord(value)
  const name = assertPluginName(input.name)
  const version = assertPluginVersion(input.version)
  const description = boundedPluginString(input.description, ZYRA_PLUGIN_LIMITS.maxDescriptionCharacters)
  if (!description) fail('PLUGIN_MANIFEST_INVALID', 'Plugin description is required.', { field: 'description' })

  const contributions = {}
  const normalizedContributionInput = asPluginRecord(input.contributions)
  for (const [kind, aliases] of Object.entries(CONTRIBUTION_FIELDS)) {
    contributions[kind] = contributionValue(input, aliases, kind)
      ?? normalizePluginRelativePath(normalizedContributionInput[kind], kind)
  }

  if (!Object.values(contributions).some(Boolean)) {
    fail('PLUGIN_MANIFEST_INVALID', 'Plugin manifest must declare at least one contribution.', { field: 'contributions' })
  }

  const license = boundedPluginString(input.license, 80)
  const repositoryUrl = normalizeHttpsUrl(input.repository ?? input.repositoryUrl, 'repository')
  const homepageUrl = normalizeHttpsUrl(input.homepage ?? input.homepageUrl, 'homepage')
  const normalizedInterface = normalizePluginInterface(input.interface, description)
  const author = normalizeAuthor(input.author)
  const keywords = normalizeStringArray(input.keywords, { limit: 32, maxCharacters: 64 })
  const declaredCapabilityCeiling = normalizedInterface.capabilities.map((entry) => entry.toLowerCase())

  return {
    schemaVersion: 1,
    format: ZYRA_PLUGIN_MANIFEST_FORMAT,
    name,
    version,
    description,
    author,
    homepageUrl,
    repositoryUrl,
    license: license || null,
    keywords,
    interface: normalizedInterface,
    contributions,
    declaredCapabilityCeiling,
  }
}

export function parseZyraPluginManifestText(text) {
  const bytes = Buffer.byteLength(String(text ?? ''), 'utf8')
  if (bytes === 0 || bytes > ZYRA_PLUGIN_LIMITS.maxManifestBytes) {
    fail('PLUGIN_MANIFEST_SIZE', 'Plugin manifest is empty or exceeds the 64 KiB limit.')
  }
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    fail('PLUGIN_MANIFEST_INVALID', 'Plugin manifest is not valid JSON.')
  }
  return normalizeZyraPluginManifest(parsed)
}

function normalizeMarketplacePolicy(value) {
  const input = asPluginRecord(value)
  const installation = boundedPluginString(input.installation, 32).toUpperCase()
  const authentication = boundedPluginString(input.authentication, 32).toUpperCase()
  return {
    installation: ['AVAILABLE', 'REQUIRED', 'BLOCKED'].includes(installation) ? installation : 'AVAILABLE',
    authentication: ['ON_INSTALL', 'ON_USE', 'NONE'].includes(authentication) ? authentication : 'ON_USE',
    products: normalizeStringArray(input.products, { limit: 16, maxCharacters: 48 }),
  }
}

function normalizeMarketplaceSource(value, field) {
  const input = asPluginRecord(value)
  const source = boundedPluginString(input.source, 24).toLowerCase()
  if (source !== 'local') {
    fail('PLUGIN_SOURCE_UNSUPPORTED', `${field} uses an unsupported source kind.`, { field, source })
  }
  const relativePath = normalizePluginRelativePath(input.path, `${field}.path`)
  if (!relativePath) fail('PLUGIN_SOURCE_INVALID', `${field} requires a local source path.`, { field })
  return { kind: 'local', path: relativePath }
}

export function normalizeZyraPluginMarketplace(value, options = {}) {
  const input = asPluginRecord(value)
  const name = assertPluginName(input.name, 'Marketplace name')
  const entries = Array.isArray(input.plugins) ? input.plugins : []
  if (entries.length > ZYRA_PLUGIN_LIMITS.maxMarketplaceEntries) {
    fail('PLUGIN_MARKETPLACE_SIZE', 'Plugin marketplace contains too many entries.')
  }
  const displayName = boundedPluginString(asPluginRecord(input.interface).displayName, 120, name)
  const seen = new Set()
  const plugins = entries.map((entry, index) => {
    const candidate = asPluginRecord(entry)
    const pluginName = assertPluginName(candidate.name, `Marketplace plugin ${index + 1} name`)
    if (seen.has(pluginName)) {
      fail('PLUGIN_MARKETPLACE_DUPLICATE', `Marketplace contains duplicate Plugin ${pluginName}.`, { pluginName })
    }
    seen.add(pluginName)
    return {
      name: pluginName,
      source: normalizeMarketplaceSource(candidate.source, `plugins[${index}].source`),
      policy: normalizeMarketplacePolicy(candidate.policy),
      category: boundedPluginString(candidate.category, 80),
    }
  })
  return {
    schemaVersion: 1,
    name,
    displayName,
    sourceId: boundedPluginString(options.sourceId, 128, `marketplace:${name}`),
    plugins,
  }
}

export function parseZyraPluginMarketplaceText(text, options = {}) {
  const bytes = Buffer.byteLength(String(text ?? ''), 'utf8')
  if (bytes === 0 || bytes > ZYRA_PLUGIN_LIMITS.maxMarketplaceBytes) {
    fail('PLUGIN_MARKETPLACE_SIZE', 'Plugin marketplace is empty or exceeds the 2 MiB limit.')
  }
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    fail('PLUGIN_MARKETPLACE_INVALID', 'Plugin marketplace is not valid JSON.')
  }
  return normalizeZyraPluginMarketplace(parsed, options)
}

export function pluginContributionSupport(kind) {
  return ZYRA_PLUGIN_CONTRIBUTION_SUPPORT[kind] || 'unsupported'
}

export function safePluginIdentifierPart(value, fallback = 'plugin') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '')
  return (normalized || fallback).slice(0, 96)
}
