import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=readFileSync(new URL('../background.js',import.meta.url),'utf8').replace(/^import .+;\r?$/gm,'');
const imports=Object.assign({},...await Promise.all([
  'pacs','orchestrator','generic_discovery','tracking_state','save_policy',
  'tracked_tabs','tab_state_store','download_ui_state',
].map(name=>import(`../lib/${name}.js`))));
const key='pacs6_site_recipes';
const url='https://pacs-a.test/custom-manifest';
const seeded=()=>({[key]:{'https://pacs-a.test':{
  manifest:['https://pacs-a.test/custom-manifest?'],dicom:[],updatedAt:Date.now(),
}}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}

function worker(storage=seeded(),{readGate=null,writeGate=null,failRead=false}={}){
  let reads=0,writes=0;
  const event=()=>({addListener(){},removeListener(){}});
  const local={
    get:async name=>{
      reads++;
      if(readGate)await readGate.promise;
      if(failRead)throw new Error('Storage unavailable');
      return structuredClone({[name]:storage[name]});
    },
    set:async values=>{
      const snapshot=structuredClone(values),n=++writes;
      if(n===1&&writeGate)await writeGate.promise;
      Object.assign(storage,snapshot);
    },
  };
  const chrome={
    storage:{local,session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},
    runtime:{onMessage:event(),onInstalled:event(),onStartup:event(),sendMessage:async()=>({ok:true})},
    webNavigation:{onBeforeNavigate:event(),onCommitted:event(),onHistoryStateUpdated:event(),onReferenceFragmentUpdated:event()},
    webRequest:{onBeforeRequest:event(),onBeforeSendHeaders:event(),onHeadersReceived:event()},
    action:{onClicked:event()},tabs:{onCreated:event(),onActivated:event(),onUpdated:event(),onRemoved:event()},
    sidePanel:{setPanelBehavior:async()=>{},setOptions:async()=>{}},downloads:{onChanged:event()},
  };
  const ctx=vm.createContext({...imports,chrome,URL,console,setTimeout:()=>1,clearTimeout(){},appendLog:async()=>{}});
  vm.runInContext(source,ctx);
  return{run:code=>vm.runInContext(code,ctx),storage,chrome,get reads(){return reads;},get writes(){return writes;},
    recover(){failRead=false;}};
}

test('ordinary worker revival restores recipes without install/startup events',async()=>{
  const w=worker();await tick();
  assert.equal(w.run(`isLearnedManifestUrl('${url}')`),true);
  await w.run("learnUrl('https://pacs-b.test/image.dcm')");
  const revived=worker(w.storage);await tick();
  await revived.run("recordCapabilities('https://pacs-c.test/viewer',{directDicom:true})");
  assert.deepEqual(Object.keys(w.storage[key]).sort(),['https://pacs-a.test','https://pacs-b.test','https://pacs-c.test']);
});

for(const writer of [
  "learnUrl('https://pacs-b.test/image.dcm')",
  "recordCapabilities('https://pacs-b.test/viewer',{directDicom:true})",
  "recordAdapterOutcome('https://pacs-b.test/viewer','DICOMWEB',{status:'done'})",
])test(`writer waits for the initial recipe read: ${writer.split('(')[0]}`,async()=>{
  const gate=deferred(),w=worker(seeded(),{readGate:gate});
  const pending=w.run(writer);await tick();
  const writesBeforeLoad=w.writes;
  gate.resolve();await pending;
  assert.equal(writesBeforeLoad,0);
  assert.ok(w.storage[key]['https://pacs-a.test']);
});

test('failed storage read cannot overwrite existing recipes and a later event can retry',async()=>{
  const storage=seeded(),w=worker(storage,{failRead:true});await tick();
  await w.run("learnUrl('https://pacs-b.test/image.dcm')").catch(()=>{});
  assert.equal(w.writes,0);
  assert.deepEqual(Object.keys(storage[key]),['https://pacs-a.test']);
  w.recover();await w.run("learnUrl('https://pacs-b.test/image.dcm')");
  assert.equal(Object.keys(storage[key]).length,2);
});

test('concurrent writers cannot let an older snapshot overwrite a newer recipe',async()=>{
  const gate=deferred(),w=worker(seeded(),{writeGate:gate});await tick();
  const a=w.run("learnUrl('https://pacs-b.test/image.dcm')");await tick();
  const b=w.run("learnUrl('https://pacs-c.test/image.dcm')");await tick();
  gate.resolve();await Promise.all([a,b]);
  assert.deepEqual(Object.keys(w.storage[key]).sort(),['https://pacs-a.test','https://pacs-b.test','https://pacs-c.test']);
});
