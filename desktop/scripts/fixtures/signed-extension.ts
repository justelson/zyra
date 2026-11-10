import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { extensionIdFromPublicKey } from '../../src/main/browser-extension-package';
export function zipFiles(files: Record<string, string>): Buffer {
    const chunks: Buffer[] = [], central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
        const filename = Buffer.from(name), data = Buffer.from(text);
        let crc = 0xffffffff;
        for (const byte of data) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++)
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(filename.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x800, 8);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(data.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(filename.length, 28);
        entry.writeUInt32LE(offset, 42);
        chunks.push(local, filename, data);
        central.push(entry, filename);
        offset += local.length + filename.length + data.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, directory, end]);
}
function varint(value: number): Buffer { const bytes: number[] = []; do {
    bytes.push((value & 127) | (value > 127 ? 128 : 0));
    value = Math.floor(value / 128);
} while (value); return Buffer.from(bytes); }
function field(id: number, value: Buffer): Buffer { return Buffer.concat([varint(id * 8 + 2), varint(value.length), value]); }
export function signedExtension(files: Record<string, string>, algorithm: 'rsa' | 'ec' = 'rsa', identity?: {
    publicKey: KeyObject;
    privateKey: KeyObject;
}) {
    const developer = identity || (algorithm === 'rsa' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ec', { namedCurve: 'prime256v1' }));
    const publisher = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = developer.publicKey.export({ format: 'der', type: 'spki' }), id = extensionIdFromPublicKey(key);
    const signedData = field(1, createHash('sha256').update(key).digest().subarray(0, 16)), size = Buffer.alloc(4);
    size.writeUInt32LE(signedData.length);
    const archive = zipFiles(files), payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signedData, archive]);
    const proof = (pair: typeof developer, kind: number) => field(kind, Buffer.concat([field(1, pair.publicKey.export({ format: 'der', type: 'spki' })), field(2, sign('sha256', payload, pair.privateKey))]));
    const header = Buffer.concat([proof(publisher, 2), proof(developer, algorithm === 'rsa' ? 2 : 3), field(10000, signedData)]), prefix = Buffer.alloc(12);
    prefix.write('Cr24');
    prefix.writeUInt32LE(3, 4);
    prefix.writeUInt32LE(header.length, 8);
    return { bytes: Buffer.concat([prefix, header, archive]), id, key, repack: (next: Record<string, string>) => signedExtension(next, algorithm, developer) };
}
export function fixtureExtension() {
    return signedExtension({
        'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Zyra install check', version: '1.0.0', permissions: ['storage'], content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }),
        'content.js': 'document.documentElement.dataset.zyraInstalled=chrome.runtime.id;',
        'check.html': '<!doctype html><title>Extension identity check</title>'
    });
}
