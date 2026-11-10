import { realpath, readdir, stat, open, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readWorkspaceGit } from './workspace-git.mjs';
import { readWorkspaceImage } from './workspace-images.mjs';
import { resolveWorkspaceLink } from './workspace-destinations.mjs';
import { workspaceScope } from './workspace-scope.mjs';
import { moveWorkspaceFile } from './workspace-move.mjs';
import path from 'node:path';
import { assert, fault } from './errors.mjs';
const sharedWrites = new Map();
const TEXT_LIMIT = 128 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
async function smallFile(target) {
  const handle = await open(target, 'r');
  try {
    const buffer = Buffer.alloc(TEXT_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) { const chunk = await handle.read(buffer, length, buffer.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
    assert(length <= TEXT_LIMIT, 'This file is too large for the editor.');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
export const WORKSPACE_READS = new Set(['workspace.roots', 'workspace.files.list', 'workspace.file.read', 'workspace.file.chunk', 'workspace.git.status', 'workspace.git.diff', 'workspace.image', 'workspace.image.chunk', 'workspace.media', 'workspace.media.chunk', 'workspace.link']);
export const WORKSPACE_METHODS = new Set([...WORKSPACE_READS, 'workspace.file.write', 'workspace.move']);
export class WorkspaceFiles {
  constructor({ projects, resolveScope, allProjects = false, allowsProject, hiddenProjects = [] }) { this.allProjects = allProjects; this.allowsProject = allowsProject; this.projects = projects; this.resolveScope = resolveScope; this.hiddenProjects = hiddenProjects; this.writes = sharedWrites; }
  async roots(chat) {
    const scope = await this.resolveScope?.(chat.canonicalChatId);
    const candidates = scope?.roots || [{ path: chat.project, label: path.basename(chat.project), access: 'read-write' }];
    const workingRoot = scope?.workingRoot ? await realpath(scope.workingRoot).catch(() => null) : null;
    const roots = [];
    const policy = await workspaceScope(this.hiddenProjects);
    for (const candidate of candidates) {
      if (!await policy.allows(candidate.path)) continue;
      const root = await (async () => {
        try { const resolved = await realpath(candidate.path); return (await stat(resolved)).isDirectory() ? resolved : null; }
        catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
      })();
      if (!root) continue;
      if (this.allProjects ? !this.allowsProject(root) : !this.projects.some(project => within(project, root))) continue;
      roots.push({ id: digest(root).slice(0, 16), path: root, label: candidate.label || path.basename(root), readOnly: candidate.access === 'read-only',
        priority: candidate.kind === 'associated-folder' ? (root === workingRoot ? 0 : 1) : 2 });
    }
    // Existing clients select the first root. Prefer the canonical attached working
    // folder, after applying device scope; retain homes as explicit choices.
    return roots.sort((a, b) => a.priority - b.priority).map(({ priority: _priority, ...root }) => root);
  }
  async target(chat, params, write = false) {
    const roots = await this.roots(chat);
    const root = roots.find(root => root.id === params.rootId) || (!params.rootId && roots.length === 1 ? roots[0] : null);
    assert(root, 'Choose an available shared folder.');
    assert(!write || !root.readOnly, 'This chat has read-only access to that folder.');
    const name = String(params.path || '');
    assert(name.length <= 4096 && !name.includes('\0') && !path.isAbsolute(name) && !/^[a-z]:/i.test(name), 'Use a path inside the shared folder.');
    const candidate = path.resolve(root.path, name);
    assert(within(root.path, candidate), 'This path is outside the shared folder.');
    const target = await realpath(candidate);
    assert(within(root.path, target), 'This link points outside the shared folder.');
    const policy = await workspaceScope(this.hiddenProjects);
    assert(await policy.allows(candidate) && await policy.allows(target), 'This path is not shared with this device.');
    return { root, target };
  }
  async dispatch(method, params, chat) {
    if (method === 'workspace.move') return moveWorkspaceFile(this, params, chat);
    if (method === 'workspace.link') return resolveWorkspaceLink(this, chat, params.destination, params);
    if (['workspace.image', 'workspace.image.chunk', 'workspace.media', 'workspace.media.chunk'].includes(method)) return readWorkspaceImage(this, method, params, chat);
    if (method === 'workspace.roots') return { roots: (await this.roots(chat)).map(({ path: _path, ...root }) => root) };
    if (method === 'workspace.git.status' || method === 'workspace.git.diff') {
      const {root}=await this.target(chat,{...params,path:''});
      return readWorkspaceGit(method,root,params,await workspaceScope(this.hiddenProjects));
    }
    const { root, target } = await this.target(chat, params, method === 'workspace.file.write');
    if (method === 'workspace.files.list') {
      const policy = await workspaceScope(this.hiddenProjects);
      const visible = [];
      for (const entry of await readdir(target, { withFileTypes: true })) {
        if (this.hiddenProjects.length && !await policy.allows(path.join(target, entry.name))) continue;
        visible.push(entry);
      }
      const query = String(params.query || '').trim().slice(0, 160).toLocaleLowerCase();
      const entries = visible.filter(entry => (params.hidden === true || !entry.name.startsWith('.')) && (!query || entry.name.toLocaleLowerCase().includes(query)))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      const offset = Math.max(0, Math.min(entries.length, Number.isSafeInteger(params.offset) ? params.offset : 0));
      const page = [];
      for (const entry of entries.slice(offset, offset + 200)) {
        let directory = entry.isDirectory(), accessible = true;
        if (entry.isSymbolicLink()) {
          try { const resolved = await realpath(path.join(target, entry.name)); accessible = within(root.path, resolved); if (accessible) directory = (await stat(resolved)).isDirectory(); }
          catch { accessible = false; }
        }
        page.push({ name: entry.name, path: path.relative(root.path, path.join(target, entry.name)).replaceAll('\\', '/'), directory, accessible });
      }
      return { entries: page, nextOffset: offset + 200 < entries.length ? offset + 200 : null };
    }
    if (method === 'workspace.file.read') {
      const handle = await open(target, 'r');
      try {
        const metadata = await handle.stat(); assert(metadata.isFile(), 'Choose a file.');
        const etag = metadata.size + ':' + metadata.mtimeMs;
        if (metadata.size > TEXT_LIMIT) return { large: true, size: metadata.size, etag, readOnly: root.readOnly };
        const bytes = await smallFile(target);
        if (bytes.includes(0)) return { binary: true, size: metadata.size, etag, readOnly: root.readOnly };
        try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), hash: digest(bytes), size: bytes.length, readOnly: root.readOnly, etag }; }
        catch { return { binary: true, size: metadata.size, etag, readOnly: root.readOnly }; }
      } finally { await handle.close(); }
    }
    if (method === 'workspace.file.chunk') {
      const offset = params.offset ?? 0; assert(Number.isSafeInteger(offset) && offset >= 0, 'Invalid file offset.');
      const handle = await open(target, 'r');
      try {
        const metadata = await handle.stat(); assert(metadata.isFile(), 'Choose a file.');
        const etag = metadata.size + ':' + metadata.mtimeMs;
        assert(params.etag === etag, 'This file changed. Refresh it before continuing the transfer.');
        assert(offset <= metadata.size, 'Invalid file offset.');
        const length = params.length ?? 48 * 1024;
        assert(Number.isSafeInteger(length) && length >= 8 * 1024 && length <= 48 * 1024, 'Invalid file chunk size.');
        const buffer = Buffer.alloc(Math.min(length, metadata.size - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        const after = await handle.stat();
        assert(after.size + ':' + after.mtimeMs === etag, 'This file changed. Refresh it before continuing the transfer.');
        return { base64: buffer.subarray(0, bytesRead).toString('base64'), next: offset + bytesRead, total: metadata.size, etag };
      } finally { await handle.close(); }
    }
    if (method === 'workspace.file.write') {
      assert(typeof params.text === 'string' && Buffer.byteLength(params.text) <= TEXT_LIMIT, 'Text exceeds the mobile editor limit.');
      assert(typeof params.hash === 'string' && /^[a-f0-9]{64}$/.test(params.hash), 'Refresh this file before saving.');
      const previous = this.writes.get(target) || Promise.resolve();
      const pending = previous.catch(() => {}).then(async () => {
        const original = await smallFile(target); assert(original.length <= TEXT_LIMIT, 'This file is too large for the editor.');
        if (digest(original) !== params.hash) throw fault('FILE_CONFLICT', 'The file changed on the PC. Reload it before saving your edit.');
        const content = Buffer.from(params.text);
        const hasBom = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
        const bytes = hasBom && !content.subarray(0, 3).equals(original.subarray(0, 3)) ? Buffer.concat([original.subarray(0, 3), content]) : content;
        assert(bytes.length <= TEXT_LIMIT, 'Text exceeds the mobile editor limit.');
        const temporary = path.join(path.dirname(target), '.zyra-mobile-' + randomUUID() + '.tmp');
        try {
          const metadata = await stat(target);
          await writeFile(temporary, bytes, { mode: metadata.mode & 0o777, flag: 'wx' });
          await this.target(chat, params, true);
          if (digest(await smallFile(target)) !== params.hash) throw fault('FILE_CONFLICT', 'The file changed while saving. Your edit has not replaced it.');
          await rename(temporary, target);
          return { hash: digest(bytes), saved: true };
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      });
      this.writes.set(target, pending);
      try { return await pending; } finally { if (this.writes.get(target) === pending) this.writes.delete(target); }
    }
    throw fault('METHOD_NOT_ALLOWED', 'This workspace action is unavailable.');
  }
}
