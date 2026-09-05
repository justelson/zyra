#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NODE_RELEASE_RUNTIME_VERSION } from "../desktop/scripts/release/runtime-contract.mjs";
import { BUN_RUNTIME_VERSION } from "./tui-release-contract.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(root, "THIRD_PARTY_LICENSES.txt");
const checkOnly = process.argv.includes("--check");
const SPDX_LICENSE_LIST_VERSION = "3.28.0";
const SPDX_IDS = Object.freeze([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
]);
const dependencySets = Object.freeze([
  { scope: "Zyra TUI and shared runtime", directory: root },
  { scope: "Zyra Desktop", directory: path.join(root, "desktop") },
]);

const packages = await collectPackages();
const manifest = buildManifest(packages);
const manifestHash = sha256(JSON.stringify(manifest));

if (checkOnly) {
  await checkGeneratedBundle(manifestHash, packages.size);
  process.exit(0);
}

const spdxIds = usedSpdxIds(packages);
const [bunLicense, nodeLicense, spdxEntries] = await Promise.all([
  fetchText(
    `https://raw.githubusercontent.com/oven-sh/bun/bun-v${BUN_RUNTIME_VERSION}/LICENSE.md`,
    `Bun ${BUN_RUNTIME_VERSION} license`,
  ),
  fetchText(
    `https://raw.githubusercontent.com/nodejs/node/v${NODE_RELEASE_RUNTIME_VERSION}/LICENSE`,
    `Node.js ${NODE_RELEASE_RUNTIME_VERSION} license`,
  ),
  Promise.all(spdxIds.map(async (licenseId) => {
    const details = JSON.parse(await fetchText(
      `https://raw.githubusercontent.com/spdx/license-list-data/v${SPDX_LICENSE_LIST_VERSION}/json/details/${licenseId}.json`,
      `SPDX ${licenseId} license data`,
    ));
    if (details.licenseId !== licenseId || !String(details.licenseText || "").trim()) {
      throw new Error(`SPDX returned incomplete license data for ${licenseId}.`);
    }
    return [licenseId, normalizeText(details.licenseText)];
  })),
]);
const spdxTexts = new Map(spdxEntries);

const output = renderBundle({
  packages,
  manifestHash,
  bunLicense: normalizeText(bunLicense),
  nodeLicense: normalizeText(nodeLicense),
  spdxTexts,
});
await writeFile(outputPath, output, "utf8");
console.log(`Generated ${path.relative(root, outputPath)} for ${packages.size} production packages.`);

async function collectPackages() {
  const collected = new Map();
  for (const dependencySet of dependencySets) {
    const lockPath = path.join(dependencySet.directory, "package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    for (const [relativePath, lockEntry] of Object.entries(lock.packages || {})) {
      if (!relativePath || !relativePath.includes("node_modules/") || lockEntry.dev === true) continue;
      const name = packageNameFromLockPath(relativePath);
      const version = String(lockEntry.version || "").trim();
      if (!name || !version) throw new Error(`Incomplete production package in ${path.relative(root, lockPath)}: ${relativePath}`);
      const key = `${name}@${version}`;
      let entry = collected.get(key);
      if (!entry) {
        entry = {
          key,
          name,
          version,
          scopes: new Set(),
          licenses: new Set(),
          lockLicenses: new Set(),
          integrities: new Set(),
          resolved: new Set(),
          authors: new Set(),
          sources: new Set(),
          legalTexts: new Map(),
        };
        collected.set(key, entry);
      }
      entry.scopes.add(dependencySet.scope);
      const lockLicense = normalizeLicense(lockEntry.license);
      addMeaningful(entry.licenses, lockLicense);
      addMeaningful(entry.lockLicenses, lockLicense);
      addMeaningful(entry.integrities, lockEntry.integrity);
      addMeaningful(entry.resolved, lockEntry.resolved);
      if (checkOnly) continue;

      const packageDirectory = path.join(dependencySet.directory, ...relativePath.split("/"));
      if (!existsSync(packageDirectory)) continue;
      const packageJsonPath = path.join(packageDirectory, "package.json");
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
        addMeaningful(entry.licenses, normalizeLicense(packageJson.license || packageJson.licenses));
        addMeaningful(entry.authors, formatPerson(packageJson.author));
        addMeaningful(entry.sources, repositoryUrl(packageJson.repository) || packageJson.homepage);
      }
      for (const legalFile of await readPackageLegalFiles(packageDirectory)) {
        const hash = sha256(legalFile.text);
        const existing = entry.legalTexts.get(hash) || { hash, text: legalFile.text, names: new Set() };
        existing.names.add(legalFile.name);
        entry.legalTexts.set(hash, existing);
      }
    }
  }

  if (!checkOnly) {
    for (const entry of collected.values()) {
      if (entry.licenses.size === 0 && entry.legalTexts.size === 0) {
        throw new Error(`${entry.key} has no declared license and no packaged legal text.`);
      }
    }
  }
  return new Map([...collected].sort(([left], [right]) => left.localeCompare(right)));
}

