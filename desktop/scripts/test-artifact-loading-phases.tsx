import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactCreationState } from '../src/renderer/src/components/ui/ArtifactCreationState'

for (const kind of ['diagram', 'visualization'] as const) {
    for (const phase of ['creating', 'loading'] as const) {
        const html = renderToStaticMarkup(createElement(ArtifactCreationState, { kind, phase }))
        assert(html.includes(`aria-label="${phase === 'creating' ? 'Creating' : 'Loading'} ${kind}"`))
        assert(html.includes(`data-artifact-phase="${phase}"`))
        assert.equal(html.includes('data-artifact-creating='), phase === 'creating')
        assert(html.includes('creation-text') && html.includes('creation-dots'), 'both phases share shimmer and fixed-width dots')
    }
}
console.log('PASS: creating/loading phases stay distinct for diagrams and visualizations, with shared motion')
