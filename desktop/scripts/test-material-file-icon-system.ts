import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
    MATERIAL_FILE_ICON_RESOLUTION_CACHE_LIMIT,
    materialFileIconUrl,
    preloadMaterialFileIcon,
    prewarmCommonMaterialFileIcons,
    resolveMaterialFileIconAsset,
    scheduleCommonMaterialFileIconPrewarm
} from '../src/renderer/src/components/ui/file-preview/materialFileIconTheme'

const fileEntrySource = readFileSync(new URL('../src/renderer/src/components/ui/FileEntryIcon.tsx', import.meta.url), 'utf8')
const previewIconSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/FileSystemEntryIcon.tsx', import.meta.url), 'utf8')
const officeToolbarSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/OfficePreviewToolbar.tsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    build?: { fileAssociations?: Array<{ name?: string; description?: string; icon?: string; ext?: string[] }> }
}

assert.match(fileEntrySource, /resolveMaterialFileIconAsset/, 'the shared file icon component uses the local Material resolver')
assert.match(fileEntrySource, /scheduleCommonMaterialFileIconPrewarm\(\)/, 'common local icons are scheduled for idle prewarming')
assert.match(fileEntrySource, /preloadMaterialFileIcon\(icon\.fileName\)/, 'concurrent first-use images share one local preload/decode')
assert.match(fileEntrySource, /onError=\{\(\) => setFailedIconUrl\(iconUrl\)\}/, 'missing assets retain a local Lucide fallback')
assert.match(previewIconSource, /<FileEntryIcon/, 'Inspector uses the same shared component as the rest of the app')
assert.match(officeToolbarSource, /<FileEntryIcon pathValue=\{`preview\.\$\{type\}`\}/, 'Office preview chrome uses Word, workbook, and PowerPoint icons from the same library')
assert.equal(existsSync(new URL('../src/renderer/src/components/ui/VscodeEntryIcon.tsx', import.meta.url)), false, 'the obsolete remote VS Code icon adapter is removed')
assert.equal(existsSync(new URL('../src/renderer/src/lib/vscode-icons.ts', import.meta.url)), false, 'the remote CDN resolver is removed')
assert.equal(existsSync(new URL('../src/renderer/src/lib/vscode-icons-manifest.json', import.meta.url)), false)
assert.equal(existsSync(new URL('../src/renderer/src/lib/vscode-icons-language-associations.json', import.meta.url)), false)

assert.equal(resolveMaterialFileIconAsset({ path: 'README.md', kind: 'file' }).definition, 'readme')
assert.equal(resolveMaterialFileIconAsset({ path: 'proposal.docx', kind: 'file' }).definition, 'word')
assert.equal(resolveMaterialFileIconAsset({ path: 'forecast.xlsx', kind: 'file' }).definition, 'table')
assert.equal(resolveMaterialFileIconAsset({ path: 'slides.pptx', kind: 'file' }).definition, 'powerpoint')
assert.equal(resolveMaterialFileIconAsset({ path: '.zyra', kind: 'directory' }).definition, 'folder-app', 'Zyra project state has a distinct app-folder alias')
assert.equal(resolveMaterialFileIconAsset({ path: '.zyra', kind: 'directory', expanded: true }).definition, 'folder-app-open')
assert.equal(resolveMaterialFileIconAsset({ path: '.zyra-worktrees', kind: 'directory' }).definition, 'folder-git')
assert.equal(resolveMaterialFileIconAsset({ path: 'profile.zyra', kind: 'file' }).definition, 'robot', 'future Zyra-owned files have a distinct local alias')
assert.equal(resolveMaterialFileIconAsset({ path: 'component.svelte', kind: 'file' }).definition, 'svelte', 'uncommon library associations remain available')
assert.equal(resolveMaterialFileIconAsset({ path: 'schema.prisma', kind: 'file' }).definition, 'prisma')
assert.equal(resolveMaterialFileIconAsset({ path: 'unknown.zyx-unlisted', kind: 'file' }).definition, 'file', 'unknown extensions retain the Material generic-file fallback')
assert.equal(materialFileIconUrl('typescript.svg'), 'material-icons/typescript.svg', 'server and test resolution remains a local relative asset URL')

