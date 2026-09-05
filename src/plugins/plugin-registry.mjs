import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ZYRA_PLUGIN_LIMITS,
  ZyraPluginValidationError,
  resolvePluginRelativePath,
  safePluginIdentifierPart,
} from './plugin-contract.mjs'
import { inspectZyraPluginPackage, readZyraPluginMarketplace } from './plugin-package.mjs'
import {
  createEmptyPluginSet as emptyPluginSet,
  createEmptyZyraPluginState,
  normalizeZyraPluginState,
} from './plugin-state.mjs'

export { createEmptyZyraPluginState, normalizeZyraPluginState } from './plugin-state.mjs'

const MAX_STATE_BYTES = 8 * 1024 * 1024
const PLUGIN_STATE_FILE = 'plugin-state.json'
const PLUGIN_RELEASES_DIRECTORY = 'releases'
const PLUGIN_STAGING_DIRECTORY = 'staging'

function fail(code, message, details) {
  throw new ZyraPluginValidationError(code, message, details)
}

function bounded(value, limit = 256) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit) : ''
}

function nowIso(now) {
  return (now?.() || new Date()).toISOString()
}

function stableId(prefix, ...values) {
  const hash = createHash('sha256')
  for (const value of values) {
    hash.update(String(value ?? ''), 'utf8')
    hash.update('\0')
  }
  return `${prefix}_${hash.digest('hex').slice(0, 32)}`
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

function clone(value) {
  return structuredClone(value)
}

function scopeOwner(projectId) {
  const normalized = bounded(projectId, 192)
  return normalized
    ? { ownerKind: 'project', ownerId: normalized }
    : { ownerKind: 'global', ownerId: 'global' }
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertSupportedSkillRelease(release) {
  if (!release?.skills.length || !release.manifest.contributions.skills) {
    fail('PLUGIN_NO_SUPPORTED_SKILLS', 'This Plugin has no usable Skills.')
  }
}

function assertSkillPluginLimit(count) {
  if (count > ZYRA_PLUGIN_LIMITS.maxActiveSkillPlugins) {
    fail('PLUGIN_SKILL_SOURCE_LIMIT', `Plugin availability supports at most ${ZYRA_PLUGIN_LIMITS.maxActiveSkillPlugins} active Skill packages.`)
  }
}

function releaseSnapshot(plugin, release) {
  return {
    pluginId: plugin.id,
    releaseId: release.id,
    name: plugin.name,
    version: release.version,
    contentDigest: release.contentDigest,
    skillsPath: release.manifest.contributions.skills,
    capabilityCeiling: release.manifest.declaredCapabilityCeiling,
  }
}

function scopeDiff(previous, next) {
  const before = new Map((previous?.plugins || []).map((plugin) => [plugin.pluginId, plugin]))
  const after = new Map(next.plugins.map((plugin) => [plugin.pluginId, plugin]))
  return {
    added: next.plugins.filter((plugin) => !before.has(plugin.pluginId)),
    removed: (previous?.plugins || []).filter((plugin) => !after.has(plugin.pluginId)),
    changed: next.plugins.filter((plugin) => {
      const old = before.get(plugin.pluginId)
      return old && (old.releaseId !== plugin.releaseId || old.contentDigest !== plugin.contentDigest)
    }).map((plugin) => ({ before: before.get(plugin.pluginId), after: plugin })),
  }
}

export class ZyraPluginRegistry {
  constructor(options = {}) {
    if (!options.rootPath) throw new Error('ZyraPluginRegistry requires an installation-specific rootPath.')
    this.rootPath = path.resolve(options.rootPath)
    this.stateFile = path.join(this.rootPath, PLUGIN_STATE_FILE)
    this.releasesRoot = path.join(this.rootPath, PLUGIN_RELEASES_DIRECTORY)
    this.stagingRoot = path.join(this.rootPath, PLUGIN_STAGING_DIRECTORY)
    this.now = typeof options.now === 'function' ? options.now : () => new Date()
    this.state = createEmptyZyraPluginState()
    this.initialized = false
    this.initializing = null
    this.queue = Promise.resolve()
  }

  async initialize() {
    if (this.initialized) return
    if (this.initializing) return this.initializing
    this.initializing = this.#initialize()
    try {
      await this.initializing
      this.initialized = true
    } finally {
      this.initializing = null
    }
  }

  async #initialize() {
    await Promise.all([
      mkdir(this.releasesRoot, { recursive: true }),
      mkdir(this.stagingRoot, { recursive: true }),
    ])
    await this.#clearStaging()
    let parsed = createEmptyZyraPluginState()
    try {
      const text = await readFile(this.stateFile, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) fail('PLUGIN_STATE_SIZE', 'Plugin state exceeds its size limit.')
      parsed = JSON.parse(text)
    } catch (error) {
      if (error instanceof ZyraPluginValidationError) throw error
      if (error?.code === 'ENOENT') {
        parsed = createEmptyZyraPluginState()
      } else if (error instanceof SyntaxError) {
        fail('PLUGIN_STATE_INVALID', 'Plugin state is not valid JSON.')
      } else {
        throw error
      }
    }
    this.state = normalizeZyraPluginState(parsed, { installationRoot: this.releasesRoot })
    await this.#writeState()
  }

  async #clearStaging() {
    const entries = await readdir(this.stagingRoot, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map((entry) => rm(path.join(this.stagingRoot, entry.name), { recursive: true, force: true })))
  }

  async #writeState() {
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
      fail('PLUGIN_STATE_SIZE', 'Plugin state exceeds its size limit; no state was changed.')
    }
    await mkdir(this.rootPath, { recursive: true })
    await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(temporary, this.stateFile)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async #mutate(work) {
    await this.initialize()
    const run = this.queue.then(async () => {
      const before = clone(this.state)
      try {
        const result = await work(this.state)
        this.state.revision += 1
        await this.#writeState()
        return clone(result)
      } catch (error) {
        this.state = before
        throw error
      }
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  async getCatalog() {
    await this.initialize()
    await this.queue
    return clone(this.state)
  }

  async inspectLocalPackage(packageRoot, options = {}) {
    return inspectZyraPluginPackage(packageRoot, options)
  }

  async inspectMarketplace(marketplaceRoot, options = {}) {
    return readZyraPluginMarketplace(marketplaceRoot, options)
  }

  async installLocalPackage(input = {}) {
    await this.initialize()
    const sourceRoot = path.resolve(String(input.packageRoot || ''))
    const inspected = await inspectZyraPluginPackage(sourceRoot, { expectedName: input.expectedName })
    const approvedDigest = bounded(input.approvedDigest, 64).toLowerCase()
    if (input.approved !== true || approvedDigest !== inspected.release.contentDigest) {
      fail('PLUGIN_INSTALL_APPROVAL_REQUIRED', 'Plugin install requires trusted approval for the exact inspected content digest.')
    }
    const sourceId = bounded(input.sourceId, 128) || stableId('source', 'local', sourceRoot)
    const sourceKind = ['official', 'marketplace', 'local'].includes(input.sourceKind) ? input.sourceKind : 'local'
    const sourceLabel = bounded(input.sourceLabel, 120) || inspected.manifest.interface.developerName || 'Local Plugin'
    const sourceLocator = input.sourceLocator === undefined ? sourceRoot : String(input.sourceLocator)
    if (input.sourceLocator !== undefined && (sourceKind !== 'official' || !/^https:\/\/github\.com\/openai\/plugins\/tree\/[a-f0-9]{40}\/plugins\/[a-z0-9-]+$/.test(sourceLocator))) {
      fail('PLUGIN_SOURCE_INVALID', 'Managed Plugin provenance must identify its pinned catalog release.')
    }
    const pluginId = stableId('plugin', sourceId, inspected.manifest.name)
    const releaseId = stableId('release', pluginId, inspected.manifest.version, inspected.release.contentDigest)
    const releasePath = path.join(this.releasesRoot, safePluginIdentifierPart(pluginId), safePluginIdentifierPart(releaseId))
    const stagePath = path.join(this.stagingRoot, `${safePluginIdentifierPart(inspected.manifest.name)}-${randomUUID()}`)
    let activatedNewDirectory = false
    try {
      await mkdir(stagePath, { recursive: true })
      for (const file of inspected.files) {
        const sourceFile = path.join(inspected.packageRoot, ...file.relativePath.split('/'))
        const destinationFile = path.join(stagePath, ...file.relativePath.split('/'))
        if (!pathInside(destinationFile, stagePath)) fail('PLUGIN_PATH_ESCAPE', 'Plugin staging path escaped its directory.')
        await mkdir(path.dirname(destinationFile), { recursive: true })
        await copyFile(sourceFile, destinationFile, fsConstants.COPYFILE_EXCL)
      }
      const staged = await inspectZyraPluginPackage(stagePath, { expectedName: inspected.manifest.name })
      if (staged.release.contentDigest !== inspected.release.contentDigest) {
        fail('PLUGIN_DIGEST_MISMATCH', 'Staged Plugin bytes do not match the approved release digest.')
      }
      try {
        await mkdir(path.dirname(releasePath), { recursive: true })
        await rename(stagePath, releasePath)
        activatedNewDirectory = true
      } catch (error) {
        const collisionCode = ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)
        if (!collisionCode) throw error
        let existing
        try {
          existing = await inspectZyraPluginPackage(releasePath, { expectedName: inspected.manifest.name })
        } catch (inspectionError) {
          if (error?.code === 'EPERM') throw error
          throw inspectionError
        }
        if (existing.release.contentDigest !== inspected.release.contentDigest) {
          fail('PLUGIN_RELEASE_COLLISION', 'An existing Plugin release path has different bytes.')
        }
      }

      const mutation = await this.#mutate((state) => {
        const occurredAt = nowIso(this.now)
        let source = state.sources.find((entry) => entry.id === sourceId)
        if (!source) {
          if (state.sources.length >= ZYRA_PLUGIN_LIMITS.maxPlugins) {
            fail('PLUGIN_SOURCE_LIMIT', 'Plugin source capacity has been reached.')
          }
          source = {
            id: sourceId,
            kind: sourceKind,
            label: sourceLabel,
            locator: sourceLocator,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          }
          state.sources.push(source)
        } else {
          source.kind = sourceKind
          source.label = sourceLabel
          source.locator = sourceLocator
          source.updatedAt = occurredAt
        }

        let plugin = state.plugins.find((entry) => entry.id === pluginId)
        const preserveDisabledState = plugin?.state === 'disabled'
        if (!plugin) {
          if (state.plugins.length >= ZYRA_PLUGIN_LIMITS.maxPlugins) {
            fail('PLUGIN_INSTALLATION_LIMIT', 'Plugin installation capacity has been reached.')
          }
          plugin = {
            id: pluginId,
            sourceId,
            name: inspected.manifest.name,
            state: 'active',
            activeReleaseId: releaseId,
            releaseIds: [],
            createdAt: occurredAt,
            updatedAt: occurredAt,
          }
          state.plugins.push(plugin)
        }
        let release = state.releases.find((entry) => entry.id === releaseId)
        if (!release) {
          release = {
            id: releaseId,
            pluginId,
            version: inspected.manifest.version,
            contentDigest: inspected.release.contentDigest,
            packagePath: releasePath,
            manifest: staged.manifest,
            fileCount: staged.release.fileCount,
            totalBytes: staged.release.totalBytes,
            containsExecutableFiles: staged.release.containsExecutableFiles,
            skills: staged.release.skills,
            installedAt: occurredAt,
          }
          state.releases.push(release)
        }
        plugin.state = preserveDisabledState ? 'disabled' : 'active'
        plugin.activeReleaseId = releaseId
        plugin.releaseIds = [releaseId, ...plugin.releaseIds.filter((id) => id !== releaseId)].slice(0, ZYRA_PLUGIN_LIMITS.maxReleasesPerPlugin)
        plugin.updatedAt = occurredAt
        const referencedReleaseIds = new Set(state.chatScopes.flatMap((scope) => scope.plugins.map((entry) => entry.releaseId)))
        const retainedReleaseIds = new Set([...state.plugins.flatMap((entry) => entry.releaseIds), ...referencedReleaseIds])
        const staleReleasePaths = state.releases
          .filter((entry) => entry.pluginId === pluginId && !retainedReleaseIds.has(entry.id))
          .map((entry) => entry.packagePath)
        state.releases = state.releases.filter((entry) => entry.pluginId !== pluginId || retainedReleaseIds.has(entry.id))
        if (state.releases.length > ZYRA_PLUGIN_LIMITS.maxPlugins * ZYRA_PLUGIN_LIMITS.maxReleasesPerPlugin) {
          fail('PLUGIN_RELEASE_LIMIT', 'Pinned Plugin release capacity has been reached.')
        }
        return { plugin, release, source, staleReleasePaths }
      })
      await Promise.all(mutation.staleReleasePaths.map((stalePath) => rm(stalePath, { recursive: true, force: true }).catch(() => undefined)))
      return { plugin: mutation.plugin, release: mutation.release, source: mutation.source }
    } catch (error) {
      if (activatedNewDirectory) await rm(releasePath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      await rm(stagePath, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async setEnabledPlugins(input = {}) {
    const owner = scopeOwner(input.projectId)
    const requested = uniqueStrings(input.pluginIds, ZYRA_PLUGIN_LIMITS.maxPlugins)
    if (requested.length !== (Array.isArray(input.pluginIds) ? input.pluginIds.length : 0)) {
      fail('PLUGIN_SET_INVALID', 'Plugin set contains missing, duplicate, or excessive Plugin IDs.')
    }
    const expectedRevision = Number(input.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      fail('PLUGIN_SET_REVISION_REQUIRED', 'Plugin set updates require the revision inspected by the caller.')
    }
    return this.#mutate((state) => {
      for (const pluginId of requested) {
        const plugin = state.plugins.find((entry) => entry.id === pluginId)
        if (!plugin || plugin.state !== 'active' || !plugin.activeReleaseId) {
          fail('PLUGIN_NOT_ACTIVE', `Plugin ${pluginId} is not active and cannot be enabled.`)
        }
        const release = state.releases.find((entry) => entry.id === plugin.activeReleaseId && entry.pluginId === plugin.id)
        assertSupportedSkillRelease(release)
      }
      assertSkillPluginLimit(requested.length)
      const occurredAt = nowIso(this.now)
      let set = state.pluginSets.find((entry) => entry.ownerKind === owner.ownerKind && entry.ownerId === owner.ownerId)
      const currentRevision = set?.revision ?? 1
      if (currentRevision !== expectedRevision) {
        fail('PLUGIN_SET_REVISION_CHANGED', 'Plugin availability changed after it was inspected. Refresh and try again.', {
          expectedRevision,
          currentRevision,
        })
      }
      if (!set) {
        if (state.pluginSets.length >= ZYRA_PLUGIN_LIMITS.maxPluginSets) {
          fail('PLUGIN_SET_LIMIT', 'Project Plugin set capacity has been reached.')
        }
        set = { ...emptyPluginSet(owner.ownerKind, owner.ownerId), createdAt: occurredAt, updatedAt: occurredAt }
        state.pluginSets.push(set)
      }
      if (sameStrings(set.pluginIds, requested)) return set
      set.pluginIds = requested
      set.revision += 1
      set.updatedAt = occurredAt
      return set
    })
  }

  #buildScope(state, sessionId, projectId, previous, inheritCurrentSet = true) {
    const owner = scopeOwner(projectId)
    const set = inheritCurrentSet
      ? state.pluginSets.find((entry) => entry.ownerKind === owner.ownerKind && entry.ownerId === owner.ownerId)
        || emptyPluginSet(owner.ownerKind, owner.ownerId)
      : emptyPluginSet(owner.ownerKind, owner.ownerId)
    const plugins = set.pluginIds.map((pluginId) => {
      const plugin = state.plugins.find((entry) => entry.id === pluginId)
      const release = plugin?.activeReleaseId ? state.releases.find((entry) => entry.id === plugin.activeReleaseId) : null
      if (!plugin || plugin.state !== 'active' || !release) return null
      assertSupportedSkillRelease(release)
      return releaseSnapshot(plugin, release)
    }).filter(Boolean)
    assertSkillPluginLimit(plugins.length)
    const occurredAt = nowIso(this.now)
    return {
      sessionId,
      ...owner,
      pluginSetRevision: set.revision,
      scopeRevision: previous ? previous.scopeRevision + 1 : 1,
      plugins,
      createdAt: previous?.createdAt || occurredAt,
      updatedAt: occurredAt,
    }
  }

  async createChatScope(input = {}) {
    const sessionId = bounded(input.sessionId, 192)
    if (!sessionId) fail('PLUGIN_SCOPE_INVALID', 'Chat Plugin scope requires a session ID.')
    return this.#mutate(async (state) => {
      const existing = state.chatScopes.find((entry) => entry.sessionId === sessionId)
      if (existing) {
        if (input.selection) fail('PLUGIN_SCOPE_EXISTS', 'Use in Chat requires a new Chat.')
        return existing
      }
      if (state.chatScopes.length >= ZYRA_PLUGIN_LIMITS.maxChatScopes) {
        fail('PLUGIN_SCOPE_LIMIT', 'Chat Plugin scope capacity has been reached; no existing scope was changed.')
      }
      const scope = this.#buildScope(state, sessionId, input.projectId, null, input.selection ? false : input.inherit !== false)
      if (input.selection) {
        const selection = input.selection
        const plugin = state.plugins.find((entry) => entry.id === selection.pluginId)
        const release = state.releases.find((entry) => entry.id === selection.releaseId && entry.pluginId === plugin?.id)
        if (!plugin || plugin.state !== 'active' || !release || plugin.activeReleaseId !== release.id || release.contentDigest !== selection.contentDigest) {
          fail('PLUGIN_SELECTION_CHANGED', 'This Plugin release changed or is unavailable. Refresh before starting a Chat.')
        }
        assertSupportedSkillRelease(release)
        const inspection = await inspectZyraPluginPackage(release.packagePath, { expectedName: plugin.name })
        if (inspection.release.contentDigest !== release.contentDigest) fail('PLUGIN_RELEASE_TAMPERED', 'Installed Plugin bytes no longer match the reviewed release.')
        scope.plugins = [releaseSnapshot(plugin, release)]
        scope.pluginSetRevision = state.pluginSets.find((set) => set.ownerKind === scope.ownerKind && set.ownerId === scope.ownerId)?.revision ?? 1
      }
      state.chatScopes.push(scope)
      return scope
    })
  }

  async ensureLegacyChatScopes(entriesValue) {
    const entries = Array.isArray(entriesValue) ? entriesValue : []
    if (entries.length > ZYRA_PLUGIN_LIMITS.maxChatScopes) {
      fail('PLUGIN_SCOPE_LIMIT', 'Legacy Chat Plugin scope migration exceeds capacity; no scope was changed.')
    }
    return this.#mutate((state) => {
      const existingIds = new Set(state.chatScopes.map((scope) => scope.sessionId))
      const pending = []
      for (const entry of entries) {
        const sessionId = bounded(entry?.sessionId, 192)
        if (!sessionId || existingIds.has(sessionId)) continue
        pending.push({ sessionId, projectId: entry?.projectId })
        existingIds.add(sessionId)
      }
      if (state.chatScopes.length + pending.length > ZYRA_PLUGIN_LIMITS.maxChatScopes) {
        fail('PLUGIN_SCOPE_LIMIT', 'Legacy Chat Plugin scopes exceed capacity; no existing scope was changed.')
      }
      for (const entry of pending) {
        state.chatScopes.push(this.#buildScope(state, entry.sessionId, entry.projectId, null, false))
      }
      return { created: pending.length }
    })
  }

  async refreshChatScope(input = {}) {
    const sessionId = bounded(input.sessionId, 192)
    if (!sessionId) fail('PLUGIN_SCOPE_INVALID', 'Chat Plugin scope requires a session ID.')
    return this.#mutate((state) => {
      const index = state.chatScopes.findIndex((entry) => entry.sessionId === sessionId)
      const previous = index >= 0 ? state.chatScopes[index] : null
      if (!previous && state.chatScopes.length >= ZYRA_PLUGIN_LIMITS.maxChatScopes) {
        fail('PLUGIN_SCOPE_LIMIT', 'Chat Plugin scope capacity has been reached; no existing scope was changed.')
      }
      const next = this.#buildScope(state, sessionId, input.projectId, previous, input.inherit !== false)
      if (index >= 0) state.chatScopes[index] = next
      else state.chatScopes.push(next)
      return { scope: next, diff: scopeDiff(previous, next) }
    })
  }

  async removeChatScope(sessionIdValue) {
    const sessionId = bounded(sessionIdValue, 192)
    if (!sessionId) return false
    return this.#mutate((state) => {
      const before = state.chatScopes.length
      state.chatScopes = state.chatScopes.filter((entry) => entry.sessionId !== sessionId)
      return state.chatScopes.length !== before
    })
  }

  async getChatScope(sessionIdValue) {
    await this.initialize()
    await this.queue
    const sessionId = bounded(sessionIdValue, 192)
    return clone(this.state.chatScopes.find((entry) => entry.sessionId === sessionId) || null)
  }

  async getChatSkillSources(sessionIdValue, options = {}) {
    await this.initialize()
    const sessionId = bounded(sessionIdValue, 192)
    const run = this.queue.then(async () => {
      const scope = this.state.chatScopes.find((entry) => entry.sessionId === sessionId)
      if (!scope) return []
      const skillPluginCount = scope.plugins.filter((plugin) => plugin.skillsPath).length
      if (skillPluginCount > ZYRA_PLUGIN_LIMITS.maxActiveSkillPlugins) {
        fail('PLUGIN_SKILL_SOURCE_LIMIT', `Chat Plugin scope exceeds ${ZYRA_PLUGIN_LIMITS.maxActiveSkillPlugins} active Skill packages.`)
      }
      const result = []
      for (const scopedPlugin of scope.plugins) {
        if (!scopedPlugin.skillsPath) continue
        const release = this.state.releases.find((entry) => entry.id === scopedPlugin.releaseId)
        const plugin = this.state.plugins.find((entry) => entry.id === scopedPlugin.pluginId)
        if (!release || !plugin || release.contentDigest !== scopedPlugin.contentDigest) {
          fail('PLUGIN_SCOPE_RELEASE_MISSING', `Chat Plugin release ${scopedPlugin.releaseId} is unavailable.`)
        }
        if (plugin.state !== 'active') {
          fail('PLUGIN_DISABLED', `Plugin ${plugin.name} is disabled for this installation.`)
        }
        if (options.verify !== false) {
          const inspected = await inspectZyraPluginPackage(release.packagePath, { expectedName: plugin.name })
          if (inspected.release.contentDigest !== scopedPlugin.contentDigest) {
            fail('PLUGIN_RELEASE_TAMPERED', `Plugin ${plugin.name} no longer matches the Chat Plugin scope.`)
          }
        }
        const skillsDirectory = resolvePluginRelativePath(release.packagePath, scopedPlugin.skillsPath, 'skills')
        if (!pathInside(skillsDirectory, this.releasesRoot)) {
          fail('PLUGIN_PATH_ESCAPE', `Plugin ${plugin.name} Skills escaped the installation root.`)
        }
        result.push({
          dir: skillsDirectory,
          installationRoot: this.releasesRoot,
          scope: scope.ownerKind === 'project' ? 'project' : 'personal',
          sourceId: `plugin:${plugin.id}:${release.id}`,
          sourceLabel: release.manifest.interface.displayName || plugin.name,
          loaderSource: scope.ownerKind === 'project' ? 'project' : 'user',
          allowRootMarkdown: false,
          enabled: true,
          pluginId: plugin.id,
          releaseId: release.id,
          contentDigest: release.contentDigest,
        })
      }
      return result
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  async setPluginState(pluginIdValue, stateValue) {
    const pluginId = bounded(pluginIdValue, 128)
    const state = stateValue === 'disabled' ? 'disabled' : 'active'
    return this.#mutate((catalog) => {
      const plugin = catalog.plugins.find((entry) => entry.id === pluginId)
      if (!plugin || !plugin.activeReleaseId) fail('PLUGIN_NOT_FOUND', 'Plugin installation was not found.')
      plugin.state = state
      plugin.updatedAt = nowIso(this.now)
      if (state === 'disabled') {
        for (const set of catalog.pluginSets) {
          if (!set.pluginIds.includes(pluginId)) continue
          set.pluginIds = set.pluginIds.filter((id) => id !== pluginId)
          set.revision += 1
          set.updatedAt = plugin.updatedAt
        }
      }
      return plugin
    })
  }

  async rollbackPlugin(input = {}) {
    const pluginId = bounded(input.pluginId, 128)
    const releaseId = bounded(input.releaseId, 128)
    if (input.approved !== true) fail('PLUGIN_ROLLBACK_APPROVAL_REQUIRED', 'Plugin rollback requires trusted approval.')
    return this.#mutate(async (state) => {
      const plugin = state.plugins.find((entry) => entry.id === pluginId)
      const release = state.releases.find((entry) => entry.id === releaseId && entry.pluginId === pluginId)
      if (!plugin || !release || !plugin.releaseIds.includes(releaseId)) fail('PLUGIN_RELEASE_NOT_FOUND', 'Rollback release was not found.')
      const inspected = await inspectZyraPluginPackage(release.packagePath, { expectedName: plugin.name })
      if (inspected.release.contentDigest !== release.contentDigest) {
        fail('PLUGIN_RELEASE_TAMPERED', `Plugin ${plugin.name} release no longer matches its installed digest.`)
      }
      const preserveDisabledState = plugin.state === 'disabled'
      plugin.activeReleaseId = releaseId
      plugin.state = preserveDisabledState ? 'disabled' : 'active'
      plugin.releaseIds = [releaseId, ...plugin.releaseIds.filter((id) => id !== releaseId)]
      plugin.updatedAt = nowIso(this.now)
      return { plugin, release }
    })
  }
}
