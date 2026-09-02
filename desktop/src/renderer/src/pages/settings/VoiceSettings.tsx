import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { INSTRUCTOR_REALTIME_VOICES } from '@shared/assistant/contracts'
import {
    readInstructorVoicePreferences,
    writeInstructorVoicePreferences,
    type InstructorVoicePreferences
} from '../assistant/instructor-voice-preferences'
import {
    SettingsButton,
    SettingsDialog,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSelect,
    SettingsTextarea
} from './settings-layout'

export default function VoiceSettings() {
    const navigate = useNavigate()
    const [preferences, setPreferences] = useState<InstructorVoicePreferences>(() => readInstructorVoicePreferences())
    const [instructionsOpen, setInstructionsOpen] = useState(false)
    const [instructionsDraft, setInstructionsDraft] = useState(preferences.instructions)

    const updatePreferences = (patch: Partial<InstructorVoicePreferences>) => {
        const next = { ...preferences, ...patch }
        setPreferences(next)
        writeInstructorVoicePreferences(next)
    }

    return (
        <SettingsPageContainer title="Voice" backTo="/settings/assistant" backLabel="Assistant">
            <SettingsSection title="Instructor Voice Lab" headerAction={<SettingsButton variant="ghost" onClick={() => navigate('/assistant/instructor')}>Open Voice Lab</SettingsButton>}>
                <SettingsRow
                    title="Voice"
                    description="Choose the realtime voice used by new Voice Lab sessions."
                    control={
                        <SettingsSelect value={preferences.voice} onChange={(event) => updatePreferences({ voice: event.target.value as InstructorVoicePreferences['voice'] })} aria-label="Instructor voice">
                            {INSTRUCTOR_REALTIME_VOICES.map((voice) => <option key={voice} value={voice}>{voice.charAt(0).toUpperCase() + voice.slice(1)}</option>)}
                        </SettingsSelect>
                    }
                />
                <SettingsRow title="Output" description="Play spoken responses or keep the session text-only." control={<SettingsSegmented value={preferences.outputModality} options={[{ value: 'audio', label: 'Audio' }, { value: 'text', label: 'Text' }]} onChange={(outputModality) => updatePreferences({ outputModality })} label="Voice Lab output" />} />
                <SettingsRow
                    title="Instructions"
                    description="Set the standing guidance for new Voice Lab sessions. Existing sessions keep their current instructions."
                    status={preferences.instructions.trim() ? 'Custom guidance saved' : 'No standing guidance'}
                    statusTone={preferences.instructions.trim() ? 'ready' : 'muted'}
                    control={<SettingsButton onClick={() => { setInstructionsDraft(preferences.instructions); setInstructionsOpen(true) }}>Edit</SettingsButton>}
                />
            </SettingsSection>

            <SettingsDialog
                open={instructionsOpen}
                title="Edit Voice Lab instructions"
                description="These instructions apply when a new Voice Lab session starts."
                onClose={() => setInstructionsOpen(false)}
                footer={(
                    <>
                        <SettingsButton variant="ghost" onClick={() => setInstructionsOpen(false)}>Cancel</SettingsButton>
                        <SettingsButton variant="accent" onClick={() => { updatePreferences({ instructions: instructionsDraft }); setInstructionsOpen(false) }}>Save instructions</SettingsButton>
                    </>
                )}
            >
                <SettingsTextarea autoFocus value={instructionsDraft} maxLength={8000} rows={9} onChange={(event) => setInstructionsDraft(event.target.value)} placeholder="Describe how the instructor should respond." aria-label="Voice Lab instructions" />
                <div className="text-right text-[10px] tabular-nums text-[var(--settings-text-muted)]">{instructionsDraft.length.toLocaleString()} / 8,000</div>
            </SettingsDialog>
        </SettingsPageContainer>
    )
}
