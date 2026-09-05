import { Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SidebarUpdateButton } from '@/components/updates/SidebarUpdateButton'
import { cn } from '@/lib/utils'
import { preloadSettingsRoute } from '../settings/settings-route-loaders'

export function AssistantSidebarFooter({ agentInboxEnabled }: { agentInboxEnabled: boolean }) {
    const navigate = useNavigate()
    return <div className="mt-auto flex shrink-0 items-center gap-1 border-t border-[var(--surface-divider)] pt-2" data-assistant-sidebar-footer>
        <button
            type="button"
            onPointerEnter={() => preloadSettingsRoute('/settings')}
            onFocus={() => preloadSettingsRoute('/settings')}
            onClick={() => navigate('/settings')}
            className={cn(
                'group flex h-8 min-w-0 flex-1 cursor-pointer items-center text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35',
                agentInboxEnabled ? 'gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sparkle-text-muted/80' : 'gap-2.5 rounded-lg px-2.5 text-[13px] leading-none'
            )}
        >
            <Settings size={agentInboxEnabled ? 18 : 15} strokeWidth={1.75} className="text-sparkle-text-secondary/70 transition-colors group-hover:text-sparkle-text" />
            <span className="truncate">Settings</span>
        </button>
        <SidebarUpdateButton />
    </div>
}
