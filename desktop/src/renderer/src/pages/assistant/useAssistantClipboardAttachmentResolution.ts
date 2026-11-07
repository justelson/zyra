import { useCallback, useEffect, useRef, useState } from 'react'
import { isClipboardAttachmentReference, type ParsedUserAttachment } from './assistant-timeline-helpers'

type Resolution = { messageId: string; paths: Record<string, string>; recovery: Record<string, 'loading' | 'error'> }
async function resolve(reference: string) {
    try { return await window.devscope.assistant.resolveClipboardAttachment({ reference }) }
    catch { return { success: false as const, error: 'Could not load this attachment.' } }
}

function applyResolution(current: Resolution, id: string, result: Awaited<ReturnType<typeof resolve>>): Resolution {
    const recovery = { ...current.recovery }
    if (result.success && result.path) delete recovery[id]
    else recovery[id] = 'error'
    return { ...current, paths: result.success && result.path ? { ...current.paths, [id]: result.path } : current.paths, recovery }
}

/** Pending is distinct from a confirmed missing attachment; late results retain their owner. */
export function useAssistantClipboardAttachmentResolution(messageId: string, attachments: ParsedUserAttachment[]) {
    const referenceKey = JSON.stringify(attachments.filter(attachment => isClipboardAttachmentReference(attachment.path) && (attachment.type === 'IMAGE' || attachment.type === 'VIDEO' || attachment.mime?.startsWith('video/'))).map(({ id, path }) => ({ id, reference: path || '' })))
    const generation = useRef(0)
    const [state, setState] = useState<Resolution>({ messageId, paths: {}, recovery: {} })
    useEffect(() => {
        const owner = ++generation.current
        const clipboard = JSON.parse(referenceKey) as Array<{ id: string; reference: string }>
        if (!clipboard.length) {
            setState(current => current.messageId === messageId && !Object.keys(current.paths).length && !Object.keys(current.recovery).length ? current : { messageId, paths: {}, recovery: {} })
            return () => { generation.current++ }
        }
        setState({ messageId, paths: {}, recovery: Object.fromEntries(clipboard.map(attachment => [attachment.id, 'loading'])) })
        for (const attachment of clipboard) void resolve(attachment.reference).then(result => {
            if (owner === generation.current) setState(current => applyResolution(current, attachment.id, result))
        })
        return () => { generation.current++ }
    }, [referenceKey, messageId])
    const retry = useCallback(async (id: string, reference: string) => {
        const owner = generation.current
        setState(current => ({ ...current, recovery: { ...current.recovery, [id]: 'loading' } }))
        const result = await resolve(reference)
        if (owner !== generation.current) return null
        setState(current => applyResolution(current, id, result))
        return result
    }, [])
    return { paths: state.messageId === messageId ? state.paths : {}, recovery: state.messageId === messageId ? state.recovery : {}, retry }
}
