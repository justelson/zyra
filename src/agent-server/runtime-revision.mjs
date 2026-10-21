import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
// Version 2 includes compiled JS/CJS engine code as well as MJS modules.
export const RUNTIME_ACTIVATION_VERSION = 2;
const pendingRevisions = new Map();
/** Content fingerprint is portable across development and packaged runtime roots. */
export async function readRuntimeRevision(root) {
  const runtimeRoot = path.resolve(root);
  const pending = pendingRevisions.get(runtimeRoot);
  if (pending) return pending;
  // Share concurrent connection checks only. The next check still reads fresh
  // content, including source edits, additions and deletions in development.
  const request = computeRuntimeRevision(runtimeRoot).finally(() => {
    if (pendingRevisions.get(runtimeRoot) === request) pendingRevisions.delete(runtimeRoot);
  });
  pendingRevisions.set(runtimeRoot, request);
  return request;
}

async function computeRuntimeRevision(root) {
  const files = [];
  async function collect(relative) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await collect(child);
      else if (entry.isFile() && /\.(mjs|cjs|js|json|md)$/.test(entry.name)) files.push(child);
    }
  }
  for (const directory of ["src", "prompts", "agents"]) await collect(directory);
  if (!files.length) return null; // Test harnesses may have no installed runtime.
  files.push("package.json"); files.sort();
  const hash = createHash("sha256");
  hash.update(`zyra-runtime:${RUNTIME_ACTIVATION_VERSION}\0`);
  for (let offset = 0; offset < files.length; offset += 8) {
    const batch = files.slice(offset, offset + 8);
    const contents = await Promise.all(batch.map(file => readFile(path.join(root, file))));
    batch.forEach((file, index) => { hash.update(file); hash.update("\0"); hash.update(contents[index]); hash.update("\0"); });
  }
  return hash.digest("hex");
}
