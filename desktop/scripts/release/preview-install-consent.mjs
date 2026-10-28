import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { win32 as windows } from 'node:path'
import { absoluteWindowsPath, assertHostedWindows } from './preview-install-environment.mjs'

// Pure, fail-closed policy shared with the expression evaluated in the real renderer.
export function dialogDecision(dialog, version) {
    if (!dialog) return 'waiting'
    if (dialog.heading !== 'Install update?') return 'reject'
    if (dialog.error || dialog.blocked) return 'reject'
    if (dialog.busy) return 'waiting'
    if (dialog.version !== `v${version}`) return 'reject'
    if (!dialog.ready || dialog.readyText !== 'No blocking work.'
        || dialog.buttonText !== 'Restart and install' || !dialog.enabled) return 'reject'
    return 'confirm'
}

export function dialogExpression(version, click = false) {
    return `(() => {
        if (typeof document === 'undefined') return { decision: 'waiting', observed: { document: false } };
        const dialogs = [...document.querySelectorAll('dialog.update-install-confirmation[open]')];
        if (!dialogs.length) return { decision: 'waiting', observed: {
            document: true, readyState: document.readyState,
            closedDialogs: document.querySelectorAll('dialog.update-install-confirmation').length,
            updateBridge: typeof window !== 'undefined' && !!window.devscope?.updates,
            setupVisible: !!document.querySelector?.('.onboarding-step-heading')
        } };
        if (dialogs.length !== 1) return { decision: 'reject', reason: 'Multiple confirmation dialogs' };
        const d = dialogs[0], b = d.querySelector('button.update-install-confirm');
        const text = e => e?.textContent?.trim() || '';
        const snapshot = {
            heading: text(d.querySelector('h2')), version: text(d.querySelector('.agent-update-version')),
            busy: d.getAttribute('aria-busy') === 'true', error: !!d.querySelector('.agent-update-error'),
            blocked: !!d.querySelector('.agent-update-blockers, .agent-update-stop'),
            ready: !!d.querySelector('.agent-update-ready'), readyText: text(d.querySelector('.agent-update-ready')),
            buttonText: text(b), enabled: !!b && !b.disabled
        };
        const decision = (${dialogDecision.toString()})(snapshot, ${JSON.stringify(version)});
        if (${JSON.stringify(click)} && decision === 'confirm') b.click();
        return { decision, snapshot, clicked: ${JSON.stringify(click)} && decision === 'confirm' };
    })()`
}

function assertScope(policy) {
    assertHostedWindows(process.platform, process.env)
    const expected = windows.join(absoluteWindowsPath(process.env.LOCALAPPDATA, 'Local app data'), 'Programs', 'zyra-desktop')
    assert.equal(absoluteWindowsPath(policy.installRoot, 'Install root').toLowerCase(), expected.toLowerCase())
    assert.equal(absoluteWindowsPath(policy.profileRoot, 'Profile root').toLowerCase(),
        windows.join(absoluteWindowsPath(process.env.APPDATA, 'App data'), 'Zyra Preview').toLowerCase())
    assert.equal(process.env.ZYRA_BUILD_DISTRIBUTION, 'preview')
    assert.match(policy.version, /^\d+\.\d+\.\d+-dev\.\d+$/)
    assert.match(policy.sourceSha, /^[a-f0-9]{40}$/)
    assert.equal(policy.sourceSha, process.env.ZYRA_BUILD_SOURCE_SHA)
    const installer = absoluteWindowsPath(policy.installer, 'Installer')
    const relative = windows.relative(absoluteWindowsPath(process.env.GITHUB_WORKSPACE, 'Workspace'), installer)
    assert.ok(relative && !relative.startsWith('..') && !windows.isAbsolute(relative))
    assert.ok(installer.toLowerCase().endsWith(windows.join('dist', 'previews', process.env.GITHUB_RUN_ID,
        'raw', `Zyra-Preview-${policy.version}-Windows-x64.exe`).toLowerCase()))
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function boundedCleanup(promise, timeoutMs = 5_000) {
    let timer
    try { await Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })]) }
    finally { clearTimeout(timer) }
}

