import { useSettings } from '@/lib/settings'
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

type InspectorFrame = { element: RefObject<HTMLDivElement | null>; presented: boolean }
const InspectorFrameContext = createContext<InspectorFrame | null>(null)
export const useInspectorFrame = () => useContext(InspectorFrameContext)

/** Own entrance geometry before the optional inspector code has loaded. */
export function AssistantInspectorFrame({ open, width, children }: { open: boolean; width: number; children: ReactNode }) {
    const { settings } = useSettings()
    const element = useRef<HTMLDivElement>(null)
    const [presented, setPresented] = useState(false)
    useLayoutEffect(() => {
        if (!open) { setPresented(false); return }
        const frame = requestAnimationFrame(() => setPresented(true))
        return () => cancelAnimationFrame(frame)
    }, [open])
    return <InspectorFrameContext.Provider value={{ element, presented }}>
        <div ref={element} data-assistant-inspector-frame className="relative h-full min-h-0 shrink-0 [contain:layout] transition-[width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={{ width: open && presented ? width : 0, transition: settings.accessibilityReduceMotion ? 'none' : undefined }} aria-hidden={!open} inert={!open}>
            {children}
        </div>
    </InspectorFrameContext.Provider>
}
