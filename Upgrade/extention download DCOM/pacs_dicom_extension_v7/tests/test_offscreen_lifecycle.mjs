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
