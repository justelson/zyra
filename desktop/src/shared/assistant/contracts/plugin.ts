import type { AssistantCreateSessionInput } from './ipc'

export type AssistantPluginSourceKind = 'official' | 'marketplace' | 'local'
export type AssistantPluginInstallationState = 'active' | 'disabled' | 'failed' | 'quarantined'
export type AssistantPluginContributionKind =
    | 'skills'
    | 'mcp'
    | 'commands'
    | 'apps'
    | 'agents'
    | 'hooks'
    | 'browserExtensions'
    | 'scheduledTasks'
export type AssistantPluginContributionSupport = 'supported' | 'planned' | 'unsupported'
export type AssistantPluginScopeOwnerKind = 'global' | 'project'

export interface AssistantPluginMcpConnectionStatus {
    pluginId: string
    name: string
    server: string
    kind: 'http' | 'stdio'
    destination: string
    state: 'connected' | 'needs-review' | 'not-connected'
}

export interface AssistantPluginAuthor {
    name: string
    email?: string
    url?: string
}

export interface AssistantPluginInterfaceMetadata {
    displayName: string
    shortDescription: string
    longDescription: string
    developerName: string
    category: string
    capabilities: string[]
    websiteUrl: string | null
    privacyPolicyUrl: string | null
    termsOfServiceUrl: string | null
    defaultPrompt: string[]
    composerIcon: string | null
    logo: string | null
    logoDark: string | null
    screenshots: string[]
    brandColor: string | null
}

export interface AssistantPluginManifest {
    schemaVersion: 1
    format: 'openai-codex-plugin-v1'
    name: string
    version: string
    description: string
    author: AssistantPluginAuthor | null
    homepageUrl: string | null
    repositoryUrl: string | null
    license: string | null
    keywords: string[]
    interface: AssistantPluginInterfaceMetadata
    contributions: Record<AssistantPluginContributionKind, string | null>
    declaredCapabilityCeiling: string[]
}

export interface AssistantPluginSkillSummary {
    name: string
    description: string
    relativePath: string
    disableModelInvocation: boolean
}

export interface AssistantPluginContributionSummary {
    kind: AssistantPluginContributionKind
    relativePath: string
    support: AssistantPluginContributionSupport
}

export interface AssistantPluginDiagnostic {
    type: string
    message: string
    contribution?: string
}

export interface AssistantPluginSource {
    id: string
    kind: AssistantPluginSourceKind
    label: string
    locator: string
    createdAt: string
    updatedAt: string
}

/** Review cap: names and hashes of normalized descriptors; no plaintext credentials. */
export interface AssistantPluginConnectionPins {
    appMcpPath?: string | null
    mcpServerPins?: Array<{ name: string; descriptorDigest: string }>
}

export interface AssistantPluginRelease extends AssistantPluginConnectionPins {
    id: string
    pluginId: string
    version: string
    contentDigest: string
    packagePath: string
    manifest: AssistantPluginManifest
    fileCount: number
    totalBytes: number
    containsExecutableFiles: boolean
    skills: AssistantPluginSkillSummary[]
    installedAt: string
}

export interface AssistantPluginInstallation {
    id: string
    sourceId: string
    name: string
    state: AssistantPluginInstallationState
    activeReleaseId: string | null
    releaseIds: string[]
    createdAt: string
    updatedAt: string
}

export interface AssistantPluginSet {
    ownerKind: AssistantPluginScopeOwnerKind
    ownerId: string
    revision: number
    pluginIds: string[]
    createdAt: string
    updatedAt: string
}

export interface AssistantChatPluginScopeEntry extends AssistantPluginConnectionPins {
    pluginId: string
    releaseId: string
    name: string
    version: string
    contentDigest: string
    skillsPath: string | null
    mcpPath: string | null
    capabilityCeiling: string[]
}

export interface AssistantChatPluginScope {
    sessionId: string
    ownerKind: AssistantPluginScopeOwnerKind
    ownerId: string
    pluginSetRevision: number
    scopeRevision: number
    plugins: AssistantChatPluginScopeEntry[]
    createdAt: string
    updatedAt: string
}

