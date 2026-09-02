import { useMemo, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useSettings, type CommitAIProvider } from '@/lib/settings'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { useCodexModelOptions } from './ai-settings/useCodexModelOptions'
import {
    SettingsButton,
    SettingsDialog,
    SettingsInput,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSelect
} from './settings-layout'

type ProviderStatus = 'idle' | 'testing' | 'success' | 'error'

export default function AISettings() {
    const { settings, updateSettings, updateHostedAiSecrets } = useSettings()
    const desktopHost = isElectronRendererRuntime()
    const [groqDraft, setGroqDraft] = useState('')
    const [geminiDraft, setGeminiDraft] = useState('')
    const [editingProvider, setEditingProvider] = useState<Exclude<CommitAIProvider, 'codex'> | null>(null)
    const [clearKeysConfirmOpen, setClearKeysConfirmOpen] = useState(false)
    const [status, setStatus] = useState<Record<CommitAIProvider, ProviderStatus>>({ groq: 'idle', gemini: 'idle', codex: 'idle' })
    const [errors, setErrors] = useState<Record<CommitAIProvider, string>>({ groq: '', gemini: '', codex: '' })
    const { codexModelsError, resolvedCodexModelOptions } = useCodexModelOptions([settings.gitCommitCodexModel, settings.gitPullRequestCodexModel, settings.assistantDefaultModel])

    const modelOptions = useMemo(() => resolvedCodexModelOptions.map((option) => ({ id: option.id, label: option.label || option.id })), [resolvedCodexModelOptions])

    const testProvider = async (provider: CommitAIProvider) => {
        setStatus((current) => ({ ...current, [provider]: 'testing' }))
        setErrors((current) => ({ ...current, [provider]: '' }))
        try {
            const result = provider === 'groq'
                ? await window.devscope.testGroqConnection(groqDraft.trim())
                : provider === 'gemini'
                    ? await window.devscope.testGeminiConnection(geminiDraft.trim())
                    : await window.devscope.testCodexConnection(settings.gitCommitCodexModel || settings.gitPullRequestCodexModel || settings.assistantDefaultModel || undefined)
            if (!result.success) throw new Error(result.error || 'Connection test failed.')
            setStatus((current) => ({ ...current, [provider]: 'success' }))
        } catch (error) {
            setStatus((current) => ({ ...current, [provider]: 'error' }))
            setErrors((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Connection test failed.' }))
        }
    }

    const saveHostedKey = async (provider: Exclude<CommitAIProvider, 'codex'>) => {
        const key = (provider === 'groq' ? groqDraft : geminiDraft).trim()
        if (!key) return
        setStatus((current) => ({ ...current, [provider]: 'testing' }))
        setErrors((current) => ({ ...current, [provider]: '' }))
        try {
            await updateHostedAiSecrets(provider === 'groq' ? { groqApiKey: key } : { geminiApiKey: key })
            if (provider === 'groq') setGroqDraft('')
            else setGeminiDraft('')
            setStatus((current) => ({ ...current, [provider]: 'success' }))
            setEditingProvider(null)
        } catch (error) {
            setStatus((current) => ({ ...current, [provider]: 'error' }))
            setErrors((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Could not save the API key.' }))
        }
    }

    const clearHostedKeys = async () => {
        try {
            await updateHostedAiSecrets({ groqApiKey: '', geminiApiKey: '', confirmClear: true })
            setGroqDraft('')
            setGeminiDraft('')
            setStatus({ groq: 'idle', gemini: 'idle', codex: status.codex })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not clear hosted API keys.'
            setErrors((current) => ({ ...current, groq: message, gemini: message }))
            setStatus((current) => ({ ...current, groq: 'error', gemini: 'error' }))
        }
    }

    const providerStatus = (provider: CommitAIProvider) => {
        if (status[provider] === 'testing') return 'Testing…'
        if (status[provider] === 'success') return provider === 'codex' ? 'Account verified through Pi' : 'Connection verified'
        if (status[provider] === 'error') return 'Unavailable'
        if (provider === 'codex') return 'Uses your ChatGPT account through Pi'
        return (provider === 'groq' ? settings.groqApiKeyConfigured : settings.geminiApiKeyConfigured) ? 'API key saved securely' : 'No API key saved'
    }

    const providerStatusTone = (provider: CommitAIProvider): 'ready' | 'warning' | 'danger' | 'info' | 'muted' => {
        if (status[provider] === 'testing') return 'info'
        if (status[provider] === 'success') return 'ready'
        if (status[provider] === 'error') return 'danger'
        if (provider === 'codex') return 'muted'
        return (provider === 'groq' ? settings.groqApiKeyConfigured : settings.geminiApiKeyConfigured) ? 'ready' : 'warning'
    }

    return (
        <SettingsPageContainer title="AI providers" backTo="/settings/assistant" backLabel="Assistant">
            <SettingsSection title="Providers">
                <SettingsRow
                    title="Default Git AI provider"
                    description="Provider used for generated commit messages and pull-request drafts."
                    control={<SettingsSelect value={settings.commitAIProvider} onChange={(event) => updateSettings({ commitAIProvider: event.target.value as CommitAIProvider })} aria-label="Default Git AI provider"><option value="groq">Groq</option><option value="gemini">Google Gemini</option><option value="codex">Zyra · ChatGPT</option></SettingsSelect>}
                />
            </SettingsSection>

            <SettingsSection title="Groq">
                <SettingsRow
                    title="API key"
                    description="Hosted Groq API credential used only for Git text generation."
                    status={providerStatus('groq')}
                    statusTone={providerStatusTone('groq')}
                    statusTitle={status.groq === 'error' ? errors.groq : undefined}
                    control={desktopHost ? <SettingsButton onClick={() => { setGroqDraft(''); setEditingProvider('groq') }}>{settings.groqApiKeyConfigured ? 'Replace key' : 'Add key'}</SettingsButton> : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />
            </SettingsSection>

            <SettingsSection title="Google Gemini">
                <SettingsRow
                    title="API key"
                    description="Google AI Studio credential used only for Git text generation."
                    status={providerStatus('gemini')}
                    statusTone={providerStatusTone('gemini')}
                    statusTitle={status.gemini === 'error' ? errors.gemini : undefined}
                    control={desktopHost ? <SettingsButton onClick={() => { setGeminiDraft(''); setEditingProvider('gemini') }}>{settings.geminiApiKeyConfigured ? 'Replace key' : 'Add key'}</SettingsButton> : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />
            </SettingsSection>

            <SettingsSection title="Zyra · ChatGPT" headerAction={<SettingsButton variant="ghost" onClick={() => void testProvider('codex')} disabled={status.codex === 'testing'}>{status.codex === 'testing' ? <RefreshCw size={12} className="animate-spin" /> : null}Test connection</SettingsButton>}>
                <SettingsRow title="Commit model" description="ChatGPT model used for generated commit messages." status={providerStatus('codex')} statusTone={providerStatusTone('codex')} statusTitle={status.codex === 'error' ? errors.codex : undefined} control={<SettingsSelect value={settings.gitCommitCodexModel} onChange={(event) => updateSettings({ gitCommitCodexModel: event.target.value })} aria-label="ChatGPT commit model"><option value="">Default model</option>{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</SettingsSelect>} />
                <SettingsRow title="Pull-request model" description="ChatGPT model used for generated PR titles and bodies." control={<SettingsSelect value={settings.gitPullRequestCodexModel} onChange={(event) => updateSettings({ gitPullRequestCodexModel: event.target.value })} aria-label="ChatGPT pull-request model"><option value="">Default model</option>{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</SettingsSelect>} />
                {codexModelsError ? <SettingsNotice tone="error">{codexModelsError}</SettingsNotice> : null}
            </SettingsSection>

            <SettingsSection title="Stored credentials">
                {desktopHost ? <SettingsRow title="Clear hosted API keys" description="Remove the OS-encrypted Groq and Gemini keys from this device." control={<SettingsButton variant="danger" disabled={!settings.groqApiKeyConfigured && !settings.geminiApiKeyConfigured} onClick={() => setClearKeysConfirmOpen(true)}><Trash2 size={12} />Clear keys</SettingsButton>} /> : <SettingsNotice tone="neutral">Open Zyra Desktop to add, replace, test, or remove hosted-provider API keys.</SettingsNotice>}
            </SettingsSection>

            <SettingsDialog
                open={editingProvider !== null}
                title={`Configure ${editingProvider === 'gemini' ? 'Google Gemini' : 'Groq'}`}
                description="The credential is hidden on the Settings page and can be tested before saving."
                onClose={() => { setGroqDraft(''); setGeminiDraft(''); setEditingProvider(null) }}
                footer={editingProvider ? (
                    <>
                        <SettingsButton variant="ghost" onClick={() => { setGroqDraft(''); setGeminiDraft(''); setEditingProvider(null) }}>Cancel</SettingsButton>
                        <SettingsButton onClick={() => void testProvider(editingProvider)} disabled={!(editingProvider === 'groq' ? groqDraft : geminiDraft).trim() || status[editingProvider] === 'testing'}>
                            {status[editingProvider] === 'testing' ? <RefreshCw size={12} className="animate-spin" /> : null}Test
                        </SettingsButton>
                        <SettingsButton variant="accent" disabled={!(editingProvider === 'groq' ? groqDraft : geminiDraft).trim() || status[editingProvider] === 'testing'} onClick={() => void saveHostedKey(editingProvider)}>{status[editingProvider] === 'testing' ? <RefreshCw size={12} className="animate-spin" /> : null}Save key</SettingsButton>
                    </>
                ) : null}
            >
                {editingProvider ? (
                    <>
                        <label htmlFor="provider-api-key" className="text-[12px] font-medium text-[var(--settings-text)]">API key</label>
                        <SettingsInput
                            id="provider-api-key"
                            autoFocus
                            type="password"
                            value={editingProvider === 'groq' ? groqDraft : geminiDraft}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) => editingProvider === 'groq' ? setGroqDraft(event.target.value) : setGeminiDraft(event.target.value)}
                            placeholder={editingProvider === 'groq' ? 'gsk_…' : 'AIza…'}
                            className="sm:w-full"
                        />
                        <div className="text-[11px] text-[var(--settings-text-muted)]">{providerStatus(editingProvider)}</div>
                    </>
                ) : null}
            </SettingsDialog>

            <ConfirmModal
                isOpen={clearKeysConfirmOpen}
                title="Clear hosted API keys?"
                message="Zyra will remove the OS-encrypted Groq and Gemini credentials from this device. Git text generation using those providers will require new keys."
                confirmLabel="Clear keys"
                variant="warning"
                onCancel={() => setClearKeysConfirmOpen(false)}
                onConfirm={() => {
                    setClearKeysConfirmOpen(false)
                    void clearHostedKeys()
                }}
            />
        </SettingsPageContainer>
    )
}
