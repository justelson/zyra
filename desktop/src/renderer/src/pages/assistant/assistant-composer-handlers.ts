import type { ClipboardEvent, KeyboardEvent } from 'react'
import {
    InlineMentionTag,
    reconcileInlineMentionTags,
    removeInlineMentionTagRange,
    replaceInlineMentionTokensWithLabels,
    sortInlineMentionTags
} from './assistant-composer-inline-mentions'
import {
    ATTACHMENT_REMOVE_MS,
    buildAttachmentPath,
    buildTextAttachmentFromPaste,
    createAttachmentId,
    getContextFileMeta,
    inferImageExtensionFromMimeType,
    isLargeTextPaste,
    MAX_ATTACHMENT_CONTENT_CHARS,
    parseAssistantDesktopSlashCommand,
    readFileAsDataUrl,
    resolveAssistantDesktopSlashCommandAction,
    summarizeTextPreview
} from './assistant-composer-utils'
import type { MentionCandidate } from './assistant-composer-mentions'
import { setAssistantComposerUsageVisibility } from './assistant-composer-usage-visibility'
import type { AssistantComposerHandlersArgs } from './assistant-composer-handlers.types'
import type { ComposerContextFile } from './assistant-composer-types'

export function createAssistantComposerHandlers(args: AssistantComposerHandlersArgs) {
    const {
        disabled,
        disabledReason = null,
        allowEmptySubmit,
        isConnected,
        isSending,
        isThinking,
        busyMessageMode,
        onSend,
        text,
        setText,
        inlineMentionTags,
        setInlineMentionTags,
        contextFiles,
        setContextFiles,
        sentPromptHistory,
        setSentPromptHistory,
        historyCursor,
        setHistoryCursor,
        draftBeforeHistory,
        setDraftBeforeHistory,
        showMentionMenu,
        setShowMentionMenu,
        mentionCandidates,
        mentionState,
        activeMentionCandidate,
        setActiveMentionIndex,
        showModelDropdown,
        setShowModelDropdown,
        filteredModelOptions,
        activeModelCandidate,
        setActiveModelIndex,
        showBranchDropdown,
        setShowBranchDropdown,
        filteredBranches,
        activeBranchCandidate,
        setActiveBranchIndex,
        onSwitchBranch,
        selectedModel,
        setSelectedModel,
        selectedRuntimeMode,
        setSelectedRuntimeMode,
        selectedInteractionMode,
        selectedEffort,
        fastModeEnabled,
        setComposerCursor,
        removingAttachmentIds,
        setRemovingAttachmentIds,
        textareaRef,
        onBlockedSend,
        onOptimisticSendClear,
        shouldRestoreAfterFailedSend,
        onRestoreFailedSendDraft
    } = args

    const resolveBlockedSendReason = (hasContent: boolean): string => {
        if (!allowEmptySubmit && !hasContent) return 'Write a message or attach a file first.'
        if (disabledReason === 'no-session') return 'Select or create a chat before sending.'
        if (disabledReason === 'project-required') return 'Choose a project before sending in a work chat.'
        if (disabled) return 'Assistant is unavailable right now.'
        if (!isConnected) return 'Assistant is disconnected. Reconnect before sending.'
        if (isSending) return 'Message is already sending.'
        return 'Cannot send this message right now.'
    }

    const upsertAttachment = (attachment: ComposerContextFile) => {
        setContextFiles((prev) => {
            const sameByPath = prev.find((entry) => entry.path === attachment.path && entry.path !== '')
            return sameByPath ? prev : [...prev, attachment]
        })
    }

    const removeAttachment = (id: string) => {
        if (removingAttachmentIds.includes(id)) return
        setRemovingAttachmentIds((prev) => prev.includes(id) ? prev : [...prev, id])
        window.setTimeout(() => {
            setContextFiles((prev) => prev.filter((entry) => entry.id !== id))
            setRemovingAttachmentIds((prev) => prev.filter((entryId) => entryId !== id))
        }, ATTACHMENT_REMOVE_MS)
    }

    const restoreComposerFocus = () => {
        window.requestAnimationFrame(() => {
            const textarea = textareaRef.current
            if (!textarea || textarea.disabled) return
            const cursor = textarea.value.length
            textarea.focus()
            textarea.setSelectionRange(cursor, cursor)
        })
    }

    const applyMentionCandidate = (candidate: MentionCandidate) => {
        if (!mentionState) return
        const start = mentionState.start
        const cursor = textareaRef.current?.selectionStart ?? text.length
        const mentionToken = `@${candidate.name}`
        const nextText = `${text.slice(0, start)}${mentionToken} ${text.slice(cursor)}`
        const nextTag: InlineMentionTag = {
            id: createAttachmentId(),
            path: candidate.path,
            relativePath: candidate.relativePath,
            label: candidate.name,
            kind: candidate.type,
            start,
            end: start + mentionToken.length
        }
        setText(nextText)
        setInlineMentionTags((current) => sortInlineMentionTags([...reconcileInlineMentionTags(text, nextText, current), nextTag]))
        setShowMentionMenu(false)
        window.requestAnimationFrame(() => {
            const nextCursor = start + mentionToken.length + 1
            setComposerCursor(nextCursor)
            textareaRef.current?.focus()
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
        })
    }

    const getReadableFilePath = (file: File): string => {
        try {
            const resolvedPath = window.devscope.assistant.getPathForFile(file)
            if (String(resolvedPath || '').trim()) return String(resolvedPath).trim()
        } catch {}

        return String((file as File & { path?: string }).path || '').trim()
    }

    const persistAttachmentFile = async (file: File, name: string, source: 'paste' | 'manual', mimeType: string): Promise<string> => {
        const dataUrl = await readFileAsDataUrl(file)
        const saveResult = await window.devscope.assistant.persistClipboardImage({
            dataUrl,
            fileName: name,
            mimeType,
            source
        })
        if (!saveResult.success || !saveResult.path) {
            const errorMessage = saveResult.success ? 'Attachment path was not returned.' : saveResult.error
            throw new Error(errorMessage || 'Failed to save attachment.')
        }
        return saveResult.path
    }

    const attachFile = async (file: File, source: 'paste' | 'manual') => {
        const declaredMimeType = String(file.type || '').trim().toLowerCase()
        const fallbackName = declaredMimeType.startsWith('image/') ? `${source}-image-${Date.now()}.${inferImageExtensionFromMimeType(declaredMimeType)}` : `${source}-file-${Date.now()}`
        const name = file.name || fallbackName
        const electronPath = getReadableFilePath(file)
        const metaPath = electronPath || buildAttachmentPath(source, name)
        const mimeType = declaredMimeType || 'application/octet-stream'
        const looksLikeImageByName = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif|apng|heic|heif|jfif|jxl)$/i.test(name)
        const needsInlineImageContent = source === 'paste' || !electronPath || metaPath.startsWith('clipboard://')

        const addImageAttachment = async (dataUrl: string, resolvedMimeType: string) => {
            let attachmentPath = metaPath
            if (source === 'paste' || !electronPath) {
                const saveResult = await window.devscope.assistant.persistClipboardImage({
                    dataUrl,
                    fileName: name,
                    mimeType: resolvedMimeType,
                    source
                })
                if (!saveResult.success || !saveResult.path) {
                    const errorMessage = saveResult.success ? 'Clipboard image path was not returned.' : saveResult.error
                    throw new Error(errorMessage || 'Failed to save clipboard image.')
                }
                attachmentPath = saveResult.path
            }
            upsertAttachment({
                id: createAttachmentId(),
                path: attachmentPath,
                name,
                mimeType: resolvedMimeType,
                sizeBytes: file.size,
                kind: 'image',
                previewDataUrl: dataUrl,
                content: needsInlineImageContent && source !== 'paste' && !attachmentPath ? dataUrl : undefined,
                previewText: source === 'paste' ? 'Pasted image from clipboard.' : 'Attached image file.',
                source,
                animateIn: source === 'paste' ? false : true
            })
        }

        if (mimeType.startsWith('image/') || looksLikeImageByName) {
            let imageAttached = false
            try {
                const dataUrl = await readFileAsDataUrl(file)
                const dataUrlMimeMatch = dataUrl.match(/^data:([^;,]+)[;,]/i)
                await addImageAttachment(dataUrl, String(dataUrlMimeMatch?.[1] || '').trim().toLowerCase() || (mimeType.startsWith('image/') ? mimeType : 'image/png'))
                imageAttached = true
            } catch {}
            if (imageAttached) return
        }

        if (source === 'paste' && !declaredMimeType) {
            try {
                const dataUrl = await readFileAsDataUrl(file)
                const dataUrlMimeMatch = dataUrl.match(/^data:([^;,]+)[;,]/i)
                const dataUrlMimeType = String(dataUrlMimeMatch?.[1] || '').trim().toLowerCase()
                if (dataUrlMimeType.startsWith('image/')) {
                    await addImageAttachment(dataUrl, dataUrlMimeType)
                    return
                }
            } catch {}
        }

        try {
            const rawText = await file.text()
            const trimmed = rawText.length > MAX_ATTACHMENT_CONTENT_CHARS ? `${rawText.slice(0, MAX_ATTACHMENT_CONTENT_CHARS)}\n\n[truncated]` : rawText
            const attachmentPath = electronPath || await persistAttachmentFile(file, name, source, mimeType)
            const meta = getContextFileMeta({ path: attachmentPath, name, mimeType })
            upsertAttachment({
                id: createAttachmentId(),
                path: attachmentPath,
                name,
                mimeType,
                sizeBytes: file.size,
                kind: meta.category === 'code' ? 'code' : 'doc',
                content: trimmed,
                previewText: summarizeTextPreview(rawText),
                source,
                animateIn: true
            })
        } catch {
            let attachmentPath = metaPath
            if (!electronPath) {
                try {
                    attachmentPath = await persistAttachmentFile(file, name, source, mimeType)
                } catch {}
            }
            upsertAttachment({
                id: createAttachmentId(),
                path: attachmentPath,
                name,
                mimeType,
                sizeBytes: file.size,
                kind: 'file',
                previewText: source === 'paste' ? 'Binary attachment from clipboard.' : 'Attached binary file.',
                source,
                animateIn: true
            })
        }
    }

    const submitPrompt = async (dispatchMode: 'immediate' | 'queue' | 'force') => {
        const prompt = replaceInlineMentionTokensWithLabels(text, inlineMentionTags).trim()
        const desktopCommand = parseAssistantDesktopSlashCommand(prompt)
        if (desktopCommand) {
            const action = resolveAssistantDesktopSlashCommandAction(desktopCommand)
            if (action.type === 'error') {
                onBlockedSend?.(action.message)
                return
            }
            if (action.type === 'runtime-mode') setSelectedRuntimeMode(action.mode)
            if (action.type === 'usage-visibility') setAssistantComposerUsageVisibility(action.visible)
            if (action.type === 'include') {
                upsertAttachment({
                    id: createAttachmentId(),
                    path: action.path,
                    name: action.name,
                    kind: action.kind,
                    source: 'manual',
                    animateIn: true
                })
            }
            setText('')
            setInlineMentionTags([])
            setHistoryCursor(null)
            setDraftBeforeHistory('')
            setComposerCursor(0)
            restoreComposerFocus()
            return
        }
        const inlineMentionFiles: ComposerContextFile[] = inlineMentionTags.map((tag) => {
            const meta = getContextFileMeta({ path: tag.path, name: tag.label })
            return {
                id: `mention_${tag.id}`,
                path: tag.path,
                name: tag.label,
                kind: meta.category === 'image' ? 'image' : meta.category === 'code' ? 'code' : 'file',
                source: 'manual'
            }
        })
        const contextFilesForSend = [...contextFiles, ...inlineMentionFiles].filter((file, index, collection) => {
            const fileKey = `${String(file.path || '').toLowerCase()}::${String(file.name || '').toLowerCase()}`
            return collection.findIndex((candidate) => `${String(candidate.path || '').toLowerCase()}::${String(candidate.name || '').toLowerCase()}` === fileKey) === index
        })
        const hasContent = Boolean(prompt || contextFilesForSend.length > 0)
        if ((!allowEmptySubmit && !hasContent) || disabled || isSending || !isConnected) {
            onBlockedSend?.(resolveBlockedSendReason(hasContent))
            return
        }
        const prevText = text
        const prevTags = inlineMentionTags
        const prevFiles = contextFiles
        setText('')
        setInlineMentionTags([])
        setContextFiles([])
        setHistoryCursor(null)
        setDraftBeforeHistory('')
        onOptimisticSendClear?.()
        restoreComposerFocus()
        const success = await onSend(prompt, contextFilesForSend, {
            model: selectedModel || undefined,
            runtimeMode: selectedRuntimeMode,
            interactionMode: selectedInteractionMode,
            effort: selectedEffort,
            serviceTier: fastModeEnabled ? 'fast' : undefined,
            dispatchMode
        })
        if (!success) {
            const shouldRestore = shouldRestoreAfterFailedSend?.() ?? true
            if (shouldRestore) {
                setText(prevText)
                setInlineMentionTags(prevTags)
                setContextFiles(prevFiles)
                onRestoreFailedSendDraft?.(prevText)
            }
            restoreComposerFocus()
            return
        }
        if (prompt) setSentPromptHistory((prev) => prev[prev.length - 1] === prompt ? prev : [...prev.slice(-49), prompt])
        restoreComposerFocus()
    }

    const handleSend = async () => {
        await submitPrompt(isThinking ? busyMessageMode : 'immediate')
    }

    const handleQueueSend = async () => {
        await submitPrompt('queue')
    }

    const handleForceSend = async () => {
        await submitPrompt('force')
    }

    const handleRecallPrevious = () => {
        if (!sentPromptHistory.length) return
        if (historyCursor == null) {
            setDraftBeforeHistory(text)
            const nextIndex = sentPromptHistory.length - 1
            setHistoryCursor(nextIndex)
            setText(sentPromptHistory[nextIndex])
            setInlineMentionTags([])
            return
        }
        const nextIndex = Math.max(0, historyCursor - 1)
        setHistoryCursor(nextIndex)
        setText(sentPromptHistory[nextIndex])
        setInlineMentionTags([])
    }

    const handleRecallNext = () => {
        if (historyCursor == null) return
        if (historyCursor >= sentPromptHistory.length - 1) {
            setHistoryCursor(null)
            setText(draftBeforeHistory)
            setInlineMentionTags([])
            setDraftBeforeHistory('')
            return
        }
        const nextIndex = historyCursor + 1
        setHistoryCursor(nextIndex)
        setText(sentPromptHistory[nextIndex])
        setInlineMentionTags([])
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const target = event.currentTarget
        const selectionStart = target.selectionStart ?? 0
        const selectionEnd = target.selectionEnd ?? 0
        const atStart = selectionStart === 0 && selectionEnd === 0
        const atEnd = selectionStart === text.length && selectionEnd === text.length

        if (inlineMentionTags.length > 0 && (event.key === 'Backspace' || event.key === 'Delete')) {
            const isBackspace = event.key === 'Backspace'
            const overlappingTags = selectionStart === selectionEnd
                ? inlineMentionTags.filter((tag) => isBackspace ? selectionStart > tag.start && selectionStart <= tag.end : selectionStart >= tag.start && selectionStart < tag.end)
                : inlineMentionTags.filter((tag) => tag.start < selectionEnd && tag.end > selectionStart)

            if (overlappingTags.length > 0) {
                event.preventDefault()
                const rangeStart = Math.min(selectionStart, ...overlappingTags.map((tag) => tag.start))
                const rangeEnd = Math.max(selectionEnd, ...overlappingTags.map((tag) => tag.end))
                const nextText = `${text.slice(0, rangeStart)}${text.slice(rangeEnd)}`
                setText(nextText)
                setInlineMentionTags((current) => reconcileInlineMentionTags(text, nextText, removeInlineMentionTagRange(current, rangeStart, rangeEnd)))
                setComposerCursor(rangeStart)
                window.requestAnimationFrame(() => {
                    textareaRef.current?.focus()
                    textareaRef.current?.setSelectionRange(rangeStart, rangeStart)
                })
                return
            }
        }

        if (showMentionMenu && mentionCandidates.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveMentionIndex((current) => (current + 1) % mentionCandidates.length)
                return
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length)
                return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                applyMentionCandidate(activeMentionCandidate || mentionCandidates[0])
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                setShowMentionMenu(false)
                return
            }
        }

        if (showModelDropdown && filteredModelOptions.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveModelIndex((current) => (current + 1) % filteredModelOptions.length)
                return
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveModelIndex((current) => (current - 1 + filteredModelOptions.length) % filteredModelOptions.length)
                return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                setSelectedModel((activeModelCandidate || filteredModelOptions[0]).id)
                setShowModelDropdown(false)
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                setShowModelDropdown(false)
                return
            }
        }

        if (showBranchDropdown && filteredBranches.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveBranchIndex((current) => (current + 1) % filteredBranches.length)
                return
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveBranchIndex((current) => (current - 1 + filteredBranches.length) % filteredBranches.length)
                return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void onSwitchBranch((activeBranchCandidate || filteredBranches[0]).name)
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                setShowBranchDropdown(false)
                return
            }
        }

        if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'ArrowUp' && atStart) {
            event.preventDefault()
            handleRecallPrevious()
            return
        }
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'ArrowDown' && atEnd) {
            event.preventDefault()
            handleRecallNext()
            return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void handleSend()
        }
    }

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboard = event.clipboardData
        if (!clipboard) return
        const items = Array.from(clipboard.items || [])
        const fileItems = items.filter((item) => item.kind === 'file')
        if (fileItems.length > 0) {
            event.preventDefault()
            for (const item of fileItems) {
                const file = item.getAsFile()
                if (file) void attachFile(file, 'paste')
            }
            return
        }
        const plainText = clipboard.getData('text/plain')
        if (isLargeTextPaste(plainText)) {
            event.preventDefault()
            upsertAttachment(buildTextAttachmentFromPaste(plainText))
        }
    }

    return {
        removeAttachment,
        applyMentionCandidate,
        attachFile,
        handleSend,
        handleQueueSend,
        handleForceSend,
        handleRecallPrevious,
        handleRecallNext,
        handleKeyDown,
        handlePaste,
        hasRemovingAttachment: removingAttachmentIds.length > 0
    }
}
