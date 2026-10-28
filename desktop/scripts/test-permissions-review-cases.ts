import assert from 'node:assert/strict'
import { CONTROL_CAPABILITIES } from '../src/shared/agent-control/contracts'
import { permissionReviewCases, reviewTargets, reviewPluginInspection, reviewApproval } from '../src/renderer/src/reviews/permissions-review-cases'

assert.equal(new Set(permissionReviewCases.map(entry => entry.id)).size, permissionReviewCases.length, 'Every review case has a unique stable identity')
assert.deepEqual(new Set(permissionReviewCases.filter(entry => entry.kind === 'tool').map(entry => reviewApproval(entry).requestType)), new Set(['command', 'file-read', 'file-change']))
const effects = ['send-or-publish', 'purchase', 'account-change', 'security-change', 'destructive-delete', 'file-upload', 'sensitive-data-submit', 'software-install', 'legal-acceptance']
for (const target of reviewTargets) {
    assert.deepEqual(new Set(permissionReviewCases.filter(entry => entry.kind === 'action' && entry.target === target.kind).map(entry => entry.sideEffect)), new Set(effects), `Every sensitive effect is represented for ${target.kind}`)
    for (const child of [false, true]) assert(permissionReviewCases.some(entry => entry.kind === 'grant' && entry.target === target.kind && entry.child === child), 'Root and child-agent grants are represented for every target kind')
}
assert.deepEqual(new Set(permissionReviewCases.flatMap(entry => entry.capabilities || [])), new Set(CONTROL_CAPABILITIES), 'Every control capability is represented')
for (const kind of ['terminal', 'lab', 'plugin', 'plugin-app', 'device', 'network', 'update', 'threat', 'account-reset', 'download-trust', 'external']) assert(permissionReviewCases.some(entry => entry.kind === kind), `Missing consent surface: ${kind}`)
for (const entry of permissionReviewCases.filter(entry => entry.kind === 'external')) assert(entry.note && entry.source, 'External/OS boundaries must explain their actual owner rather than pretending to be rendered')
assert(reviewPluginInspection('executable').release.containsExecutableFiles)
assert.equal(reviewPluginInspection('unsupported').release.contributions[0].support, 'unsupported')
console.log(`PASS: ${permissionReviewCases.length} cases; three tool request types, every target/effect/principal/capability, supplementary consent surfaces and explicit OS/external boundaries`)
