import { useEffect, useId, useState } from 'react'
import { GripVertical, Pencil, Trash2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssistantComposerController } from './useAssistantComposerController'

export type AssistantComposerQueueProps = Pick<AssistantComposerController,
    'loadedSessionId' | 'queuedMessages' | 'queueHeld' | 'isStopping' | 'isConnected' |
    'onResumeQueue' | 'onHoldQueue' | 'onUpdateQueuedMessage' | 'onMoveQueuedMessage' |
    'onDeleteQueuedMessage' | 'onForceQueuedMessage'>

const action = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-35'

/** Keep the edit buffer in the composer even when its shelf is temporarily replaced by suggestions. */
export function useAssistantComposerQueueState(sessionId: AssistantComposerQueueProps['loadedSessionId']) {
    const [draggedId, setDraggedId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const [edit, setEdit] = useState<{ id: string; text: string } | null>(null)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => { setEdit(null); setError(null) }, [sessionId])
    return { draggedId, setDraggedId, dropTargetId, setDropTargetId, edit, setEdit, error, setError }
}

export type AssistantComposerQueueState = ReturnType<typeof useAssistantComposerQueueState>

/** Presentation only. Queue ownership and dispatch stay in the controller. */
export function AssistantComposerQueue({ controller, state }: { controller: AssistantComposerQueueProps; state: ReturnType<typeof useAssistantComposerQueueState> }) {
    const { draggedId, setDraggedId, dropTargetId, setDropTargetId, edit, setEdit, error, setError } = state
    const reorderHelpId = useId()
    return <section data-composer-attachment-item="true" aria-label="Queued messages"
        className="pointer-events-auto mx-auto w-[calc(100%-1rem)] overflow-hidden rounded-xl border border-[var(--surface-divider)] bg-sparkle-card text-sparkle-text shadow-[0_8px_28px_rgba(0,0,0,0.22)] sm:w-[calc(100%-2.25rem)]">
        <p id={reorderHelpId} className="sr-only">Drag a message to reorder it, or focus its handle and press Alt+ArrowUp or Alt+ArrowDown.</p>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--surface-divider)] px-4 py-3">
            <div>
                <h3 className="text-[13px] font-semibold leading-5">Queued messages · {controller.queuedMessages.length}</h3>
                <p role="status" className="text-[11px] leading-4 text-sparkle-text-secondary">{controller.queueHeld ? 'On hold. Resume when you’re ready.' : 'Waiting for delivery.'}</p>
            </div>
            {controller.queueHeld ? <button type="button" onClick={() => void controller.onResumeQueue?.()}
                disabled={!controller.onResumeQueue || controller.isStopping || !controller.isConnected}
                className={cn(action, 'border border-[var(--surface-divider)]')}>Resume queue</button> : null}
        </header>
        <div className="custom-scrollbar max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain">
            {controller.queuedMessages.map((message, index) => {
                const steer = message.dispatchMode === 'steer'
                const held = message.status === 'paused' || message.status === 'held' || message.status === 'failed'
                const sending = message.status === 'sending'
                const compacting = message.status === 'compacting'
                const canSteer = !sending && !compacting && Boolean(controller.onForceQueuedMessage) && (!steer || held)
                const canEdit = Boolean(controller.onUpdateQueuedMessage) && !sending
                const editing = edit?.id === message.id
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
                    className={cn('relative flex flex-wrap items-start gap-x-2.5 gap-y-1 px-4 py-3', index > 0 && 'border-t border-[var(--surface-divider)]', draggedId === message.id && 'opacity-45')}>
                    {dropTargetId === message.id && draggedId && draggedId !== message.id ? <span aria-hidden="true" data-queue-drop-edge={controller.queuedMessages.findIndex(entry => entry.id === draggedId) < index ? 'after' : 'before'}
                        className={cn('pointer-events-none absolute inset-x-0 h-0.5 bg-[var(--accent-primary)]', controller.queuedMessages.findIndex(entry => entry.id === draggedId) < index ? 'bottom-0' : 'top-0')} /> : null}
                    <button type="button" draggable={Boolean(controller.onMoveQueuedMessage)} disabled={!controller.onMoveQueuedMessage}
                        aria-label={`Reorder queued message ${index + 1}`} aria-describedby={reorderHelpId} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        title="Drag to reorder · Alt+ArrowUp / Alt+ArrowDown"
                        className="mt-0.5 inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-sparkle-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] active:cursor-grabbing disabled:cursor-default disabled:opacity-35"
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
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] leading-4 text-sparkle-text-muted">
                            {sending ? <span role="status">Sending…</span> : null}
                            {compacting ? <span role="status">Letting compaction finish</span> : null}
                            {held ? <span className="text-[var(--status-warning)]">Held</span> : null}
                            {steer ? <span>Steer</span> : null}
                            {message.contextFiles.length ? <span>{message.contextFiles.length} file{message.contextFiles.length === 1 ? '' : 's'}</span> : null}
                        </div>
                        {editing && edit ? <div className="space-y-2 pt-1">
                            <textarea aria-label="Edit queued message" value={edit.text} onChange={event => setEdit({ id: message.id, text: event.target.value })}
                                className="min-h-16 w-full resize-y rounded-md border border-[var(--surface-divider)] bg-transparent p-2 text-sm outline-none focus:border-[var(--accent-primary)]" />
                            <div className="flex items-center gap-1">
                                <button type="button" className={action} onClick={async () => {
                                    const saved = await controller.onUpdateQueuedMessage?.(message.id, edit.text)
                                    if (saved === false) { setError('Could not save. The queued message may have started or storage is unavailable.'); return }
                                    setEdit(null); setError(null)
                                }}>Save</button>
                                <button type="button" className={action} onClick={() => { setEdit(null); setError(null) }}>Cancel</button>
                            </div>
                            {error ? <p role="alert" className="text-xs text-[var(--status-warning)]">{error}</p> : null}
                        </div> : <button type="button" onClick={editMessage} disabled={!canEdit} title={prompt}
                            className="mt-0.5 block w-full cursor-text whitespace-pre-wrap break-words text-left text-[12.5px] leading-5 text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-default"
                            style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{prompt}</button>}
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-end gap-1 pl-6">
                        <button type="button" className={action} aria-label="Delete queued message" title="Delete queued message" disabled={!controller.onDeleteQueuedMessage}
                            onClick={() => void controller.onDeleteQueuedMessage?.(message.id)}><Trash2 size={13} aria-hidden="true" /></button>
                        <button type="button" className={action} aria-label="Edit queued message" title="Edit queued message" disabled={!canEdit}
                            onClick={editMessage}><Pencil size={13} aria-hidden="true" /></button>
                        <button type="button" className={cn(action, 'border border-[var(--surface-divider)]')} disabled={!canSteer}
                            onClick={() => void controller.onForceQueuedMessage?.(message.id)}
                            title={canSteer ? 'Steer the current turn with this message without stopping it' : steer ? 'This message is being delivered as a steer' : 'Steer is unavailable while preparing or compacting'}><Zap size={11} aria-hidden="true" />Steer</button>
                    </div>
                </div>
            })}
        </div>
    </section>
}
