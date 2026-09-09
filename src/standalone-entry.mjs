import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStandaloneInstallMetadata } from "./standalone-install-metadata.mjs";

export async function runZyraStandalone(distribution) {
  const version = requireValue(distribution?.version, "version");
  const hash = requireValue(distribution?.hash, "resource hash");
  const resources = distribution?.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new Error("Zyra standalone resources are missing.");
  }

  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--version" && process.env.ZYRA_INSTALL_METADATA === "1") {
    process.stdout.write(`${JSON.stringify(getStandaloneInstallMetadata(distribution))}\n`);
    return;
  }

  const home = os.homedir();
  const runtimeRoot = path.join(home, ".zyra", "runtime", `${version}-${hash.slice(0, 12)}`);
  materializeResources(runtimeRoot, hash, resources);

  process.env.ZYRA_STANDALONE = "1";
  process.env.ZYRA_VERSION = version;
  process.env.ZYRA_ROOT = runtimeRoot;
  process.env.ZYRA_DATA_ROOT ??= home;
  process.env.ZYRA_CALLER_CWD ??= process.cwd();

  await import("../bin/zyra.mjs");
}

function materializeResources(runtimeRoot, hash, resources) {
  const marker = path.join(runtimeRoot, ".zyra-runtime.json");
  try {
    const current = JSON.parse(readFileSync(marker, "utf8"));
    if (current.hash === hash) return;
  } catch {
    // A missing or incomplete cache is repaired below.
  }

  mkdirSync(runtimeRoot, { recursive: true });
  for (const [relativePath, base64] of Object.entries(resources)) {
    const normalized = normalizeResourcePath(relativePath);
    const target = path.join(runtimeRoot, ...normalized.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.partial`;
    writeFileSync(temporary, Buffer.from(String(base64), "base64"), { mode: 0o600 });
    try {
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    }
  }

  const temporaryMarker = `${marker}.${process.pid}.partial`;
  writeFileSync(temporaryMarker, `${JSON.stringify({ version: 1, hash })}\n`, "utf8");
  try {
    renameSync(temporaryMarker, marker);
  } catch (error) {
    rmSync(temporaryMarker, { force: true });
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
  }
}

function normalizeResourcePath(value) {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe embedded resource path: ${value}`);
  }
  return normalized;
}

function requireValue(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Zyra standalone ${label} is missing.`);
  return text;
}
