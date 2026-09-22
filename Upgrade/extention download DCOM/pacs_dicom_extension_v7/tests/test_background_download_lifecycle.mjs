import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {webcrypto} from 'node:crypto';

// Run the shipped worker with in-memory Chrome/storage/clock boundaries. Adapter
// I/O is deferred explicitly so races do not depend on wall-clock timing.
const source=readFileSync(new URL('../background.js',import.meta.url),'utf8').replace(/^import .+;\r?$/gm,'');
const imports=Object.assign({},...await Promise.all([
  'pacs','orchestrator','generic_discovery','tracking_state','save_policy',
  'tracked_tabs','tab_state_store','download_ui_state','dicomweb_payloads',
].map(name=>import(`../lib/${name}.js`))));
const url='https://pacs.test/viewer?study=1.2.3';
const inventory=()=>({tabId:1,createdAt:12345,studyUid:'1.2.3',adapter:'TEST',patient:{id:'fixture'},
  series:[{id:'series-1',imageCount:2}],context:{completeKnown:true},
  summary:{tabId:1,currentUrl:url,confidence:100,requests:[],frameUrls:[]}});
const activeJob=()=>({tabId:1,id:'job-1',attemptId:'attempt-1',status:'downloading',studyUid:'1.2.3',total:2,completed:0});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}

function worker({job=null,inv=inventory(),contexts=[{contextType:'OFFSCREEN_DOCUMENT'}]}={}){
  const storage={},messages=[],timers=new Map();let timerId=0,scanCount=0;
  const event=()=>({addListener(){},removeListener(){}});
  const store={get:async key=>typeof key==='string'?{[key]:storage[key]}:{...storage},
    set:async values=>Object.assign(storage,structuredClone(values)),
    remove:async keys=>{for(const key of(Array.isArray(keys)?keys:[keys]))delete storage[key];}};
  const chrome={
    storage:{session:store,local:store},
    runtime:{onMessage:event(),onInstalled:event(),onStartup:event(),
      getURL:path=>`chrome-extension://fixture/${path}`,getContexts:async()=>contexts,
      sendMessage:async message=>{messages.push(structuredClone(message));return{ok:true};}},
    webNavigation:{onBeforeNavigate:event(),onCommitted:event(),onHistoryStateUpdated:event(),onReferenceFragmentUpdated:event()},
    webRequest:{onBeforeRequest:event(),onBeforeSendHeaders:event(),onHeadersReceived:event()},
    action:{onClicked:event()},tabs:{onCreated:event(),onActivated:event(),onUpdated:event(),onRemoved:event()},
    sidePanel:{setPanelBehavior:async()=>{},setOptions:async()=>{}},
    downloads:{onChanged:event(),setUiOptions:async()=>{}},
  };
  const context=vm.createContext({...imports,chrome,URL,AbortController,crypto:webcrypto,console,
    setTimeout:(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;},
    clearTimeout:id=>timers.delete(id),appendLog:async()=>{},
    matchingAdapters:()=>[{id:'TEST',analyze:async()=>inventory()}],
    seedInventory:inv,seedJob:job,fixtureUrl:url,
    scanBoundary:async()=>{scanCount++;return inventory().summary;}});
  const evaluate=code=>vm.runInContext(code,context);
  evaluate(source);
  evaluate(`
    tabMemory.set(1,{...defaultState(1),currentUrl:fixtureUrl,mainDocumentId:'doc-1',studyHint:viewerStudyHint(fixtureUrl),tracking:'watching'});
    if(seedInventory)invMemory.set(1,seedInventory);
    if(seedJob)jobMemory.set(1,seedJob);
    scanTab=scanBoundary;setBadge=async()=>{};logEvent=()=>{};
    shouldHandleNavigation=async()=>true;markCandidate=async()=>{};hasOrigin=async()=>false;
  `);
  return{context,evaluate,storage,messages,timers,get scanCount(){return scanCount;},
    async fireTimer(ms){const entry=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(entry,`expected ${ms}ms timer`);timers.delete(entry[0]);await entry[1].callback();},
  };
}

