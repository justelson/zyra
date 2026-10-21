import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config.js'

const directory = await mkdtemp(join(tmpdir(), 'zyra-developer-renderer-'))
const source = (path: string) => JSON.stringify(resolve(import.meta.dir, '../src/renderer/src', path))
const harness = `
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import QuickOpenDialog from ${source('components/QuickOpenDialog.tsx')}
import {PreviewCodeSelection} from ${source('components/ui/file-preview/PreviewCodeSelection.tsx')}
import {subscribeCodeContext} from ${source('pages/assistant/assistant-code-context.ts')}
import {buildPromptWithContextFiles} from ${source('pages/assistant/assistant-composer-utils.ts')}
import {useQuickOpenSearch} from ${source('components/use-quick-open-search.ts')}
import {useAssistantComposerFileSearch} from ${source('pages/assistant/useAssistantComposerFileSearch.ts')}
import {DeveloperChanges} from ${source('pages/assistant/DeveloperChanges.tsx')}
import {useDeveloperWorkspace} from ${source('pages/assistant/useDeveloperWorkspace.ts')}
import {DeveloperWorkspaceMenu} from ${source('pages/assistant/DeveloperWorkspaceMenu.tsx')}
import {DeveloperTaskList} from ${source('pages/assistant/DeveloperTaskList.tsx')}
import {useDeveloperActions} from ${source('pages/assistant/useDeveloperActions.ts')}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
window.testSnapshot={selectedSessionId:'chat-a',sessions:[{id:'chat-a',projectPath:'/repo',workingRoot:'/repo'}]}
window.testSettings={theme:'dark',appearanceResolvedMode:'dark',defaultShell:'cmd',accentColor:{primary:'#4385ff'}}
const check=(value,message)=>{if(!value)throw Error(message)}
const requests=[],reads=[],attachments=[],previews=[],checkouts=[],terminalCalls=[]
const startedTasks=[],stoppedTasks=[],actionErrors=[],stages=[],unstages=[],diffReads=[],commits=[]
let taskRecords=[]
window.testPreviews=previews
window.devscope={
 searchIndexedPaths:input=>new Promise(resolve=>requests.push({input,resolve})),
 searchProjectContents:input=>new Promise(resolve=>requests.push({input,resolve})),
 readFileContent:(path,options)=>new Promise(resolve=>reads.push({path,options,resolve})),
 getPathInfo:async path=>({success:true,exists:!path.includes('missing'),isFile:true,isDirectory:false,path}),
 getGitStatusDetailed:()=>new Promise(resolve=>requests.push({resolve})),
 getDeveloperWorkspace:folder=>new Promise(resolve=>requests.push({folder,resolve})),
 selectFolder:async()=>({success:true,cancelled:true}),
 listInstalledIdes:async()=>({success:true,ides:[]}),
 openInTerminal:async(folder,shell)=>{terminalCalls.push({folder,shell});return {success:true}},
 startDeveloperTask:(folder,name)=>new Promise(resolve=>startedTasks.push({folder,name,finish:state=>{const task={id:name,root:folder,name,command:'npm run '+name,state,sourceRevision:'test',startedAt:'2026-10-08T12:00:00Z',stale:false,output:'real fixture output',urls:[]};taskRecords.push(task);resolve({success:true,task})}})),
 stopDeveloperTask:id=>new Promise(resolve=>stoppedTasks.push({id,finish:()=>{taskRecords=taskRecords.map(task=>task.id===id?{...task,state:'stopped'}:task);resolve({success:true})}})),
 stageFiles:(folder,paths)=>new Promise(resolve=>stages.push({folder,paths,resolve})),
 unstageFiles:(folder,paths)=>new Promise(resolve=>unstages.push({folder,paths,resolve})),
 getWorkingDiff:(folder,path,scope)=>new Promise(resolve=>diffReads.push({folder,path,scope,resolve})),
 createCommit:async(folder,message)=>{commits.push({folder,message});return{success:true}},
 listBranches:async()=>({success:true,branches:[{name:'main',current:true,isRemote:false},{name:'feature',current:false,isRemote:false},{name:'origin/feature',current:false,isRemote:true}]}),
 checkoutBranch:async(root,branch,options)=>{checkouts.push({root,branch,options});return{success:false,error:'Local changes prevent switching branches.'}}
}
const root=createRoot(document.getElementById('root'))
const flush=async(ms=0)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms))})
let results
function SearchHarness({query='',folder='/repo',active=true,mode='files'}){results=useQuickOpenSearch(folder,query,mode,'',active);return <div>{results.files.map(file=>file.name).join(',')}|{results.pending?'pending':'ready'}</div>}
let include
let developer
function WorkspaceHarness({folder='/repo'}){developer=useDeveloperWorkspace(folder,false);return <div>{developer.workspace?.root}</div>}
let actionController,scriptsController
const actionRefreshes=[]
function ActionsHarness({folder='/repo'}){actionController=useDeveloperActions(folder,async()=>{actionRefreshes.push(folder)},message=>{if(message)actionErrors.push(message)});return null}
function ScriptsHarness({workspace}){
 const [data,setData]=React.useState(workspace)
 scriptsController=useDeveloperActions(workspace.root,async()=>setData(current=>({...current,tasks:[...taskRecords]})),message=>{if(message)actionErrors.push(message)})
 return <div style={{width:284}}><DeveloperTaskList workspace={data} pending={scriptsController.pendingActions} run={scriptsController.run}/></div>
}
function ChangesHarness({workspace}){
 const [data,setData]=React.useState(workspace)
 const actions=useDeveloperActions(workspace.root,async()=>setData(current=>({...current})),message=>{if(message)actionErrors.push(message)})
 return <DeveloperChanges workspace={data} pending={actions.pendingActions} run={actions.run}/>
}
function IncludeHarness({query='',folder='/repo',active=true}){include=useAssistantComposerFileSearch({query,active,roots:[{id:'root',kind:'associated-folder',path:folder,label:'Repo',access:'read-write'}]});return <div>{include.items.map(file=>file.name).join(',')}</div>}
const entry=name=>({path:'/repo/'+name,name,type:'file'})
try{
 await act(async()=>root.render(<SearchHarness/>));await flush(20)
 await act(async()=>requests.shift().resolve({success:true,entries:[entry('first.ts')]}))
 check(results.files[0].name==='first.ts'&&!results.pending,'initial filename results')
 await act(async()=>root.render(<SearchHarness query="second"/>))
 check(results.files[0].name==='first.ts'&&results.pending,'keep results visible but pending for new query')
 await flush(150);const older=requests.shift()
 await act(async()=>root.render(<SearchHarness query="third"/>));await flush(150)
 await act(async()=>requests.shift().resolve({success:true,entries:[entry('third.ts')]}))
 await act(async()=>older.resolve({success:true,entries:[entry('second.ts')]}))
 check(results.files[0].name==='third.ts','late response cannot replace current query')
 await act(async()=>root.render(<SearchHarness query="third" folder="/other"/>))
 check(!results.files.length,'folder switch clears previous folder results')
 await act(async()=>root.render(<SearchHarness active={false}/>));await flush(180)
 requests.length=0
 await act(async()=>root.render(<IncludeHarness/>));await flush(20)
 await act(async()=>requests.shift().resolve({success:true,entries:[entry('first.ts')]}))
 await act(async()=>root.render(<IncludeHarness query="next"/>))
 check(include.items.length===1&&include.loading,'include keeps rows while disabling stale query')
 await flush(210);const cancelled=requests.shift()
 await act(async()=>root.render(<IncludeHarness active={false}/>))
 await act(async()=>cancelled.resolve({success:true,entries:[entry('late.ts')]}))
 check(!include.items.length,'closed include search ignores late response')
 requests.length=0
 await act(async()=>root.render(<MemoryRouter><QuickOpenDialog/></MemoryRouter>))
 await act(async()=>window.dispatchEvent(new CustomEvent('zyra:quick-open',{detail:'files'})));await flush(20)
 check(document.querySelector('[role="combobox"]'),'global quick open dialog is available')
 await act(async()=>requests.shift().resolve({success:true,entries:[entry('open.txt'),entry('missing.txt')]}))
 await act(async()=>[...document.querySelectorAll('[role="option"]')].find(row=>row.textContent.includes('missing.txt')).click())
 check(document.querySelector('[role="alert"]')?.textContent.includes('no longer exists'),'missing file cannot open empty preview')
 await act(async()=>[...document.querySelectorAll('[role="option"]')].find(row=>row.textContent.includes('open.txt')).click())
 check(reads.length===1&&reads[0].path==='/repo/open.txt','file selection reads actual resolved target')
 await act(async()=>reads.shift().resolve({success:true,content:'actual file text',size:16,modifiedAt:1}));await flush(30)
 check(previews.some(preview=>preview.content==='actual file text'&&preview.projectPath==='/repo'),'ready file and correct root reach viewer')
 const unsubscribe=subscribeCodeContext('chat-a',file=>attachments.push(file))
 let selectionChanged
 const model={getValue:()=> 'one\\ntwo\\nthree',getValueInRange:()=> 'two',getVersionId:()=>1}
 const widgetHost=document.createElement('div');widgetHost.style.cssText='width:400px;height:200px';document.body.append(widgetHost)
 // Transport/selection fixture only. Real Monaco geometry is covered separately
 // by test-code-selection-toolbar.mjs, never by these API-shaped adapters.
 const disposable=()=>({dispose(){}})
 const editor={getDomNode:()=>widgetHost,getScrolledVisiblePosition:()=>({left:0,top:20,height:20}),onDidLayoutChange:disposable,onDidChangeModel:disposable,onKeyDown:disposable,focus:()=>{},onDidScrollChange:disposable,getSelection:()=>({startLineNumber:2,endLineNumber:2,endColumn:4,isEmpty:()=>false,getStartPosition:()=>({lineNumber:2,column:1})}),getModel:()=>model,onDidChangeCursorSelection:callback=>{selectionChanged=callback;return{dispose(){}}},onDidChangeModelContent:disposable}
 await act(async()=>root.render(<MemoryRouter><PreviewCodeSelection editor={editor} filePath="/repo/code.ts" workspaceRoot="/repo"/></MemoryRouter>))
 check(document.body.textContent.includes('Lines 2–2'),'selected lines shown next to action')
 await act(async()=>document.querySelector('[data-code-selection] button').click());await flush(20)
 window.testSnapshot.selectedSessionId='chat-b'
 await act(async()=>reads.shift().resolve({success:true,content:'changed on disk',truncated:false}));await flush(20)
 check(attachments.length===1&&attachments[0].selection.text==='two'&&attachments[0].selection.stale,'exact text captured, changed source flagged, attachment stays with original chat')
 const prompt=buildPromptWithContextFiles('Explain this',attachments)
 check(prompt.includes('/repo/code.ts')&&prompt.includes('Lines: 2–2')&&prompt.includes('Source changed')&&prompt.includes('two'),'exact context goes into the real send prompt')
 unsubscribe()
 const workspace={root:'/repo',gitRoot:'/repo',branch:'main',worktrees:[],scripts:{dev:'vite'},runner:'npm',tasks:[{id:'dev',root:'/repo',name:'dev',state:'running',sourceRevision:'x',startedAt:'',command:'npm run dev',stale:false,output:'',urls:[]}]}
 await act(async()=>root.render(<ActionsHarness/>))
 const order=[];let finishWriteA,finishWriteB,writeA,writeB,parallelRead
 await act(async()=>{
  writeA=actionController.run(()=>new Promise(resolve=>{order.push('write-a');finishWriteA=resolve}),'git:write:stage:a')
  writeB=actionController.run(()=>new Promise(resolve=>{order.push('write-b');finishWriteB=resolve}),'git:write:stage:b')
  parallelRead=actionController.run(async()=>{order.push('read')},'git:diff:other')
 })
 check(order.includes('write-a')&&order.includes('read')&&!order.includes('write-b'),'Git writes queue while unrelated reads remain available')
 check(actionController.pendingActions.has('git:write:stage:a')&&actionController.pendingActions.has('git:write:stage:b'),'each queued Git row owns its loading state')
 await act(async()=>{finishWriteA();await writeA;await parallelRead})
 check(order.includes('write-b'),'queued Git action executes instead of being silently dropped')
 await act(async()=>{finishWriteB();await writeB})
 check(actionController.pendingActions.size===0,'all scoped action states clear after acknowledgement')
 await act(async()=>actionController.run(async()=>{throw Error('stage failed')},'git:write:stage:error'))
 check(actionErrors.includes('stage failed')&&actionController.pendingActions.size===0,'failure is reported and releases its queue slot')
 const scriptWorkspace={...workspace,tasks:[],scripts:{'benchmark:analytics':'node analytics','benchmark:runtime-revision':'node revision',lint:'lint'}}
 await act(async()=>root.render(<ScriptsHarness workspace={scriptWorkspace}/>));await flush(20)
 const chipA=document.querySelector('[data-developer-script="benchmark:analytics"]'),chipB=document.querySelector('[data-developer-script="benchmark:runtime-revision"]')
 const boxA=chipA.getBoundingClientRect(),boxB=chipB.getBoundingClientRect()
 check(boxA.height===24&&boxB.top===boxA.top&&boxB.right<=284,'compact chips pack two long script names into the same row')
 check(chipA.querySelector('[aria-label="Run benchmark:analytics"]').getBoundingClientRect().left<chipA.querySelector('[aria-label="View output for benchmark:analytics"]').getBoundingClientRect().left,'play is on the left of the label')
 await act(async()=>document.querySelector('[aria-label="Run benchmark:analytics"]').click())
 check(chipA.getAttribute('aria-busy')==='true'&&!document.querySelector('[aria-label="Run benchmark:runtime-revision"]').disabled,'starting a script affects only its own chip')
 await act(async()=>document.querySelector('[aria-label="Run benchmark:runtime-revision"]').click())
 check(startedTasks.length===2&&startedTasks.every(task=>task.folder==='/repo'),'different scripts reach the actual task-start API independently')
 await act(async()=>startedTasks[0].finish('running'));await flush(20)
 check(document.querySelector('[aria-label="Stop benchmark:analytics"]')&&!document.querySelector('[data-developer-script="lint"]').getAttribute('aria-busy').includes('true'),'running state projects to its chip and leaves unrelated scripts alone')
 await act(async()=>document.querySelector('[aria-label="Stop benchmark:analytics"]').click())
 check(stoppedTasks[0].id==='benchmark:analytics','chip stop uses the actual running task ID')
 await act(async()=>stoppedTasks[0].finish());await flush(20)
 await act(async()=>startedTasks[1].finish('passed'));await flush(20)
 check(document.querySelector('[aria-label="Run benchmark:analytics"]')&&!document.querySelector('[data-developer-script="benchmark:analytics"]').getAttribute('aria-busy').includes('true'),'stopped state clears the chip loader and permits rerun')
 await act(async()=>document.querySelector('[aria-label="View output for benchmark:analytics"]').click());await flush(20)
 check(document.querySelector('pre').textContent==='real fixture output','chip label opens owned task output without auto-opening the whole page on launch')
 await act(async()=>document.querySelector('[aria-label="Back to scripts"]').click());await flush(20)
 await act(async()=>root.render(<DeveloperChanges workspace={workspace} busy={false} run={async action=>action()}/>))
 check(document.body.textContent.includes('Loading changes...')&&!document.body.textContent.includes('Working tree clean'),'changes do not claim clean before reading')
 check(document.body.textContent.includes('Not run'),'running dev server is not counted as a passing check')
 await act(async()=>requests.shift().resolve({success:true,entries:[]}))
 check(document.body.textContent.includes('Working tree clean')&&!document.body.textContent.includes('View unstaged files'),'resolved clean working tree has no misleading recovery action')
 const recentCheck={id:'recent',root:'/repo',name:'lint',state:'failed',startedAt:'2026-10-08T10:00:00Z',command:'npm run lint',output:'',urls:[],stale:false}
 const oldCheck={...recentCheck,id:'old',state:'passed',startedAt:'2026-10-08T09:00:00Z'}
 await act(async()=>root.render(<DeveloperChanges workspace={{...workspace,tasks:[recentCheck,oldCheck]}} busy={false} run={async action=>action()}/>))
 check(document.body.textContent.includes('lint: failed')&&!document.body.textContent.includes('lint: passed'),'latest check uses start time despite persistence ordering')
 requests.length=0
 await act(async()=>root.render(<ChangesHarness workspace={workspace}/>))
 const gitEntries=[{path:'src/a.ts',status:'modified',staged:false,unstaged:true},{path:'src/b.ts',status:'untracked',staged:false,unstaged:true}]
 await act(async()=>requests.shift().resolve({success:true,entries:gitEntries}));await flush(20)
 const scopeButton=name=>[...document.querySelectorAll('[aria-label="Changed file scope"] button')].find(button=>button.textContent.startsWith(name))
 await act(async()=>scopeButton('Staged').click())
 check(document.body.textContent.includes('Nothing staged yet')&&!document.body.textContent.includes('No matching files'),'empty staged scope identifies staging state rather than a failed search')
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='View unstaged files').click())
 check(scopeButton('Unstaged').getAttribute('aria-pressed')==='true'&&document.querySelector('[aria-label="Stage src/a.ts"]'),'empty staged recovery opens the real unstaged file list')
 const fileFilter=document.querySelector('[aria-label="Filter changed files"]')
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(fileFilter,'absent');fileFilter.dispatchEvent(new Event('input',{bubbles:true}))})
 check(document.body.textContent.includes('No matching files')&&!document.body.textContent.includes('Nothing staged yet'),'search empty state remains distinct from staging empty state')
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Clear search').click())
 check(fileFilter.value===''&&document.querySelector('[aria-label="Stage src/a.ts"]'),'clear search restores files within the selected scope')
 await act(async()=>scopeButton('All').click())
 await act(async()=>document.querySelector('[aria-label="Stage src/a.ts"]').click())
 check(document.querySelector('[aria-label="Stage src/a.ts"]').getAttribute('aria-busy')==='true'&&!document.querySelector('[aria-label="Stage src/b.ts"]').disabled&&!document.querySelector('[aria-label="View changes for src/b.ts"]').disabled,'staging shows loading on its row without locking other file controls')
 await act(async()=>document.querySelector('[aria-label="Stage src/b.ts"]').click())
 check(stages.length===1&&stages[0].paths[0]==='src/a.ts','second staged-file request waits for the first index write')
 await act(async()=>stages[0].resolve({success:true}));await flush(20)
 check(stages.length===2&&stages[1].paths[0]==='src/b.ts','queued file staging reaches the API after the first finishes')
 await act(async()=>requests.shift().resolve({success:true,entries:[{...gitEntries[0],staged:true},gitEntries[1]]}))
 await act(async()=>stages[1].resolve({success:true}));await flush(20)
 await act(async()=>requests.shift().resolve({success:true,entries:gitEntries.map(entry=>({...entry,staged:true}))}))
 for(const [label,expected] of [['Staged','staged'],['Unstaged','unstaged'],['All','combined']]){
  await act(async()=>scopeButton(label).click())
  await act(async()=>document.querySelector('[aria-label="View changes for src/a.ts"]').click());await flush(20)
  const read=diffReads.shift()
  check(read?.path==='src/a.ts'&&read.scope===expected,'partially staged file opens the '+expected+' diff in '+label+' scope')
  await act(async()=>read.resolve({success:true,diff:'fixture '+expected+' patch'}));await flush(20)
  if(requests.length)await act(async()=>requests.shift().resolve({success:true,entries:gitEntries.map(entry=>({...entry,staged:true}))}))
  check(document.querySelector('pre')?.textContent.includes('fixture '+expected+' patch'),'selected diff content is visible')
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='src/a.ts').click());await flush(20)
 }
 await act(async()=>scopeButton('Unstaged').click())
 const priorStages=stages.length,priorUnstages=unstages.length
 await act(async()=>(document.querySelector('[aria-label="Stage src/a.ts"]')||document.querySelector('[aria-label="Unstage src/a.ts"]')).click());await flush(20)
 check(stages.length===priorStages+1&&unstages.length===priorUnstages,'partially staged row in Unstaged stages the visible working changes without removing the existing index')
 await act(async()=>stages.at(-1).resolve({success:true}));await flush(20)
 await act(async()=>requests.shift().resolve({success:true,entries:gitEntries.map(entry=>({...entry,staged:true}))}));await flush(20)
 await act(async()=>scopeButton('Staged').click())
 await act(async()=>document.querySelector('[aria-label="Unstage src/a.ts"]').click());await flush(20)
 check(unstages.length===priorUnstages+1,'same partially staged row in Staged uses the explicit unstage action')
 await act(async()=>unstages.at(-1).resolve({success:true}));await flush(20)
 await act(async()=>requests.shift().resolve({success:true,entries:gitEntries.map(entry=>({...entry,staged:true}))}));await flush(20)
 await act(async()=>scopeButton('All').click())
 const messageInput=document.querySelector('[aria-label="Commit message"]')
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(messageInput,'Check review guard');messageInput.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Review commit').click());await flush(20)
 await act(async()=>requests.shift().resolve({success:true,entries:[{...gitEntries[0],staged:true},gitEntries[1]]}));await flush(20)
 await act(async()=>diffReads.shift().resolve({success:true,diff:'reviewed patch'}));await flush(20)
 const confirmation=document.querySelector('[role="dialog"]')
 check(confirmation&&confirmation.textContent.includes('src/a.ts')&&!confirmation.textContent.includes('src/b.ts'),'review uses current canonical staged paths instead of stale displayed entries')
 await act(async()=>requests.shift().resolve({success:true,entries:gitEntries}))
 await act(async()=>[...confirmation.querySelectorAll('button')].find(button=>button.textContent==='Commit').click());await flush(20)
 await act(async()=>diffReads.shift().resolve({success:true,diff:'changed patch'}));await flush(20)
 check(!commits.length&&actionErrors.some(error=>error.includes('Staged changes changed')),'changed staged patch prevents commit even with independent row actions')
 if(requests.length)await act(async()=>requests.shift().resolve({success:true,entries:gitEntries}))
 requests.length=0
 await act(async()=>root.render(<WorkspaceHarness/>))
 await act(async()=>requests.shift().resolve({success:true,workspace}))
 let finishAction, actionPromise
 await act(async()=>{actionPromise=developer.run(()=>new Promise(resolve=>finishAction=resolve))})
 await act(async()=>root.render(<WorkspaceHarness folder="/other"/>))
 await act(async()=>requests.shift().resolve({success:true,workspace:{...workspace,root:'/other'}}))
 await act(async()=>{finishAction();await actionPromise})
 check(developer.workspace.root==='/other'&&!requests.length,'old action completion cannot refresh and overwrite the newly selected root')
 await act(async()=>root.render(<MemoryRouter><div style={{margin:40}}><DeveloperWorkspaceMenu root="/repo"/></div><button id="outside-workspace">Other action</button></MemoryRouter>));await flush(20)
 await act(async()=>requests.shift().resolve({success:true,workspace}));await flush(30)
 await act(async()=>document.querySelector('[aria-label="Developer workspace"]').click());await flush(100)
 const menu=document.querySelector('[data-developer-workspace-menu]')
 check(menu&&menu.getBoundingClientRect().width===320&&menu.getBoundingClientRect().height===280&&!document.querySelector('[role="dialog"]'),'workspace uses the standard 320 by 280 anchored menu')
 check(!document.querySelector('[aria-label="Filter package scripts"]')&&!document.querySelector('[aria-label="New worktree branch"]'),'scripts and chat setup stay tucked until selected')
 const closedHeight=menu.getBoundingClientRect().height
 await act(async()=>[...menu.querySelectorAll('button')].find(button=>button.textContent==='Open in CMD').click());await flush(30)
 check(terminalCalls.length===1&&terminalCalls[0].folder==='/repo'&&terminalCalls[0].shell==='cmd','workspace terminal label and actual launch use the app default shell')
 await act(async()=>document.querySelector('[aria-label="Choose another app"]').click());await flush(350)
 const picker=document.querySelector('[data-anchored-menu-popover][aria-label="Open project in"]')
 check(picker&&!menu.contains(picker)&&menu.getBoundingClientRect().height===closedHeight,'app chooser floats separately without resizing the workspace menu')
 check(getComputedStyle(picker).backgroundColor!=='rgba(0, 0, 0, 0)','app picker has an opaque themed background')
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await flush(350)
 check(document.querySelector('[data-developer-workspace-menu]')&&!document.querySelector('[aria-label="Choose another app"]').getAttribute('aria-expanded').includes('true'),'Escape closes app choices before the workspace menu')
 await act(async()=>document.querySelector('[aria-label="Choose branch"]').click());await flush(50)
 check(document.querySelector('[aria-label="Search branches"]')&&document.querySelectorAll('[role="menuitemradio"]').length===2,'branch picker loads local refs on demand')
 check(!menu.contains(document.querySelector('[aria-label="Search branches"]'))&&menu.getBoundingClientRect().height===closedHeight,'branch chooser also floats without resizing the workspace menu')
 check(document.querySelector('[role="menuitemradio"][aria-checked="true"]').textContent.includes('main'),'current branch stays explicit')
 await act(async()=>[...document.querySelectorAll('[role="menuitemradio"]')].find(row=>row.textContent==='feature').click());await flush(30)
 check(checkouts.length===1&&checkouts[0].root==='/repo'&&checkouts[0].options.autoStash===false,'branch selection uses actual checkout API without silently stashing work')
 check(document.querySelector('[role="alert"]').textContent.includes('Local changes'),'checkout failure stays visible')
 const viewportWidth=window.innerWidth
 Object.defineProperty(window,'innerWidth',{configurable:true,value:300})
 await act(async()=>window.dispatchEvent(new Event('resize')));await flush(30)
 const narrowMenu=document.querySelector('[data-developer-workspace-menu]').getBoundingClientRect()
 check(narrowMenu.left>=8&&narrowMenu.right<=292,'small workspace menu fits a narrow window with both margins')
 await act(async()=>[...document.querySelectorAll('[role="menuitem"]')].find(row=>row.textContent==='Project scripts').click());await flush(20)
 check(document.querySelector('[aria-label="Filter package scripts"]')&&!document.querySelector('[aria-label="Choose branch"]'),'scripts open as a separate compact page')
 check(document.querySelector('[data-developer-workspace-menu]').getBoundingClientRect().height===closedHeight,'deep scripts page preserves the standard height')
 check(document.querySelector('[data-developer-workspace-menu]').getBoundingClientRect().right<=292,'script page also stays inside the narrow window')
 Object.defineProperty(window,'innerWidth',{configurable:true,value:viewportWidth})
 await act(async()=>window.dispatchEvent(new Event('resize')));await flush(20)
 await act(async()=>document.querySelector('[aria-label="Back to workspace menu"]').click());await flush(20)
 check(document.querySelector('[aria-label="Choose branch"]')&&!document.querySelector('[aria-label="Filter package scripts"]'),'back restores small workspace menu')
 await act(async()=>[...document.querySelectorAll('[role="menuitem"]')].find(row=>row.textContent==='Changes').click());await flush(20)
 const changesBox=document.querySelector('[data-developer-workspace-menu]').getBoundingClientRect()
 check(changesBox.width===320&&changesBox.height===closedHeight,'changes page preserves the same standard dimensions')
 await act(async()=>document.querySelector('[aria-label="Back to workspace menu"]').click());await flush(20)
 await act(async()=>document.getElementById('outside-workspace').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));await flush(30)
 check(!document.querySelector('[data-developer-workspace-menu]'),'outside interaction dismisses menu')
 await act(async()=>document.querySelector('[aria-label="Developer workspace"]').click());await flush(30)
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await flush(30)
 check(!document.querySelector('[data-developer-workspace-menu]'),'Escape dismisses menu')
 await act(async()=>root.unmount());console.log('DEVELOPER_RENDERER_PASS')
}catch(error){console.error('DEVELOPER_RENDERER_FAIL '+error.stack)}
`
try {
    const build = await Bun.build({ entrypoints: ['developer-harness'], target: 'browser', loader: {'.svg':'dataurl','.png':'dataurl'}, plugins: [{ name: 'developer-renderer-fixture', setup(builder) {
        builder.onResolve({ filter: /^developer-harness$/ }, () => ({ path: 'harness', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'tsx', resolveDir: resolve(import.meta.dir, '..') }))
        builder.onResolve({ filter: /^@\/lib\/assistant\/assistant-store-hooks$/ }, () => ({ path: 'hooks', namespace: 'mock' }))
        builder.onResolve({ filter: /^@\/lib\/assistant\/assistant-store-core$/ }, () => ({ path: 'store', namespace: 'mock' }))
        builder.onResolve({ filter: /^@\/lib\/settings$/ }, () => ({ path: 'settings', namespace: 'mock' }))
        builder.onResolve({ filter: /^@\/lib\/product-analytics$|^\.\/(?:FileMarkdownPreview|CsvPreviewTable|MonacoPreviewEditor)$/ }, () => ({ path: 'warming', namespace: 'mock' }))
        builder.onResolve({ filter: /(?:^\.\/ui\/FilePreviewModal|^@\/components\/ui\/FilePreviewModal)$/ }, () => ({ path: 'preview', namespace: 'mock' }))
        builder.onResolve({ filter: /^\.\/DiffWorkerPoolProvider$/ }, () => ({ path: 'pool', namespace: 'mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'hooks' ? 'export const useAssistantStoreSelector=selector=>selector({snapshot:window.testSnapshot});export const useAssistantStoreActions=()=>({});' : args.path === 'store' ? 'export const assistantStore={getState:()=>({snapshot:window.testSnapshot})};' : args.path === 'settings' ? 'export const useSettings=()=>({settings:window.testSettings});export const getThemeAppearance=()=>"dark";' : args.path === 'pool' ? 'export const DiffWorkerPoolProvider=({children})=>children;' : args.path === 'preview' ? 'export default props=>{window.testPreviews.push(props);return <div>{props.content}</div>};' : 'export const captureProductEvent=()=>{};export const warmFileMarkdownPreview=()=>{};export default ()=>null;', loader: 'tsx' }))
    } }] })
    if (!build.success) throw new Error(build.logs.join('\n'))
    await writeFile(join(directory, 'harness.js'), await build.outputs[0].text())
    const styles = await postcss([tailwindcss(config)]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })
    const tokens = await readFile(resolve(import.meta.dir, '../src/renderer/src/styles/theme-tokens.css'), 'utf8')
    await writeFile(join(directory, 'test.css'), tokens + '\n' + styles.css)
    await writeFile(join(directory, 'test.html'), '<link rel="stylesheet" href="test.css"><div id="root"></div><script type="module" src="harness.js"></script>')
    await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});window.webContents.on('console-message',event=>{console.log(event.message);if(event.message.includes('DEVELOPER_RENDERER_PASS'))app.exit(0);if(event.message.includes('DEVELOPER_RENDERER_FAIL'))app.exit(1)});await window.loadFile(${JSON.stringify(join(directory,'test.html'))})});setTimeout(()=>app.exit(1),40000);`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const electron = createRequire(import.meta.url)('electron') as string
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(directory, 'main.cjs')]
    const virtualDisplay = process.platform === 'linux' && process.env.CI && !process.env.DISPLAY
    const child = spawn(virtualDisplay ? 'xvfb-run' : electron, virtualDisplay ? ['--auto-servernum', electron, ...args] : args, { env, stdio: 'inherit', windowsHide: true })
    const code = await new Promise<number>((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)) })
    if (code !== 0) throw new Error(`Developer renderer fixture exited ${code}`)
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-developer-renderer-')) throw new Error('Unexpected fixture cleanup path')
    await rm(directory, { recursive: true, force: true })
}
