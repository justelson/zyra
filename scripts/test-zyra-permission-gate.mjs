import assert from 'node:assert/strict';
import path from 'node:path';
import { createZyraPermissionGateExtension, describeZyraToolPermission, isDefinitelyCriticalZyraToolPermission, isPotentiallyCriticalZyraToolPermission } from '../src/zyra-permission-gate.mjs';

function toolHandler(options) {
  const extension = createZyraPermissionGateExtension({ project: process.cwd(), ...options });
  return extension.handlers.get('tool_call')[0];
}

assert.equal(describeZyraToolPermission({ toolName: 'read', input: { path: 'README.md' } }), null, 'read-only tools should not prompt');
assert.equal(describeZyraToolPermission({ toolName: 'browser_control', input: {} }), null, 'browser control keeps its dedicated capability broker');
assert.equal(describeZyraToolPermission({ toolName: 'bash', input: { command: 'npm test' } }).requestType, 'command');
assert.deepEqual(describeZyraToolPermission({ toolName: 'write', input: { path: 'src/a.ts' } }).paths, ['src/a.ts']);

const scopedHome = path.resolve('fixture-project-home');
const scopedWritable = path.resolve('fixture-associated-writable');
const scopedReadOnly = path.resolve('fixture-associated-read-only');
const filesystemScope = {
  roots: [
    { path: scopedHome, access: 'read-write' },
    { path: scopedWritable, access: 'read-write' },
    { path: scopedReadOnly, access: 'read-only' },
  ],
};
assert.equal(describeZyraToolPermission(
  { toolName: 'read', input: { path: path.join(scopedWritable, 'README.md') } },
  { project: scopedHome, filesystemScope },
), null, 'safe reads inside any scoped Project root should proceed');
assert.equal(describeZyraToolPermission(
  { toolName: 'edit', input: { path: path.join(scopedReadOnly, 'notes.md') } },
  { project: scopedHome, filesystemScope },
).readOnlyViolation, true, 'read-only Associated folders impose a hard write ceiling');
let scopeBypassRequests = 0;
const scopedFullAccess = toolHandler({
  project: scopedHome,
  filesystemScope,
  getPermissionMode: () => 'full-access',
  requestPermission: async () => { scopeBypassRequests += 1; return 'acceptOnce'; },
});
assert.match(
  (await scopedFullAccess({ toolName: 'write', input: { path: path.join(scopedReadOnly, 'notes.md') } })).reason,
  /read-only Project folder/i,
);
assert.match(
  (await scopedFullAccess({ toolName: 'read', input: { path: path.resolve('outside-scope', 'secret.txt') } })).reason,
  /outside this chat's filesystem scope/i,
);
assert.match(
  (await scopedFullAccess({ toolName: 'bash', input: { command: `type "${path.resolve('outside-scope', 'secret.txt')}"` } })).reason,
  /outside this chat's filesystem scope/i,
  'shell commands with explicit out-of-scope paths are blocked before permission review',
);
assert.match(
  (await scopedFullAccess({ toolName: 'bash', input: { command: `node tools/update.mjs "${scopedReadOnly}"` } })).reason,
  /read-only Project folder/i,
  'non-read-only shell commands cannot target a read-only association',
);
const readOnlyWorkingRoot = toolHandler({
  project: scopedReadOnly,
  filesystemScope,
  getPermissionMode: () => 'full-access',
  requestPermission: async () => { scopeBypassRequests += 1; return 'acceptOnce'; },
});
assert.equal(
  await readOnlyWorkingRoot({ toolName: 'bash', input: { command: 'git status --short' } }),
  undefined,
  'conservatively read-only commands may run from a read-only working root',
);
assert.match(
  (await readOnlyWorkingRoot({ toolName: 'bash', input: { command: 'npm test' } })).reason,
  /read-only Project folder/i,
  'commands that may write are blocked from a read-only working root',
);
assert.match(
  (await readOnlyWorkingRoot({ toolName: 'bash', input: { command: 'git status && node tools/update.mjs' } })).reason,
  /read-only Project folder/i,
  'compound shell commands are not treated as conservatively read only',
);
assert.equal(scopeBypassRequests, 0, 'permission modes and approval cannot expand a revisioned Chat scope');

let onceRequests = 0;
const allowOnce = toolHandler({
  getPermissionMode: () => 'approval-required',
  requestPermission: async () => { onceRequests += 1; return 'acceptOnce'; },
});
assert.equal(await allowOnce({ toolName: 'bash', input: { command: 'npm test' } }), undefined);
assert.equal(onceRequests, 1);

let declinedRequests = 0;
const decline = toolHandler({
  getPermissionMode: () => 'approval-required',
  requestPermission: async () => { declinedRequests += 1; return 'decline'; },
});
assert.equal((await decline({ toolName: 'edit', input: { path: 'src/a.ts' } })).block, true);
assert.equal(declinedRequests, 1);

