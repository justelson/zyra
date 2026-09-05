#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

const sourceBinary = path.resolve(process.argv[2] || "");
const expectedVersion = String(process.argv[3] || "").trim();
if (!existsSync(sourceBinary)) throw new Error(`Standalone TUI binary is missing: ${sourceBinary}`);
if (!expectedVersion) throw new Error("Pass the expected Zyra version as the second argument.");

const temporaryParent = process.platform === "darwin" ? "/tmp" : os.tmpdir();
const temporaryRoot = mkdtempSync(path.join(temporaryParent, "zys-"));
const binary = path.join(temporaryRoot, path.basename(sourceBinary));
const stateDirectory = path.join(temporaryRoot, "state");
const piAgentDirectory = path.join(temporaryRoot, "pi-agent");
const channel = `smoke-${process.pid}-${Date.now()}`;
const environment = {
  ...process.env,
  HOME: temporaryRoot,
  USERPROFILE: temporaryRoot,
  LOCALAPPDATA: path.join(temporaryRoot, "local"),
  PI_CODING_AGENT_DIR: piAgentDirectory,
  ZYRA_AGENT_SERVER_CHANNEL: channel,
  ZYRA_STATE_DIR: stateDirectory,
  ZYRA_DATA_ROOT: temporaryRoot,
  ZYRA_CALLER_CWD: temporaryRoot,
  ZYRA_DISTRIBUTION: "standalone",
  ZYRA_UPDATE_NO_PATH_UPDATE: "1",
  ZYRA_ANALYTICS_ENABLED: "0",
  ZYRA_ANALYTICS_USE_RELEASE_CONFIG: "0",
};
let server;
let bridge;
let serverOutput = "";

