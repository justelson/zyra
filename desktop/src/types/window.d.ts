import type { DevScopeApi } from '../shared/contracts/devscope-api'
import type { DesktopAnalyticsApi } from '../shared/analytics/contracts'
import type { ResponseTimingApi } from '../shared/response-timing'

declare global {
    interface Window {
        devscope: DevScopeApi
        zyraAnalytics?: DesktopAnalyticsApi
        zyraDiagnostics?: ResponseTimingApi
    }
}

export {}
