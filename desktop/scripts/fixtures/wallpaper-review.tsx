import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ChatWallpaperSettings } from '@/pages/settings/appearance/ChatWallpaperSettings'
import { UiPartsInspector, openUiPartsInspector } from '@/components/ui-parts/UiPartsInspector'
import { AssistantConversationTimelinePane } from '@/pages/assistant/AssistantConversationTimelinePane'
import { AgentAppOperations } from '@/components/layout/AgentAppOperations'
import { NO_CHAT_WALLPAPER } from '@shared/chat-wallpaper'

const w=window as any,root=createRoot(document.getElementById('root')!),pause=(ms:number)=>new Promise(r=>setTimeout(r,ms))
let handler:any, resolveReply:any
w.reviewSettings={appearanceUiParts:{version:1,overrides:{}},appearanceChatWallpaper:NO_CHAT_WALLPAPER}
w.zyraAppOperations={onRequest:(fn:any)=>{handler=fn;return ()=>{}},respond:(message:any)=>resolveReply(message)}
const messages=['Could you check the framing?','The flowers stay visible behind the messages.','Keep the header and input unchanged.'].map((text,i)=>({id:`m${i}`,role:i%2?'assistant':'user',text,turnId:`t${Math.floor(i/2)}`,createdAt:`2026-01-01T10:00:0${i}Z`,updatedAt:`2026-01-01T10:00:0${i}Z`,streaming:false}))
function render(view:string){flushSync(()=>root.render(<MemoryRouter><AgentAppOperations/>{view==='chat'?<div className="flex h-screen flex-col"><header className="border-b border-[var(--surface-divider)] p-4">Wallpaper review</header><AssistantConversationTimelinePane {...{messages,activities:[],userInputs:[],windowKey:'review',threadId:'review',sessionMode:'work',timelineContentRef:createRef(),timelineScrollRef:createRef(),onScrollTimeline:()=>{},assistantChatDisplayMode:'detailed',assistantTextStreamingMode:'immediate',onScrollToBottom:()=>{}} as any}/><footer className="border-t border-[var(--surface-divider)] p-4 text-sparkle-text-secondary">Message</footer></div>:<main className="mx-auto max-w-[58rem] p-4 sm:p-8"><div className="mb-5 text-sm text-sparkle-text-secondary">Appearance / Layout</div><ChatWallpaperSettings/></main>}<UiPartsInspector/></MemoryRouter>))}
w.reviewImport=async(input:any)=>{render('settings');await pause(100);const reply=new Promise<any>(r=>{resolveReply=r});handler({requestId:'review',request:{domain:'settings_action',operation:'run',params:{area:'appearance.import_chat_wallpaper',input},actor:{canonicalChatId:'fixture',namespaceId:'private-review',approved:true,child:false}}});const {result,error}=await reply;if(error||!result?.asset)throw Error(error||'No imported asset');w.reviewSettings={...w.reviewSettings,appearanceChatWallpaper:{...NO_CHAT_WALLPAPER,asset:result.asset}};return result.asset}
w.reviewView=async(view:string)=>{document.querySelector<HTMLButtonElement>('[data-ui-inspector] header button')?.click();render(view);await pause(400);if(view==='inspector'){openUiPartsInspector();await pause(120)} if(view==='chat'){for(let i=0;i<60&&!document.querySelector('[data-zyra-part="chat.assistantMessage"]');i++)await pause(80);if(!document.querySelector('[data-chat-wallpaper] [data-zyra-part="chat.assistantMessage"]'))throw Error('Populated production pane did not paint')}else if(!document.querySelector<HTMLElement>('[aria-label="Wallpaper framing preview"]')?.style.backgroundImage)throw Error('Wallpaper preview missing');if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Horizontal overflow')}
