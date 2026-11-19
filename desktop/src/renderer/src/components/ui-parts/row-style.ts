import { validateUiPartConfig } from '@shared/ui-parts'

// Only these owned selectors and validated literals can reach the stylesheet.
export function rowStyle(input: unknown, reduceMotion: boolean): string {
    let overrides
    try { overrides = validateUiPartConfig(input).overrides } catch { return '' }
    const rules: string[] = []
    for (const [id, values] of Object.entries(overrides)) {
        if (id === 'sidebar.chatRow') continue
        const selector = `[data-zyra-part="${id}"]`
        if (values.background) rules.push(`${selector} { background-color:${values.background} !important }`)
        if (values.radius !== undefined) rules.push(`${selector} { border-radius:${values.radius}px !important }`)
    }
    const row = overrides['sidebar.chatRow']
    if (!row) return rules.join('\n')
    const sel = '[data-zyra-part="sidebar.chatRow"]'
    if (row.radius !== undefined) rules.push(`${sel} { border-radius:${row.radius}px }`)
    if (row.background) rules.push(`${sel}:not(:hover):not([data-zyra-state~="selected"]) { background-color:${row.background} }`)
    if (row.motion !== undefined && !reduceMotion) rules.push(`@media (prefers-reduced-motion:no-preference) { ${sel} { transition:background-color ${row.motion}ms, border-radius ${row.motion}ms } }`)
    if (row.density) {
        const compact = row.density === 'compact'
        rules.push(`${sel}[data-row-layout="card"] > div:first-child { height:${compact ? 4.25 : 5.5}rem; padding-block:${compact ? .2 : .75}rem }`, `${sel}:not([data-row-layout="card"]) { height:${compact ? 1.65 : 2.65}rem }`)
    }
    return rules.join('\n')
}
