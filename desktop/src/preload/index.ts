/**
 * Zyra - Preload Entry
 */

import { contextBridge } from 'electron'
import { installKeybindingBridge } from './keybindings'
import { installAgentAppBridge } from './agent-app-operations'
import { createDevScopeElectronAdapter } from './devscope-electron-adapter'
import { installBrowserDevscopeRelay } from './browser-devscope-relay'
import { installRendererDiagnostics } from './renderer-diagnostics'
import { installBrowserPopupPreload } from './browser-popup'
import { BROWSER_POPUP_PRELOAD_ARGUMENT, BROWSER_RECORDING_OVERLAY_PRELOAD_ARGUMENT } from '../shared/preload-surfaces'
import { installBrowserRecordingOverlayPreload } from './browser-recording-overlay'
import { installDesktopAnalytics } from './analytics'

if (process.argv.includes(BROWSER_RECORDING_OVERLAY_PRELOAD_ARGUMENT)) {
    installBrowserRecordingOverlayPreload()
} else if (process.argv.includes(BROWSER_POPUP_PRELOAD_ARGUMENT)) {
    installBrowserPopupPreload()
} else {
    installRendererDiagnostics()
    installDesktopAnalytics()
    const devscope = createDevScopeElectronAdapter()
    installBrowserDevscopeRelay(devscope)

    installKeybindingBridge()
    installAgentAppBridge()
    contextBridge.exposeInMainWorld('devscope', devscope)
}
