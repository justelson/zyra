import type { AssistantPendingApproval, AssistantPluginInspection, AssistantAccountOverview } from '@shared/assistant/contracts'
import { CONTROL_CAPABILITIES, type ControlSideEffectClass, type ControlTarget, type ControlCapability } from '@shared/agent-control/contracts'
import type { MobileAccessState, MobileProjectChoice } from '@shared/mobile-access'

export type PermissionReviewCase = {
    id: string; group: string; label: string; kind: 'tool' | 'grant' | 'action' | 'terminal' | 'lab' | 'plugin' | 'plugin-app' | 'device' | 'network' | 'update' | 'threat' | 'account-reset' | 'download-trust' | 'external'
    approval?: Partial<AssistantPendingApproval>; target?: ControlTarget['kind']; sideEffect?: Exclude<ControlSideEffectClass, 'none'>
    capabilities?: ControlCapability[]; child?: boolean; variant?: string; source?: string; note?: string
}
const tool = (id: string, label: string, approval: Partial<AssistantPendingApproval>, note?: string): PermissionReviewCase => ({ id, group: 'Tools, files and app operations', label, kind: 'tool', approval, note })
export const reviewTargets: ControlTarget[] = [
    { kind: 'zyra-browser', targetId: 'review-browser', tabId: 'review-tab', sessionMode: 'normal', ownerThreadId: 'review-chat', guestIdentity: 'review-guest', origin: 'https://example.com', title: 'Example project dashboard', url: 'https://example.com/projects' },
    { kind: 'chrome-tab', targetId: 'review-chrome', pairId: 'review-pair', tabToken: 'review-tab-token', origin: 'https://example.com', title: 'Example checkout', browserName: 'Chrome', accessMode: 'control' },
    { kind: 'windows-window', targetId: 'review-window', sidecarSessionId: 'review-sidecar', processId: 100, windowToken: 'review-window-token', executableIdentity: 'C:/Program Files/Example/Editor.exe', applicationName: 'Example Editor', title: 'Example project · Editor' },
]
const effects = {
    'send-or-publish': 'Send / publish', purchase: 'Purchase', 'account-change': 'Account change', 'security-change': 'Security change',
    'destructive-delete': 'Delete data', 'file-upload': 'Upload a file', 'sensitive-data-submit': 'Submit sensitive data', 'software-install': 'Install software', 'legal-acceptance': 'Accept legal terms',
} satisfies Record<Exclude<ControlSideEffectClass, 'none'>, string>

