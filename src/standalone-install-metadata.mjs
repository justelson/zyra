export const STANDALONE_WINDOWS_ICON_RESOURCE = 'assets/zyra.ico';

// Installer metadata must be available without starting Pi, reading credentials,
// opening a session or materializing the runtime into the user's data directory.
export function getStandaloneInstallMetadata(distribution) {
  const encoded = distribution?.resources?.[STANDALONE_WINDOWS_ICON_RESOURCE];
  if (typeof encoded !== 'string' || encoded.length > 1_400_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('The embedded Zyra installer icon is missing or invalid.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  const count = bytes.length >= 6 ? bytes.readUInt16LE(4) : 0;
  if (bytes.length < 22 || bytes.length > 1024 * 1024 || bytes.readUInt32LE(0) !== 65536 || !count || bytes.length < 6 + count * 16) {
    throw new Error('The embedded Zyra installer icon is not a valid ICO.');
  }
  for (let index = 0; index < count; index++) {
    const size = bytes.readUInt32LE(6 + index * 16 + 8);
    const offset = bytes.readUInt32LE(6 + index * 16 + 12);
    if (!size || offset < 6 + count * 16 || offset + size > bytes.length) throw new Error('The embedded Zyra icon frame is invalid.');
  }
  return { format: 1, version: String(distribution.version), windowsIconBase64: bytes.toString('base64') };
}
