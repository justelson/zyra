import { useLayoutEffect, useRef, useState } from 'react'
import AudioPlayer from '../AudioPlayer'
import { resolveImageSrc } from './paths'
import type { MarkdownAudioSource } from './audioEmbeds'

export function MarkdownAudioPlaylist({ sources, copy, filePath }: { sources: MarkdownAudioSource[]; copy: string; filePath?: string }) {
    const [selected, setSelected] = useState(0)
    const pickerRef = useRef<HTMLSelectElement>(null)
    const restorePickerFocus = useRef(false)
    useLayoutEffect(() => {
        if (restorePickerFocus.current) {
            restorePickerFocus.current = false
            pickerRef.current?.focus({ preventScroll: true })
        }
    }, [selected])
    const source = sources[selected] || sources[0]
    return <span className="markdown-audio-frame" data-markdown-copy={copy}>
        <AudioPlayer
            src={resolveImageSrc(source.href, filePath)}
            label={source.label}
            markdownTarget={source.href}
            titleControl={sources.length > 1 ? <select ref={pickerRef} className="audio-player-source" aria-label="Audio file" value={selected} onChange={event => {
                restorePickerFocus.current = event.currentTarget.ownerDocument.activeElement === event.currentTarget
                setSelected(Number(event.target.value))
            }}>
                {sources.map((item, index) => <option key={item.href} value={index}>{item.label}</option>)}
            </select> : undefined}
        />
    </span>
}
