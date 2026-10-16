import { StrictMode, createContext, useContext, useRef, useState } from 'react'
import { AnchoredNativeOverlay } from '../../src/renderer/src/components/ui/AnchoredNativeOverlay'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { NativeOverlayPortal, addOverlayEventListener, getOverlayActiveElement, isOverlayEventInside, registerOverlayAnchor } from '../../src/renderer/src/components/ui/native-overlay-portal'
import { getNativeOverlayHost } from '../../src/renderer/src/components/ui/native-overlay-host'
import { addAppearanceManagedFontFaces, removeAppearanceManagedFontFaces } from '../../src/renderer/src/lib/appearance-font-faces'
import { dispatchZyraThemeChanged } from '../../src/renderer/src/lib/theme-events'

type Kind = 'interactive' | 'passive'
const assert = (value: unknown, message: string) => { if (!value) throw Error(message) }
const checks: string[] = []
const calls: Array<{kind:Kind;visible:boolean;revision:number;focus:boolean}> = []
const children: Array<{kind:Kind; frameName:string; document:Document; closed:boolean; close:()=>void}> = []
const preparations: Kind[] = []
let nextPreparation: (()=>Promise<{success:boolean;frameName?:string}>) | undefined
let recoveries = 0
let recoverRetry = true
let listener: ((event:{kind:Kind;frameName:string;reason:'closed'|'blur'})=>void) | undefined
let unsubscribeCount = 0
let nextId = 0
let buttons = 0
let interactiveReady = 0
let blockShow = false
let supportsBounds = true
let finishShow:()=>void = ()=>{}
const preparedKinds = new Map<string,Kind>()
;(window as any).devscope = {
 prepareNativeOverlay: async ({kind}:{kind:Kind}) => {
   preparations.push(kind)
   if(nextPreparation) return nextPreparation()
   const frameName='fixture-'+(++nextId);preparedKinds.set(frameName,kind)
   return {success:true,frameName}
 },
 setNativeOverlayVisible: async (value:any) => {calls.push(value);if(blockShow&&value.kind==='interactive'&&value.visible)await new Promise<void>(resolve=>{finishShow=resolve});return supportsBounds ? {success:true,bounds:value.bounds ?? null} : {success:true}},
 recoverNativeOverlay: async()=>{recoveries++;return {success:true,retry:recoverRetry}},
 onNativeOverlayDismiss:(callback:any)=>{listener=callback;return ()=>{listener=undefined;unsubscribeCount++}}
}
window.open = ((_url:string, name:string) => {
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:0;top:0;width:700px;height:500px;border:0';document.body.append(frame)
 const child=frame.contentWindow!
 const record={kind:preparedKinds.get(name)!,frameName:name,document:child.document,closed:false,close:()=>{record.closed=true;frame.remove()}}
 children.push(record)
 return new Proxy(child,{get(target,key){if(key==='closed')return record.closed;if(key==='close')return record.close;return Reflect.get(target,key,target)}})
}) as typeof window.open

const context=createContext('')
function Contents(){const value=useContext(context);const [count,setCount]=useState(0);return <div role="dialog" aria-label="Actual portal"><input data-native-overlay-autofocus data-value value={value} readOnly/><button data-increment onClick={()=>{buttons++;setCount(value=>value+1)}}>{count}</button></div>}
function NestedAnchoredMenuFixture(){
 const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const [open,setOpen]=useState(false)
 return <><button ref={trigger} data-nested-trigger onClick={()=>setOpen(value=>!value)} style={{position:'absolute',left:12,top:36,width:120,height:24}}>Choose apps</button>
 {open&&<AnchoredNativeOverlay anchorRef={trigger} inputRegionRef={menu}><div ref={menu} data-nested-popup style={{position:'absolute',left:0,top:30,width:200,height:80,background:'#18202a'}}>Apps</div></AnchoredNativeOverlay>}</>
}
function AnchoredMenuFixture(){
 const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const [expanded,setExpanded]=useState(false)
 return <><button ref={trigger} style={{position:'fixed',left:100,top:40,width:80,height:24}}>Workspace</button>
 <AnchoredNativeOverlay anchorRef={trigger} inputRegionRef={menu}><div ref={menu} data-cropped-menu style={{position:'absolute',left:-12,top:30,width:280,height:expanded?240:120,background:'#18202a'}}><button onClick={()=>setExpanded(value=>!value)}>Expand app choices</button><NestedAnchoredMenuFixture/></div></AnchoredNativeOverlay></>
}
type Options={a?:boolean;b?:boolean;passive?:boolean;value?:string;autoFocus?:boolean;focusOnPresent?:boolean;bounds?:{x:number;y:number;width:number;height:number}}
const root=createRoot(document.querySelector('#root')!)
function App({a,b,passive,value='first',autoFocus=true,focusOnPresent=false,bounds}:Options){return <context.Provider value={value}>
 {a?<NativeOverlayPortal bounds={bounds} autoFocus={autoFocus} focusOnPresent={focusOnPresent} onReady={()=>{interactiveReady++}}><Contents/></NativeOverlayPortal>:null}
 {b?<NativeOverlayPortal onReady={()=>{interactiveReady++}}><div data-sibling>Sibling</div></NativeOverlayPortal>:null}
 {passive?<NativeOverlayPortal passive><div role="tooltip">Passive tooltip</div></NativeOverlayPortal>:null}
 </context.Provider>}
