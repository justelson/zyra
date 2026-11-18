import { useState } from 'react'
import { NO_CHAT_WALLPAPER, type ChatWallpaper } from '@shared/chat-wallpaper'
import { useSettings } from '@/lib/settings'
import { importChatWallpaper } from '@/lib/chat-wallpaper-assets'
import { useChatWallpaper } from '@/lib/use-chat-wallpaper'
import { SettingsSection } from '../settings-layout'

export function ChatWallpaperSettings() {
    const { settings, updateSettings } = useSettings()
    const saved = settings.appearanceChatWallpaper ?? NO_CHAT_WALLPAPER
    const [draft, stage] = useState<ChatWallpaper | null>(null), [base, setBase] = useState(saved)
    const [busy, setBusy] = useState(false), [notice, report] = useState('')
    const value = draft ?? saved, style = useChatWallpaper(value)
    function edit(next: ChatWallpaper) { if (!draft) setBase(saved); stage(next); report('Preview only. Apply to use it in conversations.') }
    async function select(file: File) {
        setBusy(true)
        try { edit({ ...NO_CHAT_WALLPAPER, asset: await importChatWallpaper(file) }) }
        catch (error) { report(error instanceof Error ? error.message : 'Could not import this image.') } finally { setBusy(false) }
    }
    async function apply() {
        if (!draft) return
        if (JSON.stringify(saved) !== JSON.stringify(base)) { report('Wallpaper changed elsewhere. Discard this preview and try again.'); return }
        setBusy(true)
        try { await updateSettings({ appearanceChatWallpaper: draft }); stage(null); report('Wallpaper saved.') }
        catch { report('Wallpaper could not be saved.') } finally { setBusy(false) }
    }
    return <SettingsSection title="Conversation wallpaper"><fieldset disabled={busy} className="grid gap-3 p-3">
        <label>Choose a local image <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void select(file) }} /></label>
        <small>Shown behind messages only. Your image stays on this device.</small>
        {value.asset && <><div aria-label="Wallpaper framing preview" className="aspect-video rounded bg-sparkle-bg" style={style} />
        <label>Fit <select value={value.fit} onChange={e => edit({ ...value, fit: e.target.value === 'contain' ? 'contain' : 'cover' })}><option value="cover">Fill</option><option value="contain">Show entire image</option></select></label>
        {(['x','y'] as const).map(key => <label key={key}>{key === 'x' ? 'Horizontal' : 'Vertical'} position <input type="range" min="0" max="100" value={value[key]} onChange={e => edit({ ...value, [key]: Number(e.target.value) })} /> {value[key]}%</label>)}
        <button type="button" onClick={() => edit(NO_CHAT_WALLPAPER)}>Remove wallpaper</button></>}
        {draft && <div className="flex gap-3"><button type="button" onClick={() => void apply()}>Apply</button><button type="button" onClick={() => { stage(null); report('Discarded.') }}>Discard</button></div>}
        <small role="status">{notice}</small></fieldset></SettingsSection>
}