export interface AssistantPluginCatalog {
    version: 1
    revision: number
    sources: AssistantPluginSource[]
    plugins: AssistantPluginInstallation[]
    releases: AssistantPluginRelease[]
    pluginSets: AssistantPluginSet[]
    chatScopes: AssistantChatPluginScope[]
    appViews: {
        enabled: boolean
        displayMode: 'manual' | 'automatic'
        pluginIds: string[]
    }
}

export interface AssistantSetPluginAppViewSettingsInput {
    pluginId?: string
    enabled?: boolean
    displayMode?: 'manual' | 'automatic'
    expectedCatalogRevision?: number
}

export interface AssistantReadPluginAppViewInput {
    threadId: string
    pluginId: string
    server: string
    tool: string
    uri: string
}

export interface AssistantCallPluginAppViewToolInput {
    threadId: string
    pluginId: string
    server: string
    tool: string
    arguments: Record<string, unknown>
}

export interface AssistantPluginInspection {
    reviewId: string
    expiresAt: string
    manifest: AssistantPluginManifest
    release: AssistantPluginConnectionPins & {
        name: string
        version: string
        contentDigest: string
        fileCount: number
        totalBytes: number
        containsExecutableFiles: boolean
        skills: AssistantPluginSkillSummary[]
        contributions: AssistantPluginContributionSummary[]
        diagnostics: AssistantPluginDiagnostic[]
    }
}

export interface AssistantInspectLocalPluginInput {
    packagePath: string
    expectedName?: string
    sourceId?: string
    sourceKind?: AssistantPluginSourceKind
    sourceLabel?: string
}

export interface AssistantStartPluginDownloadInput {
    name: string
}

export interface AssistantPluginDownloadInput {
    id: string
}

export interface AssistantPluginDownloadProgress {
    phase: 'metadata' | 'downloading' | 'inspecting'
    completedFiles: number
    totalFiles: number
    completedBytes: number
    totalBytes: number
    cacheHits: number
}

export interface AssistantPluginDownload {
    id: string
    status: 'downloading' | 'ready' | 'failed'
    progress?: AssistantPluginDownloadProgress
    inspection?: AssistantPluginInspection
    error?: string
}

export interface AssistantCreatePluginChatInput {
    composer?: AssistantCreateSessionInput['composer']
    pluginId: string
    releaseId: string
    contentDigest: string
}

export interface AssistantInstallInspectedPluginInput {
    reviewId: string
    confirmed: true
}

export interface AssistantSetPluginSetInput {
    projectId?: string | null
    pluginIds: string[]
    expectedRevision: number
}

export interface AssistantRefreshChatPluginScopeInput {
    sessionId: string
    expectedCatalogRevision?: number
}

export interface AssistantSetPluginStateInput {
    pluginId: string
    state: 'active' | 'disabled'
    expectedCatalogRevision?: number
}

export interface AssistantRollbackPluginInput {
    pluginId: string
    releaseId: string
    confirmed: true
    expectedCatalogRevision?: number
}

export interface AssistantPluginScopeDiff {
    added: AssistantChatPluginScopeEntry[]
    removed: AssistantChatPluginScopeEntry[]
    changed: Array<{
        before: AssistantChatPluginScopeEntry
        after: AssistantChatPluginScopeEntry
    }>
}

export interface AssistantPluginSkillSource {
    dir: string
    installationRoot: string
    scope: 'personal' | 'project'
    sourceId: string
    sourceLabel: string
    loaderSource: 'user' | 'project'
    allowRootMarkdown: false
    enabled: true
    pluginId: string
    releaseId: string
    contentDigest: string
}

/** Main/worker-only MCP source; never project packagePath into browser IPC. */
export interface AssistantPluginMcpSource {
    pluginId: string
    releaseId: string
    contentDigest: string
    name: string
    slug: string
    packagePath: string
    logo: string | null
    servers: Array<
        | { name: string; kind: 'http'; url: string; bearerTokenEnvVar?: string; oauthResource?: string; scopes?: string[]; oauth?: { clientId: string; clientSecret?: string; callbackPort?: number } }
        | { name: string; kind: 'stdio'; command: string; args: string[]; env: Record<string, string> }
    >
}
