#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repo = path.resolve(readArg('--repo') || scriptRoot)
const runId = normalizeRunId(readArg('--run-id') || buildRunId())
const runDir = path.resolve(readArg('--run-dir') || path.join(os.tmpdir(), 'zyra-autonomous-runs', runId))
const worktreeRoot = path.join(repo, '.zyra-worktrees', runId)
const token = randomBytes(32).toString('base64url')
const originalHead = git(['rev-parse', 'HEAD']).trim()
const originalBranch = git(['branch', '--show-current']).trim() || 'detached'
const baselineBranch = `automation/${runId}-baseline`
const fleetBranch = `feature/${runId}-subagents-workflows`
const controlBranch = `feature/${runId}-browser-computer-use`
const integrationBranch = `integration/${runId}-agent-platform`

const worktrees = {
  fleet: path.join(worktreeRoot, 'subagents-workflows'),
  control: path.join(worktreeRoot, 'browser-computer-use'),
  integration: path.join(worktreeRoot, 'integration'),
}

const branches = {
  baseline: baselineBranch,
  fleet: fleetBranch,
  control: controlBranch,
  integration: integrationBranch,
}

for (const branch of Object.values(branches)) {
  if (branchExists(branch)) fail(`Branch already exists: ${branch}`)
}
for (const target of Object.values(worktrees)) {
  if (existsSync(target)) fail(`Worktree path already exists: ${target}`)
}

for (const required of [
  'docs/implementations/subagents-workflows.md',
  'docs/implementations/browser-computer-use.md',
  'docs/runbooks/parallel-agent-build.md',
  'scripts/automation/prompts/subagents-workflows-builder.md',
  'scripts/automation/prompts/browser-computer-use-builder.md',
  'scripts/automation/prompts/agent-platform-integrator.md',
  'scripts/automation/run-autonomous-builder.mjs',
  'scripts/automation/parallel-agent-coordinator.mjs',
]) {
  if (!existsSync(path.join(repo, required))) fail(`Required dispatch file is missing: ${required}`)
}

mkdirSync(runDir, { recursive: true })
mkdirSync(worktreeRoot, { recursive: true })

const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'zyra-automation-index-'))
const tempIndex = path.join(tempDirectory, 'index')
const sourceIndex = resolveGitPath(git(['rev-parse', '--git-path', 'index']).trim())
if (existsSync(sourceIndex)) copyFileSync(sourceIndex, tempIndex)

const indexEnv = {
  ...process.env,
  GIT_INDEX_FILE: tempIndex,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || safeGitConfig('user.name') || 'Zyra Automation',
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || safeGitConfig('user.email') || 'zyra-automation@local.invalid',
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || safeGitConfig('user.name') || 'Zyra Automation',
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || safeGitConfig('user.email') || 'zyra-automation@local.invalid',
}

