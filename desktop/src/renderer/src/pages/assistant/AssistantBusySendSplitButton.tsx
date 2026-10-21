import { memo, useCallback } from 'react'
import { ListEnd, Zap } from 'lucide-react'
import { ConnectedDropdownButton, type ConnectedDropdownButtonOption } from '@/components/ui/ConnectedDropdownButton'

const BUSY_SEND_OPTIONS: ConnectedDropdownButtonOption[] = [
    {
        id: 'queue',
        label: 'Send next',
        icon: <ListEnd size={13} strokeWidth={2.2} />,
        tone: 'sky'
    },
    {
        id: 'steer',
        label: 'Steer',
        icon: <Zap size={13} strokeWidth={2.5} />,
        tone: 'amber'
    }
]

type BusySendMode = 'queue' | 'steer'

export const AssistantBusySendSplitButton = memo(function AssistantBusySendSplitButton(props: {
    defaultMode: BusySendMode
    disabled?: boolean
    queuedCount?: number
    onQueue: () => Promise<void> | void
    onForce: () => Promise<void> | void
}) {
    const { defaultMode, disabled = false, queuedCount = 0, onQueue, onForce } = props

    const runAction = useCallback((value: string) => {
        if (disabled) return
        const mode: BusySendMode = value === 'steer' ? 'steer' : 'queue'
        void (mode === 'queue' ? onQueue() : onForce())
    }, [disabled, onForce, onQueue])

    return (
        <div className="w-[clamp(120px,26cqi,136px)] shrink-0">
            <ConnectedDropdownButton
                value={defaultMode}
                options={BUSY_SEND_OPTIONS}
                onChange={runAction}
                onPrimaryAction={runAction}
                primarySuffix={queuedCount > 0 ? <span className="text-[10px] font-semibold tabular-nums opacity-70" title={`${queuedCount} queued`}>{queuedCount}</span> : null}
                disabled={disabled}
                className="max-w-none"
                menuLabel="Send next or steer the current turn"
                direction="up"
                shape="pill"
                size="composer"
            />
        </div>
    )
})