test('uncaptured selected series are rejected before any task enumeration',async()=>{
  const inv=inventory();inv.series[0].downloadReady=false;
  const w=worker({inv});w.evaluate('buildTasks=async()=>{throw new Error("must not enumerate")}');
  await assert.rejects(w.evaluate("startJob(1,['series-1'])"),/not been captured/);
});

test('network JSON capture bounds live metadata without losing discovered URLs',async()=>{
  const w=worker();
  w.evaluate("processGenericManifestPayload=async()=>({valid:[]});tabMemory.get(1).genericDirectUrls=['https://pacs.test/keep.dcm']");
  for(let i=0;i<40;i++){
    w.context.capture={url:`https://pacs.test/series/${i}/metadata`,text:JSON.stringify([{value:'x'.repeat(100000)}])};
    await w.evaluate('handleGenericJsonCapture(1,capture)');
  }
  assert.ok(w.evaluate('Object.keys(tabMemory.get(1).dicomwebPayloads).length')<=32);
  assert.ok(w.evaluate('JSON.stringify(tabMemory.get(1).dicomwebPayloads).length')<=2*1024*1024);
  assert.equal(w.evaluate('tabMemory.get(1).genericDirectUrls.length'),1);
  assert.equal(w.evaluate('tabMemory.get(1).dicomwebPayloadsTruncated'),true);
});

test('a URL evicted by a rebuilt discovery list can be captured again',async()=>{
  const w=worker();
  await w.evaluate("rememberDicomResponse(1,'https://pacs.test/first.dcm','application/dicom',200)");
  w.evaluate("tabMemory.get(1).genericDirectUrls=['https://pacs.test/second.dcm']");
  await w.evaluate("rememberDicomResponse(1,'https://pacs.test/first.dcm','application/dicom',200)");
  assert.equal(w.evaluate("tabMemory.get(1).genericDirectUrls.includes('https://pacs.test/first.dcm')"),true);
});

test('internal study keys survive reanalysis but never match another procedure',()=>{
  const w=worker();
  assert.equal(w.evaluate("jobMatchesInventory({tabId:1,studyKey:'mach7:a',inventoryCreatedAt:1},{tabId:1,context:{studyKey:'mach7:a'},createdAt:2})"),true);
  assert.equal(w.evaluate("jobMatchesInventory({tabId:1,studyKey:'mach7:a',inventoryCreatedAt:1},{tabId:1,context:{studyKey:'mach7:b'},createdAt:1})"),false);
  assert.equal(w.evaluate("historyKey({adapter:'MACH7',patient:{id:'p',studyDate:'20260101'},context:{}})"),'');
});

test('Mach7 history tracks a procedure across learning its real Study UID',async()=>{
  const inv={...inventory(),adapter:'MACH7',studyUid:'',context:{studyKey:'mach7:a'}};
  const w=worker({inv});
  await w.evaluate('upsertHistory(seedInventory,{status:"partial",completed:1})');
  w.evaluate('seedInventory.studyUid="1.2.3"');
  assert.equal((await w.evaluate('findHistory(seedInventory)')).completed,1);
  await w.evaluate('upsertHistory(seedInventory,{status:"done",completed:2})');
  assert.equal(w.storage.pacs6_history.length,1);
  w.evaluate('seedInventory.studyUid="";seedInventory.context.studyKey="mach7:b"');
  assert.equal(await w.evaluate('findHistory(seedInventory)'),null);
});

test('active overview with missing inventory never scans the viewer',async()=>{
  const w=worker({job:activeJob(),inv:null});
  const result=await w.evaluate('currentOverview(1)');
  assert.equal(w.scanCount,0);
  assert.equal(result.summary.currentUrl,url);
  assert.equal(result.job.id,'job-1');
});

test('manual analysis is paused while a job is active',async()=>{
  const w=worker({job:activeJob()});
  const result=await w.evaluate('analyzeTab(1)');
  assert.equal(w.scanCount,0);
  assert.equal(result.studyUid,'1.2.3');
});

