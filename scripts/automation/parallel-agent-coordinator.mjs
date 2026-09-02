#!/usr/bin/env node
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const configPath = path.resolve(requiredArg('--config'))
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const expectedAgents = new Set(['fleet', 'control'])
const state = {
  version: 1,
  runId: config.runId,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  agents: {
    fleet: { state: 'waiting', label: config.agents.fleet.label, updatedAt: null },
    control: { state: 'waiting', label: config.agents.control.label, updatedAt: null },
  },
  integration: { state: 'waiting', updatedAt: null, attempt: 0 },
}
let integrationStarted = false
let lastHeartbeatPrint = new Map()

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/signal') {
      return json(response, 404, { success: false, error: 'Not found.' })
    }
    if (!authorized(request.headers.authorization)) {
      return json(response, 401, { success: false, error: 'Unauthorized.' })
    }
    const body = await readJsonBody(request, 32 * 1024)
    if (!expectedAgents.has(body.agent)) {
      return json(response, 400, { success: false, error: 'Unknown agent.' })
    }
    if (!['started', 'heartbeat', 'done', 'failed'].includes(body.state)) {
      return json(response, 400, { success: false, error: 'Unknown state.' })
    }

    const previous = state.agents[body.agent]
    const next = {
      ...previous,
      state: body.state,
      updatedAt: new Date().toISOString(),
      attempt: finiteNumber(body.attempt),
      pid: finiteNumber(body.pid),
      branch: boundedString(body.branch, 240),
      commit: boundedString(body.commit, 80),
      handoffFile: boundedString(body.handoffFile, 400),
      message: boundedString(body.message, 2_000),
    }
    state.agents[body.agent] = next
    state.updatedAt = next.updatedAt
    writeState()
    printSignal(body.agent, next)
    json(response, 200, { success: true })

    if (!integrationStarted && buildersReady()) {
      integrationStarted = true
      setImmediate(() => void launchIntegration())
    }
  } catch (error) {
    json(response, 400, { success: false, error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(0, config.coordinator.host || '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Coordinator did not bind a TCP port.')
  const descriptor = {
    version: 1,
    ready: true,
    runId: config.runId,
    host: config.coordinator.host || '127.0.0.1',
    port: address.port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }
  writeAtomic(config.coordinator.serverFile, `${JSON.stringify(descriptor, null, 2)}\n`)
  writeState()
  console.log('\nZyra autonomous merge coordinator')
  console.log(`Run: ${config.runId}`)
  console.log(`Baseline: ${config.baseline.commit}`)
  console.log(`Builder A: ${config.branches.fleet}`)
  console.log(`Builder B: ${config.branches.control}`)
  console.log(`Integration: ${config.branches.integration}`)
  console.log(`Listening: ${descriptor.host}:${descriptor.port}`)
  console.log('\nWaiting for both committed READY_FOR_MERGE handoffs...\n')
})

const staleTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, agent] of Object.entries(state.agents)) {
    if (!['started', 'heartbeat'].includes(agent.state) || !agent.updatedAt) continue
    const ageMs = now - Date.parse(agent.updatedAt)
    if (ageMs > 120_000 && !agent.stale) {
      agent.stale = true
      state.updatedAt = new Date().toISOString()
      console.warn(`${agent.label}: no heartbeat for ${Math.round(ageMs / 1_000)} seconds`)
      writeState()
    } else if (ageMs <= 120_000 && agent.stale) {
      agent.stale = false
      writeState()
    }
  }
}, 30_000)
staleTimer.unref?.()

