import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = await mkdtemp(join(tmpdir(), 'zyra-clipboard-media-'))
mock.module('electron', () => ({ app: { getPath: () => directory } }))
const { persistAssistantClipboardImage, resolveAssistantClipboardAttachment } = await import('../src/main/assistant/clipboard-attachments')
try {
    const bytes = Buffer.from([0, 255, 128, 42, 0, 1])
    const path = await persistAssistantClipboardImage({
        dataUrl: `data:video/mp4;base64,${bytes.toString('base64')}`,
        fileName: 'clip.mp4', source: 'paste'
    })
    assert.deepEqual(await readFile(path), bytes)
    assert.ok(path.startsWith(join(directory, 'assistant', 'attachments', 'clipboard')))
    for (const dataUrl of ['data:video/mp4;base64,', 'data:video/mp4;base64,!!!!', 'data:video/mp4;base64,A']) {
        await assert.rejects(persistAssistantClipboardImage({ dataUrl }), /Invalid clipboard attachment/)
    }
    assert.equal(await resolveAssistantClipboardAttachment('clipboard://..'), null)
    assert.equal(await resolveAssistantClipboardAttachment('clipboard://../outside.mp4'), null)
    assert.equal(await resolveAssistantClipboardAttachment('clipboard://missing.mp4'), null)
    console.log('Clipboard media storage: exact video bytes, private staging and malformed/traversal rejection passed')
} finally {
    await rm(directory, { recursive: true, force: true })
}