for(const interruption of ['download','navigation'])test(`an in-flight analysis cannot publish after ${interruption}`,async()=>{
  const w=worker(),entered=deferred(),result=deferred();
  w.context.matchingAdapters=()=>[{id:'TEST',analyze:async()=>{entered.resolve();return result.promise;}}];
  const pending=w.evaluate('analyzeTab(1)');await entered.promise;
  if(interruption==='download')w.context.nextJob=activeJob(),w.evaluate('jobMemory.set(1,nextJob)');
  else {w.evaluate("tabMemory.get(1).mainDocumentId='doc-2'");await w.evaluate("invalidate(1,'document')");}
  result.resolve({...inventory(),series:[{id:'obsolete'}]});
  await pending;
  const stored=await w.evaluate('getSession(invKey(1))');
  assert.equal(stored?.series?.[0]?.id,interruption==='download'?'series-1':undefined);
});

test('starting task enumeration pauses analysis and prevents duplicate starts',async()=>{
  const w=worker(),entered=deferred(),tasks=deferred();
  w.context.enumerateBoundary=async()=>{entered.resolve();return tasks.promise;};
  w.evaluate('buildTasks=enumerateBoundary');
  const pending=w.evaluate("startJob(1,['series-1'])");await entered.promise;
  await w.evaluate('analyzeTab(1)');
  assert.equal(w.scanCount,0);
  const duplicate=w.evaluate("startJob(1,['series-1'])");
  // Release enumeration before asserting, so a broken reservation cannot hang.
  tasks.resolve([]);
  await assert.rejects(duplicate,/currently downloading/i);
  await assert.rejects(pending,/No DICOM images/i);
  await w.evaluate('analyzeTab(1)');
  assert.equal(w.scanCount,1,'a failed start must release its discovery reservation');
});

test('navigation to another study invalidates active-job inventory',async()=>{
  const w=worker({job:activeJob()});
  await w.evaluate("rememberCommitted({tabId:1,frameId:0,url:'https://pacs.test/viewer?study=9.8.7',documentId:'doc-2',transitionType:'link'})");
  assert.equal(await w.evaluate('getSession(invKey(1))'),null);
  assert.equal(w.evaluate('tabMemory.get(1).studyHint'),imports.viewerStudyHint('https://pacs.test/viewer?study=9.8.7'));
});

test('same-document study changes also invalidate active-job inventory',async()=>{
  const w=worker({job:activeJob()});
  await w.evaluate("rememberSameDocument(1,'https://pacs.test/viewer?study=9.8.7')");
  assert.equal(await w.evaluate('getSession(invKey(1))'),null);
});

test('verified same-study reload preserves ZFP inventory',async()=>{
  const w=worker({job:{...activeJob(),adapter:'ZFP'}});
  await w.evaluate("rememberCommitted({tabId:1,frameId:0,url:fixtureUrl,documentId:'doc-2',transitionType:'reload'})");
  assert.equal((await w.evaluate('getSession(invKey(1))')).studyUid,'1.2.3');
});

test('tokenless ZFP reload uses captured source URL, not overwritten pending URL',async()=>{
  const inv=inventory();inv.summary.currentUrl='https://pacs.test/zfp';
  const w=worker({job:{...activeJob(),adapter:'ZFP'},inv});
  w.evaluate("tabMemory.get(1).currentUrl='https://pacs.test/zfp';tabMemory.get(1).studyHint=''");
  await w.evaluate("rememberCommitted({tabId:1,frameId:0,url:'https://pacs.test/zfp',documentId:'doc-2',transitionType:'reload'})");
  assert.ok(await w.evaluate('getSession(invKey(1))'));
  w.evaluate("tabMemory.get(1).currentUrl='https://pacs.test/other'");
  await w.evaluate("rememberCommitted({tabId:1,frameId:0,url:'https://pacs.test/other',documentId:'doc-3',transitionType:'reload'})");
  assert.equal(await w.evaluate('getSession(invKey(1))'),null);
});

test('terminal progress stays active and slow sidecar writing cannot be finalized by a timer',async()=>{
  const w=worker({job:activeJob()});w.context.finalized=[];
  w.evaluate('finalizeJob=async(tabId,result)=>finalized.push(result)');
  await w.evaluate("handleEngineProgress({tabId:1,jobId:'job-1',attemptId:'attempt-1',status:'done',completed:2,total:2})");
  assert.equal(w.evaluate('jobMemory.get(1).status'),'finishing');
  await w.fireTimer(15000);
  assert.equal(w.context.finalized.length,0);
  assert.equal(w.evaluate('jobMemory.get(1).status'),'finishing');
});

