import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantPluginCatalog, AssistantPluginInspection, AssistantProject, AssistantSession } from '@shared/assistant/contracts'
import { getPluginRelease, getPluginSet, togglePluginSetId } from './plugin-directory-state'
import { assistantStore } from '@/lib/assistant/store'

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
    const downloadRevision = useRef(0)
    const downloadId = useRef<string | null>(null)
    const [downloadName, setDownloadName] = useState<string | null>(null)
    const mounted = useRef(true)
    const catalogInstallAvailable = typeof window.devscope.assistant.startPluginDownload === 'function'

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            downloadRevision.current += 1
            if (downloadId.current) void window.devscope.assistant.cancelPluginDownload({ id: downloadId.current }).catch(() => undefined)
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
        const selected = await window.devscope.selectFolder()
        if (!selected.success) throw new Error(selected.error || 'Could not choose a Plugin folder.')
        if (selected.cancelled || !selected.folderPath) return
        const result = await window.devscope.assistant.inspectLocalPlugin({ packagePath: selected.folderPath })
        if (!result.success) throw new Error(result.error || 'Could not inspect that Plugin package.')
        setPackageLabel(selected.folderPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Plugin package')
        setSelectedPluginId(null)
        setInspection(result.inspection)
    }), [mutate])

    const cancelDownload = useCallback(async () => {
        downloadRevision.current += 1
        const id = downloadId.current
        downloadId.current = null
        setDownloadName(null)
        setInspection(null)
        if (id) {
            try {
                const result = await window.devscope.assistant.cancelPluginDownload({ id })
                if (!result.success && mounted.current) setError(result.error || 'Could not cancel this download.')
            } catch { if (mounted.current) setError('Could not cancel this download. It will expire automatically.') }
        }
    }, [])

    const beginCatalogInstall = useCallback((name: string) => mutate(async () => {
        if (!catalogInstallAvailable) throw new Error('Restart Zyra Desktop to enable managed Plugin installation.')
        const revision = ++downloadRevision.current
        setDownloadName(name)
        setSelectedPluginId(null)
        let id: string | null = null
        let ready = false
        try {
            const started = await window.devscope.assistant.startPluginDownload({ name })
            if (!started.success) throw new Error(started.error || 'Could not start this download.')
            id = started.download.id
            if (revision !== downloadRevision.current) return
            downloadId.current = id
            const deadline = Date.now() + 150_000
            while (revision === downloadRevision.current && Date.now() < deadline) {
                const result = await window.devscope.assistant.getPluginDownload({ id })
                if (revision !== downloadRevision.current) return
                if (!result.success) throw new Error(result.error || 'Could not check this download.')
                if (result.download.status === 'failed') throw new Error(result.download.error || 'Plugin download failed.')
                if (result.download.status === 'ready') {
                    if (!result.download.inspection) throw new Error('Plugin review is missing. Try again.')
                    ready = true
                    setPackageLabel('OpenAI catalog')
                    setInspection(result.download.inspection)
                    return
                }
                await new Promise(resolve => setTimeout(resolve, 250))
            }
            if (revision === downloadRevision.current) throw new Error('Plugin download timed out. Try again.')
        } catch (error) {
            if (revision === downloadRevision.current) throw error
        } finally {
            if (!ready && id) {
                await window.devscope.assistant.cancelPluginDownload({ id }).catch(() => undefined)
                if (downloadId.current === id) downloadId.current = null
            }
            if (mounted.current) setDownloadName(null)
        }
    }), [catalogInstallAvailable, mutate])

    const useInNewChat = useCallback((pluginId: string, onCreated: (sessionId: string) => void) => mutate(async () => {
        const plugin = catalog?.plugins.find(entry => entry.id === pluginId)
        const release = plugin && catalog ? getPluginRelease(catalog, plugin) : null
        if (!plugin || plugin.state !== 'active' || !release) throw new Error('Refresh and choose an active Plugin.')
        const result = await assistantStore.createPluginChat({ pluginId, releaseId: release.id, contentDigest: release.contentDigest })
        if (!result.success) throw new Error(result.error || 'Could not start a Plugin Chat.')
        if (mounted.current) onCreated(result.sessionId)
    }), [catalog, mutate])

    const installReviewedPlugin = useCallback(() => mutate(async () => {
        if (!inspection) return
        const managedId = downloadId.current
        downloadId.current = null
        try {
            const result = await window.devscope.assistant.installInspectedPlugin({ reviewId: inspection.reviewId, confirmed: true })
            if (!result.success) throw new Error(result.error || 'Could not install this Plugin.')
            setCatalog(result.catalog)
            const release = result.catalog.releases.find((entry) => entry.contentDigest === inspection.release.contentDigest)
            if (release && !managedId) setSelectedPluginId(release.pluginId)
            setNotice('Plugin installed.')
        } catch (cause) {
            throw new Error(`${cause instanceof Error ? cause.message : 'Could not install this Plugin.'} Try again for a fresh review.`)
        } finally {
            if (managedId) await window.devscope.assistant.cancelPluginDownload({ id: managedId }).catch(() => undefined)
            setInspection(null)
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
        inspection, packageLabel, cancelInspection: () => { if (!mutationPending.current) { if (downloadId.current) void cancelDownload(); else setInspection(null) } },
        downloadName, cancelDownload, catalogInstallAvailable, beginCatalogInstall, useInNewChat,
        loadCatalog, beginInstall, installReviewedPlugin, updatePluginSet, updatePluginState, refreshCurrentChat, rollbackPlugin
    }
}
