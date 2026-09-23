import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=readFileSync(new URL('../offscreen.js',import.meta.url),'utf8').replace(/^import .+;\r?$/gm,'');
const imports=Object.assign({},...await Promise.all(['dicom','pacs','semaphore','orchestrator'].map(name=>import(`../lib/${name}.js`))));

test('offscreen job stays running until asynchronous lock cleanup finishes',async()=>{
  let releaseCleanup,enteredCleanup,listener;
  const entered=new Promise(resolve=>{enteredCleanup=resolve;});
  const cleanup=new Promise(resolve=>{releaseCleanup=resolve;});
  const context=vm.createContext({...imports,AbortController,console,
    chrome:{runtime:{sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>{listener=fn;}}}},
    cleanupBoundary:()=>{enteredCleanup();return cleanup;},
  });
  vm.runInContext(source,context);
  vm.runInContext('clearStudyLock=cleanupBoundary',context);
  // No tasks and downloads mode avoid all filesystem/network work. The real
  // runJob finally block and PING_ENGINE handler still execute.
  const pending=vm.runInContext("runJob({jobId:'fixture',tabId:1,tasks:[],saveMode:'downloads',studyFolder:'fixture'})",context);
  await entered;
  let reply;
  listener({target:'offscreen',type:'PING_ENGINE',tabId:1},{},value=>{reply=value;});
  assert.equal(reply.running,true,'pending cleanup still owns the job');
  releaseCleanup();await pending;
  listener({target:'offscreen',type:'PING_ENGINE',tabId:1},{},value=>{reply=value;});
  assert.equal(reply.running,false,'the job leaves the registry only after cleanup');
});

test('a run of network refusals stops the job instead of requesting every image',async()=>{
  const realFetch=globalThis.fetch;let requests=0;
  // The engine's transport lives in lib/semaphore.js and uses this realm's fetch.
  globalThis.fetch=async()=>{requests++;throw new TypeError('Failed to fetch');};
  try{
    const context=vm.createContext({...imports,AbortController,console,Headers,TextDecoder,TextEncoder,
      chrome:{runtime:{sendMessage:async()=>({ok:true}),onMessage:{addListener(){}}}},
    });
    vm.runInContext(source,context);
    const tasks=Array.from({length:60},(_,i)=>({strategy:'fetch-dicom',url:`http://pacs.blocked/dicom/${i}`,relativePath:`s/IM_${i}.dcm`}));
    const result=await vm.runInContext('runJob',context)({jobId:'fixture',tabId:1,tasks,saveMode:'downloads',studyFolder:'fixture',
      folderInfo:{patientName:'fixture',patientId:'fixture',studyDate:'20260101'},studyUid:'1.2.3'});
    assert.equal(result.status,'error');
    assert.ok(result.failed>=24&&result.failed<60,`failed=${result.failed}`);
    assert.ok(result.errors.some(e=>e.startsWith('Stopped after 24 images')));
    assert.ok(result.errors.some(e=>e.includes('lacks site permission')));
    assert.ok(requests<60*3,`requests=${requests}`);
  }finally{globalThis.fetch=realFetch;}
});