try {
  // Run outside the checkout so executable-relative dependency lookup cannot mask missing bundled code.
  copyFileSync(sourceBinary, binary);
  const version = run(["--version"]);
  if (version.stdout.trim() !== `zyra ${expectedVersion}`) {
    throw new Error(`Unexpected standalone version output: ${version.stdout.trim()}`);
  }
  writeBundledOAuthFixture();
  assertEmbeddedResources();
  run(["doctor"]);
  const auth = run(["auth"]);
  if (!/^  subscription: connected/m.test(auth.stdout)) {
    throw new Error(`Standalone OAuth fixture was not detected:\n${auth.stdout}`);
  }
  smokeUpdate();
  await smokeBridge();

  server = spawn(binary, ["--internal-agent-server", "--channel", channel], {
    cwd: temporaryRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout?.on("data", captureServerOutput);
  server.stderr?.on("data", captureServerOutput);
  const descriptor = await waitForDescriptor(stateDirectory, 15_000);
  const payload = JSON.parse(readFileSync(descriptor, "utf8"));
  if (Number(payload.pid) !== server.pid) {
    throw new Error(`Standalone server descriptor PID ${payload.pid} does not match child ${server.pid}.`);
  }

  console.log(`standalone TUI smoke passed: ${path.basename(binary)}`);
} finally {
  if (bridge && bridge.exitCode === null) bridge.kill();
  if (server && server.exitCode === null) server.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function writeBundledOAuthFixture() {
  mkdirSync(piAgentDirectory, { recursive: true });
  writeFileSync(path.join(piAgentDirectory, "auth.json"), JSON.stringify({
    "openai-codex": {
      type: "oauth",
      access: `zyra-standalone-oauth-smoke-${process.pid}`,
      refresh: "offline-smoke-refresh-token",
      expires: Date.now() + 24 * 60 * 60 * 1000,
    },
  }), { encoding: "utf8", mode: 0o600 });
}

function smokeUpdate() {
  const releaseDirectory = path.join(temporaryRoot, "release");
  const releaseAsset = path.join(releaseDirectory, path.basename(binary));
  mkdirSync(releaseDirectory, { recursive: true });
  copyFileSync(binary, releaseAsset);
  const digest = createHash("sha256").update(readFileSync(releaseAsset)).digest("hex");
  writeFileSync(path.join(releaseDirectory, "SHA256SUMS"), `${digest}  ${path.basename(releaseAsset)}\n`, "ascii");
  run(["--update"], { ZYRA_UPDATE_SOURCE_DIRECTORY: releaseDirectory });
  run(["--update"], { ZYRA_UPDATE_SOURCE_DIRECTORY: releaseDirectory });

  const installed = process.platform === "win32"
    ? path.join(environment.LOCALAPPDATA, "Zyra", "cli", expectedVersion, "zyra.exe")
    : path.join(environment.HOME, ".local", "share", "zyra", expectedVersion, "zyra");
  if (!existsSync(installed)) throw new Error(`Standalone update did not install Zyra at ${installed}.`);
  const version = spawnSync(installed, ["--version"], {
    cwd: temporaryRoot,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (version.error) throw version.error;
  if (version.status !== 0 || version.stdout.trim() !== `zyra ${expectedVersion}`) {
    throw new Error(`Updated standalone binary failed validation: ${version.stderr || version.stdout}`);
  }
  if (process.platform === "win32") {
    const launcher = path.join(environment.LOCALAPPDATA, "Zyra", "bin", "zyra.cmd");
    const launcherVersion = spawnSync(launcher, ["--version"], {
      cwd: temporaryRoot,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      shell: true,
      timeout: 30_000,
    });
    if (launcherVersion.error) throw launcherVersion.error;
    if (launcherVersion.status !== 0 || launcherVersion.stdout.trim() !== `zyra ${expectedVersion}`) {
      throw new Error(`Updated standalone launcher failed validation: ${launcherVersion.stderr || launcherVersion.stdout}`);
    }
  }
}

function assertEmbeddedResources() {
  const runtimeDirectory = path.join(temporaryRoot, ".zyra", "runtime");
  const extracted = readdirSync(runtimeDirectory, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith(`${expectedVersion}-`));
  if (!extracted) throw new Error("Standalone TUI did not extract its embedded runtime resources.");
  const root = path.join(runtimeDirectory, extracted.name);
  for (const resource of [
    "analytics/events.v1.json",
    "prompts/zyra_system_prompt.md",
    "README.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_LICENSES.txt",
  ]) {
    if (!existsSync(path.join(root, ...resource.split("/")))) {
      throw new Error(`Standalone TUI is missing embedded resource: ${resource}`);
    }
  }
}

async function smokeBridge() {
  bridge = spawn(binary, ["--internal-agent-bridge"], {
    cwd: temporaryRoot,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  bridge.stdout.setEncoding("utf8");
  bridge.stderr.setEncoding("utf8");
  let stderr = "";
  bridge.stderr.on("data", (chunk) => { stderr += chunk; });
  const lines = readline.createInterface({ input: bridge.stdout });
  const pending = new Map();
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    } catch {
      stderr += `${line}\n`;
    }
  });
  const request = (id, type, payload = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Standalone bridge ${type} timed out.\n${stderr}`));
    }, 60_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      pending.delete(id);
      if (message.ok) resolve(message.result);
      else reject(new Error(`Standalone bridge ${type} failed: ${message.error}\n${stderr}`));
    });
    bridge.stdin.write(`${JSON.stringify({ id, type, payload })}\n`);
  });

  const warmup = await request(1, "warmup", { skipAvailability: true });
  if (!Array.isArray(warmup?.models)) throw new Error("Standalone bridge warmup did not return the model catalog.");
  const bridgeExited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Standalone bridge did not exit after dispose.")), 5_000);
    bridge.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Standalone bridge exited with ${code}.\n${stderr}`));
    });
  });
  bridge.stdin.write(`${JSON.stringify({ id: 2, type: "dispose", payload: {} })}\n`);
  await bridgeExited;
  lines.close();
  bridge = null;
}

function run(args, extraEnvironment = {}) {
  const result = spawnSync(binary, args, {
    cwd: temporaryRoot,
    env: { ...environment, ...extraEnvironment },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(binary)} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function waitForDescriptor(directory, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let match;
    try {
      match = readdirSync(directory).find((name) => name.startsWith("agent-server-v") && name.endsWith(".json"));
    } catch {
      match = undefined;
    }
    if (match) return path.join(directory, match);
    if (server && (server.exitCode !== null || server.signalCode !== null)) {
      const status = server.exitCode === null ? `signal ${server.signalCode || "unknown"}` : `code ${server.exitCode}`;
      throw new Error(`Standalone server exited before publishing a descriptor (${status}).\n${serverOutput}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Standalone server did not publish a descriptor within 15 seconds.");
}

function captureServerOutput(chunk) {
  if (serverOutput.length < 64 * 1024) serverOutput += String(chunk);
}
