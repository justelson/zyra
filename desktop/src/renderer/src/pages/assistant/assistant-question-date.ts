export function questionCalendarDate(year: number, month: number, day: number): Date {
    const date = new Date(0)
    date.setHours(12, 0, 0, 0)
    date.setFullYear(year, month, day)
    return date
}

export function formatQuestionDate(date: Date): string {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseQuestionDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const [, year, month, day] = match.map(Number)
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null
    const date = questionCalendarDate(year, month - 1, day)
    return formatQuestionDate(date) === value ? date : null
}

export function shiftQuestionMonth(date: Date, months: number): Date {
    const first = questionCalendarDate(date.getFullYear(), date.getMonth() + months, 1)
    const lastDay = questionCalendarDate(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    return questionCalendarDate(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), lastDay))
}

export function questionCalendarDays(month: Date): Date[] {
    const first = questionCalendarDate(month.getFullYear(), month.getMonth(), 1)
    return Array.from({ length: 42 }, (_, index) => questionCalendarDate(first.getFullYear(), first.getMonth(), index - first.getDay() + 1))
}
