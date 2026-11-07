import { useEffect, useId, useState } from 'react'
import { ArrowUp, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AssistantComposerMenuSurface, ComposerMenuContext } from './AssistantComposerMenuSurface'
import { AssistantQuestionTransition } from './AssistantQuestionTransition'
import type { AssistantComposerController } from './useAssistantComposerController'

export type AssistantComposerQueueProps = Pick<AssistantComposerController,
    'loadedSessionId' | 'queuedMessages' | 'queueHeld' | 'isStopping' | 'isConnected' |
    'onResumeQueue' | 'onHoldQueue' | 'onUpdateQueuedMessage' | 'onMoveQueuedMessage' |
    'onDeleteQueuedMessage' | 'onForceQueuedMessage'>

const action = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-35'
const steeringAction = 'inline-flex size-7 shrink-0 items-center justify-center rounded-full border p-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-35'

/** Keep the edit buffer in the composer even when its shelf is temporarily replaced by suggestions. */
export function useAssistantComposerQueueState(sessionId: AssistantComposerQueueProps['loadedSessionId']) {
    const [draggedId, setDraggedId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const [edit, setEdit] = useState<{ id: string; text: string } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
    useEffect(() => { setEdit(null); setError(null); setExpandedIds(new Set()) }, [sessionId])
    return { draggedId, setDraggedId, dropTargetId, setDropTargetId, edit, setEdit, error, setError, expandedIds, setExpandedIds }
}

export type AssistantComposerQueueState = ReturnType<typeof useAssistantComposerQueueState>

/** Presentation only. Queue ownership and dispatch stay in the controller. */
export function AssistantComposerQueue({ controller, state }: { controller: AssistantComposerQueueProps; state: ReturnType<typeof useAssistantComposerQueueState> }) {
    const { draggedId, setDraggedId, dropTargetId, setDropTargetId, edit, setEdit, error, setError, expandedIds, setExpandedIds } = state
    const [sendingAll, setSendingAll] = useState(false)
    const reorderHelpId = useId()
    const canSteerMessage = (message: AssistantComposerQueueProps['queuedMessages'][number]) => (
        !sendingAll && !edit && controller.isConnected && !controller.isStopping && Boolean(controller.onForceQueuedMessage)
        && message.status !== 'sending' && message.status !== 'compacting'
        && (message.dispatchMode !== 'steer' || ['paused', 'held', 'failed'].includes(message.status))
    )
    const steerable = controller.queuedMessages.filter(canSteerMessage)
    const canSendAll = steerable.length > 0 && (!controller.queueHeld || Boolean(controller.onResumeQueue))
    const sendAll = async () => {
        if (!canSendAll) return
        setSendingAll(true); setError(null)
        try {
            for (const message of steerable) await controller.onForceQueuedMessage?.(message.id)
            if (controller.queueHeld) await controller.onResumeQueue?.()
        } catch { setError('Could not send every queued message.') }
        finally { setSendingAll(false) }
    }
    return <ComposerMenuContext.Provider value={{ below: false }}>
        <AssistantComposerMenuSurface title="Queued message drawer">
        <section data-composer-attachment-item="true" aria-label="Queued messages" className="pointer-events-auto text-sparkle-text">
        <p id={reorderHelpId} className="sr-only">Drag a message to reorder it, or focus its handle and press Alt+ArrowUp or Alt+ArrowDown.</p>
        <header className="flex items-center justify-between gap-2 border-b border-[var(--surface-divider)] px-3 py-1.5">
            <h3 className="min-w-0 truncate text-[12px] font-semibold leading-5">Queued messages · {controller.queuedMessages.length}</h3>
            <div className="flex shrink-0 items-center gap-1">
            {controller.queueHeld ? <button type="button" onClick={() => void controller.onResumeQueue?.()}
                disabled={!controller.onResumeQueue || controller.isStopping || !controller.isConnected || sendingAll}
                className={action}>Resume queue</button> : null}
            {controller.queuedMessages.length > 1 ? <button type="button" aria-label="Send all queued messages" title="Send all queued messages now" disabled={!canSendAll} aria-busy={sendingAll}
                onClick={() => void sendAll()} className={cn(steeringAction, 'border-transparent bg-[var(--accent-primary)] text-[var(--accent-on-primary)] hover:brightness-110')}><ArrowUp size={14} aria-hidden="true" /></button> : null}
            </div>
        </header>
        <div className="custom-scrollbar max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain">
            {controller.queuedMessages.map((message, index) => {
                const steer = message.dispatchMode === 'steer'
                const held = message.status === 'paused' || message.status === 'held' || message.status === 'failed'
                const sending = message.status === 'sending'
                const compacting = message.status === 'compacting'
                const canSteer = canSteerMessage(message)
                const canEdit = Boolean(controller.onUpdateQueuedMessage) && !sending && !sendingAll
                const editing = edit?.id === message.id
                const expanded = expandedIds.has(message.id)
                const prompt = message.prompt.trim() || 'Attachment-only message'
                const editMessage = () => {
                    if (!canEdit) return
                    controller.onHoldQueue?.()
                    setEdit({ id: message.id, text: message.prompt }); setError(null)
                }
                return <div key={message.id} data-queued-message-id={message.id}
                    onDragOver={event => {
                        if (!controller.onMoveQueuedMessage || !draggedId || draggedId === message.id) return
                        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTargetId(message.id)
                    }}
                    onDragLeave={event => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(current => current === message.id ? null : current)
                    }}
                    onDrop={event => {
                        if (!controller.onMoveQueuedMessage || !draggedId || draggedId === message.id) return
                        event.preventDefault(); void controller.onMoveQueuedMessage(draggedId, message.id); setDraggedId(null); setDropTargetId(null)
                    }}
                    className={cn('relative flex items-start gap-2 px-3 py-1', index > 0 && 'border-t border-[var(--surface-divider)]', draggedId === message.id && 'opacity-45')}>
                    {dropTargetId === message.id && draggedId && draggedId !== message.id ? <span aria-hidden="true" data-queue-drop-edge={controller.queuedMessages.findIndex(entry => entry.id === draggedId) < index ? 'after' : 'before'}
                        className={cn('pointer-events-none absolute inset-x-0 h-0.5 bg-[var(--accent-primary)]', controller.queuedMessages.findIndex(entry => entry.id === draggedId) < index ? 'bottom-0' : 'top-0')} /> : null}
                    <button type="button" draggable={Boolean(controller.onMoveQueuedMessage)} disabled={!controller.onMoveQueuedMessage}
                        aria-label={`Reorder queued message ${index + 1}`} aria-describedby={reorderHelpId} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        title="Drag to reorder · Alt+ArrowUp / Alt+ArrowDown"
                        className="mt-1 inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-sparkle-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] active:cursor-grabbing disabled:cursor-default disabled:opacity-35"
                        onKeyDown={event => {
                            if (!controller.onMoveQueuedMessage || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                            event.preventDefault(); event.stopPropagation()
                            const target = controller.queuedMessages[index + (event.key === 'ArrowUp' ? -1 : 1)]
                            if (target) void controller.onMoveQueuedMessage(message.id, target.id)
                        }}
                        onDragStart={event => {
                            if (!controller.onMoveQueuedMessage) return
                            setDraggedId(message.id); setDropTargetId(null)
                            event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', message.id)
                            const row = event.currentTarget.closest<HTMLElement>('[data-queued-message-id]')
                            if (row) event.dataTransfer.setDragImage(row, 20, 16)
                        }} onDragEnd={() => { setDraggedId(null); setDropTargetId(null) }}><GripVertical size={14} aria-hidden="true" /></button>
                    <div className="min-w-0 flex-1">
                        <AssistantQuestionTransition sectionKey={editing ? 'editing' : 'preview'}>
                        {editing && edit ? <div data-queue-editor className="py-1">
                            <textarea autoFocus aria-label="Edit queued message" value={edit.text} onChange={event => setEdit({ id: message.id, text: event.target.value })}
                                className="block max-h-40 min-h-10 w-full resize-none overflow-y-auto rounded-none border-0 border-b border-[var(--accent-primary)] bg-transparent px-0 pb-2 pt-0 text-[12.5px] leading-5 outline-none [field-sizing:content]" />
                            {error ? <p role="alert" className="pt-2 text-xs text-[var(--status-warning)]">{error}</p> : null}
                            <div className="flex items-center justify-end gap-1 pt-2">
                                <button type="button" className={action} onClick={() => { setEdit(null); setError(null) }}>Cancel</button>
                                <button type="button" className="inline-flex h-7 items-center justify-center rounded-md bg-[var(--accent-primary)] px-3 text-[11px] font-medium text-[var(--accent-on-primary)] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]" onClick={async () => {
                                    const saved = await controller.onUpdateQueuedMessage?.(message.id, edit.text)
                                    if (saved === false) { setError('Could not save. The queued message may have started or storage is unavailable.'); return }
                                    setEdit(null); setError(null)
                                }}>Save</button>
                            </div>
                        </div> : <div className="flex min-w-0 items-start gap-2"><button type="button" data-queued-message-preview="true" aria-expanded={expanded} title={expanded ? 'Collapse message' : 'Show full message'}
                            onClick={() => setExpandedIds(current => {
                                const next = new Set(current)
                                if (next.has(message.id)) next.delete(message.id); else next.add(message.id)
                                return next
                            })}
                            className={cn('block min-w-0 flex-1 py-1 text-left text-[12.5px] leading-5 text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]', expanded ? 'whitespace-pre-wrap break-words' : 'truncate')}>{prompt}</button>
                            {sending || compacting || held || message.contextFiles.length ? <div className="flex shrink-0 items-center gap-1.5 py-1.5 text-[10px] leading-4 text-sparkle-text-muted">
                                {sending ? <span role="status">Sending…</span> : null}
                                {compacting ? <span role="status" title="Letting compaction finish">Compacting</span> : null}
                                {held ? <span className="text-[var(--status-warning)]">Held</span> : null}
                                {message.contextFiles.length ? <span>{message.contextFiles.length} file{message.contextFiles.length === 1 ? '' : 's'}</span> : null}
                            </div> : null}
                        </div>}
                        </AssistantQuestionTransition>
                    </div>
                    {!editing ? <div className="flex shrink-0 items-center gap-0.5">
                        <button type="button" className={cn(action, 'size-7 p-0')} aria-label="Delete queued message" title="Delete queued message" disabled={!controller.onDeleteQueuedMessage || sendingAll}
                            onClick={() => void controller.onDeleteQueuedMessage?.(message.id)}><Trash2 size={13} aria-hidden="true" /></button>
                        <button type="button" className={cn(action, 'size-7 p-0')} aria-label="Edit queued message" title="Edit queued message" disabled={!canEdit}
                            onClick={editMessage}><Pencil size={13} aria-hidden="true" /></button>
                        <button type="button" aria-label="Steer queued message" className={cn(steeringAction, 'border-[var(--surface-divider)] text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text')} disabled={!canSteer}
                            onClick={() => void controller.onForceQueuedMessage?.(message.id)}
                            title={canSteer ? 'Steer the current turn with this message without stopping it' : steer ? 'This message is being delivered as a steer' : 'Steer is unavailable while preparing or compacting'}><ArrowUp size={14} aria-hidden="true" /></button>
                    </div> : null}
                </div>
            })}
        </div>
        {error && !edit ? <p role="alert" className="px-3 pb-2 text-xs text-[var(--status-warning)]">{error}</p> : null}
    </section>
    </AssistantComposerMenuSurface>
    </ComposerMenuContext.Provider>
}
