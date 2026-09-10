export function getSettingsSearchKeyAction(key: string, count: number, currentIndex: number, fromInput: boolean) {
    if (key === 'Escape') return { type: 'clear' as const }
    if (count < 1) return null
    if (key === 'Enter' && fromInput) return { type: 'activate' as const, index: 0 }
    if (key === 'ArrowDown') return { type: 'focus' as const, index: (currentIndex + 1) % count }
    if (key === 'ArrowUp') return { type: 'focus' as const, index: currentIndex <= 0 ? count - 1 : currentIndex - 1 }
    if (!fromInput && key === 'Home') return { type: 'focus' as const, index: 0 }
    if (!fromInput && key === 'End') return { type: 'focus' as const, index: count - 1 }
    return null
}
