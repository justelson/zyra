import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUN_RUNTIME_VERSION, currentTuiReleaseTarget, TUI_RELEASE_TARGETS, tuiReleaseAssetName } from "./tui-release-contract.mjs";
import { STANDALONE_WINDOWS_ICON_RESOURCE } from "../src/standalone-install-metadata.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(args.version || packageJson.version);
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta)(?:[.-]?\d+)?)?$/.test(version)) {
  throw new Error(`Invalid Zyra release version: ${version}`);
}
const targets = resolveTargets(args);
assertBunVersion();
const windowsIcon = path.join(root, "desktop", "resources", "icon.ico");
if (!existsSync(windowsIcon)) {
  throw new Error(`The shared Zyra release icon is missing: ${windowsIcon}`);
}
const outputDirectory = path.resolve(root, String(args.output || path.join("dist", "tui", `v${version}`)));
const buildRoot = path.join(root, "dist", ".tui-build");
const piBunOAuthModule = resolvePiBunOAuthModule();
const resources = await collectResources();
const hash = hashResources(resources);
const payload = {
  version,
  hash,
  resources: Object.fromEntries(resources.map(({ relativePath, content }) => [relativePath, content.toString("base64")])),
};

await mkdir(buildRoot, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

const outputs = [];
try {
  for (const target of targets) {
    const contract = TUI_RELEASE_TARGETS[target];
    const assetName = tuiReleaseAssetName(version, target);
    const output = path.join(outputDirectory, assetName);
    const entry = path.join(buildRoot, `entry-${target}.mjs`);
    const standaloneModule = relativeImport(entry, path.join(root, "src", "standalone-entry.mjs"));
    const bunOAuthModule = relativeImport(entry, piBunOAuthModule);
    await writeFile(entry, [
      `import { registerBunOAuthFlows } from ${JSON.stringify(bunOAuthModule)};`,
      `import { runZyraStandalone } from ${JSON.stringify(standaloneModule)};`,
      "registerBunOAuthFlows();",
      `await runZyraStandalone(${JSON.stringify(payload)});`,
      "",
    ].join("\n"), "utf8");
    await mkdir(path.dirname(output), { recursive: true });
    const compileArgs = [
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--no-compile-autoload-package-json",
      `--target=${contract.bunTarget}`,
      `--outfile=${output}`,
    ];
    if (target === "windows-x64") {
      compileArgs.push(
        `--windows-icon=${windowsIcon}`,
        "--windows-title=Zyra",
        "--windows-publisher=Zyra",
        `--windows-version=${windowsReleaseVersion(version)}`,
        "--windows-description=Zyra local coding agent",
        "--windows-copyright=Copyright 2026 justelson",
      );
    }
    compileArgs.push(entry);
    await run("bun", compileArgs);
    if (!output.endsWith(".exe")) await chmod(output, 0o755);
    outputs.push({ target, assetName: path.basename(output), output });
  }
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

for (const built of outputs) {
  const details = await stat(built.output);
  console.log(`Built ${built.target}: ${path.relative(root, built.output)} (${formatBytes(details.size)})`);
}

async function collectResources() {
  const files = [
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_LICENSES.txt",
    "install.ps1",
    "install.sh",
  ];
  for (const directory of ["analytics", "prompts", "agents", "workflows", "commands", "themes", "skills"]) {
    files.push(...await walk(directory));
  }
  const unique = [...new Set(files)].sort((left, right) => left.localeCompare(right));
  const resources = await Promise.all(unique.map(async (relativePath) => ({
    relativePath: relativePath.replaceAll("\\", "/"),
    content: await readFile(path.join(root, relativePath)),
  })));
  // The console executable and installer integration use the exact same ICO as
  // Desktop. Embed the bytes under a neutral asset path, not Desktop code.
  resources.push({ relativePath: STANDALONE_WINDOWS_ICON_RESOURCE, content: await readFile(windowsIcon) });
  return resources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walk(relativeDirectory) {
  const absolute = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function hashResources(resources) {
  const hash = createHash("sha256");
  for (const resource of resources) {
    hash.update(resource.relativePath);
    hash.update("\0");
    hash.update(resource.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function resolveTargets(options) {
  if (options.all) return Object.keys(TUI_RELEASE_TARGETS);
  const target = String(options.target || currentTuiReleaseTarget());
  if (!TUI_RELEASE_TARGETS[target]) throw new Error(`Unsupported --target=${target}`);
  return [target];
}

function windowsReleaseVersion(releaseVersion) {
  return `${releaseVersion.split("-", 1)[0]}.0`;
}

function relativeImport(fromFile, targetFile) {
  let relative = path.relative(path.dirname(fromFile), targetFile).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function resolvePiBunOAuthModule() {
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  let directory = path.dirname(piEntry);
  while (true) {
    const candidate = path.join(
      directory,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "bun-oauth.js",
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("The installed Pi runtime does not provide its standalone Bun OAuth registrar.");
}

function parseArgs(values) {
  return Object.fromEntries(values.map((value) => {
    const [key, ...rest] = value.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const executable = command === "bun" ? resolveBunExecutable() : command;
    const child = spawn(executable, commandArgs, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function resolveBunExecutable() {
  const explicit = String(process.env.BUN_EXECUTABLE ?? "").trim();
  if (explicit) return explicit;
  const pathEntries = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? ["bun.exe"] : ["bun"];
  for (const directory of pathEntries) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
    if (process.platform === "win32" && existsSync(path.join(directory, "bun.cmd"))) {
      const npmCandidate = path.join(directory, "node_modules", "bun", "bin", "bun.exe");
      if (existsSync(npmCandidate)) return npmCandidate;
    }
  }
  throw new Error("Bun is required to build the standalone Zyra TUI.");
}

function assertBunVersion() {
  const executable = resolveBunExecutable();
  const actual = execFileSync(executable, ["--version"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  if (actual !== BUN_RUNTIME_VERSION) {
    throw new Error(`Standalone TUI releases require Bun ${BUN_RUNTIME_VERSION}; got ${actual || "unknown"}.`);
  }
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
