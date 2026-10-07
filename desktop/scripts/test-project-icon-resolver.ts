import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveProjectIconPath } from '../src/main/services/project-icon-resolver'
import { isGenericUserFolderPath } from '../src/shared/projects/project-path-classification'
import { retainAssistantProjectPresentation } from '../src/renderer/src/pages/assistant/assistant-project-presentation-memory'

const rememberedProjectPresentation = retainAssistantProjectPresentation('C:\\workspace\\stable-icon', {
    projectIconPath: 'C:\\workspace\\stable-icon\\icon.svg',
    projectType: 'node',
    framework: 'react'
})
assert.deepEqual(
    retainAssistantProjectPresentation('C:\\WORKSPACE\\stable-icon\\', {
        projectIconPath: null,
        projectType: null,
        framework: null
    }),
    rememberedProjectPresentation,
    'an expired details-cache entry must not make a known project identity disappear'
)

const fixtureRoot = await mkdtemp(join(tmpdir(), 'zyra-project-icons-'))
const projectRoot = join(fixtureRoot, 'project')
const desktopWorkspaceRoot = join(fixtureRoot, 'desktop-workspace')
const electronWorkspaceRoot = join(fixtureRoot, 'electron-workspace')
const ordinaryFolderRoot = join(fixtureRoot, 'ordinary-folder')
const rootRelativeProject = join(fixtureRoot, 'root-relative-project')
const workspaceEscapeRoot = join(fixtureRoot, 'workspace-project')
const outsideWorkspaceRoot = join(fixtureRoot, 'outside-workspace')
const outsideIcon = join(fixtureRoot, 'outside.png')
const namedAssetProject = join(fixtureRoot, 'named-asset-project')
const productNameProject = join(fixtureRoot, 'product-name-project')

