import assert from 'node:assert/strict'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantModelInfo } from '../src/shared/assistant/contracts'
import { ComposerFooterControls } from '../src/renderer/src/pages/assistant/AssistantComposerSections'
import {
    useAssistantComposerDerivedOptions,
    useAssistantComposerSessionDefaults
} from '../src/renderer/src/pages/assistant/assistant-composer-controller-derived'

const settings = {
    assistantDefaultModel: '',
    assistantDefaultPromptTemplate: '',
    assistantDefaultRuntimeMode: 'approval-required' as const,
    assistantDefaultEffort: 'medium' as const,
    assistantDefaultFastMode: false,
    gitPullRequestDefaultTargetBranch: 'main'
}
const model = (id: string): AssistantModelInfo => ({ id, label: id.split('/').pop()! })

// Render the actual composer hooks so the test covers catalog preparation,
// badge selection and search together, not a replacement sorting algorithm.
function inspectCatalog(models: AssistantModelInfo[], activeModel = '', modelQuery = '') {
    let result!: ReturnType<typeof useAssistantComposerDerivedOptions> & {
        availableModelOptions: AssistantModelInfo[]
        resolvedModel: string
    }
    function Probe() {
        const defaults = useAssistantComposerSessionDefaults({
            settings, activeModel, modelOptions: models, useSettingsDefaults: false
        })
        const derived = useAssistantComposerDerivedOptions({
            text: '', composerCursor: 0, inlineMentionTags: [], projectNodes: [],
            mentionChangedStateByPath: {}, mentionRecentModifiedAtByPath: {},
            modelQuery, availableModelOptions: defaults.availableModelOptions,
            branchQuery: '', branches: [], activeMentionIndex: 0, activeModelIndex: 0,
            activeBranchIndex: 0, selectedModel: activeModel,
            selectedRuntimeMode: 'approval-required', baseRuntimeMode: 'approval-required',
            settings, isSwitchingBranch: false, branchesLoading: false
        })
        result = { ...defaults, ...derived }
        return null
    }
    renderToStaticMarkup(createElement(Probe))
    return result
}

const sol = model('openai-codex/gpt-5.6-sol')
const astra = model('openai-codex/gpt-6-astra')
const next = model('openai-codex/gpt-7-example')
const oldSelection = sol.id
const released = inspectCatalog([sol, astra], oldSelection)
assert.equal(released.latestModelId, astra.id, 'Astra replaces Sol as Latest when present in the catalog')
assert.equal(released.filteredModelOptions[0]?.id, astra.id)
assert.equal(released.resolvedModel, oldSelection, 'new releases must not switch the selected model')
assert.equal(released.selectedModelLabel, sol.label)
assert.equal(inspectCatalog([next, sol, astra]).latestModelId, next.id, 'future major releases need no code change')
assert.equal(inspectCatalog([sol]).latestModelId, sol.id, 'older catalogs remain usable')
assert.deepEqual(inspectCatalog([astra]).availableModelOptions, [astra], 'the UI must not invent a Sol option')
assert.deepEqual(inspectCatalog([]).availableModelOptions, [], 'an empty catalog stays empty')
assert.equal(inspectCatalog([]).latestModelId, null)
assert.equal(inspectCatalog([model('custom/my-model')]).latestModelId, null, 'unknown releases must not receive a speculative Latest badge')
const search = inspectCatalog([sol, astra], oldSelection, 'sol')
assert.deepEqual(search.filteredModelOptions, [sol])
assert.equal(search.latestModelId, astra.id, 'search must not relabel an older result Latest')
assert.equal(inspectCatalog([sol, astra, next], oldSelection).resolvedModel, oldSelection)
assert.equal(inspectCatalog([sol, astra], oldSelection).latestModelId, astra.id, 'a refreshed catalog can remove the previous Latest')
assert.deepEqual(inspectCatalog([], astra.id).availableModelOptions, [{ id: astra.id, label: astra.id }], 'keep the existing selected-model fallback while loading')

function renderMenu(catalog: ReturnType<typeof inspectCatalog>, compact: boolean) {
    const noop = () => {}
    return renderToStaticMarkup(createElement(ComposerFooterControls, {
        isCompactFooter: compact, placement: compact ? 'center' : 'bottom',
        modelDropdownRef: createRef<HTMLDivElement>(), showModelDropdown: true,
        setShowModelDropdown: noop, modelsLoading: false, modelsError: null,
        modelQuery: '', setModelQuery: noop, setActiveModelIndex: noop,
        modelListRef: createRef<HTMLDivElement>(), filteredModelOptions: catalog.filteredModelOptions,
        activeModelIndex: 0, selectedModel: oldSelection, selectedModelLabel: sol.label,
        latestModelId: catalog.latestModelId, setSelectedModel: noop,
        traitsDropdownRef: createRef<HTMLDivElement>(), showTraitsDropdown: true,
        setShowTraitsDropdown: noop, EFFORT_OPTIONS: ['medium', 'high'],
        selectedEffort: 'medium', setSelectedEffort: noop,
        EFFORT_LABELS: { medium: 'Medium', high: 'High' },
        fastModeEnabled: false, setFastModeEnabled: noop,
        selectedRuntimeMode: 'approval-required', setSelectedRuntimeMode: noop,
        selectedInteractionMode: 'default', setSelectedInteractionMode: noop,
        displayedProfile: 'Default'
    }))
}
for (const compact of [false, true]) {
    const markup = renderMenu(released, compact)
    const rows = [...markup.matchAll(/<button\b[^>]*data-model-index[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0])
    assert.equal(rows.length, 2, 'both existing picker layouts render the catalog')
    const latestRows = rows.filter((row) => row.includes('Latest'))
    assert.equal(latestRows.length, 1)
    assert.match(latestRows[0]!, /astra/i, 'the rendered Latest badge belongs to Astra')
    const filteredMarkup = renderMenu(search, compact)
    assert.doesNotMatch(filteredMarkup, />Latest</, 'filtered-out Astra must not transfer its badge to Sol')
    assert.match(renderMenu(inspectCatalog([]), compact), /No models found/, 'empty catalogs render the real empty state')
}
console.log('Assistant model catalog contracts passed')
