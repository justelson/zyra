import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createOnboardingGatedIpcMain } from '../src/main/ipc/onboarding-ipc-gate'

// Inspect actual component composition; no React renderer, application or installer runs.
const root = resolve(import.meta.dir, '..')
const source = (file: string) => ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const app = source('src/renderer/src/App.tsx')
const prompt = source('src/renderer/src/components/updates/UpdatePromptCenter.tsx')
function declaration(file: ts.SourceFile, name: string) {
    const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(node && ts.isFunctionDeclaration(node) && node.body, `Missing production function ${name}`)
    return node as ts.FunctionDeclaration & { body: ts.Block }
}
function returned(file: ts.SourceFile, name: string) {
    const node = declaration(file, name).body.statements.at(-1)
    assert.ok(node && ts.isReturnStatement(node) && node.expression, `Missing final return in ${name}`)
    return node.expression
}
function mountedNames(setupAllowed: boolean) {
    const names: string[] = []
    const visit = (node: ts.Node, file: ts.SourceFile) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            const name = (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(file)
            names.push(name)
            if (name === 'OnboardingGate' && !setupAllowed) return
            if (name === 'NormalDesktopApp') { visit(returned(app, name), app); return }
            if (name === 'UpdatePromptCenter') { visit(returned(prompt, name), prompt); return }
            if (ts.isJsxElement(node)) node.children.forEach(child => visit(child, file))
            return
        }
        ts.forEachChild(node, child => visit(child, file))
    }
    visit(returned(app, 'AppSurface'), app)
    return names
}
if (!process.argv.includes('--ipc')) {
    for (const setupAllowed of [false, true]) {
        const names = mountedNames(setupAllowed)
        assert.equal(names.filter(name => name === 'AppUpdatesProvider').length, 1, 'First-run setup must not hide the update-state subscription')
        assert.equal(names.filter(name => name === 'UpdateInstallConfirmation').length, 1, 'One real confirmation host must remain available before and after setup')
        assert.equal(names.includes('NormalDesktopApp'), setupAllowed, 'Normal tools and routes remain behind onboarding')
        assert.equal(names.includes('AssistantVoiceProvider'), setupAllowed, 'Moving update UI must not start Voice before setup')
    }
    console.log('PASS actual AppSurface composition keeps one update host outside setup while normal tools remain gated')
}

