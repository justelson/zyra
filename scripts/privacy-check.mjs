#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localPatternsPath = path.join(repoRoot, ".zyra", "privacy-patterns.json");

const genericChecks = [
  {
    label: "absolute Windows user path",
    pattern: /\b[A-Za-z]:[\\/]+Users[\\/]+(?!(?:dev|developer|person|private|example(?:[ _-]?(?:person|user))?|user(?:name)?|test|sample)(?:[\\/]|["')]|$))[^\\/:\s"']+/i,
  },
  {
    label: "absolute macOS user path",
    pattern: /(?:^|[\s"'(])\/Users\/(?!(?:dev|developer|person|private|example|user(?:name)?|test|sample)(?:\/|["')]|$))[A-Za-z0-9._-]+/i,
  },
  {
    label: "absolute Linux home path",
    pattern: /(?:^|[\s"'(])\/home\/(?!(?:dev|developer|person|private|example|user(?:name)?|test|sample)(?:\/|["')]|$))[A-Za-z0-9._-]+/i,
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "GitHub access token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  },
  {
    label: "OpenAI API key",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/,
  },
  {
    label: "Anthropic API key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/,
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
];

let checks;
try {
  checks = [...genericChecks, ...loadLocalChecks(localPatternsPath)];
} catch (error) {
  console.error("privacy-check: invalid local pattern file");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const findings = trackedIgnoredFiles().map((file) => ({
  file,
  line: null,
  label: "tracked path matches .gitignore",
}));

const publicFiles = gitFiles();
for (const file of publicFiles.filter(isLocalOnlyPath)) {
  findings.push({ file, line: null, label: "local-only path is not ignored" });
}

for (const file of publicFiles.filter(shouldScan)) {
  const absoluteFile = path.join(repoRoot, file);
  if (!existsSync(absoluteFile)) continue;

  let text = "";
  try {
    const buffer = readFileSync(absoluteFile);
    if (buffer.includes(0)) continue;
    text = buffer.toString("utf8");
  } catch {
    continue;
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const scannableLine = redactOpaqueLockIntegrity(file, lines[index]);
    for (const check of checks) {
      check.pattern.lastIndex = 0;
      if (!check.pattern.test(scannableLine)) continue;
      findings.push({ file, line: index + 1, label: check.label });
    }
  }
}

if (findings.length) {
  console.error("privacy-check: found public or incorrectly tracked local material\n");
  for (const finding of findings) {
    const location = finding.line === null ? finding.file : finding.file + ":" + finding.line;
    console.error(location + " [" + finding.label + "]");
  }
  console.error("\nMove private context into ignored local files or rewrite it generically.");
  process.exit(1);
}

console.log("privacy-check: ok");

function gitLines(args) {
  const output = execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return output.split(/\r?\n/).filter(Boolean);
}

function gitFiles() {
  return gitLines(["ls-files", "--cached", "--others", "--exclude-standard"]);
}

function trackedIgnoredFiles() {
  return gitLines(["ls-files", "-ci", "--exclude-standard"]);
}

function isLocalOnlyPath(file) {
  return file === "AGENTS.override.md"
    || file === "AGENTS.local.md"
    || /^(?:\.agents|\.codex|\.release|\.zyra|docs\.local|resources)\//.test(file);
}

function loadLocalChecks(file) {
  if (!existsSync(file)) return [];

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error("Could not parse " + file + ": " + (error instanceof Error ? error.message : String(error)));
  }

  if (!parsed || !Array.isArray(parsed.checks)) {
    throw new Error(file + " must contain a checks array.");
  }

  return parsed.checks.map((check, index) => {
    if (!check || typeof check.label !== "string" || typeof check.pattern !== "string") {
      throw new Error(file + " check " + (index + 1) + " needs string label and pattern fields.");
    }
    const flags = typeof check.flags === "string" ? check.flags : "i";
    if (!/^[imsu]*$/.test(flags)) {
      throw new Error(file + " check " + (index + 1) + " has unsupported regular-expression flags.");
    }
    return { label: check.label, pattern: new RegExp(check.pattern, flags) };
  });
}

function redactOpaqueLockIntegrity(file, line) {
  if (file.endsWith("package-lock.json") || file.endsWith("npm-shrinkwrap.json")) {
    return line.replace(/("integrity"\s*:\s*")[^"]+("?)/g, "$1<integrity>$2");
  }
  if (file.endsWith("bun.lock") || file.endsWith("yarn.lock") || file.endsWith("pnpm-lock.yaml")) {
    return line.replace(/sha(?:256|512)-[A-Za-z0-9+/=_-]+/g, "<integrity>");
  }
  return line;
}

function shouldScan(file) {
  if (file === "THIRD_PARTY_LICENSES.txt") return false;
  if (file.startsWith("node_modules/") || file.startsWith("dist/")) return false;
  if (/\.(png|jpe?g|gif|webp|ico|zip|sqlite|lockb)$/i.test(file)) return false;
  return true;
}
