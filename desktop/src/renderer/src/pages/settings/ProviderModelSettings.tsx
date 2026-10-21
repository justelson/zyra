import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
    MAX_ASSISTANT_AUTO_TITLE_TURNS,
    MIN_ASSISTANT_AUTO_TITLE_TURNS,
    normalizeAssistantAutoTitleTurnInterval
} from '@shared/assistant/title-generation'
import type { AssistantModelInfo } from '@shared/assistant/contracts'
import { useSettings } from '@/lib/settings'
import { loadSettingsModels, readCachedSettingsModels, subscribeSettingsModels } from './settings-model-catalog-cache'
import { ChatDefaultModelPicker } from './ChatDefaultModelPicker'
import {
    SettingsButton,
    SettingsInput,
    SettingsRow,
    SettingsSection,
    SettingsSwitch
} from './settings-layout'

type ModelOption = Pick<AssistantModelInfo, 'id' | 'label' | 'description'>


function uniqueModels(options: readonly ModelOption[]): ModelOption[] {
    return options.filter((model, index) => options.findIndex((candidate) => candidate.id === model.id) === index)
}

export function ProviderModelSettings() {
    const { settings, updateSettings } = useSettings()
    const initialModels = useMemo(() => readCachedSettingsModels(), [])
    const [models, setModels] = useState<ModelOption[]>(initialModels)
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsResolved, setModelsResolved] = useState(initialModels.length > 0)
    const [modelsError, setModelsError] = useState<string | null>(null)

    const loadModels = useCallback(async (forceRefresh = false) => {
        setModelsLoading(true)
        setModelsError(null)
        try {
            setModels(await loadSettingsModels(forceRefresh))
        } catch (error) {
            setModelsError(error instanceof Error ? error.message : 'Could not load assistant models.')
        } finally {
            setModelsResolved(true)
            setModelsLoading(false)
        }
    }, [])

    useEffect(() => {
        const unsubscribe = subscribeSettingsModels(next => { setModels(next); setModelsResolved(true); setModelsError(null) })
        void loadModels()
        return unsubscribe
    }, [loadModels])
    const titleModelOptions = useMemo(() => uniqueModels(models), [models])
    const savedTitleUnavailable = Boolean(
        modelsResolved
        && settings.assistantTitleModel
        && !models.some((model) => model.id === settings.assistantTitleModel)
    )

    return (
        <>
            <SettingsSection title="Automatic titles" searchSection="Chat defaults" headerAction={<SettingsButton variant="ghost" onClick={() => void loadModels(true)} disabled={modelsLoading}><RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />Refresh</SettingsButton>}>
                <SettingsRow
                    title="Title refresh model"
                    description="Used for later title refreshes. Initial titles come from the chat model."
                    status={modelsError ? 'Catalog unavailable' : savedTitleUnavailable ? 'Saved model unavailable' : null}
                    statusTone={modelsError || savedTitleUnavailable ? 'warning' : 'muted'}
                    statusTitle={modelsError || undefined}
                    control={(
                        <ChatDefaultModelPicker ariaLabel="Chat title model" value={settings.assistantTitleModel} models={titleModelOptions} onValueChange={(assistantTitleModel) => updateSettings({ assistantTitleModel })} />
                    )}
                />
                <SettingsRow
                    title="Refresh chat titles"
                    description="Refresh chat titles periodically using one title-model request."
                    status={settings.assistantTitleAutoRegenerate ? 'On' : 'Off'}
                    statusTone={settings.assistantTitleAutoRegenerate ? 'ready' : 'muted'}
                    control={<SettingsSwitch checked={settings.assistantTitleAutoRegenerate} onCheckedChange={(assistantTitleAutoRegenerate) => updateSettings({ assistantTitleAutoRegenerate })} label="Automatically refresh chat titles" />}
                />
                {settings.assistantTitleAutoRegenerate ? (<SettingsRow
                    title="Title refresh interval"
                    description={`Update after at least ${MIN_ASSISTANT_AUTO_TITLE_TURNS} completed turns.`}
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
                />) : null}
            </SettingsSection>
        </>
    )
}
