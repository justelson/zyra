// Produce an actual cold-start preference snapshot for the renderer fixture.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentSettings } from '../src/main/assistant/agent-settings'
import { DevicePreferencesService } from '../src/main/setup/device-preferences-service'
const dir=await mkdtemp(join(tmpdir(),'zyra-ui-roundtrip-'))
try {
    const file=join(dir,'preferences.json'), owner=new DevicePreferencesService(file)
    const agent=new AgentSettings(owner,{getHostedAiStatus:async()=>({})} as never)
    let events=0; owner.subscribe(()=>events++)
    const apply=async(edits:unknown[])=>{
        const request={surface:'desktop',patch:{appearanceUiParts:{edits}}}
        const preview=await agent.preview(request)
        return agent.apply({...request,expectedRevision:preview.revision},false)
    }
    await apply([{part:'sidebar.chatRow',property:'radius',value:13}])
    await apply([{part:'settings.row',property:'background',value:'#183848'},{part:'settings.row',property:'radius',value:12}])
    const before=await owner.get({surface:'desktop'})
    await assert.rejects(apply([{part:'chat.header',property:'radius',value:1},{part:'permission.approval',property:'background',value:'#ffffff'}]))
    assert.equal((await owner.get({surface:'desktop'})).revision,before.revision)
    assert.equal(events,2)
    const config=(await new DevicePreferencesService(file).get({surface:'desktop'})).settings.appearanceUiParts
    assert.deepEqual(config,{version:1,overrides:{'sidebar.chatRow':{radius:13},'settings.row':{background:'#183848',radius:12}}})
    await apply([{part:'settings.row',property:'radius',value:'theme'}]);assert.deepEqual((await owner.get({surface:'desktop'})).settings.appearanceUiParts,{version:1,overrides:{'sidebar.chatRow':{radius:13},'settings.row':{background:'#183848'}}})
    console.log(JSON.stringify(config))
} finally {await rm(dir,{recursive:true,force:true})}
