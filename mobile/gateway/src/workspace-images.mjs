import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveWorkspaceDestination } from './workspace-destinations.mjs';

import { assert } from './errors.mjs';
import { detectPromptImageMimeType } from '../../../src/prompt-images.mjs';
import { playbackMime } from './media-format.mjs';

const LIMIT = 20 * 1024 * 1024, CHUNK = 48 * 1024;
const etag = metadata => `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;

// Resolve only within the same authorized chat roots as Files. References contain
// relative paths, never a grant: every chunk rechecks roots, symlinks and file state.
export async function readWorkspaceImage(files, method, params, chat) {
  const playback = method.startsWith('workspace.media');
  const limit = playback ? 64 * 1024 * 1024 : LIMIT;
  const opening = method === 'workspace.image' || method === 'workspace.media';
  let target, source;
  if (opening) {
    ({ target, source } = await resolveWorkspaceDestination(files, chat, params.destination, params));
  } else {
    const ref = params.ref;
    assert(ref?.source?.kind === (playback ? 'workspace-media' : 'workspace') && typeof ref.source.rootId === 'string' && typeof ref.source.path === 'string'
      && typeof ref.source.etag === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256)
      && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= limit, 'Invalid media reference.');
    target = (await files.target(chat, ref.source)).target;
    source = ref.source;
  }
  const handle = await open(target, 'r');
  try {
    const metadata = await handle.stat();
    assert(metadata.isFile() && metadata.size > 0 && metadata.size <= limit, playback ? 'Media can be up to 64 MB.' : 'Images can be up to 20 MB.');
    const header = Buffer.alloc(Math.min(512, metadata.size));
    const first = await handle.read(header, 0, header.length, 0);
    const mimeType = playback ? playbackMime(header.subarray(0, first.bytesRead), target) : detectPromptImageMimeType(header.subarray(0, first.bytesRead));
    assert(mimeType, playback ? 'This audio or video format cannot be opened.' : 'This image format cannot be opened.');
    if (opening) {
      const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK);
      let offset = 0;
      while (offset < metadata.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, metadata.size - offset), offset);
        assert(bytesRead > 0, 'This image changed. Open it again.');
        hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      }
      assert(etag(await handle.stat()) === etag(metadata), 'This image changed. Open it again.');
      return { mediaRef: { version: 2, sha256: hash.digest('hex'), bytes: metadata.size, mimeType, source: { ...source, kind: playback ? 'workspace-media' : source.kind, etag: etag(metadata) } } };
    }
    const ref = params.ref, offset = params.offset;
    assert(etag(metadata) === source.etag && metadata.size === ref.bytes && mimeType === ref.mimeType, 'This image changed. Open it again.');
    assert(Number.isSafeInteger(offset) && offset >= 0 && offset < metadata.size, 'Invalid image offset.');
    const buffer = Buffer.alloc(Math.min(CHUNK, metadata.size - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    assert(bytesRead > 0 && etag(await handle.stat()) === source.etag, 'This image changed. Open it again.');
    return { base64: buffer.subarray(0, bytesRead).toString('base64'), next: offset + bytesRead, total: metadata.size, sha256: ref.sha256 };
  } finally { await handle.close(); }
}

