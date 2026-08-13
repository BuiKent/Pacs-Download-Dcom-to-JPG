'use strict';
import { buildPart10FromFrames, isPart10, parseMultipart, numberOfFrames, validatePart10 } from './lib/dicom.js';

const FS_DB='pacs_dicom_fs_v1',FS_STORE='handles',FS_KEY='download-root';
const jobs=new Map();
const GLOBAL_LIMIT=12;let globalActive=0;const globalWait=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function openFsDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(FS_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(FS_STORE))r.result.createObjectStore(FS_STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Không mở được cấu hình thư mục.'));});}
async function getStoredRoot(){const db=await openFsDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readonly'),r=tx.objectStore(FS_STORE).get(FS_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function ensureWritableRoot(){const h=await getStoredRoot();if(!h)throw new Error('Chưa chọn thư mục lưu.');if(typeof h.queryPermission==='function'){const p=await h.queryPermission({mode:'readwrite'});if(p!=='granted')throw new Error('Cần cấp lại quyền ghi thư mục.');}return h;}

async function acquireGlobal(){if(globalActive<GLOBAL_LIMIT){globalActive++;return;}await new Promise(resolve=>globalWait.push(resolve));globalActive++;}
function releaseGlobal(){globalActive=Math.max(0,globalActive-1);const n=globalWait.shift();if(n)n();}

function headers(task,accept=''){const h=new Headers();for(const[k,v]of Object.entries(task.headers||{})){const lk=k.toLowerCase();if(['cookie','host','content-length','origin','referer'].includes(lk))continue;try{h.set(k,String(v));}catch{}}if(accept)h.set('Accept',accept);return h;}
async function fetchRaw(url,task,accept='',signal){
  await acquireGlobal();try{const r=await fetch(url,{method:task.method||'GET',credentials:'include',cache:'no-store',redirect:'follow',headers:headers(task,accept),signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return{bytes:new Uint8Array(await r.arrayBuffer()),contentType:r.headers.get('content-type')||''};}finally{releaseGlobal();}
}
async function fetchJson(url,task,signal){await acquireGlobal();try{const r=await fetch(url,{method:'GET',credentials:'include',cache:'no-store',redirect:'follow',headers:headers(task,'application/dicom+json, application/json'),signal});if(!r.ok)throw new Error(`HTTP ${r.status} metadata`);return r.json();}finally{releaseGlobal();}}
async function probeDicomPrefix(task){
  async function attempt(useRange){
    await acquireGlobal();try{
      const h=headers(task,'application/dicom, application/octet-stream, */*');if(useRange)h.set('Range','bytes=0-511');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{
        const r=await fetch(task.url,{method:'GET',credentials:'include',cache:'no-store',redirect:'follow',headers:h,signal:controller.signal});
        if(!r.ok){if(useRange&&[400,405,416].includes(r.status))return null;return false;}
        if((r.headers.get('content-type')||'').toLowerCase().includes('text/html'))return false;
        const reader=r.body?.getReader();if(!reader){const b=new Uint8Array(await r.arrayBuffer());return isPart10(b);}
        const chunks=[];let total=0;while(total<512){const x=await reader.read();if(x.done)break;if(x.value?.length){chunks.push(x.value);total+=x.value.length;}}
        try{await reader.cancel();}catch{}const out=new Uint8Array(total);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return isPart10(out);
      }finally{clearTimeout(timer);}
    }catch{return false;}finally{releaseGlobal();}
  }
  const ranged=await attempt(true);return ranged===null?Boolean(await attempt(false)):Boolean(ranged);
}
async function probeUrls(probes){const rows=(probes||[]).slice(0,12),valid=[];let next=0;async function worker(){while(true){const i=next++;if(i>=rows.length)return;const p=rows[i];if(p?.url&&await probeDicomPrefix(p))valid.push(p.url);}}await Promise.all(Array.from({length:Math.min(3,rows.length||1)},worker));return valid;}
function dicomFromResponse(bytes,contentType){const v=validatePart10(bytes);if(v.ok)return bytes;for(const p of parseMultipart(bytes,contentType)){if(validatePart10(p.data).ok)return p.data;}return null;}
function responseProblem(bytes,contentType){const ct=String(contentType||'').toLowerCase();if(ct.includes('text/html'))return'Server trả trang HTML thay vì DICOM.';if(bytes?.length){const head=new TextDecoder('utf-8',{fatal:false}).decode(bytes.slice(0,160)).toLowerCase();if(head.includes('<html')||head.includes('<!doctype'))return'Server trả trang đăng nhập/lỗi thay vì DICOM.';}return'Endpoint không trả DICOM Part-10.';}

async function parallelOrdered(count,limit,fn){const out=new Array(count);let next=0;const n=Math.min(Math.max(1,limit),count);async function worker(){while(true){const i=next++;if(i>=count)return;out[i]=await fn(i);}}await Promise.all(Array.from({length:n},worker));return out;}

async function prepareDicomweb(task,signal,frameConcurrency){
  let first='';
  for(const url of [task.url,task.instanceBase].filter(Boolean)){
    try{const got=await fetchRaw(url,task,'multipart/related; type="application/dicom", application/dicom, */*',signal);const d=dicomFromResponse(got.bytes,got.contentType);if(d)return{bytes:d,provenance:'original'};first=responseProblem(got.bytes,got.contentType);}catch(e){first=String(e?.message||e);}
  }
  let meta=task.meta||null;if(Array.isArray(meta))meta=meta[0]||{};
  const enough=meta&&meta['00080016']&&meta['00080018']&&meta['00280010']&&meta['00280011']&&meta['00280100'];if(!enough){const mj=await fetchJson(`${task.instanceBase}/metadata`,task,signal);meta=Array.isArray(mj)?(mj[0]||{}):mj;}
  if(!meta||!Object.keys(meta).length)throw new Error(first||'Không có metadata instance.');
  const nf=Math.max(Number(task.numberOfFrames)||1,numberOfFrames(meta));
  const frameResults=await parallelOrdered(nf,frameConcurrency,async i=>{const got=await fetchRaw(`${task.instanceBase}/frames/${i+1}`,task,'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1, multipart/related; type="application/octet-stream", */*',signal);const parts=parseMultipart(got.bytes,got.contentType);return{frames:parts.length?parts.map(p=>p.data):[got.bytes],ct:(parts[0]?.contentType||got.contentType)};});
  const frames=[];let ct='';for(const r of frameResults){ct=ct||r.ct;frames.push(...r.frames);}if(!frames.length)throw new Error(first||'Không lấy được frame ảnh.');return{bytes:buildPart10FromFrames(meta,frames,ct),provenance:'reconstructed'};
}

async function prepareTask(task,signal,frameConcurrency){
  let result;
  if(task.strategy==='dicomweb-instance')result=await prepareDicomweb(task,signal,frameConcurrency);
  else if(task.strategy==='fetch-dicom'){
    const got=await fetchRaw(task.url,task,'application/dicom, multipart/related; type="application/dicom", application/octet-stream, */*',signal);const bytes=dicomFromResponse(got.bytes,got.contentType);if(!bytes)throw new Error(responseProblem(got.bytes,got.contentType));result={bytes,provenance:'original'};
  }else throw new Error(`Strategy không hỗ trợ: ${task.strategy}`);
  const check=validatePart10(result.bytes);if(!check.ok)throw new Error(check.reason);return{...result,meta:check.meta};
}

async function getDir(parent,name){return parent.getDirectoryHandle(name,{create:true});}
async function getPathRoot(root,studyFolder){let d=await getDir(root,'PACS_DICOM');d=await getDir(d,studyFolder);return d;}
async function resolveDir(root,segments){let d=root;for(const s of segments)d=await getDir(d,s);return d;}
async function existingValid(base,relativePath){const seg=relativePath.split('/').filter(Boolean),file=seg.pop();let d=base;try{for(const s of seg)d=await d.getDirectoryHandle(s,{create:false});const h=await d.getFileHandle(file,{create:false});const f=await h.getFile();if(f.size<256)return false;const b=new Uint8Array(await f.arrayBuffer());return validatePart10(b).ok;}catch{return false;}}
async function writeFile(base,relativePath,bytes){const seg=relativePath.split('/').filter(Boolean),name=seg.pop();const d=await resolveDir(base,seg);const h=await d.getFileHandle(name,{create:true});const w=await h.createWritable({keepExistingData:false});try{await w.write(bytes);await w.close();}catch(e){try{await w.abort();}catch{}throw e;}}

function emit(job,force=false){const now=Date.now();if(!force&&now-(job.lastEmit||0)<120)return;job.lastEmit=now;chrome.runtime.sendMessage({type:'ENGINE_PROGRESS',tabId:job.tabId,jobId:job.id,status:job.status,total:job.total,completed:job.completed,failed:job.failed,skipped:job.skipped,original:job.original||0,reconstructed:job.reconstructed||0,bytesWritten:job.bytesWritten,currentFile:job.currentFile||'',errors:job.errors.slice(-30),updatedAt:now}).catch(()=>{});}

async function runTask(job,task,index){if(job.cancelled)throw new DOMException('Cancelled','AbortError');job.currentFile=task.relativePath;emit(job);if(await existingValid(job.studyRoot,task.relativePath)){job.completed++;job.skipped++;emit(job,true);return;}
  let last='';for(let attempt=1;attempt<=3;attempt++){if(job.cancelled)throw new DOMException('Cancelled','AbortError');try{const got=job.prefetched?.has(index)?job.prefetched.get(index):await prepareTask(task,job.controller.signal,job.frameConcurrency);if(job.prefetched?.has(index))job.prefetched.delete(index);await writeFile(job.studyRoot,task.relativePath,got.bytes);job.completed++;job.bytesWritten+=got.bytes.byteLength;if(got.provenance==='reconstructed')job.reconstructed++;else job.original++;if(task.strategy==='fetch-dicom'&&task.url)chrome.runtime.sendMessage({type:'ENGINE_LEARNED_URL',tabId:job.tabId,url:task.url}).catch(()=>{});emit(job,true);return;}catch(e){last=String(e?.message||e);if(e?.name==='AbortError')throw e;if(attempt<3)await sleep(350*attempt);}}
  job.failed++;job.errors.push(`${task.relativePath}: ${last}`);if(job.errors.length>80)job.errors.splice(0,job.errors.length-80);emit(job,true);
}

function safeSegment(text,fallback){const s=String(text||'').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');return(s||fallback).slice(0,120);}
function studyFolderFromInfo(info={}){const name=safeSegment(String(info.patientName||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim(),'Unknown'),id=safeSegment(info.patientId||'NoID','NoID'),raw=String(info.studyDate||'').replace(/[^0-9]/g,''),date=raw.length>=8?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:safeSegment(info.studyDate||'NoDate','NoDate');return`${name} - ${id} - ${date}`;}

async function runJob(spec){
  const root=await ensureWritableRoot();const controller=new AbortController();const prefetched=new Map();const info={...(spec.folderInfo||{})};let resolvedMeta={};
  if(spec.tasks.length&&(!info.patientName||!info.patientId||!info.studyDate||!spec.studyUid)){try{const first=await prepareTask(spec.tasks[0],controller.signal,Math.min(6,Math.max(2,Number(spec.frameConcurrency)||6)));prefetched.set(0,first);const m=first.meta||{};resolvedMeta=m;if(!info.patientName&&m.patientName)info.patientName=m.patientName;if(!info.patientId&&m.patientId)info.patientId=m.patientId;if(!info.studyDate&&m.studyDate)info.studyDate=m.studyDate;}catch{}}
  const studyFolder=studyFolderFromInfo(info)||spec.studyFolder;const studyRoot=await getPathRoot(root,studyFolder);const job={id:spec.jobId,tabId:spec.tabId,status:'downloading',total:spec.tasks.length,completed:0,failed:0,skipped:0,original:0,reconstructed:0,bytesWritten:0,currentFile:'',errors:[],cancelled:false,controller,concurrency:Math.min(10,Math.max(2,Number(spec.concurrency)||6)),frameConcurrency:Math.min(10,Math.max(2,Number(spec.frameConcurrency)||6)),studyRoot,prefetched,lastEmit:0};jobs.set(job.tabId,job);emit(job,true);
  let next=0;async function worker(){while(true){if(job.cancelled)return;const i=next++;if(i>=spec.tasks.length)return;try{await runTask(job,spec.tasks[i],i);}catch(e){if(e?.name==='AbortError')return;job.failed++;job.errors.push(`${spec.tasks[i]?.relativePath||i}: ${e?.message||e}`);emit(job,true);}}}
  await Promise.all(Array.from({length:Math.min(job.concurrency,Math.max(1,spec.tasks.length))},worker));job.status=job.cancelled?'cancelled':job.failed?(job.completed?'done_with_errors':'error'):'done';job.currentFile='';emit(job,true);jobs.delete(job.tabId);return{status:job.status,total:job.total,completed:job.completed,failed:job.failed,skipped:job.skipped,original:job.original||0,reconstructed:job.reconstructed||0,bytesWritten:job.bytesWritten,errors:job.errors,folderInfo:info,resolvedMeta,studyFolder};
}

chrome.runtime.onMessage.addListener((m,_s,sendResponse)=>{
  if(m?.target!=='offscreen')return false;
  if(m.type==='START_ENGINE'){
    const tabId=Number(m.spec?.tabId);if(jobs.has(tabId)){sendResponse({ok:false,error:'Tab này đang tải.'});return false;}
    runJob(m.spec).then(result=>chrome.runtime.sendMessage({type:'ENGINE_FINISHED',tabId,jobId:m.spec.jobId,result}).catch(()=>{})).catch(e=>chrome.runtime.sendMessage({type:'ENGINE_FINISHED',tabId,jobId:m.spec.jobId,result:{status:'error',errors:[String(e?.message||e)]}}).catch(()=>{}));
    sendResponse({ok:true,started:true});return false;
  }
  if(m.type==='CANCEL_ENGINE'){const j=jobs.get(Number(m.tabId));if(j){j.cancelled=true;j.controller.abort();emit(j,true);}sendResponse({ok:true});return false;}
  if(m.type==='PING_ENGINE'){const j=jobs.get(Number(m.tabId));sendResponse({ok:true,running:Boolean(j),job:j?{status:j.status,total:j.total,completed:j.completed,failed:j.failed,skipped:j.skipped,original:j.original||0,reconstructed:j.reconstructed||0,bytesWritten:j.bytesWritten,currentFile:j.currentFile,errors:j.errors}:null});return false;}
  if(m.type==='PROBE_DICOM_URLS'){probeUrls(m.probes||[]).then(valid=>sendResponse({ok:true,valid})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
  return false;
});
