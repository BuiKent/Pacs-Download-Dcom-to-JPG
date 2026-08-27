'use strict';
import { buildPart10FromFrames, isPart10, parseMultipart, numberOfFrames, validatePart10, parseDicomMeta } from './lib/dicom.js';
import { zfpMetaToDicomJson } from './lib/pacs.js';
import { AsyncSemaphore, sleepAbortable, fetchStreamWithTimeout } from './lib/semaphore.js';
import { dicomTaskIdentityError, orderRoutes } from './lib/orchestrator.js';

const FS_DB='pacs_dicom_fs_v1',FS_STORE='handles',FS_KEY='download-root';
const jobs=new Map();
const globalSemaphore = new AsyncSemaphore(12);
const sleep = sleepAbortable;

function openFsDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(FS_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(FS_STORE))r.result.createObjectStore(FS_STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Unable to open directory configuration.'));});}
async function getStoredRoot(){const db=await openFsDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readonly'),r=tx.objectStore(FS_STORE).get(FS_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function ensureWritableRoot(){const h=await getStoredRoot();if(!h)throw new Error('Save folder has not been selected.');return h;}

function headers(task,accept=''){const h=new Headers();for(const[k,v]of Object.entries(task.headers||{})){const lk=k.toLowerCase();if(['cookie','host','content-length','origin','referer'].includes(lk))continue;try{h.set(k,String(v));}catch{}}if(task?.contentType&&!h.has('Content-Type'))h.set('Content-Type',String(task.contentType));if(accept)h.set('Accept',accept);return h;}
function decodeRequestBody(stored){if(!stored)return undefined;if(stored instanceof Uint8Array||stored instanceof ArrayBuffer||typeof stored==='string'||stored instanceof URLSearchParams)return stored;if(stored.kind==='form'){const p=new URLSearchParams();for(const[k,vals]of Object.entries(stored.data||{}))for(const v of(Array.isArray(vals)?vals:[vals]))p.append(k,v);return p;}if(stored.kind==='raw'){const bins=(stored.chunks||[]).map(atob),len=bins.reduce((n,b)=>n+b.length,0),out=new Uint8Array(len);let off=0;for(const b of bins){for(let i=0;i<b.length;i++)out[off+i]=b.charCodeAt(i);off+=b.length;}return out;}return undefined;}
function requestTask(task){const method=String(task?.method||'GET').toUpperCase();return ['GET','HEAD'].includes(method)?task:{...task,method,body:task?.body??decodeRequestBody(task?.requestBody)};}

async function fetchRaw(url,task,accept='',signal){
  return await fetchStreamWithTimeout(url,requestTask(task),accept,signal,globalSemaphore,headers);
}
async function fetchJson(url,task,signal){
  const got=await fetchStreamWithTimeout(url,task,'application/dicom+json, application/json',signal,globalSemaphore,headers,{idleMs:30000,maxMs:60000,connectMs:30000});
  const text=new TextDecoder('utf-8').decode(got.bytes);
  return JSON.parse(text);
}
async function readPrefix(task,maxBytes=512){
  await globalSemaphore.acquire();
  try{
    const method=String(task?.method||'GET').toUpperCase(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const h=headers(task,'application/dicom, application/octet-stream, */*');
      if(['GET','HEAD'].includes(method))h.set('Range',`bytes=0-${Math.max(511,maxBytes-1)}`);
      const req=requestTask(task);
      const r=await fetch(task.url,{method,body:['GET','HEAD'].includes(method)?undefined:req.body,credentials:'include',cache:'no-store',redirect:'follow',headers:h,signal:controller.signal});
      if(!r.ok)return{ok:false,status:r.status,bytes:new Uint8Array(),contentType:r.headers.get('content-type')||''};
      const ct=r.headers.get('content-type')||'';if(ct.toLowerCase().includes('text/html'))return{ok:false,status:r.status,bytes:new Uint8Array(),contentType:ct};
      const reader=r.body?.getReader();if(!reader){const b=new Uint8Array(await r.arrayBuffer());return{ok:isPart10(b),status:r.status,bytes:b.slice(0,maxBytes),contentType:ct};}
      const chunks=[];let total=0;while(total<maxBytes){const x=await reader.read();if(x.done)break;if(x.value?.length){const need=Math.min(x.value.length,maxBytes-total);chunks.push(x.value.slice(0,need));total+=need;}}try{await reader.cancel();}catch{}
      const out=new Uint8Array(total);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return{ok:isPart10(out),status:r.status,bytes:out,contentType:ct};
    }finally{clearTimeout(timer);}
  }catch{return{ok:false,bytes:new Uint8Array(),contentType:''};}finally{globalSemaphore.release();}
}
async function probeDicomPrefix(task){return Boolean((await readPrefix(task,512)).ok);}
async function inspectDicomPrefix(task){const got=await readPrefix(task,256*1024);if(!got.ok)return{url:task?.url||'',ok:false,contentType:got.contentType||''};const meta=parseDicomMeta(got.bytes)||{};return{url:task?.url||'',ok:true,contentType:got.contentType||'',meta};}
async function probeUrls(probes){const rows=(probes||[]).slice(0,96),valid=[];let next=0;async function worker(){while(true){const i=next++;if(i>=rows.length)return;const p=rows[i];if(p?.url&&await probeDicomPrefix(p))valid.push(p.url);}}await Promise.all(Array.from({length:Math.min(6,rows.length||1)},worker));return valid;}
async function inspectUrls(probes){const rows=(probes||[]).slice(0,24),details=[];let next=0;async function worker(){while(true){const i=next++;if(i>=rows.length)return;const p=rows[i];if(!p?.url)continue;details.push(await inspectDicomPrefix(p));}}await Promise.all(Array.from({length:Math.min(4,rows.length||1)},worker));return details;}
function dicomFromResponse(bytes,contentType){const v=validatePart10(bytes);if(v.ok)return bytes;for(const p of parseMultipart(bytes,contentType)){if(validatePart10(p.data).ok)return p.data;}return null;}
function responseProblem(bytes,contentType){const ct=String(contentType||'').toLowerCase();if(ct.includes('text/html'))return'Server returned HTML page instead of DICOM.';if(bytes?.length){const head=new TextDecoder('utf-8',{fatal:false}).decode(bytes.slice(0,160)).toLowerCase();if(head.includes('<html')||head.includes('<!doctype'))return'Server returned login/error page instead of DICOM.';}return'Endpoint did not return DICOM Part-10.';}

async function parallelOrdered(count,limit,fn){const out=new Array(count);let next=0;const n=Math.min(Math.max(1,limit),count);async function worker(){while(true){const i=next++;if(i>=count)return;out[i]=await fn(i);}}await Promise.all(Array.from({length:n},worker));return out;}

async function prepareDicomweb(task,signal,frameConcurrency){
  let first='';
  const candidates=[{route:'wadouri',url:task.url},{route:'wadors',url:task.instanceBase}].filter(c=>c.url);
  for(const c of orderRoutes(candidates,task.preferredRoutes)){
    try{const got=await fetchRaw(c.url,task,'multipart/related; type="application/dicom", application/dicom, */*',signal);const d=dicomFromResponse(got.bytes,got.contentType);if(d)return{bytes:d,provenance:'original',route:c.route};first=responseProblem(got.bytes,got.contentType);}catch(e){first=String(e?.message||e);}
  }
  let meta=task.meta||null;if(Array.isArray(meta))meta=meta[0]||{};
  const enough=meta&&meta['00080016']&&meta['00080018']&&meta['00280010']&&meta['00280011']&&meta['00280100'];if(!enough){const mj=await fetchJson(`${task.instanceBase}/metadata`,task,signal);meta=Array.isArray(mj)?(mj[0]||{}):mj;}
  if(!meta||!Object.keys(meta).length)throw new Error(first||'No instance metadata available.');
  const nf=Math.max(Number(task.numberOfFrames)||1,numberOfFrames(meta));
  const frameResults=await parallelOrdered(nf,frameConcurrency,async i=>{const got=await fetchRaw(`${task.instanceBase}/frames/${i+1}`,task,'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1, multipart/related; type="application/octet-stream", */*',signal);const parts=parseMultipart(got.bytes,got.contentType);return{frames:parts.length?parts.map(p=>p.data):[got.bytes],ct:(parts[0]?.contentType||got.contentType)};});
  const frames=[];let ct='';for(const r of frameResults){ct=ct||r.ct;frames.push(...r.frames);}if(!frames.length)throw new Error(first||'Failed to retrieve image frames.');return{bytes:buildPart10FromFrames(meta,frames,ct),provenance:'reconstructed',route:'frames'};
}

/**
 * GE ZFP: pixel data is received through viewer WebSocket connection and reconstructed to DICOM Part-10.
 */
function zfpBytes(task,packet){
  const bin=atob(packet.b64),pixels=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)pixels[i]=bin.charCodeAt(i);
  const z=task.zfp||{};
  const meta=zfpMetaToDicomJson(packet.meta,z.sopRow,z.group,z.study);
  const bytes=buildPart10FromFrames(meta,[pixels],'application/octet-stream; transfer-syntax=1.2.840.10008.1.2.1');
  const check=validatePart10(bytes);if(!check.ok)throw new Error(check.reason);
  const identityError=dicomTaskIdentityError(task,check.meta);if(identityError)throw new Error(identityError);
  return{bytes,provenance:'reconstructed',meta:check.meta};
}

async function prepareTask(task,signal,frameConcurrency){
  let result;
  if(task.strategy==='dicomweb-instance')result=await prepareDicomweb(task,signal,frameConcurrency);
  else if(task.strategy==='fetch-dicom'){
    const got=await fetchRaw(task.url,task,'application/dicom, multipart/related; type="application/dicom", application/octet-stream, */*',signal);const bytes=dicomFromResponse(got.bytes,got.contentType);if(!bytes)throw new Error(responseProblem(got.bytes,got.contentType));result={bytes,provenance:'original',route:'direct'};
  }else throw new Error(`Unsupported strategy: ${task.strategy}`);
  const check=validatePart10(result.bytes);if(!check.ok)throw new Error(check.reason);const identityError=dicomTaskIdentityError(task,check.meta);if(identityError)throw new Error(identityError);return{...result,meta:check.meta};
}

async function getDir(parent,name){return parent.getDirectoryHandle(name,{create:true});}
async function getPathRoot(root,studyFolder,subfolder='DCom to JPG'){
  let d=root;
  const sub=String(subfolder||'').trim();
  if(sub){
    const segs=sub.split('/').filter(Boolean);
    for(const s of segs)d=await getDir(d,s);
  }
  d=await getDir(d,studyFolder);
  return d;
}
async function resolveDir(root,segments){let d=root;for(const s of segments)d=await getDir(d,s);return d;}
async function existingValid(base,relativePath){const seg=relativePath.split('/').filter(Boolean),file=seg.pop();let d=base;try{for(const s of seg)d=await d.getDirectoryHandle(s,{create:false});const h=await d.getFileHandle(file,{create:false});const f=await h.getFile();if(f.size<256)return null;const b=new Uint8Array(await f.arrayBuffer()),check=validatePart10(b);return check.ok?check.meta:null;}catch{return null;}}
async function writeFile(base,relativePath,bytes){const seg=relativePath.split('/').filter(Boolean),name=seg.pop();const d=await resolveDir(base,seg);const h=await d.getFileHandle(name,{create:true});const w=await h.createWritable({keepExistingData:false});try{await w.write(bytes);await w.close();}catch(e){try{await w.abort();}catch{}throw e;}}
async function writeViaDownloads(subfolder,studyFolder,relativePath,bytes,job){
  const blob=new Blob([bytes],{type:'application/dicom'}),url=URL.createObjectURL(blob);
  const prefix=String(subfolder||'DCom to JPG').trim().replace(/^[/\\]+|[/\\]+$/g,'');
  const prefixPath=prefix?`${prefix}/`:'';
  try{
    const r=await chrome.runtime.sendMessage({type:'DOWNLOAD_BLOB',jobId:job.id,url,filename:`${prefixPath}${studyFolder}/${relativePath}`});
    if(!r?.ok)throw new Error(r?.error||'Failed to save via Chrome downloads.');
  }finally{URL.revokeObjectURL(url);}
}

function emit(job,force=false){const now=Date.now();if(!force&&now-(job.lastEmit||0)<120)return;job.lastEmit=now;chrome.runtime.sendMessage({type:'ENGINE_PROGRESS',tabId:job.tabId,jobId:job.id,attemptId:job.attemptId||'',status:job.status,total:job.total,completed:job.completed,failed:job.failed,skipped:job.skipped,original:job.original||0,reconstructed:job.reconstructed||0,bytesWritten:job.bytesWritten,currentFile:job.currentFile||'',errors:job.errors.slice(-30),updatedAt:now}).catch(()=>{});}

async function commit(job,task,got){
  const identityError=dicomTaskIdentityError(task,got.meta);if(identityError)throw new Error(identityError);
  const sopUid=String(got.meta?.sopInstanceUid||'').trim();
  if(sopUid&&job.completedSopUids?.has(sopUid)){job.skipped++;return false;}
  if(job.saveMode==='filesystem')await writeFile(job.studyRoot,task.relativePath,got.bytes);
  else await writeViaDownloads(job.subfolder,job.studyFolder,task.relativePath,got.bytes,job);
  job.completed++;job.bytesWritten+=got.bytes.byteLength;
  if(got.provenance==='reconstructed')job.reconstructed++;else job.original++;
  if(sopUid&&job.completedSopUids)job.completedSopUids.add(sopUid);
  return true;
}
function failTask(job,relativePath,message){job.failed++;job.errors.push(`${relativePath}: ${message}`);if(job.errors.length>80)job.errors.splice(0,job.errors.length-80);emit(job,true);}

async function runTask(job,task,index){
  if(job.cancelled)throw new DOMException('Cancelled','AbortError');
  const declaredSop=String(task.sopInstanceUid||'').trim();
  if(declaredSop&&job.completedSopUids.has(declaredSop)){
    job.skipped++;
    emit(job);
    return;
  }
  job.currentFile=task.relativePath;
  emit(job);
  const existing=job.saveMode==='filesystem'?await existingValid(job.studyRoot,task.relativePath):null;
  if(existing){
    const identityError=dicomTaskIdentityError(task,existing);if(identityError)throw new Error(identityError);
    const sopUid=String(existing.sopInstanceUid||declaredSop||'').trim();
    if(sopUid&&!job.completedSopUids.has(sopUid)){job.completed++;job.completedSopUids.add(sopUid);}
    job.skipped++;emit(job,true);return;
  }
  let last='';
  for(let attempt=1;attempt<=3;attempt++){
    if(job.cancelled)throw new DOMException('Cancelled','AbortError');
    try{
      const got=job.prefetched?.has(index)?job.prefetched.get(index):await prepareTask(task,job.controller.signal,job.frameConcurrency);
      if(job.prefetched?.has(index))job.prefetched.delete(index);
      await commit(job,task,got);
      if(got.route)job.routeHits.set(got.route,(job.routeHits.get(got.route)||0)+1);
      if(task.strategy==='fetch-dicom'&&task.url)chrome.runtime.sendMessage({type:'ENGINE_LEARNED_URL',tabId:job.tabId,url:task.url}).catch(()=>{});
      emit(job,true);
      return;
    }catch(e){
      last=String(e?.message||e);
      if(e?.name==='AbortError'||job.cancelled)throw e;
      if(/HTTP (401|403|404|410)|HTML instead of DICOM|HTML thay vì DICOM/i.test(last))break;
      if(attempt<3){
        const jitter=Math.floor(Math.random()*100);
        await sleep((attempt===1?350:700)+jitter,job.controller.signal);
      }
    }
  }
  failTask(job,task.relativePath,last);
}

const ZFP_TAKE_MS=25000,ZFP_MAX_RELOADS=2,ZFP_DEADLINE_MS=20*60*1000;
async function zfpTake(tabId,timeoutMs){
  return await chrome.runtime.sendMessage({type:'ZFP_TAKE_REQUEST',tabId,args:{timeoutMs},timeoutMs:timeoutMs+8000})
    .catch(e=>({error:String(e?.message||e)}));
}
async function zfpReload(tabId){
  return await chrome.runtime.sendMessage({type:'ZFP_RELOAD_REQUEST',tabId}).catch(e=>({ok:false,error:String(e?.message||e)}));
}
async function runZfpJob(job,tasks){
  const bySop=new Map();
  for(const t of tasks){const s=String(t.zfp?.sop||'').split('#')[0];if(s)bySop.set(s,t);}
  const done=new Set();let reloads=0,dry=0,lastMeta={};const until=Date.now()+ZFP_DEADLINE_MS;
  while(!job.cancelled&&done.size<bySop.size&&Date.now()<until){
    const r=await zfpTake(job.tabId,ZFP_TAKE_MS);
    if(r&&r.b64){
      dry=0;
      const sop=String(r.sop||''),task=bySop.get(sop);
      if(!task||done.has(sop))continue;          // image of unselected series
      done.add(sop);job.currentFile=task.relativePath;
      try{
        const existing=job.saveMode==='filesystem'?await existingValid(job.studyRoot,task.relativePath):null;
        if(existing){const identityError=dicomTaskIdentityError(task,existing);if(identityError)throw new Error(identityError);const existingSop=String(existing.sopInstanceUid||'').trim();if(!job.completedSopUids.has(existingSop)){job.completed++;job.completedSopUids.add(existingSop);}job.skipped++;emit(job,true);continue;}
        const got=zfpBytes(task,r);if(got.meta&&!lastMeta.patientId)lastMeta=got.meta;
        await commit(job,task,got);emit(job,true);
      }catch(e){failTask(job,task.relativePath,String(e?.message||e));}
      continue;
    }
    dry++;
    if(dry===1&&reloads<ZFP_MAX_RELOADS){
      reloads++;job.currentFile=`Reloading viewer to retrieve remaining ${bySop.size-done.size} images…`;emit(job,true);
      const rl=await zfpReload(job.tabId);
      if(!rl?.ok){job.errors.push(`Failed to reload viewer: ${rl?.error||'unknown reason'}`);break;}
      dry=0;continue;
    }
    if(dry>=3)break;
    await sleep(1500);
  }
  if(!job.cancelled)for(const[sop,t]of bySop){if(done.has(sop))continue;failTask(job,t.relativePath,'Viewer did not load this image — open that series in the viewer and retry.');}
  job.currentFile='';emit(job,true);
  return lastMeta;
}

function safeSegment(text,fallback){const s=String(text||'').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');return(s||fallback).slice(0,120);}
function studyFolderFromInfo(info={}){const name=safeSegment(String(info.patientName||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim(),'Unknown'),id=safeSegment(info.patientId||'NoID','NoID'),raw=String(info.studyDate||'').replace(/[^0-9]/g,''),date=raw.length>=8?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:safeSegment(info.studyDate||'NoDate','NoDate');return`${name} - ${id} - ${date}`;}

async function runJob(spec){
  const saveMode=spec.saveMode==='downloads'?'downloads':'filesystem',root=saveMode==='filesystem'?await ensureWritableRoot():null;const controller=new AbortController();const prefetched=new Map();const info={...(spec.folderInfo||{})};let resolvedMeta={};
  const isZfp=spec.tasks.some(t=>t.strategy==='zfp-image');
  if(!isZfp&&spec.tasks.length&&(!info.patientName||!info.patientId||!info.studyDate||!spec.studyUid)){try{const first=await prepareTask(spec.tasks[0],controller.signal,Math.min(6,Math.max(2,Number(spec.frameConcurrency)||6)));prefetched.set(0,first);const m=first.meta||{};resolvedMeta=m;if(!info.patientName&&m.patientName)info.patientName=m.patientName;if(!info.patientId&&m.patientId)info.patientId=m.patientId;if(!info.studyDate&&m.studyDate)info.studyDate=m.studyDate;}catch{}}
  const subfolder=safeSegment(spec.subfolder||'DCom to JPG','DCom to JPG');
  const studyFolder=studyFolderFromInfo(info)||spec.studyFolder;
  const studyRoot=saveMode==='filesystem'?await getPathRoot(root,studyFolder,subfolder):null;
  const job={
    id:spec.jobId,
    tabId:spec.tabId,
    attemptId:spec.attemptId||'',
    status:'downloading',
    total:Math.max(Number(spec.logicalTotal)||0,(Number(spec.baselineCompleted)||0)+spec.tasks.length),
    completed:Math.max(0,Number(spec.baselineCompleted)||0),
    failed:0,
    skipped:0,
    original:0,
    reconstructed:0,
    bytesWritten:0,
    routeHits:new Map(),
    currentFile:'',
    errors:[],
    cancelled:false,
    controller,
    concurrency:Math.min(10,Math.max(2,Number(spec.concurrency)||6)),
    frameConcurrency:Math.min(10,Math.max(2,Number(spec.frameConcurrency)||6)),
    saveMode,
    subfolder,
    studyFolder,
    studyRoot,
    prefetched,
    lastEmit:0,
    completedSopUids:new Set(spec.alreadyCompletedSopUids||[])
  };
  jobs.set(job.tabId,job);
  emit(job,true);
  let next=0;
  async function worker(){while(true){if(job.cancelled)return;const i=next++;if(i>=spec.tasks.length)return;try{await runTask(job,spec.tasks[i],i);}catch(e){if(job.cancelled||e?.name==='AbortError'||String(e?.message||e).toLowerCase().includes('abort')||String(e?.message||e).toLowerCase().includes('user_canceled'))return;job.failed++;job.errors.push(`${spec.tasks[i]?.relativePath||i}: ${e?.message||e}`);emit(job,true);}}}
  if(isZfp){const m=await runZfpJob(job,spec.tasks);if(m&&!Object.keys(resolvedMeta).length)resolvedMeta=m;}
  else await Promise.all(Array.from({length:Math.min(job.concurrency,Math.max(1,spec.tasks.length))},worker));
  job.status=job.cancelled?'cancelled':job.failed?(job.completed?'done_with_errors':'error'):'done';
  job.currentFile='';
  emit(job,true);
  jobs.delete(job.tabId);
  return{
    status:job.status,
    total:job.total,
    completed:job.completed,
    failed:job.failed,
    skipped:job.skipped,
    original:job.original||0,
    reconstructed:job.reconstructed||0,
    bytesWritten:job.bytesWritten,
    errors:job.errors,
    folderInfo:info,
    resolvedMeta,
    studyFolder,
    saveMode,
    attemptId:job.attemptId||'',
    // Winning route ranking for future downloads on the same PACS.
    preferredRoutes:[...job.routeHits.entries()].sort((a,b)=>b[1]-a[1]).map(([route])=>route),
    completedSopUids:[...job.completedSopUids]
  };
}

chrome.runtime.onMessage.addListener((m,_s,sendResponse)=>{
  if(m?.target!=='offscreen')return false;
  if(m.type==='START_ENGINE'){
    const tabId=Number(m.spec?.tabId);if(jobs.has(tabId)){sendResponse({ok:false,error:'This tab is currently downloading.'});return false;}
    runJob(m.spec).then(result=>chrome.runtime.sendMessage({type:'ENGINE_FINISHED',tabId,jobId:m.spec.jobId,attemptId:m.spec?.attemptId||'',result}).catch(()=>{})).catch(e=>chrome.runtime.sendMessage({type:'ENGINE_FINISHED',tabId,jobId:m.spec.jobId,attemptId:m.spec?.attemptId||'',result:{status:'error',errors:[String(e?.message||e)]}}).catch(()=>{}));
    sendResponse({ok:true,started:true});return false;
  }
  if(m.type==='CANCEL_ENGINE'){const j=jobs.get(Number(m.tabId));if(j){j.cancelled=true;j.controller.abort();chrome.runtime.sendMessage({type:'DOWNLOAD_CANCEL',jobId:j.id}).catch(()=>{});emit(j,true);}sendResponse({ok:true});return false;}
  if(m.type==='PING_ENGINE'){const j=jobs.get(Number(m.tabId));sendResponse({ok:true,running:Boolean(j),job:j?{status:j.status,total:j.total,completed:j.completed,failed:j.failed,skipped:j.skipped,original:j.original||0,reconstructed:j.reconstructed||0,bytesWritten:j.bytesWritten,currentFile:j.currentFile,errors:j.errors}:null});return false;}
  if(m.type==='PROBE_DICOM_URLS'){probeUrls(m.probes||[]).then(valid=>sendResponse({ok:true,valid})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
  if(m.type==='INSPECT_DICOM_URLS'){inspectUrls(m.probes||[]).then(details=>sendResponse({ok:true,details})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
  return false;
});

