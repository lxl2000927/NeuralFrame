import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLibrary, modelEligibility, filterLibrary, emptyFilters, applicationState, applicationVerdict, localState, versionSourceDetails, versionSources, versionAcquisition } from '../ui/src/features/libraryCatalog.ts';

const ready = {kind:'selectable',ready:true,label:'',reason:''};
const library = (runtimePacks, packages) => ({definitions:{},runtimePacks,packages});
const local = (id, component='dlss-nr', present=true) => ({id,component,version:'SF-v2',present,source:id,compatibility:ready});

test('acquisition can verify an offline cached release even when another same-file release is not downloadable',()=>{
  const cached=local('cached');
  const row={id:'same-file',packages:[cached],releases:[
    {id:'invalid',downloadable:false,sha256:'a'.repeat(64),size:0},
    {id:'offline',downloadable:true,stale:true,cachedPackageId:cached.id},
  ]};
  const result=versionAcquisition(row);
  assert.equal(result.candidate.id,'offline');assert.equal(result.cached,true);assert.equal(result.disabled,false);
  assert.match(result.notice,/校验/);
  cached.present=false;
  assert.equal(versionAcquisition(row).disabled,true);assert.match(versionAcquisition(row).notice,/重新检查更新/);
  row.releases=[{id:'unverified',downloadable:false}];
  assert.match(versionAcquisition(row).notice,/SHA-256/);
  row.compatibility={kind:'pending',ready:false,assessment:'verify'};
  assert.match(applicationVerdict(row,'89').next,/SHA-256/,'the next step must not tell the user to click a blocked download');
  row.pack={downloaded:false};
  assert.equal(versionAcquisition(row).disabled,false,'a pinned route pack is independent of a failed optional update source');
});

test('component provenance uses recorded upstreams, never the manager archive host or ingestion label',()=>{
  const upstream={name:'SmarterGamers/SmarterGamers-DLSS5-Swapper',url:'https://github.com/SmarterGamers/SmarterGamers-DLSS5-Swapper',kind:'release'};
  const pack={id:'nr',component:'dlss-nr',repository:'lxl2000927/NeuralFrame',packageIds:['cached'],upstreams:[upstream]};
  const data=library([pack],[{...local('cached'),source:'已适配组件缓存'}]);
  const groups=groupLibrary(data,[]),row=groups[0].versions[0];
  assert.deepEqual(versionSourceDetails(row),[upstream]);
  row.packages[0].source='lxl2000927/NeuralFrame';
  row.releases.push({repo:'LXL2000927/NeuralFrame'});
  assert.deepEqual(versionSources(row),[upstream.name]);
  assert.equal(filterLibrary(groups,data,{...emptyFilters,source:'lxl2000927/NeuralFrame'},'89').length,0);
  assert.equal(filterLibrary(groups,data,{...emptyFilters,source:upstream.name},'89')[0].versions[0],row);
  delete pack.upstreams;
  assert.deepEqual(versionSources(row),['组件来源未记录'],'missing provenance is not guessed from a download host');
  row.compatibility={kind:'internal',ready:false};
  assert.deepEqual(versionSources(row),['软件内置']);
});

test('RenoDX retains project and community release provenance and same-name NR sources remain distinct',()=>{
  const upstreams=[{name:'clshortfuse/renodx',kind:'project'},{name:'RankFTW/rhi-repo',kind:'release'}];
  const row={id:'plugin',pack:{upstreams},packages:[],releases:[{repo:'RankFTW/rhi-repo',releaseUrl:'https://github.com/RankFTW/rhi-repo/releases'}]};
  assert.deepEqual(versionSources(row),['clshortfuse/renodx','RankFTW/rhi-repo']);
  const rank={id:'rank',packages:[],releases:[{repo:'RankFTW/rhi-repo',tag:'SF-v2'}]};
  assert.deepEqual(versionSources(rank),['RankFTW/rhi-repo']);
});

test('groups paired, upstream and local copies only through verified fingerprint links', () => {
  const data=library([{id:'nr',component:'dlss-nr',packageIds:['smarter'],compatibility:ready}], [local('smarter'),local('rank')]);
  const releases=[{id:'a',component:'dlss-nr',tag:'SF-v2',cachedPackageId:'smarter'},
    {id:'b',component:'dlss-nr',tag:'SF-v2',cachedPackageId:'rank'}];
  const [{versions}]=groupLibrary(data,releases);
  assert.equal(versions.length,2,'equal version names from different sources must remain separate');
  assert.equal(versions[0].pack.id,'nr');
  assert.deepEqual(versions[0].releases.map(r=>r.id),['a']);
  assert.deepEqual(versions[1].packages.map(p=>p.id),['rank']);
});

