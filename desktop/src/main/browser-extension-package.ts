import { createHash, createPublicKey, verify } from 'node:crypto'

const MAX_HEADER_BYTES = 1024 * 1024
type Proof = { algorithm: number; publicKey: Buffer; signature: Buffer }
type Header = { offset: number; publicKey: Buffer | null; proofs?: Proof[]; signedData?: Buffer; signature?: Buffer }

export function extensionIdFromPublicKey(key: Uint8Array): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 32)
        .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)))
}

function uint32(bytes: Uint8Array, offset: number): number {
    if (offset + 4 > bytes.length) throw new Error('The CRX header is truncated.')
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

/** CRX protobufs use length-delimited fields. Unknown scalar fields are skipped. */
function fields(bytes: Uint8Array): Array<{ id: number; value: Buffer }> {
    let offset = 0
    const varint = () => {
        let value = 0
        for (let shift = 0; shift < 35 && offset < bytes.length; shift += 7) {
            const byte = bytes[offset++]
            value += (byte & 127) * 2 ** shift
            if (!(byte & 128)) {
                if (value > 0xffffffff) break
                return value
            }
        }
        throw new Error('The CRX header contains an invalid protobuf.')
    }
    const result: Array<{ id: number; value: Buffer }> = []
    while (offset < bytes.length) {
        const tag = varint(), wire = tag & 7
        if (!(tag >>> 3)) throw new Error('The CRX header contains an invalid field.')
        if (wire === 0) { varint(); continue }
        const length = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1
        if (length < 0 || length > bytes.length - offset) throw new Error('The CRX header is truncated or invalid.')
        if (wire === 2) result.push({ id: tag >>> 3, value: Buffer.from(bytes.subarray(offset, offset + length)) })
        offset += length
    }
    return result
}

export function unpackedZipOffset(crx: Uint8Array): Header {
    if (crx.length >= 4 && uint32(crx, 0) === 0x04034b50) return { offset: 0, publicKey: null }
    if (crx.length < 12 || uint32(crx, 0) !== 0x34327243) throw new Error('The download is not a CRX extension package.')
    const version = uint32(crx, 4)
    if (version === 2) {
        const keyLength = uint32(crx, 8), signatureLength = uint32(crx, 12)
        const offset = 16 + keyLength + signatureLength
        if (keyLength + signatureLength > MAX_HEADER_BYTES || offset >= crx.length) throw new Error('The CRX2 header is invalid.')
        return { offset, publicKey: Buffer.from(crx.subarray(16, 16 + keyLength)), signature: Buffer.from(crx.subarray(16 + keyLength, offset)) }
    }
    if (version !== 3) throw new Error(`Unsupported CRX version ${version}.`)
    const length = uint32(crx, 8), offset = 12 + length
    if (length > MAX_HEADER_BYTES || offset >= crx.length) throw new Error('The CRX3 header is invalid.')
    const header = fields(crx.subarray(12, offset)), proofs: Proof[] = []
    const signed = header.filter(field => field.id === 10000)
    if (signed.length !== 1) throw new Error('The CRX3 signed header is missing or invalid.')
    for (const field of header.filter(field => field.id === 2 || field.id === 3)) {
        const proof = fields(field.value)
        const keys = proof.filter(part => part.id === 1), signatures = proof.filter(part => part.id === 2)
        if (keys.length !== 1 || signatures.length !== 1) throw new Error('The CRX3 signing proof is invalid.')
        proofs.push({ algorithm: field.id, publicKey: keys[0].value, signature: signatures[0].value })
    }
    return { offset, publicKey: proofs[0]?.publicKey || null, proofs, signedData: signed[0].value }
}

/** Match the developer proof, not the Web Store publisher proof that can precede it. */
export function verifyChromeExtensionPackage(bytes: Buffer, expectedId: string): { offset: number; publicKey: Buffer } {
    if (!/^[a-p]{32}$/.test(expectedId)) throw new Error('The requested extension identity is invalid.')
    const header = unpackedZipOffset(bytes)
    if (!header.offset || !header.publicKey) throw new Error('Chrome Web Store extensions require a signed CRX package.')
    let signedBytes: Buffer, proofs: Proof[]
    if (header.signedData && header.proofs) {
        const ids = fields(header.signedData).filter(field => field.id === 1)
        if (ids.length !== 1 || ids[0].value.length !== 16
            || ids[0].value.toString('hex').replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16))) !== expectedId) {
            throw new Error('The signed package identity does not match the requested extension.')
        }
        const length = Buffer.alloc(4); length.writeUInt32LE(header.signedData.length)
        signedBytes = Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, header.signedData, bytes.subarray(header.offset)])
        proofs = header.proofs
    } else {
        signedBytes = bytes.subarray(header.offset)
        proofs = [{ algorithm: 2, publicKey: header.publicKey, signature: header.signature! }]
    }
    for (const proof of proofs) {
        if (extensionIdFromPublicKey(proof.publicKey) !== expectedId) continue
        try {
            const key = createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' })
            if (key.asymmetricKeyType !== (proof.algorithm === 2 ? 'rsa' : 'ec')) continue
            if (verify(header.signedData ? 'sha256' : 'sha1', signedBytes, key, proof.signature)) return { offset: header.offset, publicKey: proof.publicKey }
        } catch { /* Another proof may carry the requested developer key. */ }
    }
    throw new Error('The extension package signature or identity could not be verified.')
}
