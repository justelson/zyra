import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import ts from 'typescript'
import { idleVoiceWidgetState } from '../src/shared/assistant/voice-widget'

// Real browser adapters and actual provider/hook bodies; effects use an isolated
// synchronous hook fixture. No browser, app, microphone, provider or server runs.
const root = resolve(import.meta.dir, '..')
const output = await build({
    stdin: { contents: `export { installBrowserDevscopeAdapter } from './src/renderer/src/lib/browser-devscope-adapter'; export { createLiveBrowserDevscopeAdapter } from './src/renderer/src/lib/browser-devscope-live-adapter';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'cjs',
    alias: { '@shared': resolve(root, 'src/shared'), '@': resolve(root, 'src/renderer/src') },
    define: { __ZYRA_DESKTOP_VERSION__: '"0.7.1-dev.1"', 'import.meta.env.DEV': 'false' }
})
const browserWindow: any = { location: { hash: '#/assistant/dev/full-chat', search: '', href: 'https://fixture.invalid/' } }
const module = { exports: {} as any }
runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports, window: browserWindow, URL, URLSearchParams, crypto,
    console, AbortController, TextDecoder, TextEncoder,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => { throw new Error('Voice capability selection must not request a server') }
})
module.exports.installBrowserDevscopeAdapter()
const adapters = [['preview', browserWindow.devscope], ['live', module.exports.createLiveBrowserDevscopeAdapter(browserWindow.devscope)]] as const
const hookSource = readFileSync(resolve(root, 'src/renderer/src/pages/assistant/useAppVoiceSession.tsx'), 'utf8')
const parsed = ts.createSourceFile('voice.tsx', hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const body = parsed.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(parsed)).join('\n')
const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText
const helperPath = resolve(root, 'src/renderer/src/lib/native-voice-widget.ts')
const helper = existsSync(helperPath) ? await import(pathToFileURL(helperPath).href) : {}
const failures: string[] = []
let audioStarts = 0
function fixture(api: unknown) {
    const cleanups: Array<() => void> = []
    let browserOwners = 0
    const context: Record<string, any> = {
        exports: {}, window: { devscope: { voiceWidget: api } }, ...helper,
        idleVoiceWidgetState, crypto,
        createContext: (initial: unknown) => {
            const box: any = { value: initial }
            box.Provider = (props: any) => { box.value = props.value; return props.children }
            return box
        },
        useContext: (box: any) => box.value,
        useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => unknown) => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
        useInstructorVoiceSession: () => {
            browserOwners++
            return { ...idleVoiceWidgetState(), start: () => { audioStarts++ }, stop: async () => true }
        },
        React: { createElement: (type: any, props: any, ...children: unknown[]) => ({ type, props: { ...props, children } }) }
    }
    runInNewContext(code, context)
    return {
        mount: () => {
            const element = context.AssistantVoiceProvider({ children: 'Chat' })
            if (element !== 'Chat') {
                assert.equal(element.type.name, 'BrowserVoiceProvider')
                const provider = element.type(element.props)
                provider.type(provider.props)
            }
            const voice = context.useAppVoiceSession({ conversationId: 'chat-A', sessionId: 'session-A' })
            assert.equal(voice.status, 'idle', 'Mounting Chat never starts Voice')
            return browserOwners
        }, cleanup: () => cleanups.forEach(cleanup => cleanup())
    }
}
for (const [name, adapter] of adapters) {
    const test = fixture(adapter.voiceWidget)
    try { assert.equal(test.mount(), 1, `${name} adapter must mount the browser-owned Voice provider`) }
    catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
    finally { test.cleanup() }
}
for (const api of [undefined, null, {}, () => {}, { onState: () => () => {} }]) {
    const test = fixture(api)
    try { assert.equal(test.mount(), 1, 'Missing or partial native capability must select the browser owner') }
    catch (error) { failures.push(`partial: ${error instanceof Error ? error.message : String(error)}`) }
    finally { test.cleanup() }
}
let reads = 0, subscriptions = 0, unsubscribes = 0
const native = {
    getState: async () => { reads++; return idleVoiceWidgetState() },
    onState: () => { subscriptions++; return () => { unsubscribes++ } },
    open: async () => ({ success: true }), command: async () => ({ success: true })
}
if ('getNativeVoiceWidgetClient' in helper) {
    assert.equal(helper.getNativeVoiceWidgetClient(native), native, 'Capability validation preserves native API identity')
    for (const method of ['getState', 'onState', 'open', 'command'] as const) {
        const partial: Partial<typeof native> = { ...native }
        delete partial[method]
        const test = fixture(partial)
        assert.equal(test.mount(), 1, `Missing ${method} must select the browser owner`)
        test.cleanup()
    }
}
const nativeTest = fixture(native)
assert.equal(nativeTest.mount(), 0, 'A complete native client must not instantiate the browser audio owner')
await Promise.resolve()
nativeTest.cleanup()
assert.equal(reads, 1); assert.equal(subscriptions, 1); assert.equal(unsubscribes, 1)
assert.equal(audioStarts, 0, 'No adapter or fallback may start audio on Chat mount')
assert.deepEqual(failures, [], 'Actual browser adapter/provider/hook mount must not mistake fallback functions for native Voice')
console.log('PASS live/preview production browser adapters and actual Voice provider/hook mount; partial APIs rejected, native subscription retained, no audio/network/app started')
