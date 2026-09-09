import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AssistantPluginCatalog, AssistantPluginInspection, AssistantProject, AssistantSession } from '@shared/assistant/contracts'
import { getPluginRelease, getPluginSet, getReviewedCatalogPluginSelection, togglePluginSetId } from './plugin-directory-state'
import { assistantStore } from '@/lib/assistant/store'
import { pluginDownloadController } from './plugin-download-controller'

export function usePluginDirectory(desktopHost: boolean, selectedSession: AssistantSession | null) {
    const serviceAvailable = typeof window.devscope.assistant.getPluginCatalog === 'function'
    const [catalog, setCatalog] = useState<AssistantPluginCatalog | null>(null)
    const [projects, setProjects] = useState<AssistantProject[]>([])
    const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
    const [inspection, setInspection] = useState<AssistantPluginInspection | null>(null)
    const [packageLabel, setPackageLabel] = useState('Plugin package')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const mutationPending = useRef(false)
    const loadRevision = useRef(0)
    const download = useSyncExternalStore(pluginDownloadController.subscribe, pluginDownloadController.getSnapshot, pluginDownloadController.getSnapshot)
    const downloadPending = ['preparing', 'ready', 'installing', 'cancelling'].includes(download.phase)
    const mounted = useRef(true)
    const catalogInstallAvailable = typeof window.devscope.assistant.startPluginDownload === 'function'

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const loadCatalog = useCallback(async () => {
        if (!desktopHost) { setLoading(false); return }
        if (!serviceAvailable) {
            setError('Restart Zyra Desktop to load the Plugin service.')
            setLoading(false)
            return
        }
        const revision = ++loadRevision.current
        setLoading(true)
        setError(null)
        try {
            const [result, projectResult] = await Promise.all([
                window.devscope.assistant.getPluginCatalog(),
                window.devscope.assistant.listProjects()
            ])
            if (revision !== loadRevision.current) return
            if (!result.success) throw new Error(result.error || 'Could not load Plugins.')
            if (!projectResult.success) throw new Error(projectResult.error || 'Could not load Projects.')
            setCatalog(result.catalog)
            setProjects(projectResult.catalog.projects)
        } catch (cause) {
            if (revision === loadRevision.current) setError(cause instanceof Error ? cause.message : 'Could not load Plugins.')
        } finally {
            if (revision === loadRevision.current) setLoading(false)
        }
    }, [desktopHost, serviceAvailable])

    useEffect(() => {
        void loadCatalog()
        return () => { loadRevision.current += 1 }
    }, [loadCatalog])

    const observedInstallation = useRef(download.installationRevision)
    useEffect(() => {
        if (observedInstallation.current === download.installationRevision) return
        observedInstallation.current = download.installationRevision
        void loadCatalog()
    }, [download.installationRevision, loadCatalog])

    const mutate = useCallback(async (action: () => Promise<void>) => {
        if (mutationPending.current || !desktopHost || !serviceAvailable) return
        mutationPending.current = true
        loadRevision.current += 1
        setLoading(false)
        setBusy(true)
        setError(null)
        setNotice(null)
        try { await action() } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not update Plugins.')
        } finally {
            mutationPending.current = false
            setBusy(false)
        }
    }, [desktopHost, serviceAvailable])

    const beginInstall = useCallback(() => mutate(async () => {
        if (downloadPending) return
        const selected = await window.devscope.selectFolder()
        if (!selected.success) throw new Error(selected.error || 'Could not choose a Plugin folder.')
        if (selected.cancelled || !selected.folderPath) return
        const result = await window.devscope.assistant.inspectLocalPlugin({ packagePath: selected.folderPath })
        if (!result.success) throw new Error(result.error || 'Could not inspect that Plugin package.')
        setPackageLabel(selected.folderPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Plugin package')
        setSelectedPluginId(null)
        setInspection(result.inspection)
    }), [mutate, downloadPending])

    const cancelDownload = useCallback(async () => {
        await pluginDownloadController.cancel()
    }, [])

    const beginCatalogInstall = useCallback(async (name: string) => {
        if (mutationPending.current || inspection || !desktopHost || !serviceAvailable) return
        if (!catalogInstallAvailable) { setError('Restart Zyra Desktop to enable managed Plugin installation.'); return }
        setError(null)
        setNotice(null)
        await pluginDownloadController.start(name)
    }, [catalogInstallAvailable, desktopHost, serviceAvailable, inspection])

    const useInNewChat = useCallback((pluginId: string, onCreated: (sessionId: string) => void) => mutate(async () => {
        const plugin = catalog?.plugins.find(entry => entry.id === pluginId)
        const release = plugin && catalog ? getPluginRelease(catalog, plugin) : null
        if (!plugin || plugin.state !== 'active' || !release) throw new Error('Refresh and choose an active Plugin.')
        const result = await assistantStore.createPluginChat({ pluginId, releaseId: release.id, contentDigest: release.contentDigest })
        if (!result.success) throw new Error(result.error || 'Could not start a Plugin Chat.')
        if (mounted.current) onCreated(result.sessionId)
    }), [catalog, mutate])

    const installReviewedPlugin = useCallback((onCreated?: (id: string) => void) => mutate(async () => {
        const job = pluginDownloadController.getSnapshot()
        const managed = job.phase === 'ready'
        const reviewed = managed ? pluginDownloadController.claimReview() : inspection
        if (!reviewed) return
        let installedCatalog: AssistantPluginCatalog
        try {
            const result = await window.devscope.assistant.installInspectedPlugin({ reviewId: reviewed.reviewId, confirmed: true })
            if (!result.success) throw new Error(result.error || 'Could not install this Plugin.')
            installedCatalog = result.catalog
        } catch (cause) {
            const message = `${cause instanceof Error ? cause.message : 'Could not install this Plugin.'} Try again for a fresh review.`
            if (managed) pluginDownloadController.finishInstall(message)
            else { setInspection(null); throw Error(message) }
            return
        }
        if (managed) pluginDownloadController.finishInstall()
        if (mounted.current) { setCatalog(installedCatalog); setInspection(null); setNotice('Plugin installed.') }
        const release = !managed ? installedCatalog.releases.find(entry => entry.contentDigest === reviewed.release.contentDigest) : null
        if (release && mounted.current) setSelectedPluginId(release.pluginId)
        if (!onCreated || !managed) return
        const selection = getReviewedCatalogPluginSelection(installedCatalog, job.name, reviewed)
        if (!selection) {
            if (mounted.current) setError('Plugin installed. Enable its reviewed release before starting a new Chat.')
            return
        }
        try {
            const result = await assistantStore.createPluginChat(selection)
            if (!result.success) throw Error(result.error || 'Could not create the new Chat.')
            if (mounted.current) onCreated(result.sessionId)
        } catch (cause) {
            if (mounted.current) setError(`Plugin installed, but the new Chat could not start. ${cause instanceof Error ? cause.message : 'Use in Chat to try again.'}`)
        }
    }), [inspection, mutate])

    const updatePluginSet = useCallback((projectId: string | null, pluginId: string, enabled: boolean) => mutate(async () => {
        if (!catalog) return
        const existing = getPluginSet(catalog, projectId)
        const result = await window.devscope.assistant.setPluginSet({
            projectId,
            pluginIds: togglePluginSetId(existing?.pluginIds || [], pluginId, enabled),
            expectedRevision: existing?.revision ?? 1
        })
        if (!result.success) throw new Error(result.error || 'Could not update Plugin availability.')
        setCatalog(result.catalog)
        const owner = projectId ? projects.find((project) => project.id === projectId)?.name || 'Project' : 'new global Chats'
        setNotice(`${enabled ? 'Enabled for' : 'Removed from'} ${owner}.`)
    }), [catalog, mutate, projects])

    const updatePluginState = useCallback((pluginId: string, enabled: boolean) => mutate(async () => {
        const result = await window.devscope.assistant.setPluginState({ pluginId, state: enabled ? 'active' : 'disabled' })
        if (!result.success) throw new Error(result.error || 'Could not update this Plugin.')
        setCatalog(result.catalog)
        setNotice(enabled ? 'Plugin activated. Its availability remains unchanged.' : 'Plugin disabled and removed from new-Chat Plugin sets.')
    }), [mutate])

    const refreshCurrentChat = useCallback(() => mutate(async () => {
        if (!selectedSession) return
        const result = await window.devscope.assistant.refreshChatPluginScope({ sessionId: selectedSession.id })
        if (!result.success) throw new Error(result.error || 'Could not refresh this Chat Plugin scope.')
        const updated = await window.devscope.assistant.getPluginCatalog()
        if (!updated.success) throw new Error(updated.error || 'Chat updated, but the Plugin list could not refresh.')
        setCatalog(updated.catalog)
        const changes = [
            result.diff.added.length ? `${result.diff.added.length} added` : '',
            result.diff.changed.length ? `${result.diff.changed.length} updated` : '',
            result.diff.removed.length ? `${result.diff.removed.length} removed` : ''
        ].filter(Boolean).join(', ')
        setNotice(changes ? `Current Chat refreshed: ${changes}.` : 'Current Chat already matches its Plugin set.')
    }), [mutate, selectedSession])

    const rollbackPlugin = useCallback((pluginId: string, releaseId: string) => mutate(async () => {
        const result = await window.devscope.assistant.rollbackPlugin({ pluginId, releaseId, confirmed: true })
        if (!result.success) throw new Error(result.error || 'Could not change the active Plugin release.')
        setCatalog(result.catalog)
        setNotice('Active release changed. Existing Chats keep their recorded release.')
    }), [mutate])

    return {
        catalog, projects, loading, busy, error, notice, serviceAvailable,
        selectedPlugin: catalog?.plugins.find((plugin) => plugin.id === selectedPluginId) || null,
        selectPlugin: setSelectedPluginId,
        inspection, packageLabel, cancelInspection: () => { if (!mutationPending.current) setInspection(null) },
        download, downloadPending, cancelDownload, catalogInstallAvailable, beginCatalogInstall, useInNewChat,
        loadCatalog, beginInstall, installReviewedPlugin, updatePluginSet, updatePluginState, refreshCurrentChat, rollbackPlugin
    }
}