function buildManifest(packageMap) {
  return {
    schemaVersion: 1,
    runtimes: { bun: BUN_RUNTIME_VERSION, node: NODE_RELEASE_RUNTIME_VERSION },
    spdxLicenseList: SPDX_LICENSE_LIST_VERSION,
    packages: [...packageMap.values()].map((entry) => ({
      name: entry.name,
      version: entry.version,
      scopes: sorted(entry.scopes),
      licenses: sorted(entry.lockLicenses),
      integrities: sorted(entry.integrities),
      resolved: sorted(entry.resolved),
    })),
  };
}

async function checkGeneratedBundle(expectedHash, expectedPackageCount) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (!current) throw new Error("THIRD_PARTY_LICENSES.txt is missing. Run npm run licenses:generate.");
  const hash = current.match(/^Dependency manifest SHA-256: ([a-f0-9]{64})$/m)?.[1];
  const packageCount = Number(current.match(/^Production package records: (\d+)$/m)?.[1]);
  const bunVersion = current.match(/^Bundled Bun runtime: (.+)$/m)?.[1];
  const nodeVersion = current.match(/^Bundled Node\.js runtime: (.+)$/m)?.[1];
  if (hash !== expectedHash || packageCount !== expectedPackageCount) {
    throw new Error("THIRD_PARTY_LICENSES.txt does not match the production lockfiles. Run npm run licenses:generate.");
  }
  if (bunVersion !== BUN_RUNTIME_VERSION || nodeVersion !== NODE_RELEASE_RUNTIME_VERSION) {
    throw new Error("THIRD_PARTY_LICENSES.txt does not match the pinned release runtimes. Run npm run licenses:generate.");
  }
  const bundleHashMarker = current.match(/^Bundle content SHA-256: ([a-f0-9]{64})$/m);
  if (!bundleHashMarker || bundleHashMarker.index == null) {
    throw new Error("THIRD_PARTY_LICENSES.txt is missing its content hash. Run npm run licenses:generate.");
  }
  const trailingContent = current.slice(bundleHashMarker.index + bundleHashMarker[0].length).trim();
  const bundleBody = current.slice(0, bundleHashMarker.index).replace(/\r\n?/g, "\n");
  if (trailingContent || sha256(bundleBody) !== bundleHashMarker[1]) {
    throw new Error("THIRD_PARTY_LICENSES.txt content was modified. Run npm run licenses:generate.");
  }
  console.log(`Third-party license bundle is current for ${expectedPackageCount} production packages.`);
}