if (!process.argv.includes('--renderer')) {
    // Execute only updater registration expressions from the real main registry,
    // through its real setup facade. All handlers/authority are synthetic values.
    const registry = source('src/main/ipc/handlers.ts')
    const manager = source('src/main/update/manager.ts')
    const registrations = declaration(registry, 'registerIpcHandlers').body.statements.filter(node => {
        if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false
        const call = node.expression
        if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'handle') return false
        return /^(UPDATE_|'devscope:updates:resumePreviousAgent')/.test(call.arguments[0]?.getText(registry) || '')
    })
    assert.equal(registrations.length, 7, 'Exercise every existing updater invoke registration')
    const guards = declaration(registry, 'registerIpcHandlers').body.statements.filter(node => ts.isVariableStatement(node)
        && node.declarationList.declarations.some(d => ['requireCompletedSetup', 'guardManualInstallerUpdate'].includes(d.name.getText(registry))))
    const values = new Map<string, (...args: any[]) => unknown>()
    let setupAllowed = false, currentRequest: 'none' | 'valid' | 'expired' | 'mismatch' | 'version-mismatch' | 'marker-mismatch' = 'none', calls = 0
    const pending = { id: '12345678-1234-1234-1234-123456789abc', version: '0.7.1-dev.33', agentServerUpdate: true }
    const blocked = { code: 'ONBOARDING_REQUIRED' }
    const trusted = { handle: (channel: string, handler: (...args: any[]) => unknown) => values.set(channel, (event, ...args) => event.trusted ? handler(event, ...args) : { code: 'UNTRUSTED' }) }
    const context: Record<string, any> = {
        exports: {}, trustedIpcMain: trusted,
        setupServices: { onboarding: { isAccessAllowed: () => setupAllowed } },
        onboardingRequiredError: () => blocked,
        updateState: { get externalInstaller() { return currentRequest === 'none' ? undefined
            : currentRequest === 'marker-mismatch' ? { ...pending, agentServerUpdate: false } : pending } },
        installerRequests: { assertCurrent: () => {
            if (currentRequest === 'expired') throw new Error('expired')
            return { ...pending, id: currentRequest === 'mismatch' ? 'different-owner' : pending.id,
                version: currentRequest === 'version-mismatch' ? '0.7.1-dev.32' : pending.version }
        } }
    }
    context.ipcMain = createOnboardingGatedIpcMain(trusted, { isAccessAllowed: () => setupAllowed, allowedBeforeOnboarding: new Set(), blockedResult: () => blocked })
    for (const name of ['UPDATE_GET_STATE_CHANNEL', 'UPDATE_CHECK_CHANNEL', 'UPDATE_DOWNLOAD_CHANNEL', 'UPDATE_PREFLIGHT_CHANNEL', 'UPDATE_DEFER_CHANNEL', 'UPDATE_INSTALL_CHANNEL']) context[name] = name
    for (const name of ['handleGetUpdateState', 'handleCheckForUpdates', 'handleDownloadUpdate', 'handlePreflightUpdate', 'handleDeferUpdate', 'handleResumePreviousAgent', 'handleInstallUpdate']) context[name] = () => { calls++; return { handler: name } }
    const guardFile = resolve(root, 'src/main/ipc/manual-installer-update-gate.ts')
    if (existsSync(guardFile)) Object.assign(context, await import(guardFile))
    const current = manager.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'hasCurrentManualInstallerRequest')
    const code = [current?.getText(manager), ...guards.map(node => node.getText(registry)), ...registrations.map(node => node.getText(registry))].filter(Boolean).join('\n')
    runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
    const invoke = (channel: string, trusted = true) => values.get(channel)!({ trusted })
    assert.equal((invoke('UPDATE_GET_STATE_CHANNEL') as any).handler, 'handleGetUpdateState', 'Trusted first-run window must be able to observe a real installer request')
    assert.equal((invoke('UPDATE_GET_STATE_CHANNEL', false) as any).code, 'UNTRUSTED', 'Metadata remains trusted-window only')
    const manual = ['UPDATE_PREFLIGHT_CHANNEL', 'UPDATE_DEFER_CHANNEL', 'UPDATE_INSTALL_CHANNEL']
    for (const state of ['none', 'expired', 'mismatch', 'version-mismatch', 'marker-mismatch', 'valid'] as const) {
        currentRequest = state
        for (const channel of manual) {
            const before = calls, result = invoke(channel)
            assert.equal(calls - before, state === 'valid' ? 1 : 0, `${channel} must require a fresh matching native request before setup (${state})`)
            if (state !== 'valid') assert.equal(result, blocked)
            assert.equal((invoke(channel, false) as any).code, 'UNTRUSTED', 'Setup exception must retain trusted-sender enforcement')
        }
        for (const channel of ['UPDATE_CHECK_CHANNEL', 'UPDATE_DOWNLOAD_CHANNEL', 'devscope:updates:resumePreviousAgent']) {
            const before = calls
            assert.equal(invoke(channel), blocked)
            assert.equal(calls, before, 'A native request must not unlock other update operations')
        }
    }
    setupAllowed = true; currentRequest = 'none'
    for (const channel of values.keys()) {
        const before = calls; invoke(channel)
        assert.equal(calls, before + 1, 'Completed setup preserves all existing update operations')
    }
    console.log('PASS real updater registrations: metadata read, current-request-only pre-setup controls, expiry/owner/trusted-sender rejection and unchanged post-setup access')
}
