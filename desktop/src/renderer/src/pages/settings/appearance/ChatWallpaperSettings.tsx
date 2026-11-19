import { useRef, useState } from 'react'
import { NO_CHAT_WALLPAPER, type ChatWallpaper } from '@shared/chat-wallpaper'
import { useSettings } from '@/lib/settings'
import { importChatWallpaper } from '@/lib/chat-wallpaper-assets'
import { useChatWallpaper } from '@/lib/use-chat-wallpaper'
import { SettingsRow, SettingsSection, SettingsSlider, SettingsSegmented } from '../settings-layout'

export function ChatWallpaperSettings() {
    const { settings, updateSettings } = useSettings()
    const fileInput = useRef<HTMLInputElement>(null)
    const [selection, setSelection] = useState<{asset:string;name:string}|null>(null)
    const saved = settings.appearanceChatWallpaper ?? NO_CHAT_WALLPAPER
    const [draft, stage] = useState<ChatWallpaper | null>(null), [base, setBase] = useState(saved)
    const [busy, setBusy] = useState(false), [notice, report] = useState('')
    const value = draft ?? saved, style = useChatWallpaper(value)
    function edit(next: ChatWallpaper) { if (!draft) setBase(saved); stage(next); report('Preview only. Apply to use it in conversations.') }
    async function select(file: File) {
        setBusy(true)
        try { const asset = await importChatWallpaper(file); edit({ ...NO_CHAT_WALLPAPER, asset }); setSelection({asset,name:file.name}) }
        catch (error) { report(error instanceof Error ? error.message : 'Could not import this image.') } finally { setBusy(false) }
    }
    async function apply() {
        if (!draft) return
        if (JSON.stringify(saved) !== JSON.stringify(base)) { report('Wallpaper changed elsewhere. Discard this preview and try again.'); return }
        setBusy(true)
        try { await updateSettings({ appearanceChatWallpaper: draft }); stage(null); report('Wallpaper saved.') }
        catch { report('Wallpaper could not be saved.') } finally { setBusy(false) }
    }
    const secondary = 'rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-3 py-1.5 text-xs font-medium text-[var(--settings-text)] hover:bg-[var(--settings-control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]'
    return <SettingsSection title="Conversation wallpaper"><fieldset disabled={busy} className="min-w-0">
        <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file=e.target.files?.[0]; e.target.value=''; if(file) void select(file) }} />
        <SettingsRow title="Background image" description="Behind messages only. Your image stays on this device." control={<button type="button" className={secondary} onClick={() => fileInput.current?.click()}>{value.asset ? 'Change image' : 'Choose image'}</button>} />
        {value.asset && <><figure className="mx-4 my-3 overflow-hidden rounded-lg border border-[var(--settings-border)]">
            <figcaption className="flex items-center justify-between gap-3 bg-[var(--settings-control)] px-3 py-2 text-xs"><span>Chat preview</span><span className="min-w-0 truncate text-[var(--settings-text-secondary)]">{selection?.asset === value.asset ? selection.name : 'Local image'}</span></figcaption>
            <div aria-label="Wallpaper framing preview" style={style} className="flex h-44 flex-col justify-center gap-3 bg-sparkle-bg px-[8%] text-sm sm:h-48"><span className="max-w-[78%] self-end rounded-xl bg-[var(--surface-floating)] px-3 py-1.5">How does this look?</span><span className="max-w-[82%] self-start rounded-xl bg-[var(--surface-floating)] px-3 py-1.5">Here’s a sample reply.</span></div>
        </figure><SettingsRow title="Image fit" description={null} control={<SettingsSegmented label="Image fit" value={value.fit} options={[{value:'cover',label:'Fill chat area'},{value:'contain',label:'Show entire image'}]} onChange={fit => edit({...value,fit})} />} />
        {(['x','y'] as const).map(key => {const label=key==='x'?'Horizontal position':'Vertical position';return <SettingsRow key={key} title={label} description={null} control={<SettingsSlider label={label} min={0} max={100} unit="%" value={value[key]} onChange={n => edit({...value,[key]:n})} />} />})}</>}
        {(value.asset || draft) && <div className="flex flex-wrap items-center gap-2 border-t border-[var(--settings-border)] px-4 py-3 text-xs">{value.asset && <button type="button" className="mr-auto text-[var(--settings-text-secondary)] underline-offset-4 hover:underline" onClick={()=>edit(NO_CHAT_WALLPAPER)}>Remove image</button>}{draft && <><button className={secondary} onClick={()=>{stage(null);report('Discarded.')}}>Discard</button><button className="rounded-md bg-[var(--accent-primary)] px-3 py-1.5 font-semibold text-[var(--accent-contrast)]" onClick={()=>void apply()}>Apply wallpaper</button></>}</div>}
        <small role="status" className={notice?'block px-4 pb-3 text-xs text-[var(--settings-text-secondary)]':'sr-only'}>{notice}</small></fieldset></SettingsSection>
}
