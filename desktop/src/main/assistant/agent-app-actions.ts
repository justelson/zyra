import type { IpcMainInvokeEvent } from 'electron'
import { agentAppActionParameters } from './agent-app-action-inputs'
import type { AgentAppDependencies, AppActor, AppOwnerAction } from './agent-app-service'
import type { ChatGptRoutingPolicy } from '../../shared/onboarding/contracts'
import type { AssistantSkillSourceSettings } from '../../shared/assistant/contracts'
import { getSharedProviderWorkerClient } from '../setup/provider-worker-client'
import { readRuntimeActivation } from './runtime-activation'
import { handleMemoryGetJobStatus, handleMemoryGetModelPreference, handleMemorySetModelPreference } from '../ipc/handlers/memory-handlers'
import { handleGetStartupSettings, handleSetStartupSettings, handleClearAiDebugLogs } from '../ipc/handlers/settings-ai-handlers'
import { handleClearBrowserHistory, handleClearBrowserPreviewData } from '../ipc/handlers/browser-preview-handlers'
import { handleClearBrowserPreviewCache, handleClearBrowserPreviewCookies } from '../ipc/handlers/browser-preview-developer-handlers'
import { handleListBrowserExtensions, handleInspectBrowserExtensionFromWebStore, handleApproveBrowserExtensionFromWebStore, handleSetBrowserExtensionEnabled, handleRemoveBrowserExtension, handleReloadBrowserExtension } from '../ipc/handlers/browser-extension-handlers'

