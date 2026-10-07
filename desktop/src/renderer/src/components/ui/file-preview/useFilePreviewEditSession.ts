import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { summarizeGitDiff, type GitDiffSummary } from './gitDiff'
import type { PreviewFile } from './types'
import type { PendingIntent } from './modalShared'
import { captureProductEvent } from '@/lib/product-analytics'

type UseFilePreviewEditSessionParams = {
    file: PreviewFile
    content: string
    loading?: boolean
    truncated?: boolean
    modifiedAt?: number
    projectPath?: string
    canEdit: boolean
    initialMode: 'preview' | 'edit'
    onSaved?: (filePath: string) => Promise<void> | void
    onClose: () => void
}

export function useFilePreviewEditSession({
    file,
    content,
    loading = false,
    truncated,
    modifiedAt,
    projectPath,
    canEdit,
    initialMode,
    onSaved,
    onClose
}: UseFilePreviewEditSessionParams) {
    const [mode, setMode] = useState<'preview' | 'edit'>(initialMode)
    const [gitDiffText, setGitDiffText] = useState<string>('No changes')
    const [gitDiffSummary, setGitDiffSummary] = useState<GitDiffSummary | null>(null)
    const [sourceContent, setSourceContent] = useState(content)
    const [draftContent, setDraftContent] = useState(content)
    const [loadingEditableContent, setLoadingEditableContent] = useState(false)
    const [hasLoadedEditableContent, setHasLoadedEditableContent] = useState(!truncated)
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [showUnsavedModal, setShowUnsavedModal] = useState(false)
    const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null)
    const [gitSummaryRefreshToken, setGitSummaryRefreshToken] = useState(0)
    const [fileModifiedAt, setFileModifiedAt] = useState<number | null>(typeof modifiedAt === 'number' ? modifiedAt : null)
    const [conflictModifiedAt, setConflictModifiedAt] = useState<number | null>(null)
    const pendingExternalActionRef = useRef<(() => void | Promise<void>) | null>(null)

    const isDirty = draftContent !== sourceContent
    const sessionFilePathRef = useRef(file.path)
    const contentHydratedRef = useRef(!loading)
    const editStateRef = useRef({ mode, isDirty })
    editStateRef.current = { mode, isDirty }

    useLayoutEffect(() => {
        const fileChanged = sessionFilePathRef.current !== file.path
        sessionFilePathRef.current = file.path
        const receivingFirstRead = !loading && !contentHydratedRef.current
        if (fileChanged) contentHydratedRef.current = !loading
        else if (receivingFirstRead) contentHydratedRef.current = true
        // File watchers and post-save refreshes must not reset an active editor.
        // Explicit reload/revert still owns replacing the current draft.
        if (!fileChanged && (editStateRef.current.isDirty || (editStateRef.current.mode === 'edit' && !receivingFirstRead))) return
        setMode(initialMode)
        setSourceContent(content)
        setDraftContent(content)
        setHasLoadedEditableContent(!truncated)
        setLoadingEditableContent(false)
        setSaveError(null)
        setShowUnsavedModal(false)
        setPendingIntent(null)
        pendingExternalActionRef.current = null
        setFileModifiedAt(typeof modifiedAt === 'number' ? modifiedAt : null)
        setConflictModifiedAt(null)
    }, [content, file.path, initialMode, loading, modifiedAt, truncated])

    useEffect(() => {
        if (isDirty || mode === 'edit') return
        const incomingModifiedAt = typeof modifiedAt === 'number' ? modifiedAt : null
        const hasKnownLocalVersion = typeof fileModifiedAt === 'number'
        const isIncomingOlderThanLocal = (
            incomingModifiedAt !== null
            && hasKnownLocalVersion
            && incomingModifiedAt < (fileModifiedAt - 1)
        )

        if (isIncomingOlderThanLocal) return

        const shouldUpdateSource = content !== sourceContent
        const shouldUpdateDraft = !isDirty && draftContent !== content
        const shouldUpdateVersion = incomingModifiedAt !== null && incomingModifiedAt !== fileModifiedAt

        if (shouldUpdateSource) setSourceContent(content)
        if (shouldUpdateDraft) setDraftContent(content)
        if (shouldUpdateVersion) setFileModifiedAt(incomingModifiedAt)
    }, [content, draftContent, fileModifiedAt, isDirty, mode, modifiedAt, sourceContent])

    const commitPendingIntent = useCallback(async () => {
        if (pendingIntent === 'close') {
            onClose()
        } else if (pendingIntent === 'preview') {
            setMode('preview')
        } else if (pendingIntent === 'external') {
            const pendingExternalAction = pendingExternalActionRef.current
            pendingExternalActionRef.current = null
            if (pendingExternalAction) {
                await pendingExternalAction()
            }
        }
        setPendingIntent(null)
    }, [onClose, pendingIntent])

    const handleSave = useCallback(async () => {
        if (!canEdit || isSaving || !isDirty || !file.path) return true

        const startedAt = performance.now()
        setIsSaving(true)
        setSaveError(null)
        try {
            const result = await window.devscope.writeTextFile(
                file.path,
                draftContent,
                typeof fileModifiedAt === 'number' ? fileModifiedAt : undefined
            )
            if (!result?.success) {
                const maybeConflict = result && 'conflict' in result ? result : null
                if (maybeConflict?.conflict) {
                    setConflictModifiedAt(
                        typeof maybeConflict.currentModifiedAt === 'number'
                            ? maybeConflict.currentModifiedAt
                            : Date.now()
                    )
                    setSaveError('File changed on disk. Review and choose reload or overwrite.')
                    captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'save', outcome: 'failed', duration_ms: performance.now() - startedAt, error_code: 'duplicate' } })
                    return false
                }
                setSaveError(result?.error || 'Failed to save file changes.')
                captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'save', outcome: 'failed', duration_ms: performance.now() - startedAt, error_code: 'unknown' } })
                return false
            }

            setSourceContent(draftContent)
            setHasLoadedEditableContent(true)
            setFileModifiedAt(typeof result.modifiedAt === 'number' ? result.modifiedAt : Date.now())
            setConflictModifiedAt(null)
            setGitSummaryRefreshToken((current) => current + 1)
            if (typeof onSaved === 'function') {
                void Promise.resolve(onSaved(file.path)).catch((error) => {
                    console.warn('Post-save refresh failed:', error)
                })
            }
            captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'save', outcome: 'completed', duration_ms: performance.now() - startedAt } })
            return true
        } catch (error: any) {
            setSaveError(error?.message || 'Failed to save file changes.')
            captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'save', outcome: 'failed', duration_ms: performance.now() - startedAt, error_code: 'unknown' } })
            return false
        } finally {
            setIsSaving(false)
        }
    }, [canEdit, draftContent, file.path, fileModifiedAt, isDirty, isSaving, onSaved])

    const ensureEditableContentLoaded = useCallback(async () => {
        if (!canEdit || hasLoadedEditableContent || !file.path) return true

        setLoadingEditableContent(true)
        setSaveError(null)
        try {
            const result = await window.devscope.readTextFileFull(file.path)
            if (!result?.success) {
                setSaveError(result?.error || 'Failed to load full file for editing.')
                return false
            }
            const fullContent = String(result.content || '')
            setSourceContent(fullContent)
            setDraftContent(fullContent)
            setHasLoadedEditableContent(true)
            setFileModifiedAt(typeof result.modifiedAt === 'number' ? result.modifiedAt : Date.now())
            setConflictModifiedAt(null)
            return true
        } catch (error: any) {
            setSaveError(error?.message || 'Failed to load full file for editing.')
            return false
        } finally {
            setLoadingEditableContent(false)
        }
    }, [canEdit, file.path, hasLoadedEditableContent])

    useEffect(() => {
        if (mode !== 'edit') return
        if (!canEdit) return
        if (hasLoadedEditableContent || loadingEditableContent) return
        void ensureEditableContentLoaded()
    }, [canEdit, ensureEditableContentLoaded, hasLoadedEditableContent, loadingEditableContent, mode])

    const reloadFromDisk = useCallback(async () => {
        if (!file.path) return false
        setLoadingEditableContent(true)
        setSaveError(null)
        try {
            const result = await window.devscope.readTextFileFull(file.path)
            if (!result?.success) {
                setSaveError(result?.error || 'Failed to reload latest file content.')
                return false
            }
            const fullContent = String(result.content || '')
            setSourceContent(fullContent)
            setDraftContent(fullContent)
            setFileModifiedAt(typeof result.modifiedAt === 'number' ? result.modifiedAt : Date.now())
            setHasLoadedEditableContent(true)
            setConflictModifiedAt(null)
            return true
        } catch (error: any) {
            setSaveError(error?.message || 'Failed to reload latest file content.')
            return false
        } finally {
            setLoadingEditableContent(false)
        }
    }, [file.path])

    const overwriteOnConflict = useCallback(async () => {
        if (!canEdit || !file.path) return false
        setIsSaving(true)
        setSaveError(null)
        try {
            const result = await window.devscope.writeTextFile(file.path, draftContent)
            if (!result?.success) {
                setSaveError(result?.error || 'Failed to overwrite file after conflict.')
                return false
            }
            setSourceContent(draftContent)
            setFileModifiedAt(typeof result.modifiedAt === 'number' ? result.modifiedAt : Date.now())
            setConflictModifiedAt(null)
            setGitSummaryRefreshToken((current) => current + 1)
            if (typeof onSaved === 'function') {
                void Promise.resolve(onSaved(file.path)).catch((error) => {
                    console.warn('Post-save refresh failed:', error)
                })
            }
            return true
        } catch (error: any) {
            setSaveError(error?.message || 'Failed to overwrite file after conflict.')
            return false
        } finally {
            setIsSaving(false)
        }
    }, [canEdit, draftContent, file.path, onSaved])

    const requestIntent = useCallback((intent: PendingIntent) => {
        if (!isDirty) {
            if (intent === 'close') onClose()
            else setMode('preview')
            return
        }
        setPendingIntent(intent)
        setShowUnsavedModal(true)
    }, [isDirty, onClose])

    const handleCloseRequest = useCallback(() => {
        requestIntent('close')
    }, [requestIntent])

    const dismissUnsavedChanges = useCallback(() => {
        setShowUnsavedModal(false)
        setPendingIntent(null)
        pendingExternalActionRef.current = null
    }, [])

    const discardUnsavedChanges = useCallback(() => {
        setDraftContent(sourceContent)
        setShowUnsavedModal(false)
        captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'discard', outcome: 'completed' } })
        void commitPendingIntent()
    }, [commitPendingIntent, sourceContent])

    const confirmUnsavedChanges = useCallback(async () => {
        const saved = await handleSave()
        if (!saved) return
        setShowUnsavedModal(false)
        await commitPendingIntent()
    }, [commitPendingIntent, handleSave])

    const requestExternalIntent = useCallback((action: () => void | Promise<void>) => {
        if (!isDirty) {
            const result = action()
            if (result && typeof (result as Promise<void>).then === 'function') {
                void result
            }
            return
        }
        pendingExternalActionRef.current = action
        setPendingIntent('external')
        setShowUnsavedModal(true)
    }, [isDirty])

    useEffect(() => {
        let disposed = false

        const loadGitDiffSummary = async () => {
            if (!projectPath || !file.path) {
                if (!disposed) {
                    setGitDiffText('No changes')
                    setGitDiffSummary(null)
                }
                return
            }

            try {
                const result = await window.devscope.getWorkingDiff(projectPath, file.path, 'combined')
                if (disposed || !result?.success) {
                    if (!disposed) {
                        setGitDiffText('No changes')
                        setGitDiffSummary(null)
                    }
                    return
                }

                const rawDiff = String(result.diff || 'No changes')
                if (!disposed) {
                    setGitDiffText(rawDiff)
                    setGitDiffSummary(summarizeGitDiff(rawDiff))
                }
            } catch {
                if (!disposed) {
                    setGitDiffText('No changes')
                    setGitDiffSummary(null)
                }
            }
        }

        void loadGitDiffSummary()
        return () => {
            disposed = true
        }
    }, [file.path, gitSummaryRefreshToken, projectPath])

    const setTrackedMode = useCallback((nextMode: 'preview' | 'edit') => {
        setMode(nextMode)
        if (nextMode === 'edit') captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'edit', outcome: 'started' } })
    }, [])

    return {
        mode,
        setMode: setTrackedMode,
        gitDiffText,
        gitDiffSummary,
        sourceContent,
        draftContent,
        setDraftContent,
        loadingEditableContent,
        isSaving,
        saveError,
        setSaveError,
        showUnsavedModal,
        fileModifiedAt,
        conflictModifiedAt,
        setConflictModifiedAt,
        isDirty,
        commitPendingIntent,
        dismissUnsavedChanges,
        discardUnsavedChanges,
        confirmUnsavedChanges,
        handleSave,
        ensureEditableContentLoaded,
        reloadFromDisk,
        overwriteOnConflict,
        requestIntent,
        requestExternalIntent,
        handleCloseRequest
    }
}
