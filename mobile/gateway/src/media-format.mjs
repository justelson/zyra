/** Identify supported container headers before transferring local media bytes. */
export function playbackMime(bytes, filename = '') {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes.subarray(0, 4).toString() === 'fLaC') return 'audio/flac';
  if (bytes.subarray(0, 4).toString() === 'OggS') return extension === 'ogv' ? 'video/ogg' : 'audio/ogg';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return extension === 'weba' ? 'audio/webm' : 'video/webm';
  if (bytes.subarray(4, 8).toString() === 'ftyp') return extension === 'm4a' || bytes.subarray(8, 12).toString() === 'M4A ' ? 'audio/mp4' : 'video/mp4';
  return null;
}