export const permissionReviewCases: PermissionReviewCase[] = [
    tool('command', 'Shell command', { requestType: 'command', title: 'Run a command?', command: 'npm test -- --runInBand', grantLabel: 'Allow shell commands for this chat' }),
    tool('command-long', 'Long multiline command and reason', { requestType: 'command', title: 'Run a release check?', command: 'npm run test:unit\nnpm run test:renderer\nnpm run lint\nnpm run test:contracts\nnpm run test:fixtures', detail: 'Verify local source before creating a release.\nThis does not install or publish anything.\nThe selected project is C:/review/project.\nRun each check in order.\nFailures must leave the worktree unchanged.\nThis permission applies only to the requested command.' }),
    tool('file-read', 'Read a file', { requestType: 'file-read', title: 'Read a file?', paths: ['C:/review/project/docs/design.md'] }),
    tool('file-change', 'Edit a file', { requestType: 'file-change', title: 'Edit a file?', paths: ['C:/review/project/src/app.tsx'] }),
    tool('file-multiple', 'Multiple file changes', { requestType: 'file-change', title: 'Apply file changes?', paths: ['C:/review/project/src/app.tsx', 'C:/review/project/src/theme.css', 'C:/review/project/tests/app.test.tsx'], detail: 'Update the component, its styles, and matching tests.' }),
    tool('folder-access', 'Folder access until reconnect', { requestType: 'file-read', title: 'Allow access to another folder?', paths: ['C:/review/reference-documents'], detail: 'Read-only access to this exact folder. Existing read-only restrictions still apply.', grantLabel: 'Allow folder until chat reconnects' }),
    tool('plugin-connect', 'Connect a Plugin MCP server', { requestType: 'command', title: 'Connect to Plugin MCP server', detail: 'Example Plugin / documents', grantLabel: 'Allow Example Plugin MCP documents for this chat' }),
    tool('plugin-call', 'Call a Plugin MCP tool', { requestType: 'command', title: 'Use Plugin MCP tool', detail: 'Example Plugin / documents / create_document', grantLabel: 'Allow Example Plugin MCP create_document for this chat' }),
    tool('plugin-email', 'Plugin email / attachment action', { requestType: 'command', title: 'Use Plugin MCP tool', detail: 'Example Mail / mail / send_message\nEmail send: 2 To, 0 Cc, 0 Bcc recipients; 640 body characters. Attachment uploads: 1.', grantLabel: 'Allow Example Mail MCP send_message for this chat' }),
    ...[
        ['protected-setting', 'Protected settings change', 'Allow a permission-mode change?', 'Change this Chat from read-only to writer for the next turn.'],
        ['cross-project', 'Installation / cross-Project access', 'Allow installation-wide access?', 'Read Project names outside the current Project for this exact app operation.'],
        ['app-destructive', 'Destructive app operation', 'Remove this saved object?', 'Remove the selected saved resource. This exact operation requires confirmation.'],
        ['app-paid', 'Paid / credit-consuming app operation', 'Use this account reset?', 'Redeem one selected account reset credit. No other account or reset is included.'],
        ['app-activation', 'Runtime / executable activation via agent', 'Activate the selected runtime?', 'Activate only the inspected executable and installation instance.'],
    ].map(([id, label, title, detail]) => tool(id, label, { requestType: 'command', title, detail, grantLabel: 'This exact app operation only' })),
    tool('queue', 'Multiple pending approvals', { requestType: 'command', title: 'First queued action', command: 'npm test' }),
    tool('empty-details', 'Missing command / path / detail', { requestType: 'command', title: 'Approval required' }),
    ...reviewTargets.flatMap(target => [false, true].map(child => ({ id: `grant-${target.kind}-${child ? 'child' : 'chat'}`, group: 'Browser and computer access grants', label: `${target.kind} · ${child ? 'child agent' : 'this chat'}`, kind: 'grant' as const, target: target.kind, child, capabilities: ['observe.structure', 'observe.screenshot', 'pointer.click', 'keyboard.type', 'keyboard.key', 'navigate', 'scroll', 'form.select', 'tab.manage'] as ControlCapability[] }))),
    { id: 'grant-view-only', group: 'Browser and computer access grants', label: 'View-only / screenshot permission', kind: 'grant', target: 'zyra-browser', capabilities: ['observe.structure', 'observe.screenshot'] },
    { id: 'grant-drag-only', group: 'Browser and computer access grants', label: 'Move / drag-only permission', kind: 'grant', target: 'windows-window', capabilities: ['pointer.move', 'pointer.drag'] },
    { id: 'grant-focus-only', group: 'Browser and computer access grants', label: 'Window-focus-only permission', kind: 'grant', target: 'windows-window', capabilities: ['window.focus'] },
    { id: 'grant-missing-target', group: 'Browser and computer access grants', label: 'Missing or disconnected target', kind: 'grant', capabilities: ['observe.structure'] },
    ...CONTROL_CAPABILITIES.map(capability => ({ id: `cap-${capability.replaceAll('.', '-')}`, group: 'Individual control capabilities', label: capability, kind: 'grant' as const, target: capability === 'window.focus' || capability === 'pointer.drag' || capability === 'pointer.move' ? 'windows-window' as const : 'zyra-browser' as const, capabilities: [capability] })),
    { id: 'grant-incognito', group: 'Browser and computer access grants', label: 'Incognito Browser access', kind: 'grant', target: 'zyra-browser', variant: 'incognito', capabilities: ['observe.structure', 'observe.screenshot', 'pointer.click'] },
    { id: 'grant-chrome-read', group: 'Browser and computer access grants', label: 'Read-only Chrome connection', kind: 'grant', target: 'chrome-tab', variant: 'read-only', capabilities: ['observe.structure', 'observe.screenshot'] },
    { id: 'grant-expired', group: 'Browser and computer access grants', label: 'Expired access request', kind: 'grant', target: 'chrome-tab', variant: 'expired', capabilities: ['pointer.click'] },
    ...reviewTargets.flatMap(target => Object.entries(effects).map(([sideEffect, label]) => ({ id: `action-${target.kind}-${sideEffect}`, group: `${target.kind} action confirmations`, label, kind: 'action' as const, target: target.kind, sideEffect: sideEffect as Exclude<ControlSideEffectClass, 'none'> }))),
    { id: 'terminal', group: 'Playground access', label: 'Terminal access / do not ask again', kind: 'terminal' },
    { id: 'project-create', group: 'Playground access', label: 'Create a project', kind: 'lab', variant: 'create-lab' },
    { id: 'project-clone', group: 'Playground access', label: 'Clone a repository', kind: 'lab', variant: 'clone-repo' },
    { id: 'plugin-skills', group: 'Plugin trust and installation', label: 'Install a Skills Plugin', kind: 'plugin', variant: 'skills' },
    { id: 'plugin-executable', group: 'Plugin trust and installation', label: 'Plugin with executable files / MCP', kind: 'plugin', variant: 'executable' },
    { id: 'plugin-unsupported', group: 'Plugin trust and installation', label: 'Unsupported Plugin contributions', kind: 'plugin', variant: 'unsupported' },
    { id: 'plugin-app', group: 'Plugin trust and installation', label: 'Embedded Plugin app action', kind: 'plugin-app' },
    { id: 'account-reset', group: 'Account credit consent', label: 'Review and consume an account reset', kind: 'account-reset' },
    { id: 'link-choice', group: 'Native / external permission boundaries', label: 'Browser destination choice', kind: 'external', source: 'components/ui/DesktopLinkHost.tsx', note: 'The Open link in dialog is a navigation choice, not an authority grant. It offers Zyra Browser / Default browser and a remember-on-this-device checkbox; cancelling opens neither.' },
    { id: 'device-projects', group: 'Device and network access', label: 'Device Project / attached-folder access', kind: 'device' },
    { id: 'device-partial', group: 'Device and network access', label: 'Partial Project access', kind: 'device', variant: 'partial' },
    { id: 'device-empty', group: 'Device and network access', label: 'No available Projects', kind: 'device', variant: 'empty' },
    { id: 'network', group: 'Device and network access', label: 'Phone listener / network access', kind: 'network' },
    { id: 'network-unavailable', group: 'Device and network access', label: 'Previous network unavailable', kind: 'network', variant: 'unavailable' },
    ...['ready', 'blocked', 'unknown', 'checking', 'busy', 'error', 'repair'].map(variant => ({ id: `update-install-${variant}`, group: 'App / agent update consent', label: `App + agent · ${variant}`, kind: 'update' as const, variant })),
    ...['ready', 'blocked', 'unknown', 'checking', 'busy', 'error', 'repair'].map(variant => ({ id: `update-runtime-${variant}`, group: 'App / agent update consent', label: `Agent only · ${variant}`, kind: 'update' as const, variant })),
    { id: 'threat', group: 'Browser safety override', label: 'Dangerous site override', kind: 'threat' },
    { id: 'threat-test', group: 'Browser safety override', label: 'Harmless protection test', kind: 'threat', variant: 'test' },
    { id: 'threat-error', group: 'Browser safety override', label: 'Override failed', kind: 'threat', variant: 'error' },
    { id: 'download-trust', group: 'Downloaded-file executable trust', label: 'Open a downloaded executable', kind: 'download-trust', note: 'Actual shared confirmation used by the downloads panel and toolbar. The filename and origin are synthetic; no file opens.' },
    { id: 'folder-file-trust', group: 'Downloaded-file executable trust', label: 'Open an executable from Downloads folder', kind: 'download-trust', variant: 'folder', note: 'Actual shared confirmation for a local Downloads-folder entry, with synthetic file metadata.' },
    { id: 'extension-webstore-native', group: 'Native / external permission boundaries', label: 'Web Store page: native extension approval', kind: 'external', source: 'main/browser-view-manager.ts: prepareWebStoreInstall', note: 'The in-page Web Store flow uses an Electron message box titled Add extension to Zyra?, with extension/version, permissions, warnings and Add to Zyra / Cancel. Cancel is the default. This differs from the Settings window.confirm flow.' },
    { id: 'extension-unpacked', group: 'Native / external permission boundaries', label: 'Unpacked extension: native folder selection', kind: 'external', source: 'main/browser-extension-manager.ts: chooseAndInstall', note: 'Choosing an unpacked-extension folder proceeds directly to install/register. The current path has no separate manifest-permission approval after the folder picker. This is a review gap, not a permission dialog reproduced here.' },
    { id: 'extension-native', group: 'Native / external permission boundaries', label: 'Browser extension permission review', kind: 'external', source: 'pages/settings/BrowserControlSettings.tsx', note: 'Uses the native window.confirm dialog. It names the extension/version and lists permissions and host permissions before installation. Not replaced by a simulated approval here.' },
    { id: 'pairing-external', group: 'Native / external permission boundaries', label: 'Android / Chrome pairing confirmation', kind: 'external', source: 'MobileConnectionSettings.tsx; ChromeBrowserConnectionSettings.tsx', note: 'One-use pairing is confirmed on Android or entered in the Chrome extension, not a Desktop approval card. Device Project permissions are reviewed separately above.' },
    { id: 'oauth-external', group: 'Native / external permission boundaries', label: 'Provider OAuth / device-code authorization', kind: 'external', source: 'ModelProviderConnections.tsx; providers/OpenAIConnectionRows.tsx', note: 'Provider authorization is hosted by the provider or system browser. Secure key entry and account disconnect/reset dialogs are separate connection/account-management UI, not tool grants.' },
    { id: 'os-media', group: 'Native / external permission boundaries', label: 'OS microphone / display access', kind: 'external', source: 'main/index.ts; main/browser-recording-capture.ts', note: 'OS-owned media permissions are not triggered by this preview. The trusted main renderer requests audio-only access; display capture additionally needs an exact recording-owner grant.' },
    { id: 'site-permissions', group: 'Native / external permission boundaries', label: 'Website / device permission requests', kind: 'external', source: 'main/ipc/handlers/browser-preview-handlers.ts', note: 'No Zyra site-permission prompt exists: only focused secure-origin fullscreen, protected media playback, and sanitized clipboard writes can be automatic. Other guest media/device requests are denied by policy.' },
    { id: 'workflow-approval', group: 'Native / external permission boundaries', label: 'Workflow awaiting-approval state', kind: 'external', source: 'AssistantWorkflowPrimitives.tsx; AssistantWorkflowDetailPage.tsx', note: 'Workflow awaiting-approval is a status, not a separate permission dialog. The current action bar does not expose an Approve action for that state; the underlying agent/tool consent still uses the canonical approval surfaces.' },
]