const unusedEvent = undefined as unknown as IpcMainInvokeEvent
const string = (value: unknown, max = 512) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Provide an exact bounded identifier or value.'); return value.trim() }
const checked = async (value: Promise<unknown> | unknown) => {
    const result = await value
    if (result && typeof result === 'object' && 'success' in result && result.success === false) throw new Error('The owning service did not complete this operation. Inspect its current state before retrying.')
    return result
}
export function createAgentAppActions(deps: Omit<AgentAppDependencies, 'actions'>): Record<string, AppOwnerAction> {
    const assistant = deps.getAssistant
    const setup = deps.setup
    const action = (label: string, route: string, effect: string, run: AppOwnerAction['run']): AppOwnerAction => ({ label, route, effect, run })
    const chat = async (actor: AppActor) => {
        const snapshot = await assistant().getSnapshot()
        const record = snapshot.sessions.find(chat => chat.threads.some(thread => thread.providerThreadId === actor.canonicalChatId))
        if (!record) throw new Error('The exact originating Chat is unavailable.')
        return record
    }
    const exactAccount = async (input: Record<string, unknown>) => {
        const id = string(input.accountId)
        const pool = await setup.auth.getChatGptAccounts(false)
        if (!pool.accounts.some(account => account.id === id)) throw new Error('Choose an existing account from usage/accounts first.')
        return id
    }
    const open = (label: string, route: string) => action(label, route, 'secure UI handoff; no credential or consent is supplied by the agent', async (_input, actor) => deps.open(route, actor))
    const actions: Record<string, AppOwnerAction> = {
        'providers.refresh': action('Refresh authenticated model catalog', '/settings/providers', 'read-only refresh', async () => assistant().listModels(true)),
        'providers.credentials': open('Enter or replace provider credentials securely', '/settings/providers'),
        'providers.git_credentials': open('Enter Git-writing service credentials securely', '/settings/providers/writing'),
        'providers.disconnect': action('Disconnect a configured model provider', '/settings/providers', 'may make future work unavailable; does not select a replacement', async input => {
            const provider = string(input.provider, 128)
            if (provider === 'openai-codex' || provider === 'openai') return setup.auth.disconnect(provider === 'openai-codex' ? 'chatgpt' : 'api-key')
            return getSharedProviderWorkerClient().providers.disconnect(provider)
        }),
        'accounts.routing': action('Change the exact enabled account routing pool', '/settings/providers/account', 'future provider requests', async input => {
            const policy = input.policy as ChatGptRoutingPolicy
            const pool = await setup.auth.getChatGptAccounts(false)
            if (!policy || !['balanced', 'round-robin', 'fill-first'].includes(policy.strategy) || !['all', 'selected'].includes(policy.accountMode) || !Array.isArray(policy.accountIds)
                || policy.accountIds.some(id => !pool.accounts.some(account => account.id === id)) || policy.preferredAccountId && !pool.accounts.some(account => account.id === policy.preferredAccountId)) throw new Error('Choose a valid routing policy using existing account IDs.')
            return setup.auth.updateChatGptAccounts({ action: 'policy', policy })
        }),
        'accounts.alias': action('Rename an account alias', '/settings/providers/account', 'presentation only', async input => setup.auth.updateChatGptAccounts({ action: 'alias', accountId: await exactAccount(input), alias: string(input.alias, 80) })),
        'accounts.enabled': action('Enable or pause an account', '/settings/providers/account', 'future provider routing', async input => {
            if (typeof input.enabled !== 'boolean') throw new Error('Choose an explicit enabled state.')
            return setup.auth.updateChatGptAccounts({ action: 'enabled', accountId: await exactAccount(input), enabled: input.enabled })
        }),
        'accounts.primary': action('Choose the primary account', '/settings/providers/account', 'future provider routing', async input => setup.auth.updateChatGptAccounts({ action: 'primary', accountId: await exactAccount(input) })),
        'accounts.remove': action('Remove one exact connected account', '/settings/providers/account', 'removes its saved connection; requires sign-in to restore', async input => setup.auth.updateChatGptAccounts({ action: 'remove', accountId: await exactAccount(input), confirmed: true })),
        'accounts.redeem_reset': action('Redeem one exact banked reset', '/settings/providers/account', 'spends the selected reset credit', async input => assistant().redeemAccountReset({ accountId: await exactAccount(input), creditId: string(input.creditId), confirmed: true })),
        'delegation.get': action('Inspect delegation preferences', '/settings/providers/models', 'read only', async () => getSharedProviderWorkerClient().providers.delegationPreferences()),
        'delegation.update': action('Change delegation approach and guidance', '/settings/providers/models', 'future delegated work; does not change active children', async input => {
            if (input.preset !== undefined && !['balanced', 'cost', 'quality', 'speed'].includes(String(input.preset)) || input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 4000)) throw new Error('Invalid delegation preferences.')
            return getSharedProviderWorkerClient().providers.saveDelegationPreferences({ preset: input.preset, notes: input.notes })
        }),
        'memory.status': action('Inspect background memory processing status', '/settings/assistant/memory', 'read only', async () => ({ processing: handleMemoryGetJobStatus(deps.stateDirectory), model: await handleMemoryGetModelPreference() })),
        'memory.model': action('Choose the memory-processing model', '/settings/assistant/memory', 'future consolidation; does not enable memory', async input => checked(handleMemorySetModelPreference(string(input.model, 256)))),
        'memory.inspect': open('Inspect private saved memory in its owning UI', '/settings/assistant/memory/inspect'),
        'skills.update_sources': action('Change enabled Skill sources and precedence', '/settings/assistant/skills', 'changes executable/instruction trust for future loads', async (input, actor) => {
            const source = await chat(actor)
            return assistant().updateSkillSourceSettings(input.settings as AssistantSkillSourceSettings, source.workingRoot || source.projectPath)
        }),
        'plugins.enable': action('Enable an installed Plugin', '/settings/assistant/plugins', 'existing Chats keep their snapshots until explicitly refreshed', async input => assistant().setPluginState(string(input.pluginId), 'active', Number(input.expectedRevision))),
        'plugins.disable': action('Disable an installed Plugin', '/settings/assistant/plugins', 'revokes capabilities through the existing Plugin authority service', async input => assistant().setPluginState(string(input.pluginId), 'disabled', Number(input.expectedRevision))),
        'plugins.refresh_chat': action('Refresh this Chat Plugin scope', '/settings/assistant/plugins', 'changes exact capabilities available to this Chat', async (input, actor) => assistant().refreshChatPluginScope({ sessionId: (await chat(actor)).id, expectedCatalogRevision: Number(input.expectedRevision) })),
        'plugins.install': open('Inspect and install a Plugin through the release review', '/plugins'),
        'plugins.connect': action('Open an installed Plugin connection sign-in', '/settings/assistant/plugins', 'secure authentication handoff', async input => assistant().connectPluginMcp(string(input.pluginId), string(input.server))),
        'plugins.disconnect': action('Disconnect a Plugin contribution', '/settings/assistant/plugins', 'future calls lose the connection', async input => assistant().disconnectPluginMcp(string(input.pluginId), string(input.server))),
        'projects.associate_folder': action('Associate a Folder with this Project', '/settings/workspace/projects', 'sets Project maximum access; does not expand existing Chat scopes', async (input, actor) => {
            const current = await chat(actor)
            if (!current.projectId || !['read-only', 'read-write'].includes(String(input.access))) throw new Error('Choose an existing current Project and explicit maximum access.')
            return assistant().associateProjectFolder({ projectId: current.projectId, path: string(input.path, 2048), access: input.access as 'read-only' | 'read-write' })
        }),
        'projects.remove_folder': action('Remove one Associated folder', '/settings/workspace/projects', 'changes Project association; never deletes the external directory', async (input, actor) => {
            const current = await chat(actor)
            if (!current.projectId) throw new Error('This Chat has no Project.')
            return assistant().removeProjectFolder({ projectId: current.projectId, folderId: string(input.folderId) })
        }),
        'startup.get': action('Inspect actual OS startup behavior', '/settings/app/general', 'read only', async () => handleGetStartupSettings()),
        'startup.update': action('Change actual OS startup behavior', '/settings/app/general', 'next Windows sign-in; does not restart Zyra', async input => {
            if (typeof input.openAtLogin !== 'boolean' || typeof input.openAsHidden !== 'boolean') throw new Error('Both startup choices must be explicit booleans.')
            return checked(handleSetStartupSettings(unusedEvent, { openAtLogin: input.openAtLogin, openAsHidden: input.openAsHidden }))
        }),
        'browser.clear_cache': action('Clear temporary Browser cache', '/settings/workspace/browser/data', 'keeps website sign-ins', async () => checked(handleClearBrowserPreviewCache(unusedEvent))),
        'browser.clear_history': action('Clear saved Browser history', '/settings/workspace/browser/data', 'removes visited addresses, keeps sign-ins', async () => checked(handleClearBrowserHistory(unusedEvent))),
        'browser.clear_cookies': action('Sign out of Browser websites', '/settings/workspace/browser/data', 'clears cookies and website authentication', async () => checked(handleClearBrowserPreviewCookies(unusedEvent))),
        'browser.reset_profile': action('Reset the Browser profile', '/settings/workspace/browser/data', 'destructive: clears history, cookies, cache and site data', async () => checked(handleClearBrowserPreviewData(unusedEvent))),
        'browser.extensions': action('List installed Browser extensions', '/settings/workspace/browser', 'read only', async () => checked(handleListBrowserExtensions(unusedEvent))),
        'browser.inspect_extension': action('Inspect an extension before installation', '/settings/workspace/browser', 'downloads an untrusted review, does not install it', async input => checked(handleInspectBrowserExtensionFromWebStore(unusedEvent, { urlOrId: string(input.urlOrId, 2048) }))),
        'browser.install_reviewed_extension': action('Install an exact inspected extension', '/settings/workspace/browser', 'adds executable browser capability', async input => checked(handleApproveBrowserExtensionFromWebStore(unusedEvent, string(input.reviewId)))),
        'browser.enable_extension': action('Enable or disable an installed extension', '/settings/workspace/browser', 'changes executable browser capability', async input => {
            if (typeof input.enabled !== 'boolean') throw new Error('Choose explicit extension state.')
            return checked(handleSetBrowserExtensionEnabled(unusedEvent, { id: string(input.id), enabled: input.enabled }))
        }),
        'browser.remove_extension': action('Remove an installed extension', '/settings/workspace/browser', 'removes that exact extension', async input => checked(handleRemoveBrowserExtension(unusedEvent, string(input.id)))),
        'browser.reload_extension': action('Reload an installed extension', '/settings/workspace/browser', 'restarts that extension only', async input => checked(handleReloadBrowserExtension(unusedEvent, string(input.id)))),
        'diagnostics.clear_writing_logs': action('Clear local Git-writing diagnostic logs', '/settings/data/diagnostics', 'deletes those diagnostic records', async () => checked(handleClearAiDebugLogs())),
        'privacy.consent': open('Review analytics and privacy consent', '/settings/data/privacy'),
        'devices.manage': open('Manage pairing and trusted-device access', '/settings/account/devices'),
        'runtime.inspect': action('Inspect exact running/installed runtime identity', '/settings/about', 'read only', async () => readRuntimeActivation()),
        'runtime.refresh': action('Refresh authenticated runtime status', '/settings/about', 'read only; never restarts', async () => { await assistant().refreshRuntimeStatus(); return readRuntimeActivation() }),
        'runtime.activate': action('Activate an available runtime update', '/settings/about', 'existing retirement gate refuses running-work blockers; never kills processes', async () => { await assistant().activateRuntimeUpdate(); return readRuntimeActivation() }),
        'updates.open': open('Review app updates and installation', '/settings/about'),
        'data.manage': open('Review scoped data export and cleanup', '/settings/data/privacy'),
    }
    return Object.fromEntries(Object.entries(actions).map(([id, action]) => [id, { ...action, parameters: agentAppActionParameters(id) }]))
}
