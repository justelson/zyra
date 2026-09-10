import { useEffect, useMemo, useState } from 'react'
import type { ModelOption } from './aiSettingsConfig'
import { loadSettingsModels, readCachedSettingsModels } from '../settings-model-catalog-cache'

export function useCodexModelOptions(effectiveCodexModels: string[], enabled = true) {
    const [codexModelOptions, setCodexModelOptions] = useState<ModelOption[]>(readCachedSettingsModels)
    const [codexModelsError, setCodexModelsError] = useState('')

    useEffect(() => {
        if (!enabled) return
        let cancelled = false

        async function loadCodexModels() {
            try {
                const models = await loadSettingsModels(false)
                if (cancelled) return
                setCodexModelOptions(models)
                setCodexModelsError('')
            } catch (error) {
                if (!cancelled) {
                    setCodexModelOptions([])
                    setCodexModelsError(error instanceof Error ? error.message : 'Failed to load ChatGPT models.')
                }
            }
        }

        void loadCodexModels()
        return () => {
            cancelled = true
        }
    }, [enabled])

    const resolvedCodexModelOptions = useMemo(() => {
        const options = [...codexModelOptions]
        const currentValues = Array.from(new Set(
            (effectiveCodexModels || [])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        ))

        for (const currentValue of currentValues.reverse()) {
            if (!options.some((option) => option.id === currentValue)) {
                options.unshift({ id: currentValue, label: currentValue, description: 'Currently selected model' })
            }
        }
        if (options.length === 0) {
            options.push({ id: '', label: 'Default ChatGPT model' })
        } else if (!options.some((option) => option.id === '')) {
            options.unshift({ id: '', label: 'Default ChatGPT model' })
        }
        return options
    }, [codexModelOptions, effectiveCodexModels])

    return {
        codexModelsError,
        resolvedCodexModelOptions
    }
}
