import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, FileCode2, FileText, Globe, Monitor, MousePointer2, Plug, ScanLine, Terminal, X } from 'lucide-react'
import type { ControlCapability } from '@shared/agent-control/contracts'
import { SettingsProvider, useSettings } from '@/lib/settings'
import { AssistantComposerMenuSurface } from '@/pages/assistant/AssistantComposerMenuSurface'
import { AssistantQuestionTransition } from '@/pages/assistant/AssistantQuestionTransition'
import { ComposerSendButton } from '@/pages/assistant/ComposerSendButton'
import { ComposerCheckbox } from '@/pages/assistant/ComposerCheckbox'
import { ComposerFileChangePreview } from '@/pages/assistant/ComposerFileChangePreview'
import { permissionReviewDiff } from './permission-review-diffs'
import { ASSISTANT_COMPOSER_FOCUS_CLASS_NAME } from '@/pages/assistant/assistant-composer-focus'
import { SettingsInfoTooltip } from '@/pages/settings/SettingsInfoTooltip'
import { installProvidersReviewFixture } from './providers-review-fixture'
import { permissionReviewCases, reviewTargets, type PermissionReviewCase } from './permissions-review-cases'
import './permission-composer-review.css'
import '../index.css'

// Design-only proposal. All state and decisions stay in this renderer's synthetic bridge.
// Existing production permission panels and authorization policies are deliberately unchanged.
installProvidersReviewFixture()
void window.devscope.preferences.update({ surface: 'browser', expectedRevision: 0, patch: { theme: 'vercel', appearanceDarkTheme: 'vercel', appearanceThemeMode: 'dark', accentColor: 'blue' } })
type Outcome = 'normal' | 'slow' | 'error'
type Receipt = { scenario: string; decision: string; values: Record<string, string | boolean> }
const capabilities: Record<ControlCapability, { label: string; shortLabel?: string; group: 'observe' | 'interact' | 'navigate' }> = {
    'observe.structure': { label: 'Read page structure', shortLabel: 'Page structure', group: 'observe' },
    'observe.screenshot': { label: 'Capture screenshots', shortLabel: 'Screenshots', group: 'observe' },
    'pointer.click': { label: 'Click', group: 'interact' },
    'pointer.move': { label: 'Move the pointer', group: 'interact' },
    'pointer.drag': { label: 'Drag', group: 'interact' },
    'keyboard.type': { label: 'Type text', group: 'interact' },
    'keyboard.key': { label: 'Press keys', group: 'interact' },
    scroll: { label: 'Scroll', group: 'interact' },
    'form.select': { label: 'Select form options', shortLabel: 'Select options', group: 'interact' },
    navigate: { label: 'Navigate', group: 'navigate' },
    'window.focus': { label: 'Focus the application', group: 'navigate' },
    'tab.manage': { label: 'Manage tabs', group: 'navigate' },
}
function RequestedCapabilities({ requested = [] }: { requested?: readonly ControlCapability[] }) {
    if (!requested.length) return null
    const groups = [
        { label: 'Observe', Icon: ScanLine, items: requested.filter(capability => capabilities[capability]?.group === 'observe') },
        { label: 'Interact', Icon: MousePointer2, items: requested.filter(capability => capabilities[capability]?.group === 'interact') },
        { label: 'Navigate', Icon: Compass, items: requested.filter(capability => capabilities[capability]?.group === 'navigate') },
        // Do not hide a permission if a newer producer sends an unfamiliar capability.
        { label: 'Other', Icon: null, items: requested.filter(capability => !capabilities[capability]) },
    ].filter(group => group.items.length)
    return <dl className="proposal-capabilities" aria-label="Requested capabilities">{groups.map(({ label, Icon, items }) => <div key={label}>
        <dt title={label}>{Icon ? <Icon size={13} aria-hidden="true" /> : null}<span className="sr-only">{label}</span></dt>
        <dd><ul>{items.map(capability => <li key={capability} data-requested-capability={capability} aria-label={capabilities[capability]?.label || capability}>{capabilities[capability]?.shortLabel || capabilities[capability]?.label || capability}</li>)}</ul></dd>
    </div>)}</dl>
}
const effectDetails: Record<string, { title: string; verb: string; rows: [string, string][]; warning?: string }> = {
    'send-or-publish': { title: 'Send the project update?', verb: 'Send message', rows: [['To', 'team@example.test'], ['Subject', 'Project update'], ['Message', 'The requested changes are ready for review.']] },
    purchase: { title: 'Purchase the monthly plan?', verb: 'Pay $24.00', rows: [['Merchant', 'Example service'], ['Item', 'Monthly plan'], ['Total', '$24.00 USD'], ['Renews', '$24.00 each month until cancelled']], warning: 'Charges the selected payment method and starts a subscription.' },
    'account-change': { title: 'Change the account email?', verb: 'Change email', rows: [['Account', 'Example workspace'], ['Current email', 'old@example.test'], ['New email', 'new@example.test']] },
    'security-change': { title: 'Turn off two-factor authentication?', verb: 'Turn off 2FA', rows: [['Account', 'Example workspace'], ['Change', 'Two-factor authentication will be disabled']], warning: 'This reduces account protection.' },
    'destructive-delete': { title: 'Delete these three documents?', verb: 'Delete 3 documents', rows: [['Items', 'Draft proposal, meeting notes, old brief'], ['Location', 'Example workspace / Archive']], warning: 'These documents will be permanently deleted.' },
    'file-upload': { title: 'Upload the project brief?', verb: 'Upload file', rows: [['File', 'project-brief.pdf · 240 KB'], ['Destination', 'example.com / Example workspace']], warning: 'This file will leave your device.' },
    'sensitive-data-submit': { title: 'Submit these account details?', verb: 'Submit details', rows: [['Destination', 'example.com'], ['Fields', 'Full name, billing address, tax identifier']], warning: 'Shares personal information with this site. Values stay masked here.' },
    'software-install': { title: 'Install Example Editor?', verb: 'Install software', rows: [['Publisher', 'Example publisher'], ['Package', 'Example Editor · 1.0.0'], ['Source', 'https://example.com/download']], warning: 'The installer can execute code and change files.' },
    'legal-acceptance': { title: 'Accept these service terms?', verb: 'Accept terms', rows: [['Service', 'Example service'], ['Document', 'Terms of service · January 2026'], ['Applies to', 'Example workspace']], warning: 'Creates an agreement on behalf of this account.' },
}
function requestCaution(entry: PermissionReviewCase) {
    if (entry.kind === 'action') return effectDetails[entry.sideEffect!].warning
    if (entry.kind === 'account-reset') return 'This credit is consumed immediately and cannot be restored.'
    if (entry.kind === 'download-trust') return 'This file can execute code and change files on your PC. Open it only if you trust its source.'
    if (entry.kind === 'threat') return 'Continuing bypasses the protection for this page. Do not enter passwords or payment information.'
    if (entry.kind === 'update' && entry.variant === 'blocked') return 'Updating will stop this work. Nothing stops until you confirm.'
    if (entry.kind === 'plugin' && entry.variant === 'unsupported') return 'Unsupported contributions will not be activated.'
    return null
}
const externalHandlers: Record<string, string> = {
    'link-choice': 'Zyra Browser or your default browser',
    'extension-webstore-native': 'Native extension confirmation',
    'extension-unpacked': 'System folder picker',
    'extension-native': 'System confirmation dialog',
    'pairing-external': 'Your phone or Chrome extension',
    'oauth-external': 'Your sign-in provider',
    'os-media': 'Operating system',
    'site-permissions': 'Browser permission policy',
    'workflow-approval': 'The pending action’s permission request',
}
function requestInfo(entry: PermissionReviewCase): { label: string; text: string; tone?: 'warning' } | null {
    if (entry.kind === 'external') return { label: 'About this step', text: entry.note || 'This step is handled outside this composer.' }
    const caution = requestCaution(entry)
    const text = entry.kind === 'tool' && entry.approval?.command ? 'Runs a shell command. Files may change.'
        : entry.kind === 'terminal' ? 'Existing filesystem restrictions still apply. Muting future prompts while terminal access is off does not enable terminal access.'
        : entry.kind === 'lab' ? 'Creates a separate project. Your current files stay unchanged.'
        : entry.kind === 'plugin' ? 'Installing does not run the Plugin. Tool calls still require Chat permissions.'
        : entry.kind === 'plugin-app' ? 'Save this document only. It will not be published.'
        : entry.kind === 'network' ? 'Paired devices on this network can connect. Project access is managed separately.'
        : entry.kind === 'device' ? 'Allows access to the selected Projects and their attached folders.' : null
    if (caution) return { label: entry.sideEffect === 'software-install' ? 'About this installer' : 'About this warning', text: [caution, text].filter(Boolean).join(' '), tone: 'warning' }
    return text ? { label: 'About this request', text } : null
}
function Rows({ rows }: { rows: [string, ReactNode][] }) {
    return <dl className="proposal-rows">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
    return <label className="proposal-field"><span>{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>
}
function CommandPreview({ command, detail }: { command: string; detail?: string | null }) {
    const lines = command.split(/\r?\n/)
    const firstLine = lines.find(line => line.trim()) || command
    if (lines.length === 1 && command.length <= 80 && !detail) return <pre className="proposal-command"><span aria-hidden="true">&gt;_ </span>{command}</pre>
    return <details className="proposal-script">
        <summary className="proposal-script-summary"><Terminal size={13} aria-hidden="true" /><code>{firstLine}</code><span className="proposal-disclosure-label">{lines.length > 1 ? `${lines.length} lines` : 'Details'}</span><ChevronDown size={12} className="proposal-disclosure-chevron" aria-hidden="true" /></summary>
        <div className="proposal-script-content"><pre className="proposal-script-code">{command}</pre>{detail ? <p className="proposal-description">{detail}</p> : null}</div>
    </details>
}
function RequestExplanation({ text }: { text: string }) {
    if (!text.includes('\n') && text.length <= 200) return <p className="proposal-description">{text}</p>
    return <details className="proposal-explanation"><summary><span>{text.split(/\r?\n/).find(line => line.trim()) || 'Request details'}</span><span className="proposal-disclosure-label">Details</span><ChevronDown size={12} className="proposal-disclosure-chevron" aria-hidden="true" /></summary><p className="proposal-description">{text}</p></details>
}
function RequestBody({ entry, values, change }: { entry: PermissionReviewCase; values: Record<string, string | boolean>; change: (key: string, value: string | boolean) => void }) {
    const target = reviewTargets.find(target => target.kind === entry.target)
    if (entry.kind === 'tool') return <>
        {entry.approval?.command ? <><CommandPreview command={entry.approval.command} detail={entry.approval.detail} /><p className="proposal-command-folder"><span>In</span><code>zyra/desktop</code></p></> : null}
        {entry.approval?.paths?.length ? <div className="proposal-files">{entry.approval.paths.map(path => {
            const displayPath = path.replace('C:/review/project/', '').replace('C:/review/', '')
            return <div key={path}>{entry.approval?.requestType === 'file-change' ? <ComposerFileChangePreview displayPath={displayPath} {...permissionReviewDiff(displayPath)} /> : <><FileText size={15} /><span>{displayPath}</span><span className="proposal-quiet">Read</span></>}</div>
        })}</div> : null}
        {entry.approval?.detail && !entry.approval.command ? <RequestExplanation text={entry.approval.detail} /> : null}
        {entry.id === 'plugin-email' ? <Rows rows={effectDetails['send-or-publish'].rows} /> : null}
        {!entry.approval?.command && !entry.approval?.paths?.length && !entry.approval?.detail ? <p className="proposal-quiet">No action details were provided. Deny this request or ask for more information.</p> : null}
    </>
    if (entry.kind === 'grant') return <>
        <Rows rows={[["Target", target?.title || 'Target unavailable'], [target?.kind === 'windows-window' ? 'Application' : 'Origin', target?.kind === 'windows-window' ? target.executableIdentity : target?.origin || 'Not available']]} />
        <RequestedCapabilities requested={entry.capabilities} />
        {entry.variant === 'expired' ? <p className="proposal-warning">This request has expired. Fresh access must be requested.</p> : null}
    </>
    if (entry.kind === 'action') { const effect = effectDetails[entry.sideEffect!]; return <><Rows rows={effect.rows} /><p className="proposal-quiet">{target?.title} · {target?.kind === 'windows-window' ? target.applicationName : target?.origin}</p></> }
    if (entry.kind === 'terminal') return <><Rows rows={[["Working folder", 'zyra/desktop'], ["Access", 'Run shell commands in this Playground']]} /></>
    if (entry.kind === 'lab') return <>{entry.variant === 'clone-repo' ? <Field label="Repository" value={String(values.repository)} onChange={value => change('repository', value)} /> : null}<Field label="Project name" value={String(values.name)} onChange={value => change('name', value)} /></>
    if (entry.kind === 'plugin' || entry.kind === 'plugin-app') return <><Rows rows={entry.kind === 'plugin-app' ? [["Plugin", 'Example Plugin'], ["Action", 'save_document'], ["Document", 'Example document → Example workspace']] : [["Plugin", 'Example Plugin · 1.0.0'], ["Publisher", 'Example publisher'], ["Includes", entry.variant === 'skills' ? '1 skill · no executable files' : entry.variant === 'unsupported' ? 'Scheduled tasks · not supported by this host' : 'MCP tools and executable files']]} /></>
    if (entry.kind === 'device') return <><Rows rows={[["Device", 'Example phone']]} />{entry.variant === 'empty' ? <p className="proposal-quiet">No Projects are available to share.</p> : <div className="proposal-projects">{['Example project', 'Documentation', 'Design references'].map(name => <ComposerCheckbox key={name} label={name} checked={Boolean(values[name])} onChange={checked => change(name, checked)} />)}</div>}</>
    if (entry.kind === 'network') return <><label className="proposal-field"><span>Network</span><select value={String(values.network)} onChange={event => change('network', event.target.value)}><option value="wifi">Example Wi-Fi · 192.0.2.10</option><option value="ethernet">Example Ethernet · 192.0.2.11</option></select></label>{entry.variant === 'unavailable' ? <p className="proposal-warning">The previous network is unavailable. Select a network before continuing.</p> : null}</>
    if (entry.kind === 'update') return <><Rows rows={[["Update", entry.id.includes('-runtime-') ? 'Agent only · 1.0.0-review' : 'App + agent · 1.0.0-review'], ["Running work", entry.variant === 'blocked' ? '2 turns · 1 background task · 1 pending approval' : entry.variant === 'unknown' ? 'Activity could not be verified' : 'No running work']]} />{['unknown', 'checking', 'busy', 'error'].includes(entry.variant || '') ? <p className="proposal-warning">{entry.variant === 'unknown' ? 'Check activity again before updating.' : entry.variant === 'error' ? 'Preflight failed. No work was stopped.' : 'Checking whether this update can proceed…'}</p> : null}</>
    if (entry.kind === 'account-reset') return <><Rows rows={[["Account", 'review@example.test'], ["Uses", '1 available reset credit'], ["Effect", 'Reset this account’s eligible usage window']]} /></>
    if (entry.kind === 'download-trust') return <><Rows rows={[["File", 'example-installer.exe'], ["Source", entry.variant === 'folder' ? 'Downloads folder' : 'https://example.com']]} /></>
    if (entry.kind === 'threat') return <><Rows rows={[["Site", 'https://example.test/unsafe-page'], ["Detection", entry.variant === 'test' ? 'Harmless protection test' : 'Suspected phishing']]} />{entry.variant === 'error' ? <p className="proposal-warning">The previous override failed. The page stayed blocked.</p> : null}</>
    if (entry.kind === 'external') return <Rows rows={[[entry.id === 'link-choice' ? 'Destination' : 'Handled by', externalHandlers[entry.id] || 'External application']]} />
    return null
}
function presentation(entry: PermissionReviewCase) {
    if (entry.kind === 'external') return { title: entry.label, action: 'Next request', scope: entry.id === 'link-choice' ? 'Navigation only' : 'Handled externally' }
    if (entry.kind === 'action') return { title: effectDetails[entry.sideEffect!].title, action: effectDetails[entry.sideEffect!].verb, scope: 'This exact action only' }
    if (entry.kind === 'grant') return { title: entry.target === 'windows-window' ? 'Allow access to Example Editor?' : 'Allow access to this browser tab?', action: 'Allow access', scope: 'This target · 5 minutes · up to 12 actions' }
    if (entry.kind === 'tool') return { title: entry.approval?.title || 'Approve this action?', action: 'Allow once', scope: 'This request only' }
    const other: Record<string, [string, string, string]> = {
        terminal: ['Allow terminal access?', 'Allow terminal', 'This Playground'], lab: [entry.variant === 'clone-repo' ? 'Clone this repository?' : 'Create a project?', entry.variant === 'clone-repo' ? 'Clone repository' : 'Create project', 'One project'],
        plugin: ['Install Example Plugin?', 'Install Plugin', 'This installation only'], 'plugin-app': ['Save this document?', 'Save document', 'This exact action only'],
        device: ['Allow Project access on this phone?', 'Save access', 'Selected Projects only'], network: ['Allow connections on this network?', 'Enable access', 'Paired devices only'],
        update: ['Apply this update?', entry.variant === 'blocked' ? 'Stop work and update' : 'Update', 'This installation only'], 'account-reset': ['Use this reset credit?', 'Use 1 reset credit', 'This account only'],
        'download-trust': ['Open this executable file?', 'Open anyway', 'This file only'], threat: ['Continue to this blocked page?', 'Continue anyway', 'This page only'],
    }
    const [title, action, scope] = other[entry.kind] || [entry.label, 'Allow once', 'This request only']
    return { title, action, scope }
}
function PermissionComposer({ entry, outcome, draft, onDraft, showDraft, onReceipt, onNext }: { entry: PermissionReviewCase; outcome: Outcome; draft: string; onDraft: (value: string) => void; showDraft: boolean; onReceipt: (receipt: Receipt) => void; onNext: () => void }) {
    const [collapsed, setCollapsed] = useState(false)
    const [scope, setScope] = useState('once')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [resolved, setResolved] = useState('')
    const [values, setValues] = useState<Record<string, string | boolean>>({ name: 'Example project', repository: 'https://example.com/example/repository.git', network: 'wifi', 'Example project': true, Documentation: entry.variant !== 'partial', 'Design references': false })
    const live = useRef(true)
    const pending = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => { live.current = true; return () => { live.current = false; if (timer.current) clearTimeout(timer.current) } }, [])
    const model = presentation(entry)
    const information = requestInfo(entry)
    const sessionContext = entry.kind === 'grant' ? entry.variant === 'incognito' ? 'Incognito Browser' : entry.variant === 'read-only' ? 'Read-only Chrome access' : null : null
    const exactOnly = entry.approval?.grantLabel === 'This exact app operation only'
    const scopeLabel = entry.id === 'folder-access' ? 'Until reconnect' : 'For this chat'
    const canBroaden = entry.kind === 'tool' && !exactOnly
    const blocked = entry.id === 'grant-missing-target' || entry.id === 'grant-expired' || entry.id === 'empty-details' || entry.kind === 'update' && ['unknown', 'checking', 'busy', 'error'].includes(entry.variant || '')
    const invalid = entry.kind === 'lab' && (!String(values.name).trim() || entry.variant === 'clone-repo' && !/^https:\/\/[^\s/]+\/.+/.test(String(values.repository)))
    const decide = async (decision: string) => {
        if (pending.current || resolved || decision !== 'deny' && (blocked || invalid)) return
        pending.current = true; setBusy(true); setError('')
        await new Promise<void>(resolve => { timer.current = setTimeout(resolve, outcome === 'slow' ? 1800 : 260) })
        if (!live.current) return
        pending.current = false; setBusy(false)
        if (outcome === 'error') { setError('Could not save your choice. Nothing was allowed. Try again.'); return }
        const label = decision === 'deny' ? 'Denied' : scope === 'once' ? model.action : scopeLabel
        setResolved(label)
        onReceipt({ scenario: entry.id, decision, values })
    }
    const Icon = entry.kind === 'grant' || entry.kind === 'action' ? entry.target === 'windows-window' ? Monitor : Globe : entry.kind === 'plugin' || entry.kind === 'plugin-app' ? Plug : entry.approval?.requestType?.startsWith('file') ? FileCode2 : Terminal
    const external = entry.kind === 'external'
    return <section className="proposal-shell" data-proposal-boundary={external ? true : undefined} data-proposal-case={entry.id} aria-label="Permission composer proposal" aria-busy={busy}>
        <div className="proposal-tray"><AssistantComposerMenuSurface title="Permission request">
            <div className="proposal-heading"><Icon size={15} /><h2>{model.title}</h2>{entry.id === 'queue' ? <span className="proposal-queue">1 of 3</span> : null}{information ? <SettingsInfoTooltip label={information.label} tone={information.tone}>{information.text}</SettingsInfoTooltip> : null}<button className="proposal-icon-button" aria-label={collapsed ? 'Expand request' : 'Minimize request'} aria-expanded={!collapsed} onClick={() => setCollapsed(old => !old)}>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button></div>
            <p className="proposal-requester">{entry.child ? 'Child agent · Example research agent' : 'This chat'}{sessionContext ? <><span>·</span>{sessionContext}</> : null}<span>·</span>{scope === 'once' ? model.scope : scopeLabel}</p>
            <AssistantQuestionTransition sectionKey={`${entry.id}:${collapsed}:${resolved}`}><div className="proposal-request-body">{!collapsed ? resolved ? <div className="proposal-resolved" role="status" data-proposal-resolved><Check size={16} /><span>{resolved}. No real permission or action changed.</span></div> : <fieldset disabled={busy} className="proposal-fields"><RequestBody entry={entry} values={values} change={(key, value) => setValues(old => ({ ...old, [key]: value }))} /></fieldset> : null}</div></AssistantQuestionTransition>
        </AssistantComposerMenuSurface></div>
        <div className={`proposal-frame ${ASSISTANT_COMPOSER_FOCUS_CLASS_NAME}`} data-assistant-composer-frame>
            {showDraft ? <textarea aria-label="Preserved draft" rows={2} value={draft} onChange={event => onDraft(event.target.value)} placeholder="Message Zyra…" /> : null}
            {error ? <p className="proposal-error" role="alert">{error}</p> : null}
            <div className="proposal-footer"><div className="proposal-footer-option">{!resolved && canBroaden ? <ComposerCheckbox className="proposal-scope-option" label={scopeLabel} ariaLabel={entry.approval?.grantLabel || 'Apply this permission to future requests in this chat'} hint={entry.approval?.grantLabel || 'Apply this permission to future requests in this chat'} checked={scope === 'scoped'} disabled={busy || blocked} onChange={checked => setScope(checked ? 'scoped' : 'once')} /> : !resolved && entry.kind === 'terminal' ? <ComposerCheckbox label="Don't ask again" ariaLabel="Don't ask again while terminal access is off" hint="Mute future prompts while terminal access is off. This does not allow terminal access." checked={Boolean(values.muted)} disabled={busy} onChange={checked => setValues(old => ({ ...old, muted: checked }))} /> : null}</div>
                <div className="proposal-actions">{resolved || external ? <button className="proposal-text-button" onClick={onNext}>Next request <ChevronRight size={14} /></button> : <><button className="proposal-deny" disabled={busy} onClick={() => void decide('deny')}><X size={13} />Deny</button><div className="proposal-primary"><ComposerSendButton disabled={busy || blocked || Boolean(invalid)} isConnected isThinking={false} canSend label={busy ? 'Saving choice' : scope === 'once' ? model.action : scopeLabel === 'Until reconnect' ? 'Allow until reconnect' : 'Allow for this chat'} onSend={() => void decide(scope === 'once' ? 'allow-once' : 'allow-scoped')} /></div></>}</div>
            </div>
        </div>
    </section>
}
function Review() {
    const { settings, updateSettings } = useSettings()
    const [index, setIndex] = useState(0)
    const [run, setRun] = useState(0)
    const [outcome, setOutcome] = useState<Outcome>('normal')
    const [showDraft, setShowDraft] = useState(false)
    const [draft, setDraft] = useState('Then summarize any failures.')
    const [receipts, setReceipts] = useState<Receipt[]>([])
    const entry = permissionReviewCases[index]
    const groups = [...new Set(permissionReviewCases.map(entry => entry.group))]
    const choose = (next: number) => { setIndex((next + permissionReviewCases.length) % permissionReviewCases.length); setRun(old => old + 1); setReceipts([]) }
    return <div className="theme-adaptive proposal-page bg-sparkle-bg text-sparkle-text">
        <header className="proposal-toolbar"><span className="proposal-toolbar-title">Permission composer <span>Proposal · {index + 1}/{permissionReviewCases.length}</span></span><a href="/permissions-review.html">Current designs</a><button onClick={() => updateSettings({ appearanceThemeMode: settings.appearanceThemeMode === 'dark' ? 'light' : 'dark' })}>{settings.appearanceThemeMode === 'dark' ? 'Light' : 'Dark'}</button><button aria-pressed={showDraft} onClick={() => setShowDraft(old => !old)}>Draft {showDraft ? 'on' : 'off'}</button><button onClick={() => choose(index)}>Reset</button>
            <div className="proposal-scenario-controls"><button aria-label="Previous request" onClick={() => choose(index - 1)}><ChevronLeft size={14} /></button><select aria-label="Proposed permission type" value={entry.id} onChange={event => choose(permissionReviewCases.findIndex(entry => entry.id === event.target.value))}>{groups.map(group => <optgroup label={group} key={group}>{permissionReviewCases.filter(entry => entry.group === group).map(entry => <option key={entry.id} value={entry.id} data-kind={entry.kind}>{entry.label}</option>)}</optgroup>)}</select><button aria-label="Next request" onClick={() => choose(index + 1)}><ChevronRight size={14} /></button><select aria-label="Response state" value={outcome} onChange={event => setOutcome(event.target.value as Outcome)}><option value="normal">Normal</option><option value="slow">Slow / busy</option><option value="error">Fail / retry</option></select></div>
        </header>
        <main className="proposal-chat"><div className="proposal-conversation"><p className="proposal-demo-note">Interactive design preview. Synthetic data and callbacks only.</p><p className="proposal-user-message">Make the changes and check that everything still works.</p><p className="proposal-assistant-message">I need your approval before continuing.</p>{receipts.length ? <p className="proposal-receipt" data-proposal-receipt role="status">{receipts[receipts.length - 1].decision} · {entry.label} · preview only</p> : null}</div>
            <div className="proposal-dock"><PermissionComposer key={`${entry.id}:${run}`} entry={entry} outcome={outcome} showDraft={showDraft} draft={draft} onDraft={setDraft} onReceipt={receipt => setReceipts(old => [...old, receipt])} onNext={() => choose(index + 1)} /></div>
            <p className="proposal-bottom-note">Proposed layout, not a change to live permissions. Settings-origin requests keep their own location.</p>
        </main>
    </div>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><SettingsProvider><Review /></SettingsProvider></MemoryRouter>)
