import { useEffect, useMemo, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import { GitTextGenerationSettings } from './GitTextGenerationSettings'
import {
    SettingsButton,
    SettingsDialog,
    SettingsInput,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSelect,
    SettingsSwitch,
    SettingsTextarea
} from './settings-layout'
import { SettingsPageTabs } from './SettingsPageTabs'
import { SettingsInfoTooltip } from './SettingsInfoTooltip'
import { SensitiveSettingValue } from './SensitiveSettingValue'

type GlobalGitAuthor = { name: string; email: string }
const GLOBAL_GIT_AUTHOR_TTL_MS = 2 * 60_000
let cachedGlobalGitAuthor: GlobalGitAuthor | null = null
let cachedGlobalGitAuthorAt = 0
let globalGitAuthorGeneration = 0

registerSettingsCacheClearer('settings-git-author', () => {
    globalGitAuthorGeneration += 1
    cachedGlobalGitAuthor = null
    cachedGlobalGitAuthorAt = 0
})

export default function GitSettings({ view = 'git' }: { view?: 'git' | 'pull-requests' | 'writing' }) {
    const { settings, updateSettings } = useSettings()
    const [globalAuthorDraft, setGlobalAuthorDraft] = useState<GlobalGitAuthor>(() => cachedGlobalGitAuthor || { name: '', email: '' })
    const [savedGlobalAuthor, setSavedGlobalAuthor] = useState<GlobalGitAuthor>(() => cachedGlobalGitAuthor || { name: '', email: '' })
    const [globalAuthorMessage, setGlobalAuthorMessage] = useState('')
    const [globalAuthorLoading, setGlobalAuthorLoading] = useState(false)
    const [editDialog, setEditDialog] = useState<'target-branch' | 'global-guide' | 'initial-branch' | 'identity' | null>(null)
    const [editValue, setEditValue] = useState('')

    useEffect(() => {
        if (view !== 'git') return
        let cancelled = false
        const generation = globalGitAuthorGeneration
        if (cachedGlobalGitAuthor && Date.now() - cachedGlobalGitAuthorAt < GLOBAL_GIT_AUTHOR_TTL_MS) return
        setGlobalAuthorLoading(true)
        void window.devscope.getGlobalGitUser().then((result) => {
            if (cancelled) return
            const nextAuthor = result?.success && result.user ? { name: String(result.user.name || ''), email: String(result.user.email || '') } : { name: '', email: '' }
            if (result?.success && generation === globalGitAuthorGeneration) {
                cachedGlobalGitAuthor = nextAuthor
                cachedGlobalGitAuthorAt = Date.now()
            }
            setGlobalAuthorDraft(nextAuthor)
            setSavedGlobalAuthor(nextAuthor)
            setGlobalAuthorMessage(result?.success ? '' : result?.error || 'Could not read the global Git author.')
        }).catch((error) => {
            if (!cancelled) setGlobalAuthorMessage(error instanceof Error ? error.message : 'Could not read the global Git author.')
        }).finally(() => {
            if (!cancelled) setGlobalAuthorLoading(false)
        })
        return () => { cancelled = true }
    }, [view])

    const globalAuthorDirty = useMemo(() => globalAuthorDraft.name.trim() !== savedGlobalAuthor.name.trim() || globalAuthorDraft.email.trim() !== savedGlobalAuthor.email.trim(), [globalAuthorDraft, savedGlobalAuthor])

    const saveGlobalAuthor = async () => {
        const name = globalAuthorDraft.name.trim()
        const email = globalAuthorDraft.email.trim()
        if (!name || !email) {
            setGlobalAuthorMessage('Name and email are both required.')
            return
        }
        setGlobalAuthorLoading(true)
        try {
            const result = await window.devscope.setGlobalGitUser({ name, email })
            if (!result?.success) throw new Error(result?.error || 'Could not save the global Git author.')
            cachedGlobalGitAuthor = { name, email }
            cachedGlobalGitAuthorAt = Date.now()
            setSavedGlobalAuthor({ name, email })
            setGlobalAuthorMessage('Global Git author updated.')
            setEditDialog(null)
        } catch (error) {
            setGlobalAuthorMessage(error instanceof Error ? error.message : 'Could not save the global Git author.')
        } finally {
            setGlobalAuthorLoading(false)
        }
    }

    const openTextEditor = (dialog: Exclude<typeof editDialog, 'identity' | null>, value: string) => {
        setEditValue(value)
        setEditDialog(dialog)
    }

    const closeEditor = () => {
        if (editDialog === 'identity') setGlobalAuthorDraft(savedGlobalAuthor)
        setEditDialog(null)
    }

    const saveTextEditor = () => {
        if (editDialog === 'target-branch') updateSettings({ gitPullRequestDefaultTargetBranch: editValue.trim() || 'main' })
        if (editDialog === 'initial-branch') updateSettings({ gitInitDefaultBranch: editValue.trim() || 'main' })
        if (editDialog === 'global-guide') updateSettings({ gitPullRequestGlobalGuide: { ...settings.gitPullRequestGlobalGuide, text: editValue } })
        setEditDialog(null)
    }

    const chooseGlobalGuideFile = async () => {
        const result = await window.devscope.selectMarkdownFile()
        if (!result?.success || result.cancelled || !result.filePath) return
        updateSettings({ gitPullRequestGlobalGuide: { ...settings.gitPullRequestGlobalGuide, mode: 'file', filePath: result.filePath } })
    }

    return (
        <SettingsPageContainer
            title="Source control"
            description="Set Git workflow defaults, pull-request behavior, and AI writing."
            navigation={<SettingsPageTabs family="git" />}
            backTo="/settings/workspace/source-control"
            backLabel="Source control"
        >
            {view === 'writing' ? <GitTextGenerationSettings /> : view === 'pull-requests' ? (
                <>
            <SettingsSection title="Pull requests">
                <SettingsRow title="Default guide source" description="Instructions used unless the active project stores its own PR settings." control={<SettingsSelect value={settings.gitPullRequestDefaultGuideSource} onChange={(event) => updateSettings({ gitPullRequestDefaultGuideSource: event.target.value as typeof settings.gitPullRequestDefaultGuideSource })} aria-label="Default PR guide source"><option value="global">Global guide</option><option value="repo-template">Repository template</option><option value="none">None</option></SettingsSelect>} />
                <SettingsRow title="Default target branch" description="Base branch proposed by the pull-request flow." status={settings.gitPullRequestDefaultTargetBranch} control={<SettingsButton onClick={() => openTextEditor('target-branch', settings.gitPullRequestDefaultTargetBranch)}>Edit</SettingsButton>} />
                <SettingsRow title="Default change source" description="Choose which local changes are proposed when a new pull-request flow starts." control={<SettingsSelect value={settings.gitPullRequestDefaultChangeSource} onChange={(event) => updateSettings({ gitPullRequestDefaultChangeSource: event.target.value as typeof settings.gitPullRequestDefaultChangeSource })} aria-label="Default pull-request change source"><option value="unstaged">Unstaged changes</option><option value="staged">Staged changes</option><option value="local-commits">Local commits</option><option value="all-local-work">All local work</option></SettingsSelect>} />
                <SettingsRow title="Draft by default" description="Create new pull requests as drafts unless the project overrides this setting." control={<SettingsSwitch checked={settings.gitPullRequestDefaultDraft} onCheckedChange={(gitPullRequestDefaultDraft) => updateSettings({ gitPullRequestDefaultDraft })} label="Create draft pull requests by default" />} />
                {settings.gitPullRequestDefaultGuideSource === 'global' ? (<>
                <SettingsRow title="Global guide mode" description="Write the fallback guide here or load it from a markdown file." control={<SettingsSegmented value={settings.gitPullRequestGlobalGuide.mode} options={[{ value: 'text', label: 'Text' }, { value: 'file', label: 'Markdown file' }]} onChange={(mode) => updateSettings({ gitPullRequestGlobalGuide: { ...settings.gitPullRequestGlobalGuide, mode } })} label="Global pull-request guide mode" />} />
                {settings.gitPullRequestGlobalGuide.mode === 'text' ? (<SettingsRow title="Global guide" description="Fallback structure, checklist, and tone for generated pull-request bodies." status={settings.gitPullRequestGlobalGuide.text.trim() ? 'Custom guide saved' : 'No guide written'} statusTone={settings.gitPullRequestGlobalGuide.text.trim() ? 'ready' : 'muted'} control={<SettingsButton disabled={settings.gitPullRequestGlobalGuide.mode !== 'text'} onClick={() => openTextEditor('global-guide', settings.gitPullRequestGlobalGuide.text)}>Edit guide</SettingsButton>} />
                ) : (<SettingsRow title="Guide file" description="Markdown file used as the global pull-request guide." status={settings.gitPullRequestGlobalGuide.filePath || 'No file selected'} statusTone={settings.gitPullRequestGlobalGuide.filePath ? 'muted' : 'warning'} control={<div className="flex gap-1"><SettingsButton disabled={settings.gitPullRequestGlobalGuide.mode !== 'file'} onClick={() => void chooseGlobalGuideFile()}><FolderOpen size={13} />Choose .md</SettingsButton><SettingsButton variant="ghost" disabled={settings.gitPullRequestGlobalGuide.mode !== 'file' || !settings.gitPullRequestGlobalGuide.filePath} onClick={() => updateSettings({ gitPullRequestGlobalGuide: { ...settings.gitPullRequestGlobalGuide, filePath: '' } })}>Clear</SettingsButton></div>} />)}
                </>) : null}
            </SettingsSection>
                </>
            ) : (
                <>
            <SettingsSection title="Workflow" titleAction={<SettingsInfoTooltip label="About PR workflow">The PR action pushes when needed, reuses an existing open PR, and otherwise creates one through an authenticated GitHub CLI (`gh`) session.</SettingsInfoTooltip>}>
                <SettingsRow title="Auto-refresh on project open" description="Refresh status, history, remotes, and branches when a project opens." control={<SettingsSwitch checked={settings.gitAutoRefreshOnProjectOpen} onCheckedChange={(gitAutoRefreshOnProjectOpen) => updateSettings({ gitAutoRefreshOnProjectOpen })} label="Auto-refresh Git on project open" />} />
                <SettingsRow title="Warn on author mismatch" description="Confirm before committing when repository ownership and Git author do not align." control={<SettingsSwitch checked={settings.gitWarnOnAuthorMismatch} onCheckedChange={(gitWarnOnAuthorMismatch) => updateSettings({ gitWarnOnAuthorMismatch })} label="Warn on Git author mismatch" />} />
                <SettingsRow title="Auto-create working branch" description="Create a branch before the stacked PR flow when the current branch is also the target." control={<SettingsSwitch checked={settings.gitAutoCreateBranchWhenTargetMatches} onCheckedChange={(gitAutoCreateBranchWhenTargetMatches) => updateSettings({ gitAutoCreateBranchWhenTargetMatches })} label="Auto-create Git branch" />} />
            </SettingsSection>

            <SettingsSection title="Repository defaults">
                <SettingsRow title="Initial branch" description="Branch name proposed when initializing a repository." status={settings.gitInitDefaultBranch} control={<SettingsButton onClick={() => openTextEditor('initial-branch', settings.gitInitDefaultBranch)}>Edit</SettingsButton>} />
                <SettingsRow title="Create .gitignore" description="Preselect .gitignore generation in the repository initialization flow." control={<SettingsSwitch checked={settings.gitInitCreateGitignore} onCheckedChange={(gitInitCreateGitignore) => updateSettings({ gitInitCreateGitignore })} label="Create .gitignore by default" />} />
                <SettingsRow title="Create initial commit" description="Preselect the first commit step in the initialization flow." control={<SettingsSwitch checked={settings.gitInitCreateInitialCommit} onCheckedChange={(gitInitCreateInitialCommit) => updateSettings({ gitInitCreateInitialCommit })} label="Create initial Git commit by default" />} />
                <SettingsRow title="Bulk action scope" description="Set whether stage-all and unstage-all affect the project folder or whole repository." control={<SettingsSegmented value={settings.gitBulkActionScope} options={[{ value: 'project', label: 'Project' }, { value: 'repo', label: 'Repository' }]} onChange={(gitBulkActionScope) => updateSettings({ gitBulkActionScope })} label="Git bulk action scope" />} />
            </SettingsSection>

            <SettingsSection title="Global identity">
                {globalAuthorMessage ? <SettingsNotice tone={globalAuthorMessage.includes('updated') ? 'success' : 'neutral'}>{globalAuthorMessage}</SettingsNotice> : null}
                <SettingsRow
                    title="Git author"
                    description="Set the default author for future commits on this machine." info="This does not change GitHub authentication."
                    status={savedGlobalAuthor.name && savedGlobalAuthor.email ? 'Configured' : 'No global identity configured'}
                    statusTone={savedGlobalAuthor.name && savedGlobalAuthor.email ? 'ready' : 'warning'}
                    control={<SettingsButton onClick={() => { setGlobalAuthorDraft(savedGlobalAuthor); setEditDialog('identity') }} disabled={globalAuthorLoading}>{globalAuthorLoading ? 'Loading…' : 'Edit identity'}</SettingsButton>}
                >
                    {savedGlobalAuthor.name || savedGlobalAuthor.email ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--settings-text-secondary)]">
                        {savedGlobalAuthor.name ? <span className="inline-flex items-center gap-1">Name <SensitiveSettingValue value={savedGlobalAuthor.name} label="Git author name" /></span> : null}
                        {savedGlobalAuthor.email ? <span className="inline-flex items-center gap-1">Email <SensitiveSettingValue value={savedGlobalAuthor.email} label="Git author email" visiblePrefix={2} /></span> : null}
                    </div> : null}
                </SettingsRow>
            </SettingsSection>
                </>
            )}

            <SettingsDialog
                open={editDialog !== null}
                title={editDialog === 'target-branch' ? 'Edit default target branch' : editDialog === 'initial-branch' ? 'Edit initial branch' : editDialog === 'global-guide' ? 'Edit global pull-request guide' : 'Edit global Git identity'}
                description={editDialog === 'identity' ? 'This writes the machine-wide Git user.name and user.email values.' : 'Review the value, then save it explicitly.'}
                onClose={closeEditor}
                footer={(
                    <>
                        <SettingsButton variant="ghost" onClick={closeEditor}>Cancel</SettingsButton>
                        <SettingsButton
                            variant="accent"
                            disabled={editDialog === 'identity' ? globalAuthorLoading || !globalAuthorDirty : false}
                            onClick={() => editDialog === 'identity' ? void saveGlobalAuthor() : saveTextEditor()}
                        >
                            {globalAuthorLoading && editDialog === 'identity' ? 'Saving…' : 'Save changes'}
                        </SettingsButton>
                    </>
                )}
            >
                {editDialog === 'global-guide' ? (
                    <SettingsTextarea autoFocus rows={10} value={editValue} onChange={(event) => setEditValue(event.target.value)} placeholder="Describe the PR structure and checklist you want." aria-label="Global pull-request guide" />
                ) : editDialog === 'identity' ? (
                    <>
                        <label className="space-y-1.5 text-[12px] font-medium text-[var(--settings-text)]">
                            <span>Name</span>
                            <SettingsInput autoFocus value={globalAuthorDraft.name} onChange={(event) => setGlobalAuthorDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Jane Doe" className="sm:w-full" />
                        </label>
                        <label className="space-y-1.5 text-[12px] font-medium text-[var(--settings-text)]">
                            <span>Email</span>
                            <SettingsInput type="email" value={globalAuthorDraft.email} onChange={(event) => setGlobalAuthorDraft((current) => ({ ...current, email: event.target.value }))} placeholder="jane@example.com" className="sm:w-full" />
                        </label>
                        {globalAuthorMessage && !globalAuthorMessage.includes('updated') ? <SettingsNotice tone="error">{globalAuthorMessage}</SettingsNotice> : null}
                    </>
                ) : (
                    <SettingsInput autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} className="sm:w-full" aria-label={editDialog === 'target-branch' ? 'Default pull-request target branch' : 'Initial Git branch'} />
                )}
            </SettingsDialog>
        </SettingsPageContainer>
    )
}
