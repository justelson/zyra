import { Link } from 'react-router-dom'
import { useSettings, type CommitAIProvider } from '@/lib/settings'
import { useCodexModelOptions } from './ai-settings/useCodexModelOptions'
import { findSettingsDestinationById } from './settings-navigation'
import { createSettingsRowTargetId } from './settings-search'
import { SettingsProviderIcon } from './SettingsProviderIcon'
import { SettingsNotice, SettingsRow, SettingsSection, SettingsSelect } from './settings-layout'

export function GitTextGenerationSettings() {
    const { settings, updateSettings } = useSettings()
    const chatGptSelected = settings.commitAIProvider === 'codex'
    const { codexModelsError, resolvedCodexModelOptions } = useCodexModelOptions(
        [settings.gitCommitCodexModel, settings.gitPullRequestCodexModel, settings.assistantDefaultModel], chatGptSelected
    )
    const options = resolvedCodexModelOptions.map(model => <option key={model.id} value={model.id}>{model.label || model.id}</option>)
    return <SettingsSection title="Text generation" headerAction={
        <Link to={findSettingsDestinationById('providers')!.to} className="text-[11px] text-[var(--settings-text-muted)] hover:text-[var(--settings-text)] hover:underline">Manage providers</Link>
    }>
        <SettingsRow
            title="Default Git AI provider"
            description="Generate commit messages and pull-request drafts with this provider."
            searchTargetId={createSettingsRowTargetId('Providers', 'Default Git AI provider')}
            control={<SettingsSelect value={settings.commitAIProvider} onChange={event => updateSettings({ commitAIProvider: event.target.value as CommitAIProvider })} aria-label="Default Git AI provider"><option value="groq">Groq</option><option value="gemini">Google Gemini</option><option value="codex">ChatGPT</option></SettingsSelect>}
        />
        <SettingsRow
            title="ChatGPT commit model"
            description="Model used for commit messages when ChatGPT is selected."
            icon={<SettingsProviderIcon provider="chatgpt" />}
            searchTargetId={createSettingsRowTargetId('Zyra · ChatGPT', 'Commit model')}
            control={<SettingsSelect value={settings.gitCommitCodexModel} disabled={!chatGptSelected} onChange={event => updateSettings({ gitCommitCodexModel: event.target.value })} aria-label="ChatGPT commit model">{options}</SettingsSelect>}
        />
        <SettingsRow
            title="ChatGPT pull-request model"
            description="Model used for pull-request text when ChatGPT is selected."
            icon={<SettingsProviderIcon provider="chatgpt" />}
            searchTargetId={createSettingsRowTargetId('Zyra · ChatGPT', 'Pull-request model')}
            control={<SettingsSelect value={settings.gitPullRequestCodexModel} disabled={!chatGptSelected} onChange={event => updateSettings({ gitPullRequestCodexModel: event.target.value })} aria-label="ChatGPT pull-request model">{options}</SettingsSelect>}
        />
        {chatGptSelected && codexModelsError ? <SettingsNotice tone="error">{codexModelsError}</SettingsNotice> : null}
    </SettingsSection>
}
