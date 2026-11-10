import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import FilePreviewModal from '../../src/renderer/src/components/ui/FilePreviewModal'
import { AssistantPreviewResourceNavigator } from '../../src/renderer/src/pages/assistant/AssistantPreviewResourceNavigator'
import { buildAssistantChatResourceTurns, buildAssistantPreviewResources } from '../../src/renderer/src/pages/assistant/assistant-chat-resources'
import { TimelineIssueList } from '../../src/renderer/src/pages/assistant/AssistantTimelineIssueList'
import { AssistantTimelineNetworkRecovery } from '../../src/renderer/src/pages/assistant/AssistantTimelineNetworkRecovery'
import { TimelineTurnWorkSummary } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { resolveThemeTokens } from '../../src/renderer/src/lib/settings-theme-semantics'
import { getThemeDefinition } from '../../src/renderer/src/lib/settings-theme-catalog'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const noop = () => {}
const api: any = { prepareNativeOverlay: undefined, setNativeOverlayVisible: undefined, window: { getRuntimeInfo: async () => ({ platform: 'win32' }), onFullScreenChange: () => noop, isMaximized: async () => false, onMaximizedChange: () => noop }, assistant: { resolveClipboardAttachment: async () => ({success:false}) }, getFileTree: async () => ({success:true,tree:[]}), getFileMetadata: async () => ({success:true}), getFileSystemCapabilities: async () => ({success:true}), getTheme: async () => ({success:true}) }
;(window as any).devscope = new Proxy(api, {get(target,key){ if(key in target) return target[key]; if (/^on/.test(String(key))) return () => noop; return async () => ({success:true}) }})
const root=createRoot(document.getElementById('root')!)
const check=(value:unknown,label:string)=>{if(!value)throw Error(label)}
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,100))})
const at='2026-11-09T12:00:00Z'
const messages:any[]=[{id:'u',role:'user',text:'Show the previews',turnId:'turn',streaming:false,createdAt:at,updatedAt:at},{id:'p',role:'assistant',text:'![First](<C:/fixture/one.png>) ![Second](<C:/fixture/two.png>)',turnId:'turn',streaming:false,createdAt:at,updatedAt:at},{id:'f',role:'assistant',text:'Done. [Again](<c:/fixture/one.png>)',turnId:'turn',streaming:false,createdAt:at,updatedAt:at}]
const turns=buildAssistantChatResourceTurns({messages,activities:[],projectPath:'C:/fixture'})
const error:any={id:'retry-error',turnId:'turn',kind:'runtime.retry-error',summary:'Errored out',detail:'A temporary model error interrupted the response.',tone:'error',createdAt:at,payload:{category:'retry-error',status:'failed'}}
function Recovery({status='retrying',network=false}:{status?:string;network?:boolean}) {
 const activity:any={id:'recovery',turnId:'turn',kind:network?'connection.recovery':'provider.recovery',summary:status==='retrying'?(network?'Reconnecting 1 of 3':'Retrying 1 of 3'):'Retry succeeded',tone:'tool',createdAt:at,payload:{category:'connection-recovery',status,recoveryKind:network?'network':'provider'}}
 return <main style={{maxWidth:820,margin:'90px auto'}}><TimelineTurnWorkSummary startedAt={new Date(Date.now()-45000).toISOString()} completedAt={null} running actionCount={2} renderChildren={()=><div className="space-y-2"><p className="text-sm text-sparkle-text-secondary">Checking the generated previews.</p><TimelineIssueList activities={[error]}/><AssistantTimelineNetworkRecovery activity={activity}/><p className="text-sm text-sparkle-text-secondary">{status==='recovered'?'Continuing with the next action.':''}</p></div>}/></main>
}
function Viewer({single=false,missing=false}:{single?:boolean;missing?:boolean}) {
 const [path,setPath]=useState('C:/fixture/one.png')
 const file={name:path.split('/').at(-1)!,path,type:'image' as const}
 const resources=buildAssistantPreviewResources({turns:missing?[]:single?turns.filter(t=>!t.response.includes('two.png')).concat([{...turns[0],prompt:'',promptAttachments:[],response:'![First](<C:/fixture/one.png>)',changes:[],files:[]}]):turns,projectPath:'C:/fixture',activeFile:file})
 return <FilePreviewModal file={file} content="" chromeContext="peek" initialPresentation={{expanded:false,mode:'preview'}} navigationSidebarInitiallyOpen={resources.length>1} navigationSidebar={<AssistantPreviewResourceNavigator turns={turns} resources={resources} projectPath="C:/fixture" activeFilePath={path} onOpenPreview={async f=>setPath(f.path)} onOpenUrl={noop}/>} onClose={noop}/>
}
async function preview(view:string) {
 const tokens=resolveThemeTokens(getThemeDefinition('vercel').tokens);for(const [key,value] of Object.entries(tokens))document.documentElement.style.setProperty('--color-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),String(value))
 await act(async()=>root.render(view==='retrying'||view==='recovered'||view==='network'?<Recovery status={view==='recovered'?'recovered':'retrying'} network={view==='network'}/>:<Viewer key={view} single={view==='single'} missing={view==='missing'}/>));await flush()
}
;(window as any).resourceRecoveryReview={preview,async run(){
 await preview('multi');check(document.querySelectorAll('[aria-label="Chat resources"] button[role="listitem"], [aria-label="Chat resources"] button[role="row"]').length===2,'repeated paths must show two unique resources, not three');check(!document.body.textContent?.includes('No chat resources'),'an opened image cannot have an empty sidebar');
 await preview('single');check(document.querySelector('[aria-label="Show file navigator"]'),'single-image sidebar starts collapsed');await act(async()=>(document.querySelector('[aria-label="Show file navigator"]') as HTMLElement)?.click());await flush();check(document.querySelector('[aria-label="Hide file navigator"]'),'the collapsed sidebar remains available');
 await preview('missing');await act(async()=>(document.querySelector('[aria-label="Show file navigator"]') as HTMLElement)?.click());await flush();check(!document.body.textContent?.includes('No chat resources'),'unloaded history retains current image');
 await preview('retrying');check(document.body.textContent?.includes('Errored out')&&document.body.textContent?.includes('Retrying 1 of 3'),'error row precedes retry status');const work=document.querySelector('[aria-expanded="true"]');await preview('recovered');check(document.body.textContent?.includes('Retry succeeded'),'retry success updates in place');check(work===document.querySelector('[aria-expanded="true"]'),'recovery retains the working disclosure');
 await preview('network');check(document.body.textContent?.includes('Reconnecting 1 of 3'),'only a connection retry says Reconnecting');
 console.log('PASS: actual preview modal, resource deduplication, single/unknown images, recovery rows and retained disclosure')
}}