function renderBundle({ packages: packageMap, manifestHash: hash, bunLicense: bun, nodeLicense: node, spdxTexts }) {
  const legalTexts = new Map();
  for (const entry of packageMap.values()) {
    for (const legalText of entry.legalTexts.values()) {
      const existing = legalTexts.get(legalText.hash) || {
        hash: legalText.hash,
        text: legalText.text,
        packages: new Set(),
        names: new Set(),
      };
      existing.packages.add(entry.key);
      for (const name of legalText.names) existing.names.add(name);
      legalTexts.set(legalText.hash, existing);
    }
  }

  const lines = [
    "Zyra third-party dependency licenses",
    "====================================",
    "",
    "Generated by scripts/generate-third-party-licenses.mjs. Do not edit this file by hand.",
    `Dependency manifest SHA-256: ${hash}`,
    `Production package records: ${packageMap.size}`,
    `Bundled Bun runtime: ${BUN_RUNTIME_VERSION}`,
    `Bundled Node.js runtime: ${NODE_RELEASE_RUNTIME_VERSION}`,
    `SPDX license text set: ${SPDX_LICENSE_LIST_VERSION}`,
    "",
    "This file covers production JavaScript packages used by the shared runtime and Desktop app,",
    "the Bun runtime embedded in standalone TUI executables, and the Node.js runtime packaged with",
    "the Windows Desktop app. Electron and Chromium place their upstream license files beside the",
    "packaged application. The Windows .NET sidecar carries its runtime notices beside the sidecar.",
    "",
    "Bun runtime",
    "===========",
    "",
    `Source: https://github.com/oven-sh/bun/tree/bun-v${BUN_RUNTIME_VERSION}`,
    "Upstream file: LICENSE.md",
    "",
    bun.trimEnd(),
    "",
    "Node.js runtime",
    "===============",
    "",
    `Source: https://github.com/nodejs/node/tree/v${NODE_RELEASE_RUNTIME_VERSION}`,
    "Upstream file: LICENSE",
    "",
    node.trimEnd(),
    "",
    "Production package inventory",
    "============================",
    "",
  ];

  for (const entry of packageMap.values()) {
    const legalHashes = sorted(entry.legalTexts.keys()).map((value) => value.slice(0, 16));
    lines.push(
      entry.key,
      `  Used by: ${sorted(entry.scopes).join(", ")}`,
      `  Declared license: ${sorted(entry.licenses).join("; ") || "See package-provided legal text"}`,
      `  Author metadata: ${sorted(entry.authors).join("; ") || "Not supplied"}`,
      `  Source: ${sorted(entry.sources).join("; ") || sorted(entry.resolved).join("; ") || "Not supplied"}`,
      `  Package-provided legal text: ${legalHashes.length ? legalHashes.join(", ") : "None supplied"}`,
      "",
    );
  }

  lines.push("Package-provided legal texts", "============================", "");
  for (const legalText of [...legalTexts.values()].sort((left, right) => left.hash.localeCompare(right.hash))) {
    lines.push(
      `Legal text SHA-256: ${legalText.hash}`,
      `Used by: ${sorted(legalText.packages).join(", ")}`,
      `Package file names: ${sorted(legalText.names).join(", ")}`,
      "",
      legalText.text.trimEnd(),
      "",
      "--------------------------------------------------------------------------------",
      "",
    );
  }

  lines.push("Standard SPDX license texts", "===========================", "");
  for (const [licenseId, text] of [...spdxTexts].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(
      licenseId,
      "-".repeat(licenseId.length),
      `Source: https://github.com/spdx/license-list-data/tree/v${SPDX_LICENSE_LIST_VERSION}`,
      "",
      text.trimEnd(),
      "",
      "--------------------------------------------------------------------------------",
      "",
    );
  }
  const body = `${lines.join("\n").trimEnd()}\n`;
  return `${body}Bundle content SHA-256: ${sha256(body)}\n`;
}

function usedSpdxIds(packageMap) {
  const used = new Set();
  for (const entry of packageMap.values()) {
    const expression = sorted(entry.licenses).join(" ").toLowerCase();
    for (const licenseId of SPDX_IDS) {
      if (expression.includes(licenseId.toLowerCase())) used.add(licenseId);
    }
  }
  return sorted(used);
}

async function readPackageLegalFiles(packageDirectory) {
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isLegalFileName(entry.name)) continue;
    const absolutePath = path.join(packageDirectory, entry.name);
    const details = await stat(absolutePath);
    if (details.size > 5 * 1024 * 1024) throw new Error(`Legal file is unexpectedly large: ${absolutePath}`);
    const buffer = await readFile(absolutePath);
    if (buffer.includes(0)) continue;
    files.push({ name: entry.name, text: normalizeText(buffer.toString("utf8")) });
  }
  return files;
}

function isLegalFileName(name) {
  return /^(?:licen[cs]e|copying|copyright|notice|third[-_. ]party)(?:$|[._-])/i.test(name);
}

function packageNameFromLockPath(relativePath) {
  return relativePath.replaceAll("\\", "/").split("node_modules/").at(-1);
}

function normalizeLicense(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map((item) => normalizeLicense(item)).filter(Boolean).join(" AND ");
  if (typeof value === "object") return normalizeLicense(value.type || value.name);
  const text = String(value).replace(/\s+/g, " ").trim();
  return /^apache-2\.0$/i.test(text) ? "Apache-2.0" : text;
}

function formatPerson(value) {
  if (!value) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  return [value.name, value.email].filter(Boolean).join(" ").trim();
}

function repositoryUrl(value) {
  if (!value) return "";
  const raw = typeof value === "string" ? value : value.url;
  return String(raw || "").replace(/^git\+/, "").replace(/\.git$/, "").trim();
}

function addMeaningful(set, value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized) set.add(normalized);
}

function sorted(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function normalizeText(value) {
  return String(value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trimEnd() + "\n";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchText(url, label) {
  const response = await fetch(url, { headers: { "User-Agent": "Zyra-license-generator" } });
  if (!response.ok) throw new Error(`${label} download failed (${response.status}): ${url}`);
  return response.text();
}
