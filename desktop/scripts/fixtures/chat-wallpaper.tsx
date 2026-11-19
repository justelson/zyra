import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { importChatWallpaper, getChatWallpaper } from '../../src/renderer/src/lib/chat-wallpaper-assets'
import { useChatWallpaper } from '../../src/renderer/src/lib/use-chat-wallpaper'
import { NO_CHAT_WALLPAPER, type ChatWallpaper } from '../../src/shared/chat-wallpaper'

function Example({ value }: { value: ChatWallpaper }) {
    const style = useChatWallpaper(value)
    return <><header>Header</header><main><div data-image style={style} />Messages</main><footer>Input</footer></>
}
Object.assign(window, { runPerformanceBenchmark: async () => {
    const root = createRoot(document.getElementById('root')!)
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#1c6380'; ctx.fillRect(0,0,16,16)
    const image = await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('fixture decode'))))
    const asset = await importChatWallpaper(new File([image], 'synthetic.png', { type: 'image/png' }))
    const stored = await getChatWallpaper(asset)
    if (!stored || stored.type !== 'image/png') throw Error('Asset not persisted after database reopen')
    const render = (value: ChatWallpaper) => flushSync(() => root.render(<Example value={value}/>))
    render({ asset, fit: 'cover', x: 40, y: 65 })
    const main = document.querySelector<HTMLElement>('[data-image]')!
    for (let i = 0; !main.style.backgroundImage && i < 100; i++) await new Promise(r => setTimeout(r,10))
    if (!main.style.backgroundImage.includes('blob:') || main.style.backgroundPosition !== '40% 65%') throw Error('Missing locally resolved wallpaper')
    render({ asset, fit: 'contain', x: 0, y: 100 })
    if (main.style.backgroundSize !== 'contain' || main.style.backgroundPosition !== '0% 100%') throw Error('Framing not updated')
    if (main.style.opacity !== '1') throw Error('Legacy wallpaper should remain fully visible')
    for (const opacity of [0, 47, 100]) {
        render({ asset, fit: 'contain', x: 0, y: 100, opacity })
        if (main.style.opacity !== String(opacity / 100) || !main.style.backgroundImage.includes('blob:')) throw Error('Opacity changed framing or lost the asset')
        if (getComputedStyle(main.parentElement!).opacity !== '1') throw Error('Opacity faded messages')
    }
    for (const sibling of document.querySelectorAll('header,footer')) if (getComputedStyle(sibling).backgroundImage !== 'none') throw Error('Wallpaper escaped region')
    render(NO_CHAT_WALLPAPER)
    if (main.style.backgroundImage) throw Error('Wallpaper survived reset')
    root.unmount()
    return { localImport:true, databaseReopen:true, framing:true, reset:true }
} })
