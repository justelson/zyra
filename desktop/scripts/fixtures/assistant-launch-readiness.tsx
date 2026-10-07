import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantWorkspaceStartup } from '../../src/renderer/src/pages/assistant/AssistantWorkspaceStartup'
import { AssistantRouteShell } from '../../src/renderer/src/pages/assistant/AssistantRouteShell'
import { AssistantTitleBarProvider } from '../../src/renderer/src/lib/assistant/assistant-title-bar'
import { WelcomeStep } from '../../src/renderer/src/onboarding/OnboardingSteps'
import { DevChannelLabel } from '../../src/renderer/src/components/layout/DevChannelLabel'

const root = createRoot(document.getElementById('root')!)
const results: string[] = []
let ready = false
let error: string | null = null
let retries = 0
const check = (condition: unknown, message: string) => { if (!condition) throw Error(message); results.push(message) }
function render() {
    flushSync(() => root.render(<AssistantTitleBarProvider><AssistantWorkspaceStartup ready={ready} error={error}
        onRetry={() => { retries++; error = null; render() }}
        loadingFallback={<AssistantRouteShell sidebarCollapsed={false} sidebarWidth={322} agentInboxEnabled />}>
        <main data-ready-workspace>Saved conversation restored</main>
    </AssistantWorkspaceStartup></AssistantTitleBarProvider>))
}
;(window as any).sidebarContinuityCheck = (async () => {
    render()
    check(Boolean(document.querySelector('[data-assistant-shell-sidebar]')), 'Cold start retains the sidebar frame while the catalog loads')
    check(!document.querySelector('[data-ready-workspace]'), 'Cold start does not expose an empty workspace')
    check(!document.body.textContent?.includes('Disconnected'), 'Cold start never shows the disabled disconnected composer')
    error = 'Transient bootstrap error'; render()
    const retry = document.querySelector<HTMLButtonElement>('button')!
    check(retry.textContent === 'Try again' && !retry.disabled, 'Startup failure offers an enabled recovery action')
    retry.click()
    check(retries === 1 && Boolean(document.querySelector('[data-assistant-shell-sidebar]')), 'Retry returns to loading without a disconnected flash')
    ready = true; render()
    check(Boolean(document.querySelector('[data-ready-workspace]')), 'Successful bootstrap reveals the restored workspace')
    check(!document.querySelector('[data-assistant-route-shell]'), 'Loading frame leaves when the workspace is ready')
    flushSync(() => root.render(<main className="flex h-full flex-col items-center justify-center gap-6 px-8"><DevChannelLabel dev /><WelcomeStep saving={false} error={null} onStart={() => undefined} /></main>))
    check(document.body.textContent?.includes('You’re setting up the Dev channel'), 'Actual onboarding identifies the Dev channel')
    check(document.body.textContent?.includes('separate settings and chats'), 'Actual onboarding explains the separate app profile')
    return results
})()
