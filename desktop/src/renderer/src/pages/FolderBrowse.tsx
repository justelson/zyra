/**
 * Zyra - Folder Browse Page
 * Browse folder contents with same layout as Projects main page
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { readProjectGitOverview } from '@/lib/projectGitOverview'
import { fileNameMatchesQuery, parseFileSearchQuery } from '@/lib/utils'
import { useFilePreview } from '@/components/ui/FilePreviewModal'
import { LoadingSpinner } from '@/components/ui/LoadingState'
import type { PreviewMediaSource } from '@/components/ui/file-preview/types'
import { buildMediaPreviewSources, isMediaPreviewType, resolvePreviewType } from '@/components/ui/file-preview/utils'
import { resolveExplorerHomePath, useDefaultExplorerHomePath } from '@/lib/explorerHome'
import { trackRecentProject } from '@/lib/recentProjects'
import { useSettings } from '@/lib/settings'
import { FolderBrowseContent } from './folder-browse/FolderBrowseContent'
import { FolderBrowseEmptyState } from './folder-browse/FolderBrowseEmptyState'
import { FolderBrowseHeader } from './folder-browse/FolderBrowseHeader'
import { FolderBrowseOverlays } from './folder-browse/FolderBrowseOverlays'
import { FolderBrowseToolbar } from './folder-browse/FolderBrowseToolbar'
import {
    BROWSE_ITEMS_PAGE_SIZE,
    FolderBrowseMode,
    buildBrowseRoute,
    getParentFolderPathWithinRoot,
    normalizePath,
    resolveNavigationRoot,
    yieldToBrowserPaint
} from './folder-browse/folderBrowsePageUtils'
import { type FileItem, type FolderItem, type Project } from './folder-browse/types'
import { useFolderBrowseActions } from './folder-browse/useFolderBrowseActions'
import { formatFileSize, formatRelativeTime, getFileColor, getProjectTypes } from './folder-browse/utils'
import { useProjectStatsModal } from './projects/useProjectStatsModal'
import type { IndexedInventory, IndexedProject, IndexedTotals, IndexAllFoldersResult } from './projects/projectsTypes'

type FolderBrowseProps = {
    mode?: FolderBrowseMode
}

export default function FolderBrowsePage({ mode = 'projects' }: FolderBrowseProps) {
    const { settings, updateSettings } = useSettings()
    const { folderPath } = useParams<{ folderPath: string }>()
    const navigate = useNavigate()
    const isExplorerMode = mode === 'explorer'
    const defaultExplorerHomePath = useDefaultExplorerHomePath()
    const isResolvingExplorerHomePath = isExplorerMode && !settings.explorerHomePath && defaultExplorerHomePath === null
    const surfaceTitle = isExplorerMode ? 'Explorer' : 'Projects'
    const emptyStateTitle = isExplorerMode ? 'Explorer home folder not set' : 'No Projects Folder Configured'
    const emptyStateDescription = isExplorerMode
        ? "Zyra could not resolve your home folder. Choose a custom Explorer root in settings."
        : 'Set up a projects folder in settings to browse your projects.'
    const settingsRoute = '/settings/workspace/projects'
    const settingsButtonLabel = isExplorerMode ? 'Open Explorer Settings' : 'Configure Projects Folder'
    const browseRootPath = isExplorerMode
        ? resolveExplorerHomePath(settings.explorerHomePath, defaultExplorerHomePath)
        : settings.projectsFolder

    const decodedPath = useMemo(() => {
        const pathFromRoute = folderPath ? decodeURIComponent(folderPath) : ''
        if (pathFromRoute.trim()) return pathFromRoute
        return String(browseRootPath || '').trim()
    }, [browseRootPath, folderPath])
    const folderName = decodedPath.split(/[/\\]/).pop() || 'Folder'
    const configuredBrowseRoots = useMemo(() => (
        isExplorerMode
            ? []
            : Array.from(new Set([
                settings.projectsFolder,
                ...(settings.additionalFolders || [])
            ].filter((path): path is string => typeof path === 'string' && path.trim().length > 0)))
    ), [isExplorerMode, settings.additionalFolders, settings.projectsFolder])
    const navigationRoot = useMemo(
        () => resolveNavigationRoot(decodedPath, configuredBrowseRoots),
        [decodedPath, configuredBrowseRoots]
    )
    const canNavigateUp = useMemo(
        () => Boolean(getParentFolderPathWithinRoot(decodedPath, navigationRoot)),
        [decodedPath, navigationRoot]
    )

    const [projects, setProjects] = useState<Project[]>([])
    const [folders, setFolders] = useState<FolderItem[]>([])
    const [files, setFiles] = useState<FileItem[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const deferredSearchQuery = useDeferredValue(searchQuery)
    const [indexedSearchEntries, setIndexedSearchEntries] = useState<Array<{
        path: string
        name: string
        type: 'file' | 'directory'
        extension: string
        size?: number
        lastModified?: number
        isProject: boolean
        projectType?: string | null
        projectIconPath?: string | null
        markers: string[]
        frameworks: string[]
    }> | null>(null)
    const [filterType, setFilterType] = useState('all')
    const [isCurrentFolderGitRepo, setIsCurrentFolderGitRepo] = useState(false)
    const [visibleItemCount, setVisibleItemCount] = useState(BROWSE_ITEMS_PAGE_SIZE)
    const [indexedTotals, setIndexedTotals] = useState<IndexedTotals | null>(null)
    const [indexedInventory, setIndexedInventory] = useState<IndexedInventory | null>(null)
    const indexTotalsRunRef = useRef(0)
    const loadContentsRequestRef = useRef(0)
    const gitOverviewRequestRef = useRef(0)
    const {
        previewFile,
        previewMediaItems,
        previewContent,
        loadingPreview,
        previewTruncated,
        previewSize,
        previewBytes,
        previewModifiedAt,
        openPreview,
        closePreview
    } = useFilePreview()

    const loadContents = useCallback(async (forceRefresh: boolean = false) => {
        if (!decodedPath) return

        const requestId = ++loadContentsRequestRef.current
        const isStaleRequest = () => requestId !== loadContentsRequestRef.current
        setLoading(true)
        setError(null)
        await yieldToBrowserPaint()

        try {
            const result = await window.devscope.scanProjects(decodedPath, { forceRefresh })
            if (isStaleRequest()) return
            if (!result.success) {
                setError(result.error || 'Failed to scan folder')
                return
            }

            setProjects(result.projects || [])
            setFolders(result.folders || [])
            setFiles(result.files || [])
        } catch (scanError: any) {
            if (!isStaleRequest()) {
                setError(scanError.message || 'Failed to scan folder')
            }
        } finally {
            if (!isStaleRequest()) {
                setLoading(false)
            }
        }
    }, [decodedPath])

    useEffect(() => {
        const checkGitRepo = async () => {
            if (!decodedPath) return
            const requestId = ++gitOverviewRequestRef.current
            setIsCurrentFolderGitRepo(false)
            try {
                const overview = await readProjectGitOverview(decodedPath)
                if (requestId !== gitOverviewRequestRef.current) return
                const isRepo = overview?.isGitRepo === true
                setIsCurrentFolderGitRepo(isRepo)
                if (isRepo) {
                    trackRecentProject(decodedPath, 'folder')
                }
            } catch {
                if (requestId === gitOverviewRequestRef.current) {
                    setIsCurrentFolderGitRepo(false)
                }
            }
        }

        void checkGitRepo()
    }, [decodedPath])

    useEffect(() => {
        void loadContents(false)
    }, [loadContents])

    const parsedSearchQuery = useMemo(
        () => parseFileSearchQuery(deferredSearchQuery),
        [deferredSearchQuery]
    )
    const hasIndexedFolderSearch = deferredSearchQuery.trim().length > 0

    useEffect(() => {
        if (!decodedPath || !hasIndexedFolderSearch) {
            setIndexedSearchEntries(null)
            return
        }

        let cancelled = false
        void window.devscope.searchIndexedPaths({
            scopePath: decodedPath,
            term: parsedSearchQuery.term,
            extensionFilters: parsedSearchQuery.extension ? [parsedSearchQuery.extension] : [],
            limit: 320,
            includeFiles: true,
            includeDirectories: true,
            includeAncestors: false,
            showHidden: false
        }).then((result) => {
            if (cancelled) return
            if (!result?.success) {
                setIndexedSearchEntries([])
                return
            }
            setIndexedSearchEntries((result.entries || []).map((entry) => ({
                path: entry.path,
                name: entry.name,
                type: entry.type,
                extension: entry.extension,
                size: entry.size,
                lastModified: entry.lastModified,
                isProject: entry.isProject,
                projectType: entry.projectType,
                projectIconPath: entry.projectIconPath,
                markers: entry.markers || [],
                frameworks: entry.frameworks || []
            })))
        }).catch(() => {
            if (!cancelled) {
                setIndexedSearchEntries([])
            }
        })

        return () => {
            cancelled = true
        }
    }, [decodedPath, hasIndexedFolderSearch, parsedSearchQuery.extension, parsedSearchQuery.term])

    const isProjectsRootView = useMemo(() => {
        if (isExplorerMode) return false
        const normalizedCurrent = normalizePath(decodedPath)
        const normalizedProjectsRoot = normalizePath(settings.projectsFolder || '')
        return Boolean(normalizedCurrent && normalizedProjectsRoot && normalizedCurrent === normalizedProjectsRoot)
    }, [decodedPath, isExplorerMode, settings.projectsFolder])
    const statsScanKey = useMemo(() => normalizePath(decodedPath).toLowerCase(), [decodedPath])
    const statsModalController = useProjectStatsModal(projects, indexedTotals, indexedInventory, statsScanKey)
    const rootStats = useMemo(() => ({
        projects: statsModalController.totalProjects,
        frameworks: statsModalController.frameworkCount,
        types: statsModalController.typeCount
    }), [statsModalController.frameworkCount, statsModalController.totalProjects, statsModalController.typeCount])
    const indexedProjectsSource = useMemo<Project[]>(() => projects, [projects])
    const indexedSearchProjects = useMemo<Project[]>(() => {
        if (!hasIndexedFolderSearch || !indexedSearchEntries) return []
        return indexedSearchEntries
            .filter((entry) => entry.type === 'directory' && entry.isProject)
            .map((entry) => ({
                name: entry.name,
                path: entry.path,
                type: entry.projectType || 'unknown',
                projectIconPath: entry.projectIconPath ?? null,
                markers: entry.markers,
                frameworks: entry.frameworks,
                lastModified: entry.lastModified,
                isProject: true
            }))
    }, [hasIndexedFolderSearch, indexedSearchEntries])
    const indexedSearchFolders = useMemo<FolderItem[]>(() => {
        if (!hasIndexedFolderSearch || !indexedSearchEntries) return []
        return indexedSearchEntries
            .filter((entry) => entry.type === 'directory' && !entry.isProject)
            .map((entry) => ({
                name: entry.name,
                path: entry.path,
                lastModified: entry.lastModified,
                isProject: false
            }))
    }, [hasIndexedFolderSearch, indexedSearchEntries])
    const indexedSearchFiles = useMemo<FileItem[]>(() => {
        if (!hasIndexedFolderSearch || !indexedSearchEntries) return []
        return indexedSearchEntries
            .filter((entry) => entry.type === 'file')
            .map((entry) => ({
                name: entry.name,
                path: entry.path,
                size: entry.size || 0,
                lastModified: entry.lastModified,
                extension: entry.extension
            }))
    }, [hasIndexedFolderSearch, indexedSearchEntries])
    const projectTypes = useMemo(
        () => getProjectTypes(hasIndexedFolderSearch ? indexedSearchProjects : indexedProjectsSource),
        [hasIndexedFolderSearch, indexedProjectsSource, indexedSearchProjects]
    )

    useEffect(() => {
        if (!decodedPath || !isProjectsRootView) {
            setIndexedTotals(null)
            setIndexedInventory(null)
            return
        }

        const currentRunId = ++indexTotalsRunRef.current
        const foldersForTotals = configuredBrowseRoots.length > 0 ? configuredBrowseRoots : [decodedPath]
        void (async () => {
            try {
                const indexResult = await window.devscope.indexAllFolders(foldersForTotals) as IndexAllFoldersResult
                if (currentRunId !== indexTotalsRunRef.current) return
                if (!indexResult?.success || !Array.isArray(indexResult.projects)) {
                    setIndexedTotals(null)
                    setIndexedInventory(null)
                    return
                }

                const deduped = new Map<string, IndexedProject>()
                const frameworkSet = new Set<string>()
                const typeSet = new Set<string>()

                for (const project of indexResult.projects) {
                    const pathKey = String(project.path || '').toLowerCase()
                    if (pathKey && !deduped.has(pathKey)) {
                        deduped.set(pathKey, project)
                    }
                    for (const framework of project.frameworks || []) {
                        if (framework) frameworkSet.add(framework)
                    }
                    if (project.type && project.type !== 'unknown' && project.type !== 'git') {
                        typeSet.add(project.type)
                    }
                }

                setIndexedTotals({
                    scanKey: statsScanKey,
                    projects: deduped.size,
                    frameworks: frameworkSet.size,
                    types: typeSet.size,
                    folders: typeof indexResult.indexedFolders === 'number' ? indexResult.indexedFolders : 1
                })

                setIndexedInventory({
                    scanKey: statsScanKey,
                    projects: Array.from(deduped.values()),
                    folderPaths: Array.isArray(indexResult.scannedFolderPaths) ? indexResult.scannedFolderPaths : []
                })
            } catch {
                if (currentRunId !== indexTotalsRunRef.current) return
                setIndexedTotals(null)
                setIndexedInventory(null)
            }
        })()
    }, [configuredBrowseRoots, decodedPath, isProjectsRootView, projects, statsScanKey])

    const filteredProjects = useMemo(() => {
        const sourceProjects = hasIndexedFolderSearch ? indexedSearchProjects : indexedProjectsSource
        if (parsedSearchQuery.hasExtensionFilter && !hasIndexedFolderSearch) return []

        return sourceProjects.filter((project) => {
            if (project.type === 'git') return false
            const matchesSearch = hasIndexedFolderSearch
                ? true
                : (!parsedSearchQuery.term || project.name.toLowerCase().includes(parsedSearchQuery.term))
            const matchesType = filterType === 'all' || project.type === filterType
            return matchesSearch && matchesType
        })
    }, [filterType, hasIndexedFolderSearch, indexedProjectsSource, indexedSearchProjects, parsedSearchQuery])

    const filteredFolders = useMemo(() => {
        const sourceFolders = hasIndexedFolderSearch ? indexedSearchFolders : folders
        return [...sourceFolders].sort((left, right) => left.name.localeCompare(right.name))
    }, [folders, hasIndexedFolderSearch, indexedSearchFolders])

    const gitRepos = useMemo(() => {
        const sourceProjects = hasIndexedFolderSearch ? indexedSearchProjects : indexedProjectsSource
        return sourceProjects.filter((project) => project.type === 'git')
    }, [hasIndexedFolderSearch, indexedProjectsSource, indexedSearchProjects])

    const filteredFiles = useMemo(() => {
        const sourceFiles = hasIndexedFolderSearch ? indexedSearchFiles : files
        const matchingFiles = !deferredSearchQuery || hasIndexedFolderSearch
            ? sourceFiles
            : sourceFiles.filter((file) => fileNameMatchesQuery(file.name, parsedSearchQuery))

        const mediaSources = buildMediaPreviewSources(matchingFiles.map((file) => ({
            name: file.name,
            path: file.path,
            extension: file.extension
        })))
        const mediaByPath = new Map(mediaSources.map((item) => [item.path.toLowerCase(), item]))
        const albumArtPaths = new Set(
            mediaSources
                .filter((item) => item.type !== 'image' && item.thumbnailPath)
                .map((item) => String(item.thumbnailPath || '').toLowerCase())
                .filter(Boolean)
        )

        return matchingFiles
            .filter((file) => !(file.extension && albumArtPaths.has(file.path.toLowerCase())))
            .map((file) => {
                const mediaItem = mediaByPath.get(file.path.toLowerCase())
                if (mediaItem) {
                    return {
                        ...file,
                        previewType: mediaItem.type,
                        previewThumbnailPath: mediaItem.thumbnailPath ?? null,
                        isAlbumArt: false
                    }
                }

                const previewTarget = resolvePreviewType(file.name, file.extension)
                if (previewTarget && isMediaPreviewType(previewTarget.type)) {
                    return {
                        ...file,
                        previewType: previewTarget.type,
                        previewThumbnailPath: previewTarget.type === 'image' ? file.path : null,
                        isAlbumArt: false
                    }
                }

                return file
            })
    }, [deferredSearchQuery, files, hasIndexedFolderSearch, indexedSearchFiles, parsedSearchQuery])

    useEffect(() => {
        setVisibleItemCount(BROWSE_ITEMS_PAGE_SIZE)
    }, [decodedPath, deferredSearchQuery, files.length, filterType, folders.length, projects.length])

    const displayedFolders = useMemo(
        () => filteredFolders.slice(0, visibleItemCount),
        [filteredFolders, visibleItemCount]
    )
    const displayedGitRepos = useMemo(
        () => gitRepos.slice(0, visibleItemCount),
        [gitRepos, visibleItemCount]
    )
    const displayedProjects = useMemo(
        () => filteredProjects.slice(0, visibleItemCount),
        [filteredProjects, visibleItemCount]
    )
    const displayedFiles = useMemo(
        () => filteredFiles.slice(0, visibleItemCount),
        [filteredFiles, visibleItemCount]
    )
    const hasMoreItems = (
        displayedFolders.length < filteredFolders.length
        || displayedGitRepos.length < gitRepos.length
        || displayedProjects.length < filteredProjects.length
        || displayedFiles.length < filteredFiles.length
    )
    const mediaPreviewSources = useMemo<PreviewMediaSource[]>(() => buildMediaPreviewSources(displayedFiles.map((file) => ({
        name: file.name,
        path: file.path,
        extension: file.extension
    }))), [displayedFiles])
    const loadMoreItems = useCallback(() => {
        setVisibleItemCount((current) => current + BROWSE_ITEMS_PAGE_SIZE)
    }, [])

    const actions = useFolderBrowseActions({
        mode,
        decodedPath,
        navigationRoot,
        navigate,
        updateSettings,
        loadContents,
        openPreview,
        setError
    })
    const handleNavigateToPath = useCallback((path: string) => {
        navigate(buildBrowseRoute(mode, path))
    }, [mode, navigate])

    if (!decodedPath) {
        return (
            <FolderBrowseEmptyState
                emptyStateDescription={emptyStateDescription}
                emptyStateTitle={emptyStateTitle}
                isExplorerMode={isExplorerMode}
                isResolvingExplorerHomePath={isResolvingExplorerHomePath}
                onSelectExplorerHome={() => { void actions.handleSelectExplorerHome() }}
                settingsButtonLabel={settingsButtonLabel}
                settingsRoute={settingsRoute}
                surfaceTitle={surfaceTitle}
            />
        )
    }

    return (
        <div className="project-surface-scrollbar mx-auto min-w-0 max-w-[1600px] animate-fadeIn [overflow-x:clip] pb-20 transition-[max-width,padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]">
            <FolderBrowseHeader
                folderName={folderName}
                decodedPath={decodedPath}
                displayRootPath={navigationRoot ?? browseRootPath}
                totalProjects={projects.length}
                isProjectsRootView={isProjectsRootView}
                rootStats={rootStats}
                isCurrentFolderGitRepo={isCurrentFolderGitRepo}
                loading={loading}
                onBack={actions.handleBack}
                onNavigateUp={actions.handleNavigateUp}
                canNavigateUp={canNavigateUp}
                onNavigateToPath={handleNavigateToPath}
                onViewAsProject={actions.handleViewAsProject}
                preferredShell={settings.defaultShell}
                onCopyPath={actions.handleCopyPath}
                copiedPath={actions.copiedPath}
                onOpenStats={(key) => statsModalController.setStatsModal(key)}
                onOpenProjectsSettings={isExplorerMode ? undefined : () => navigate('/settings/workspace/projects')}
                onRefresh={() => { void loadContents(true) }}
                onCreateFile={(presetExtension) => actions.handleCreateInCurrentFolder('file', presetExtension)}
                onCreateFolder={() => actions.handleCreateInCurrentFolder('directory')}
                onCloneRepository={actions.openCloneRepoModal}
            />

            <FolderBrowseToolbar
                isCondensedLayout={false}
                searchQuery={searchQuery}
                filterType={filterType}
                projectTypes={projectTypes}
                viewMode={settings.browserViewMode}
                contentLayout={settings.browserContentLayout}
                onSearchQueryChange={setSearchQuery}
                onFilterTypeChange={setFilterType}
                onViewModeChange={(value) => updateSettings({ browserViewMode: value })}
                onContentLayoutChange={(value) => updateSettings({ browserContentLayout: value })}
            />

            {error && (
                <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                    <AlertCircle size={20} className="text-red-400" />
                    <span className="text-red-300">{error}</span>
                </div>
            )}

            {loading && (
                <LoadingSpinner
                    message="Loading"
                    minHeightClassName="min-h-[28vh]"
                />
            )}

            {!loading && (
                <FolderBrowseContent
                    currentDirectoryPath={decodedPath}
                    currentDirectoryName={folderName}
                    filteredFolders={displayedFolders}
                    totalFilteredFolders={filteredFolders.length}
                    gitRepos={displayedGitRepos}
                    totalGitRepos={gitRepos.length}
                    visibleFiles={displayedFiles}
                    totalFilteredFiles={filteredFiles.length}
                    hasMoreItems={hasMoreItems}
                    onLoadMoreItems={loadMoreItems}
                    displayedProjects={displayedProjects}
                    totalDisplayedProjects={filteredProjects.length}
                    viewMode={settings.browserViewMode}
                    contentLayout={settings.browserContentLayout}
                    isCondensedLayout={false}
                    searchQuery={searchQuery}
                    error={error}
                    onFolderClick={actions.handleFolderClick}
                    onProjectClick={actions.handleProjectClick}
                    onProjectRename={actions.handleProjectRename}
                    onProjectDelete={actions.handleProjectDelete}
                    onOpenFilePreview={(file) => openPreview(file, file.extension, { mediaItems: mediaPreviewSources })}
                    onOpenProjectInExplorer={(path) => window.devscope.openInExplorer?.(path)}
                    onEntryOpen={actions.handleEntryOpen}
                    onEntryOpenWith={actions.handleEntryOpenWith}
                    onEntryOpenInExplorer={actions.handleEntryOpenInExplorer}
                    onEntryCopyPath={actions.handleEntryCopyPath}
                    onEntryCopy={actions.handleEntryCopy}
                    onEntryRename={actions.handleEntryRename}
                    onEntryDelete={actions.handleEntryDelete}
                    onEntryPaste={actions.handleEntryPaste}
                    onEntryCreateFile={actions.handleEntryCreateFile}
                    onEntryCreateFolder={actions.handleEntryCreateFolder}
                    onRefresh={() => { void loadContents(true) }}
                    hasFileClipboardItem={Boolean(actions.fileClipboardItem)}
                    formatFileSize={formatFileSize}
                    getFileColor={getFileColor}
                    formatRelativeTime={formatRelativeTime}
                />
            )}

            <FolderBrowseOverlays
                closePreview={closePreview}
                cloneRepoErrorMessage={actions.cloneRepoErrorMessage}
                cloneRepoModalOpen={actions.cloneRepoModalOpen}
                cloneRepoUrl={actions.cloneRepoUrl}
                confirmDeleteTarget={actions.confirmDeleteTarget}
                createDraft={actions.createDraft}
                createErrorMessage={actions.createErrorMessage}
                createTarget={actions.createTarget}
                deleteTarget={actions.deleteTarget}
                decodedPath={decodedPath}
                handleProjectClick={actions.handleProjectClick}
                handleProjectDelete={actions.handleProjectDelete}
                handleProjectRename={actions.handleProjectRename}
                loadingPreview={loadingPreview}
                onPreviewSaved={async () => { await loadContents(true) }}
                openPreview={openPreview}
                previewBytes={previewBytes}
                previewContent={previewContent}
                previewFile={previewFile}
                previewMediaItems={previewMediaItems}
                previewModifiedAt={previewModifiedAt}
                previewSize={previewSize}
                previewTruncated={previewTruncated}
                renameDraft={actions.renameDraft}
                renameErrorMessage={actions.renameErrorMessage}
                renameExtensionSuffix={actions.renameExtensionSuffix}
                renameTarget={actions.renameTarget}
                setCreateDraft={actions.setCreateDraft}
                setCreateErrorMessage={actions.setCreateErrorMessage}
                setCreateTarget={actions.setCreateTarget}
                setCloneRepoErrorMessage={actions.setCloneRepoErrorMessage}
                setCloneRepoModalOpen={actions.setCloneRepoModalOpen}
                setCloneRepoUrl={actions.setCloneRepoUrl}
                setDeleteTarget={actions.setDeleteTarget}
                setRenameDraft={actions.setRenameDraft}
                setRenameErrorMessage={actions.setRenameErrorMessage}
                setRenameExtensionSuffix={actions.setRenameExtensionSuffix}
                setRenameTarget={actions.setRenameTarget}
                statsModalController={statsModalController}
                submitCloneRepo={actions.submitCloneRepo}
                submitCreateTarget={actions.submitCreateTarget}
                submitRenameTarget={actions.submitRenameTarget}
                onShowToast={(message, tone) => actions.showToast(message, tone === 'error' ? 'error' : 'success')}
                toast={actions.toast}
            />
        </div>
    )
}