export function reviewApproval(entry: PermissionReviewCase, suffix = ''): AssistantPendingApproval {
    return { id: `${entry.id}${suffix}`, requestId: `review-${entry.id}${suffix}`, requestType: 'command', status: 'pending', decision: null, turnId: 'review-turn', createdAt: new Date().toISOString(), resolvedAt: null, ...entry.approval }
}
export const reviewAccountOverview: AssistantAccountOverview = {
    provider: 'openai-codex', source: 'review', account: { type: 'chatgpt', email: 'review@example.test', planType: 'plus' }, accountId: 'review-account', emailVerified: true, tokenExpiresAt: null, authMode: 'chatgpt', requiresOpenaiAuth: false, rateLimits: null, rateLimitsByLimitId: {}, usageError: null, availableResetCount: 1,
    resetCredits: [{ id: 'review-credit', title: 'Example reset', status: 'available', available: true, resetType: 'codex', grantedAt: null, expiresAt: new Date(Date.now() + 86400000).toISOString(), description: null }], resetCreditsError: null, fetchedAt: new Date().toISOString(),
}

export const mobileReviewState: MobileAccessState = { config: { enabled: true, address: '192.0.2.10', projects: [] }, running: true, addresses: [{ name: 'Example Wi-Fi', address: '192.0.2.10' }, { name: 'Example Ethernet', address: '192.0.2.11' }], devices: [{ id: 'review-phone', name: 'Example phone', createdAt: 0, connected: true, hiddenProjects: [] }] }
export const mobileReviewProjects: MobileProjectChoice[] = [{ name: 'Example project', paths: ['C:/review/project', 'C:/review/design'], iconPath: '', folders: [{ label: 'Design references', path: 'C:/review/design' }] }, { name: 'Documentation', paths: ['C:/review/docs'], iconPath: '', folders: [] }]

