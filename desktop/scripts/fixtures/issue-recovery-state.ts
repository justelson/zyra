import { useSyncExternalStore } from 'react'
export const project = { id: 'project', revision: 2, homePath: 'C:/fixture/home', folders: [{path:'C:/fixture/docs',label:'Reference docs',access:'read-only'}] }
export const session: any = { id:'chat', chatScope:{projectId:'project', revision:1,workingRoot:'C:/fixture/home', roots:[{path:'C:/fixture/home',label:'Project home',access:'read-write'}]}, threads:[{state:'idle',pendingApprovals:[],pendingUserInputs:[]}] }
let revision=0
const listeners = new Set<() => void>()
export function changed() { revision++; for(const listener of listeners) listener() }
export let applies=0
export let failApply=false
export const setFailure = (value:boolean) => { failApply=value }
export function useAssistantStoreSelector(selector:any) {
    useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>revision)
    return selector({snapshot:{sessions:[session]}})
}
export function useAssistantProjectCatalog() { return {catalog:{projects:[project]}, loading:false, error:null} }
export function useAssistantStoreActions() { return {setSessionProjectResult:async(id:string,input:any)=>{
    if(id!=='chat'||input.projectId!=='project') throw Error('wrong chat scope')
    applies++
    if(failApply)return {success:false,error:'Fixture connection unavailable'}
    session.chatScope={...session.chatScope,revision:2,roots:[...session.chatScope.roots,...project.folders]};changed();return {success:true}
}} }
