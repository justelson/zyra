import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { installerIsAbsent } from '../src/main/update/installer-presence'
if (process.platform !== 'win32') console.log('SKIP Windows installer-mutex acceptance on this platform')
else {
    const name = `Zyra-fixture-${randomUUID()}`
    assert.equal(await installerIsAbsent(name), true)
    const script = `$m=[Threading.Mutex]::new($false,'Local\\ZyraAgentUpdate.${name}'); [Console]::WriteLine('READY'); [void][Console]::ReadLine(); $m.Dispose()`
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Fixture mutex did not become ready')), 5_000)
            child.once('error', reject)
            child.stdout.once('data', chunk => { clearTimeout(timer); assert.match(String(chunk), /READY/); resolve() })
        })
        assert.equal(await installerIsAbsent(name), false, 'a live installer blocks recovery')
        child.stdin.end('done\n')
        await exited
        assert.equal(await installerIsAbsent(name), true, 'recovery requires positively observed installer absence')
        assert.equal(await installerIsAbsent("bad'name"), false, 'unknown names never become executable script')
        console.log('PASS real installation-owned Windows mutex presence/absence, no real installer or user app touched')
    } finally { child.stdin.end(); if (child.exitCode === null) child.kill(); await exited }
}
