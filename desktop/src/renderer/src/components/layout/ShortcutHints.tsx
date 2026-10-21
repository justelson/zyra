import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useCommandPalette } from '@/lib/commandPalette'
import { isShortcutRecording, shortcutPlatform } from '@/lib/keybindings'
import { useSettings } from '@/lib/settings'
import { hintBinding, hintsBlocked, isHintModifier, isHintTargetVisible, shortcutCommand, type HeldModifiers } from '@/lib/shortcut-hints'
import { addOverlayEventListener, addOverlayWindowBlurListener, getOverlayEventDocuments, NativeOverlayPortal } from '@/components/ui/native-overlay-portal'
import { getOverlayOwnerRect } from '@/components/ui/native-overlay-events'
import { ShortcutHint } from '@/components/ui/ShortcutHint'
import type { CommandId } from '@shared/keybindings'

type Hint = { target: HTMLElement; id: CommandId; binding: string; left: number; anchorLeft: number; top: number }

/** Passive annotations only: the existing shortcut dispatchers retain every key. */
export function ShortcutHints() {
    const location = useLocation()
    const { isOpen: paletteOpen } = useCommandPalette()
    const { settings } = useSettings()
    const platform = shortcutPlatform()
    const [hints, setHints] = useState<Hint[]>([])

    useEffect(() => {
        let timer: number | undefined
        let held: HeldModifiers | null = null
        let ready = false
        let composing = false
        const clear = () => {
            window.clearTimeout(timer)
            timer = undefined
            held = null
            ready = false
            setHints(current => current.length ? [] : current)
        }
        const blocked = () => paletteOpen || composing || document.hidden || isShortcutRecording() || hintsBlocked(getOverlayEventDocuments())
        const refresh = () => {
            if (!held) return
            if (blocked()) { clear(); return }
            if (!ready) return
            const next: Hint[] = []
            for (const owner of getOverlayEventDocuments()) {
                for (const target of owner.querySelectorAll<HTMLElement>('[data-shortcut-command]')) {
                    const id = shortcutCommand(target.dataset.shortcutCommand)
                    if (!id || !isHintTargetVisible(target)) continue
                    const binding = hintBinding(id, platform, settings.keyboardShortcuts, held)
                    if (!binding) continue
                    const rect = getOverlayOwnerRect(target)
                    next.push({ target, id, binding, left: rect.right + 4, anchorLeft: rect.left, top: rect.top })
                }
            }
            setHints(current => current.length === next.length && current.every((hint, index) => {
                const other = next[index]
                return hint.target === other.target && hint.binding === other.binding && hint.left === other.left && hint.anchorLeft === other.anchorLeft && hint.top === other.top
            }) ? current : next)
        }
        const arm = (event: KeyboardEvent) => {
            clear()
            if (blocked() || event.isComposing || event.getModifierState?.('AltGraph')) return
            if (!event.ctrlKey && !event.metaKey && !event.altKey) return
            held = { ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey }
            timer = window.setTimeout(() => { timer = undefined; ready = true; refresh() }, 450)
        }
        const onDown = (event: KeyboardEvent) => {
            if (event.repeat) return
            if (isHintModifier(event.key)) arm(event)
            else clear()
        }
        const onUp = (event: KeyboardEvent) => {
            // Release always removes the old chord before advertising a new one.
            if (isHintModifier(event.key)) arm(event)
            else clear()
        }
        const removeDown = addOverlayEventListener('keydown', onDown, true)
        const removeUp = addOverlayEventListener('keyup', onUp, true)
        const removeBlur = addOverlayWindowBlurListener(clear)
        const removeCompositionStart = addOverlayEventListener('compositionstart', () => { composing = true; clear() })
        const removeCompositionEnd = addOverlayEventListener('compositionend', () => { composing = false; clear() })
        const removeVisibility = addOverlayEventListener('visibilitychange', clear)
        // Revalidate enablement, clipping, modal/recording state and moving anchors
        // while held; no DOM work is done when no modifier gesture is active.
        const interval = window.setInterval(refresh, 100)
        window.addEventListener('blur', clear)
        return () => {
            clear(); window.clearInterval(interval)
            removeDown(); removeUp(); removeBlur(); removeCompositionStart(); removeCompositionEnd(); removeVisibility()
            window.removeEventListener('blur', clear)
        }
    }, [location.pathname, location.search, paletteOpen, platform, settings.keyboardShortcuts])

    if (!hints.length || paletteOpen || isShortcutRecording()) return null
    return <NativeOverlayPortal passive autoFocus={false}>
        {hints.map((hint, index) => <ShortcutHint key={`${hint.id}:${index}`} id={hint.id} binding={hint.binding} platform={platform} left={hint.left} anchorLeft={hint.anchorLeft} top={hint.top} />)}
    </NativeOverlayPortal>
}
