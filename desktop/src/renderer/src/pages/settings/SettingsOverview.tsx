import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { SettingsPageContainer } from './settings-layout'
import {
    findSettingsNavigationItem,
    getSettingsCategoryDestinations,
    type SettingsIcon
} from './settings-navigation'
import { preloadSettingsRoute } from './settings-route-loaders'

type OverviewEntry = {
    id: string
    label: string
    description: string
    to: string
    icon: SettingsIcon
}

function SettingsOverviewList({ entries, label }: { entries: OverviewEntry[]; label: string }) {
    return (
        <nav
            aria-label={label}
            className="overflow-hidden rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)] shadow-[inset_0_1px_0_var(--settings-section-highlight)]"
        >
            {entries.map((entry) => {
                const Icon = entry.icon
                return (
                    <Link
                        key={entry.id}
                        to={entry.to}
                        onPointerEnter={() => preloadSettingsRoute(entry.to)}
                        onPointerDown={() => preloadSettingsRoute(entry.to)}
                        onFocus={() => preloadSettingsRoute(entry.to)}
                        className={cn(
                            'group grid min-h-[68px] grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-3 border-b border-[var(--settings-row-divider)] px-4 py-3.5 text-left transition-colors last:border-b-0',
                            'hover:bg-[var(--settings-row-hover)] focus-visible:bg-[var(--settings-row-hover)] focus-visible:outline-none'
                        )}
                    >
                        <Icon size={17} strokeWidth={1.7} className="text-[var(--settings-text-muted)] transition-colors group-hover:text-[var(--settings-text-secondary)]" />
                        <span className="min-w-0">
                            <span className="block text-[13px] font-medium tracking-[-0.003em] text-[var(--settings-text)]">{entry.label}</span>
                            <span className="mt-0.5 block text-[12px] leading-5 text-[var(--settings-text-secondary)]">{entry.description}</span>
                        </span>
                        <ChevronRight size={15} strokeWidth={1.7} className="justify-self-end text-[var(--settings-text-faint)] transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-[var(--settings-text-secondary)]" />
                    </Link>
                )
            })}
        </nav>
    )
}

export default function SettingsOverview() {
    const location = useLocation()
    const activeCategory = findSettingsNavigationItem(location.pathname)
    const entries: OverviewEntry[] = getSettingsCategoryDestinations(activeCategory.id)

    return (
        <SettingsPageContainer title={activeCategory.label}>
            <SettingsOverviewList entries={entries} label={`${activeCategory.label} settings`} />
        </SettingsPageContainer>
    )
}
