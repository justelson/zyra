import { useEffect, useState } from 'react'
import type { ControlStateSnapshot } from '@shared/agent-control/contracts'
import { clearRetiredAssistantPermissionPreferences } from './assistant-control-approval-preferences'

export function useAgentControlState(enabled = true): ControlStateSnapshot | null {
    const [state, setState] = useState<ControlStateSnapshot | null>(null)

    useEffect(() => clearRetiredAssistantPermissionPreferences(), [])

    useEffect(() => {
        if (!enabled) {
            setState(null)
            return
        }
        let active = true
        const unsubscribe = window.devscope.agentControl.onStateChange((next) => {
            if (active) setState(next)
        })
        void window.devscope.agentControl.getState().then((result) => {
            if (active && result.success) setState(result.state)
        }).catch(() => undefined)
        return () => {
            active = false
            unsubscribe()
        }
    }, [enabled])

    return state
}
