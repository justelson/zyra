import { normalize, parse, resolve } from 'node:path'

export function canonicalFolderKey(value: string): string {
    const resolved = normalize(resolve(String(value || '').trim()))
    const absolute = resolved === parse(resolved).root ? resolved : resolved.replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}
