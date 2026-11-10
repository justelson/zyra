import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import yauzl from 'yauzl'
import { verifyChromeExtensionPackage } from './browser-extension-package'

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
const MAX_FILES = 10_000
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024

export { unpackedZipOffset } from './browser-extension-package'

export async function downloadChromeWebStoreCrx(extensionId: string): Promise<{ bytes: Buffer; sha256: string }> {
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc&prodversion=${process.versions.chrome}`
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Chrome Web Store returned HTTP ${response.status}.`)
    const advertisedLength = Number(response.headers.get('content-length') || 0)
    if (advertisedLength > MAX_DOWNLOAD_BYTES) throw new Error('The extension package is too large.')
    if (!response.body) throw new Error('Chrome Web Store returned an empty response.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > MAX_DOWNLOAD_BYTES) throw new Error('The extension package is too large.')
        chunks.push(next.value)
    }
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { bytes, sha256 }
}

export async function extractCrxToDirectory(bytes: Buffer, destination: string, expectedId: string): Promise<{ sha256: string }> {
    const { offset, publicKey } = verifyChromeExtensionPackage(bytes, expectedId)
    destination = resolve(destination)
    const zipBytes = bytes.subarray(offset)
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    try {
        await new Promise<void>((resolvePromise, reject) => {
            yauzl.fromBuffer(zipBytes, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
                if (error || !zipFile) return reject(error || new Error('The extension ZIP could not be opened.'))
                let files = 0
                let unpackedBytes = 0
                let settled = false
                const fail = (failure: Error) => {
                    if (settled) return
                    settled = true
                    zipFile.close()
                    reject(failure)
                }
                zipFile.on('error', fail)
                zipFile.on('end', () => {
                    if (!settled) { settled = true; resolvePromise() }
                })
                zipFile.on('entry', entry => {
                    if (settled) return
                    files += 1
                    if (files > MAX_FILES) return fail(new Error('The extension contains too many files.'))
                    const normalized = entry.fileName.replace(/\\/g, '/')
                    const target = resolve(destination, normalized)
                    if (target !== destination && !target.startsWith(`${resolve(destination)}${sep}`)) return fail(new Error('The extension contains an unsafe file path.'))
                    if (normalized.endsWith('/')) {
                        void mkdir(target, { recursive: true }).then(() => zipFile.readEntry()).catch(fail)
                        return
                    }
                    unpackedBytes += entry.uncompressedSize
                    if (unpackedBytes > MAX_UNPACKED_BYTES) return fail(new Error('The unpacked extension is too large.'))
                    void mkdir(dirname(target), { recursive: true }).then(() => {
                        zipFile.openReadStream(entry, (streamError, stream) => {
                            if (streamError || !stream) return fail(streamError || new Error('The extension file could not be read.'))
                            const output = createWriteStream(target, { flags: 'wx' })
                            stream.on('error', fail)
                            output.on('error', fail)
                            output.on('close', () => { if (!settled) zipFile.readEntry() })
                            stream.pipe(output)
                        })
                    }).catch(fail)
                })
                zipFile.readEntry()
            })
        })
        const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8')) as { manifest_version?: number; key?: string }
        if (manifest.manifest_version !== 3) throw new Error('Only Manifest V3 extensions are supported in Zyra Browser.')
        manifest.key = publicKey.toString('base64')
        await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        await stat(join(destination, 'manifest.json'))
    } catch (error) {
        await rm(destination, { recursive: true, force: true })
        throw error instanceof Error ? error : new Error('The extension manifest is invalid.')
    }
    return { sha256: createHash('sha256').update(bytes).digest('hex') }
}
