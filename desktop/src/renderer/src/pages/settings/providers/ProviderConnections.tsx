import { useEffect, useRef } from 'react'
import { useOpenAIAccountSettings } from './useOpenAIAccountSettings'
import { ModelProviderConnections } from '../ModelProviderConnections'
import { SettingsPageLink } from '../SettingsPageTabs'
import { SettingsNotice, SettingsSection } from '../settings-layout'
import { OpenAIConnectionNotices, OpenAIConnectionRows } from './OpenAIConnectionRows'
import { ChatGptConnectionRows } from './ChatGptConnectionRows'
import { useChatGptAccountPool } from './useChatGptAccountPool'

export default function ProviderConnections() {
    const connection = useOpenAIAccountSettings({ connectionsActive: true })
    const pool = useChatGptAccountPool({ usageActive: false })
    const returnToProviderOptions = useRef<(() => void) | null>(null)
    useEffect(() => {
        if (!connection.apiKeyDialogOpen) returnToProviderOptions.current = null
    }, [connection.apiKeyDialogOpen])

    return <>
        <ModelProviderConnections onRefresh={async () => { await connection.refreshAll(); await pool.refresh() }} refreshDisabled={connection.connectionBusy}
            notices={<><OpenAIConnectionNotices connection={connection} />{pool.error ? <SettingsNotice tone="error">{pool.error}</SettingsNotice> : null}</>}
            chatGptConfigured={connection.chatGptConnection?.configured === true}
            openAiConfigured={connection.apiKeyConnection?.configured === true}
            onAddChatGpt={async method => { await connection.connectChatGpt(method); await pool.refresh() }}
            onAddOpenAiKey={onBackToProviders => {
                returnToProviderOptions.current = onBackToProviders
                connection.setApiKeyDialogOpen(true)
            }}>
            <ChatGptConnectionRows connection={connection} pool={pool} />
            <OpenAIConnectionRows showNotices={false} showChatGpt={!pool.snapshot} connection={connection} onBackToProviders={() => {
                const returnToProviders = returnToProviderOptions.current
                returnToProviderOptions.current = null
                returnToProviders?.()
            }} />
        </ModelProviderConnections>
        <SettingsSection title="Other uses">
            <SettingsPageLink to="/settings/providers/writing" title="Git writing services" description="Manage Groq and Gemini keys used for commits and pull requests." />
        </SettingsSection>
    </>
}
