import { randomUUID } from 'node:crypto'
import { session, type Session, type WebContents } from 'electron'

export const ZYRA_BROWSER_GLOBAL_PARTITION = 'persist:zyra-accessory-native-test'
let globalSession: Session | null = null

export function getGlobalBrowserSession(): Session {
    globalSession ||= session.fromPartition(ZYRA_BROWSER_GLOBAL_PARTITION)
    return globalSession
}

export function createIncognitoBrowserSession(): Session {
    return session.fromPartition(`zyra-accessory-native-private-${randomUUID()}`, { cache: false })
}

export async function disposeIncognitoBrowserSession(browserSession: Session): Promise<void> {
    await browserSession.clearStorageData()
    await browserSession.clearCache()
}

export function isSafeBrowserNavigationUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    } catch {
        return false
    }
}

export function registerBrowserPermissionTarget(_guest: WebContents, _owner: WebContents): void {}
export function transferBrowserPermissionTargetOwner(_guest: WebContents, _owner: WebContents): void {}
export function scheduleGlobalBrowserProfileFlush(): void {}

export async function recordGlobalBrowserHistory(_entry: unknown): Promise<void> {}
