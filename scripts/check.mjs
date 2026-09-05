/**
 * Zyra validation runner.
 *
 * Modes are intentionally stable so humans and agents can choose the smallest
 * useful gate instead of repeatedly paying for every suite:
 *   node scripts/check.mjs quick    syntax + fast deterministic core tests
 *   node scripts/check.mjs core     syntax + every core CLI test
 *   node scripts/check.mjs desktop  heavyweight desktop integration suites
 *   node scripts/check.mjs full     core + desktop + doctor (default)
 *
 * Independent syntax checks and core tests use bounded concurrency. Desktop
 * suites remain serial because they can share Electron, browser, and process
 * resources. Set ZYRA_CHECK_CONCURRENCY=1 when diagnosing an order-sensitive
 * failure; do not raise it casually on memory-constrained machines.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const syntaxTargets = [
  "src/permission-paths.mjs",
  "scripts/test-zyra-permission-paths.mjs",
  "scripts/test-zyra-update-isolation.mjs",
  "src/agent-server/plugin-authority.mjs",
  "src/agent-server/protocol.mjs",
  "src/agent-server/server.mjs",
  "src/plugins/revoke-runtime.mjs",
  "scripts/test-zyra-plugin-availability.mjs",
  "scripts/test-zyra-plugin-revocation-runtime.mjs",
  "scripts/test-zyra-plugin-revocation-bridge.mjs",
  "scripts/test-zyra-filesystem-scope-runtime.mjs",
  "bin/zyra.mjs",
  "src/version.mjs",
  "src/analytics/contracts.mjs",
  "src/analytics/client.mjs",
  "src/analytics/cli.mjs",
  "src/agent-surface.mjs",
  "src/assistant-action-batch-tool.mjs",
  "src/model-availability.mjs",
  "src/model-order.mjs",
  "scripts/test-model-order.mjs",
  "src/chatgpt-account.mjs",
  "src/pi-runtime.mjs",
  "src/chatgpt-realtime-contract.mjs",
  "src/web-search-tool.mjs",
  "src/web-tools-picker.mjs",
  "src/permission-mode.mjs",
  "src/plugins/plugin-contract.mjs",
  "src/plugins/plugin-download.mjs",
  "src/plugins/plugin-package.mjs",
  "src/plugins/plugin-registry.mjs",
  "src/plugins/plugin-state.mjs",
  "src/zyra-permission-gate.mjs",
  "src/zyra-permission-reviewer.mjs",
  "src/interrupt-mode-picker.mjs",
  "src/codex-usage-windows.mjs",
  "src/codex-reset-format.mjs",
  "src/codex-reset-picker.mjs",
  "src/onboarding.mjs",
  "src/clipboard-image.mjs",
  "src/slash-commands.mjs",
  "src/slash-command-handlers.mjs",
  "src/slash-suggestions.mjs",
  "src/status-line.mjs",
  "src/terminal-title.mjs",
  "src/zyra-ui.mjs",
  "src/zyra-ui-bridge.mjs",
  "src/standalone-entry.mjs",
  "src/agent-server/main.mjs",
  "src/agent-server/client.mjs",
  "src/agent-server/bridge-worker.mjs",
  "src/agent-server/tui-runtime.mjs",
  "src/file-change-lifecycle.mjs",
  "src/write-diff-tool.mjs",
  "src/terminal-input.mjs",
  "src/zyra-next-turn-checkpoint.mjs",
  "src/zyra-sdk.mjs",
  "src/zyra-prompt-resources.mjs",
  "src/zyra.mjs",
  "src/zyra-app.mjs",
  "src/zyra-memory.mjs",
  "src/memory/zyra-memory-state.mjs",
  "src/memory/zyra-memory-store.mjs",
  "src/memory/zyra-memory-bootstrap.mjs",
  "src/memory/zyra-memory-modes.mjs",
  "src/memory/zyra-memory-read.mjs",
  "src/memory/zyra-memory-phase2.mjs",
  "src/memory/zyra-memory-sessions.mjs",
  "src/memory/zyra-memory-stage1.mjs",
  "src/memory/zyra-memory-stage1-outputs.mjs",
  "src/memory/zyra-memory-worker-io.mjs",
  "src/memory/zyra-memory-worker-prompts.mjs",
  "src/memory/zyra-memory-workspace.mjs",
  "src/memory/zyra-memory-prompts.mjs",
  "src/memory/zyra-memory-runner.mjs",
  "src/memory/zyra-memory-controller.mjs",
  "src/workflows/sandbox-host.mjs",
  "src/tui/zyra-tui.mjs",
  "src/tui/component-host.mjs",
  "src/tui/render-utils.mjs",
  "src/tui/editor-input-layout.mjs",
  "src/tui/components/editor.mjs",
  "src/tui/components/message-components.mjs",
  "src/tui/components/static-panels.mjs",
  "scripts/check.mjs",
  "scripts/build-release.mjs",
  "scripts/build-tui-release.mjs",
  "scripts/sign-standalone-tui.mjs",
  "scripts/tui-release-contract.mjs",
  "scripts/generate-third-party-licenses.mjs",
  "scripts/seed-development-chat-fixtures.mjs",
  "scripts/test-legal-release-contract.mjs",
  "scripts/test-standalone-tui-binary.mjs",
  "scripts/test-standalone-tui-signing-contract.mjs",
  "scripts/test-zyra-auth.mjs",
  "scripts/test-zyra-cli-permissions.mjs",
  "scripts/test-zyra-permission-gate.mjs",
  "scripts/test-zyra-permission-reviewer.mjs",
  "scripts/test-zyra-memory.mjs",
  "scripts/test-zyra-codex-mode.mjs",
  "scripts/test-zyra-codex-resets.mjs",
  "scripts/test-zyra-codex-usage-windows.mjs",
  "scripts/test-zyra-managed-bash.mjs",
  "scripts/test-zyra-model-availability.mjs",
  "scripts/test-chatgpt-realtime-call.mjs",
  "scripts/test-codex-realtime-contract-sync.mjs",
  "scripts/sync-codex-realtime-contract.mjs",
  "scripts/test-provider-runtime-migration.mjs",
  "scripts/test-pi-runtime-auth-sync.mjs",
  "scripts/test-zyra-prompt-errors.mjs",
  "scripts/test-zyra-prompt-resources.mjs",
  "scripts/test-zyra-plugin-system.mjs",
  "scripts/test-zyra-plugin-runtime.mjs",
  "scripts/test-zyra-plugin-download.mjs",
  "scripts/update-plugin-directory.mjs",
  "scripts/update-plugin-logos.mjs",
  "scripts/test-zyra-plugin-logos.mjs",
  "scripts/test-zyra-write-diff.mjs",
  "scripts/test-zyra-version.mjs",
  "scripts/test-product-analytics.mjs",
  "scripts/benchmark-product-analytics.mjs",
  "scripts/privacy-check.mjs",
];

const coreTests = [
  "scripts/test-zyra-permission-paths.mjs",
  "scripts/test-zyra-update-isolation.mjs",
  "scripts/test-zyra-plugin-availability.mjs",
  "scripts/test-zyra-plugin-revocation-runtime.mjs",
  "scripts/test-zyra-plugin-revocation-bridge.mjs",
  "scripts/test-zyra-agent-server.mjs",
  "scripts/test-zyra-agent-server-bridge.mjs",
  "scripts/test-zyra-filesystem-scope-runtime.mjs",
  "scripts/test-model-order.mjs",
  "scripts/privacy-check.mjs",
  "scripts/test-product-analytics.mjs",
  "scripts/test-agent-surface-contract.mjs",
  "scripts/test-request-user-input.mjs",
  "scripts/test-legal-release-contract.mjs",
  "scripts/test-standalone-tui-signing-contract.mjs",
  "scripts/test-zyra-auth.mjs",
  "scripts/test-zyra-cli-permissions.mjs",
  "scripts/test-zyra-permission-gate.mjs",
  "scripts/test-zyra-permission-reviewer.mjs",
  "scripts/test-zyra-memory.mjs",
  "scripts/test-zyra-codex-mode.mjs",
  "scripts/test-zyra-codex-resets.mjs",
  "scripts/test-zyra-codex-usage-windows.mjs",
  "scripts/test-zyra-managed-bash.mjs",
  "scripts/test-zyra-model-availability.mjs",
  "scripts/test-chatgpt-realtime-call.mjs",
  "scripts/test-codex-realtime-contract-sync.mjs",
  "scripts/test-provider-runtime-migration.mjs",
  "scripts/test-pi-runtime-auth-sync.mjs",
  "scripts/test-zyra-prompt-errors.mjs",
  "scripts/test-zyra-prompt-resources.mjs",
  "scripts/test-zyra-plugin-system.mjs",
  "scripts/test-zyra-plugin-runtime.mjs",
  "scripts/test-zyra-plugin-download.mjs",
  "scripts/test-zyra-plugin-logos.mjs",
  "scripts/test-zyra-version.mjs",
  "scripts/test-zyra-ui-render.mjs",
  "scripts/test-zyra-subagents.mjs",
  "scripts/test-zyra-workflows.mjs",
  "scripts/test-zyra-fleet-ui.mjs",
];

// Quick mode stays deterministic and side-effect-light. Larger state, UI, and
// orchestration suites remain in core/full so quick is useful during iteration.
const quickCoreTests = [
  "scripts/test-zyra-permission-paths.mjs",
  "scripts/test-zyra-update-isolation.mjs",
  "scripts/test-zyra-filesystem-scope-runtime.mjs",
  "scripts/test-model-order.mjs",
  "scripts/privacy-check.mjs",
  "scripts/test-product-analytics.mjs",
  "scripts/test-agent-surface-contract.mjs",
  "scripts/test-request-user-input.mjs",
  "scripts/test-zyra-cli-permissions.mjs",
  "scripts/test-zyra-permission-gate.mjs",
  "scripts/test-zyra-permission-reviewer.mjs",
  "scripts/test-legal-release-contract.mjs",
  "scripts/test-zyra-model-availability.mjs",
  "scripts/test-chatgpt-realtime-call.mjs",
  "scripts/test-codex-realtime-contract-sync.mjs",
  "scripts/test-provider-runtime-migration.mjs",
  "scripts/test-pi-runtime-auth-sync.mjs",
  "scripts/test-zyra-prompt-errors.mjs",
  "scripts/test-zyra-prompt-resources.mjs",
  "scripts/test-zyra-version.mjs",
  "scripts/test-zyra-fleet-ui.mjs",
];

const serialCoreTests = new Set([
  "scripts/test-zyra-plugin-revocation-bridge.mjs",
  "scripts/test-zyra-agent-server.mjs",
  "scripts/test-zyra-agent-server-bridge.mjs",
  "scripts/test-zyra-memory.mjs",
  "scripts/test-zyra-codex-mode.mjs",
  "scripts/test-zyra-managed-bash.mjs",
  "scripts/test-zyra-plugin-runtime.mjs",
]);

const desktopTasks = [
  { label: "desktop:test:update-controls", bunArgs: ["run", "--cwd", "desktop", "test:update-controls"] },
  { label: "desktop:test:assistant-project-creation", bunArgs: ["run", "--cwd", "desktop", "test:assistant-project-creation"] },
  { label: "desktop:test:assistant-new-chat-surface", bunArgs: ["desktop/scripts/test-assistant-new-chat-surface.ts"] },
  { label: "desktop:test:shell-file-preview", bunArgs: ["run", "--cwd", "desktop", "test:shell-file-preview"] },
  { label: "desktop:test:assistant-model-catalog", bunArgs: ["desktop/scripts/test-assistant-model-catalog.tsx"] },
  { label: "desktop:test:work-timeline-v2", bunArgs: ["run", "--cwd", "desktop", "test:work-timeline-v2"] },
  { label: "desktop:test:action-batch-intent", bunArgs: ["run", "--cwd", "desktop", "test:assistant-action-batch-intent"] },
  { label: "desktop:test:assistant-user-input", bunArgs: ["run", "--cwd", "desktop", "test:assistant-user-input"] },
  { label: "desktop:test:markdown-renderer", bunArgs: ["run", "--cwd", "desktop", "test:markdown-renderer"] },
  { label: "desktop:test:assistant-response-media", bunArgs: ["run", "--cwd", "desktop", "test:assistant-response-media"] },
  { label: "desktop:test:theme-adaptive-surfaces", bunArgs: ["run", "--cwd", "desktop", "test:theme-adaptive-surfaces"] },
  { label: "desktop:test:analytics", bunArgs: ["run", "--cwd", "desktop", "test:analytics"] },
  { label: "desktop:test:assistant-composer-command-menu", bunArgs: ["desktop/scripts/test-assistant-composer-command-menu.ts"] },
  { label: "desktop:test:assistant-fleet", bunArgs: ["run", "--cwd", "desktop", "test:assistant-fleet"] },
  { label: "desktop:test:assistant-inspector-browser", bunArgs: ["run", "--cwd", "desktop", "test:assistant-inspector-browser"] },
  { label: "desktop:test:assistant-plugins", bunArgs: ["run", "--cwd", "desktop", "test:assistant-plugins"] },
  { label: "desktop:test:agent-platform-integration", bunArgs: ["desktop/scripts/test-agent-platform-integration.ts"] },
];

const modes = new Set(["quick", "core", "desktop", "syntax", "full"]);
const requestedMode = process.argv[2] || "full";

if (requestedMode === "--help" || requestedMode === "help") {
  console.log(`Zyra checks\n\n  quick    syntax + fast core tests\n  core     syntax + all core CLI tests\n  desktop  serial desktop integration suites\n  syntax   JavaScript syntax only\n  full     core + desktop + doctor (default)\n\nEnvironment:\n  ZYRA_CHECK_CONCURRENCY=1  run syntax/core tasks serially for debugging`);
  process.exit(0);
}

if (!modes.has(requestedMode)) {
  console.error(`[check] unknown mode: ${requestedMode}`);
  console.error("[check] run `npm run check:help` for available modes");
  process.exit(2);
}

function readConcurrency() {
  const configured = Number.parseInt(process.env.ZYRA_CHECK_CONCURRENCY || "", 10);
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, 4);
  // Keep one logical CPU free and cap memory/process pressure on laptops and CI.
  return Math.max(1, Math.min(2, os.availableParallelism?.() || os.cpus().length || 1));
}

const taskConcurrency = readConcurrency();

function nodeTask(target, extraArgs = []) {
  return {
    label: target,
    command: process.execPath,
    args: [...extraArgs, target],
  };
}

function bunTask(task) {
  if (process.platform === "win32") {
    return {
      label: task.label,
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "bun", ...task.bunArgs],
    };
  }
  return { label: task.label, command: "bun", args: task.bunArgs };
}

function runTask(task) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    if (!task.quiet) console.log(`[check] start ${task.label}`);
    const child = spawn(task.command, task.args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", (error) => {
      reject(new Error(`could not start ${task.command}: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        if (!task.quiet) console.log(`[check] done  ${task.label} (${duration}s)`);
        resolve();
        return;
      }
      reject(new Error(`${task.label} failed (${signal || `exit ${code}`}, ${duration}s)`));
    });
  });
}

async function runGroup(title, tasks, concurrency = taskConcurrency) {
  if (tasks.length === 0) return;
  console.log(`[check] ${title} (${tasks.length} tasks, concurrency ${Math.min(concurrency, tasks.length)})`);
  let nextIndex = 0;
  let firstFailure = null;

  async function worker() {
    while (firstFailure === null) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;
      try {
        await runTask(tasks[index]);
      } catch (error) {
        firstFailure = error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  if (firstFailure) throw firstFailure;
}

async function main() {
  const startedAt = performance.now();
  console.log(`[check] mode=${requestedMode} concurrency=${taskConcurrency}`);

  if (["quick", "core", "syntax", "full"].includes(requestedMode)) {
    await runGroup("syntax", syntaxTargets.map((target) => ({
      ...nodeTask(target, ["--check"]),
      quiet: true,
    })), taskConcurrency);
  }

  if (requestedMode === "quick") {
    await runGroup("quick core tests", quickCoreTests.map((target) => nodeTask(target)));
  }

  if (["core", "full"].includes(requestedMode)) {
    const parallelCoreTests = coreTests.filter((target) => !serialCoreTests.has(target));
    const isolatedCoreTests = coreTests.filter((target) => serialCoreTests.has(target));
    await runGroup("core tests", parallelCoreTests.map((target) => nodeTask(target)));
    await runGroup("isolated core tests", isolatedCoreTests.map((target) => nodeTask(target)), 1);
  }

  if (["desktop", "full"].includes(requestedMode)) {
    // Preserve serial execution for suites with browser/process/global-state work.
    await runGroup("desktop suites", desktopTasks.map(bunTask), 1);
  }

  if (requestedMode === "full") {
    await runGroup("doctor", [{
      label: "doctor",
      command: process.execPath,
      args: ["bin/zyra.mjs", "doctor"],
    }], 1);
  }

  const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(`[check] complete mode=${requestedMode} (${duration}s)`);
}

main().catch((error) => {
  console.error(`[check] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
