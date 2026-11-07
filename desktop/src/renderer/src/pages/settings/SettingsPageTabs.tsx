import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { readSettingsReturnLocation, settingsDetailNavigationState } from './settings-navigation-context'
import { preloadSettingsRoute } from './settings-route-loaders'
import { SETTINGS_PAGE_VIEWS, settingsPageViewIsActive, type SettingsPageFamily } from './settings-page-views'

export function SettingsPageTabs({ family }: { family: SettingsPageFamily }) {
    const location = useLocation()
    const { pathname } = location
    const origin = readSettingsReturnLocation(location.state)
    return <nav aria-label={`${family} settings views`} className="flex min-w-0 gap-5 overflow-x-auto border-b border-[var(--settings-border)] [scrollbar-width:thin]">
        {SETTINGS_PAGE_VIEWS[family].map(view => {
            const active = settingsPageViewIsActive(view, pathname)
            const nextOrigin = origin?.pathname === view.to ? origin.parent : origin
            return <Link key={view.id} to={view.to} state={nextOrigin ? { settingsReturnTo: nextOrigin } : undefined} aria-current={active ? 'page' : undefined}
                onPointerEnter={() => preloadSettingsRoute(view.to)} onFocus={() => preloadSettingsRoute(view.to)}
                className={cn('inline-flex min-h-10 shrink-0 items-center border-b-2 px-0.5 text-[12px] font-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]',
                    active ? 'border-[var(--accent-primary)] text-[var(--settings-text)]' : 'border-transparent text-[var(--settings-text-muted)] hover:text-[var(--settings-text)]')}>
                {view.label}
            </Link>
        })}
    </nav>
}

export function SettingsPageLink({ to, title, description }: { to: string; title: string; description?: string }) {
    const location = useLocation()
    return <Link to={to} state={settingsDetailNavigationState(location)} onPointerEnter={() => preloadSettingsRoute(to)} onFocus={() => preloadSettingsRoute(to)}
        className="flex min-w-0 items-center justify-between gap-4 border-t border-[var(--settings-border)] px-4 py-3.5 text-[var(--settings-text)] transition-colors first:border-t-0 hover:bg-[var(--settings-row-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]">
        <span className="min-w-0"><span className="block text-[13px] font-medium">{title}</span>{description ? <span className="mt-1 block text-[12px] leading-5 text-[var(--settings-text-secondary)]">{description}</span> : null}</span>
        <ChevronRight size={15} className="shrink-0 text-[var(--settings-text-muted)]" />
    </Link>
}
