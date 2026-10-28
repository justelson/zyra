import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { ControlPendingActionApproval, ControlPendingGrant } from '@shared/agent-control/contracts'
import type { MobileAccessApi } from '@shared/mobile-access'
import { SettingsProvider, useSettings } from '@/lib/settings'
import { AssistantPendingApprovalPanel } from '@/pages/assistant/AssistantPendingApprovalPanel'
import { AssistantPendingControlApprovalPanel } from '@/pages/assistant/AssistantPendingControlApprovalPanel'
import { AssistantPendingTerminalAccessPanel } from '@/pages/assistant/AssistantPendingTerminalAccessModal'
import { AssistantPendingPlaygroundLabPanel } from '@/pages/assistant/AssistantPendingPlaygroundLabPanel'
import { AssistantPluginInstallDialog } from '@/pages/plugins/AssistantPluginInstallDialog'
import { PluginAppActionApproval } from '@/pages/assistant/PluginAppView'
import { MobileDeviceAccessDialog } from '@/pages/settings/MobileDeviceAccessDialog'
import { MobileAccessDialog } from '@/pages/settings/MobileAccessDialog'
import { AccountResetCreditsSection } from '@/pages/settings/AccountResetCreditsSection'
import { AgentUpdateDialog } from '@/components/updates/AgentUpdateDialog'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { FileText } from 'lucide-react'
import { AssistantBrowserThreatWarning } from '@/pages/assistant/AssistantBrowserThreatWarning'
import { PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID } from '@shared/assistant/playground-terminal-access'
import { installProvidersReviewFixture } from './providers-review-fixture'
import { mobileReviewProjects, mobileReviewState, permissionReviewCases, reviewAccountOverview, reviewApproval, reviewPluginInspection, reviewTargets, type PermissionReviewCase } from './permissions-review-cases'
import '@/pages/plugins/PluginsPage.css'
import '../index.css'

// Entirely synthetic: no installed app IPC, account, filesystem, browser or approval service.
installProvidersReviewFixture()
void window.devscope.preferences.update({ surface: 'browser', expectedRevision: 0, patch: { theme: 'vercel', appearanceDarkTheme: 'vercel', appearanceThemeMode: 'dark', accentColor: 'blue' } })
type Outcome = 'success' | 'error' | 'slow'
type Receipt = { scenario: string; action: string; payload?: unknown }

