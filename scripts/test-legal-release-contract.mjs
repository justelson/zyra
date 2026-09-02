#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const rootPackage = JSON.parse(read("package.json"));
const desktopPackage = JSON.parse(read("desktop/package.json"));
const license = read("LICENSE");
const notice = read("NOTICE");
const notices = read("THIRD_PARTY_NOTICES.md");
const licenses = read("THIRD_PARTY_LICENSES.txt");
const runtimeContract = read("desktop/scripts/release/runtime-contract.mjs");
const releasePreparation = read("desktop/scripts/release/prepare-release-resources.mjs");
const packagedValidator = read("desktop/scripts/release/validate-packaged-app.mjs");
const releaseWorkflow = read(".github/workflows/desktop-release.yml");
const standaloneBuilder = read("scripts/build-tui-release.mjs");
const standaloneDispatcher = read("bin/zyra.mjs");
const standaloneSmoke = read("scripts/test-standalone-tui-binary.mjs");

assert.match(license, /Apache License\s+Version 2\.0/);
assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, "the canonical Apache appendix must stay unchanged");
assert.equal(normalizedSha256(license), "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4");
assert.match(notice, /^Zyra\s+Copyright 2026 justelson/m);
assert.match(notice, /THIRD_PARTY_NOTICES\.md[\s\S]*THIRD_PARTY_LICENSES\.txt/);
assert.match(notices, /THIRD_PARTY_LICENSES\.txt/);
assert.match(notices, /Electron's license[\s\S]*Chromium's generated license list/);
assert.match(notices, /DOTNET-LICENSE\.txt[\s\S]*DOTNET-THIRD-PARTY-NOTICES\.txt/);
assert.match(notices, /Product logos from SVGL[\s\S]*MIT License/);
assert.match(notices, /Developer-tool logos from Simple Icons[\s\S]*CC0 1\.0 Universal/);
assert.match(notices, /Material Icon Theme file icons[\s\S]*MIT license/);
assert.match(notices, /Kenney UI Audio voice cues[\s\S]*CC0 1\.0 Universal/);
assert.match(licenses, /^Bundled Bun runtime: 1\.3\.9$/m);
assert.match(licenses, /^Bundled Node\.js runtime: 22\.22\.0$/m);
assert.equal(rootPackage.author, "justelson");
assert.equal(desktopPackage.author, "justelson");
assert.equal(desktopPackage.build.copyright, "Copyright © 2026 justelson");
assert.match(releaseWorkflow, /node-version: "22\.22\.0"/);
assert.match(standaloneBuilder, /const output = path\.join\(outputDirectory, assetName\)/);
assert.doesNotMatch(standaloneBuilder, /path\.extname\(outputRoot\)/);
assert.doesNotMatch(standaloneDispatcher, /--internal-standalone-oauth-smoke/);
assert.doesNotMatch(standaloneSmoke, /--internal-standalone-oauth-smoke/);
assert.match(releasePreparation, /NODE_RELEASE_RUNTIME_VERSION[\s\S]*DOTNET-LICENSE\.txt[\s\S]*DOTNET-THIRD-PARTY-NOTICES\.txt/);
assert(
  desktopPackage.build.mac.extraResources.some((entry) => entry.from === "node_modules/electron/dist/LICENSE" && entry.to === "ELECTRON-LICENSE.txt"),
  "macOS packages must carry Electron's license inside the app bundle",
);
assert(
  desktopPackage.build.mac.extraResources.some((entry) => entry.from === "node_modules/electron/dist/LICENSES.chromium.html" && entry.to === "CHROMIUM-THIRD-PARTY-LICENSES.html"),
  "macOS packages must carry Chromium's license list inside the app bundle",
);

for (const fileName of ["NOTICE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"]) {
  assert(rootPackage.files.includes(fileName), `root package allowlist must include ${fileName}`);
  assert(standaloneBuilder.includes(`"${fileName}"`), `standalone TUI must embed ${fileName}`);
  assert(standaloneSmoke.includes(`"${fileName}"`), `standalone TUI smoke must require ${fileName}`);
  assert(runtimeContract.includes(`'${fileName}'`), `staged runtime must include ${fileName}`);
  assert(
    desktopPackage.build.extraResources.some((entry) => entry.from === `../${fileName}` && entry.to === fileName),
    `Desktop package must include ${fileName}`,
  );
  assert(packagedValidator.includes(`path.join(resources, '${fileName}')`), `packaged app validator must require ${fileName}`);
}

for (const sourceOnlyPath of ["AGENTS.md", "scripts"]) {
  assert.equal(rootPackage.files.includes(sourceOnlyPath), false, `root runtime package must exclude source-only ${sourceOnlyPath}`);
}

const generatedCheck = spawnSync(process.execPath, [path.join(root, "scripts", "generate-third-party-licenses.mjs"), "--check"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(generatedCheck.status, 0, `${generatedCheck.stdout}\n${generatedCheck.stderr}`);

console.log("Zyra legal release contract: ok");

function normalizedSha256(value) {
  return createHash("sha256").update(String(value).replace(/\r\n?/g, "\n")).digest("hex");
}