test('missing offscreen during finishing is an interruption, never reported success',async()=>{
  const w=worker({job:activeJob(),contexts:[]});w.context.finalized=[];
  w.evaluate('finalizeJob=async(tabId,result)=>finalized.push(result)');
  await w.evaluate("handleEngineProgress({tabId:1,jobId:'job-1',attemptId:'attempt-1',status:'done',completed:2,total:2})");
  await w.fireTimer(15000);
  assert.equal(w.context.finalized[0]?.status,'error');
});

test('worker revival cannot start a second job while its offscreen document is alive',async()=>{
  const w=worker();w.storage.pacs6_job_1=activeJob();
  w.evaluate("buildTasks=async()=>{throw new Error('duplicate enumeration reached')}");
  await assert.rejects(w.evaluate("startJob(1,['series-1'])"),/currently downloading/i);
});

test('confirmed missing engine permits retry and pins inventory identity on the new job',async()=>{
  const w=worker({job:activeJob(),contexts:[]});
  w.evaluate("buildTasks=async()=>[{sopInstanceUid:'1.2.3.4'}];ensureOffscreen=async()=>{}");
  const job=await w.evaluate("startJob(1,['series-1'])");
  assert.notEqual(job.id,'job-1');
  assert.equal(job.inventoryCreatedAt,12345);
});

test('a live offscreen document without this tab job does not block retry',async()=>{
  const w=worker({job:activeJob()});
  w.context.chrome.runtime.sendMessage=async message=>message.type==='PING_ENGINE'?{ok:true,running:false}:{ok:true};
  w.evaluate("buildTasks=async()=>[{sopInstanceUid:'1.2.3.4'}];ensureOffscreen=async()=>{}");
  const job=await w.evaluate("startJob(1,['series-1'])");
  assert.notEqual(job.id,'job-1');
});

test('an explicit live job in the offscreen document blocks retry',async()=>{
  const w=worker({job:activeJob()});
  w.context.chrome.runtime.sendMessage=async()=>({ok:true,running:true});
  await assert.rejects(w.evaluate("startJob(1,['series-1'])"),/currently downloading/i);
});

test('finalization cannot be interrupted by a second start while history is pending',async()=>{
  const w=worker(),entered=deferred(),history=deferred();
  w.evaluate("buildTasks=async()=>[{sopInstanceUid:'1.2.3.4'}];ensureOffscreen=async()=>{};recordAdapterOutcome=async()=>{};cleanupTabInstrumentation=async()=>{}");
  await w.evaluate("startJob(1,['series-1'])");
  w.context.historyBoundary=async()=>{entered.resolve();return history.promise;};
  w.evaluate('upsertHistory=historyBoundary');
  const pending=w.evaluate("finalizeJob(1,{status:'done',total:1,completed:1,failed:0})");
  await entered.promise;
  await assert.rejects(w.evaluate("startJob(1,['series-1'])"),/currently downloading/i);
  assert.equal(w.evaluate('jobMemory.get(1).status'),'downloading');
  history.resolve(null);await pending;
  assert.equal(w.evaluate('jobMemory.get(1).status'),'done');
});

test('history storage failure cannot hide the authoritative engine result',async()=>{
  const w=worker();
  w.evaluate("buildTasks=async()=>[{sopInstanceUid:'1.2.3.4'}];ensureOffscreen=async()=>{};recordAdapterOutcome=async()=>{};cleanupTabInstrumentation=async()=>{}");
  await w.evaluate("startJob(1,['series-1'])");
  w.evaluate("upsertHistory=async()=>{throw new Error('storage quota')}");
  await w.evaluate("finalizeJob(1,{status:'done',total:1,completed:1,failed:0})");
  assert.equal(w.evaluate('jobMemory.get(1).status'),'done');
  assert.equal(w.messages.filter(m=>m.type==='JOB_UPDATED').at(-1).job.status,'done');
});

