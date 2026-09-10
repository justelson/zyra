import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDirectory, '..')
const repoRoot = resolve(desktopRoot, '..')
const accountServicePath = resolve(desktopRoot, 'src/main/assistant/zyra-account-service.ts')
const accountServiceSource = readFileSync(accountServicePath, 'utf8')
const authWorkerSource = readFileSync(resolve(repoRoot, 'src/desktop-openai-auth-worker.mjs'), 'utf8')
const loaderSource = accountServiceSource.split('async function loadChatGptAccountModule()')[1].split('export class ZyraAccountService')[0]
assert.match(loaderSource, /const \{ account \} = getSharedOpenAIAuthWorkerClient\(\)/, 'account reads must reuse the existing auth worker')
assert.doesNotMatch(loaderSource, /import\(/, 'opening Account cannot import model runtime modules in Electron main')
assert.match(authWorkerSource, /from "\.\/chatgpt-account\.mjs"/, 'the auth worker must load the dedicated account module')

const accountModuleUrl = pathToFileURL(resolve(repoRoot, 'src/chatgpt-account.mjs')).href
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const workerProbe = `
const { parentPort } = require('node:worker_threads');
void (async () => {
    const account = await import(${JSON.stringify(accountModuleUrl)});
    if (typeof account.buildChatGptAccountStatus !== 'function') throw new Error('ChatGPT account status export is missing');
    if (typeof account.fetchCodexResetCredits !== 'function') throw new Error('reset list export is missing');
    if (typeof account.redeemCodexResetCredit !== 'function') throw new Error('reset consumption export is missing');
    const usage = account.normalizeCodexUsageStats({ rate_limit: { primary_window: { used_percent: 25 } } }, 'test');
    if (usage.primary?.usedPercent !== 25) throw new Error('usage normalization failed');
    parentPort.postMessage('assistant-account-electron-worker-ok');
})().catch(error => { throw error; });
`
const probe = `
import { Worker } from 'node:worker_threads';
const worker = new Worker(${JSON.stringify(workerProbe)}, { eval: true, execArgv: [] });
try {
    console.log(await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => reject(new Error('Worker exited before responding: ' + code)));
    }));
} finally { await worker.terminate(); }
`
const result = spawnSync(electronPath, ['--input-type=module', '-e', probe], {
    cwd: repoRoot,
    env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
    },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
})

assert.equal(
    result.status,
    0,
    `Electron could not load the account module.\n${String(result.stderr || result.stdout || '').trim()}`
)
assert.match(result.stdout, /assistant-account-electron-worker-ok/)

console.log('assistant account Electron runtime tests passed')
