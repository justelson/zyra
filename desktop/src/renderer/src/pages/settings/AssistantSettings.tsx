import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AssistantRuntimeMode, AssistantVoiceTranscriptionState } from '@shared/assistant/contracts'
import {
    DEFAULT_ASSISTANT_TITLE_MODEL,
    DEFAULT_ASSISTANT_TITLE_MODEL_LABEL,
    MAX_ASSISTANT_AUTO_TITLE_TURNS,
    MIN_ASSISTANT_AUTO_TITLE_TURNS,
    normalizeAssistantAutoTitleTurnInterval
} from '@shared/assistant/title-generation'
import { ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_OPTIONS } from '@shared/assistant/runtime-policy'
import { useSettings } from '@/lib/settings'
import { loadSettingsModels, readCachedSettingsModels } from './settings-model-catalog-cache'
import {
    SettingsButton,
    SettingsDialog,
    SettingsInput,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSelect,
    SettingsSwitch,
    SettingsTextarea
} from './settings-layout'

type ModelOption = { id: string; label: string; description?: string }

function formatContextTokenLimit(value: number): string {
    return `${Math.round(value / 1_000).toLocaleString()}k`
}

export default function AssistantSettings() {
    const { settings, updateSettings } = useSettings()
    const [models, setModels] = useState<ModelOption[]>(readCachedSettingsModels)
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const [transcriptionState, setTranscriptionState] = useState<AssistantVoiceTranscriptionState | null>(null)
    const [transcriptionStateLoading, setTranscriptionStateLoading] = useState(false)
    const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
    const [promptTemplateOpen, setPromptTemplateOpen] = useState(false)
    const [promptTemplateDraft, setPromptTemplateDraft] = useState(settings.assistantDefaultPromptTemplate)

    const loadModels = useCallback(async (forceRefresh = false) => {
        setModelsLoading(true)
        setModelsError(null)
        try {
            setModels(await loadSettingsModels(forceRefresh))
        } catch (error) {
            setModelsError(error instanceof Error ? error.message : 'Could not load assistant models.')
        } finally {
            setModelsLoading(false)
        }
    }, [])

    const loadTranscriptionState = useCallback(async () => {
        setTranscriptionStateLoading(true)
        try {
            const result = await window.devscope.assistant.getVoiceTranscriptionState()
            if (!result.success) throw new Error(result.error || 'Could not read ChatGPT transcription status.')
            setTranscriptionState(result.state)
            setTranscriptionError(null)
        } catch (error) {
            setTranscriptionError(error instanceof Error ? error.message : 'Could not read ChatGPT transcription status.')
        } finally {
            setTranscriptionStateLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadModels(false)
    }, [loadModels])

    useEffect(() => {
        if (!settings.assistantTranscriptionEnabled || settings.assistantTranscriptionEngine !== 'codex') return
        void loadTranscriptionState()
    }, [loadTranscriptionState, settings.assistantTranscriptionEnabled, settings.assistantTranscriptionEngine])

    const setPermissionMode = (assistantDefaultRuntimeMode: AssistantRuntimeMode) => {
        updateSettings({ assistantDefaultRuntimeMode })
    }

    const openPromptTemplate = () => {
        setPromptTemplateDraft(settings.assistantDefaultPromptTemplate)
        setPromptTemplateOpen(true)
    }

    const savePromptTemplate = () => {
        updateSettings({ assistantDefaultPromptTemplate: promptTemplateDraft })
        setPromptTemplateOpen(false)
    }

    const titleModelOptions = useMemo(() => {
        const options: ModelOption[] = [
            { id: DEFAULT_ASSISTANT_TITLE_MODEL, label: DEFAULT_ASSISTANT_TITLE_MODEL_LABEL },
            ...models
        ]
        if (settings.assistantTitleModel && !options.some((model) => model.id === settings.assistantTitleModel)) {
            options.unshift({ id: settings.assistantTitleModel, label: settings.assistantTitleModel })
        }
        return options.filter((model, index) => options.findIndex((candidate) => candidate.id === model.id) === index)
    }, [models, settings.assistantTitleModel])
    const browserSpeechAvailable = typeof window !== 'undefined'
        && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    const webDefaultMode = settings.assistantDefaultWebSearch
        ? settings.assistantDefaultWebFetch ? 'all' : 'search'
        : settings.assistantDefaultWebFetch ? 'fetch' : 'off'
    const setWebDefaultMode = (mode: 'all' | 'search' | 'fetch' | 'off') => updateSettings({
        assistantDefaultWebSearch: mode === 'all' || mode === 'search',
        assistantDefaultWebFetch: mode === 'all' || mode === 'fetch'
    })
    const chatGptVoiceStatus: { label: string; tone: 'ready' | 'warning' | 'muted'; title?: string } = transcriptionStateLoading
        ? { label: 'Checking', tone: 'muted' }
        : transcriptionError
            ? { label: 'Unavailable', tone: 'warning', title: transcriptionError }
            : transcriptionState?.status === 'ready'
                ? { label: 'Ready', tone: 'ready', title: transcriptionState.message || undefined }
                : transcriptionState?.status === 'signed-out'
                    ? { label: 'Connect account', tone: 'warning', title: transcriptionState.message || undefined }
                    : transcriptionState?.status === 'unavailable'
                        ? { label: 'Unavailable', tone: 'warning', title: transcriptionState.message || undefined }
                        : { label: 'Checking', tone: 'muted' }

    return (
        <SettingsPageContainer>
            <SettingsSection title="Assistant defaults" headerAction={<SettingsButton variant="ghost" onClick={() => void loadModels(true)} disabled={modelsLoading}><RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />Models</SettingsButton>}>
                <SettingsRow
                    title="Model"
                    description="Default model for newly created chats."
                    status={modelsError ? 'Unavailable' : null}
                    statusTone="danger"
                    statusTitle={modelsError || undefined}
                    control={(
                        <SettingsSelect value={settings.assistantDefaultModel} onChange={(event) => updateSettings({ assistantDefaultModel: event.target.value })} aria-label="Default assistant model">
                            <option value="">Provider default</option>
                            {models.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
                        </SettingsSelect>
                    )}
                />
                <SettingsRow
                    title="Chat title model"
                    description="Names new chats without adding the title request to the conversation."
                    control={(
                        <SettingsSelect value={settings.assistantTitleModel} onChange={(event) => updateSettings({ assistantTitleModel: event.target.value })} aria-label="Chat title model">
                            {titleModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
                        </SettingsSelect>
                    )}
                />
                <SettingsRow
                    title="Refresh chat titles"
                    description="Regenerate from recent user prompts and final assistant responses. Each refresh uses one title-model request."
                    status={settings.assistantTitleAutoRegenerate ? 'On' : 'Off'}
                    statusTone={settings.assistantTitleAutoRegenerate ? 'ready' : 'muted'}
                    control={<SettingsSwitch checked={settings.assistantTitleAutoRegenerate} onCheckedChange={(assistantTitleAutoRegenerate) => updateSettings({ assistantTitleAutoRegenerate })} label="Automatically refresh chat titles" />}
                />
                <SettingsRow
                    title="Title refresh interval"
                    description={`Run after this many completed turns. Minimum ${MIN_ASSISTANT_AUTO_TITLE_TURNS}.`}
                    control={(
                        <div className="flex items-center gap-2">
                            <SettingsInput
                                type="number"
                                min={MIN_ASSISTANT_AUTO_TITLE_TURNS}
                                max={MAX_ASSISTANT_AUTO_TITLE_TURNS}
                                value={settings.assistantTitleAutoRegenerateTurns}
                                disabled={!settings.assistantTitleAutoRegenerate}
                                onChange={(event) => updateSettings({ assistantTitleAutoRegenerateTurns: normalizeAssistantAutoTitleTurnInterval(event.target.value) })}
                                className="sm:w-20"
                                aria-label="Completed turns between title refreshes"
                            />
                            <span className="text-[10px] text-[var(--settings-text-muted)]">turns</span>
                        </div>
                    )}
                />
                <SettingsRow title="Zyra profile" description="Choose the instruction profile used when Desktop starts or reconnects a chat." control={<SettingsSegmented value={settings.assistantProductProfile} options={[{ value: 'default', label: 'Default' }, { value: 'builder', label: 'Builder' }]} onChange={(assistantProductProfile) => updateSettings({ assistantProductProfile })} label="Zyra profile" />} />
                <SettingsRow title="Permission mode" description="Use one permission policy for chat tools, Browser, paired Chrome, and computer use." control={<SettingsSelect value={settings.assistantDefaultRuntimeMode} onChange={(event) => setPermissionMode(event.target.value as typeof settings.assistantDefaultRuntimeMode)} aria-label="Default permission mode"><option value="approval-required">Supervised</option><option value="auto-review">Auto review</option><option value="edits-only">Edits only</option><option value="full-access">Full access</option></SettingsSelect>} />
                <SettingsRow title="Reasoning effort" description="Set the default reasoning depth for compatible models." control={<SettingsSelect value={settings.assistantDefaultEffort} onChange={(event) => updateSettings({ assistantDefaultEffort: event.target.value as typeof settings.assistantDefaultEffort })} aria-label="Default reasoning effort">{['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((effort) => <option key={effort} value={effort}>{effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1)}</option>)}</SettingsSelect>} />
                <SettingsRow title="Fast service tier" description="Request the faster provider service tier for new chats." control={<SettingsSwitch checked={settings.assistantDefaultFastMode} onCheckedChange={(assistantDefaultFastMode) => updateSettings({ assistantDefaultFastMode })} label="Fast service tier" />} />
                <SettingsRow title="Web access" description="Choose which web tools new chats start with. Existing chats keep their own choice." control={<SettingsSegmented value={webDefaultMode} options={[{ value: 'all', label: 'Search + fetch' }, { value: 'search', label: 'Search' }, { value: 'fetch', label: 'Fetch' }, { value: 'off', label: 'Off' }]} onChange={setWebDefaultMode} label="Default web access" />} />
                <SettingsRow title="Busy send behavior" description="Choose what Send does while the current turn is still active." control={<SettingsSegmented value={settings.assistantBusyMessageMode} options={[{ value: 'queue', label: 'Queue next' }, { value: 'force', label: 'Interrupt' }]} onChange={(assistantBusyMessageMode) => updateSettings({ assistantBusyMessageMode })} label="Busy send behavior" />} />
                <SettingsRow
                    title="Default prompt"
                    description="Optional starting instructions placed into the composer for new chats."
                    status={settings.assistantDefaultPromptTemplate.trim() ? 'Custom prompt saved' : 'No default prompt'}
                    statusTone={settings.assistantDefaultPromptTemplate.trim() ? 'ready' : 'muted'}
                    control={<SettingsButton onClick={openPromptTemplate}>Edit prompt</SettingsButton>}
                />
            </SettingsSection>

            <SettingsSection title="Reasoning and context">
                <SettingsRow
                    title="Reasoning summaries"
                    description="Ask reasoning models for readable progress summaries. Detailed summaries still exclude private chain-of-thought."
                    control={(
                        <SettingsSelect
                            value={settings.assistantReasoningSummary}
                            onChange={(event) => updateSettings({ assistantReasoningSummary: event.target.value as typeof settings.assistantReasoningSummary })}
                            aria-label="Reasoning summaries"
                        >
                            <option value="auto">Auto</option>
                            <option value="detailed">Detailed</option>
                            <option value="concise">Concise</option>
                        </SettingsSelect>
                    )}
                />
                <SettingsRow
                    title="Context limit"
                    description="Automatically summarize older context before a new turn would exceed this size. Smaller model windows use a lower safe limit."
                    status={formatContextTokenLimit(settings.assistantContextCompactionThresholdTokens)}
                    statusTone="info"
                    control={(
                        <SettingsSelect
                            value={String(settings.assistantContextCompactionThresholdTokens)}
                            onChange={(event) => updateSettings({ assistantContextCompactionThresholdTokens: Number(event.target.value) })}
                            aria-label="Context compaction limit"
                        >
                            {ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_OPTIONS.map((tokens) => (
                                <option key={tokens} value={tokens}>{formatContextTokenLimit(tokens)} tokens</option>
                            ))}
                        </SettingsSelect>
                    )}
                />
            </SettingsSection>

            <SettingsSection title="Output and history">
                <SettingsRow title="Assistant output" description="Show token-by-token output or grouped chunks while a response is generated." control={<SettingsSegmented value={settings.assistantTextStreamingMode} options={[{ value: 'stream', label: 'Live stream' }, { value: 'chunks', label: 'Chunks' }]} onChange={(assistantTextStreamingMode) => updateSettings({ assistantTextStreamingMode })} label="Assistant output mode" />} />
                <SettingsRow title="Open live tool output" description="Automatically expand running tool and command output. Turn this off to keep tool calls closed unless you open them." control={<SettingsSwitch checked={settings.assistantToolOutputDefaultMode === 'expanded'} onCheckedChange={(enabled) => updateSettings({ assistantToolOutputDefaultMode: enabled ? 'expanded' : 'minimized' })} label="Automatically open live tool output" />} />
                <SettingsRow title="Reconnect on startup" description="Attach the selected chat to its canonical server worker after the cached shell appears." control={<SettingsSwitch checked={settings.assistantAutoReconnect} onCheckedChange={(assistantAutoReconnect) => updateSettings({ assistantAutoReconnect })} label="Reconnect selected chat on startup" />} />
                <SettingsRow title="Cross-surface status" description="Show when this canonical chat is open or running in another Zyra surface." control={<SettingsSwitch checked={settings.assistantShowStatusDetails} onCheckedChange={(assistantShowStatusDetails) => updateSettings({ assistantShowStatusDetails })} label="Show cross-surface status" />} />
                <SettingsRow title="Canonical diagnostics" description="Show canonical worker presence and replay sequence in the chat header." control={<SettingsSwitch checked={settings.assistantShowDiagnostics} onCheckedChange={(assistantShowDiagnostics) => updateSettings({ assistantShowDiagnostics })} label="Show canonical diagnostics" />} />
            </SettingsSection>

            <SettingsSection title="Voice transcription">
                <SettingsRow title="Voice input" description="Enable speech-to-text in assistant composers." control={<SettingsSwitch checked={settings.assistantTranscriptionEnabled} onCheckedChange={(assistantTranscriptionEnabled) => updateSettings({ assistantTranscriptionEnabled })} label="Enable voice input" />} />
                {settings.assistantTranscriptionEnabled ? (
                    <>
                        <SettingsRow title="Transcription engine" description="Use live browser dictation or send a recorded voice note to ChatGPT." control={<SettingsSegmented value={settings.assistantTranscriptionEngine} options={[{ value: 'browser', label: 'Browser' }, { value: 'codex', label: 'ChatGPT' }]} onChange={(assistantTranscriptionEngine) => updateSettings({ assistantTranscriptionEngine })} label="Transcription engine" />} />
                        {settings.assistantTranscriptionEngine === 'codex' ? (
                            <SettingsRow
                                title="ChatGPT transcription"
                                description="Records one bounded voice note and transcribes it using the ChatGPT account connected through Pi."
                                status={chatGptVoiceStatus.label}
                                statusTone={chatGptVoiceStatus.tone}
                                statusTitle={chatGptVoiceStatus.title}
                                control={<SettingsButton variant="ghost" onClick={() => void loadTranscriptionState()} disabled={transcriptionStateLoading}><RefreshCw size={12} className={transcriptionStateLoading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh status</SettingsButton>}
                            />
                        ) : (
                            <SettingsRow
                                title="Browser dictation"
                                description="Uses Chromium's live speech-recognition service when this runtime provides it."
                                status={browserSpeechAvailable ? 'Available' : 'Unavailable'}
                                statusTone={browserSpeechAvailable ? 'ready' : 'warning'}
                            />
                        )}
                    </>
                ) : null}
            </SettingsSection>

            <SettingsDialog
                open={promptTemplateOpen}
                title="Edit default prompt"
                description="This text is placed into the composer when a new chat starts."
                onClose={() => setPromptTemplateOpen(false)}
                footer={(
                    <>
                        <SettingsButton variant="ghost" onClick={() => setPromptTemplateOpen(false)}>Cancel</SettingsButton>
                        <SettingsButton variant="accent" onClick={savePromptTemplate}>Save prompt</SettingsButton>
                    </>
                )}
            >
                <SettingsTextarea
                    autoFocus
                    value={promptTemplateDraft}
                    maxLength={32_000}
                    rows={10}
                    onChange={(event) => setPromptTemplateDraft(event.target.value)}
                    placeholder="Optional instructions for new chats"
                    aria-label="Default assistant prompt template"
                />
                <div className="text-right text-[10px] tabular-nums text-[var(--settings-text-muted)]">{promptTemplateDraft.length.toLocaleString()} / 32,000</div>
            </SettingsDialog>
        </SettingsPageContainer>
    )
}
