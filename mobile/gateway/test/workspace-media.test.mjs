import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceFiles } from '../src/workspace-files.mjs';
import { playbackMime } from '../src/media-format.mjs';
import { isRead } from '../src/router.mjs';

test('audio/video references transfer checked bytes and recheck the shared chat scope on every chunk', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zyra-mobile-playback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wav = Buffer.alloc(80_000); wav.write('RIFF'); wav.write('WAVE', 8);
  await writeFile(path.join(dir, 'voice.wav'), wav);
  await writeFile(path.join(dir, 'fake.mp4'), '<html>not a video</html>');
  let allowed = true;
  const files = new WorkspaceFiles({ allProjects: true, allowsProject: () => allowed,
    resolveScope: async () => ({ workingRoot: dir, roots: [{ path: dir, kind: 'project-home' }] }) });
  const chat = { canonicalChatId: 'chat', project: dir };
  const { mediaRef: ref } = await files.dispatch('workspace.media', { destination: 'voice.wav' }, chat);
  assert.equal(ref.mimeType, 'audio/wav'); assert.equal(ref.source.kind, 'workspace-media');
  assert(isRead('workspace.media')); assert(isRead('workspace.media.chunk'));
  const chunks = [];
  for (let offset = 0; offset < ref.bytes;) {
    const chunk = await files.dispatch('workspace.media.chunk', { ref, offset }, chat);
    chunks.push(Buffer.from(chunk.base64, 'base64')); assert(chunk.next - offset <= 49152); offset = chunk.next;
  }
  assert.deepEqual(Buffer.concat(chunks), wav);
  await assert.rejects(files.dispatch('workspace.media', { destination: 'fake.mp4' }, chat));
  await assert.rejects(files.dispatch('workspace.media', { destination: '../outside.wav' }, chat));
  allowed = false;
  await assert.rejects(files.dispatch('workspace.media.chunk', { ref, offset: 0 }, chat));
  allowed = true;
  await writeFile(path.join(dir, 'voice.wav'), Buffer.concat([wav, Buffer.from('changed')]));
  await assert.rejects(files.dispatch('workspace.media.chunk', { ref, offset: 0 }, chat));
});

test('container detection covers current supported audio and video without trusting extensions alone', () => {
  assert.equal(playbackMime(Buffer.from('ID3fixture'), 'a.mp3'), 'audio/mpeg');
  assert.equal(playbackMime(Buffer.from('fLaCfixture'), 'a.flac'), 'audio/flac');
  assert.equal(playbackMime(Buffer.from('0000ftypM4A '), 'a.m4a'), 'audio/mp4');
  assert.equal(playbackMime(Buffer.from('0000ftypisom'), 'a.mp4'), 'video/mp4');
  assert.equal(playbackMime(Buffer.from('<html>'), 'a.mp4'), null);
});