const render=(options:Options)=>flushSync(()=>root.render(<StrictMode><App {...options}/></StrictMode>))
const settle=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
const until=async(predicate:()=>unknown,label:string)=>{const started=performance.now();while(!predicate()){if(performance.now()-started>4000)throw Error('Timed out: '+label);await settle()}}
const last=(kind:Kind)=>[...children].reverse().find(child=>child.kind===kind&&!child.closed)!
const shown=(kind:Kind)=>[...calls].reverse().find(call=>call.kind===kind)?.visible===true
const fontMetrics=(owner:Document)=>{
 const sample=owner.createElement('span')
 sample.textContent='Zyra MWii ffi 12345'
 sample.style.cssText='display:inline-block;font-size:32px;white-space:pre'
 owner.body.append(sample)
 const result={width:sample.getBoundingClientRect().width,family:owner.defaultView!.getComputedStyle(sample).fontFamily}
 sample.remove()
 return result
}

;(window as any).nativeOverlayCheck=(async()=>{
 assert(preparations.length===0,'imports must leave both native hosts cold')
 let preparedResolve:(value:any)=>void=()=>{}
 nextPreparation=()=>new Promise(resolve=>{preparedResolve=resolve})
 render({a:true})
 await until(()=>preparations.length===1,'first preparation')
 render({})
 preparedResolve({success:true,frameName:'cancelled'})
 await settle()
 assert(children.length===0,'closing before preparation resolves must not create a child')
 assert(calls.length===0,'closing before ready must not show or hide a never-presented surface')
 nextPreparation=undefined
 checks.push('cold imports, StrictMode shared preparation and close-before-ready cancellation')

 const fontBytes=Uint8Array.from(atob((window as any).__fixtureFont),character=>character.charCodeAt(0))
 const initialFont=await new FontFace('Zyra Managed fixture',fontBytes).load()
 addAppearanceManagedFontFaces(document,[initialFont])
 document.documentElement.style.setProperty('--font-ui','"Zyra Managed fixture", sans-serif')
 const style=document.createElement('style');style.id='fixture-theme';style.textContent=':root{--fixture-accent:rgb(20, 40, 60)} body{font-family:var(--font-ui,sans-serif)} input,button{font:inherit} [data-value]{color:var(--fixture-accent)}';document.head.append(style)
 blockShow=true
 render({a:true,b:true,passive:true})
 await until(()=>shown('interactive')&&shown('passive')&&last('interactive')?.document.querySelector('[data-value]'),'both kinds rendered')
 assert(children.filter(child=>child.kind==='interactive').length===1,'sibling interactive portals must share one native child')
 assert(children.filter(child=>child.kind==='passive').length===1,'passive portals must have a separate child')
 assert(calls.every(call=>call.focus===false),'the surface bridge never steals owner input focus')
 const interactive=last('interactive'), passive=last('passive')
 assert(interactive.document.querySelector('[data-sibling]'),'sibling mounted')
 assert(interactiveReady===0,'sibling onReady must await the shared native show acknowledgement')
 blockShow=false;finishShow()
 await until(()=>interactiveReady===2,'both siblings ready after native show')
 assert(passive.document.querySelector('[role=tooltip]'),'passive content mounted')
 assert(interactive.document.querySelector('[data-value]')?.getAttribute('value')==='first','owner context crossed document')
 ;(interactive.document.querySelector('[data-increment]') as HTMLButtonElement).click()
 await settle()
 assert(buttons===1&&interactive.document.querySelector('[data-increment]')?.textContent==='1','React handler and component state survived the portal')
 render({a:true,b:true,passive:true,value:'updated'})
 await until(()=>interactive.document.querySelector('[data-value]')?.getAttribute('value')==='updated','context update')
 checks.push('interactive/passive separation, shared sibling leases, context, callback and local state')

 const copiedStyle=interactive.document.querySelector('#fixture-theme')
 let styleMoves=0
 const moves=new MutationObserver(records=>{styleMoves+=records.filter(record=>record.type==='childList'&&(Array.from(record.addedNodes).includes(copiedStyle!)||Array.from(record.removedNodes).includes(copiedStyle!))).length})
 moves.observe(interactive.document.head,{childList:true})
 document.documentElement.classList.add('fixture-light')
 document.documentElement.style.setProperty('--fixture-accent','rgb(70, 90, 110)')
 await settle()
 assert(interactive.document.documentElement.classList.contains('fixture-light'),'theme class synchronized')
 assert(interactive.document.documentElement.style.getPropertyValue('--fixture-accent')==='rgb(70, 90, 110)','theme variables synchronized')
 assert(styleMoves===0,'theme changes must not reinsert unchanged stylesheets')
 style.textContent+=' .fixture-hmr{color:inherit}'
 await settle()
 assert(interactive.document.querySelector('#fixture-theme')===copiedStyle,'style identity retained')
 assert(copiedStyle?.textContent===style.textContent,'HMR style text synchronized')
 moves.disconnect()
 checks.push('theme and CSS updates without stylesheet reinsertion')

 for(const child of [interactive,passive]){
   assert(child.document.fonts.has(initialFont),'already loaded managed FontFace is shared by identity on document creation')
   const ownerMetrics=fontMetrics(document),childMetrics=fontMetrics(child.document)
   assert(childMetrics.family===ownerMetrics.family&&childMetrics.family.includes('Zyra Managed fixture'),'actual document styles retain the managed font family')
   assert(Math.abs(childMetrics.width-ownerMetrics.width)<0.01,'managed font rendered metrics match the owner')
 }
 const loadedWidth=fontMetrics(document).width
 document.documentElement.style.setProperty('--font-ui','sans-serif')
 assert(Math.abs(fontMetrics(document).width-loadedWidth)>1,'font metrics distinguish the real loaded face from the fallback')
 const replacementFont=await new FontFace('Zyra Managed fixture-next',fontBytes).load()
 addAppearanceManagedFontFaces(document,[replacementFont])
 document.documentElement.style.setProperty('--font-ui','"Zyra Managed fixture-next", sans-serif')
 dispatchZyraThemeChanged()
 removeAppearanceManagedFontFaces(document,[initialFont])
 await settle()
 for(const child of [interactive,passive]){
   assert(child.document.fonts.has(replacementFont),'dynamic loaded face is reused without another source read or FontFace construction')
   assert(!child.document.fonts.has(initialFont),'removed managed face leaves each child FontFaceSet')
   assert(fontMetrics(child.document).family===fontMetrics(document).family&&Math.abs(fontMetrics(child.document).width-loadedWidth)<0.01,'theme font changes preserve actual family and metrics')
 }
 checks.push('real loaded font identity, initial and dynamic family/metrics, replacement and removal in both document kinds')

 let keydowns=0
 const removeKeys=addOverlayEventListener('keydown',()=>{keydowns++})
 interactive.document.dispatchEvent(new interactive.document.defaultView!.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
 assert(keydowns===1,'late child document receives shared listener')
 const anchor=document.createElement('div');document.body.append(anchor)
 const inside=document.createElement('span');anchor.append(inside)
 const portalRoot=interactive.document.createElement('div');interactive.document.body.append(portalRoot)
 const nested=interactive.document.createElement('button');portalRoot.append(nested)
 const removeAnchor=registerOverlayAnchor(inside,portalRoot)
 let contained=false
 const removePointer=addOverlayEventListener('pointerdown',event=>{contained=isOverlayEventInside(event,anchor)})
 nested.dispatchEvent(new interactive.document.defaultView!.PointerEvent('pointerdown',{bubbles:true}))
 assert(contained,'anchored portal is inside source trigger without cross-realm instanceof')
 const ownerInput=document.querySelector('#owner-input') as HTMLInputElement
 Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true})
 Object.defineProperty(interactive.document,'hasFocus',{configurable:true,value:()=>false})
 ownerInput.focus()
 assert(getOverlayActiveElement()===ownerInput,'focused owner wins over stale child active element')
 Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false})
 Object.defineProperty(interactive.document,'hasFocus',{configurable:true,value:()=>true})
 interactive.document.body.tabIndex=-1
 interactive.document.body.focus()
 assert(getOverlayActiveElement()===null,'focused child body must not revive an unfocused owner control')
 Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true})
 Object.defineProperty(interactive.document,'hasFocus',{configurable:true,value:()=>false})
 ownerInput.focus()
 removeKeys();removePointer();removeAnchor();anchor.remove();portalRoot.remove()
 checks.push('late document events, anchor containment and focused-document priority')

 render({a:true,passive:true,value:'updated'})
 await settle()
 assert(shown('interactive'),'releasing a sibling cannot hide remaining content')
 render({passive:true})
 await until(()=>!shown('interactive'),'last interactive release')
 assert(shown('passive'),'interactive close leaves passive kind alone')
 assert(document.activeElement===ownerInput,'focus:false presentation must not restore over a current owner input')
 render({})
 await until(()=>!shown('passive'),'last passive release')
 for(const kind of ['interactive','passive'] as Kind[]){const values=calls.filter(call=>call.kind===kind).map(call=>call.revision);assert(values.every((value,index)=>!index||value>values[index-1]),'visibility revisions increase')}
 checks.push('sibling release, independent kinds, final animation-frame hide and no focus theft')

 render({a:true,focusOnPresent:true})
 await until(()=>calls.some(call=>call.kind==='interactive'&&call.visible&&call.focus),'requested interactive focus')
 assert(calls.at(-1)?.focus===true,'focus request reaches the native bridge')
 render({})
 await until(()=>!shown('interactive'),'focused surface release')
 checks.push('opt-in interactive focus for searchable overlays')

 const scopedBounds={x:220,y:80,width:360,height:300}
 supportsBounds=false
 render({a:true,bounds:scopedBounds,autoFocus:false})
 await until(()=>shown('interactive'),'legacy native host')
 await settle()
 assert((last('interactive').document.querySelector('#zyra-native-overlay-root') as HTMLElement).style.transform==='', 'legacy native hosts must not shift the browser overlay away from its anchor')
 render({})
 await settle()
 supportsBounds=true
 blockShow=true
 render({a:true,bounds:scopedBounds,autoFocus:false})
 await until(()=>shown('interactive'),'scoped bounds request sent')
 assert((last('interactive').document.querySelector('#zyra-native-overlay-root') as HTMLElement).style.transform==='', 'do not offset the DOM before the native view confirms its actual bounds')
 blockShow=false;finishShow()
 await settle()
 await until(()=>shown('interactive'),'scoped browser surface')
 assert(JSON.stringify((calls.at(-1) as any).bounds)===JSON.stringify(scopedBounds),'browser-scoped native input must not cover the whole app')
 const scopedRoot=last('interactive').document.querySelector('#zyra-native-overlay-root') as HTMLElement
 assert(scopedRoot.style.transform==='translate(-220px, -80px)','scoped native viewport keeps owner-coordinate portal positioning')
 render({a:true,b:true,bounds:scopedBounds,autoFocus:false})
 await settle()
 assert((calls.at(-1) as any).bounds===null,'an app-wide nested portal expands the native surface')
 render({a:true,bounds:scopedBounds,autoFocus:false})
 await settle()
 assert(JSON.stringify((calls.at(-1) as any).bounds)===JSON.stringify(scopedBounds),'closing an app-wide portal restores browser-only input bounds')
 render({a:true,bounds:{...scopedBounds,x:260},autoFocus:false})
 await settle()
 assert((calls.at(-1) as any).bounds.x===260,'anchor movement updates an already-visible native surface')
 render({})
 await settle()
 checks.push('browser-only native input bounds, nested expansion, release and live anchor movement')

 flushSync(()=>root.render(<AnchoredMenuFixture/>))
 await until(()=>JSON.stringify((calls.at(-1) as any).bounds)===JSON.stringify({x:88,y:70,width:280,height:120}),'menu-only native bounds')
 const menuDocument=last('interactive').document
 const menuBox=menuDocument.querySelector('[data-cropped-menu]')!.getBoundingClientRect()
 assert(menuBox.x===0&&menuBox.y===0,'menu crop compensation preserves its original position')
 const regionCallsStart=calls.length
 ;(menuDocument.querySelector('[data-cropped-menu] button') as HTMLButtonElement).click()
 await until(()=>(calls.at(-1) as any).bounds?.height===240,'expanded app choices resize native input')
 assert(calls.slice(regionCallsStart).every(call=>(call as any).bounds!==null),'expanding menu choices never creates full-window input interception')
 assert((calls.at(-1) as any).bounds.x===88&&(calls.at(-1) as any).bounds.y===70,'native crop translation cannot feed back into menu positioning')
 const nestedCallsStart=calls.length
 ;(menuDocument.querySelector('[data-nested-trigger]') as HTMLButtonElement).click()
 await until(()=>menuDocument.querySelector('[data-nested-popup]'),'nested chooser rendered')
 await settle()
 const nestedBox=menuDocument.querySelector('[data-nested-popup]')!.getBoundingClientRect()
 assert(nestedBox.x===12&&nestedBox.y===66,'chooser anchored inside a cropped native document preserves owner-window coordinates')
 assert(calls.slice(nestedCallsStart).every(call=>(call as any).bounds!==null),'nested chooser never expands input to the whole window')
 assert((calls.at(-1) as any).bounds.x===88&&(calls.at(-1) as any).bounds.y===70,'nested chooser keeps parent positioning stable')
 ;(menuDocument.querySelector('[data-nested-trigger]') as HTMLButtonElement).click()
 await settle()
 assert(!menuDocument.querySelector('[data-nested-popup]')&&shown('interactive'),'closing chooser preserves parent menu')
 render({})
 await until(()=>!shown('interactive'),'cropped workspace closes')
 checks.push('anchored menu-only input, crop compensation and expanded choices remain scoped')

 render({a:true,value:'before-loss'})
 await until(()=>shown('interactive'),'reopen')
 const beforeLoss=last('interactive')
 listener?.({kind:'interactive',frameName:beforeLoss.frameName,reason:'closed'})
 await until(()=>last('interactive')!==beforeLoss&&last('interactive')?.document.querySelector('[data-value]'),'closed child recreated')
 assert(beforeLoss.closed,'invalidating closes stale child')
 assert(!beforeLoss.document.fonts.has(replacementFont)&&document.fonts.has(replacementFont),'child disposal removes only mirrored font references, preserving the owner')
 const afterLoss=last('interactive')
 listener?.({kind:'interactive',frameName:beforeLoss.frameName,reason:'closed'})
 await settle()
 assert(last('interactive')===afterLoss,'late dismissal for the former frame cannot close its replacement')
 assert(last('interactive').document.querySelector('[data-value]')?.getAttribute('value')==='before-loss','owner React state survived child recreation')
 render({})
 await settle()
 checks.push('child loss invalidation and fresh document acquisition')

 getNativeOverlayHost().invalidate()
 let pendingGenerationResolve:(value:any)=>void=()=>{}
 const previousPreparationCount=preparations.length
 nextPreparation=()=>new Promise(resolve=>{pendingGenerationResolve=resolve})
 render({a:true,value:'new-generation'})
 await until(()=>preparations.length===previousPreparationCount+1,'pending generation preparation')
 getNativeOverlayHost().invalidate()
 nextPreparation=undefined
 pendingGenerationResolve({success:true,frameName:'obsolete-generation'})
 await until(()=>last('interactive')?.document.querySelector('[data-value]')?.getAttribute('value')==='new-generation','new generation waits for obsolete attempt')
 assert(!children.some(child=>child.frameName==='obsolete-generation'),'invalidated preparation cannot open a stale child')
 render({})
 await settle()
 checks.push('pending preparation generation invalidation and late result suppression')

 getNativeOverlayHost().invalidate()
 let failures=2
 nextPreparation=async()=>{if(failures-->0)return {success:false};nextPreparation=undefined;const frameName='retry-'+(++nextId);preparedKinds.set(frameName,'interactive');return {success:true,frameName}}
 render({a:true,value:'recovered'})
 await until(()=>recoveries===1&&last('interactive')?.document.querySelector('[data-value]')?.getAttribute('value')==='recovered','native recovery retry')
 assert(recoveries===1,'two bounded attempts use one explicit recovery decision')
 render({})
 await settle()
 checks.push('bounded startup retries and explicit native recovery')

 root.unmount()
 await settle()
 ;(window as any).__disposeNativeOverlayHost()
 assert(children.every(child=>child.closed),'HMR disposal closes both owned children')
 assert(children.every(child=>!child.document.fonts.has(replacementFont)),'HMR disposal releases mirrored font references from every child')
 assert(document.fonts.has(replacementFont),'disposing child documents does not remove the owner font')
 removeAppearanceManagedFontFaces(document,[replacementFont])
 assert(unsubscribeCount===1,'HMR disposal removes native event subscription')
 checks.push('unmount and HMR disposal close owned documents and listeners')
 return checks
})()
