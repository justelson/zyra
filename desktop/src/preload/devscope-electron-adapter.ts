import { createRuntimeActivationAdapter } from './adapters/runtime-activation-adapter'
/**
 * Zyra - Electron Adapter
 */

import type { DevScopeApi } from '../shared/contracts/devscope-api'
import { createAssistantAdapter } from './adapters/assistant-adapter'
import { createAssistantUtilityAdapter } from './adapters/assistant-utility-adapter'
import { createBrowserPopupAdapter } from './adapters/browser-popup-adapter'
import { createBrowserViewAdapter } from './adapters/browser-view-adapter'
import { createAgentControlAdapter } from './adapters/agent-control-adapter'
import { createDisabledAdapters } from './adapters/disabled-adapters'
import { createFontsAdapter } from './adapters/fonts-adapter'
import { createMemoryAdapter } from './adapters/memory-adapter'
import { createProjectsAdapter } from './adapters/projects-adapter'
import { createSettingsAndAiAdapter } from './adapters/settings-ai-adapter'
import { createSetupAdapter } from './adapters/setup-adapter'
import { createUpdatesAdapter } from './adapters/updates-adapter'
import { createWindowAdapter } from './adapters/window-adapter'

export function createDevScopeElectronAdapter(): DevScopeApi {
    const api: DevScopeApi = {
        runtimeActivation: createRuntimeActivationAdapter(),
        ...createSettingsAndAiAdapter(),
        ...createSetupAdapter(),
        ...createMemoryAdapter(),
        ...createProjectsAdapter(),
        ...createDisabledAdapters(),
        fonts: createFontsAdapter(),
        ...createAssistantAdapter(),
        ...createAssistantUtilityAdapter(),
        ...createBrowserViewAdapter(),
        agentControl: createAgentControlAdapter(),
        ...createUpdatesAdapter(),
        ...createWindowAdapter(),
        browserPopup: createBrowserPopupAdapter()
    } as unknown as DevScopeApi

    return api
}
