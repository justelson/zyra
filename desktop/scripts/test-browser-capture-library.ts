import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserCaptureLibrary } from '../src/main/browser-capture-library'
import { configureBrowserCaptureHandoff, enqueueBrowserCaptureDraft, readBrowserCaptureDraft, acknowledgeBrowserCaptureDraft } from '../src/main/browser-capture-handoff'

const directory = mkdtempSync(join(tmpdir(), 'zyra-capture-library-'))
try {
    const library = new BrowserCaptureLibrary(directory)
    assert.equal(library.list().total, 0)
    const first = randomUUID()
    writeFileSync(join(directory, first + '.png'), 'synthetic screenshot')
    for (let i = 0; i < 13; i++) writeFileSync(join(directory, randomUUID() + '.webm'), 'synthetic video')
    writeFileSync(join(directory, 'unrelated.txt'), 'preserve')
    assert.equal(library.list().captures.length, 12)
    assert.equal(library.list({ offset: 12 }).captures.length, 2)
    assert.equal(library.list({ kind: 'screenshot' }).total, 1)
    assert.equal(new BrowserCaptureLibrary(directory).list().total, 14, 'existing files survive process catalog recreation')
    assert.equal(library.list({ limit: Infinity, offset: Infinity }).captures.length, 12)
    assert.throws(() => library.get('../unrelated.txt'))
    assert.throws(() => library.delete('browser-screenshot:../../unrelated.txt'))
    assert.equal(existsSync(join(directory, 'unrelated.txt')), true)
    const artifact = library.get('browser-screenshot:' + first)
    const { path: _path, ...publicArtifact } = artifact
    let launches = 0
    configureBrowserCaptureHandoff(() => { launches++ }, () => 17)
    enqueueBrowserCaptureDraft({ artifact: publicArtifact, sessionId: null, reference: 'clipboard://staged.png' })
    assert.equal(launches, 1)
    assert.throws(() => readBrowserCaptureDraft(18), /main chat window/)
    assert.throws(() => acknowledgeBrowserCaptureDraft(18, 'anything'), /main chat window/)
    const draft = readBrowserCaptureDraft(17)!
    assert.equal(draft.sessionId, null)
    acknowledgeBrowserCaptureDraft(17, 'wrong-id')
    assert.equal(readBrowserCaptureDraft(17)?.id, draft.id, 'acknowledgment cannot remove another capture')
    acknowledgeBrowserCaptureDraft(17, draft.id)
    assert.equal(readBrowserCaptureDraft(17), null)
    library.delete(artifact.artifactId)
    assert.equal(library.list().total, 13)
    assert.equal(existsSync(join(directory, 'unrelated.txt')), true)
    assert.throws(() => library.get(artifact.artifactId), /missing/)
    console.log('Browser capture library: persistence, pages, filters, safe deletion and main-window handoff pass')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-capture-library-')) throw new Error('Unexpected test cleanup path')
    rmSync(directory, { recursive: true, force: true })
}
