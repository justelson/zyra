import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mock } from 'bun:test'
const temporary = await mkdtemp(join(tmpdir(), 'zyra-preview-terminal-'))
const oldLocal = process.env.LOCALAPPDATA
process.env.LOCALAPPDATA = temporary
mock.module('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.7.1', getPath: () => join(temporary, 'Zyra Preview') } }))
const runtimeGlobals = globalThis as typeof globalThis & { __ZYRA_BUILD_METADATA__?: unknown }
runtimeGlobals.__ZYRA_BUILD_METADATA__ = {distribution:'preview', sourceSha:'a'.repeat(40), sourceRepository:'example/source', runId:'123'}
try {
    const { canManageGlobalTerminalCommand } = await import('../src/shared/distribution-identity')
    assert.equal(canManageGlobalTerminalCommand(true), false)
    const { getTerminalCommandStatus, installTerminalCommand, removeTerminalCommand } = await import('../src/main/terminal-command-service')
    const status = await getTerminalCommandStatus()
    assert(status.path.endsWith(process.platform === 'win32' ? 'zyra-dev.cmd' : 'zyra-dev'))
    assert(status.canManage)
    // A custom command is refused before package/path mutation. On Unix keep
    // the real home untouched; the portable installer tests cover those writes.
    if (process.platform === 'win32') {
        await mkdir(join(temporary, 'Zyra/bin'), {recursive:true})
        const stable = join(temporary, 'Zyra/bin/zyra.cmd')
        await writeFile(stable, 'untouched stable')
        await writeFile(status.path, 'custom Dev command')
        await assert.rejects(installTerminalCommand(), /unmanaged/)
        await assert.rejects(removeTerminalCommand(), /unmanaged/)
        assert.equal(await readFile(stable, 'utf8'), 'untouched stable')
        assert.equal(await readFile(status.path, 'utf8'), 'custom Dev command')
    }
} finally {
    delete runtimeGlobals.__ZYRA_BUILD_METADATA__
    if (oldLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocal
    await rm(temporary, {recursive:true,force:true})
}
console.log('Preview owns only zyra-dev; stable and custom commands remain untouched')
