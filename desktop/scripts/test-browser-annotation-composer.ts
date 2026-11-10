import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    buildAssistantBrowserAnnotationPrompt,
    parseAssistantBrowserAnnotation,
    publishAssistantBrowserAnnotationAttachment,
    serializeAssistantBrowserAnnotation,
    subscribeAssistantBrowserAnnotationAttachments
} from '../src/renderer/src/pages/assistant/assistant-browser-annotation-composer'
import { buildPromptWithContextFiles } from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import type { DevScopeBrowserAnnotationPayload } from '../src/shared/contracts/devscope-api'

const annotation: DevScopeBrowserAnnotationPayload = {
    id: 'annotation:test',
    tabId: 'browser:1',
    url: 'http://localhost:5174/',
    title: 'Test page',
    comment: 'Move this button lower',
    elements: [{
        id: 'element:1',
        tabId: 'browser:1',
        url: 'http://localhost:5174/',
        title: 'Test page',
        selector: '[data-testid="get-started"]',
        tagName: 'button',
        attributes: { 'data-testid': 'get-started' },
        bounds: { x: 20, y: 30, width: 140, height: 44 },
        createdAt: '2026-07-30T00:00:00.000Z'
    }],
    regions: [{ id: 'region:1', rect: { x: 10, y: 10, width: 200, height: 120 } }],
    strokes: [],
    styleChanges: [],
    createdAt: '2026-07-30T00:00:00.000Z'
}

const serialized = serializeAssistantBrowserAnnotation(annotation)
const parsed = parseAssistantBrowserAnnotation(serialized)
assert.equal(parsed?.comment, annotation.comment)
assert.equal(parsed?.elements[0]?.selector, annotation.elements[0]?.selector)
assert.deepEqual(parsed?.elements[0]?.attributes, {}, 'composer persistence omits page attributes')
assert.match(buildAssistantBrowserAnnotationPrompt(annotation), /Comment: Move this button lower/)
assert.match(buildAssistantBrowserAnnotationPrompt(annotation), /Element: \[data-testid="get-started"\]/)

const prompt = buildPromptWithContextFiles('Fix this', [{
    id: annotation.id,
    path: 'clipboard://preview-annotation.png',
    name: 'preview-annotation.png',
    content: serialized,
    mimeType: 'image/png',
    kind: 'image',
    sizeBytes: 1024,
    previewDataUrl: 'data:image/png;base64,AA==',
    source: 'paste'
}])
assert.match(prompt, /Browser annotation \[IMAGE\]/)
assert.match(prompt, /<preview_annotation>/)
assert.match(prompt, /ref: clipboard:\/\/preview-annotation\.png/)
assert.doesNotMatch(prompt, /data:image\/png/)

let received = 0
const unsubscribe = subscribeAssistantBrowserAnnotationAttachments('session:test', (attachment) => {
    received += 1
    assert.equal(attachment.annotation?.id, annotation.id)
})
publishAssistantBrowserAnnotationAttachment({
    sessionId: 'session:test',
    reference: 'clipboard://preview-annotation.png',
    annotation,
    artifact: {
        artifactId: 'browser-screenshot:test',
        tabId: 'browser:1',
        kind: 'screenshot',
        mimeType: 'image/png',
        sizeBytes: 1024,
        createdAt: '2026-07-30T00:00:00.000Z'
    }
})
unsubscribe()
assert.equal(received, 1)

const electronSmokeSource = readFileSync(new URL('./test-browser-annotation-electron.ts', import.meta.url), 'utf8')
const electronRunnerSource = readFileSync(new URL('./maint/run-browser-annotation-test.mjs', import.meta.url), 'utf8')
assert.match(electronSmokeSource, /ANNOTATION_SMOKE_TIMEOUT_MS = 60_000[\s\S]*app\.exit\(1\)/, 'the native annotation smoke must fail and exit on an internal readiness hang')
assert.match(electronRunnerSource, /ANNOTATION_RUNNER_TIMEOUT_MS = 90_000[\s\S]*taskkill[\s\S]*'\/T'[\s\S]*'\/F'/, 'the outer runner must bound and clean the complete Windows Electron process tree')

console.log('Browser annotation composer contract: ok')
