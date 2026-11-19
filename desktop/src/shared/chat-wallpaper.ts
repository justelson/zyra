export type ChatWallpaper = { asset: string; fit: 'cover' | 'contain'; x: number; y: number; opacity?: number }
export const NO_CHAT_WALLPAPER: ChatWallpaper = { asset: '', fit: 'cover', x: 50, y: 50, opacity: 100 }

/** The renderer owns image bytes. Preferences never contain paths, URLs or image data. */
export function isChatWallpaper(value: unknown): value is ChatWallpaper {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const item = value as Record<string, unknown>
    // Dev.75 wallpapers lack opacity and are rendered at 100%.
    const hasOpacity = Object.hasOwn(item, 'opacity')
    return Object.keys(item).length === (hasOpacity ? 5 : 4) && ['asset','fit','x','y'].every(key => Object.hasOwn(item, key))
        && typeof item.asset === 'string' && (item.asset === '' || /^[0-9a-f]{64}$/.test(item.asset))
        && (item.fit === 'cover' || item.fit === 'contain')
        && [item.x, item.y, hasOpacity ? item.opacity : 100].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100)
}
