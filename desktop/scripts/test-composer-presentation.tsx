import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config.js'
import { resolveMaterialFileIconAsset } from '../src/renderer/src/components/ui/file-preview/materialFileIconTheme'

const directory = await mkdtemp(join(tmpdir(), 'zyra-composer-presentation-'))
const source = (path: string) => JSON.stringify(resolve(import.meta.dir, '../src/renderer/src', path))
const harness = `
import React,{act,useState,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {AssistantComposerView} from ${source('pages/assistant/AssistantComposerView.tsx')}
import {AssistantNewChatGreeting} from ${source('pages/assistant/AssistantNewChatGreeting.tsx')}
import {AssistantComposerFileMenu} from ${source('pages/assistant/AssistantComposerFileMenu.tsx')}
import {AssistantComposerCommandMenu} from ${source('pages/assistant/AssistantComposerCommandMenu.tsx')}
import {ComposerMentionMenu} from ${source('pages/assistant/AssistantComposerSections.tsx')}
import {ComposerTextInput} from ${source('pages/assistant/ComposerTextInput.tsx')}
import {CollapsibleUserMessageBody} from ${source('pages/assistant/AssistantTimelineText.tsx')}
import MarkdownRenderer from ${source('components/ui/MarkdownRenderer.tsx')}
import {useAssistantTimelineEntries} from ${source('pages/assistant/useAssistantTimelineEntries.ts')}
import {setComposerSelection,composerSelection} from ${source('pages/assistant/composer-rich-text.ts')}
import {reconcileInlineMentionTags} from ${source('pages/assistant/assistant-composer-inline-mentions.tsx')}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const check=(value,message)=>{if(!value)throw Error(message)}
const noop=()=>{}, removed=[], opened=[]
const data='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#243747"/><circle cx="150" cy="70" r="35" fill="#77b7db"/><text x="150" y="130" text-anchor="middle" fill="white" font-family="sans-serif" font-size="15">Image attachment</text></svg>')
const image={id:'image',path:'clipboard://test.png',name:'Screenshot.png',kind:'image',mimeType:'image/png',previewDataUrl:data,source:'paste',sizeBytes:200}
window.devscope={assistant:{listPromptResources:async()=>({success:true,commands:[],skills:[],diagnostics:[]})}}
const refs=Object.fromEntries(['composerRootRef','textareaRef','filePickerRef','mentionListRef','mentionMenuRef','modelDropdownRef','modelListRef','traitsDropdownRef'].map(key=>[key,{current:null}]))
function Composer({placement='center'}){
 const [files,setFiles]=useState([image]),[preview,setPreview]=useState(null)
 const [text,setText]=useState('')
 window.fixtureDraft={setText,setFiles}
 const controller={...refs,placement,contextFiles:files,previewAttachment:preview,text,composerCursor:text.length,projectRoots:[],queuedMessages:[],removingAttachmentIds:[],inlineMentionTags:[],mentionCandidates:[],filteredModelOptions:[],projectChoices:[],
 capabilities:{canSend:true,composerAvailable:true,canStop:false,showBusySendActions:false},voiceInput:{isStarting:false,isRecording:false,isTranscribing:false,isSupported:false,stopBrowserOnInput:noop},
 submitLabel:'Send',isConnected:true,selectedModel:'gpt-5',selectedModelLabel:'GPT-5',selectedEffort:'medium',selectedInteractionMode:'default',selectedRuntimeMode:'default',displayedProfile:'safe-dev',zyraProfile:'concise',EFFORT_OPTIONS:['medium'],EFFORT_LABELS:{medium:'Medium'},
 setPreviewAttachment:setPreview,removeAttachment:id=>{removed.push(id);setFiles(current=>current.filter(file=>file.id!==id))},onOpenAttachmentPreview:()=>opened.push('disk'),
 setText,setShowMentionMenu:noop,setComposerCursor:noop,setInlineMentionTags:noop,syncScrollAffordance:noop,handlePaste:noop,handleKeyDown:noop,handleSend:noop,attachFile:noop,setShowModelDropdown:noop,setShowTraitsDropdown:noop,onZyraProfileChange:noop}
 return <div style={{width:'760px',margin:'220px auto 0'}}>{placement==='center'?<AssistantNewChatGreeting prompt="What are we building today?"/>:null}<AssistantComposerView controller={controller}/></div>
}
const root=createRoot(document.getElementById('root'))
const flush=async(ms=0)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms))})
const capture=async phase=>{window.testPhase=phase;if(${Boolean(process.env.ZYRA_COMPOSER_SCREENSHOTS)}){const until=Date.now()+4000;while(window.testCapture!==phase&&Date.now()<until)await flush(50);check(window.testCapture===phase,'screenshot captured: '+phase)}}
window.testPhase='starting'
try{
 await act(async()=>root.render(<MemoryRouter><Composer/></MemoryRouter>));await flush(400)
 const card=document.querySelector('article[data-composer-attachment-item]'), greeting=document.querySelector('[data-assistant-new-chat-prompt]'), frame=document.querySelector('[data-assistant-composer-frame]')
 check(card&&greeting&&frame,'real composer renders image and greeting')
 check(card.getBoundingClientRect().top>=greeting.getBoundingClientRect().bottom+12,'attachments reserve space below greeting')
 check(frame.getBoundingClientRect().top>=card.getBoundingClientRect().bottom+8,'attachments reserve space above input')
 check(card.getBoundingClientRect().height<=40&&card.textContent.includes('Screenshot.png'),'small image pill with filename')
 check(getComputedStyle(card.querySelector('img')).objectFit==='cover','compact thumbnail; original available on click')
 const remove=card.querySelector('[aria-label="Remove Screenshot.png"]')
 check(getComputedStyle(remove).opacity==='0','remove button hidden at rest')
 await act(async()=>remove.focus())
 const focusUntil=Date.now()+2000
 while(Number(getComputedStyle(remove).opacity)<0.99&&Date.now()<focusUntil)await flush(50)
 check(document.activeElement===remove&&Number(getComputedStyle(remove).opacity)>=0.99,'remove accessible on keyboard focus: '+getComputedStyle(remove).opacity)
 remove.blur();await flush(200)
 await capture('cards')
 await act(async()=>card.querySelector('[aria-label="Open preview for Screenshot.png"]').click());await flush(150)
 check(document.querySelector('img[src^="data:image/"]')&&document.querySelectorAll('img[src^="data:image/"]').length>1,'click opens actual image viewer using captured image')
 check(!opened.length,'new chat image opens locally without resolving a clipboard pseudo path')
 const close=document.querySelector('[title="Close preview"]') || document.querySelector('[aria-label="Close preview"]')
 check(close,'image viewer has close action');await act(async()=>close.click());await flush(100)
 check(document.querySelectorAll('img[src^="data:image/"]').length===1,'image viewer closes completely')
 await act(async()=>remove.click());await flush(300)
 check(removed[0]==='image'&&!document.querySelector('article[data-composer-attachment-item]'),'remove updates actual shelf')
 await act(async()=>root.render(<MemoryRouter><Composer key="bottom" placement="bottom"/></MemoryRouter>));await flush(300)
 check(!document.querySelector('[data-new-chat-attachments]'),'bottom composer retains floating shelf')
 await act(async()=>document.querySelector('[aria-label="Open preview for Screenshot.png"]').click())
 check(opened.length===1,'bottom composer retains existing file opener')
 // Exercise the mounted drawer and paint boundaries, rather than only static menus.
 for(const placement of ['center','bottom']){
  await act(async()=>root.render(<MemoryRouter><Composer key={placement} placement={placement}/><button id="outside" onClick={()=>window.outsideClicked=true}>Outside action</button></MemoryRouter>));await flush(100)
  await act(async()=>window.fixtureDraft.setFiles([]));await flush(250)
  const input=document.querySelector('[data-composer-text-input]')
  const minimum=Number.parseFloat(getComputedStyle(input).lineHeight)*3
  check(input.getBoundingClientRect().height>=minimum-1,'composer preserves original three-line writing space')
  const originalFrame=document.querySelector('[data-assistant-composer-frame]').getBoundingClientRect()
  await act(async()=>window.fixtureDraft.setText('/'))
  const until=Date.now()+4000;let faded=false,drifted=false;const samples=[]
  while(Date.now()<until){
   await flush(12)
   const drawer=document.querySelector('[data-composer-drawer]')
   if(!drawer)continue
   const animated=drawer.parentElement, style=getComputedStyle(animated)
   if(samples.length<6)samples.push({opacity:style.opacity,transform:style.transform,transition:style.transition,classes:animated.className,animations:animated.getAnimations().map(animation=>({time:animation.currentTime,state:animation.playState}))})
   faded ||= Number(style.opacity)>0&&Number(style.opacity)<0.99
   drifted ||= style.transform!=='none'&&!style.transform.endsWith(', 0, 0)')
   if(Number(style.opacity)>.99)break
  }
  check(faded&&drifted,'drawer fades and drifts from behind the composer: '+placement+' '+JSON.stringify(samples))
  await flush(100)
  const drawer=document.querySelector('[data-composer-drawer]'), list=drawer.querySelector('[role="listbox"]')
  const currentFrame=document.querySelector('[data-assistant-composer-frame]').getBoundingClientRect(), listBounds=list.getBoundingClientRect()
  check(Math.abs(currentFrame.top-originalFrame.top)<1&&Math.abs(currentFrame.height-originalFrame.height)<1,'drawer leaves composer placement and height stable')
  check(placement==='center'?listBounds.top>=currentFrame.bottom-1:listBounds.bottom<=currentFrame.top+1,'drawer opens on correct side: '+placement)
  check(!drawer.textContent.includes('Commands & skills'),'no extra drawer header strip')
  await capture('drawer-'+placement)
  await act(async()=>document.querySelector('[aria-label="Close composer menu"]').click());await flush(260)
  check(!document.querySelector('[data-composer-drawer]'),'close button dismisses drawer')
  await act(async()=>window.fixtureDraft.setText('/s'));await flush(280)
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await flush(260)
  check(!document.querySelector('[data-composer-drawer]'),'Escape dismisses drawer')
  await act(async()=>window.fixtureDraft.setText('/i'));await flush(280)
  await act(async()=>{document.getElementById('outside').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.getElementById('outside').click()});await flush(260)
  check(!document.querySelector('[data-composer-drawer]')&&window.outsideClicked,'outside action remains usable and dismisses drawer')
 }
 const items=['useAssistantComposerFileSearch.ts','use-quick-open-search.ts','QuickOpenDialog.tsx','RecordedChangeUndo.tsx','useDeveloperWorkspace.ts','AssistantConversationHeader.tsx'].map((name,index)=>({id:String(index),name,path:'/repo/'+name,relativePath:'desktop/src/renderer/'+name,displayPath:'desktop/src/renderer/components',rootPath:'/repo',rootLabel:'Repo',showRootLabel:false}))
 let selected
 await act(async()=>root.render(<div style={{width:760,margin:'180px auto'}}><AssistantComposerFileMenu menuId="files" items={items} activeIndex={1} query="" loading={false} error={null} iconTheme="dark" scrollBehavior="instant" onActiveIndexChange={noop} onSelect={item=>selected=item}/><div style={{position:'relative',marginTop:-13,height:130,borderRadius:18,background:'var(--surface-floating)',padding:18}}>Message Zyra…</div></div>));await flush(100)
 check(document.querySelector('[role="option"]').getBoundingClientRect().height===32,'compact uniform picker rows')
 check(document.querySelector('[role="option"] img[data-material-icon]')?.naturalWidth>0,'picker uses the loaded material file icon, not a generic fallback')
 const spans=[...document.querySelector('[role="option"]').querySelectorAll('span')]
 const nameRect=spans.find(span=>span.textContent===items[0].name).getBoundingClientRect()
 const pathRect=spans.find(span=>span.textContent===items[0].displayPath).getBoundingClientRect()
 check(pathRect.left>=nameRect.right+4&&pathRect.left<=nameRect.right+16,'directory sits beside the filename')
 await act(async()=>document.querySelectorAll('[role="option"]')[1].click());check(selected.id==='1','file picker action preserved')
 await capture('picker')
 const highlightUntil=Date.now()+2000
 while(document.querySelector('[role="listbox"] [aria-hidden="true"]').style.height!=='32px'&&Date.now()<highlightUntil)await flush(50)
 check(document.querySelector('[role="listbox"] [aria-hidden="true"]').style.height==='32px','active picker highlight appears on initial mount')
 const commands=[{id:'cmd',kind:'command',label:'/include',description:'Attach a file',scope:'built-in'},...['codex','claude','pi','zyra','agents'].map(source=>({id:source,kind:'skill',value:'/skill:review-'+source,label:'/skill:review-'+source,description:'Review a change',scope:'personal',sourceId:source,sourceLabel:source==='agents'?'Shared':source==='pi'?'Pi':source==='codex'?'Codex':source==='claude'?'Claude':'Zyra'}))]
 let chosenCommand
 document.documentElement.classList.add('dark')
 await act(async()=>root.render(<AssistantComposerCommandMenu menuId="commands" items={commands} activeIndex={0} loading={false} error={null} scrollBehavior="instant" onActiveIndexChange={noop} onSelect={noop}/>))
 check(document.querySelectorAll('[role="option"]')[0].getAttribute('aria-label').startsWith('Command:')&&document.querySelectorAll('[role="option"]')[1].getAttribute('aria-label').startsWith('Skill:'),'command and skill kinds remain distinct')
 check(!document.querySelector('[role="listbox"]').textContent.includes('/skill:')&&document.querySelectorAll('[data-composer-resource-kind="skill"]').length===5,'skill names have no invocation prefix and use a separate Skill badge')
 check(!document.querySelector('[role="option"]').querySelector('[data-composer-resource-kind]'),'commands preserve their slash label without a Skill badge')
 const badgeColor=source=>getComputedStyle(document.querySelector('[data-composer-source="'+source+'"]')).color
 check(badgeColor('codex')==='rgb(255, 255, 255)'&&badgeColor('claude')==='rgb(217, 119, 87)'&&badgeColor('pi')==='rgb(128, 184, 210)','harness badges use monochrome, Claude clay and Pi blue in dark mode')
 check(badgeColor('zyra')==='rgb(67, 133, 255)','Zyra badge follows its own accent')
 await flush(80)
 for(const source of ['claude','pi','zyra'])check(document.querySelector('[data-composer-source="'+source+'"] img')?.naturalWidth>0,'official source logo loads: '+source)
 await capture('brands-dark')
 document.documentElement.classList.remove('dark')
 check(badgeColor('codex')==='rgb(0, 0, 0)'&&badgeColor('claude')==='rgb(166, 77, 50)'&&badgeColor('pi')==='rgb(39, 104, 136)','light mode keeps official hues readable and Codex black')
 const lightTokens={'--color-bg':'#ffffff','--color-card':'#ffffff','--color-text':'#141413','--color-text-secondary':'#575757','--color-text-muted':'#666666','--theme-background-rgb':'255 255 255','--theme-foreground-rgb':'20 20 19'}
 for(const [name,value] of Object.entries(lightTokens))document.documentElement.style.setProperty(name,value)
 await capture('brands-light')
 for(const name of Object.keys(lightTokens))document.documentElement.style.removeProperty(name)
 document.documentElement.classList.add('dark')
 await act(async()=>root.render(<AssistantComposerCommandMenu menuId="commands" items={commands} activeIndex={1} loading={false} error={null} scrollBehavior="instant" onActiveIndexChange={noop} onSelect={item=>chosenCommand=item}/>))
 await act(async()=>document.querySelectorAll('[role="option"]')[1].click())
 check(chosenCommand.value==='/skill:review-codex','the selected skill retains its complete invocation token')
 const mentionCandidates=[{path:'/repo/code.ts',name:'code.ts',relativePath:'src/code.ts',type:'file'},{path:'/repo/components',name:'components',relativePath:'src/components',type:'directory'}]
 let mention
 await act(async()=>root.render(<div style={{position:'relative',width:760,margin:'500px auto'}}><ComposerMentionMenu isOpen mentionLoading={false} mentionCanScrollUp={false} mentionCanScrollDown={false} mentionCandidates={mentionCandidates} activeMentionIndex={1} mentionListRef={{current:null}} iconTheme="dark" onScroll={noop} onApplyMention={candidate=>mention=candidate}/></div>));await flush(400)
 check(document.querySelector('[role="listbox"]').getAttribute('aria-label')==='Files and folders'&&document.querySelector('[role="option"]').getBoundingClientRect().height===32,'at-mention uses the same compact file/folder drawer')
 await act(async()=>document.querySelectorAll('[role="option"]')[1].click());check(mention.type==='directory','folder mention selection preserved')
 let editorState
 function RichInput(){
  const [text,setText]=useState('Use /skill:review and @/repo/code.ts now'),[tags,setTags]=useState([{id:'skill',kind:'skill',path:'/skill:review',relativePath:'/skill:review',label:'review',start:4,end:17},{id:'file',kind:'file',path:'/repo/code.ts',relativePath:'code.ts',label:'code.ts',start:22,end:36}])
  const ref=useRef(null)
  editorState={text,tags,ref,setText,setTags}
  return <ComposerTextInput ref={ref} value={text} tags={tags} theme="dark" onTagsChange={setTags} onRemoveTag={noop} onChange={event=>{const next=event.currentTarget.value;setTags(current=>reconcileInlineMentionTags(text,next,current));setText(next)}} onKeyDown={noop} placeholder="Message Zyra" className="text-sparkle-text"/>
 }
 await act(async()=>root.render(<RichInput/>));await flush(100)
 const input=document.querySelector('[data-composer-text-input]')
 check(input.querySelectorAll('[data-composer-chip]').length===2,'real file and skill chips')
 check(input.querySelector('[data-composer-chip="skill"] svg')&&input.querySelector('[data-composer-chip="file"] img[data-material-icon]'),'both chips have the correct resource/file icons')
 check(input.querySelector('[data-composer-chip="skill"]').contentEditable==='false','chip is atomic')
 input.focus();setComposerSelection(input,4,17)
 check(composerSelection(input).join(',')==='4,17','chip selection maps to full hidden token')
 const clipboard=new DataTransfer()
 await act(async()=>input.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clipboard})))
 check(clipboard.getData('text/plain')==='/skill:review','copy preserves the complete raw reference rather than only the visible chip label')
 await act(async()=>document.execCommand('delete'));await flush(80)
 check(editorState.text==='Use  and @/repo/code.ts now'&&editorState.tags.length===1,'chip delete updates prompt and preserves the other chip')
 await act(async()=>document.execCommand('undo'));await flush(80)
 check(editorState.text==='Use /skill:review and @/repo/code.ts now'&&editorState.tags.length===2,'undo restores full token and chip metadata')
 input.focus();setComposerSelection(input,17)
 const backspace=new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true})
 await act(async()=>input.dispatchEvent(backspace));await flush(80)
 check(backspace.defaultPrevented&&editorState.text==='Use  and @/repo/code.ts now'&&editorState.tags.length===1,'Backspace deletes the adjacent skill as one undoable token')
 await act(async()=>document.execCommand('undo'));await flush(80)
 check(editorState.tags.length===2,'keyboard deletion restores token metadata on undo')
 setComposerSelection(input,22)
 const deleteFile=new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})
 await act(async()=>input.dispatchEvent(deleteFile));await flush(80)
 check(deleteFile.defaultPrevented&&editorState.text==='Use /skill:review and  now'&&editorState.tags.length===1,'Delete removes the following file token and preserves the skill')
 await act(async()=>document.execCommand('undo'));await flush(80)
 setComposerSelection(input,4,36)
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})));await flush(80)
 check(editorState.text==='Use  now'&&editorState.tags.length===0,'selected text and multiple pills delete cleanly together')
 await act(async()=>document.execCommand('undo'));await flush(80)
 check(editorState.tags.length===2,'range deletion is undoable with both pills intact')
 setComposerSelection(input,editorState.text.length)
 const plainBackspace=new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true})
 await act(async()=>input.dispatchEvent(plainBackspace))
 check(!plainBackspace.defaultPrevented,'ordinary text deletion stays native')
 await act(async()=>input.querySelector('[aria-label="Remove review"]').click());await flush(80)
 check(!editorState.text.includes('/skill:review')&&editorState.tags.length===1,'dismiss removes only the target token')
 await act(async()=>document.execCommand('undo'));await flush(80)
 check(editorState.tags.length===2,'dismiss is undoable')
 setComposerSelection(input,editorState.text.length)
 await act(async()=>document.execCommand('insertLineBreak'));await flush(80)
 await act(async()=>document.execCommand('insertText',false,'next line'));await flush(80)
 check(editorState.text.endsWith('\\nnext line'),'multiline text preserves line breaks')
 const sentSkill='/skill:background-terminals whats this for?'
 await act(async()=>root.render(<div data-message-skill-fixture style={{width:420,margin:20,borderRadius:12,padding:14,background:'var(--surface-active)'}}><CollapsibleUserMessageBody content={sentSkill}/></div>));await flush(100)
 const sentChip=document.querySelector('[data-skill-reference]')
 check(sentChip&&sentChip.textContent==='background-terminals'&&sentChip.querySelector('svg'),'sent skill reference renders the same labeled pill with its icon')
 check(!sentChip.querySelector('button')&&document.querySelector('[data-message-skill-fixture]').textContent.includes('whats this for?'),'message pills have no dismiss action and surrounding prose is preserved')
 const messageSelection=window.getSelection(),messageRange=document.createRange()
 messageRange.selectNode(sentChip);messageSelection.removeAllRanges();messageSelection.addRange(messageRange)
 const messageClipboard=new DataTransfer()
 await act(async()=>sentChip.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:messageClipboard})))
 check(messageClipboard.getData('text/plain')==='/skill:background-terminals','copying a rendered message pill retains the full skill reference')
 messageSelection.removeAllRanges()
 await capture('message-skills')
 await act(async()=>root.render(<CollapsibleUserMessageBody content={'Use **/skill:yeet**, then /skill:product-design:audit. Example '+String.fromCharCode(96)+'/skill:literal'+String.fromCharCode(96)+' and [link /skill:linked](https://example.com).'}/>));await flush(100)
 check(document.querySelectorAll('[data-skill-reference]').length===2,'multiple references, punctuation and namespaced skill names render as separate pills')
 check(document.querySelector('code').textContent==='/skill:literal'&&document.querySelector('a').textContent.includes('/skill:linked'),'code examples and link text stay literal')
 await act(async()=>root.render(<MarkdownRenderer content={sentSkill} interactionLayerEnabled={false}/>));await flush(80)
 check(!document.querySelector('[data-skill-reference]')&&document.querySelector('.markdown-body').textContent.includes('/skill:background-terminals'),'plain Markdown and cached user messages keep separate rendering policies')
 await act(async()=>root.render(<CollapsibleUserMessageBody content={sentSkill}/>));await flush(80)
 check(document.querySelector('[data-skill-reference]'),'a reopened message retains its rendered skill pill')
 const legacySkillContext={id:'assistant-message-user-zyra-message:user:2',role:'user',text:'Use the background-terminals skill for this request.\\n\\nSkill location: C:\\\\fixture\\\\skills\\\\background-terminals\\\\SKILL.md\\n\\n# Internal instructions\\n\\nUser: whats this for?',turnId:null,streaming:false,createdAt:'2026-10-13T16:10:01Z',updatedAt:'2026-10-13T16:10:01Z'}
 const originalSkillMessage={...legacySkillContext,id:'local-user',text:sentSkill}
 const emptyActivities=[]
 function SkillHistory(){
  const [messages,setMessages]=useState([originalSkillMessage])
  window.setSkillHistory=setMessages
  const entries=useAssistantTimelineEntries(messages,emptyActivities)
  return <div data-message-skill-fixture style={{width:420,margin:20,borderRadius:12,padding:14,background:'var(--surface-active)'}}>{entries.filter(entry=>entry.type==='message').map(entry=><CollapsibleUserMessageBody key={entry.id} content={entry.message.text}/>)}</div>
 }
 await act(async()=>root.render(<SkillHistory/>));await flush(80)
 await act(async()=>window.setSkillHistory([originalSkillMessage,legacySkillContext]));await flush(80)
 check(document.querySelectorAll('[data-skill-reference]').length===1&&!document.querySelector('[data-message-skill-fixture]').textContent.includes('Internal instructions'),'incremental history refresh hides the internal native expansion and preserves the original bubble')
 await capture('message-skills-clean-history')
 await act(async()=>root.unmount());console.log('COMPOSER_PRESENTATION_PASS')
}catch(error){console.error('COMPOSER_PRESENTATION_FAIL '+error.stack)}
`
try {
    await mkdir(join(directory, 'material-icons'))
    const icons = new Set(['code.ts', 'QuickOpenDialog.tsx', 'Screenshot.png'].map(path => resolveMaterialFileIconAsset({ path, kind: 'file', light: false }).fileName))
    icons.add(resolveMaterialFileIconAsset({ path: 'components', kind: 'directory', light: false }).fileName)
    await Promise.all([...icons].map(async icon => writeFile(join(directory, 'material-icons', icon), await readFile(resolve(import.meta.dir, '../node_modules/material-icon-theme/icons', icon)))))
    const build = await Bun.build({ entrypoints: ['composer-harness'], target: 'browser', loader: {'.svg':'dataurl','.png':'dataurl'}, plugins: [{ name: 'composer-fixture', setup(builder) {
        builder.onResolve({ filter: /^composer-harness$/ }, () => ({ path: 'harness', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'tsx', resolveDir: resolve(import.meta.dir, '..') }))
        builder.onLoad({ filter: /\.(svg|png)$/ }, async args => {
            const mime = args.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
            const data = (await readFile(args.path)).toString('base64')
            return { contents: `export default ${JSON.stringify(`data:${mime};base64,${data}`)}`, loader: 'js' }
        })
        builder.onResolve({ filter: /^@\/lib\/settings$/ }, () => ({ path: 'settings', namespace: 'mock' }))
        builder.onResolve({ filter: /^@\/lib\/product-analytics$/ }, () => ({ path: 'analytics', namespace: 'mock' }))
        builder.onResolve({ filter: /^@\/components\/ui\/file-preview\/SyntaxPreview$/ }, () => ({ path: 'syntax', namespace: 'mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'settings' ? 'export const useSettings=()=>({settings:{theme:"dark",appearanceResolvedMode:"dark",assistantTranscriptionEngine:"browser",assistantTranscriptionEnabled:false,accentColor:{primary:"#4385ff"}},updateSettings:()=>{}});export const getThemeAppearance=()=>"dark";' : args.path === 'syntax' ? 'export default ()=>null;' : 'export const captureProductEvent=()=>{};', loader: 'tsx' }))
    } }] })
    if (!build.success) throw new Error(build.logs.join('\n'))
    await writeFile(join(directory, 'harness.js'), await build.outputs[0].text())
    const styles = await postcss([tailwindcss(config)]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })
    const tokens = await readFile(resolve(import.meta.dir, '../src/renderer/src/styles/theme-tokens.css'), 'utf8')
    await writeFile(join(directory, 'test.css'), tokens + '\n' + styles.css)
    await writeFile(join(directory, 'test.html'), '<link rel="stylesheet" href="test.css"><style>body{background:var(--color-bg);color:var(--color-text);font-family:system-ui} :root{--accent-primary:#4385ff}</style><div id="root"></div><script type="module" src="harness.js"></script>')
    const screenshots = process.env.ZYRA_COMPOSER_SCREENSHOTS
    await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(directory,'profile'))});
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 window.webContents.setFrameRate(60);
 window.webContents.on('paint',()=>{});
 window.webContents.on('console-message',event=>{console.log(event.message);if(event.message.includes('COMPOSER_PRESENTATION_PASS'))app.exit(0);if(event.message.includes('COMPOSER_PRESENTATION_FAIL'))app.exit(1)});
 await window.loadFile(${JSON.stringify(join(directory,'test.html'))});
 ${screenshots ? `let previous;setInterval(async()=>{
  if(window.isDestroyed())return;
  const phase=await window.webContents.executeJavaScript('window.testPhase');
  if(!['cards','picker','drawer-center','drawer-bottom','brands-dark','brands-light','message-skills','message-skills-clean-history'].includes(phase)||phase===previous)return;
  previous=phase;
  await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  require('fs').mkdirSync(${JSON.stringify(resolve(screenshots))},{recursive:true});
  const selector=phase.startsWith('brands-')?'[data-composer-drawer]':phase.startsWith('message-skills')?'[data-message-skill-fixture]':null;
  const region=selector?await window.webContents.executeJavaScript('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()'):undefined;
  require('fs').writeFileSync(require('path').join(${JSON.stringify(resolve(screenshots))},phase+'.png'),(await window.webContents.capturePage(region,{stayHidden:true,stayAwake:true})).toPNG());
  await window.webContents.executeJavaScript('window.testCapture='+JSON.stringify(phase));
 },50);` : ''}
});
setTimeout(()=>app.exit(1),45000);
`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const electron = createRequire(import.meta.url)('electron') as string
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(directory, 'main.cjs')]
    const virtualDisplay = process.platform === 'linux' && process.env.CI && !process.env.DISPLAY
    const child = spawn(virtualDisplay ? 'xvfb-run' : electron, virtualDisplay ? ['--auto-servernum', electron, ...args] : args, { env, stdio: 'inherit', windowsHide: true })
    const code = await new Promise<number>((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)) })
    if (code !== 0) throw new Error(`Composer fixture exited ${code}`)
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-composer-presentation-')) throw new Error('Unexpected fixture cleanup path')
    await rm(directory, { recursive: true, force: true })
}