try {
    await mkdir(join(projectRoot, 'public'), { recursive: true })
    await writeFile(join(projectRoot, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(outsideIcon, 'outside')

    const detected = await resolveProjectIconPath(projectRoot, ['public'], {})
    assert.equal(detected, join(projectRoot, 'public', 'favicon.svg'), 'bounded common favicon detection should resolve inside the project')

    await mkdir(join(namedAssetProject, 'src', 'assets'), { recursive: true })
    await writeFile(join(namedAssetProject, 'src', 'assets', 'my-product-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert.equal(
        await resolveProjectIconPath(namedAssetProject, ['package.json', 'src'], { name: 'named-asset' }),
        join(namedAssetProject, 'src', 'assets', 'my-product-logo.svg'),
        'project artwork with a descriptive file name should resolve from common asset folders'
    )

    await mkdir(join(productNameProject, 'public', 'images'), { recursive: true })
    await writeFile(join(productNameProject, 'public', 'images', 'Monax.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert.equal(
        await resolveProjectIconPath(productNameProject, ['package.json', 'public'], { name: '@scope/monax' }),
        join(productNameProject, 'public', 'images', 'Monax.svg'),
        'project artwork named after the package should resolve without an icon suffix'
    )

    await rm(join(projectRoot, 'public', 'favicon.svg'))
    const escaped = await resolveProjectIconPath(projectRoot, ['package.json'], { build: { icon: outsideIcon } })
    assert.equal(escaped, null, 'package metadata must not make automatic icon discovery escape the project root')

    await mkdir(join(rootRelativeProject, 'brand'), { recursive: true })
    await writeFile(join(rootRelativeProject, 'brand', 'app-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(rootRelativeProject, 'index.html'), '<link rel="icon" href="/brand/app-icon.svg">')
    const rootRelativeIcon = await resolveProjectIconPath(rootRelativeProject, ['brand', 'index.html'], {})
    assert.equal(rootRelativeIcon, join(rootRelativeProject, 'brand', 'app-icon.svg'), 'root-relative web icon declarations should resolve inside the project')

    await mkdir(workspaceEscapeRoot, { recursive: true })
    await mkdir(join(outsideWorkspaceRoot, 'public'), { recursive: true })
    await writeFile(join(outsideWorkspaceRoot, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const escapedWorkspaceIcon = await resolveProjectIconPath(workspaceEscapeRoot, ['package.json'], { workspaces: ['../outside-workspace'] })
    assert.equal(escapedWorkspaceIcon, null, 'workspace metadata must not make automatic icon discovery escape the selected project root')

    await mkdir(join(desktopWorkspaceRoot, 'desktop', 'resources'), { recursive: true })
    await writeFile(join(desktopWorkspaceRoot, 'package.json'), JSON.stringify({ name: 'desktop-workspace', private: true }))
    await writeFile(join(desktopWorkspaceRoot, 'desktop', 'resources', 'icon.png'), 'desktop icon')
    const nestedDesktopIcon = await resolveProjectIconPath(desktopWorkspaceRoot, ['desktop', 'package.json'], { name: 'desktop-workspace', private: true })
    assert.equal(nestedDesktopIcon, join(desktopWorkspaceRoot, 'desktop', 'resources', 'icon.png'), 'top-level desktop app icons should represent a real workspace root')

    await mkdir(join(electronWorkspaceRoot, 'electron', 'build'), { recursive: true })
    await writeFile(join(electronWorkspaceRoot, 'package.json'), JSON.stringify({ name: 'electron-workspace', private: true }))
    await writeFile(join(electronWorkspaceRoot, 'electron', 'build', 'icon.png'), 'electron icon')
    const nestedElectronIcon = await resolveProjectIconPath(electronWorkspaceRoot, ['electron', 'package.json'], { name: 'electron-workspace', private: true })
    assert.equal(nestedElectronIcon, join(electronWorkspaceRoot, 'electron', 'build', 'icon.png'), 'top-level Electron app icons should represent a real workspace root')

    await mkdir(join(ordinaryFolderRoot, 'desktop', 'resources'), { recursive: true })
    await writeFile(join(ordinaryFolderRoot, 'desktop', 'resources', 'icon.png'), 'nested icon')
    const ordinaryFolderIcon = await resolveProjectIconPath(ordinaryFolderRoot, ['desktop'], null)
    assert.equal(ordinaryFolderIcon, null, 'ordinary folders cannot inherit icons from nested app-like directory names')

    assert.equal(isGenericUserFolderPath('C:\\Users\\person'), true, 'a Windows user home is a generic folder')
    assert.equal(isGenericUserFolderPath('C:\\Users\\person\\Desktop'), true, 'a Windows Desktop is a generic folder')
    assert.equal(isGenericUserFolderPath('C:\\Users\\person\\Desktop\\real-project'), false, 'a project inside Desktop remains eligible for project identity')
    assert.equal(isGenericUserFolderPath('/home/person'), true, 'a POSIX user home is a generic folder')

    const sharedProjectIconSource = await readFile(new URL('../src/renderer/src/pages/assistant/AssistantProjectIcon.tsx', import.meta.url), 'utf8')
    const railUtilsSource = await readFile(new URL('../src/renderer/src/pages/assistant/assistant-sessions-rail-utils.ts', import.meta.url), 'utf8')
    const chatRailSource = await readFile(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
    const agentInboxSource = await readFile(new URL('../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx', import.meta.url), 'utf8')
    const conversationHeaderSource = await readFile(new URL('../src/renderer/src/pages/assistant/AssistantConversationHeader.tsx', import.meta.url), 'utf8')
    const projectChipSource = await readFile(new URL('../src/renderer/src/pages/assistant/AssistantNewChatProjectChip.tsx', import.meta.url), 'utf8')
    assert.match(sharedProjectIconSource, /hydrateProjectMetadataForPaths\(\[normalizedPath\]\)/, 'mounted project marks should hydrate manifest and framework metadata on demand')
    assert.match(sharedProjectIconSource, /resolvedIconPath[\s\S]{0,180}resolvedFramework[\s\S]{0,180}meaningfulProjectType/, 'project marks should prefer discovered icons before branded and folder fallbacks')
    assert.match(railUtilsSource, /isGenericUserFolderPath/, 'assistant project presentation should preserve ordinary home and shell folders as folders')
    assert.match(chatRailSource, /<AssistantProjectIcon[\s\S]{0,220}projectIconPath=\{group\.projectIconPath\}/, 'the standard chat sidebar should render discovered project identity')
    assert.match(agentInboxSource, /<AssistantProjectIcon[\s\S]{0,220}projectIconPath=\{group\.projectIconPath\}/, 'Agent Inbox should render the same project identity')
    assert.match(conversationHeaderSource, /<AssistantProjectIcon projectPath=\{selectedProjectPath\} size=\{12\}/, 'the chat header should render the active project identity')
    assert.match(projectChipSource, /<AssistantProjectIcon projectPath=\{project\.iconSourcePath\} size=\{13\}/, 'the new-chat project picker should render project identity per choice')

    console.log('Project icon resolver: ok')
} finally {
    await rm(fixtureRoot, { recursive: true, force: true })
}
