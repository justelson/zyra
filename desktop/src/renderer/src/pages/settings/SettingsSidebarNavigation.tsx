import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { findSettingsDestination, getSettingsCategoryDestinations, SETTINGS_NAVIGATION_ITEMS } from './settings-navigation'

type SettingsSidebarNavigationProps = {
    hidden?: boolean
    preloadRoute: (path: string) => void
}

export function SettingsSidebarNavigation({ hidden = false, preloadRoute }: SettingsSidebarNavigationProps) {
    const { pathname } = useLocation()
    const activeDestination = findSettingsDestination(pathname)
    const activeLinkRef = useRef<HTMLAnchorElement | null>(null)
    useEffect(() => {
        if (!hidden) activeLinkRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, [pathname, hidden])

    return <div hidden={hidden} className="space-y-3 pb-1">
        {SETTINGS_NAVIGATION_ITEMS.map(category => <section key={category.id} aria-label={`${category.label} settings`}>
            <h3 className="px-2 pb-1 pt-1 text-[11px] font-medium text-[var(--settings-text-faint)]">{category.label}</h3>
            <div className="space-y-px">
                {getSettingsCategoryDestinations(category.id).map(destination => {
                    const Icon = destination.icon
                    const active = activeDestination?.id === destination.id
                    return <Link key={destination.id}
                        ref={active ? activeLinkRef : undefined}
                        to={destination.to}
                        aria-current={active ? 'page' : undefined}
                        onPointerEnter={() => preloadRoute(destination.to)}
                        onPointerDown={() => preloadRoute(destination.to)}
                        onFocus={() => preloadRoute(destination.to)}
                        className={cn(
                            'group flex min-h-[30px] min-w-0 items-center gap-2 rounded-md px-2 text-[12px] transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]',
                            active ? 'bg-[var(--settings-nav-active)] font-medium text-[var(--settings-text)]' : 'text-[var(--settings-text-secondary)] hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]'
                        )}>
                        <Icon size={14} strokeWidth={active ? 1.9 : 1.7} className={cn('shrink-0', active ? 'text-[var(--settings-text-secondary)]' : 'text-[var(--settings-text-faint)] group-hover:text-[var(--settings-text-secondary)]')} />
                        <span className="min-w-0 flex-1 truncate">{destination.label}</span>
                    </Link>
                })}
            </div>
        </section>)}
    </div>
}
