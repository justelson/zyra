import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { SettingsDialog } from '@/pages/settings/settings-layout'
import { fitDiagram, zoomDiagram, type DiagramTransform } from './diagram-transform'

export function MermaidExpandedView({ svg, onClose }: { svg: string; onClose: () => void }) {
    const viewport = useRef<HTMLDivElement>(null)
    const diagram = useRef<HTMLDivElement>(null)
    const drag = useRef<{ id: number; x: number; y: number; transform: DiagramTransform } | null>(null)
    const [transform, setTransform] = useState<DiagramTransform>({ x: 0, y: 0, scale: 1 })
    const dimensions = () => {
        const bounds = viewport.current!.getBoundingClientRect()
        const viewBox = diagram.current?.querySelector('svg')?.viewBox.baseVal
        return { bounds, width: viewBox?.width || 800, height: viewBox?.height || 600 }
    }
    const fit = useCallback(() => { if (!viewport.current) return; const {bounds,width,height} = dimensions(); if(diagram.current){diagram.current.style.width=`${width}px`;diagram.current.style.height=`${height}px`} setTransform(fitDiagram(width,height,bounds.width,bounds.height)) }, [])
    const zoom = (factor: number) => { const {bounds} = dimensions(); setTransform(current => zoomDiagram(current,factor,bounds.width/2,bounds.height/2)) }
    useEffect(() => {
        const element = viewport.current
        if (!element) return
        const previousFocus = element.ownerDocument.activeElement as HTMLElement | null
        element.focus({preventScroll:true})
        const observer = new ResizeObserver(fit)
        observer.observe(element)
        const wheel = (event: WheelEvent) => {
            event.preventDefault()
            const bounds = element.getBoundingClientRect()
            setTransform(current => zoomDiagram(current, Math.exp(-event.deltaY * 0.002), event.clientX-bounds.x, event.clientY-bounds.y))
        }
        element.addEventListener('wheel',wheel,{passive:false})
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return
            const dialog = element.closest('[role="dialog"]')
            const controls = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') || [])]
            const first = controls[0], last = controls[controls.length - 1]
            if (event.shiftKey && element.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && element.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus() }
        }
        element.ownerDocument.addEventListener('keydown', trapFocus, true)
        return () => { observer.disconnect(); element.removeEventListener('wheel',wheel); element.ownerDocument.removeEventListener('keydown', trapFocus, true); previousFocus?.focus({preventScroll:true}) }
    }, [fit, svg])
    return <SettingsDialog open title="Diagram" onClose={onClose} className="!h-[calc(100dvh-40px)] !max-w-[calc(100vw-40px)]" contentClassName="!flex min-h-0 flex-1 !overflow-hidden !p-0 !space-y-0" headerAction={<div className="flex items-center gap-1">
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1/1.2)} className="inline-flex size-7 items-center justify-center rounded hover:bg-[var(--surface-hover)]"><Minus size={15}/></button>
        <span className="min-w-10 text-center text-xs tabular-nums text-[var(--settings-text-muted)]">{Math.round(transform.scale*100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)} className="inline-flex size-7 items-center justify-center rounded hover:bg-[var(--surface-hover)]"><Plus size={15}/></button>
        <button type="button" aria-label="Fit diagram" title="Fit diagram" onClick={fit} className="inline-flex size-7 items-center justify-center rounded hover:bg-[var(--surface-hover)]"><Maximize size={15}/></button>
    </div>}>
        <div ref={viewport} tabIndex={0} role="region" aria-label="Diagram canvas. Drag to pan, scroll to zoom, arrow keys to move, zero to fit." className="mermaid-canvas relative h-full min-h-0 w-full touch-none overflow-hidden outline-none cursor-grab active:cursor-grabbing" style={{ backgroundPosition: `${transform.x}px ${transform.y}px` }}
            onKeyDown={event => {
                if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); setTransform(current => ({...current,x:current.x+(event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0),y:current.y+(event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0)})) }
                if (event.key==='+' || event.key==='=') { event.preventDefault(); zoom(1.2) }
                if (event.key==='-') { event.preventDefault(); zoom(1/1.2) }
                if (event.key==='0') { event.preventDefault(); fit() }
            }}
            onPointerDown={event => { if(event.button!==0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,transform} }}
            onPointerMove={event => { const start=drag.current; if(!start || start.id!==event.pointerId) return; setTransform({...start.transform,x:start.transform.x+event.clientX-start.x,y:start.transform.y+event.clientY-start.y}) }}
            onPointerUp={() => { drag.current=null }} onPointerCancel={() => { drag.current=null }}>
            <div ref={diagram} className="mermaid-expanded-diagram absolute left-0 top-0 origin-top-left select-none [&_svg]:!max-w-none" style={{transform:`translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`}} dangerouslySetInnerHTML={{__html:svg}}/>
        </div>
    </SettingsDialog>
}