const cachedReadme = resolveMaterialFileIconAsset({ path: 'C:/one/README.md', kind: 'file' })
assert.strictEqual(
    resolveMaterialFileIconAsset({ path: 'D:\\two\\README.md', kind: 'file' }),
    cachedReadme,
    'resolution is memoized across paths by stable entry filename and icon state'
)
assert.notStrictEqual(
    resolveMaterialFileIconAsset({ path: 'README.md', kind: 'file', light: true }),
    cachedReadme,
    'theme is part of the resolution cache key even when the current library maps both themes to one asset'
)
const oldestCacheEntry = resolveMaterialFileIconAsset({ path: 'cache-entry-0.unknown', kind: 'file' })
for (let index = 1; index <= MATERIAL_FILE_ICON_RESOLUTION_CACHE_LIMIT; index += 1) {
    resolveMaterialFileIconAsset({ path: `cache-entry-${index}.unknown`, kind: 'file' })
}
assert.notStrictEqual(
    resolveMaterialFileIconAsset({ path: 'cache-entry-0.unknown', kind: 'file' }),
    oldestCacheEntry,
    'resolution memoization evicts least-recent entries at its fixed module-level bound'
)

const warmedFileNames: string[] = []
const warmedAssets = prewarmCommonMaterialFileIcons((fileName) => warmedFileNames.push(fileName))
assert.equal(warmedAssets.length, new Set(warmedFileNames).size, 'common prewarming loads each resolved SVG only once across themes')
assert.equal(warmedAssets.length >= 20 && warmedAssets.length <= 48, true, 'the curated warm set stays conservative')
for (const expected of ['readme.svg', 'nodejs.svg', 'typescript.svg', 'folder-src.svg', 'folder-src-open.svg']) {
    assert.equal(warmedFileNames.includes(expected), true, `${expected} is part of the common warm set`)
}
let scheduledWork = 0
assert.equal(scheduleCommonMaterialFileIconPrewarm({
    schedule(work) {
        scheduledWork += 1
        work()
    },
    preload() {}
}), true, 'the common warm set can be queued by an idle scheduler')
assert.equal(scheduleCommonMaterialFileIconPrewarm({ schedule() {} }), false, 'common prewarming is scheduled only once per renderer module')
assert.equal(scheduledWork, 1)

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
let imageInstances = 0
let decodeCalls = 0
class FakeImage {
    decoding = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private source = ''

    constructor() {
        imageInstances += 1
    }

    set src(value: string) {
        this.source = value
        queueMicrotask(() => this.onload?.())
    }

    get src(): string {
        return this.source
    }

    decode(): Promise<void> {
        decodeCalls += 1
        return Promise.resolve()
    }
}
Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: 'file:///renderer/' } })
Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage })
const firstPreload = preloadMaterialFileIcon('shared-first-use.svg')
const duplicatePreload = preloadMaterialFileIcon('shared-first-use.svg')
assert.strictEqual(duplicatePreload, firstPreload, 'duplicate first-use requests share one in-flight preload')
await Promise.all([firstPreload, duplicatePreload])
assert.equal(imageInstances, 1)
assert.equal(decodeCalls, 1)
if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
else delete (globalThis as { document?: unknown }).document
if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage)
else delete (globalThis as { Image?: unknown }).Image

const associations = packageJson.build?.fileAssociations || []
const associationByName = new Map(associations.map((association) => [association.name, association]))
for (const associationName of ['Zyra Code and Text Preview', 'Zyra Document Preview', 'Zyra Image Preview', 'Zyra Media Preview']) {
    const association = associationByName.get(associationName)
    assert.ok(association, `${associationName} is visible as an OS-level file type`)
    assert.equal(association?.icon, 'resources/icon', 'non-Windows defaults retain the application icon; the Windows beforePack hook replaces these with per-extension Material ICOs')
}
const documentExtensions = new Set(associationByName.get('Zyra Document Preview')?.ext || [])
for (const extension of ['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv']) assert.equal(documentExtensions.has(extension), true)

console.log('Material file icon system: ok')