async function launchIntegration() {
  console.log('\nBoth builders are READY_FOR_MERGE. Launching Integrator C in this tab.\n')
  state.integration = { state: 'starting', updatedAt: new Date().toISOString(), attempt: 0 }
  state.updatedAt = state.integration.updatedAt
  writeState()

  let lastValidation = null
  const maxAttempts = Math.max(1, Number(config.maxIntegratorAttempts || 3))
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    state.integration = { state: 'running', updatedAt: new Date().toISOString(), attempt }
    state.updatedAt = state.integration.updatedAt
    writeState()
    console.log(`\n=== Agent Platform Integrator: attempt ${attempt}/${maxAttempts} ===\n`)

    const prompt = buildIntegrationPrompt(attempt, lastValidation)
    const exitCode = await runIntegrator(prompt, attempt)
    lastValidation = validateIntegration(exitCode)

    if (lastValidation.ok) {
      state.integration = {
        state: 'done',
        updatedAt: new Date().toISOString(),
        attempt,
        commit: lastValidation.commit,
        handoffFile: config.agents.integration.handoffFile,
      }
      state.updatedAt = state.integration.updatedAt
      writeState()
      console.log('\n============================================================')
      console.log('Zyra agent platform integration is READY_FOR_RELEASE_CHECK')
      console.log(`Branch: ${config.branches.integration}`)
      console.log(`Commit: ${lastValidation.commit}`)
      console.log(`Handoff: ${config.agents.integration.handoffFile}`)
      console.log('The source branch and original dirty worktree were not changed.')
      console.log('============================================================\n')
      server.close()
      clearInterval(staleTimer)
      return
    }

    console.error(`\nIntegration attempt ${attempt} is incomplete:`)
    for (const reason of lastValidation.reasons) console.error(`- ${reason}`)
    state.integration = {
      state: 'retrying',
      updatedAt: new Date().toISOString(),
      attempt,
      message: lastValidation.reasons.join('; ').slice(0, 2_000),
    }
    state.updatedAt = state.integration.updatedAt
    writeState()
    if (attempt < maxAttempts) await sleep(12_000)
  }

  state.integration = {
    state: 'failed',
    updatedAt: new Date().toISOString(),
    attempt: maxAttempts,
    message: lastValidation?.reasons?.join('; ') || 'Integrator exhausted retries.',
  }
  state.updatedAt = state.integration.updatedAt
  writeState()
  console.error('\nIntegrator C exhausted retries. The integration worktree is preserved for recovery.\n')
  server.close()
  clearInterval(staleTimer)
}

function runIntegrator(prompt, attempt) {
  const cli = path.join(config.launcherRoot, 'bin', 'zyra.mjs')
  const args = [
    cli,
    '--project', config.worktrees.integration,
    '--model', config.model,
    '--thinking', config.thinking,
    '--no-onboarding',
    prompt,
  ]
  const child = spawn(process.execPath, args, {
    cwd: config.worktrees.integration,
    env: {
      ...process.env,
      ZYRA_AUTONOMOUS_RUN_ID: config.runId,
      ZYRA_AUTONOMOUS_ROLE: config.agents.integration.label,
      ZYRA_AUTONOMOUS_BRANCH: config.branches.integration,
      ZYRA_AUTONOMOUS_ATTEMPT: String(attempt),
      ZYRA_FLEET_BRANCH: config.branches.fleet,
      ZYRA_CONTROL_BRANCH: config.branches.control,
      ZYRA_BASELINE_COMMIT: config.baseline.commit,
    },
    stdio: 'inherit',
    windowsHide: false,
  })
  return new Promise((resolve) => {
    child.once('error', (error) => {
      console.error(`Failed to launch Integrator C: ${error.message}`)
      resolve(1)
    })
    child.once('exit', (code, signal) => {
      if (signal) console.error(`Integrator C exited by signal ${signal}`)
      resolve(code ?? 1)
    })
  })
}

function buildIntegrationPrompt(attempt, validation) {
  const brief = '@scripts/automation/prompts/agent-platform-integrator.md'
  const runbook = '@docs/runbooks/parallel-agent-build.md'
  const fleetPlan = '@docs/implementations/subagents-workflows.md'
  const controlPlan = '@docs/implementations/browser-computer-use.md'
  const common = [
    `Read and attach ${brief}, ${runbook}, ${fleetPlan}, and ${controlPlan} completely.`,
    `Run ID: ${config.runId}.`,
    `Baseline: ${config.baseline.commit}.`,
    `Builder A branch: ${config.branches.fleet}; read its handoff with git show ${config.branches.fleet}:${config.agents.fleet.handoffFile}.`,
    `Builder B branch: ${config.branches.control}; read its handoff with git show ${config.branches.control}:${config.agents.control.handoffFile}.`,
    `Integration branch: ${config.branches.integration}.`,
  ]
  if (attempt === 1) {
    return [...common,
      'Execute the complete semantic merge and integration now. Continue without routine questions.',
      `Write and commit ${config.agents.integration.handoffFile} ending with ${config.agents.integration.successMarker}.`,
    ].join(' ')
  }
  const reasons = validation?.reasons?.join('; ') || 'the previous integration attempt was incomplete'
  return [...common,
    `This is recovery attempt ${attempt}. The wrapper found: ${reasons}.`,
    'Inspect the existing merge state, commits, conflicts, tests, and handoff. Preserve completed work, resolve everything remaining, run the full combined verification, and commit a clean integration branch.',
    `Write and commit ${config.agents.integration.handoffFile} ending with ${config.agents.integration.successMarker}.`,
    'Do not stop for routine questions.',
  ].join(' ')
}

