import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { InstructorVoiceLiveTranscript } from './InstructorVoiceLiveTranscript'
import { InstructorVoiceOrb } from './InstructorVoiceOrb'
import type { InstructorVoicePreferences } from './instructor-voice-preferences'
import type { useInstructorVoiceSession } from './useInstructorVoiceSession'
import { latestStreamingVoiceTranscript } from './instructor-voice-transcript'
import './AssistantCanonicalVoiceStage.css'

type VoiceSession = ReturnType<typeof useInstructorVoiceSession>

export function AssistantCanonicalVoiceStage({
    voice,
    preferences
}: {
    voice: VoiceSession
    preferences: InstructorVoicePreferences
}) {
    const latestTranscript = useMemo(
        () => latestStreamingVoiceTranscript(voice.transcript),
        [voice.transcript]
    )
    const connecting = voice.status === 'requesting-microphone' || voice.status === 'connecting'

    return (
        <div
            className={cn(
                'assistant-canonical-voice-stage',
                connecting && 'is-connecting',
                voice.status === 'active' && 'is-active'
            )}
        >
            <InstructorVoiceOrb
                voice={preferences.voice}
                status={voice.status}
                activityLevel={voice.activityLevel}
                compact={connecting}
                animateLayout
            />
            <div className="assistant-canonical-voice-stage-transcript">
                <InstructorVoiceLiveTranscript
                    entry={latestTranscript}
                    error={voice.error}
                />
            </div>
        </div>
    )
}
