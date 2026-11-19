import { useEffect, useState, type CSSProperties } from 'react'
import type { ChatWallpaper } from '@shared/chat-wallpaper'
import { getChatWallpaper } from './chat-wallpaper-assets'

export function useChatWallpaper(value: ChatWallpaper | undefined) {
    const asset = value?.asset
    const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null)
    useEffect(() => {
        if (!asset) return
        let live = true, url = ''
        void getChatWallpaper(asset).then(blob => {
            if (blob && live) { url = URL.createObjectURL(blob); setLoaded({ id: asset, url }) }
        }).catch(() => { if (live) setLoaded(null) })
        return () => { live = false; if (url) URL.revokeObjectURL(url); setLoaded(null) }
    }, [asset])
    if (!value || !loaded || loaded.id !== asset) return undefined
    return { opacity: (value.opacity ?? 100) / 100, backgroundImage: `url("${loaded.url}")`, backgroundSize: value.fit, backgroundPosition: `${value.x}% ${value.y}%`, backgroundRepeat: 'no-repeat' } satisfies CSSProperties
}
