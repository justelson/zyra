import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertOutsideProfile } from './response-latency/project.mjs';

const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-latency-gate-'));
const scratchBase = process.platform === 'win32' ? path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'Temp') : os.tmpdir();
const scratch = mkdtempSync(path.join(scratchBase, 'zyra-latency-isolation-'));
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
  const personalHome = path.join(directory, 'personal-home');
  for (const segments of [['.zyra', 'skills'], ['.agents', 'skills'], ['.pi', 'agent', 'skills']]) {
    const skill = path.join(personalHome, ...segments, 'private-fixture'); mkdirSync(skill, { recursive: true });
    writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: private-fixture\ndescription: PRIVATE_SKILL_METADATA_FIXTURE\n---\nFixture only.');
  }
  const runtime = path.join(directory, 'probe-runtime');
  const builtin = path.join(runtime, 'skills', 'builtin-fixture'); mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'SKILL.md'), '---\nname: builtin-fixture\ndescription: BUILTIN_SKILL_METADATA_FIXTURE\n---\nFixture only.');
  const resourceModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/zyra-prompt-resources.mjs')).href;
  const skillsModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/runtime/engine/src/core/skills.js')).href;
  const authModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/zyra-auth-store.mjs')).href;
  const isolatedOutput = path.join(directory, 'isolated-output');
  const isolationCheck = `
    import assert from 'node:assert/strict';
    import { homedir } from 'node:os';
    import { resolveZyraSkillSources } from ${JSON.stringify(resourceModule)};
    import { loadSkillsFromDir, formatSkillsForPrompt } from ${JSON.stringify(skillsModule)};
    import { resolveZyraAuthPath } from ${JSON.stringify(authModule)};
    const sources = await resolveZyraSkillSources({ root: ${JSON.stringify(runtime)} });
    const skills = sources.flatMap(source => loadSkillsFromDir({ dir: source.dir, source: source.loaderSource }).skills);
    const prompt = formatSkillsForPrompt(skills);
    assert.equal(prompt.includes('PRIVATE_SKILL_METADATA_FIXTURE'), false, 'personal skills never enter the outgoing synthetic prompt');
    assert.ok(prompt.includes('BUILTIN_SKILL_METADATA_FIXTURE'), 'production built-in skills stay available');
    assert.equal(homedir(), ${JSON.stringify(path.join(isolatedOutput, 'home'))});
    assert.equal(resolveZyraAuthPath(), ${JSON.stringify(path.join(profile, 'assistant/agent-server/credentials/auth.json'))}, 'the explicitly selected credential owner remains outside the synthetic home');
  `;
  mkdirSync(path.join(runtime, 'src/agent-server'), { recursive: true });
  writeFileSync(path.join(runtime, 'src/agent-server/server.mjs'), `${isolationCheck}
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(isolationCheck)}], { stdio: 'pipe', windowsHide: true });
    console.log(JSON.stringify({ stage: 'synthetic-home-verified' }));
    process.exit(0);
  `);
  const isolated = spawnSync(process.execPath, [args[0], '--profile', profile, '--runtime-root', runtime,
    '--output', isolatedOutput, '--project', scratch, '--live'], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, HOME: personalHome, USERPROFILE: personalHome },
  });
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.match(isolated.stdout, /synthetic-home-verified/);
  assert.equal((isolated.stdout + isolated.stderr).includes('PRIVATE_SKILL_METADATA_FIXTURE'), false);
  const reused = spawnSync(process.execPath, [args[0], '--profile', profile, '--runtime-root', runtime,
    '--output', isolatedOutput, '--project', scratch, '--live'], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(reused.status, 0, 'a pre-existing synthetic home cannot silently reuse personal resources');
  assert.equal(reused.stdout.includes('synthetic-home-verified'), false, 'an existing home is rejected before runtime loading');
  console.log('Chat latency CLI defaults to no calls and rejects profile-owned output or excessive sample counts before runtime loading.');
} finally {
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(scratchBase));
  assert.ok(path.basename(scratch).startsWith('zyra-latency-isolation-'));
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('zyra-latency-gate-'));
  rmSync(directory, { recursive: true, force: true });
}
