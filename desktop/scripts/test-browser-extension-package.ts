import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { signedExtension, zipFiles } from './fixtures/signed-extension';
import { verifyChromeExtensionPackage, extensionIdFromPublicKey } from '../src/main/browser-extension-package';
import { extractCrxToDirectory } from '../src/main/browser-extension-crx';
const directory = await mkdtemp(join(tmpdir(), 'zyra-extension-package-'));
try {
    for (const algorithm of ['rsa', 'ec'] as const) {
        const pack = signedExtension({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Fixture', version: '1' }), 'content.js': '/* fixture */' }, algorithm);
        assert.equal(pack.id.length, 32);
        assert.match(pack.id, /^[a-p]{32}$/);
        const verified = verifyChromeExtensionPackage(pack.bytes, pack.id);
        assert.equal(verified.publicKey.toString('base64'), pack.key.toString('base64'), 'publisher-first packages select the actual developer key');
        const target = join(directory, algorithm);
        await extractCrxToDirectory(pack.bytes, target, pack.id);
        const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
        assert.equal(extensionIdFromPublicKey(Buffer.from(manifest.key, 'base64')), pack.id, 'unpacked installation retains its store identity');
        const tampered = Buffer.from(pack.bytes);
        tampered[tampered.length - 23] ^= 1;
        assert.throws(() => verifyChromeExtensionPackage(tampered, pack.id), /signature|identity/i);
        assert.throws(() => verifyChromeExtensionPackage(pack.bytes, 'a'.repeat(32)), /identity/i);
    }
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }), key = pair.publicKey.export({ format: 'der', type: 'spki' }), archive = zipFiles({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'CRX2 fixture', version: '1' }) });
    const signature = sign('sha1', archive, pair.privateKey), prefix = Buffer.alloc(16);
    prefix.write('Cr24');
    prefix.writeUInt32LE(2, 4);
    prefix.writeUInt32LE(key.length, 8);
    prefix.writeUInt32LE(signature.length, 12);
    const crx2 = Buffer.concat([prefix, key, signature, archive]);
    assert.equal(verifyChromeExtensionPackage(crx2, extensionIdFromPublicKey(key)).publicKey.toString('hex'), key.toString('hex'));
    const tampered2 = Buffer.from(crx2);
    tampered2[tampered2.length - 1] ^= 1;
    assert.throws(() => verifyChromeExtensionPackage(tampered2, extensionIdFromPublicKey(key)), /signature/i);
    assert.throws(() => verifyChromeExtensionPackage(Buffer.from('Cr24'), 'a'.repeat(32)), /CRX|truncated/i);
    assert.throws(() => verifyChromeExtensionPackage(zipFiles({ 'manifest.json': '{}' }), 'a'.repeat(32)), /signed CRX/i, 'a bare ZIP cannot impersonate a signed Store package');
    const bad = signedExtension({ '../escape.txt': 'no', 'manifest.json': '{}' });
    await assert.rejects(extractCrxToDirectory(bad.bytes, join(directory, 'unsafe'), bad.id), /relative path|unsafe/i);
    console.log('Extension package: CRX2/CRX3 RSA/ECDSA, multiple publisher/developer proofs, signature tampering, wrong identity, unsigned ZIP, path traversal and stable runtime identity passed');
}
finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-extension-package-'))
        throw Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
}
