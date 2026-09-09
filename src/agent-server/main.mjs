#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZyraAgentServer } from "./server.mjs";
import { getAgentServerPaths, normalizeAgentServerChannel } from "./paths.mjs";

export async function runZyraAgentServer(args = process.argv.slice(2)) {
  const options = parse(args);
  const root = path.resolve(process.env.ZYRA_ROOT || path.resolve(import.meta.dirname, "../.."));
  const paths = getAgentServerPaths({ channel: options.channel });
  mkdirSync(paths.stateDirectory, { recursive: true });
  const lockFd = acquireLock(paths);
  if (lockFd === null) return;

  const server = new ZyraAgentServer({ root, channel: options.channel });
  let stopping = false;
  const stop = async (reason) => {
    if (stopping) return;
    stopping = true;
    await server.stop(reason).catch(() => undefined);
    try { closeSync(lockFd); } catch {}
    rmSync(paths.lockFile, { force: true });
  };

  process.on("SIGINT", () => void stop("Agent server interrupted.").finally(() => process.exit(0)));
  server.once("retire", () => void stop("Agent server updated.").finally(() => process.exit(0)));
  process.on("SIGTERM", () => void stop("Agent server terminated.").finally(() => process.exit(0)));
  process.on("uncaughtException", (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    void stop("Agent server crashed.").finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
  });

  await server.start();
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  await runZyraAgentServer();
}

function parse(args) {
  let channel = "default";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--channel" && args[index + 1]) channel = args[++index];
  }
  return { channel: normalizeAgentServerChannel(channel) };
}

function acquireLock(targets) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(targets.lockFile, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return fd;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const pid = readPid(targets.lockFile);
      if (pid && processAlive(pid)) return null;
      rmSync(targets.lockFile, { force: true });
      rmSync(targets.descriptorFile, { force: true });
    }
  }
  throw new Error("Could not acquire the Zyra agent-server lock.");
}

function readPid(file) {
  try {
    return Number(JSON.parse(readFileSync(file, "utf8")).pid) || 0;
  } catch {
    return 0;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
