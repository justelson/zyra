export const SPEAKING_STYLES = [
    { value: 'concise', label: 'Concise' },
    { value: 'friendly', label: 'Friendly' },
    { value: 'direct', label: 'Direct' },
    { value: 'thoughtful', label: 'Thoughtful' },
    { value: 'playful', label: 'Playful' }
] as const
export type SpeakingStyle = typeof SPEAKING_STYLES[number]['value']
export function normalizeSpeakingStyle(value: unknown): SpeakingStyle {
    return SPEAKING_STYLES.some(style => style.value === value) ? value as SpeakingStyle : 'concise'
}
