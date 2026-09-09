import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolateBridgeEnvironment } from './fixtures/agent-server-bridge-env.mjs';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'zyra-slash-suggestions-'));
const isolation = isolateBridgeEnvironment(temporary);
process.env.ZYRA_ROOT = temporary;
try {
  const { getSlashSuggestions, applySlashSuggestion } = await import('../src/slash-suggestions.mjs');
  const { ACCESS_MODES } = await import('../src/slash-commands.mjs');
  const models = [
    { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
    { provider: 'openai-codex', id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  ];
  const runtime = { project: temporary, session: { model: models[0], modelRegistry: { getAvailable: () => models } } };
  const suggestions = getSlashSuggestions(runtime, '/models ');
  assert.ok(suggestions.length >= 2);
  for (const item of suggestions) {
    const selected = applySlashSuggestion('/models ', item);
    assert.equal(typeof selected, 'string', 'applying a picker selection always returns editor text');
    assert.equal(selected, item.kind === 'custom-model' ? '/models ' : `/models ${item.value}`);
  }
  for (const command of ['/access ', '/permissions ']) {
    const options = getSlashSuggestions(runtime, command);
    assert.deepEqual(options.map(item => item.value), [...ACCESS_MODES]);
    for (const item of options) assert.equal(applySlashSuggestion(command, item), command + item.value);
    const filtered = getSlashSuggestions(runtime, command + 'sup');
    assert.deepEqual(filtered.map(item => item.value), ['supervised']);
  }
  for (const [text, item, expected] of [
    ['/thinking ', { kind: 'argument', value: 'medium' }, '/thinking medium'],
    ['/profile ', { kind: 'argument', value: 'builder' }, '/profile builder'],
    ['/mode ', { kind: 'argument', value: 'fast' }, '/mode fast'],
    ['/themes ', { kind: 'theme', value: 'vivid' }, '/themes vivid'],
    ['/theme ', { kind: 'theme', value: 'vivid' }, '/theme vivid'],
    ['/skill', { kind: 'skill', value: '/skill:review' }, '/skill:review '],
    ['/model', { kind: 'command', value: '/models', submitOnEnter: false }, '/models '],
    ['/quit', { kind: 'command', value: '/quit', submitOnEnter: true }, '/quit'],
    ['/agent ', { kind: 'agent-definition', value: 'reviewer' }, '/agent reviewer '],
    ['/workflow ', { kind: 'workflow-definition', value: 'check' }, '/workflow check '],
    ['Ask @agent-re', { kind: 'agent-mention', value: '@agent-reviewer' }, 'Ask @agent-reviewer'],
  ]) assert.equal(applySlashSuggestion(text, item), expected);
  assert.equal(applySlashSuggestion('/models ', null), '/models ');
  isolation.assertOffline();
  console.log('Slash picker selection: fresh model list, permission aliases, themes, Skills and commands: ok');
} finally {
  isolation.restore();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