try {
  git(['add', '-u', '--', '.'], { env: indexEnv })
  const untrackedFiles = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(isSafeUntrackedSnapshotPath)
  for (let index = 0; index < untrackedFiles.length; index += 100) {
    git(['add', '--', ...untrackedFiles.slice(index, index + 100)], { env: indexEnv })
  }

  const stagedFiles = git(['diff', '--cached', '--name-only', '-z'], { env: indexEnv })
    .split('\0')
    .filter(Boolean)
  validateSnapshotPaths(stagedFiles)
  scanChangedSnapshotText(stagedFiles, indexEnv)

  const tree = git(['write-tree'], { env: indexEnv }).trim()
  const message = [
    `chore: snapshot Zyra for autonomous agent run ${runId}`,
    '',
    `Source branch: ${originalBranch}`,
    `Source HEAD: ${originalHead}`,
    'Created with a temporary index; the source branch and source index were not changed.',
  ].join('\n')
  const baselineCommit = git(['commit-tree', tree, '-p', originalHead], { env: indexEnv, input: message }).trim()

  git(['branch', baselineBranch, baselineCommit])
  git(['branch', fleetBranch, baselineCommit])
  git(['branch', controlBranch, baselineCommit])
  git(['branch', integrationBranch, baselineCommit])

  git(['worktree', 'add', worktrees.fleet, fleetBranch])
  git(['worktree', 'add', worktrees.control, controlBranch])
  git(['worktree', 'add', worktrees.integration, integrationBranch])

  const config = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    launcherRoot: repo,
    source: {
      branch: originalBranch,
      head: originalHead,
    },
    baseline: {
      branch: baselineBranch,
      commit: baselineCommit,
      stagedFileCount: stagedFiles.length,
    },
    branches,
    worktrees,
    runDir,
    coordinator: {
      token,
      host: '127.0.0.1',
      serverFile: path.join(runDir, 'coordinator.json'),
      stateFile: path.join(runDir, 'state.json'),
    },
    model: 'openai-codex/gpt-5.6-sol',
    thinking: 'xhigh',
    maxBuilderAttempts: 3,
    maxIntegratorAttempts: 3,
    agents: {
      fleet: {
        label: 'Subagents + Workflows',
        branch: fleetBranch,
        worktree: worktrees.fleet,
        promptFile: 'scripts/automation/prompts/subagents-workflows-builder.md',
        planFile: 'docs/implementations/subagents-workflows.md',
        handoffFile: 'docs/automation/handoffs/subagents-workflows.md',
        successMarker: 'READY_FOR_MERGE',
      },
      control: {
        label: 'Browser + Computer Use',
        branch: controlBranch,
        worktree: worktrees.control,
        promptFile: 'scripts/automation/prompts/browser-computer-use-builder.md',
        planFile: 'docs/implementations/browser-computer-use.md',
        handoffFile: 'docs/automation/handoffs/browser-computer-use.md',
        successMarker: 'READY_FOR_MERGE',
      },
      integration: {
        label: 'Agent Platform Integration',
        branch: integrationBranch,
        worktree: worktrees.integration,
        promptFile: 'scripts/automation/prompts/agent-platform-integrator.md',
        handoffFile: 'docs/automation/handoffs/agent-platform-integration.md',
        successMarker: 'READY_FOR_RELEASE_CHECK',
      },
    },
  }

  const configPath = path.join(runDir, 'run-config.json')
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  writeCommandFiles(config, configPath)
  runSnapshotPrivacyCheck(config, stagedFiles)

  console.log(JSON.stringify({
    success: true,
    runId,
    configPath,
    runDir,
    baselineCommit,
    branches,
    worktrees,
    stagedFileCount: stagedFiles.length,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
} finally {
  rmSync(tempDirectory, { recursive: true, force: true })
}

function writeCommandFiles(config, configPath) {
  const commands = {
    coordinator: [
      '@echo off',
      `title Zyra Merge Coordinator - ${config.runId}`,
      `cd /d "${config.worktrees.integration}"`,
      `node "${path.join(repo, 'scripts/automation/parallel-agent-coordinator.mjs')}" --config "${configPath}"`,
      'echo.',
      'echo Coordinator exited. Review the output above.',
    ],
    fleet: [
      '@echo off',
      `title Zyra Builder A - ${config.runId}`,
      `cd /d "${config.worktrees.fleet}"`,
      `node "${path.join(repo, 'scripts/automation/run-autonomous-builder.mjs')}" --config "${configPath}" --agent fleet`,
      'echo.',
      'echo Builder A exited. Review the output above.',
    ],
    control: [
      '@echo off',
      `title Zyra Builder B - ${config.runId}`,
      `cd /d "${config.worktrees.control}"`,
      `node "${path.join(repo, 'scripts/automation/run-autonomous-builder.mjs')}" --config "${configPath}" --agent control`,
      'echo.',
      'echo Builder B exited. Review the output above.',
    ],
  }
  for (const [name, lines] of Object.entries(commands)) {
    writeFileSync(path.join(runDir, `${name}.cmd`), `${lines.join('\r\n')}\r\n`)
  }
}

function runSnapshotPrivacyCheck(config, stagedFiles) {
  const result = spawnSync(process.execPath, ['scripts/privacy-check.mjs'], {
    cwd: config.worktrees.integration,
    encoding: 'utf8',
    windowsHide: true,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  writeFileSync(path.join(runDir, 'snapshot-privacy-check.txt'), output)
  if (result.status === 0) return

  const changed = new Set(stagedFiles.map(normalizeGitPath))
  const introducedFindings = output
    .split(/\r?\n/)
    .map((line) => /^(.+?):\d+\s+\[/.exec(line)?.[1])
    .filter(Boolean)
    .map(normalizeGitPath)
    .filter((file) => changed.has(file))

  if (introducedFindings.length > 0) {
    fail(`Snapshot privacy check found references in changed files: ${[...new Set(introducedFindings)].join(', ')}`)
  }
  writeFileSync(
    path.join(runDir, 'snapshot-privacy-note.txt'),
    'The privacy check reported only pre-existing tracked findings outside this snapshot delta. Builders and integrator must preserve or improve that baseline.\n',
  )
}

function isSafeUntrackedSnapshotPath(file) {
  const normalized = normalizeGitPath(file)
  const excluded = [
    /(?:^|\/)\.zyra(?:\/|$)/i,
    /(?:^|\/)\.zyra-worktrees(?:\/|$)/i,
    /(?:^|\/)node_modules(?:\/|$)/i,
    /(?:^|\/)\.env(?:\.|$)/i,
    /(?:^|\/)(?:NUL|nul)$/,
    /electron\.vite\.config\.\d+\.mjs$/i,
    /CODEX_CHAT_GOAL\.md$/i,
    /\.(?:log|sqlite|sqlite-shm|sqlite-wal)$/i,
  ]
  return !excluded.some((pattern) => pattern.test(normalized))
}

function validateSnapshotPaths(files) {
  const forbidden = [
    /(?:^|\/)\.zyra(?:\/|$)/i,
    /(?:^|\/)node_modules(?:\/|$)/i,
    /(?:^|\/)\.env(?:\.|$)/i,
    /(?:^|\/)(?:NUL|nul)$/,
    /electron\.vite\.config\.\d+\.mjs$/i,
    /CODEX_CHAT_GOAL\.md$/i,
  ]
  const invalid = files.filter((file) => forbidden.some((pattern) => pattern.test(file)))
  if (invalid.length > 0) fail(`Unsafe paths entered the snapshot: ${invalid.join(', ')}`)
}

function scanChangedSnapshotText(files, env) {
  const textExtensions = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.html', '.css', '.scss', '.yml', '.yaml', '.toml', '.txt', '.ps1', '.cmd', '.sh', '.cs', '.csproj', '.sln', '.xml',
  ])
  const findings = []
  const localUsername = escapeRegExp(os.userInfo().username)
  const secretPatterns = [
    ...(localUsername ? [{ label: 'private Windows user path', pattern: new RegExp(`C:[\\\\/]Users[\\\\/]${localUsername}(?:[\\\\/]|$)`, 'i') }] : []),
    { label: 'private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { label: 'OAuth callback secret', pattern: /localhost:\d+\/auth\/callback\?[^\s"']*(?:code|state)=/i },
    { label: 'literal API key assignment', pattern: /(?:OPENAI_API_KEY|API_KEY|ACCESS_TOKEN)\s*[=:]\s*["'][^"']{12,}["']/i },
  ]
  for (const file of files) {
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue
    if (!git(['ls-files', '--stage', '--', file], { env }).trim()) continue
    let text
    try {
      text = git(['show', `:${file}`], { env, maxBuffer: 16 * 1024 * 1024 })
    } catch {
      continue
    }
    for (const item of secretPatterns) {
      if (item.pattern.test(text)) findings.push(`${file} (${item.label})`)
    }
  }
  if (findings.length > 0) fail(`Snapshot safety scan failed: ${findings.join(', ')}`)
}

function branchExists(branch) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repo }).status === 0
}

function safeGitConfig(key) {
  try {
    return git(['config', '--get', key]).trim()
  } catch {
    return ''
  }
}

function resolveGitPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(repo, value)
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    env: options.env || process.env,
    input: options.input,
    windowsHide: true,
  })
}

function normalizeGitPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function normalizeRunId(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!normalized) fail('Run ID is empty.')
  return normalized.slice(0, 80)
}

function buildRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z').replace('T', '-')
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fail(message) {
  throw new Error(message)
}
