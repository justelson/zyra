import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(existsSync(path.join(root, "bin/zyra-dev.mjs")), "zyra-dev must have its own source entrypoint");
const { developmentEnvironment } = await import("../src/development-launcher.mjs");
const { installDevCommand } = await import("./install-dev-command.mjs");

for (const platform of ["win32", "darwin", "linux"]) {
  const env = developmentEnvironment({
    root: "/checkout", cwd: "/project", home: "/person", platform,
    env: { APPDATA: "/roaming", XDG_CONFIG_HOME: "/config", ZYRA_STATE_DIR: "/stable", ZYRA_AGENT_SERVER_CHANNEL: "default", ZYRA_ROOT: "/installed", ZYRA_STANDALONE: "1", ZYRA_DISTRIBUTION: "desktop-bundle" }
  });
  const appData = platform === "win32" ? "/roaming" : platform === "darwin" ? "/person/Library/Application Support" : "/config";
  assert.equal(env.ZYRA_STATE_DIR, path.join(appData, "Zyra-dev", "assistant", "agent-server"));
  assert.equal(env.ZYRA_AGENT_SERVER_CHANNEL, "desktop");
  assert.equal(env.ZYRA_ROOT, path.resolve("/checkout"));
  assert.equal(env.ZYRA_CALLER_CWD, "/project");
  assert.equal(env.ZYRA_DATA_ROOT, "/person");
  assert.equal(env.ZYRA_DISTRIBUTION, "development");
  assert.equal(env.ZYRA_STANDALONE, undefined);
}
assert.match(developmentEnvironment({ root, env: { ZYRA_DEV_INSTANCE_SUFFIX: " Work Tree! " } }).ZYRA_STATE_DIR, /Zyra-dev-work-tree-[/\\]assistant/);

const fixture = await mkdtemp(path.join(os.tmpdir(), "zyra-dev-command-"));
try {
  const checkout = path.join(fixture, "checkout with spaces");
  const bin = path.join(fixture, "commands");
  mkdirSync(path.join(checkout, "bin"), { recursive: true });
  mkdirSync(path.join(checkout, "src"), { recursive: true });
  for (const relative of ["bin/zyra-dev.mjs", "src/development-launcher.mjs"]) {
    writeFileSync(path.join(checkout, relative), readFileSync(path.join(root, relative)));
  }
  writeFileSync(path.join(checkout, "bin/zyra.mjs"), 'console.log(JSON.stringify({ args: process.argv.slice(2), project: process.env.ZYRA_CALLER_CWD, state: process.env.ZYRA_STATE_DIR, channel: process.env.ZYRA_AGENT_SERVER_CHANNEL, root: process.env.ZYRA_ROOT }));');
  const stable = path.join(bin, process.platform === "win32" ? "zyra.cmd" : "zyra");
  mkdirSync(bin, { recursive: true });
  writeFileSync(stable, "existing stable launcher");
  const options = { root: checkout, directory: bin, configurePath: false };
  const result = await installDevCommand(options);
  assert.equal(readFileSync(stable, "utf8"), "existing stable launcher");
  assert.equal((await installDevCommand(options)).path, result.path, "installation is idempotent");
  const child = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${result.path}" resume --thread fixture-chat"`], { cwd: fixture, encoding: "utf8", windowsVerbatimArguments: true })
    : spawnSync(result.path, ["resume", "--thread", "fixture-chat"], { cwd: fixture, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const output = JSON.parse(child.stdout.trim());
  assert.deepEqual(output.args, ["resume", "--thread", "fixture-chat"]);
  assert.equal(realpathSync(output.project), realpathSync(fixture));
  assert.equal(realpathSync(output.root), realpathSync(checkout));
  assert.equal(output.channel, "desktop");
  assert.match(output.state, /Zyra-dev[/\\]assistant[/\\]agent-server$/);
  writeFileSync(result.path, "unmanaged command");
  await assert.rejects(installDevCommand(options), /unmanaged/);
  assert.equal(readFileSync(result.path, "utf8"), "unmanaged command");
} finally {
  assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(fixture, { recursive: true, force: true });
}
console.log("zyra-dev: installed command, argument/project forwarding, dev isolation and stable launcher preservation: ok");
