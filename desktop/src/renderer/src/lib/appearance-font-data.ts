import type { DevScopeManagedFontData } from '@shared/contracts/font-contracts'

export type AppearanceFontResource = Readonly<{ family: string; css: string }>

export function appearanceFontBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
        const bytes = (value as { data: unknown[] }).data
        if (bytes.every(byte => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) return Uint8Array.from(bytes as number[])
    }
    throw new Error('Zyra received invalid managed font data.')
}

/** Serialize only app-owned loaded font data, never authored URLs or CSS. */
export function serializeAppearanceFont(family: string, faces: readonly DevScopeManagedFontData[]): AppearanceFontResource {
    const quotedFamily = JSON.stringify(family).replace(/</g, '\\3c ').replace(/>/g, '\\3e ')
    const formats = { woff2: 'woff2', woff: 'woff', truetype: 'ttf', opentype: 'otf' } as const
    const css = faces.map(face => {
        const weights = face.weight.trim().split(/\s+/)
        const validWeight = ['normal', 'bold'].includes(face.weight)
            || (weights.length <= 2 && weights.every(value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000))
        if (!Object.hasOwn(formats, face.format) || !validWeight
            || !['normal', 'italic'].includes(face.style)
            || (face.unicodeRange && !/^[\da-fu+?\s,-]+$/i.test(face.unicodeRange))) throw new Error('Invalid appearance font descriptors.')
        const bytes = appearanceFontBytes(face.data)
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
        return `@font-face{font-family:${quotedFamily};font-style:${face.style};font-weight:${face.weight};${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}src:url("data:font/${formats[face.format]};base64,${btoa(binary)}") format("${face.format}");font-display:swap}`
    }).join('')
    return Object.freeze({ family, css })
}
