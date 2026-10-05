import assert from 'node:assert/strict'
import { mock } from 'bun:test'

mock.module('electron', () => ({ app: {
    isPackaged: true,
    getPath() { throw new Error('Preview must not reach the stable launcher path') }
} }))
mock.module('../src/shared/distribution-identity', () => ({
    canManageGlobalTerminalCommand: () => false,
    isPreviewDistribution: () => true
}))
const { installTerminalCommand, removeTerminalCommand } = await import('../src/main/terminal-command-service')
await assert.rejects(installTerminalCommand(), /Preview builds cannot replace/)
await assert.rejects(removeTerminalCommand(), /Preview builds cannot remove/)
console.log('Packaged preview launcher actions reject before resolving or mutating stable paths')
