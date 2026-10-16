import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Folder, GitBranch, RefreshCw, X, Files } from 'lucide-react'
import { ScriptPlayIcon } from '@/components/ui/ScriptPlayIcon'
import { useAnchoredMenuBounds } from '@/components/ui/useAnchoredMenuBounds'
import { useSettings } from '@/lib/settings'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { addOverlayEventListener, isOverlayEventInside } from '@/components/ui/native-overlay-portal'
import { OpenWithProjectButton } from '@/components/ui/OpenWithProjectButton'
import { useAssistantStoreSelector } from '@/lib/assistant/assistant-store-hooks'
import { getSelectedAssistantSession } from '@/lib/assistant/selectors'
import { useDeveloperWorkspace } from './useDeveloperWorkspace'
import { DeveloperTaskList } from './DeveloperTaskList'
import { DeveloperChanges } from './DeveloperChanges'
import { DeveloperBranchPicker } from './DeveloperBranchPicker'

export function DeveloperWorkspaceMenu({ root: fallbackRoot }: { root: string }) {
    const { settings } = useSettings()
    const [open, setOpen] = useState(false), [page, setPage] = useState<'home' | 'scripts' | 'changes'>('home')
    const [editorOpen, setEditorOpen] = useState(false)
    const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
    const menuBounds = useAnchoredMenuBounds(trigger, open, 320, 280)
    const session = useAssistantStoreSelector(state => getSelectedAssistantSession(state.snapshot))
    const root = session?.workingRoot || session?.chatScope?.workingRoot || session?.projectPath || fallbackRoot
    const { workspace, refresh, error, pendingActions, run } = useDeveloperWorkspace(root, open)
    const gitBusy = [...pendingActions].some(key => !key.startsWith('script:'))
    const close = () => { setOpen(false); setEditorOpen(false); trigger.current?.focus() }
    useEffect(() => { setOpen(false); setPage('home') }, [root])
    useEffect(() => {
        if (!open) return
        const pointer = addOverlayEventListener('pointerdown', (event: PointerEvent) => { if (!isOverlayEventInside(event, trigger.current, menu.current)) close() })
        const keyboard = addOverlayEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Escape' && !editorOpen) { event.preventDefault(); page === 'home' ? close() : setPage('home') } })
        return () => { pointer(); keyboard() }
    }, [open, editorOpen, page])
    const row = 'flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text'
    return <div className="relative inline-flex">
        <button ref={trigger} type="button" className="inline-flex h-6 max-w-40 items-center gap-1.5 rounded-md px-1.5 text-xs text-sparkle-text-muted hover:bg-[var(--surface-hover)]" title={root} aria-label="Developer workspace" aria-haspopup="menu" aria-expanded={open} onClick={() => { if (open) close(); else { setPage('home'); setOpen(true) } }}><GitBranch size={12} /><span className="truncate">{workspace?.branch || 'Workspace'}</span></button>
        {open && <AnchoredNativeOverlay anchorRef={trigger} inputRegionRef={menu}><div ref={menu} data-developer-workspace-menu role="menu" aria-label="Developer workspace" style={menuBounds} className="absolute flex flex-col overflow-hidden rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-2 text-sparkle-text shadow-xl">
            {page === 'home' ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="flex h-8 shrink-0 items-center gap-2 px-2 text-xs"><Folder size={14} className="text-sparkle-text-muted" /><span className="min-w-0 flex-1 truncate font-medium" title={root}>{root.replace(/\\/g, '/').split('/').pop() || 'Workspace'}</span><button type="button" aria-label="Refresh workspace" onClick={() => void refresh()} className="text-sparkle-text-muted hover:text-sparkle-text"><RefreshCw size={12} /></button><button type="button" aria-label="Close workspace" onClick={close} className="text-sparkle-text-muted hover:text-sparkle-text"><X size={12} /></button></div>
                <OpenWithProjectButton projectPath={root} preferredShell={settings.defaultShell} compactMenuRow menuOpen={editorOpen} onMenuOpenChange={setEditorOpen} />
                <button type="button" role="menuitem" className={row} onClick={() => setPage('scripts')}><ScriptPlayIcon size={13} className="text-emerald-400" /><span className="flex-1">Project scripts</span>{workspace?.tasks.some(task => task.state === 'running') && <span className="size-1.5 rounded-full bg-amber-400" title="Task running" />}<ChevronRight size={12} /></button>
                <button type="button" role="menuitem" className={row} onClick={() => setPage('changes')}><Files size={13} className="text-sky-400" /><span className="flex-1">Changes</span><ChevronRight size={12} /></button>
                {workspace?.gitRoot && <DeveloperBranchPicker root={root} current={workspace.branch || 'Detached HEAD'} busy={gitBusy} run={run} />}
            </div> : <>
                <div className="mb-1.5 flex h-8 shrink-0 items-center gap-1.5 border-b border-[var(--surface-divider)] pb-1"><button type="button" className="grid size-6 place-items-center rounded-md text-sparkle-text-muted hover:bg-[var(--surface-hover)]" aria-label="Back to workspace menu" onClick={() => setPage('home')}><ArrowLeft size={13} /></button><span className="flex-1 text-xs font-medium">{page === 'scripts' ? 'Scripts' : 'Changes'}</span><button type="button" className="grid size-6 place-items-center rounded-md text-sparkle-text-muted hover:bg-[var(--surface-hover)]" aria-label="Close workspace" onClick={close}><X size={12} /></button></div>
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                {workspace && page === 'scripts' && <DeveloperTaskList workspace={workspace} pending={pendingActions} run={run} />}
                {workspace && page === 'changes' && <DeveloperChanges key={workspace.root} workspace={workspace} pending={pendingActions} run={run} />}
                </div>
            </>}
            {!workspace && !error && <p role="status" className="px-2 py-2 text-xs text-sparkle-text-muted">Loading workspace...</p>}
            {error && <p role="alert" className="px-2 py-2 text-xs text-red-400">{error}</p>}
        </div></AnchoredNativeOverlay>}
    </div>
}