function PermissionFixture({ entry, outcome, onReceipt }: { entry: PermissionReviewCase; outcome: Outcome; onReceipt: (receipt: Receipt) => void }) {
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const [issue, setIssue] = useState<string | null>(null)
    const [handled, setHandled] = useState<string[]>([])
    const [overview, setOverview] = useState(reviewAccountOverview)
    const [busyExample, setBusyExample] = useState(entry.variant === 'busy' || entry.variant === 'checking')
    useEffect(() => { if (!busyExample) return; const timer = setTimeout(() => setBusyExample(false), 1500); return () => clearTimeout(timer) }, [busyExample])
    const record = useCallback((action: string, payload?: unknown) => onReceipt({ scenario: entry.id, action, payload }), [entry.id, onReceipt])
    const perform = useCallback(async (action: string, payload?: unknown) => {
        record(action, payload)
        setBusy(true); setIssue(null)
        await new Promise(resolve => setTimeout(resolve, outcome === 'slow' ? 2000 : 120))
        if (outcome === 'error') { setBusy(false); setIssue('Synthetic response failed. No permission or external action was changed.'); throw new Error('Synthetic response failed. Try again.') }
        setBusy(false)
        return { success: true as const }
    }, [outcome, record])
    const decide = useCallback(async (action: string, payload?: unknown) => {
        await perform(action, payload)
        setDone(true)
        return { success: true as const }
    }, [perform])
    const safeDecision = (action: string, payload?: unknown) => { void decide(action, payload).catch(() => undefined) }
    const dismiss = () => { record('dismiss'); setDone(true) }
    const baseTarget = reviewTargets.find(target => target.kind === entry.target)
    const target = baseTarget?.kind === 'zyra-browser' && entry.variant === 'incognito' ? { ...baseTarget, sessionMode: 'incognito' as const }
        : baseTarget?.kind === 'chrome-tab' && entry.variant === 'read-only' ? { ...baseTarget, accessMode: 'read' as const } : baseTarget
    const targets = reviewTargets.map(candidate => target && candidate.targetId === target.targetId ? target : candidate)
    const principal = entry.child ? { type: 'agent' as const, fleetId: 'review-fleet', agentRunId: 'review-child', parentThreadId: 'review-chat' } : { type: 'root' as const, threadId: 'review-chat', turnId: 'review-turn' }
    const grant: ControlPendingGrant = { requestId: `review-${entry.id}`, principal, targetId: target?.targetId || 'review-missing-target', capabilities: entry.capabilities || ['pointer.click'], requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (entry.variant === 'expired' ? -60000 : 300000)).toISOString(), maxActions: 12, screenshots: entry.capabilities?.includes('observe.screenshot') || false, allowedOrigins: target && target.kind !== 'windows-window' && target.origin ? [target.origin] : undefined, allowedExecutableIdentities: target?.kind === 'windows-window' ? [target.executableIdentity] : undefined }
    const action: ControlPendingActionApproval = { requestId: `review-${entry.id}`, principal, targetId: target?.targetId || 'review-missing-target', grantId: 'review-grant', actionRequestId: 'review-action', actionType: entry.sideEffect === 'file-upload' ? 'type' : 'click', sideEffect: entry.sideEffect || 'send-or-publish', observationRevision: 1, requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() }
    useLayoutEffect(() => {
        const respond = async (operation: string, payload: unknown) => {
            if (entry.variant === 'expired') return { success: false, error: 'This synthetic access request has expired. Request fresh access.' }
            try { return await decide(operation, payload) } catch { return { success: false, error: 'Synthetic response failed. Try again.' } }
        }
        Object.assign(window.devscope, { getProjectDetails: async () => ({ success: false, error: 'Synthetic preview has no project filesystem.' }), agentControl: {
            approveGrant: (payload: unknown) => respond('approveGrant', payload), rejectGrant: (id: string) => respond('rejectGrant', id),
            approveAction: (id: string) => respond('approveAction', id), rejectAction: (id: string) => respond('rejectAction', id),
        } })
        Object.assign(window.devscope.assistant, { redeemAccountReset: async (payload: unknown) => { await perform('redeemAccountReset', payload); return { success: true, overview: { ...reviewAccountOverview, availableResetCount: 0, resetCredits: [] }, redemption: { windowsReset: 1 }, refreshError: null } } })
    }, [decide, entry.variant, perform])
    const mobileApi = useMemo<MobileAccessApi>(() => ({
        getState: async () => mobileReviewState,
        getProjects: async () => { if (outcome === 'slow') await new Promise(resolve => setTimeout(resolve, 2000)); if (outcome === 'error') throw new Error('Synthetic project list unavailable.'); return entry.variant === 'empty' ? [] : mobileReviewProjects },
        setDeviceAccess: async (id, access) => { await perform('setDeviceAccess', { id, access }); return mobileReviewState },
        configure: async config => { await perform('configure', config); return { ...mobileReviewState, config, running: config.enabled } },
        pair: async () => ({ link: 'https://example.test/review-only', image: '', expiresAt: 0 }),
        revoke: async id => { await perform('revoke', id); return mobileReviewState },
    }), [outcome, entry.variant, perform])
    const issueBanner = issue ? <aside role="status" data-review-issue className="mb-3 rounded-md border border-white/10 px-3 py-2 text-[11px] text-sparkle-text-muted">Preview bridge: {issue}</aside> : null
    let content
    if (done) content = <div data-review-resolved className="rounded-lg border border-[var(--surface-divider)] p-4 text-sm text-sparkle-text-secondary">Synthetic response recorded. Nothing was authorized outside this preview.</div>
    else if (entry.kind === 'tool') {
        const requests = [reviewApproval(entry), ...(entry.variant === 'queue' || entry.id === 'queue' ? [reviewApproval({ ...entry, approval: { requestType: 'file-read', title: 'Second queued action', paths: ['C:/review/docs/notes.md'] } }, '-second'), reviewApproval({ ...entry, approval: { requestType: 'file-change', title: 'Third queued action', paths: ['C:/review/project/src/theme.css'] } }, '-third')] : [])].filter(request => !handled.includes(request.requestId))
        content = <AssistantPendingApprovalPanel pendingApprovals={requests} responding={busy} onRespond={async (requestId, decision) => {
            try { await perform(decision, { requestId }); setHandled(old => [...old, requestId]); if (requests.length === 1) setDone(true) } catch { /* The production caller owns tool-response errors. */ }
        }} />
    } else if (entry.kind === 'grant' || entry.kind === 'action') content = <AssistantPendingControlApprovalPanel pendingGrants={entry.kind === 'grant' ? [grant] : []} pendingActions={entry.kind === 'action' ? [action] : []} targets={targets} />
    else if (entry.kind === 'terminal') content = <AssistantPendingTerminalAccessPanel request={{ id: entry.id, requestId: `review-${entry.id}`, status: 'pending', answers: null, turnId: null, resolvedAt: null, createdAt: new Date().toISOString(), questions: [{ id: PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID, header: 'Terminal', question: 'Allow shell commands from this Playground folder? Filesystem restrictions still apply.', type: 'single_select', required: true, allowOther: false, options: [] }] }} responding={busy} onRespond={async (id, answers) => { try { await decide('terminal-response', { id, answers }) } catch {} }} onSetTerminalAccess={enabled => record('terminal-setting', enabled)} onSetRequestMuted={muted => record('terminal-muted', muted)} />
    else if (entry.kind === 'lab') content = <AssistantPendingPlaygroundLabPanel request={{ id: entry.id, kind: entry.variant === 'clone-repo' ? 'clone-repo' : 'create-empty', prompt: 'Create an isolated example project for this task.', suggestedLabName: 'Example project', repoUrl: entry.variant === 'clone-repo' ? 'https://example.com/example/repository.git' : null, createdAt: new Date().toISOString() }} responding={busy} onApprove={input => safeDecision('project-approve', input)} onDecline={() => safeDecision('project-decline')} />
    else if (entry.kind === 'plugin') content = <AssistantPluginInstallDialog inspection={reviewPluginInspection(entry.variant)} packageLabel="Synthetic local package" installing={busy} error={issue} onCancel={dismiss} onInstall={() => safeDecision('plugin-install')} onInstallAndUse={() => safeDecision('plugin-install-and-chat')} />
    else if (entry.kind === 'plugin-app') content = <div className="relative h-64"><PluginAppActionApproval server="Example Plugin" tool="save_document" args={{ title: 'Example document', destination: 'Example workspace', publish: false }} onChoose={approved => safeDecision('plugin-app-action', approved)} /></div>
    else if (entry.kind === 'device') content = <MobileDeviceAccessDialog device={{ ...mobileReviewState.devices[0], hiddenProjects: entry.variant === 'partial' ? ['C:/review/design'] : [] }} api={mobileApi} onClose={dismiss} onSaved={state => { record('device-saved', state.config); setDone(true) }} />
    else if (entry.kind === 'network') content = <MobileAccessDialog state={{ ...mobileReviewState, config: { ...mobileReviewState.config, address: entry.variant === 'unavailable' ? '192.0.2.99' : mobileReviewState.config.address } }} api={mobileApi} onClose={dismiss} onSaved={state => { record('network-saved', state.config); setDone(true) }} />
    else if (entry.kind === 'download-trust') content = <ConfirmModal isOpen title="This file can run code" message={entry.variant === 'folder' ? '“example-installer.exe” can run code or change files on this PC. Open it only if you trust where it came from.' : '“example-installer.exe” can run code or change files on this PC. Open it only if you trust https://example.com. Your operating system may show another warning.'} confirmLabel="Open anyway" cancelLabel="Keep closed" variant="danger" visual={<span className="inline-flex size-12 items-center justify-center rounded-[9px] border border-red-400/20 bg-red-500/[0.08]"><FileText size={24} /></span>} onCancel={dismiss} onConfirm={() => { setDone(true); safeDecision('open-executable', { synthetic: true, folderEntry: entry.variant === 'folder' }) }} />
    else if (entry.kind === 'account-reset') content = <AccountResetCreditsSection overview={overview} loading={false} accountLabel="Example account" onOverviewChange={setOverview} />
    else if (entry.kind === 'update') {
        const variant = entry.variant
        const plan = { id: 'review-plan', version: '1.0.0-review', agentServerUpdate: true as const, state: variant === 'blocked' ? 'blocked' as const : variant === 'unknown' ? 'unknown' as const : 'ready' as const, repair: variant === 'repair', instanceId: 'review-instance', namespaceId: 'review-namespace', activity: { activeTurns: variant === 'blocked' ? 2 : 0, backgroundChats: variant === 'blocked' ? 1 : 0, attention: variant === 'blocked' ? 1 : 0, requests: variant === 'blocked' ? 1 : 0, workspaceRequests: variant === 'blocked' ? 1 : 0, externalTools: variant === 'blocked' ? 1 : 0 }, expiresAt: new Date(Date.now() + 300000).toISOString() }
        content = <AgentUpdateDialog kind={entry.id.includes('-runtime-') ? 'runtime' : 'install'} plan={variant === 'checking' ? null : plan} checking={variant === 'checking' && busyExample} busy={busy || entry.variant === 'busy' && busyExample} error={issue || (variant === 'error' ? 'Synthetic preflight failed. No process was stopped.' : null)} onLater={dismiss} onRefresh={() => record('update-refresh')} onConfirm={stopBlockers => safeDecision('update-confirm', { stopBlockers, planId: plan.id })} />
    } else if (entry.kind === 'threat') content = <div className="relative h-[420px]"><AssistantBrowserThreatWarning warning={{ decisionId: 'review-threat', url: 'https://example.test/unsafe-page', hostname: 'example.test', threatType: 'phishing', source: entry.variant === 'test' ? 'test' : 'phishtank', sourceGuestWebContentsId: 1, blockedGuestWebContentsId: 2, navigationKind: 'current-tab', previousUrl: 'https://example.com', blockedAt: new Date().toISOString() }} busy={busy} error={issue || (entry.variant === 'error' ? 'Synthetic override failed. The page stayed blocked.' : null)} onBack={dismiss} onProceed={() => safeDecision('threat-override')} /></div>
    else content = <section data-review-external className="rounded-lg border border-[var(--surface-divider)] p-4"><h2 className="text-sm font-medium">{entry.label}</h2><p className="mt-2 text-[12px] leading-5 text-sparkle-text-secondary">{entry.note}</p><p className="mt-3 break-words font-mono text-[10px] text-sparkle-text-muted">{entry.source}</p><p className="mt-2 text-[11px] text-sparkle-text-muted">Code-reviewed boundary. No real OS or external permission is requested here.</p></section>
    return <div data-permission-fixture={entry.id} data-permission-kind={entry.kind} className="w-full">{issueBanner}{content}</div>
}

