export function formatAudioTime(seconds: number): string {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
    const minutes = Math.floor(total / 60)
    const remainder = String(total % 60).padStart(2, '0')
    if (minutes < 60) return `${minutes}:${remainder}`
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
}
