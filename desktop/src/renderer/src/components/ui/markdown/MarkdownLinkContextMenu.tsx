import { useEffect, useState } from 'react'
import { Copy, ExternalLink, File, FolderOpen, Globe2, RefreshCw } from 'lucide-react'
import type { FileActionsMenuItem } from '../FileActionsMenu'
import { PreviewTreeContextMenu } from '../file-preview/PreviewTreeContextMenu'
import { openAccessory } from '@/lib/accessories'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { inspectMarkdownLinkAvailability, type MarkdownLinkAvailabilityResult } from './linkAvailability'
import { normalizeMarkdownHref, resolveMarkdownLinkTarget } from './linkNavigation'
import type { MarkdownLinkNoticeHandler } from './MarkdownInteractionLayer'

export type MarkdownLinkMenuTarget = {
    element: HTMLElement
    href: string
    fileLink: boolean
    x: number
    y: number
}

export function MarkdownLinkContextMenu({ target, filePath, searchRootPath, onClose, onLinkNotice }: {
    target: MarkdownLinkMenuTarget
    filePath?: string
    searchRootPath?: string
    onClose: (options?: { restoreFocus?: boolean }) => void
    onLinkNotice?: MarkdownLinkNoticeHandler
}) {
    const [availability, setAvailability] = useState<MarkdownLinkAvailabilityResult | null>(null)
    const [checking, setChecking] = useState(target.fileLink)
    const inspect = () => inspectMarkdownLinkAvailability(target.href, filePath, searchRootPath, {
        force: true,
        allowProjectSearch: !target.element.dataset.devscopeFileReference
    })
    useEffect(() => {
        let disposed = false
        setAvailability(null)
        setChecking(target.fileLink)
        if (target.fileLink) void inspectMarkdownLinkAvailability(target.href, filePath, searchRootPath, {
            force: true,
            allowProjectSearch: !target.element.dataset.devscopeFileReference
        }).then((result) => {
            if (disposed) return
            setAvailability(result)
            setChecking(false)
        })
        return () => { disposed = true }
    }, [target, filePath, searchRootPath])

    const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
        try {
            const result = await action()
            if (!result.success) onLinkNotice?.(result.error || 'Could not open this link.', 'error')
        } catch {
            onLinkNotice?.('Could not open this link.', 'error')
        }
    }
    const copy = async (value: string) => {
        try { await navigator.clipboard.writeText(value) }
        catch { onLinkNotice?.('Could not copy this link.', 'error') }
    }
    const knownPath = availability?.path || resolveMarkdownLinkTarget(target.href, filePath)?.path || target.href
    const items: FileActionsMenuItem[] = target.fileLink ? [
        {
            id: 'open-file', label: checking ? 'Checking file…' : availability?.availability === 'missing' ? 'File not found' : 'Open file',
            icon: <File size={14} />, disabled: availability?.availability !== 'available',
            onSelect: () => { if (target.element.isConnected) target.element.click() }
        },
        {
            id: 'reveal-file', label: 'Show in file manager', icon: <FolderOpen size={14} />,
            disabled: availability?.availability !== 'available',
            onSelect: async () => {
                const current = await inspect()
                if (current?.availability !== 'available') {
                    onLinkNotice?.('This file is missing or could not be verified.', 'error')
                    return
                }
                await run(() => window.devscope.openInExplorer(current.path))
            }
        },
        { id: 'copy-path', label: 'Copy path', icon: <Copy size={14} />, onSelect: () => copy(knownPath) },
        { id: 'copy-link', label: 'Copy link', icon: <Copy size={14} />, onSelect: () => copy(target.href) },
        {
            id: 'check-file', label: 'Check file again', icon: <RefreshCw size={14} />,
            onSelect: async () => {
                const current = await inspect()
                onLinkNotice?.(current?.availability === 'available' ? `File exists: ${current.path}` : current?.availability === 'missing' ? `File not found: ${current.path}` : 'Could not verify this file.', current?.availability === 'available' ? 'info' : 'error')
            }
        }
    ] : [
        {
            id: 'open-zyra-browser', label: 'Open in Zyra Browser', icon: <Globe2 size={14} />,
            disabled: !isElectronRendererRuntime(),
            onSelect: () => run(() => openAccessory({ kind: 'browser', sessionMode: 'normal', url: normalizeMarkdownHref(target.href) }))
        },
        {
            id: 'open-default-browser', label: 'Open in default browser', icon: <ExternalLink size={14} />,
            onSelect: () => run(() => window.devscope.openBrowserPreviewExternal(normalizeMarkdownHref(target.href)))
        },
        { id: 'copy-link', label: 'Copy link', icon: <Copy size={14} />, onSelect: () => copy(normalizeMarkdownHref(target.href)) }
    ]
    return <PreviewTreeContextMenu items={items} anchor={{ left: target.x, right: target.x, top: target.y, bottom: target.y, width: 0 }} onClose={onClose} />
}
