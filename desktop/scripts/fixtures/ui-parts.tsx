import {createRoot} from 'react-dom/client'
import {UiPartsInspector, openUiPartsInspector} from '../../src/renderer/src/components/ui-parts/UiPartsInspector'
import {AssistantSessionTitleText} from '../../src/renderer/src/pages/assistant/AssistantSessionTitleText'
const root=document.getElementById('root')!
let activations=0
createRoot(root).render(<><div data-zyra-part="sidebar.chatRow" data-row-layout="standard" data-zyra-state="selected working" onClick={()=>activations++}><AssistantSessionTitleText sidebar title="Test chat"/></div><UiPartsInspector/></>)
const tick=()=>new Promise(resolve=>setTimeout(resolve,50))
Object.assign(window,{runPerformanceBenchmark:async()=>{
    const button=(s:string)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===s);if(!b || b.disabled)throw Error(`Missing enabled button ${s}`); b.click()}
    const assert=(v:unknown,msg:string)=>{if(!v)throw Error(msg)}
    openUiPartsInspector(); await tick(); button('Pick on screen');await tick(); (document.querySelector('[data-zyra-part="sidebar.chatRow.title"] > span') as HTMLElement).click();await tick();assert(document.querySelector('code')?.textContent==='sidebar.chatRow.title'&&!activations,'pick activated wrong control');button('Chat row');await tick();const row=document.querySelector<HTMLElement>('[data-row-layout]')!;assert(row.hasAttribute('data-zyra-inspected'),'locate');const select=document.querySelector('select')!;select.value='compact';select.dispatchEvent(new Event('change',{bubbles:true}));await tick();assert(getComputedStyle(row).height==='26.4px' || Math.abs(parseFloat(getComputedStyle(row).height)-26.4)<1,'density preview');button('Apply');await tick();button('Undo');await tick();assert(Math.abs(parseFloat(getComputedStyle(row).height)-26.4)>1,'undo did not restore');button('Close');await tick();assert(!row.hasAttribute('data-zyra-inspected'),'highlight not cleared');return {pick:true,locate:true,preview:true,apply:true,undo:true}
}})