function Review() {
    const { settings, updateSettings } = useSettings()
    const [index, setIndex] = useState(0)
    const [outcome, setOutcome] = useState<Outcome>('success')
    const [run, setRun] = useState(0)
    const [receipts, setReceipts] = useState<Receipt[]>([])
    const entry = permissionReviewCases[index]
    const record = useCallback((receipt: Receipt) => setReceipts(old => [...old, receipt]), [])
    const choose = (next: number) => { setIndex(next); setRun(old => old + 1); setReceipts([]) }
    const groups = [...new Set(permissionReviewCases.map(entry => entry.group))]
    return <div className="theme-adaptive flex h-screen flex-col bg-sparkle-bg text-sparkle-text">
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--surface-divider)] px-4 py-3 text-[11px] text-sparkle-text-secondary">
            <span className="mr-auto">Permission review · {index + 1}/{permissionReviewCases.length}</span>
            <a className="rounded px-2 py-1 hover:bg-white/5" href="/permission-composer-review.html">Proposed layout</a>
            <button className="rounded px-2 py-1 hover:bg-white/5" aria-label="Previous permission type" onClick={() => choose((index - 1 + permissionReviewCases.length) % permissionReviewCases.length)}>Previous</button>
            <button className="rounded px-2 py-1 hover:bg-white/5" aria-label="Next permission type" onClick={() => choose((index + 1) % permissionReviewCases.length)}>Next</button>
            <button className="rounded px-2 py-1 hover:bg-white/5" onClick={() => updateSettings({ appearanceThemeMode: settings.appearanceThemeMode === 'dark' ? 'light' : 'dark' })}>{settings.appearanceThemeMode === 'dark' ? 'Light' : 'Dark'}</button>
            <button className="rounded px-2 py-1 hover:bg-white/5" onClick={() => choose(index)}>Reset</button>
            <select aria-label="Permission request type" value={entry.id} onChange={event => choose(permissionReviewCases.findIndex(entry => entry.id === event.target.value))} className="h-8 min-w-0 basis-full rounded-md border border-[var(--surface-divider)] bg-sparkle-card px-2 text-sparkle-text sm:basis-auto sm:max-w-[380px]">{groups.map(group => <optgroup label={group} key={group}>{permissionReviewCases.filter(entry => entry.group === group).map(entry => <option value={entry.id} data-kind={entry.kind} key={entry.id}>{entry.label}</option>)}</optgroup>)}</select>
            <select aria-label="Synthetic response outcome" value={outcome} onChange={event => { setOutcome(event.target.value as Outcome); choose(index) }} className="h-8 rounded-md border border-[var(--surface-divider)] bg-sparkle-card px-2 text-sparkle-text"><option value="success">Respond normally</option><option value="slow">Slow / busy response</option><option value="error">Fail / retry response</option></select>
        </header>
        <main className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-6 pt-8 sm:px-8">
            <div className="mx-auto w-full max-w-[760px] flex-1"><p className="text-[12px] text-sparkle-text-muted">Actual local app components. All requests and decisions are synthetic.</p><p className="mt-2 text-sm text-sparkle-text-secondary">{entry.group} / {entry.label}</p>{entry.note && entry.kind !== 'external' ? <p className="mt-2 text-xs text-sparkle-text-muted">{entry.note}</p> : null}
                {receipts.length ? <pre data-review-receipts className="mt-6 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[10px] text-sparkle-text-muted">{JSON.stringify(receipts, null, 2)}</pre> : null}
            </div>
            <div className={`mx-auto mt-8 w-full max-w-[760px] ${['tool', 'grant', 'action', 'terminal', 'lab'].includes(entry.kind) ? 'pointer-events-none' : ''}`}><PermissionFixture key={`${entry.id}:${run}:${outcome}`} entry={entry} outcome={outcome} onReceipt={record} /></div>
        </main>
    </div>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><SettingsProvider><Review /></SettingsProvider></MemoryRouter>)
