import type { ComponentProps } from 'react'
import { SettingsRow } from '../settings-layout'

// One layout for subscriptions, API keys and custom provider connections.
export function ProviderConnectionRow({ className, status, statusTone, ...props }: ComponentProps<typeof SettingsRow>) {
    const visibleStatus = status === 'Connected' && statusTone === 'ready' ? undefined : status
    return <SettingsRow {...props} layout="connection" status={visibleStatus} statusTone={statusTone} className={className} />
}