function validateIntegration(exitCode) {
  const reasons = []
  const cwd = config.worktrees.integration
  let commit = ''
  try {
    commit = git(cwd, ['rev-parse', 'HEAD']).trim()
  } catch (error) {
    reasons.push(`cannot resolve integration HEAD: ${error.message}`)
  }
  if (exitCode !== 0) reasons.push(`Integrator exited with code ${exitCode}`)

  try {
    const branch = git(cwd, ['branch', '--show-current']).trim()
    if (branch !== config.branches.integration) reasons.push(`integration worktree is on ${branch || 'detached HEAD'}`)
  } catch (error) {
    reasons.push(`cannot inspect integration branch: ${error.message}`)
  }

  for (const branch of [config.branches.fleet, config.branches.control]) {
    const result = spawnGit(cwd, ['merge-base', '--is-ancestor', branch, 'HEAD'])
    if (result.status !== 0) reasons.push(`${branch} is not merged into integration HEAD`)
  }

  const handoffFile = config.agents.integration.handoffFile
  const handoffPath = path.join(cwd, handoffFile)
  if (!existsSync(handoffPath)) {
    reasons.push(`integration handoff is missing: ${handoffFile}`)
  } else {
    const text = readFileSync(handoffPath, 'utf8')
    if (!text.includes(config.agents.integration.successMarker)) reasons.push(`handoff lacks ${config.agents.integration.successMarker}`)
    try {
      const committed = git(cwd, ['show', `HEAD:${handoffFile}`])
      if (!committed.includes(config.agents.integration.successMarker)) reasons.push('integration handoff marker is not committed')
    } catch {
      reasons.push('integration handoff is not committed in HEAD')
    }
  }

  try {
    const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).trim()
    if (status) reasons.push(`integration worktree is not clean (${status.split(/\r?\n/).length} entries)`)
  } catch (error) {
    reasons.push(`cannot inspect integration status: ${error.message}`)
  }

  return { ok: reasons.length === 0, reasons, commit }
}

function buildersReady() {
  return [...expectedAgents].every((key) => state.agents[key].state === 'done')
}

function printSignal(key, agent) {
  if (agent.state === 'heartbeat') {
    const previous = lastHeartbeatPrint.get(key) || 0
    if (Date.now() - previous < 120_000) return
    lastHeartbeatPrint.set(key, Date.now())
  }
  const suffix = agent.message ? ` · ${agent.message}` : ''
  console.log(`[${new Date().toLocaleTimeString()}] ${agent.label}: ${agent.state}${suffix}`)
}

function writeState() {
  writeAtomic(config.coordinator.stateFile, `${JSON.stringify(state, null, 2)}\n`)
}

function writeAtomic(file, content) {
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, content, { mode: 0o600 })
  try {
    renameSync(temp, file)
  } catch {
    rmSync(file, { force: true })
    renameSync(temp, file)
  }
}

function authorized(value) {
  const expected = Buffer.from(`Bearer ${config.coordinator.token}`)
  const actual = Buffer.from(String(value || ''))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function readJsonBody(request, maxBytes) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error('Signal body is too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function json(response, status, value) {
  if (response.headersSent) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

function boundedString(value, max) {
  if (typeof value !== 'string') return undefined
  return value.slice(0, max)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
}

function spawnGit(cwd, args) {
  return execFileSyncSafe('git', args, cwd)
}

function execFileSyncSafe(command, args, cwd) {
  try {
    const stdout = execFileSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
    return { status: 0, stdout }
  } catch (error) {
    return { status: Number(error?.status ?? 1), stdout: String(error?.stdout || ''), stderr: String(error?.stderr || '') }
  }
}

function requiredArg(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

process.on('SIGINT', () => {
  clearInterval(staleTimer)
  server.close(() => process.exit(130))
})
process.on('SIGTERM', () => {
  clearInterval(staleTimer)
  server.close(() => process.exit(143))
})
