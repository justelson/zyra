import { useNavigate } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { preloadSettingsRoute } from '../settings/settings-route-loaders'

export function AssistantSessionsRailFooter(props: {
    compact: boolean
    [key: string]: unknown
}) {
    const { compact } = props
    const navigate = useNavigate()

    return (
        <div className={cn('mt-auto shrink-0 border-t border-white/10 pt-2', compact ? 'px-0' : 'px-0')}>
            <button
                type="button"
                onPointerEnter={() => preloadSettingsRoute('/settings')}
                onFocus={() => preloadSettingsRoute('/settings')}
                onClick={() => navigate('/settings')}
                className="group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] leading-none text-sparkle-text-secondary transition-colors hover:bg-white/[0.035] hover:text-sparkle-text"
            >
                <Settings size={15} strokeWidth={1.8} className="text-sparkle-text-muted/75 transition-colors group-hover:text-sparkle-text" />
                <span className="truncate">Settings</span>
            </button>
        </div>
    )
}
