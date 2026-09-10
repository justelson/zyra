import type { ReactNode } from 'react'
import { SettingsInfoTooltip } from './SettingsInfoTooltip'

export type SettingsKeyValueItem = {
    id: string
    label: string
    value: ReactNode
    info?: ReactNode
    searchTargetId?: string
}

export function SettingsKeyValueList({ label, items }: { label: string; items: SettingsKeyValueItem[] }) {
    return <dl aria-label={label} className="divide-y divide-[var(--settings-row-divider)] px-4">
        {items.map(item => <div key={item.id}
            data-settings-search-target={item.searchTargetId}
            tabIndex={item.searchTargetId ? -1 : undefined}
            className="grid min-h-10 grid-cols-[minmax(7rem,0.4fr)_minmax(0,0.6fr)] items-center gap-4 py-2 text-[12px]">
            <dt className="flex min-w-0 items-center gap-1 text-[var(--settings-text-secondary)]">{item.label}{item.info ? <SettingsInfoTooltip label={`About ${item.label}`}>{item.info}</SettingsInfoTooltip> : null}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-[var(--settings-text)]">{item.value}</dd>
        </div>)}
    </dl>
}