export function reviewPluginInspection(variant?: string): AssistantPluginInspection {
    const manifest: AssistantPluginInspection['manifest'] = {
        schemaVersion: 1, format: 'openai-codex-plugin-v1', name: 'example-plugin', version: '1.0.0', description: 'Synthetic release for permission review.', author: { name: 'Example publisher' }, homepageUrl: null, repositoryUrl: null, license: 'MIT', keywords: [], declaredCapabilityCeiling: ['read documents', 'connect tools'],
        interface: { displayName: 'Example Plugin', shortDescription: 'Review Plugin installation permissions.', longDescription: '', developerName: 'Example publisher', category: 'Productivity', capabilities: ['read documents'], websiteUrl: null, privacyPolicyUrl: null, termsOfServiceUrl: null, defaultPrompt: [], composerIcon: null, logo: null, logoDark: null, screenshots: [], brandColor: null },
        contributions: { skills: variant === 'skills' ? 'skills' : null, mcp: variant === 'executable' ? 'mcp.json' : null, apps: null, hooks: null, agents: null, commands: null, browserExtensions: null, scheduledTasks: variant === 'unsupported' ? 'tasks.json' : null },
    }
    return { reviewId: 'synthetic-review-only', expiresAt: new Date(Date.now() + 300000).toISOString(), manifest, release: { name: manifest.name, version: manifest.version, contentDigest: 'a'.repeat(64), fileCount: 8, totalBytes: 6144, containsExecutableFiles: variant === 'executable', skills: variant === 'skills' ? [{ name: 'example-skill', description: 'Example skill', relativePath: 'skills/example/SKILL.md', disableModelInvocation: false }] : [], contributions: variant === 'skills' ? [{ kind: 'skills', relativePath: 'skills', support: 'supported' }] : variant === 'executable' ? [{ kind: 'mcp', relativePath: 'mcp.json', support: 'supported' }] : [{ kind: 'scheduledTasks', relativePath: 'tasks.json', support: 'unsupported' }], diagnostics: variant === 'unsupported' ? [{ type: 'unsupported', message: 'Scheduled tasks are not supported by this host.' }] : [] } }
}
