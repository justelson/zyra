import type { DevScopeManagedFont } from '@shared/contracts/font-contracts'
import { addAppearanceManagedFontFaces, removeAppearanceManagedFontFaces } from './appearance-font-faces'
import { appearanceFontBytes, serializeAppearanceFont } from './appearance-font-data'
import bricolageUrl from '../../../../../extensions/zyra-browser-control/assets/font.woff2'
import hankenUrl from '../../../../../extensions/zyra-browser-control/assets/hanken-grotesk.woff2'
import {
    getAppearanceManagedFontAlias,
    getAppearanceManagedFontId,
    type AppearanceCodeFont,
    type AppearanceUiFont
} from './settings'

const loadedFonts = new Map<string, Promise<FontFace[]>>()

const builtInFonts = {
    bricolage: { family: 'Bricolage Grotesque', url: bricolageUrl, weight: '200 800' },
    hanken: { family: 'Hanken Grotesk', url: hankenUrl, weight: '100 900' }
} as const

async function readBuiltInFont(url: string): Promise<Uint8Array> {
    // Isolated fixtures inline the existing app asset; production bundles an
    // app-local URL. Neither source is chosen by visualization HTML.
    if (url.startsWith('data:')) {
        const binary = atob(url.slice(url.indexOf(',') + 1))
        return Uint8Array.from(binary, character => character.charCodeAt(0))
    }
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to load the bundled appearance font.')
    return new Uint8Array(await response.arrayBuffer())
}

export async function listAppearanceManagedFonts(): Promise<DevScopeManagedFont[]> {
    const result = await window.devscope.fonts.listManaged()
    if (!result.success) throw new Error(result.error)
    return result.fonts
}

export async function ensureAppearanceFontLoaded(font: AppearanceUiFont | AppearanceCodeFont): Promise<void> {
    const fontId = getAppearanceManagedFontId(font)
    const builtIn = font === 'bricolage' || font === 'hanken' ? builtInFonts[font] : null
    if ((!fontId && !builtIn) || typeof FontFace === 'undefined') return
    const key = fontId ? `managed:${fontId}` : `builtin:${font}`
    const existing = loadedFonts.get(key)
    if (existing) {
        await existing
        return
    }

    const loading = (async () => {
        const result = builtIn ? { success: true as const, faces: [{ data: await readBuiltInFont(builtIn.url), weight: builtIn.weight,
            style: 'normal' as const, format: 'woff2' as const, unicodeRange: undefined }] } : await window.devscope.fonts.readManaged(fontId!)
        if (!result.success) throw new Error(result.error)
        const family = builtIn?.family ?? getAppearanceManagedFontAlias(fontId!)
        const resource = serializeAppearanceFont(family, result.faces)
        const faces = await Promise.all(result.faces.map(async (face) => {
            const bytes = appearanceFontBytes(face.data)
            const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
            const fontFace = new FontFace(family, source, {
                style: face.style,
                weight: face.weight,
                ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {})
            })
            await fontFace.load()
            return fontFace
        }))
        addAppearanceManagedFontFaces(document, faces, resource)
        return faces
    })().catch((error) => {
        loadedFonts.delete(key)
        throw error
    })

    loadedFonts.set(key, loading)
    await loading
}

export function forgetAppearanceManagedFont(fontId: string): void {
    const loaded = loadedFonts.get(`managed:${fontId}`)
    loadedFonts.delete(`managed:${fontId}`)
    if (!loaded) return
    void loaded.then((faces) => {
        removeAppearanceManagedFontFaces(document, faces)
    }).catch(() => undefined)
}
