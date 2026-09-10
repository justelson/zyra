import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AssistantVoiceTranscriptionState } from '@shared/assistant/contracts'
import { useSettings } from '@/lib/settings'
import { SettingsProviderIcon } from './SettingsProviderIcon'
import { SettingsButton, SettingsRow, SettingsSection, SettingsSegmented, SettingsSwitch } from './settings-layout'

export function VoiceTranscriptionSettings() {
    const { settings, updateSettings } = useSettings()
    const [transcriptionState, setTranscriptionState] = useState<AssistantVoiceTranscriptionState | null>(null)
    const [transcriptionStateLoading, setTranscriptionStateLoading] = useState(false)
    const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
    const requestRef = useRef(0)
    const loadTranscriptionState = useCallback(async () => {
        const request = ++requestRef.current
        setTranscriptionStateLoading(true)
        try {
            const result = await window.devscope.assistant.getVoiceTranscriptionState()
            if (request !== requestRef.current) return
            if (!result.success) throw new Error(result.error || 'Could not read ChatGPT transcription status.')
            setTranscriptionState(result.state)
            setTranscriptionError(null)
        } catch (error) {
            if (request === requestRef.current) setTranscriptionError(error instanceof Error ? error.message : 'Could not read ChatGPT transcription status.')
        } finally {
            if (request === requestRef.current) setTranscriptionStateLoading(false)
        }
    }, [])
    useEffect(() => {
        if (settings.assistantTranscriptionEnabled && settings.assistantTranscriptionEngine === 'codex') void loadTranscriptionState()
        else setTranscriptionStateLoading(false)
        return () => { requestRef.current += 1 }
    }, [loadTranscriptionState, settings.assistantTranscriptionEnabled, settings.assistantTranscriptionEngine])

    const browserSpeechAvailable = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    const chatGptVoiceStatus: { label: string; tone: 'ready' | 'warning' | 'muted'; title?: string } = transcriptionStateLoading
        ? { label: 'Checking', tone: 'muted' }
        : transcriptionError ? { label: 'Unavailable', tone: 'warning', title: transcriptionError }
            : transcriptionState?.status === 'ready' ? { label: 'Ready', tone: 'ready', title: transcriptionState.message || undefined }
                : transcriptionState?.status === 'signed-out' ? { label: 'Connect account', tone: 'warning', title: transcriptionState.message || undefined }
                    : transcriptionState?.status === 'unavailable' ? { label: 'Unavailable', tone: 'warning', title: transcriptionState.message || undefined }
                        : { label: 'Not checked', tone: 'muted' }
    return <SettingsSection title="Voice transcription">
        <SettingsRow title="Voice input" description="Dictate messages or record voice notes in chat." control={<SettingsSwitch checked={settings.assistantTranscriptionEnabled} onCheckedChange={(assistantTranscriptionEnabled) => updateSettings({ assistantTranscriptionEnabled })} label="Enable voice input" />} />
        <SettingsRow title="Transcription engine" description="Choose live browser dictation or recorded ChatGPT transcription." control={<SettingsSegmented value={settings.assistantTranscriptionEngine} options={[{ value: 'browser', label: 'Browser' }, { value: 'codex', label: 'ChatGPT' }]} onChange={(assistantTranscriptionEngine) => updateSettings({ assistantTranscriptionEngine })} label="Transcription engine" disabled={!settings.assistantTranscriptionEnabled} />} />
        <SettingsRow
            title="ChatGPT transcription"
            description="Transcribe voice notes with your connected ChatGPT account."
            icon={<SettingsProviderIcon provider="chatgpt" />}
            status={chatGptVoiceStatus.label}
            statusTone={chatGptVoiceStatus.tone}
            statusTitle={chatGptVoiceStatus.title}
            control={<SettingsButton variant="ghost" onClick={() => void loadTranscriptionState()} disabled={!settings.assistantTranscriptionEnabled || settings.assistantTranscriptionEngine !== 'codex' || transcriptionStateLoading}><RefreshCw size={12} className={transcriptionStateLoading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh status</SettingsButton>}
        />
        <SettingsRow
            title="Browser dictation"
            description="Use live speech recognition when your browser supports it."
            status={browserSpeechAvailable ? 'Available' : 'Unavailable'}
            statusTone={browserSpeechAvailable ? 'ready' : 'warning'}
        />
    </SettingsSection>
}