const noncePattern = /^\{?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$/i

export function assertConsentReceipt(contents, nonce) {
    assert.ok(noncePattern.test(nonce || ''), 'A real installer request nonce is required')
    assert.equal(contents.trim(), nonce, 'The installer must record this actual manual-consent nonce, not bootstrap or a stale permit')
}

async function requestNames(directory) {
    try { return await readdir(directory) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

async function actualInstallerNonce(directory, before, version) {
    const names = (await requestNames(directory)).filter(name => name.endsWith('.request') && !before.has(name)
        && noncePattern.test(name.slice(0, -'.request'.length)))
    assert.equal(names.length, 1, 'Exactly one fresh native installer request must precede consent')
    const file = windows.join(directory, names[0])
    const info = await lstat(file)
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 128, 'Invalid installer request file')
    assert.equal((await readFile(file, 'utf8')).trim(), version, 'Native request version differs from the exact installer')
    return names[0].slice(0, -'.request'.length)
}

async function ownedPort(policy) {
    assertScope(policy)
    const server = createServer()
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', resolve)
        })
        return server.address().port
    } finally {
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
}

// Adopted overlay views need not carry a BrowserWindow's `page` type label.
export function consentTargets(list) {
    return list.filter(target => ['page', 'webview', 'iframe', 'other'].includes(target?.type)
        && typeof target.webSocketDebuggerUrl === 'string')
}

async function targets(policy, base, browserEndpoint) {
    assertScope(policy)
    const get = async suffix => {
        const response = await fetch(`${base}${suffix}`, { signal: AbortSignal.timeout(2_000), redirect: 'error' })
        assert.ok(response.ok, `CDP ${suffix}: HTTP ${response.status}`)
        return response.json()
    }
    // Match the browser UUID reported by this exact child's stderr, not just a port.
    assert.equal((await get('/json/version')).webSocketDebuggerUrl, browserEndpoint)
    const list = await get('/json/list')
    assert.ok(Array.isArray(list), 'Invalid CDP target list')
    return consentTargets(list)
}

async function evaluate(policy, target, port, expression) {
    assertScope(policy)
    const url = new URL(target.webSocketDebuggerUrl)
    assert.equal(url.protocol, 'ws:')
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.port, String(port))
    assert.match(url.pathname, /^\/devtools\/page\/[^/]+$/)
    const socket = new WebSocket(url)
    try {
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('CDP evaluation timed out')), 5_000)
            const finish = (error, value) => {
                clearTimeout(timer)
                socket.removeEventListener('open', open)
                socket.removeEventListener('message', message)
                socket.removeEventListener('error', failed)
                socket.removeEventListener('close', closed)
                error ? reject(error) : resolve(value)
            }
            const open = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
                params: { expression, returnByValue: true } }))
            const failed = () => finish(new Error('CDP socket error'))
            const closed = () => finish(new Error('CDP closed before evaluation response'))
            const message = event => {
                try {
                    const data = JSON.parse(event.data)
                    if (data.id !== 1) return
                    assert.ok(!data.error && !data.result?.exceptionDetails, 'Renderer evaluation failed')
                    finish(null, data.result?.result?.value)
                } catch (error) { finish(error) }
            }
            socket.addEventListener('open', open)
            socket.addEventListener('message', message)
            socket.addEventListener('error', failed)
            socket.addEventListener('close', closed)
        })
    } finally { socket.close() }
}

