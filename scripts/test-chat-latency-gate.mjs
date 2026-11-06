import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { assertOutsideProfile } from './response-latency/project.mjs';

const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-latency-gate-'));
try {
  const profile = path.join(directory, 'preview'); mkdirSync(path.join(profile, 'setup'), { recursive: true });
  writeFileSync(path.join(profile, 'setup/device-preferences.json'), JSON.stringify({ shared: {
    assistantDefaultEffort: 'high', assistantReasoningSummary: 'detailed', assistantProductProfile: 'concise',
    assistantDefaultRuntimeMode: 'approval-required', assistantDefaultWebSearch: true, assistantDefaultWebFetch: true,
    assistantMemoryEnabled: false, assistantDefaultFastMode: false,
  } }));
  const output = path.join(directory, 'output');
  const args = [path.join(import.meta.dirname, 'benchmark-chat-latency.mjs'), '--profile', profile,
    '--runtime-root', path.join(directory, 'absent-runtime'), '--output', output];
  const dry = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).creditsEnabled, false);
  assert.equal(existsSync(output), false, 'dry run neither loads a runtime nor creates server/project files');
  const unsafe = spawnSync(process.execPath, [...args.slice(0, -1), path.join(profile, 'output'), '--live'], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(unsafe.status, 0);
  assert.equal(existsSync(path.join(profile, 'output')), false);
  const excessive = spawnSync(process.execPath, [...args, '--samples', '11', '--live'], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(excessive.status, 0);
  assert.equal(existsSync(output), false);
  const instructions = path.join(directory, 'instruction-parent');
  mkdirSync(instructions);
  writeFileSync(path.join(instructions, 'AGENTS.md'), 'PRIVATE_INSTRUCTION_FIXTURE');
  const inherited = spawnSync(process.execPath, [...args, '--project', path.join(instructions, 'project'), '--live'], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(inherited.status, 0);
  assert.match(inherited.stderr, /inherited instructions/);
  assert.equal((inherited.stdout + inherited.stderr).includes('PRIVATE_INSTRUCTION_FIXTURE'), false);
  assert.equal(existsSync(output), false, 'instruction ancestry is rejected before creating output or importing a runtime');
  const profileAlias = path.join(directory, 'profile-alias');
  symlinkSync(profile, profileAlias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertOutsideProfile(path.join(profileAlias, 'output'), profile), /outside the Preview profile/,
    'resolved aliases cannot place benchmark state inside the real profile');
  console.log('Chat latency CLI defaults to no calls and rejects profile-owned output or excessive sample counts before runtime loading.');
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('zyra-latency-gate-'));
  rmSync(directory, { recursive: true, force: true });
}