let sessionRequests = 0;
const allowForSession = toolHandler({
  getPermissionMode: () => 'approval-required',
  requestPermission: async () => { sessionRequests += 1; return 'acceptForSession'; },
});
assert.equal(await allowForSession({ toolName: 'write', input: { path: 'src/a.ts' } }), undefined);
assert.equal(await allowForSession({ toolName: 'write', input: { path: 'src/b.ts' } }), undefined);
assert.equal(sessionRequests, 1, 'session grants should be bounded to the same tool, request type, and project');

let editsOnlyRequests = 0;
const editsOnly = toolHandler({
  getPermissionMode: () => 'edits-only',
  requestPermission: async () => { editsOnlyRequests += 1; return 'acceptOnce'; },
});
assert.equal(await editsOnly({ toolName: 'edit', input: { path: 'src/a.ts' } }), undefined);
assert.equal(editsOnlyRequests, 0, 'edits only should allow non-destructive project file edits');
assert.equal(await editsOnly({ toolName: 'bash', input: { command: 'npm test' } }), undefined);
assert.equal(editsOnlyRequests, 1, 'edits only should ask before commands');
assert.equal(await editsOnly({ toolName: 'write', input: { path: '../outside.txt' } }), undefined);
assert.equal(editsOnlyRequests, 2, 'edits only should ask before out-of-project edits');

let autoReviewCalls = 0;
let autoReviewRequests = 0;
const autoReview = toolHandler({
  getPermissionMode: () => 'auto-review',
  reviewPermission: async () => { autoReviewCalls += 1; return { decision: 'approve', reason: 'Routine reversible work.' }; },
  requestPermission: async () => { autoReviewRequests += 1; return 'acceptOnce'; },
});
assert.equal(await autoReview({ toolName: 'bash', input: { command: 'npm test' } }), undefined);
assert.equal(autoReviewCalls, 1, 'auto review should review routine actions');
assert.equal(autoReviewRequests, 0, 'an approved automatic review should not interrupt the user');
assert.equal(await autoReview({ toolName: 'bash', input: { command: 'git push origin main' } }), undefined);
assert.equal(autoReviewCalls, 1, 'automatic review cannot waive a definite critical boundary');
assert.equal(autoReviewRequests, 1, 'definite critical actions still ask in auto review');

let fullAccessRequests = 0;
const fullAccess = toolHandler({
  getPermissionMode: () => 'full-access',
  requestPermission: async () => { fullAccessRequests += 1; return 'decline'; },
});
assert.equal(await fullAccess({ toolName: 'bash', input: { command: 'npm test' } }), undefined);
assert.equal(fullAccessRequests, 0, 'full access should bypass approval requests');

assert.equal(isPotentiallyCriticalZyraToolPermission({ toolName: 'bash', command: 'npm test' }), false);
assert.equal(isDefinitelyCriticalZyraToolPermission({ toolName: 'bash', command: 'git push origin main' }), true);
assert.equal(isPotentiallyCriticalZyraToolPermission({ toolName: 'write', outsideProject: true }), true);

let reviewedRequests = 0;
const reviewedApproval = toolHandler({
  getPermissionMode: () => 'full-access',
  reviewPermission: async () => ({ decision: 'approve', reason: 'This only checks wording in a local script.' }),
  requestPermission: async () => { reviewedRequests += 1; return 'decline'; },
});
assert.equal(await reviewedApproval({ toolName: 'bash', input: { command: 'node scripts/check-publish-copy.mjs' } }), undefined);
assert.equal(reviewedRequests, 0, 'a reviewed false positive should not open a user prompt');

const reviewedDenial = toolHandler({
  getPermissionMode: () => 'full-access',
  reviewPermission: async () => ({ decision: 'deny', reason: 'This conflicts with the request.' }),
  requestPermission: async () => 'acceptOnce',
});
assert.deepEqual(
  await reviewedDenial({ toolName: 'bash', input: { command: 'node scripts/production-report.mjs' } }),
  { block: true, reason: 'This conflicts with the request.' },
);

let criticalRequests = 0;
let definiteReviewCalls = 0;
const criticalAsk = toolHandler({
  getPermissionMode: () => 'full-access',
  reviewPermission: async () => { definiteReviewCalls += 1; return { decision: 'approve' }; },
  requestPermission: async () => { criticalRequests += 1; return 'acceptOnce'; },
});
assert.equal(await criticalAsk({ toolName: 'bash', input: { command: 'terraform apply -auto-approve' } }), undefined);
assert.equal(criticalRequests, 1, 'definite critical actions should ask in chat');
assert.equal(definiteReviewCalls, 0, 'a model reviewer cannot waive a definite critical-action prompt');

let noReviewerRequests = 0;
const noReviewer = toolHandler({
  getPermissionMode: () => 'full-access',
  requestPermission: async () => { noReviewerRequests += 1; return 'acceptOnce'; },
});
assert.equal(await noReviewer({ toolName: 'delete', input: { path: 'data.db' } }), undefined);
assert.equal(noReviewerRequests, 1, 'critical actions must still ask when the reviewer is unavailable');

console.log('Zyra permission gate: ok');
