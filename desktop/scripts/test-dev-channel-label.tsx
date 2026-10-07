import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { DevChannelLabel } from '../src/renderer/src/components/layout/DevChannelLabel'

assert.match(renderToStaticMarkup(<DevChannelLabel dev />), /Dev channel/)
assert.equal(renderToStaticMarkup(<DevChannelLabel dev={false} />), '')
const chrome = readFileSync(new URL('../src/renderer/src/onboarding/OnboardingChrome.tsx', import.meta.url), 'utf8')
const welcome = readFileSync(new URL('../src/renderer/src/onboarding/OnboardingSteps.tsx', import.meta.url), 'utf8')
assert.match(chrome, /<DevChannelLabel/)
assert.match(welcome, /You’re setting up the Dev channel/)
assert.match(welcome, /import\.meta\.env\.DEV \|\| isPreviewDistribution\(\)/)
console.log('Dev setup label uses distribution identity and stable remains unlabelled: ok')
