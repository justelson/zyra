import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useSettings, type CommitAIProvider } from '@/lib/settings'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { SettingsProviderIcon } from './SettingsProviderIcon'
import { createSettingsRowTargetId } from './settings-search'
import { findSettingsDestinationById } from './settings-navigation'
import {
    SettingsButton,
    SettingsDialog,
    SettingsInput,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection
} from './settings-layout'

type ProviderStatus = 'idle' | 'testing' | 'saving' | 'success' | 'error'

export default function AISettings() {
    const { settings, updateHostedAiSecrets } = useSettings()
    const desktopHost = isElectronRendererRuntime()
    const [groqDraft, setGroqDraft] = useState('')
    const [geminiDraft, setGeminiDraft] = useState('')
    const [editingProvider, setEditingProvider] = useState<Exclude<CommitAIProvider, 'codex'> | null>(null)
    const [clearKeysConfirmOpen, setClearKeysConfirmOpen] = useState(false)
    const [status, setStatus] = useState<Record<CommitAIProvider, ProviderStatus>>({ groq: 'idle', gemini: 'idle', codex: 'idle' })
    const [errors, setErrors] = useState<Record<CommitAIProvider, string>>({ groq: '', gemini: '', codex: '' })

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
        setStatus((current) => ({ ...current, [provider]: 'saving' }))
        setErrors((current) => ({ ...current, [provider]: '' }))
        try {
            await updateHostedAiSecrets(provider === 'groq' ? { groqApiKey: key } : { geminiApiKey: key })
            if (provider === 'groq') setGroqDraft('')
            else setGeminiDraft('')
            setStatus((current) => ({ ...current, [provider]: 'idle' }))
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

    const providerStatus = (provider: CommitAIProvider, draft = false) => {
        if (provider !== 'codex' && !draft) {
            if (status[provider] === 'saving') return 'Saving…'
            return (provider === 'groq' ? settings.groqApiKeyConfigured : settings.geminiApiKeyConfigured) ? 'Key saved' : 'Not configured'
        }
        if (status[provider] === 'testing') return 'Testing…'
        if (status[provider] === 'saving') return 'Saving…'
        if (status[provider] === 'success') return 'Verified'
        if (status[provider] === 'error') return 'Needs attention'
        return 'Not checked'
    }

    const providerStatusTone = (provider: CommitAIProvider): 'ready' | 'warning' | 'danger' | 'info' | 'muted' => {
        if (provider !== 'codex') return status[provider] === 'saving' ? 'info' : (provider === 'groq' ? settings.groqApiKeyConfigured : settings.geminiApiKeyConfigured) ? 'ready' : 'muted'
        if (status[provider] === 'testing' || status[provider] === 'saving') return 'info'
        if (status[provider] === 'success') return 'ready'
        if (status[provider] === 'error') return 'danger'
        return 'muted'
    }

    const providerBusy = editingProvider !== null && (status[editingProvider] === 'testing' || status[editingProvider] === 'saving')
    const savingKey = editingProvider !== null && status[editingProvider] === 'saving'

    return (
        <SettingsPageContainer title="AI providers" backTo="/settings/account" backLabel="Account & connections">
            <SettingsSection title="Hosted providers">
                <SettingsRow
                    title="Groq"
                    description="API key for Git text generation with Groq."
                    searchTargetId={createSettingsRowTargetId('Groq', 'API key')}
                    status={providerStatus('groq')}
                    statusTone={providerStatusTone('groq')}
                    statusTitle={editingProvider === 'groq' && status.groq === 'error' ? errors.groq : undefined}
                    control={desktopHost ? <SettingsButton onClick={() => { setGroqDraft(''); setEditingProvider('groq') }}>{settings.groqApiKeyConfigured ? 'Replace key' : 'Add key'}</SettingsButton> : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />
                <SettingsRow
                    title="Google Gemini"
                    description="API key for Git text generation with Gemini."
                    icon={<SettingsProviderIcon provider="gemini" />}
                    searchTargetId={createSettingsRowTargetId('Google Gemini', 'API key')}
                    status={providerStatus('gemini')}
                    statusTone={providerStatusTone('gemini')}
                    statusTitle={editingProvider === 'gemini' && status.gemini === 'error' ? errors.gemini : undefined}
                    control={desktopHost ? <SettingsButton onClick={() => { setGeminiDraft(''); setEditingProvider('gemini') }}>{settings.geminiApiKeyConfigured ? 'Replace key' : 'Add key'}</SettingsButton> : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />
            </SettingsSection>

            <SettingsSection title="ChatGPT" icon={<SettingsProviderIcon provider="chatgpt" />} headerAction={<SettingsButton variant="ghost" onClick={() => void testProvider('codex')} disabled={status.codex === 'testing'}>{status.codex === 'testing' ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}Test connection</SettingsButton>}>
                <SettingsRow title="Connected account" description="Uses the subscription in your OpenAI account settings." status={providerStatus('codex')} statusTone={providerStatusTone('codex')} statusTitle={status.codex === 'error' ? errors.codex : undefined}
                    control={<Link to={findSettingsDestinationById('account')!.to} className="text-[12px] text-[var(--settings-text-secondary)] hover:text-[var(--settings-text)] hover:underline">Manage account</Link>} />
                {status.codex === 'error' ? <SettingsNotice tone="error">{errors.codex}</SettingsNotice> : null}
            </SettingsSection>
            <SettingsSection title="Text generation">
                <SettingsRow title="Git writing defaults" description="Choose providers and models in Source control."
                    control={<Link to={findSettingsDestinationById('source-control')!.to} className="text-[12px] text-[var(--settings-text-secondary)] hover:text-[var(--settings-text)] hover:underline">Open Source control</Link>} />
            </SettingsSection>

            <SettingsSection title="Stored credentials">
                {desktopHost ? <SettingsRow title="Clear hosted API keys" description="Remove the OS-encrypted Groq and Gemini keys from this device." control={<SettingsButton variant="danger" disabled={!settings.groqApiKeyConfigured && !settings.geminiApiKeyConfigured} onClick={() => setClearKeysConfirmOpen(true)}><Trash2 size={12} />Clear keys</SettingsButton>} /> : <SettingsNotice tone="neutral">Open Zyra Desktop to add, replace, test, or remove hosted-provider API keys.</SettingsNotice>}
            </SettingsSection>

            <SettingsDialog
                open={editingProvider !== null}
                title={`Configure ${editingProvider === 'gemini' ? 'Google Gemini' : 'Groq'}`}
                description="Test the key if needed, then save it on this device."
                onClose={() => { if (savingKey) return; setGroqDraft(''); setGeminiDraft(''); setEditingProvider(null) }}
                footer={editingProvider ? (
                    <>
                        <SettingsButton variant="ghost" disabled={savingKey} onClick={() => { setGroqDraft(''); setGeminiDraft(''); setEditingProvider(null) }}>Cancel</SettingsButton>
                        <SettingsButton onClick={() => void testProvider(editingProvider)} disabled={!(editingProvider === 'groq' ? groqDraft : geminiDraft).trim() || providerBusy}>
                            {status[editingProvider] === 'testing' ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}Test
                        </SettingsButton>
                        <SettingsButton variant="accent" disabled={!(editingProvider === 'groq' ? groqDraft : geminiDraft).trim() || providerBusy} onClick={() => void saveHostedKey(editingProvider)}>{savingKey ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}{savingKey ? 'Saving…' : 'Save key'}</SettingsButton>
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
                        {status[editingProvider] === 'error' ? <SettingsNotice tone="error">{errors[editingProvider]}</SettingsNotice> : <div className="text-[11px] text-[var(--settings-text-muted)]">{providerStatus(editingProvider, true)}</div>}
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
