import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

export function isPathInsideRoot(root: string, target: string): boolean {
    const relative = path.relative(root, target)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Verify the native descriptor before reading. Path checks alone can race a
 * swapped file or parent junction; bigint IDs retain Windows file identity. */
export async function readProjectSearchFile(root: string, filename: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer | null> {
    if (!isPathInsideRoot(root, filename)) return null
    const before = await lstat(filename, { bigint: true })
    if (!before.isFile() || before.size > BigInt(maxBytes)) return null
    const resolved = await realpath(filename)
    if (!isPathInsideRoot(root, resolved)) return null
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
    const handle = await open(filename, flags)
    try {
        const opened = await handle.stat({ bigint: true })
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > BigInt(maxBytes)) return null
        const after = await lstat(filename, { bigint: true })
        if (!after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || await realpath(filename) !== resolved) return null
        signal?.throwIfAborted()
        const buffer = Buffer.allocUnsafe(maxBytes + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return bytesRead > maxBytes ? null : buffer.subarray(0, bytesRead)
    } finally { await handle.close() }
}
