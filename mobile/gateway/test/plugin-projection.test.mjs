import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPluginCatalog } from '../src/plugin-projection.mjs';

const plugin = id => ({ id, name: id, state: 'active', sourceId: 'source', activeReleaseId: `release-${id}` });
const release = id => ({ id: `release-${id}`, pluginId: id, version: '1.0', contentDigest: 'a'.repeat(64), packagePath: '/private/package', skills: [{name:'Work',description:'Use a tool',relativePath:'/private/skill'}], manifest: {description:'Useful tools', interface:{displayName:id,developerName:'Example'}, contributions:{skills:'/private/skills',mcp:'/private/mcp'}, declaredCapabilityCeiling:['filesystem.read'], secret:'must not leave PC'} });
const catalog = () => ({revision:4, sources:[{id:'source',kind:'local',locator:'/private/source'}], plugins:['Gamma','Alpha','Beta'].map(plugin), releases:['Gamma','Alpha','Beta'].map(release),
  pluginSets:[{ownerKind:'project',ownerId:'visible',revision:2,pluginIds:['Alpha']},{ownerKind:'project',ownerId:'hidden',revision:7,pluginIds:['Secret']}],
  chatScopes:[{sessionId:'chat',scopeRevision:3,plugins:[{pluginId:'Beta',name:'Beta',releaseId:'old-beta',version:'0.9',skillsPath:'/private/pinned'}]},{sessionId:'hidden-chat',plugins:[{name:'Secret'}]}]});

test('unchanged checks are tiny and bind both the resolved chat scope and device authority', () => {
  const value = catalog(), context = {sessionId:'chat',projectId:'visible'};
  const first = projectPluginCatalog(value, context);
  const unchanged = projectPluginCatalog(value, context, {ifVersion:first.viewVersion});
  assert.equal(unchanged.unchanged,true); assert.ok(JSON.stringify(unchanged).length < 140);
  for (const [nextContext, access] of [[{...context,projectId:null},false],[context,true],[{...context,sessionId:'different'},false]]) {
    assert.notEqual(projectPluginCatalog(value,nextContext,{ifVersion:first.viewVersion},access).unchanged,true);
  }
  value.revision++;
  assert.notEqual(projectPluginCatalog(value,context,{ifVersion:first.viewVersion}).unchanged,true);
});

test('only selected project defaults and frozen chat identities are projected, without private paths or other scopes', () => {
  const view=projectPluginCatalog(catalog(),{sessionId:'chat',projectId:'visible'});
  assert.deepEqual(view.defaults,{kind:'project',revision:2,pluginIds:['Alpha'],plugins:[{id:'Alpha',releaseId:'release-Alpha',name:'Alpha',version:'1.0',state:'active'}]});
  assert.deepEqual(view.scope,{revision:3,plugins:[{id:'Beta',releaseId:'old-beta',name:'Beta',version:'0.9',state:'active'}]});
  assert.equal(view.manageMachine,false);assert.equal(view.manageDefaults,true);
  assert.deepEqual(view.plugins.map(p=>p.name),['Alpha','Beta','Gamma']);
  assert.deepEqual(view.plugins[0].contributions,[{kind:'skills',support:'supported'},{kind:'mcp',support:'supported'}]);
  assert.doesNotMatch(JSON.stringify(view),/private|Secret|hidden|must not leave PC/);
});
test('pagination rejects a changed catalog instead of combining incompatible pages', () => {
  const value=catalog();const context={sessionId:'chat',projectId:'visible'};
  const first=projectPluginCatalog(value,context,{limit:2});assert.equal(first.nextCursor,'4:2');
  assert.deepEqual(projectPluginCatalog(value,context,{cursor:first.nextCursor,limit:2}).plugins.map(p=>p.name),['Gamma']);
  value.revision++;assert.throws(()=>projectPluginCatalog(value,context,{cursor:first.nextCursor}),{code:'PLUGIN_CATALOG_CHANGED'});
});
test('restricted phones cannot manage global defaults and disabled plugins stay unselectable', () => {
  const value=catalog();value.plugins[0].state='disabled';
  const restricted=projectPluginCatalog(value,{sessionId:'chat',projectId:null},{query:'Gamma'});
  assert.equal(restricted.manageDefaults,false);assert.equal(restricted.plugins[0].selectable,false);
  assert.equal(projectPluginCatalog(value,{sessionId:'chat',projectId:null},{},true).manageDefaults,true);
  value.plugins.find(plugin=>plugin.id==='Beta').state='disabled';
  assert.equal(projectPluginCatalog(value,{sessionId:'chat',projectId:'visible'}).scope.plugins[0].state,'disabled');
});