test('same asset bytes across releases are one version; unknown hashes are not merged', () => {
  const candidates=['a','a',undefined,undefined].map((sha256,i)=>({id:String(i),component:'dlss-nr',sha256,tag:'same'}));
  const [{versions}]=groupLibrary(library([],[]),candidates);
  assert.equal(versions.length,3);
  assert.equal(versions[0].releases.length,2);
});

test('known upstream bytes share the paired download before anything has been downloaded', () => {
  const data=library([{id:'nr',component:'dlss-nr',packageIds:[],downloaded:false,compatibility:ready}],[]);
  const [{versions}]=groupLibrary(data,[{id:'upstream',component:'dlss-nr',pairedPackId:'nr'}]);
  assert.equal(versions.length,1);
  assert.equal(versions[0].pack.downloaded,false);
  assert.equal(versions[0].releases[0].id,'upstream');
});

test('missing cached files do not become present through a release link; models view excludes other kinds', () => {
  const data=library([], [local('missing','dlss-nr',false),local('fg','dlss-fg')]);
  const result=groupLibrary(data,[{id:'download',component:'dlss-nr',cachedPackageId:'missing'}],true);
  assert.equal(result.length,1);
  assert.equal(result[0].versions[0].packages[0].present,false);
  assert.equal(result[0].versions[0].releases[0].id,'download');
});

test('multi-version route pack retains every linked local variant without duplicate cards', () => {
  const data=library([{id:'feeder',component:'feeder',packageIds:['117','119']}], [local('117','feeder'),local('119','feeder')]);
  const [{versions}]=groupLibrary(data,[{id:'v119',component:'feeder',cachedPackageId:'119'}]);
  assert.equal(versions.length,1);
  assert.equal(versions[0].packages.length,2);
});

test('model application hints distinguish the physical GPU, unverified catalog hints and unknown architectures', () => {
  const row={id:'nr',packages:[],releases:[{component:'dlss-nr'}],modelRequirements:{architectures:['120'],source:'catalog'}};
  assert.equal(modelEligibility(row,'89'),'catalog-incompatible');
  assert.equal(modelEligibility(row,'120'),'catalog-match');
  assert.equal(modelEligibility(row,null),'unknown');
  row.modelRequirements.source='fingerprint';
  assert.equal(modelEligibility(row,'89'),'incompatible');
  assert.equal(modelEligibility(row,'120'),'match');
  delete row.modelRequirements;
  assert.equal(modelEligibility(row,'89'),'unknown');
});

test('filters search historical versions and combine source, local state and hardware eligibility', () => {
  const data=library([], [local('smarter'),local('rank')]);
  data.definitions={'dlss-nr':{name:'NR',files:['nvngx_dlssnr.dll']}};
  const groups=groupLibrary(data,[{id:'old',component:'dlss-nr',tag:'old-310.8',name:'archive.zip',repo:'RankFTW/rhi-repo',compatibility:ready,
    modelRequirements:{architectures:['120'],source:'catalog'}}]);
  const filters={...emptyFilters,query:'NVNGX_DLSSNR.DLL 310.8',source:'RankFTW/rhi-repo',local:'missing',application:'incompatible'};
  assert.equal(filterLibrary(groups,data,filters,'89')[0].versions[0].releases[0].id,'old');
  assert.equal(filterLibrary(groups,data,filters,'120').length,0);
  assert.equal(filterLibrary(groups,data,{...filters,local:'cached'},'89').length,0);
  assert.equal(filterLibrary(groups,data,emptyFilters,'89')[0].versions.length,3);
});

test('cached is distinct from applicability; a matching GPU never overrides pending adaptation', () => {
  const row={id:'pending',packages:[{...local('p'),compatibility:{kind:'pending',ready:false}}],releases:[],
    compatibility:{kind:'pending',ready:false},modelRequirements:{architectures:['89'],source:'fingerprint'}};
  assert.equal(localState(row),'cached');
  assert.equal(applicationState(row,'89'),'unsupported');
  row.packages[0].present=false;
  assert.equal(localState(row),'damaged');
  assert.equal(applicationState(row,'89'),'repair');
  row.packages=[];
  assert.equal(localState(row),'missing');
});

