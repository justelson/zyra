import { useLayoutEffect, useState, type RefObject } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { readSettingsPageSections, sameSettingsPageSections, type SettingsPageSection } from './settings-page-sections'

export function SettingsSectionNavigation({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
    const location = useLocation()
    const [sections, setSections] = useState<SettingsPageSection[]>([])
    useLayoutEffect(() => {
        const root = containerRef.current
        if (!root || !location.pathname.startsWith('/settings')) return
        let frame: number | null = null
        const refresh = () => {
            const next = readSettingsPageSections(root)
            setSections(current => sameSettingsPageSections(current, next) ? current : next)
        }
        // Async/conditional pages can add sections after their initial render.
        // Coalesce DOM changes; never poll or fetch page data for navigation.
        const observer = new MutationObserver(() => {
            if (frame !== null) return
            frame = window.requestAnimationFrame(() => { frame = null; refresh() })
        })
        observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'inert'] })
        refresh()
        return () => { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame) }
    }, [containerRef, location.pathname])

    if (sections.length < 2) return null
    const requested = new URLSearchParams(location.search).get('setting')
    return <nav aria-label="On this page" className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-[var(--settings-divider)] bg-[var(--settings-bg)] px-1 py-2">
        <span className="mr-1 text-[10px] text-[var(--settings-text-faint)]">On this page</span>
        {sections.map(section => {
            const search = new URLSearchParams(location.search)
            search.set('setting', section.id)
            return <Link key={section.id}
                to={{ pathname: location.pathname, search: `?${search}`, hash: location.hash }}
                aria-current={requested === section.id ? 'location' : undefined}
                className={cn('rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]', requested === section.id ? 'bg-[var(--settings-nav-active)] text-[var(--settings-text)]' : 'text-[var(--settings-text-muted)] hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]')}>
                {section.label}
            </Link>
        })}
    </nav>
}
