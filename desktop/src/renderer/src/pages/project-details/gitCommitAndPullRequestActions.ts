import { resolvePreferredGitTextProvider } from '@/lib/gitAi'
import { invalidateProjectGitOverview } from '@/lib/projectGitOverview'
import {
    getProjectPullRequestConfig,
    resolvePreferredPullRequestProvider,
    resolvePullRequestGuideText
} from '@/lib/pullRequestWorkflow'
import type { DevScopeCommitPushPullRequestInput } from '@shared/contracts/devscope-api'
import type { GitCommit } from './types'
import type { GitActionParams } from './gitActionTypes'
import { refreshGitInBackground } from './gitActionRefresh'

export function createGitCommitAndPullRequestActions(params: GitActionParams) {
    const performCommit = async () => {
        if (!params.decodedPath || !params.commitMessage.trim()) return

        params.setIsCommitting(true)
        try {
            if (params.stagedFiles.length === 0) {
                throw new Error('No staged files to commit')
            }

            const commitResult = await window.devscope.createCommit(params.decodedPath, params.commitMessage)
            if (!commitResult?.success) {
                throw new Error(commitResult?.error || 'Failed to create commit')
            }

            params.setCommitMessage('')
            invalidateProjectGitOverview(params.decodedPath)
            params.showToast('Commit created successfully.')
            params.setIsCommitting(false)
            refreshGitInBackground(params, false, 'unpushed')
        } catch (err: any) {
            params.showToast(`Failed to commit: ${err.message}`, undefined, undefined, 'error')
        } finally {
            params.setIsCommitting(false)
        }
    }

    const handleCommitClick = async (commit: GitCommit) => {
        if (!params.decodedPath) return

        params.setSelectedCommit(commit)
        params.setLoadingDiff(true)
        params.setCommitDiff('')

        try {
            const result = await window.devscope.getCommitDiff(params.decodedPath, commit.hash)
            if (result.success) {
                params.setCommitDiff(result.diff)
            } else {
                params.setCommitDiff(`Error loading diff: ${result.error}`)
            }
        } catch (err: any) {
            params.setCommitDiff(`Error: ${err.message}`)
        } finally {
            params.setLoadingDiff(false)
        }
    }

    const handleCommit = async () => {
        if (!params.decodedPath || !params.commitMessage.trim() || params.stagedFiles.length === 0) return

        const shouldWarn = params.settings.gitWarnOnAuthorMismatch !== false
        if (shouldWarn && params.gitUser && params.repoOwner && params.gitUser.name !== params.repoOwner) {
            params.setShowAuthorMismatch(true)
            return
        }

        await performCommit()
    }

    const buildPullRequestInput = async (autoStageAll: boolean) => {
        const prConfig = getProjectPullRequestConfig(params.settings, params.decodedPath)
        const guideText = await resolvePullRequestGuideText(
            params.settings,
            params.decodedPath,
            prConfig.guideSource,
            prConfig.guide
        )
        const provider = resolvePreferredPullRequestProvider(params.settings)
        const stageScope: DevScopeCommitPushPullRequestInput['stageScope'] =
            params.settings.gitBulkActionScope === 'project' ? 'project' : 'repo'

        return {
            provider,
            prConfig,
            request: {
                projectName: params.projectName,
                commitMessage: params.commitMessage.trim() || undefined,
                targetBranch: prConfig.targetBranch,
                draft: prConfig.draft,
                guideText,
                provider: provider?.provider,
                apiKey: provider?.apiKey,
                model: provider?.model,
                ...(autoStageAll
                    ? { autoStageAll: true, stageScope }
                    : {})
            }
        }
    }

    const runStackedPullRequestFlow = async (autoStageAll: boolean) => {
        if (!params.decodedPath || (autoStageAll ? params.stagedFiles.length === 0 && params.unstagedFiles.length === 0 : params.stagedFiles.length === 0)) {
            return
        }

        const { provider, request } = await buildPullRequestInput(autoStageAll)
        if (!params.commitMessage.trim() && !provider) {
            params.showToast(
                'Enter a commit message or configure an AI provider first.',
                'Open AI Settings',
                '/settings/assistant/providers',
                'info'
            )
            return
        }

        params.setIsStackedActionRunning(true)
        try {
            const result = await window.devscope.commitPushAndCreatePullRequest(params.decodedPath, request)
            if (!result?.success) {
                throw new Error(result?.error || `Failed to ${autoStageAll ? 'stage, commit, push, and create the pull request.' : 'commit, push, and create the pull request.'}`)
            }

            params.setCommitMessage('')
            invalidateProjectGitOverview(params.decodedPath)
            window.open(result.pullRequest.url, '_blank', 'noopener,noreferrer')
            const prNumberLabel = result.pullRequest.number > 0 ? ` #${result.pullRequest.number}` : ''
            params.showToast(
                autoStageAll
                    ? result.status === 'opened_existing'
                        ? `Staged all changes, committed, and opened PR${prNumberLabel}.`
                        : `Staged all changes, committed, and created PR${prNumberLabel}.`
                    : result.status === 'opened_existing'
                        ? `Committed changes and opened PR${prNumberLabel}.`
                        : `Committed changes and created PR${prNumberLabel}.`
            )
            params.setIsStackedActionRunning(false)
            refreshGitInBackground(params, false, 'unpushed')
        } catch (err: any) {
            params.showToast(
                autoStageAll
                    ? `Failed to dangerously stage, commit, push & create PR: ${err.message || 'Unknown error'}`
                    : `Failed to commit, push & create PR: ${err.message || 'Unknown error'}`,
                undefined,
                undefined,
                'error'
            )
        } finally {
            params.setIsStackedActionRunning(false)
        }
    }

    const handleGenerateCommitMessage = async () => {
        if (!params.decodedPath) return
        if (params.stagedFiles.length === 0) {
            params.showToast('Stage files first to generate an AI commit message.', undefined, undefined, 'info')
            return
        }

        const selectedProvider = resolvePreferredGitTextProvider(params.settings)
        if (!selectedProvider) {
            params.showToast('No AI provider is configured for commit generation.', 'Open Providers', '/settings/assistant/providers')
            return
        }

        params.setIsGeneratingCommitMessage(true)
        try {
            const stagedDiffResult = await window.devscope.getWorkingDiff(params.decodedPath, undefined, 'staged')
            if (!stagedDiffResult?.success) {
                throw new Error(stagedDiffResult?.error || 'Failed to read staged changes')
            }

            const stagedDiff = String(stagedDiffResult.diff || '').trim()
            if (!stagedDiff || stagedDiff === 'No changes') {
                throw new Error('No staged diff available to generate a commit message.')
            }

            const generateResult = await window.devscope.generateCommitMessage(
                selectedProvider.provider,
                selectedProvider.apiKey || '',
                stagedDiff,
                selectedProvider.model
            )

            if (!generateResult?.success) {
                throw new Error(generateResult.error || 'Failed to generate commit message')
            }
            if (!generateResult.message) {
                throw new Error('Failed to generate commit message')
            }

            params.setCommitMessage(generateResult.message.trim())
            params.showToast('Commit message generated successfully.')
        } catch (err: any) {
            params.showToast(`AI generation failed: ${err.message || 'Unknown error'}`, undefined, undefined, 'error')
        } finally {
            params.setIsGeneratingCommitMessage(false)
        }
    }

    return {
        handleCommitClick,
        handleCommit,
        handleCommitPushAndCreatePullRequest: async () => runStackedPullRequestFlow(false),
        handleDangerouslyStageCommitPushAndCreatePullRequest: async () => runStackedPullRequestFlow(true),
        handleGenerateCommitMessage,
        handleAuthorMismatchConfirm: () => {
            params.setShowAuthorMismatch(false)
            void performCommit()
        }
    }
}