test('navigation during task enumeration prevents launching obsolete study tasks',async()=>{
  const w=worker(),entered=deferred(),tasks=deferred();
  w.context.enumerateBoundary=async()=>{entered.resolve();return tasks.promise;};
  w.evaluate('buildTasks=enumerateBoundary;ensureOffscreen=async()=>{}');
  const pending=w.evaluate("startJob(1,['series-1'])");await entered.promise;
  await w.evaluate("rememberCommitted({tabId:1,frameId:0,url:'https://pacs.test/viewer?study=9.8.7',documentId:'doc-2',transitionType:'link'})");
  tasks.resolve([{sopInstanceUid:'1.2.3.4'}]);
  await assert.rejects(pending,/changed/i);
  assert.equal(w.messages.filter(m=>m.type==='START_ENGINE').length,0);
});

test('finishing after navigation records the downloaded study without overwriting the new page',async()=>{
  const w=worker();
  w.evaluate("buildTasks=async()=>[{sopInstanceUid:'1.2.3.4'}];ensureOffscreen=async()=>{};recordAdapterOutcome=async()=>{};cleanupTabInstrumentation=async()=>{}");
  await w.evaluate("startJob(1,['series-1'])");
  w.context.nextInventory={...inventory(),studyUid:'9.8.7',createdAt:67890,patient:{id:'new-patient'}};
  w.evaluate("invMemory.set(1,nextInventory);tabMemory.get(1).studyHint='new-study';tabMemory.get(1).mainDocumentId='doc-2'");
  await w.evaluate("finalizeJob(1,{status:'done',total:1,completed:1,failed:0,completedSopUids:['1.2.3.4']})");
  assert.equal(w.evaluate('jobMemory.get(1).status'),'done');
  assert.equal(w.storage.pacs6_history[0].studyUid,'1.2.3');
  assert.equal(w.storage.pacs6_history[0].status,'done');
  assert.equal((await w.evaluate('getSession(invKey(1))')).studyUid,'9.8.7');
  assert.equal((await w.evaluate('getSession(invKey(1))')).previousDownload,undefined);
  assert.equal(w.evaluate('tabMemory.get(1).tracking'),'watching');
});

test('navigation while final history is being written cannot restore obsolete inventory',async()=>{
  const w=worker(),entered=deferred(),history=deferred();
  w.evaluate("buildTasks=async()=>[{sopInstanceUid:'1.2.3.4'}];ensureOffscreen=async()=>{};recordAdapterOutcome=async()=>{};cleanupTabInstrumentation=async()=>{}");
  await w.evaluate("startJob(1,['series-1'])");
  w.context.historyBoundary=async()=>{entered.resolve();return history.promise;};
  w.evaluate('upsertHistory=historyBoundary');
  const pending=w.evaluate("finalizeJob(1,{status:'done',total:1,completed:1,failed:0})");
  await entered.promise;
  await w.evaluate("rememberCommitted({tabId:1,frameId:0,url:'https://pacs.test/viewer?study=9.8.7',documentId:'doc-2',transitionType:'link'})");
  history.resolve({status:'done',studyUid:'1.2.3',lastDownloadAt:123});await pending;
  assert.equal(await w.evaluate('getSession(invKey(1))'),null);
  assert.equal(w.evaluate('tabMemory.get(1).tracking'),'watching');
});

test('ENGINE_FINISHED can cancel a watchdog already awaiting its context query',async()=>{
  const w=worker({job:activeJob()}),query=deferred(),entered=deferred();w.context.finalized=[];
  w.context.chrome.runtime.getContexts=async()=>{entered.resolve();return query.promise;};
  w.evaluate('finalizeJob=async(tabId,result)=>finalized.push(result)');
  await w.evaluate("handleEngineProgress({tabId:1,jobId:'job-1',attemptId:'attempt-1',status:'done',completed:2,total:2})");
  const pending=w.fireTimer(15000);await entered.promise;
  w.evaluate('clearFinishWatchdog(1)');
  query.resolve([]);await pending;
  assert.equal(w.context.finalized.length,0);
});

test('late progress cannot reopen a finalized job',async()=>{
  const w=worker({job:{...activeJob(),status:'done',completed:2}});
  await w.evaluate("handleEngineProgress({tabId:1,jobId:'job-1',attemptId:'attempt-1',status:'done',completed:2})");
  assert.equal(w.evaluate('jobMemory.get(1).status'),'done');
});
