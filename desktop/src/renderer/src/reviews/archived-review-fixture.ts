import type { AssistantSession } from '@shared/assistant/contracts'
import { createDefaultAssistantSnapshot } from '@shared/assistant/projector'
import { assistantStore } from '@/lib/assistant/store'
import { installProvidersReviewFixture } from './providers-review-fixture'

// Isolated, volatile sample chats. No connection to desktop history or providers.
export async function installArchivedReviewFixture() {
    installProvidersReviewFixture()
    const scenario = new URLSearchParams(location.search).get('scenario') || 'populated'
    const titles = ['Polish the plugin settings', 'Fix startup model selection', 'Weekend reading list', 'Review project permissions', 'Improve file previews', 'Plan a small landing page']
    let sessions: AssistantSession[] = scenario === 'empty' ? [] : Array.from({length:17}, (_, index) => ({
        id:`sample-chat-${index}`, title:index < titles.length ? titles[index] : `Saved conversation ${index + 1}`,
        mode:'work', projectPath:index % 3 === 2 ? null : index % 2 ? 'C:/work/samples/website' : 'C:/work/samples/zyra',
        playgroundLabId:null, pendingLabRequest:null, archived:true, activeThreadId:null, threadIds:[], threads:[],
        createdAt:new Date(Date.now() - (index + 1) * 3600000).toISOString(), updatedAt:new Date(Date.now() - (index + 1) * 3600000).toISOString()
    }))
    let selectedSessionId: string | null = null
    const snapshot = () => ({...createDefaultAssistantSnapshot(), sessions:structuredClone(sessions), selectedSessionId})
    const status = () => ({available:true, connected:false, state:'disconnected', selectedSessionId, activeThreadId:null, reason:null})
    Object.assign(window.devscope.assistant, {
        bootstrap:async () => ({snapshot:snapshot(), status:status()}), getSnapshot:async () => snapshot(), getStatus:async () => status(),
        archiveSession:async (id:string, archived:boolean) => {
            if (scenario === 'error') return {success:false, error:'Sample restore failed. Your chat stays archived.'}
            await new Promise(resolve => setTimeout(resolve, 350))
            sessions = sessions.map(session => session.id === id ? {...session, archived} : session)
            await assistantStore.hydrate()
            return {success:true}
        },
        deleteSession:async (id:string) => { sessions = sessions.filter(session => session.id !== id); await assistantStore.hydrate(); return {success:true} },
        selectSession:async (id:string) => { selectedSessionId=id; return {success:true, sessionId:id, snapshot:snapshot(), status:status()} }
    })
    await assistantStore.hydrate()
}