// No protocol files are written here. Only the production dialog/coordinator can authorize NSIS.
export async function manualConsentReinstall(policy, run) {
    assertScope(policy)
    const executable = windows.join(policy.installRoot, 'Zyra Preview.exe')
    assert.equal((await realpath(executable)).toLowerCase(), executable.toLowerCase(), 'Installed executable must not be redirected')
    assert.equal((await realpath(policy.installRoot)).toLowerCase(), policy.installRoot.toLowerCase(), 'Install root must not be redirected')
    assert.equal((await realpath(policy.profileRoot)).toLowerCase(), policy.profileRoot.toLowerCase(), 'Preview profile must not be redirected')
    const requests = windows.join(policy.profileRoot, 'updates', 'installer-requests')
    const beforeRequests = new Set(await requestNames(requests))
    const port = await ownedPort(policy)
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
    assertScope(policy) // Immediately before the only application spawn.
    const started = performance.now()
    const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
        { env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let exitResult, stderr = '', browserEndpoint
    let onError, onExit
    const exited = new Promise(resolve => {
        const finish = result => { exitResult = result; resolve(result) }
        onError = error => finish({ error })
        onExit = (code, signal) => finish({ code, signal })
        child.once('error', onError)
        child.once('exit', onExit)
    })
    const onStderr = data => {
        stderr = (stderr + data.toString()).slice(-32_768)
        browserEndpoint ||= stderr.match(new RegExp(`DevTools listening on (ws://127\\.0\\.0\\.1:${port}/devtools/browser/[^\\s]+)`))?.[1]
    }
    child.stderr.on('data', onStderr)
    const abort = new AbortController()
    let installerResult, installation
    try {
        const startupDeadline = Date.now() + 60_000
        while (!browserEndpoint && !exitResult && Date.now() < startupDeadline) await pause(100)
        assert.ok(browserEndpoint && !exitResult, `Installed app did not expose its owned loopback CDP endpoint: ${JSON.stringify(exitResult)}`)
        const base = `http://127.0.0.1:${port}`
        await targets(policy, base, browserEndpoint)
        const readyMs = Math.round(performance.now() - started)
        // Keep the existing real installer runner, including its actual exit-code check.
        installation = run(policy.installer, ['/S', '--updated'], process.env, 600_000, abort.signal)
            .then(ms => (installerResult = { ms }), error => (installerResult = { error }))
        const deadline = Date.now() + 90_000
        let clicked = false, nonce, last = 'No confirmation dialog found'
        while (!clicked && Date.now() < deadline) {
            assert.ok(!exitResult, 'Installed app exited before manual consent')
            assert.ok(!installerResult, `Installer exited before manual consent: ${installerResult?.error || installerResult?.ms}`)
            const pages = await targets(policy, base, browserEndpoint)
            const observations = []
            for (const page of pages) {
                const result = await evaluate(policy, page, port, dialogExpression(policy.version))
                observations.push({ type: page.type, ...result })
                assert.notEqual(result?.decision, 'reject', `Refusing non-idle/unknown/repair/mismatched confirmation: ${JSON.stringify(result)}`)
                if (result?.decision !== 'confirm') continue
                nonce = await actualInstallerNonce(requests, beforeRequests, policy.version)
                // Recheck and click atomically in the renderer; never click a stale observation.
                try {
                    const confirmation = await evaluate(policy, page, port, dialogExpression(policy.version, true))
                    assert.ok(confirmation?.clicked, `Confirmation changed before click: ${JSON.stringify(confirmation)}`)
                } catch (error) {
                    // Quit may close CDP after dispatch but before its reply. Accept only that
                    // transport closure, and still require clean app exit AND actual NSIS success.
                    if (error.message !== 'CDP closed before evaluation response') throw error
                }
                clicked = true
                break
            }
            last = JSON.stringify(observations)
            if (!clicked) await pause(250)
        }
        assert.ok(clicked, `Timed out waiting for actual install confirmation: ${last}`)
        const consentMs = Math.round(performance.now() - started)
        const exitDeadline = Date.now() + 60_000
        while (!exitResult && Date.now() < exitDeadline) await pause(100)
        assert.ok(exitResult, 'App did not exit after actual consent')
        const result = await exited
        assert.ok(!result.error && result.code === 0 && !result.signal, `App exit after consent failed: ${JSON.stringify(result)}`)
        const appExitMs = Math.round(performance.now() - started)
        await installation
        if (installerResult.error) throw installerResult.error
        const receipt = windows.join(policy.profileRoot, 'assistant', 'agent-server', `install-success-${policy.version}.flag`)
        assertConsentReceipt(await readFile(receipt, 'utf8'), nonce)
        const remaining = await requestNames(requests)
        assert.ok(!remaining.includes(`${nonce}.request`) && !remaining.includes(`${nonce}.ready`), 'Native installer must consume the matching request and ready files')
        return { readyMs, consentMs, appExitMs, installerMs: installerResult.ms, manualReceiptMatched: true }
    } finally {
        abort.abort() // The runner kills only its own installer child on failure.
        if (!exitResult) {
            child.kill() // Exact owned handle only. Never a name/PID sweep.
            await boundedCleanup(exited)
        }
        if (installation) await boundedCleanup(installation)
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
        child.stderr.removeListener('data', onStderr)
        child.stderr.destroy()
    }
}