test('component verdict separates acquisition, unsupported files, route versions, hardware and repair without granting readiness',()=>{
  const make=(component,compatibility,packages=[],pack)=>({id:component,packages,releases:[{component,downloadable:true}],compatibility,pack});
  const unknown=make('encore',{kind:'pending',ready:false,assessment:'verify'});
  assert.equal(applicationVerdict(unknown,'89').state,'verify');
  assert.equal(applicationVerdict(unknown,'89').downloadLabel,'下载并校验');
  const unsupported=make('encore',{kind:'pending',ready:false,assessment:'unsupported'},[local('engine','encore')]);
  assert.equal(applicationVerdict(unsupported,'89').state,'unsupported');
  assert.match(applicationVerdict(unsupported,'89').availability,/不能通过 NeuralFrame 应用/);
  assert.match(applicationVerdict(unsupported,'89').reason,/不代表原项目未验证或组件不兼容/);
  const route=make('feeder',{kind:'route',ready:false,assessment:'route-version'});
  assert.equal(applicationVerdict(route,'89').state,'route-version');
  assert.match(applicationVerdict(route,'89').next,/不会更新路线/);
  route.compatibility.assessment='route';route.pack={component:'feeder',downloaded:true};
  assert.equal(applicationVerdict(route,'89').state,'route');
  assert.equal(route.compatibility.ready,false,'presentation must not bypass managed-route installation');
  const model=make('dlss-nr',ready);
  assert.equal(applicationVerdict(model,null).state,'hardware');
  assert.equal(applicationVerdict(model,'89').state,'model-check');
  model.modelRequirements={architectures:['89'],source:'catalog'};
  assert.equal(applicationVerdict(model,'89').state,'verify');
  assert.equal(applicationVerdict(model,'120').state,'incompatible');
  model.modelRequirements.source='fingerprint';
  assert.equal(applicationVerdict(model,'89').state,'selectable');
  assert.match(applicationVerdict(model,'89').availability,/尚未下载/);
  model.packages=[local('model')];
  assert.match(applicationVerdict(model,'89').availability,/可进入游戏页预览/);
  model.packages[0].present=false;
  assert.equal(applicationVerdict(model,'89').state,'repair');
  assert.match(applicationVerdict(model,'89').next,/修复后重新核对/);
});

test('each detailed application filter uses the same assessment shown by its verdict',()=>{
  const rows=['verify','unsupported','route-version','route','internal'].map((assessment,i)=>({id:String(i),packages:[],
    releases:[{component:'feeder'}],compatibility:{assessment,kind:assessment==='internal'?'internal':assessment.startsWith('route')?'route':'pending',ready:false}}));
  const groups=[{component:'feeder',versions:rows}],data=library([],[]);
  for(const row of rows){
    const state=applicationVerdict(row,'89').state;
    assert.deepEqual(filterLibrary(groups,data,{...emptyFilters,application:state},'89')[0].versions,[row]);
  }
});

test('an intact route cache does not hide damaged library variants or exclude them from repair filters', () => {
  const data=library([{id:'feeder',component:'feeder',packageIds:['117','119'],downloaded:true}],
    [local('117','feeder'),local('119','feeder',false)]);
  const groups=groupLibrary(data,[]);
  assert.equal(localState(groups[0].versions[0]),'damaged');
  assert.equal(filterLibrary(groups,data,{...emptyFilters,local:'cached'},null).length,0);
  assert.equal(filterLibrary(groups,data,{...emptyFilters,local:'damaged'},null)[0].versions[0].pack.id,'feeder');
  data.packages[1].present=true;
  assert.equal(localState(groupLibrary(data,[])[0].versions[0]),'cached','repair restores the normal state');
});

test('release row identity survives acquisition so an open detail drawer can update in place', () => {
  const release={id:'stable',component:'dlss-nr',tag:'SF-v2'};
  const before=groupLibrary(library([],[]),[release])[0].versions[0];
  const after=groupLibrary(library([],[local('downloaded')]),[{...release,cachedPackageId:'downloaded'}])[0].versions[0];
  assert.equal(before.id,after.id);
});
