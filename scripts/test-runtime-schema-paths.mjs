import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'zyra-schema-paths-'));
const trees = [path.join(directory, 'flat'), path.join(directory, 'nested', 'worktree')];
try {
  const generator = await readFile(path.join(root, 'scripts/build-runtime-schema.mjs'));
  const strictLicenseCase = path.join(directory, 'strict-license-case.cjs');
  await writeFile(strictLicenseCase, `
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const read = fs.promises.readFile;
fs.promises.readFile = async (input, ...options) => {
  const file = input instanceof URL ? fileURLToPath(input) : input;
  if (typeof file === 'string' && path.basename(file).toLowerCase() === 'license') {
    const names = await fs.promises.readdir(path.dirname(file));
    if (!names.includes(path.basename(file))) throw Object.assign(new Error('Case-sensitive license filename mismatch: ' + file), {code:'ENOENT'});
  }
  return read(input, ...options);
};
require('node:module').syncBuiltinESMExports();
`);
  const dependencies = await realpath(path.join(root, 'node_modules'));
  for (const tree of trees) {
    await mkdir(path.join(tree, 'scripts'), { recursive: true });
    await symlink(dependencies, path.join(tree, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(tree, 'scripts/build-runtime-schema.mjs'), generator);
    execFileSync(process.execPath, ['--require', strictLicenseCase, path.join(tree, 'scripts/build-runtime-schema.mjs')], { cwd: tree, stdio: 'pipe', timeout: 30_000 });
  }
  const outputs = trees.map(tree => path.join(tree, 'src/runtime/schema/bundled'));
  const files = (await readdir(outputs[0])).sort();
  assert.deepEqual((await readdir(outputs[1])).sort(), files, 'worktree depth must not change generated chunk identities');
  for (const file of files) assert.deepEqual(await readFile(path.join(outputs[0], file)), await readFile(path.join(outputs[1], file)), `${file} must have byte-identical output through dependency junctions`);
  console.log(`Runtime schema generation is byte-identical across dependency junctions and worktree depths (${files.length} files).`);
} finally {
  // Detach junctions before removing fixtures; never traverse shared dependencies.
  for (const tree of trees) await rm(path.join(tree, 'node_modules'), { force: true }).catch(async error => {
    if (process.platform !== 'win32') throw error;
    const { rmdir } = await import('node:fs/promises');
    await rmdir(path.join(tree, 'node_modules'));
  });
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
