import { useNavigate, useSearchParams } from 'react-router-dom'
import { PluginStore } from '@/pages/plugins/PluginStore'
import { PluginProductPage } from '@/pages/plugins/PluginProductPage'
import { usePluginDirectory } from '@/pages/plugins/usePluginDirectory'
import store from '@shared/plugins/openai-directory.json'

export function PluginStoreReview() {
    const navigate = useNavigate()
    const [params, setParams] = useSearchParams()
    const directory = usePluginDirectory(true, null)
    const open = (id: string) => navigate(`/settings/assistant/plugins?plugin=${encodeURIComponent(id)}`)
    const use = (id: string) => void directory.useInNewChat(id, sessionId => navigate(`/assistant?session=${sessionId}`))
    const name = params.get('name')
    const installation = directory.catalog?.plugins.find(plugin => plugin.name === name) || null
    return <div className="plugin-directory"><div className="plugin-directory-column">
        {name ? <PluginProductPage entry={store.entries.find(entry => entry.name === name) || null} installation={installation} catalog={directory.catalog} busy={directory.busy} canInstall={false} onBack={() => setParams({})} onInstall={() => {}} onManage={open} onUseInChat={use} />
            : <PluginStore canInstall={false} busy={directory.busy} installedCatalog={directory.catalog} loading={directory.loading} onManage={() => navigate('/settings/assistant/plugins')} onSelectInstalled={open} onUseInChat={use} onOpenEntry={name => setParams({ name })} onImportFolder={() => {}} />}
    </div></div>
}
