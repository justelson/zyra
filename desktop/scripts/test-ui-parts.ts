import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UI_PARTS, loadUiPartConfig, validateUiPartConfig } from '../src/shared/ui-parts'
import { describeDevicePreferenceValue, sanitizeDevicePreferenceValue } from '../src/main/setup/device-preferences-service'
import { getDevicePreferenceOwnership } from '../src/shared/preferences/contracts'
import { AgentSettings } from '../src/main/assistant/agent-settings'
const ids = new Set(UI_PARTS.map(p => p.id))
assert.equal(ids.size,UI_PARTS.length)
for (const p of UI_PARTS) {
    if (p.parent) assert(ids.has(p.parent), p.id)
    const seen = new Set<string>(); let node: typeof p | undefined = p
    while(node) { assert(!seen.has(node.id)); seen.add(node.id); node = UI_PARTS.find(v => v.id === node?.parent) }
}
const config = {version:1,overrides:{'sidebar.chatRow':{density:'compact',radius:4,background:'#102030',motion:50}}}
assert.equal(getDevicePreferenceOwnership('appearanceUiParts'),'shared')
assert.deepEqual(describeDevicePreferenceValue('appearanceUiParts').parts,UI_PARTS)
assert.deepEqual(sanitizeDevicePreferenceValue('appearanceUiParts',config),config)
for (const input of [{...config,version:77},{version:1,overrides:{unknown:{}}},{version:1,overrides:{'permission.approval':{radius:1}}},{version:1,overrides:{'sidebar.chatRow':{background:'url(foo)'}}},{version:1,overrides:{'sidebar.chatRow':{radius:-1}}}]) assert.equal(sanitizeDevicePreferenceValue('appearanceUiParts',input),undefined)
assert.deepEqual(validateUiPartConfig({version:1,overrides:{'sidebar.chatRow':{density:'default'}}}),{version:1,overrides:{}})
const legacy = {version:1,overrides:{retiredPart:{background:'#000000'},'chat.composer':{radius:3,retiredProperty:true},'chat.timeline':{background:'#112233'}}}
assert.deepEqual(loadUiPartConfig(legacy),{version:1,overrides:{'chat.composer':{radius:3},'chat.timeline':{background:'#112233'}}})
assert.throws(() => validateUiPartConfig(legacy), 'new writes must remain strict')
const saved: Record<string,unknown> = {}; let revision = 1
const preferences = {get:async()=>({revision,settings:saved}),getAssistantMemoryEnabled:async()=>false,getAssistantMemoryResetValue:async()=>false,update:async(input:{patch:Record<string,unknown>})=>{Object.assign(saved,input.patch);return {revision:++revision}}}
const agent = new AgentSettings(preferences as never,{getHostedAiStatus:async()=>({})} as never)
const patch={appearanceUiParts:config}; const preview=await agent.preview({patch}); assert.deepEqual(preview.changes[0].after,config)
await agent.apply({patch,expectedRevision:preview.revision},false);assert.deepEqual(saved.appearanceUiParts,config)
await assert.rejects(agent.apply({patch,expectedRevision:preview.revision},false),/revision conflict/)
const oldWallpaper = { asset: 'a'.repeat(64), fit: 'contain', x: 28, y: 76 }
assert.deepEqual(sanitizeDevicePreferenceValue('appearanceChatWallpaper', oldWallpaper), oldWallpaper)
for (const opacity of [-1, 101, 0.5, '50', null, NaN]) {
    assert.equal(sanitizeDevicePreferenceValue('appearanceChatWallpaper', { ...oldWallpaper, opacity }), undefined)
}
for (const opacity of [100, 40, 0, 80]) {
    const patch = { appearanceChatWallpaper: { ...oldWallpaper, opacity } }
    const preview = await agent.preview({ patch })
    assert.deepEqual(preview.changes[0].after, patch.appearanceChatWallpaper)
    await agent.apply({ patch, expectedRevision: preview.revision }, false)
    assert.deepEqual(saved.appearanceChatWallpaper, patch.appearanceChatWallpaper)
    await assert.rejects(agent.apply({ patch, expectedRevision: preview.revision }, false), /revision conflict/)
}
const source = (file:string)=>readFileSync(new URL(`../src/renderer/src/pages/assistant/${file}.tsx`,import.meta.url),'utf8')
for (const file of ['AssistantChatSessionsRail','AssistantAgentInboxSidebar']) assert(source(file).includes('data-zyra-part="sidebar.chatRow"'))
console.log(`${ids.size} unique catalog parts; owner validation, agent preview/apply and stale revision checks passed`)
