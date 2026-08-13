'use strict';

import {
  cleanUrl, classifyPacsUrl, viewerUrlScore, originPattern, parseVradManifest,
  parseVrpacsManifest, parseDicomwebSeries, deriveDicomweb, bestDetectedRequest,
  dicomJsonValue, sanitizeSegment, seriesFolderName, safeHeaders, NON_IMAGE_MODALITIES,
  viewerStudyHint, classifyViewerShell
} from './lib/pacs.js';
import { isPart10, parseMultipart, parseDicomMeta } from './lib/dicom.js';

const TAB_PREFIX='pacs_tab_';
const INV_PREFIX='pacs_inv_';
const JOB_PREFIX='pacs_job_';
const HISTORY_KEY='pacs_history_v2';
const MAX_HISTORY=80;
const MAX_NAV_URLS=40, MAX_REQUESTS=300;
const CAPTURE_DB='pacs_dicom_capture_v3';
const CAPTURE_STORE='files';
const AUTO_ARM_SCORE=52;
const DEEP_ARM_SCORE=64;
const MAX_CAPTURED_META=4000;
let offscreenCreating=null;
const runningJobs=new Map();
const autoAnalyzeTimers=new Map();
const contextCheckTimers=new Map();
const downloadWaiters=new Map();
const cdpPending=new Map();
const cdpRequests=new Map();
const debuggerAttached=new Set();

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const tabKey=(id)=>`${TAB_PREFIX}${id}`;
const invKey=(id)=>`${INV_PREFIX}${id}`;
const jobKey=(id)=>`${JOB_PREFIX}${id}`;

async function getSession(key, fallback=null) { const o=await chrome.storage.session.get(key); return o[key] ?? fallback; }
async function setSession(key,val) { await chrome.storage.session.set({[key]:val}); }

async function getHistory() {
  const o=await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(o[HISTORY_KEY]) ? o[HISTORY_KEY] : [];
}
function historyIdentity(inv) {
  const uid=String(inv?.studyUid||'').trim();
  if(uid)return `study|${uid}`;
  const patient=String(inv?.patient?.id||'').trim();
  const date=String(inv?.patient?.studyDate||'').trim();
  const desc=String(inv?.patient?.description||'').trim();
  if(patient && (date||desc))return `patient|${patient}|${date}|${desc}`;
  const link=(inv?.linkHashes||[])[0]||'';
  return link?`link|${link}`:'';
}

function isDownloadedStatus(status) {
  return String(status||'') === 'done';
}

async function hashText(value) {
  const bytes=new TextEncoder().encode(String(value||''));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function summaryLinkHashes(summary) {
  const urls=[summary?.bestViewerUrl,summary?.currentUrl,...(summary?.navUrls||[]),...(summary?.frameUrls||[])].filter(Boolean);
  const unique=[...new Set(urls)].slice(0,12);
  const out=[];
  for(const u of unique)out.push(await hashText(u));
  return out;
}

async function findHistoryMatch(inv) {
  const list=await getHistory();
  const uid=String(inv?.studyUid||'').trim();
  if(uid){const hit=list.find(x=>String(x.studyUid||'')===uid);if(hit)return hit;}
  const hashes=new Set(inv?.linkHashes||[]);
  if(hashes.size){const hit=list.find(x=>(x.linkHashes||[]).some(h=>hashes.has(h)));if(hit)return hit;}
  const pid=String(inv?.patient?.id||'').trim();
  const date=String(inv?.patient?.studyDate||'').trim();
  const desc=String(inv?.patient?.description||'').trim().toLowerCase();
  if(pid && date){
    const hit=list.find(x=>String(x.patientId||'').trim()===pid && String(x.studyDate||'').trim()===date && (!desc || !x.description || String(x.description).trim().toLowerCase()===desc));
    if(hit)return hit;
  }
  return null;
}

async function upsertHistory(inv, patch={}) {
  if(!inv)return;
  const key=historyIdentity(inv); if(!key)return;
  const list=await getHistory();
  let idx=list.findIndex(x=>x.key===key || (inv.studyUid && x.studyUid===inv.studyUid));
  if(idx<0 && (inv.linkHashes||[]).length){const hashes=new Set(inv.linkHashes||[]);idx=list.findIndex(x=>(x.linkHashes||[]).some(h=>hashes.has(h)));}
  if(idx<0){
    const pid=String(inv.patient?.id||'').trim(),date=String(inv.patient?.studyDate||'').trim(),desc=String(inv.patient?.description||'').trim().toLowerCase();
    if(pid&&date)idx=list.findIndex(x=>String(x.patientId||'').trim()===pid&&String(x.studyDate||'').trim()===date&&(!desc||!x.description||String(x.description).trim().toLowerCase()===desc));
  }
  const old=idx>=0?list[idx]:{};
  const safePatch={...patch};
  if(isDownloadedStatus(old.status) && safePatch.status && safePatch.status!=='done') delete safePatch.status;
  const item={
    ...old,
    key,
    adapter:inv.adapter||old.adapter||'',
    studyUid:inv.studyUid||old.studyUid||'',
    patientName:inv.patient?.name||old.patientName||'',
    patientId:inv.patient?.id||old.patientId||'',
    studyDate:inv.patient?.studyDate||old.studyDate||'',
    description:inv.patient?.description||old.description||'',
    seriesCount:inv.series?.length||old.seriesCount||0,
    linkHashes:[...new Set([...(old.linkHashes||[]),...(inv.linkHashes||[])])].slice(0,16),
    ...safePatch,
    updatedAt:Date.now()
  };
  if(idx>=0)list.splice(idx,1);
  list.unshift(item);
  if(list.length>MAX_HISTORY)list.length=MAX_HISTORY;
  await chrome.storage.local.set({[HISTORY_KEY]:list});
  chrome.runtime.sendMessage({type:'HISTORY_UPDATED',history:list}).catch(()=>{});
  return item;
}

function pushUnique(list,value,max) { if(!value)return; const i=list.indexOf(value); if(i>=0)list.splice(i,1); list.push(value); if(list.length>max)list.splice(0,list.length-max); }

function openCaptureDb() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(CAPTURE_DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(CAPTURE_STORE)){
        const store=db.createObjectStore(CAPTURE_STORE,{keyPath:'key'});
        store.createIndex('tabId','tabId',{unique:false});
        store.createIndex('createdAt','createdAt',{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Không mở được bộ đệm DICOM.'));
  });
}

async function cachePut(record,bytes) {
  const db=await openCaptureDb();
  const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type:'application/dicom'});
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(CAPTURE_STORE,'readwrite');
    tx.objectStore(CAPTURE_STORE).put({...record,blob,createdAt:Date.now()});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  db.close();
}

async function cachePutJson(record,payload) {
  const db=await openCaptureDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(CAPTURE_STORE,'readwrite');
    tx.objectStore(CAPTURE_STORE).put({...record,payload,createdAt:Date.now()});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  db.close();
}

async function cacheGetJson(key) {
  if(!key)return undefined;
  const db=await openCaptureDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(CAPTURE_STORE,'readonly');
      const req=tx.objectStore(CAPTURE_STORE).get(key);
      req.onsuccess=()=>resolve(req.result?.payload);req.onerror=()=>reject(req.error);
    });
  }finally{db.close();}
}

async function capturedJsonPayload(state,url,kind='') {
  const row=[...(state?.capturedJson||[])].reverse().find(x=>(!url||x.url===url)&&(!kind||x.kind===kind));
  if(!row)return undefined;
  if(Object.prototype.hasOwnProperty.call(row,'payload'))return row.payload;
  if(row.cacheKey)return cacheGetJson(row.cacheKey);
  return undefined;
}

async function cacheDeleteTab(tabId) {
  const db=await openCaptureDb();
  const keys=await new Promise((resolve,reject)=>{
    const tx=db.transaction(CAPTURE_STORE,'readonly');
    const req=tx.objectStore(CAPTURE_STORE).index('tabId').getAllKeys(IDBKeyRange.only(tabId));
    req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
  });
  if(keys.length)await new Promise((resolve,reject)=>{
    const tx=db.transaction(CAPTURE_STORE,'readwrite'),store=tx.objectStore(CAPTURE_STORE);
    for(const key of keys)store.delete(key);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  db.close();
}

async function cacheDeleteOld(maxAgeMs=12*60*60*1000) {
  const cutoff=Date.now()-maxAgeMs,db=await openCaptureDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(CAPTURE_STORE,'readwrite');
    const idx=tx.objectStore(CAPTURE_STORE).index('createdAt');
    const req=idx.openCursor(IDBKeyRange.upperBound(cutoff));
    req.onsuccess=()=>{const cur=req.result;if(cur){cur.delete();cur.continue();}};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  db.close();
}

async function getTabState(tabId) {
  return await getSession(tabKey(tabId), {tabId,navUrls:[],pendingNavUrls:[],frameUrls:[],pacsRequests:[],headersByOrigin:{},currentUrl:'',mainDocumentId:'',studyHint:'',tracking:'idle',trackingMode:'',trackingStartedAt:0,stoppedDocumentId:'',confidence:0,confidenceReasons:[],cdpAttached:false,capturedDicoms:[],capturedJson:[],genericSignals:[],genericDirectUrls:[],genericDirectMeta:{},genericProfile:{},pageHintScore:0,pageHintReasons:[],bodyProbeCount:0,updatedAt:Date.now()});
}
async function saveTabState(tabId,state) { state.updatedAt=Date.now(); await setSession(tabKey(tabId),state); }


function urlConfidence(raw) {
  const shell=classifyViewerShell(raw);
  return Math.max(0,viewerUrlScore(raw)||0,shell?.score||0);
}

async function setTabBadge(tabId) {
  if(tabId<0)return;
  const state=await getTabState(tabId);
  const inv=await getSession(invKey(tabId));
  const job=await getSession(jobKey(tabId));
  let text='',color='#64748b',title='PACS DICOM Downloader';
  if(job && job.tabId===tabId && ['preparing','downloading','cancelling'].includes(job.status)){text='↓';color='#2563eb';title='Đang tải DICOM';}
  else if(inv?.previousDownload && isDownloadedStatus(inv.previousDownload.status)){text='✓';color='#168a52';title='Study này đã tải';}
  else if(inv?.series?.length){text=String(Math.min(99,inv.series.length));color='#168a52';title=`Đã nhận diện ${inv.series.length} series`;}
  else if(state.tracking==='watching'){text='•';color='#2563eb';title='Đang theo dõi PACS';}
  else if(state.tracking==='stopped'){text='Ⅱ';color='#7c8798';title='Đã dừng theo dõi tab này';}
  await chrome.action.setBadgeBackgroundColor({tabId,color}).catch(()=>{});
  await chrome.action.setBadgeText({tabId,text}).catch(()=>{});
  await chrome.action.setTitle({tabId,title}).catch(()=>{});
}

async function attachRecorder(tabId) {
  if(tabId<0 || debuggerAttached.has(tabId))return true;
  let attached=false;
  try{
    await chrome.debugger.attach({tabId},'0.1');attached=true;debuggerAttached.add(tabId);
    await chrome.debugger.sendCommand({tabId},'Network.enable',{maxTotalBufferSize:268435456,maxResourceBufferSize:134217728,maxPostDataSize:8388608});
    try{await chrome.debugger.sendCommand({tabId},'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'iframe',exclude:false},{type:'worker',exclude:false},{type:'shared_worker',exclude:false},{type:'service_worker',exclude:false}]});}catch{}
    const s=await getTabState(tabId);s.cdpAttached=true;s.tracking='watching';s.trackingStartedAt=s.trackingStartedAt||Date.now();s.lastTrackingError='';await saveTabState(tabId,s);await setTabBadge(tabId);
    chrome.runtime.sendMessage({type:'TRACKING_UPDATED',tabId,tracking:'watching'}).catch(()=>{});
    return true;
  }catch(e){
    if(attached){try{await chrome.debugger.detach({tabId});}catch{}}
    debuggerAttached.delete(tabId);
    const s=await getTabState(tabId);s.cdpAttached=false;s.lastTrackingError=String(e?.message||e);await saveTabState(tabId,s);await setTabBadge(tabId);return false;
  }
}

async function detachRecorder(tabId) {
  if(tabId<0)return;
  try{await chrome.debugger.detach({tabId});}catch{}
  debuggerAttached.delete(tabId);
  const s=await getTabState(tabId);s.cdpAttached=false;await saveTabState(tabId,s);
}

async function startTracking(tabId,mode='auto',deep=false) {
  if(tabId<0)return false;
  const s=await getTabState(tabId);
  if(mode==='auto' && s.tracking==='stopped' && s.stoppedDocumentId && s.stoppedDocumentId===(s.mainDocumentId||s.studyHint||s.currentUrl))return false;
  s.tracking='watching';s.trackingMode=mode;s.trackingStartedAt=s.trackingStartedAt||Date.now();s.lastTrackingError='';
  await saveTabState(tabId,s);await setTabBadge(tabId);
  if(deep)await attachRecorder(tabId);
  chrome.runtime.sendMessage({type:'TRACKING_UPDATED',tabId,tracking:'watching'}).catch(()=>{});
  return true;
}

async function stopTracking(tabId) {
  if(tabId<0)return;
  await detachRecorder(tabId);
  const s=await getTabState(tabId);s.tracking='stopped';s.trackingMode='manual';s.stoppedDocumentId=s.mainDocumentId||s.studyHint||s.currentUrl||String(Date.now());await saveTabState(tabId,s);await setTabBadge(tabId);
  chrome.runtime.sendMessage({type:'TRACKING_UPDATED',tabId,tracking:'stopped'}).catch(()=>{});
}

async function maybeAutoArmUrl(tabId,raw) {
  const url=cleanUrl(raw);if(tabId<0||!url)return;
  const shell=classifyViewerShell(url),score=Math.max(urlConfidence(url),shell?.score||0);
  if(score<AUTO_ARM_SCORE)return;
  const deep=Boolean(shell && ['TOKEN_PORTAL','SHARE_STUDY','PATIENT_PORTAL','VIEWER_SHELL','RIS_VRVIEWER','VRAD_SHELL'].includes(shell.type));
  const s=await getTabState(tabId);s.confidence=Math.max(Number(s.confidence)||0,Math.min(100,Math.round(score)));await saveTabState(tabId,s);
  await startTracking(tabId,'auto',deep || score>=92);
}

async function maybeAutoArmSignal(tabId,hit) {
  if(tabId<0||!hit)return;
  const s=await getTabState(tabId);
  const strong=Number(hit.score||0)>=80;
  s.confidence=Math.max(Number(s.confidence)||0,Math.min(100,Number(hit.score||0)));
  await saveTabState(tabId,s);
  if(strong)await startTracking(tabId,'auto',false);
  else if(hit.type==='PACS_GENERIC_API' && s.confidence>=AUTO_ARM_SCORE)await startTracking(tabId,'auto',true);
}

async function applyPageHints(tabId,hint={}) {
  if(tabId<0)return;
  const s=await getTabState(tabId);
  const score=Math.max(0,Math.min(100,Number(hint.score)||0));
  s.pageHintScore=Math.max(Number(s.pageHintScore)||0,score);
  s.pageHintReasons=[...new Set([...(s.pageHintReasons||[]),...(hint.reasons||[])])].slice(-12);
  s.confidence=Math.max(Number(s.confidence)||0,score);
  for(const raw of (hint.iframeUrls||[])){
    const u=cleanUrl(raw);if(!u)continue;pushUnique(s.frameUrls,u,MAX_NAV_URLS);
  }
  await saveTabState(tabId,s);
  if(score>=AUTO_ARM_SCORE && s.tracking!=='stopped'){
    const deep=score>=DEEP_ARM_SCORE || (hint.reasons||[]).some(r=>['portal-host','viewer-url','cornerstone','medical-port'].includes(r));
    await startTracking(tabId,'auto',deep);
  }
  await setTabBadge(tabId);
}

async function trackingOverview() {
  const all=await chrome.storage.session.get(null);
  const rows=[];
  for(const [key,state] of Object.entries(all)){
    if(!key.startsWith(TAB_PREFIX)||!state||state.tracking!=='watching')continue;
    let tab=null;try{tab=await chrome.tabs.get(Number(state.tabId));}catch{}
    if(!tab)continue;
    const inv=all[invKey(Number(state.tabId))]||null;
    rows.push({tabId:Number(state.tabId),title:tab.title||state.currentUrl||'PACS',url:tab.url||state.currentUrl||'',confidence:Number(state.confidence)||0,ready:Boolean(inv?.series?.length),seriesCount:inv?.series?.length||0,adapter:inv?.adapter||''});
  }
  rows.sort((a,b)=>Number(b.ready)-Number(a.ready)||b.confidence-a.confidence);
  return rows.slice(0,20);
}

async function invalidateInventory(tabId, reason='navigation') {
  await chrome.storage.session.remove(invKey(tabId));
  chrome.runtime.sendMessage({type:'TAB_CONTEXT_CHANGED',tabId,reason}).catch(()=>{});
}

function scheduleBackgroundAnalyze(tabId, delay=700) {
  if(tabId<0)return;
  const old=autoAnalyzeTimers.get(tabId);if(old)clearTimeout(old);
  autoAnalyzeTimers.set(tabId,setTimeout(async()=>{
    autoAnalyzeTimers.delete(tabId);
    try{
      const inv=await analyzeTab(tabId);
      chrome.runtime.sendMessage({type:'INVENTORY_UPDATED',tabId,inventory:inv}).catch(()=>{});
    }catch{}
  },delay));
}

function scheduleContextRecheck(tabId, oldHint) {
  const old=contextCheckTimers.get(tabId);if(old)clearTimeout(old);
  contextCheckTimers.set(tabId,setTimeout(async()=>{
    contextCheckTimers.delete(tabId);
    try{
      const s=await getTabState(tabId);
      if(!oldHint || s.studyHint!==oldHint)return;
      let viewerVisible=false;
      try{const perfs=await scanPerformance(tabId);viewerVisible=(perfs||[]).some(p=>Boolean(p.viewerDom));}catch{}
      const recent=(s.pacsRequests||[]).some(r=>Date.now()-Number(r.time||0)<5000);
      if(viewerVisible||recent)return;
      s.studyHint='';s.capturedDicoms=[];s.capturedJson=[];s.genericDirectUrls=[];s.genericDirectMeta={};s.genericProfile={};
      await saveTabState(tabId,s);await cacheDeleteTab(tabId);await invalidateInventory(tabId,'viewer_left');await setTabBadge(tabId);
    }catch{}
  },1800));
}

async function rememberBeforeNavigate(tabId,raw) {
  if(tabId<0)return; const url=cleanUrl(raw); if(!url)return;
  const s=await getTabState(tabId);
  s.pendingNavUrls = s.pendingNavUrls || [];
  pushUnique(s.pendingNavUrls,url,MAX_NAV_URLS);
  s.currentUrl=url;
  await saveTabState(tabId,s);
  maybeAutoArmUrl(tabId,url).catch(()=>{});
}

async function rememberCommitted(d) {
  if(d.tabId<0 || d.frameId!==0)return; const url=cleanUrl(d.url); if(!url)return;
  const s=await getTabState(d.tabId);
  const changedDocument = Boolean(s.mainDocumentId && d.documentId && s.mainDocumentId!==d.documentId);
  if(changedDocument) {
    const pending=[...(s.pendingNavUrls||[])];
    s.navUrls=[]; for(const u of pending)pushUnique(s.navUrls,u,MAX_NAV_URLS);
    s.pacsRequests=[]; s.frameUrls=[];s.capturedDicoms=[];s.capturedJson=[];s.genericSignals=[];s.genericDirectUrls=[];s.genericDirectMeta={};s.genericProfile={};s.pageHintScore=0;s.pageHintReasons=[];s.bodyProbeCount=0;s.confidence=0;
    cacheDeleteTab(d.tabId).catch(()=>{});
    s.studyHint=viewerStudyHint(url)||'';
    if(s.tracking==='stopped'){s.tracking='idle';s.stoppedDocumentId='';}
    await invalidateInventory(d.tabId,'document');
  }
  pushUnique(s.navUrls,url,MAX_NAV_URLS);
  s.pendingNavUrls=[]; s.currentUrl=url; s.mainDocumentId=d.documentId||s.mainDocumentId||'';
  if(!s.studyHint)s.studyHint=viewerStudyHint(url)||'';
  await saveTabState(d.tabId,s);
  maybeAutoArmUrl(d.tabId,url).catch(()=>{});
}

async function rememberSameDocument(tabId,raw) {
  if(tabId<0)return; const url=cleanUrl(raw); if(!url)return;
  const s=await getTabState(tabId);
  const oldHint=s.studyHint||''; const newHint=viewerStudyHint(url)||'';
  if(oldHint && newHint && oldHint!==newHint) {
    s.navUrls=[]; s.pacsRequests=[]; s.frameUrls=[];s.capturedDicoms=[];s.capturedJson=[];s.genericSignals=[];s.genericDirectUrls=[];s.genericDirectMeta={};s.genericProfile={};s.pageHintScore=0;s.pageHintReasons=[];s.bodyProbeCount=0;s.confidence=0;
    cacheDeleteTab(tabId).catch(()=>{});s.studyHint=newHint;
    if(s.tracking==='stopped'){s.tracking='idle';s.stoppedDocumentId='';}
    await invalidateInventory(tabId,'study');
  } else if(!oldHint && newHint) s.studyHint=newHint;
  pushUnique(s.navUrls,url,MAX_NAV_URLS); s.currentUrl=url; await saveTabState(tabId,s);
  if(oldHint&&!newHint)scheduleContextRecheck(tabId,oldHint);
  maybeAutoArmUrl(tabId,url).catch(()=>{});
}

async function rememberRequest(tabId,raw,source='network',extra={}) {
  if(tabId<0)return; const hit=classifyPacsUrl(raw); if(!hit)return;
  const s=await getTabState(tabId); const id=`${hit.type}|${hit.url}`;
  const idx=s.pacsRequests.findIndex(x=>`${x.type}|${x.url}`===id); if(idx>=0)s.pacsRequests.splice(idx,1);
  s.pacsRequests.push({...hit,...extra,source,time:Date.now()});
  if(s.pacsRequests.length>MAX_REQUESTS)s.pacsRequests.splice(0,s.pacsRequests.length-MAX_REQUESTS);
  await saveTabState(tabId,s);
  maybeAutoArmSignal(tabId,hit).catch(()=>{});
  if(Number(hit.score||0)>=80 || ['PACS_GENERIC_API','DICOM_IMAGE_API'].includes(hit.type))scheduleBackgroundAnalyze(tabId,900);
  chrome.runtime.sendMessage({type:'PACS_SIGNAL',tabId,signal:hit.type}).catch(()=>{});
}

async function rememberFrameCommitted(d) {
  if(d.tabId<0 || d.frameId===0)return;
  const url=cleanUrl(d.url); if(!url)return;
  const s=await getTabState(d.tabId);
  pushUnique(s.frameUrls,url,MAX_NAV_URLS);
  await saveTabState(d.tabId,s);
  maybeAutoArmUrl(d.tabId,url).catch(()=>{});
}
chrome.webNavigation.onBeforeNavigate.addListener(d=>{if(d.frameId===0)rememberBeforeNavigate(d.tabId,d.url);});
chrome.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0)rememberCommitted(d);else rememberFrameCommitted(d);});
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>{if(d.frameId===0)rememberSameDocument(d.tabId,d.url);else rememberFrameCommitted(d);});
chrome.webNavigation.onReferenceFragmentUpdated.addListener(d=>{if(d.frameId===0)rememberSameDocument(d.tabId,d.url);else rememberFrameCommitted(d);});

function bytesToBase64(bytes) {
  const a=new Uint8Array(bytes||0); let s=''; const chunk=0x8000;
  for(let i=0;i<a.length;i+=chunk)s+=String.fromCharCode(...a.subarray(i,i+chunk));
  return btoa(s);
}
function serializeRequestBody(rb) {
  if(!rb)return null;
  if(rb.formData)return {kind:'form',data:rb.formData};
  if(Array.isArray(rb.raw)&&rb.raw.length){
    const chunks=[]; for(const part of rb.raw)if(part.bytes)chunks.push(bytesToBase64(part.bytes));
    if(chunks.length)return {kind:'raw',chunks};
  }
  return null;
}
chrome.webRequest.onBeforeRequest.addListener(d=>{
  if(d.tabId<0)return;
  const hit=classifyPacsUrl(d.url);if(!hit)return;
  const sensitive=/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(d.url);
  const requestBody=(!sensitive && !['GET','HEAD'].includes(String(d.method||'GET').toUpperCase())) ? serializeRequestBody(d.requestBody) : null;
  rememberRequest(d.tabId,d.url,'webRequest',{method:d.method,requestBody});
},{urls:['http://*/*','https://*/*']},['requestBody','extraHeaders']);
chrome.webRequest.onBeforeSendHeaders.addListener(d=>{
  if(d.tabId<0 || !classifyPacsUrl(d.url))return;
  (async()=>{
    const h={}; for(const item of (d.requestHeaders||[])) if(item.name && item.value!=null)h[item.name]=item.value;
    const sh=safeHeaders(h); if(!Object.keys(sh).length)return;
    const s=await getTabState(d.tabId); let origin=''; try{origin=new URL(d.url).origin;}catch{return;}
    s.headersByOrigin[origin]={...(s.headersByOrigin[origin]||{}),...sh}; await saveTabState(d.tabId,s);
  })();
},{urls:['http://*/*','https://*/*']},['requestHeaders','extraHeaders']);


function debuggerKey(source,requestId) {
  return `${source.tabId}|${source.sessionId||'root'}|${requestId}`;
}

function decodeDebuggerBody(body,base64Encoded) {
  if(!base64Encoded)return new TextEncoder().encode(String(body||''));
  const bin=atob(String(body||'')),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

async function hashBytes(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function mergeProfile(old,meta={}) {
  const next={...(old||{})};
  const map={patientName:'patientName',patientId:'patientId',studyDate:'studyDate',studyUid:'studyUid',studyDescription:'studyDescription'};
  for(const [k,dst] of Object.entries(map))if(!next[dst]&&meta[k])next[dst]=String(meta[k]);
  return next;
}

async function captureDicomBytes(tabId,bytes,info={}) {
  const parts=[];
  if(isPart10(bytes))parts.push(bytes);
  else for(const part of parseMultipart(bytes,info.contentType||''))if(isPart10(part.data))parts.push(part.data);
  if(!parts.length)return 0;
  let added=0;
  for(const part of parts){
    const meta=parseDicomMeta(part)||{};
    const identity=meta.sopInstanceUid||await hashBytes(part);
    const key=`tab:${tabId}:dicom:${identity}`;
    const state=await getTabState(tabId);
    if((state.capturedDicoms||[]).some(x=>x.key===key))continue;
    const record={key,tabId,size:part.byteLength,url:info.url||'',method:info.method||'GET',contentType:info.contentType||'application/dicom',...meta};
    await cachePut(record,part);
    state.capturedDicoms=[...(state.capturedDicoms||[]),record].slice(-MAX_CAPTURED_META);
    state.genericProfile=mergeProfile(state.genericProfile,meta);
    state.confidence=100;
    state.tracking=state.tracking==='stopped'?'stopped':'watching';
    await saveTabState(tabId,state);
    added++;
  }
  if(added){
    await setTabBadge(tabId);
    scheduleBackgroundAnalyze(tabId,250);
    chrome.runtime.sendMessage({type:'PACS_SIGNAL',tabId,signal:'CAPTURED_DICOM'}).catch(()=>{});
  }
  return added;
}

function looksLikeVradPayload(payload) {
  const data=payload?.data??payload;
  const study=Array.isArray(data)?data[0]:data;
  return Boolean(study && Array.isArray(study.SeriesList));
}

function looksLikeVrpacsPayload(payload) {
  return Boolean(payload?.data && Array.isArray(payload.data.studyList) && payload.data.studyList.some(x=>Array.isArray(x?.seriesList)));
}

function harvestGenericJson(payload,baseUrl) {
  const direct=new Set();
  const profile={};
  let nodes=0;
  const seen=new WeakSet();
  const setFirst=(name,value)=>{if(!profile[name]&&value!=null&&String(value).trim())profile[name]=String(value).trim();};
  const walk=(value,key='')=>{
    if(nodes++>12000||value==null)return;
    if(typeof value==='string'){
      const text=value.trim();
      const lk=String(key||'').toLowerCase();
      if(/patient.?name|pat.?name/.test(lk))setFirst('patientName',text);
      if(/patient.?id|pat.?id|patient.?code/.test(lk))setFirst('patientId',text);
      if(/study.?date|exam.?date/.test(lk))setFirst('studyDate',text);
      if(/study(instance)?uid|stuinsuid/.test(lk))setFirst('studyUid',text);
      if(/study.?description|exam.?description/.test(lk))setFirst('studyDescription',text);
      if(/^(?:wadouri:|wadors:|dicomweb:)/i.test(text) || /\.dcm(?:\?|$)/i.test(text) || /requesttype=wado/i.test(text)){
        try{let raw=text.replace(/^(?:wadouri:|wadors:|dicomweb:)/i,'');direct.add(new URL(raw,baseUrl).href);}catch{}
      }
      return;
    }
    if(typeof value!=='object')return;
    if(seen.has(value))return;seen.add(value);
    if(Array.isArray(value)){for(const v of value)walk(v,key);return;}
    for(const [k,v] of Object.entries(value))walk(v,k);
  };
  walk(payload);
  return {directUrls:[...direct].slice(0,5000),profile};
}

async function captureJsonPayload(tabId,payload,info={}) {
  const state=await getTabState(tabId);
  let kind='GENERIC';
  if(looksLikeVradPayload(payload))kind='VRAD';
  else if(looksLikeVrpacsPayload(payload))kind='VRPACS';
  const harvested=harvestGenericJson(payload,info.url||state.currentUrl||'');
  const urlHit=classifyPacsUrl(info.url||'');
  const cacheableDicomJson=urlHit && ['QIDO_SERIES','QIDO_INSTANCES','DICOM_METADATA'].includes(urlHit.type);
  if(kind!=='GENERIC' || cacheableDicomJson){
    const cacheKind=kind!=='GENERIC'?kind:'DICOMWEB_JSON';
    const cacheKey=`tab:${tabId}:json:${cacheKind}:${await hashText(info.url||String(Date.now()))}`;
    await cachePutJson({key:cacheKey,tabId,kind:'json',url:info.url||'',jsonKind:cacheKind},payload);
    state.capturedJson=[...(state.capturedJson||[]).filter(x=>!(x.kind===cacheKind&&x.url===info.url)),{kind:cacheKind,url:info.url||'',cacheKey,time:Date.now()}].slice(-80);
    if(kind!=='GENERIC'){
      const type=kind==='VRAD'?'VRAD_MANIFEST':'VRPACS_MANIFEST';
      const idx=(state.pacsRequests||[]).findIndex(x=>x.type===type&&x.url===info.url);
      if(idx>=0)state.pacsRequests.splice(idx,1);
      state.pacsRequests.push({type,url:info.url||'',score:100,source:'cdp-body',time:Date.now(),capturedBody:true,method:info.method||'GET'});
    }
  }
  state.genericDirectUrls=[...new Set([...(state.genericDirectUrls||[]),...harvested.directUrls])].slice(-5000);
  state.genericProfile={...(state.genericProfile||{}),...Object.fromEntries(Object.entries(harvested.profile).filter(([,v])=>v))};
  if(kind!=='GENERIC'||harvested.directUrls.length)state.confidence=Math.max(Number(state.confidence)||0,85);
  await saveTabState(tabId,state);
  if(kind!=='GENERIC'||harvested.directUrls.length){
    scheduleBackgroundAnalyze(tabId,350);
    chrome.runtime.sendMessage({type:'PACS_SIGNAL',tabId,signal:kind==='GENERIC'?'GENERIC_DICOM_URLS':`${kind}_MANIFEST`}).catch(()=>{});
  }
}

function shouldInspectResponse(state,url,mime='') {
  const m=String(mime||'').toLowerCase();
  if(m.includes('application/dicom')||m.includes('multipart/related')||m.includes('application/octet-stream'))return 'binary';
  if(m.includes('application/json')||m.includes('dicom+json')||m.includes('text/json')){
    const clue=classifyPacsUrl(url)||/(study|series|instance|dicom|pacs|viewer|image|exam|patient|share)/i.test(url);
    if(clue || Number(state.confidence||0)>=AUTO_ARM_SCORE)return 'json';
  }
  return '';
}

function directDicomCandidate(url,mime,hit,method='GET') {
  if(String(method||'GET').toUpperCase()!=='GET')return false;
  const m=String(mime||'').toLowerCase();
  if(m.includes('application/dicom'))return true;
  if(/\.dcm(?:\?|$)/i.test(url||''))return true;
  return Boolean(hit && ['WADO','DICOM_INSTANCE','DICOM_IMAGE_API','VRPACS_DICOM'].includes(hit.type));
}

async function rememberGenericDirect(tabId,url,meta={}) {
  const clean=cleanUrl(url);if(!clean)return;
  const s=await getTabState(tabId);
  s.genericDirectUrls=[...new Set([...(s.genericDirectUrls||[]),clean])].slice(-5000);
  s.genericDirectMeta={...(s.genericDirectMeta||{}),[clean]:{method:meta.method||'GET',headers:safeHeaders(meta.headers||{}),contentType:meta.contentType||''}};
  s.confidence=Math.max(Number(s.confidence)||0,90);
  await saveTabState(tabId,s);
  scheduleBackgroundAnalyze(tabId,500);
}

async function handleDebuggerEvent(source,method,params) {
  const tabId=Number(source?.tabId);if(tabId<0)return;
  if(method==='Target.attachedToTarget'){
    const child={...source,sessionId:params.sessionId};
    try{await chrome.debugger.sendCommand(child,'Network.enable',{maxTotalBufferSize:268435456,maxResourceBufferSize:134217728,maxPostDataSize:8388608});}catch{}
    try{await chrome.debugger.sendCommand(child,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'iframe',exclude:false},{type:'worker',exclude:false},{type:'shared_worker',exclude:false},{type:'service_worker',exclude:false}]});}catch{}
    return;
  }
  if(method==='Network.requestWillBeSent'){
    const r=params.request||{},key=debuggerKey(source,params.requestId);
    const hit=classifyPacsUrl(r.url||'');
    const sensitive=/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(r.url||'');
    const state=await getTabState(tabId);
    const armed=state.tracking==='watching' && Number(state.confidence||0)>=AUTO_ARM_SCORE;
    const authHeaders=(!sensitive && (hit||armed))?safeHeaders(r.headers||{}):{};
    cdpRequests.set(key,{tabId,url:r.url||'',method:r.method||'GET',requestBody:(!sensitive&&hit&&r.postData)?{kind:'text',text:r.postData}:null,headers:authHeaders,time:Date.now()});
    if(hit)rememberRequest(tabId,r.url,'cdp',{method:r.method||'GET',requestBody:(!sensitive&&r.postData)?{kind:'text',text:r.postData}:null}).catch(()=>{});
    return;
  }
  if(method==='Network.responseReceived'){
    const response=params.response||{},url=response.url||'',mime=response.mimeType||response.headers?.['content-type']||response.headers?.['Content-Type']||'';
    const state=await getTabState(tabId);
    const kind=shouldInspectResponse(state,url,mime);
    if(!kind)return;
    if(Number(state.bodyProbeCount||0)>=1200)return;
    state.bodyProbeCount=Number(state.bodyProbeCount||0)+1;await saveTabState(tabId,state);
    const key=debuggerKey(source,params.requestId),req=cdpRequests.get(key)||{};
    const contentType=String(response.headers?.['content-type']||response.headers?.['Content-Type']||mime);
    const hit=classifyPacsUrl(url);
    cdpPending.set(key,{source:{...source},requestId:params.requestId,url,contentType,mime,kind,method:req.method||'GET',requestBody:req.requestBody||null,requestHeaders:req.headers||{},status:response.status||0});
    if(kind==='binary'){
      const synthetic=hit||{type:'PACS_BINARY_RESPONSE',url,score:88};
      maybeAutoArmSignal(tabId,synthetic).catch(()=>{});
      if(directDicomCandidate(url,contentType,hit,req.method||'GET')) rememberGenericDirect(tabId,url,{method:req.method||'GET',headers:req.headers||{},contentType}).catch(()=>{});
    }
    return;
  }
  if(method==='Network.webSocketFrameReceived'){
    const response=params.response||{};
    if(Number(response.opcode)!==2 || !response.payloadData)return;
    try{
      const bytes=decodeDebuggerBody(response.payloadData,true);
      if(bytes.byteLength>=132)await captureDicomBytes(tabId,bytes,{url:'websocket://captured',contentType:'application/octet-stream',method:'WS'});
    }catch{}
    return;
  }
  if(method==='Network.loadingFinished'){
    const key=debuggerKey(source,params.requestId),pending=cdpPending.get(key);if(!pending)return;
    cdpPending.delete(key);cdpRequests.delete(key);
    const max=pending.kind==='json'?6*1024*1024:80*1024*1024;
    if(Number(params.encodedDataLength||0)>max)return;
    try{
      const body=await chrome.debugger.sendCommand(pending.source,'Network.getResponseBody',{requestId:pending.requestId});
      if(!body)return;
      if(pending.kind==='json'){
        const text=body.base64Encoded?new TextDecoder().decode(decodeDebuggerBody(body.body,true)):String(body.body||'');
        if(text.length>6*1024*1024)return;
        const payload=JSON.parse(text);await captureJsonPayload(tabId,payload,pending);
      }else{
        const bytes=decodeDebuggerBody(body.body,body.base64Encoded);await captureDicomBytes(tabId,bytes,pending);
      }
    }catch{}
    return;
  }
}

chrome.debugger.onEvent.addListener((source,method,params)=>{handleDebuggerEvent(source,method,params).catch(()=>{});});
chrome.debugger.onDetach.addListener((source)=>{
  const tabId=Number(source?.tabId);if(tabId<0)return;debuggerAttached.delete(tabId);
  getTabState(tabId).then(s=>{s.cdpAttached=false;return saveTabState(tabId,s)}).then(()=>setTabBadge(tabId)).catch(()=>{});
});

chrome.tabs.onRemoved.addListener(async tabId=>{detachRecorder(tabId).catch(()=>{});cacheDeleteTab(tabId).catch(()=>{});const job=await getSession(jobKey(tabId));const keys=[tabKey(tabId),invKey(tabId)];if(!job||['done','done_with_errors','error','cancelled'].includes(job.status))keys.push(jobKey(tabId));chrome.storage.session.remove(keys).catch(()=>{});});
async function ensureTabPanel(tabId){if(!Number.isFinite(Number(tabId)))return;try{await chrome.sidePanel.setOptions({tabId:Number(tabId),path:'sidepanel.html',enabled:true});}catch{}}

chrome.tabs.onCreated.addListener(async tab=>{
  if(tab?.id)ensureTabPanel(tab.id).catch(()=>{});
  if(!tab?.id || !tab.openerTabId)return;
  try{
    const opener=await getTabState(tab.openerTabId);
    if(opener.tracking!=='watching' && Number(opener.confidence||0)<AUTO_ARM_SCORE)return;
    const s=await getTabState(tab.id);
    s.confidence=Math.max(Number(s.confidence)||0,Math.min(90,Math.max(60,Number(opener.confidence)||0)));
    s.confidenceReasons=[...(s.confidenceReasons||[]),'opener-pacs'];
    await saveTabState(tab.id,s);
    await startTracking(tab.id,'auto',true);
  }catch{}
});
chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
  ensureTabPanel(tabId).catch(()=>{});
  const url=changeInfo.url||tab?.url||'';if(url)maybeAutoArmUrl(tabId,url).catch(()=>{});
  if(changeInfo.status==='complete'&&url){setTimeout(()=>scanTab(tabId).then(()=>setTabBadge(tabId)).catch(()=>{}),400);}
});

chrome.runtime.onInstalled.addListener(()=>{chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});cacheDeleteOld().catch(()=>{});chrome.tabs.query({}).then(tabs=>{for(const tab of tabs)if(tab.id)ensureTabPanel(tab.id).catch(()=>{});}).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});cacheDeleteOld().catch(()=>{});chrome.tabs.query({}).then(tabs=>{for(const tab of tabs){if(tab.id)ensureTabPanel(tab.id).catch(()=>{});if(tab.id&&tab.url)maybeAutoArmUrl(tab.id,tab.url).catch(()=>{});}}).catch(()=>{});});
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});

async function scanPerformance(tabId) {
  const probe=()=>{
    const resolve=(raw)=>{try{return new URL(raw,location.href).href}catch{return''}};
    const dom=new Set();
    const add=(raw)=>{const u=resolve(raw);if(/^https?:/i.test(u))dom.add(u)};
    for(const el of document.querySelectorAll('iframe[src],frame[src],embed[src],object[data],form[action],a[href],script[src],link[href]')) {
      add(el.getAttribute('src')||el.getAttribute('data')||el.getAttribute('action')||el.getAttribute('href')||'');
    }
    // RIS wrappers often create the real viewer URL inside inline JS.
    for(const script of Array.from(document.scripts).slice(-80)) {
      const text=script.textContent||''; if(!text || text.length>2_000_000)continue;
      const abs=text.match(/https?:\\?\/\\?\/[^\"'<>\\s]{6,800}/gi)||[];
      for(let raw of abs){raw=raw.replace(/\\\//g,'/'); if(/viewer|vrviewer|pacs|dicom|wado|7198|session|share/i.test(raw))add(raw)}
      const rel=text.match(/[\"'](\/[^\"'<>]{1,500}(?:viewer|vrviewer|pacs|dicom|wado)[^\"'<>]{0,500})[\"']/gi)||[];
      for(const raw of rel)add(raw.slice(1,-1));
    }
    return {
      href:location.href,title:document.title||'',
      navigationUrl:(performance.getEntriesByType('navigation')[0]?.name)||'',
      resources:performance.getEntriesByType('resource').map(e=>e.name).filter(Boolean).slice(-5000),
      domUrls:[...dom].slice(-1000),
      readyState:document.readyState,
      viewerDom:Boolean(document.querySelector('.cornerstone-canvas,[class*="cornerstone" i],[data-cornerstone-enabled],canvas')) || /viewer|vrviewer|pacs|ohif|dicom/i.test(location.href)
    };
  };
  try {
    const res=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:probe});
    return (res||[]).map(x=>({frameId:x.frameId,...(x.result||{})}));
  } catch(e) {
    try {
      const res=await chrome.scripting.executeScript({target:{tabId},func:probe});
      return (res||[]).map(x=>({frameId:x.frameId,...(x.result||{})}));
    } catch(e2) { return [{frameId:0,error:String(e2?.message||e2||e),resources:[],domUrls:[]}]; }
  }
}

async function scanFrameUrls(tabId) {
  try {
    const frames=await chrome.webNavigation.getAllFrames({tabId});
    return (frames||[]).map(f=>({frameId:f.frameId,parentFrameId:f.parentFrameId,url:cleanUrl(f.url),documentId:f.documentId||''})).filter(f=>f.url);
  } catch { return []; }
}

function summarize(state,perfs,frames) {
  perfs=Array.isArray(perfs)?perfs:[]; frames=Array.isArray(frames)?frames:[];
  const top=perfs.find(x=>x.frameId===0)||perfs[0]||{};
  const nav=[...(state.navUrls||[])];
  const discovered=[];
  const addDiscovered=(raw)=>{const u=cleanUrl(raw);if(!u)return;pushUnique(discovered,u,300)};
  for(const f of frames){pushUnique(nav,cleanUrl(f.url),MAX_NAV_URLS);addDiscovered(f.url);}
  for(const perf of perfs){
    for(const u of [perf?.navigationUrl,perf?.href]){pushUnique(nav,cleanUrl(u),MAX_NAV_URLS);addDiscovered(u);}
    for(const u of (perf?.domUrls||[]))addDiscovered(u);
  }
  const map=new Map();
  for(const r of (state.pacsRequests||[]))map.set(`${r.type}|${r.url}`,r);
  for(const perf of perfs)for(const raw of [...(perf?.resources||[]),...(perf?.domUrls||[])]){const hit=classifyPacsUrl(raw);if(hit)map.set(`${hit.type}|${hit.url}`,{...hit,source:`page:${perf.frameId}`,time:Date.now()});}
  const requests=[...map.values()].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,MAX_REQUESTS);
  const candidates=[...new Set([...nav,...discovered])];
  const ranked=candidates.map(url=>({url,score:viewerUrlScore(url)})).sort((a,b)=>b.score-a.score);
  const currentUrl=cleanUrl(top?.href)||state.currentUrl||frames.find(f=>f.frameId===0)?.url||'';
  const bestViewerUrl=ranked[0]?.url||currentUrl;
  const shell=[...candidates.map(classifyViewerShell).filter(Boolean)].sort((a,b)=>(b.score||0)-(a.score||0))[0]||null;
  // Theo dõi hoạt động của trang kể cả khi endpoint chưa khớp pattern PACS.
  // Dùng để không kết luận quá sớm với portal bootstrap chậm.
  const resourceSet=new Set();
  const diagnosticSet=new Set();
  for(const perf of perfs){
    for(const raw of (perf?.resources||[])){
      const u=cleanUrl(raw); if(!u)continue; resourceSet.add(u);
      if(/\/(api|rest|study|series|instance|image|dicom|pacs|viewer|exam|patient)(?:\/|\?|$)/i.test(u) || /token|wado|qido|wadors|wadouri/i.test(u)) diagnosticSet.add(u);
    }
  }
  let detector='UNKNOWN';
  if(requests.some(x=>['QIDO_SERIES','QIDO_INSTANCES','DICOM_METADATA','DICOM_INSTANCE','DICOM_FRAME','WADO'].includes(x.type)))detector='DICOMWEB';
  else if(requests.some(x=>x.type.startsWith('VRPACS_')))detector='VRPACS';
  else if(requests.some(x=>x.type.startsWith('VRAD_')||x.type==='DICOM_IMAGE_API'))detector='VRAD';
  else if(requests.some(x=>x.type==='RENDERED_JPEG'))detector='RENDERED_ONLY';
  else if(shell?.type==='VRAD_SHELL'||shell?.type==='RIS_VRVIEWER')detector='VRAD_SHELL';
  else if(shell)detector='VIEWER_SHELL';
  const origins=[...new Set([...candidates,...requests.map(r=>r.url)].map(originPattern).filter(Boolean))];
  const studyHint=state.studyHint||viewerStudyHint(bestViewerUrl)||viewerStudyHint(currentUrl)||'';
  const scopeKey=`${state.mainDocumentId||`tab:${state.tabId}`}|${studyHint}`;
  const titleText=String(top?.title||'');
  let confidence=Math.max(0,shell?.score||0,ranked[0]?.score||0,...requests.map(r=>Number(r.score)||0),Number(state.confidence)||0);
  if(/pacs|dicom|radiolog|viewer|medical image|x[- ]?ray|ct scan|mri|chẩn đoán hình ảnh|hình ảnh/i.test(titleText))confidence+=14;
  if(requests.filter(r=>r.type==='PACS_GENERIC_API').length>=2)confidence+=8;
  if((state.capturedDicoms||[]).length)confidence=100;
  confidence=Math.max(0,Math.min(100,Math.round(confidence)));
  return {
    tabId:state.tabId,title:titleText,currentUrl,bestViewerUrl,
    navUrls:nav,frameUrls:frames.map(f=>f.url),discoveredUrls:discovered,requests,
    detector,viewerShell:shell?.type||'',origins,studyHint,scopeKey,confidence,
    tracking:state.tracking||'idle',trackingMode:state.trackingMode||'',cdpAttached:Boolean(state.cdpAttached),
    capturedDicomCount:(state.capturedDicoms||[]).length,
    slowPortal:['TOKEN_PORTAL','SHARE_STUDY'].includes(shell?.type||''),
    activityCount:resourceSet.size,
    frameReadyStates:perfs.map(p=>({frameId:p.frameId,readyState:p.readyState||'',url:p.href||''})),
    diagnosticUrls:[...diagnosticSet].slice(-80),
    performanceError:perfs.map(p=>p.error).filter(Boolean).join(' | ')
  };
}

async function scanTab(tabId) {
  const state=await getTabState(tabId);
  const [perf,frames]=await Promise.all([scanPerformance(tabId),scanFrameUrls(tabId)]);
  state.frameUrls=frames.map(f=>f.url);
  let summary=summarize(state,perf,frames);
  state.confidence=Math.max(Number(state.confidence)||0,summary.confidence||0);
  await saveTabState(tabId,state);
  const shell=summary.viewerShell;
  if(summary.confidence>=AUTO_ARM_SCORE && state.tracking!=='stopped') {
    const deep=['TOKEN_PORTAL','SHARE_STUDY','PATIENT_PORTAL','VIEWER_SHELL','RIS_VRVIEWER','VRAD_SHELL'].includes(shell) || (summary.detector==='UNKNOWN' && summary.confidence>=DEEP_ARM_SCORE);
    startTracking(tabId,'auto',deep).catch(()=>{});
  }
  summary={...summary,tracking:(await getTabState(tabId)).tracking||summary.tracking};
  return summary;
}

async function resetCapture(tabId) {
  const s=await getTabState(tabId);
  s.pacsRequests=[]; s.headersByOrigin={};
  await chrome.storage.session.remove(invKey(tabId));
  await saveTabState(tabId,s);
  chrome.runtime.sendMessage({type:'TAB_CONTEXT_CHANGED',tabId,reason:'analysis_reload'}).catch(()=>{});
}

function headersForUrl(state,url,includeContentType=false) {
  try{const h={...(state.headersByOrigin?.[new URL(url).origin]||{})};if(!includeContentType)for(const k of Object.keys(h))if(k.toLowerCase()==='content-type')delete h[k];return h;}catch{return {};}
}
function restoreRequestBody(stored) {
  if(!stored)return undefined;
  if(stored.kind==='form'){const p=new URLSearchParams();for(const [k,vals] of Object.entries(stored.data||{}))for(const v of (Array.isArray(vals)?vals:[vals]))p.append(k,v);return p;}
  if(stored.kind==='raw'){const bins=(stored.chunks||[]).map(x=>atob(x));let total=bins.reduce((n,x)=>n+x.length,0);const out=new Uint8Array(total);let off=0;for(const bin of bins){for(let i=0;i<bin.length;i++)out[off+i]=bin.charCodeAt(i);off+=bin.length;}return out;}
  if(stored.kind==='text')return String(stored.text||'');
  return undefined;
}
async function fetchJson(url,state,accept='application/json, application/dicom+json',requestMeta=null) {
  const cached=await capturedJsonPayload(state,url);
  if(cached!==undefined)return cached;
  const method=(requestMeta?.method||'GET').toUpperCase();
  const headers={...headersForUrl(state,url,!!(requestMeta && !['GET','HEAD'].includes(method))),Accept:accept};
  const body=['GET','HEAD'].includes(method)?undefined:restoreRequestBody(requestMeta?.requestBody);
  const r=await fetch(url,{method,body,credentials:'include',cache:'no-store',redirect:'follow',headers});
  if(!r.ok)throw new Error(`HTTP ${r.status}: ${new URL(url).pathname}`); return r.json();
}
function inheritQuery(target,source) {
  const t=new URL(target),s=new URL(source); for(const [k,v] of s.searchParams) if(!t.searchParams.has(k))t.searchParams.append(k,v); return t.href;
}

function patientFromDicom(meta) {
  const pn=dicomJsonValue(meta,'00100010');
  const name=pn&&typeof pn==='object'?(pn.Alphabetic||''):String(pn||'');
  return {name,id:String(dicomJsonValue(meta,'00100020')||''),studyDate:String(dicomJsonValue(meta,'00080020')||''),description:String(dicomJsonValue(meta,'00081030')||'')};
}

async function analyzeDicomweb(summary,state) {
  let qido=bestDetectedRequest(summary.requests,['QIDO_SERIES']);
  let seed=qido?.url||bestDetectedRequest(summary.requests,['QIDO_INSTANCES','DICOM_METADATA','DICOM_INSTANCE','DICOM_FRAME','WADO'])?.url;
  const d=deriveDicomweb(seed); if(!d)throw new Error('Không tách được StudyInstanceUID từ DICOMweb.');
  const seriesUrl=qido?.url||inheritQuery(`${d.rsBase}/studies/${encodeURIComponent(d.studyUid)}/series`,seed);
  const rawSeries=await fetchJson(seriesUrl,state,'application/dicom+json, application/json');
  const series=parseDicomwebSeries(rawSeries);
  const wado=bestDetectedRequest(summary.requests,['WADO']);
  // Điền số instance nếu PACS không khai báo NumberOfSeriesRelatedInstances.
  const enriched=[];
  for(let i=0;i<series.length;i++){
    const s=series[i]; let count=s.imageCount;
    if(!count){
      try{const u=inheritQuery(`${d.rsBase}/studies/${encodeURIComponent(d.studyUid)}/series/${encodeURIComponent(s.seriesUid)}/instances`,seriesUrl); const arr=await fetchJson(u,state,'application/dicom+json, application/json'); count=Array.isArray(arr)?arr.length:0;}catch{}
    }
    enriched.push({...s,imageCount:count});
  }
  let patient={name:'',id:'',studyDate:'',description:''};
  try { const st=await fetchJson(inheritQuery(`${d.rsBase}/studies/${encodeURIComponent(d.studyUid)}`,seriesUrl),state,'application/dicom+json, application/json'); patient=patientFromDicom(Array.isArray(st)?(st[0]||{}):st); } catch {}
  return {adapter:'DICOMWEB',studyUid:d.studyUid,patient,series:enriched,context:{rsBase:d.rsBase,studyUid:d.studyUid,seriesUrl,wadoTemplate:wado?.url||'',completeKnown:true}};
}

async function analyzeVrpacs(summary,state) {
  const hit=bestDetectedRequest(summary.requests,['VRPACS_MANIFEST']); if(!hit)throw new Error('Chưa thấy manifest VRPACS. Hãy tải lại trang phim rồi Phân tích lại.');
  const cached=await capturedJsonPayload(state,hit.url,'VRPACS');
  const payload=cached ?? await fetchJson(hit.url,state,'application/json',hit); const p=parseVrpacsManifest(payload);
  const st=p.studies?.[0]||{}; const studyUid=String(st.studyInstanceUID||st.StudyInstanceUID||st.studyUid||st.StudyInsUID||st.studyUID||'');
  return {adapter:'VRPACS',studyUid,patient:p.patient,series:p.series,context:{manifestUrl:hit.url,host:new URL(hit.url).origin,completeKnown:true}};
}

async function analyzeVrad(summary,state) {
  const man=bestDetectedRequest(summary.requests,['VRAD_MANIFEST']);
  const template=bestDetectedRequest(summary.requests,['DICOM_IMAGE_API']);
  if(!man)throw new Error('Chưa thấy StudyData/GetStudies. Hãy tải lại viewer rồi Phân tích lại.');
  const cached=await capturedJsonPayload(state,man.url,'VRAD');
  const payload=cached ?? await fetchJson(man.url,state,'application/json',man); const p=parseVradManifest(payload);
  return {adapter:'VRAD',studyUid:String(p.study?.StuInsUID||p.study?.StudyInstanceUID||''),patient:p.patient,series:p.series,context:{manifestUrl:man.url,templateUrl:template?.url||'',completeKnown:true}};
}

function capturedInventory(summary,state) {
  const all=[...(state.capturedDicoms||[])];
  if(all.length){
    const lastStudy=[...all].reverse().find(x=>x.studyUid)?.studyUid||'';
    const items=lastStudy?all.filter(x=>!x.studyUid||x.studyUid===lastStudy):all;
    const groups=new Map();
    for(const item of items){
      const key=item.seriesUid||`${item.seriesNumber||''}|${item.seriesDescription||''}`||'captured';
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
    }
    const series=[...groups.entries()].map(([key,arr],i)=>({
      id:key||`captured:${i}`,seriesUid:arr[0]?.seriesUid||'',number:arr[0]?.seriesNumber||'',description:arr[0]?.seriesDescription||`Series ${i+1}`,
      modality:arr[0]?.modality||'',imageCount:arr.length,sequenceHint:'',source:'captured',cacheKeys:arr.map(x=>x.key)
    }));
    const first=items[0]||{},profile=state.genericProfile||{};
    return {adapter:'CAPTURED',studyUid:lastStudy||first.studyUid||profile.studyUid||'',patient:{name:first.patientName||profile.patientName||'',id:first.patientId||profile.patientId||'',studyDate:first.studyDate||profile.studyDate||'',description:first.studyDescription||profile.studyDescription||''},series,context:{captured:true,completeKnown:false,capturedCount:items.length}};
  }
  const urls=[...new Set(state.genericDirectUrls||[])];
  if(urls.length){
    const p=state.genericProfile||{};
    return {adapter:'CAPTURED_DIRECT',studyUid:p.studyUid||'',patient:{name:p.patientName||'',id:p.patientId||'',studyDate:p.studyDate||'',description:p.studyDescription||''},series:[{id:'direct:0',seriesUid:'',number:'',description:'DICOM',modality:'',imageCount:urls.length,sequenceHint:'',source:'captured-direct'}],context:{directUrls:urls,completeKnown:false}};
  }
  return null;
}

async function analyzeTab(tabId) {
  const summary=await scanTab(tabId); const state=await getTabState(tabId); let inv=null,adapterError=null;
  try{
    if(summary.detector==='DICOMWEB')inv=await analyzeDicomweb(summary,state);
    else if(summary.detector==='VRPACS')inv=await analyzeVrpacs(summary,state);
    else if(summary.detector==='VRAD')inv=await analyzeVrad(summary,state);
  }catch(e){adapterError=e;}
  const captured=capturedInventory(summary,state);
  if(!inv)inv=captured;
  else if(captured){
    inv.studyUid=inv.studyUid||captured.studyUid||'';
    inv.patient=inv.patient||{};
    for(const key of ['name','id','studyDate','description'])if(!inv.patient[key]&&captured.patient?.[key])inv.patient[key]=captured.patient[key];
  }
  if(!inv){
    if(adapterError)throw adapterError;
    if(summary.detector==='RENDERED_ONLY')throw new Error('Viewer hiện chỉ trả ảnh render; chưa có DICOM để lưu.');
    throw new Error(summary.tracking==='stopped'?'Theo dõi tab này đang dừng.':'Chưa bắt được DICOM.');
  }
  inv.tabId=tabId; inv.summary=summary; inv.createdAt=Date.now();inv.linkHashes=await summaryLinkHashes(summary);
  const previous=await findHistoryMatch(inv);if(previous&&isDownloadedStatus(previous.status))inv.previousDownload=previous;
  await setSession(invKey(tabId),inv); await upsertHistory(inv,{analyzedAt:Date.now(),status:'viewed'});await setTabBadge(tabId); return inv;
}

async function ensureOffscreen() {
  const url=chrome.runtime.getURL('offscreen.html');
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
  if(contexts.length)return;
  if(offscreenCreating)return offscreenCreating;
  offscreenCreating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'Tải và đóng gói DICOM Part-10 từ PACS mà không cần ứng dụng cục bộ.'});
  try{await offscreenCreating;}finally{offscreenCreating=null;}
}

async function offscreenPrepare(task) {
  await ensureOffscreen(); const r=await chrome.runtime.sendMessage({target:'offscreen',type:'PREPARE_FILE',task});
  if(!r?.ok)throw new Error(r?.error||'Không tạo được DICOM.'); return r;
}
async function revokeBlob(url){if(!url)return;try{await chrome.runtime.sendMessage({target:'offscreen',type:'REVOKE_BLOB',url});}catch{}}

function objectKey(web){if(!web)return'';try{const q=web.startsWith('?')?web.slice(1):web;return new URLSearchParams(q).get('imageObjKey')||'';}catch{return'';}}

function normalizePatientNameForFolder(raw) {
  return String(raw || '').replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeStudyDateForFolder(raw) {
  const value=String(raw || '').trim();
  let m=value.match(/^(\d{4})[-\/.]?(\d{2})[-\/.]?(\d{2})/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=value.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})/);
  if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  return value;
}

function studyFolderName(inv) {
  const patient=inv?.patient || {};
  const name=sanitizeSegment(normalizePatientNameForFolder(patient.name), 'Unknown');
  const id=sanitizeSegment(patient.id, 'NoID');
  const date=sanitizeSegment(normalizeStudyDateForFolder(patient.studyDate), 'NoDate');
  return `${name} - ${id} - ${date}`;
}


function capturedSopMap(state){const out=new Map();for(const rec of (state.capturedDicoms||[])){const sop=String(rec.sopInstanceUid||'').trim();if(sop)out.set(sop,rec.key);}return out;}

async function buildVradTasks(inv,selected,state) {
  const req=(await getTabState(inv.tabId)).pacsRequests.find(x=>x.type==='VRAD_MANIFEST'&&x.url===inv.context.manifestUrl); const payload=await fetchJson(inv.context.manifestUrl,state,'application/json',req); const p=parseVradManifest(payload); const selectedSet=new Set(selected);
  let templateBase='', tmpl=new URLSearchParams();
  if(inv.context.templateUrl){const tp=new URL(inv.context.templateUrl);templateBase=`${tp.protocol}//${tp.host}${tp.pathname}`;tmpl=new URLSearchParams(tp.search);}
  const tasks=[],cached=capturedSopMap(state);let expectedTotal=0;
  for(let si=0;si<p.rawSeries.length;si++){
    const raw=p.rawSeries[si],choice=p.series[si]; if(!selectedSet.has(choice.id))continue;
    const folder=seriesFolderName(choice,si); let k=0; const declared=Number(raw.ImageCount||choice.imageCount||0)||0; expectedTotal+=declared;
    for(const im of (raw.ImageList||[])){
      const io=objectKey(im.WebUrl||''); if(!io)continue;
      let base=templateBase;
      if(!base && raw.ImageBaseUrl){try{base=new URL(String(raw.ImageBaseUrl),inv.context.manifestUrl).href.split('?')[0];}catch{base=String(raw.ImageBaseUrl||'');}}
      if(!base)continue; k++;
      const qs=new URLSearchParams(tmpl); qs.set('imageObjKey',io); qs.set('signature',im.Signature||'');
      qs.set('seriesuid',raw.SeriesInsUID||qs.get('seriesuid')||''); qs.set('studyuid',raw.StuInsUID||qs.get('studyuid')||'');
      qs.set('imageUid',im.SOPInstanceUID||''); qs.set('imageid',String(im.ImageID||0)); if(raw.Expires||im.Expires)qs.set('expires',String(raw.Expires||im.Expires));
      const filename=`PACS_DICOM/${studyFolderName(inv)}/${folder}/IM_${String(k).padStart(5,'0')}.dcm`,sop=String(im.SOPInstanceUID||'').trim();
      const cacheKey=sop?cached.get(sop):'';
      if(cacheKey)tasks.push({mode:'cached-dicom',cacheKey,filename});
      else tasks.push({mode:'direct-http',url:`${base}?${qs}`,filename,headers:headersForUrl(state,base)});
    }
  }
  if(expectedTotal && tasks.length<expectedTotal)throw new Error(`Manifest VRAD có ${expectedTotal} ảnh nhưng chỉ tạo được ${tasks.length} URL DICOM.`);
  return tasks;
}

async function buildVrpacsTasks(inv,selected,state) {
  const req=(await getTabState(inv.tabId)).pacsRequests.find(x=>x.type==='VRPACS_MANIFEST'&&x.url===inv.context.manifestUrl); const payload=await fetchJson(inv.context.manifestUrl,state,'application/json',req); const p=parseVrpacsManifest(payload); const selectedSet=new Set(selected); const tasks=[];
  function toUrl(id){let s=String(id||'');for(const pref of ['wadouri:','wadors:','dicomweb:','dicomfile:'])if(s.startsWith(pref)){s=s.slice(pref.length);break;}return /^https?:/i.test(s)?s:`${inv.context.host}/${s.replace(/^\//,'')}`;}
  for(let i=0;i<p.rawSeries.length;i++){
    const raw=p.rawSeries[i],choice=p.series[i]; if(!selectedSet.has(choice.id))continue; const folder=seriesFolderName(choice,i); let k=0;
    for(const id of (raw.imageIds||[])){if(!id)continue;k++;const url=toUrl(id);tasks.push({mode:'direct-http',url,filename:`PACS_DICOM/${studyFolderName(inv)}/${folder}/IM_${String(k).padStart(5,'0')}.dcm`,headers:headersForUrl(state,url)});}
  }
  return tasks;
}

function getInstancesUid(inst){return String(dicomJsonValue(inst,'00080018')||'').trim();}
function getFrames(inst){return Math.max(1,Number(dicomJsonValue(inst,'00280008')||1)||1);}

async function buildDicomwebTasks(inv,selected,state) {
  const set=new Set(selected),tasks=[],cached=capturedSopMap(state); const q=inv.context.seriesUrl; const rs=inv.context.rsBase,study=inv.context.studyUid;
  let wadoInfo=null, studyWideGroups=null;
  if(inv.context.wadoTemplate){try{const u=new URL(inv.context.wadoTemplate);if((u.searchParams.get('requestType')||'').toUpperCase()==='WADO'||u.searchParams.has('objectUID'))wadoInfo=u;}catch{}}
  async function studyWide() {
    if(studyWideGroups)return studyWideGroups;
    studyWideGroups={};
    for(const endpoint of [`${rs}/studies/${encodeURIComponent(study)}/instances?limit=100000`,`${rs}/studies/${encodeURIComponent(study)}/instances`,`${rs}/studies/${encodeURIComponent(study)}/metadata`]){
      try{
        const arr=await fetchJson(inheritQuery(endpoint,q),state,'application/dicom+json, application/json');
        if(!Array.isArray(arr)||!arr.length)continue;
        for(const inst of arr){const suid=String(dicomJsonValue(inst,'0020000E')||'').trim();if(suid)(studyWideGroups[suid] ||= []).push(inst);}
        if(Object.keys(studyWideGroups).length)break;
      }catch{}
    }
    return studyWideGroups;
  }
  for(let si=0;si<inv.series.length;si++){
    const s=inv.series[si]; if(!set.has(s.id))continue; const folder=seriesFolderName(s,si);
    const iu=inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/instances`,q);
    const expected=Number(s.imageCount)||0;
    let insts=[]; try{insts=await fetchJson(iu,state,'application/dicom+json, application/json');}catch{}
    if(!Array.isArray(insts))insts=[];
    if(!insts.length || (expected && insts.length<expected)){
      try{const metaList=await fetchJson(inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/metadata`,q),state,'application/dicom+json, application/json');if(Array.isArray(metaList)&&metaList.length>insts.length)insts=metaList;}catch{}
    }
    if(!insts.length || (expected && insts.length<expected)){
      const groups=await studyWide();const wide=groups[s.seriesUid]||[];if(wide.length>insts.length)insts=wide;
    }
    const unique=new Map();for(const inst of insts){const uid=getInstancesUid(inst);if(uid)unique.set(uid,inst);}insts=[...unique.values()];
    if(expected && insts.length<expected)throw new Error(`DICOMweb chưa liệt kê đủ series ${s.number||si+1}: ${insts.length}/${expected} instance.`);
    if(!insts.length)throw new Error(`DICOMweb không liệt kê được instance của series ${s.number||si+1}.`);
    let k=0;
    for(const inst of insts){
      const iuid=getInstancesUid(inst); if(!iuid)continue; k++; const filename=`PACS_DICOM/${studyFolderName(inv)}/${folder}/IM_${String(k).padStart(5,'0')}_${sanitizeSegment(iuid,'instance')}.dcm`;
      const cacheKey=cached.get(iuid);
      if(cacheKey){tasks.push({mode:'cached-dicom',cacheKey,filename});continue;}
      if(wadoInfo){
        const wu=new URL(wadoInfo.href); wu.searchParams.set('requestType','WADO');wu.searchParams.set('studyUID',study);wu.searchParams.set('seriesUID',s.seriesUid);wu.searchParams.set('objectUID',iuid);wu.searchParams.set('contentType','application/dicom');if(!wu.searchParams.has('transferSyntax'))wu.searchParams.set('transferSyntax','*');
        tasks.push({mode:'fetch-dicom',url:wu.href,filename,headers:headersForUrl(state,wu.href),fallback:{mode:'dicomweb-instance',instanceBase:inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/instances/${encodeURIComponent(iuid)}`,q),meta:inst,numberOfFrames:getFrames(inst),headers:headersForUrl(state,iu)}});
      } else {
        tasks.push({mode:'dicomweb-instance',instanceBase:inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/instances/${encodeURIComponent(iuid)}`,q),meta:inst,numberOfFrames:getFrames(inst),filename,headers:headersForUrl(state,iu)});
      }
    }
  }
  return tasks;
}

async function buildCapturedTasks(inv,selected,state) {
  const wanted=new Set(selected),tasks=[];
  for(let si=0;si<(inv.series||[]).length;si++){
    const series=inv.series[si];if(!wanted.has(series.id))continue;
    const folder=seriesFolderName(series,si);let k=0;
    for(const key of (series.cacheKeys||[])){
      k++;tasks.push({mode:'cached-dicom',cacheKey:key,filename:`PACS_DICOM/${studyFolderName(inv)}/${folder}/IM_${String(k).padStart(5,'0')}.dcm`});
    }
  }
  return tasks;
}

async function buildCapturedDirectTasks(inv,selected,state) {
  if(!selected.includes('direct:0'))return [];
  const tasks=[];let k=0;
  for(const url of (inv.context?.directUrls||[])){
    k++;const meta=state.genericDirectMeta?.[url]||{};
    tasks.push({mode:'direct-http',url,filename:`PACS_DICOM/${studyFolderName(inv)}/01 - DICOM/IM_${String(k).padStart(5,'0')}.dcm`,headers:{...headersForUrl(state,url),...(meta.headers||{})}});
  }
  return tasks;
}

async function buildTasks(inv,selected) {
  const state=await getTabState(inv.tabId);let tasks=[];
  if(inv.adapter==='VRAD')tasks=await buildVradTasks(inv,selected,state);
  else if(inv.adapter==='VRPACS')tasks=await buildVrpacsTasks(inv,selected,state);
  else if(inv.adapter==='DICOMWEB')tasks=await buildDicomwebTasks(inv,selected,state);
  else if(inv.adapter==='CAPTURED')tasks=await buildCapturedTasks(inv,selected,state);
  else if(inv.adapter==='CAPTURED_DIRECT')tasks=await buildCapturedDirectTasks(inv,selected,state);
  return tasks.map(t=>({...t,tabId:inv.tabId}));
}

async function waitDownload(id, timeoutMs=120000) {
  const existing=await chrome.downloads.search({id});
  if(existing[0]?.state==='complete')return {ok:true,item:existing[0]};
  if(existing[0]?.state==='interrupted')return {ok:false,error:existing[0].error||'interrupted',item:existing[0]};
  return new Promise(resolve=>{
    const timer=setTimeout(async()=>{
      downloadWaiters.delete(id);
      try{await chrome.downloads.cancel(id);}catch{}
      resolve({ok:false,error:'NETWORK_TIMEOUT'});
    },timeoutMs);
    downloadWaiters.set(id,(result)=>{clearTimeout(timer);resolve(result);});
  });
}

chrome.downloads.onChanged.addListener(async delta=>{
  if(!delta.state)return;
  const waiter=downloadWaiters.get(delta.id);
  if(waiter&&(delta.state.current==='complete'||delta.state.current==='interrupted')){
    downloadWaiters.delete(delta.id);
    let item=null;try{item=(await chrome.downloads.search({id:delta.id}))[0]||null;}catch{}
    waiter({ok:delta.state.current==='complete',error:delta.error?.current||'',item});
  }
});

async function updateJob(tabId,patch) {
  const key=jobKey(tabId),job=await getSession(key,{tabId});
  Object.assign(job,patch,{tabId,updatedAt:Date.now()});
  await setSession(key,job);
  chrome.runtime.sendMessage({type:'JOB_UPDATED',tabId,job}).catch(()=>{});
  await setTabBadge(tabId);
  return job;
}
async function appendJobError(tabId,text){
  const j=await getSession(jobKey(tabId),{}),errors=[...(j.errors||[])];
  errors.push(String(text));if(errors.length>40)errors.shift();
  return updateJob(tabId,{errors});
}

function downloadHeaderArray(task, accept='application/dicom, application/octet-stream, */*') {
  const out=[]; let hasAccept=false;
  for(const [name,value] of Object.entries(task.headers||{})){
    const lower=name.toLowerCase();
    if(['cookie','host','content-length','referer','origin','user-agent','accept-encoding','connection'].includes(lower))continue;
    if(lower==='accept')hasAccept=true;
    out.push({name,value:String(value)});
  }
  if(!hasAccept && accept)out.push({name:'Accept',value:accept});
  return out;
}

async function registerActiveDownload(id,task,index,total,extra={}) {
  const tabId=Number(task.tabId),job=await getSession(jobKey(tabId),{});
  const active=[...new Set([...(job.activeDownloadIds||[]),id])];
  await updateJob(tabId,{activeDownloadIds:active,currentFile:task.filename,current:index+1,total,...extra});
}
async function unregisterActiveDownload(id,tabId) {
  const job=await getSession(jobKey(tabId),{});
  await updateJob(tabId,{activeDownloadIds:(job.activeDownloadIds||[]).filter(x=>x!==id)});
}

async function directHttpDownload(task,index,total) {
  const tabId=Number(task.tabId);
  const id=await chrome.downloads.download({
    url:task.url,
    filename:task.filename,
    conflictAction:'uniquify',
    saveAs:false,
    method:'GET',
    headers:downloadHeaderArray(task)
  });
  await registerActiveDownload(id,task,index,total);
  const done=await waitDownload(id);
  await unregisterActiveDownload(id,tabId);
  if(!done.ok)throw new Error(`Download bị gián đoạn: ${done.error||'unknown'}`);
  const mime=String(done.item?.mime||'').toLowerCase();
  if(mime.includes('text/html')||mime.includes('application/json'))throw new Error(`Server trả ${mime} thay vì DICOM.`);
  const size=Number(done.item?.fileSize ?? done.item?.totalBytes ?? -1);
  if(size>=0 && size<132)throw new Error('File tải về quá nhỏ để là DICOM hợp lệ.');
  return true;
}

async function blobPreparedDownload(task,index,total) {
  const tabId=Number(task.tabId);let prep;
  try{prep=await offscreenPrepare(task);}catch(e){if(task.fallback)prep=await offscreenPrepare({...task.fallback,tabId,filename:task.filename});else throw e;}
  if((await getSession(jobKey(tabId),{})).cancelRequested){await revokeBlob(prep.blobUrl);throw new Error('__CANCELLED__');}
  const id=await chrome.downloads.download({url:prep.blobUrl,filename:task.filename,conflictAction:'uniquify',saveAs:false});
  const job=await getSession(jobKey(tabId),{});
  await registerActiveDownload(id,task,index,total,{bytesPrepared:(job.bytesPrepared||0)+(prep.size||0)});
  const done=await waitDownload(id);await revokeBlob(prep.blobUrl);await unregisterActiveDownload(id,tabId);
  if(!done.ok)throw new Error(`Download bị gián đoạn: ${done.error||task.filename}`);
  return true;
}

async function processTask(task,index,total) {
  const tabId=Number(task.tabId);
  if((await getSession(jobKey(tabId),{})).cancelRequested)throw new Error('__CANCELLED__');
  const attempts=task.mode==='direct-http'?3:2;let lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    if((await getSession(jobKey(tabId),{})).cancelRequested)throw new Error('__CANCELLED__');
    try{
      if(task.mode==='direct-http')return await directHttpDownload(task,index,total);
      return await blobPreparedDownload(task,index,total);
    }catch(e){
      if(String(e?.message||e)==='__CANCELLED__')throw e;
      lastError=e;if(attempt<attempts)await sleep(600*attempt);
    }
  }
  throw lastError||new Error('Không tải được DICOM.');
}

async function runJob(inv,selected) {
  const tabId=Number(inv.tabId);
  try{
    const tasks=await buildTasks(inv,selected);if(!tasks.length)throw new Error('Không có DICOM để tải.');
    await updateJob(tabId,{status:'downloading',total:tasks.length,current:0,completed:0,failed:0,currentFile:'',errors:[]});
    let next=0,completed=0,failed=0;
    async function worker(){
      while(true){
        const idx=next++;if(idx>=tasks.length)return;
        try{await processTask(tasks[idx],idx,tasks.length);completed++;await updateJob(tabId,{completed});}
        catch(e){if(String(e?.message||e)==='__CANCELLED__')return;failed++;await appendJobError(tabId,`${tasks[idx].filename}: ${e?.message||e}`);await updateJob(tabId,{failed});}
      }
    }
    await Promise.all([worker(),worker(),worker()]);
    const j=await getSession(jobKey(tabId),{});
    if(j.cancelRequested){
      await updateJob(tabId,{status:'cancelled',currentFile:''});
      await upsertHistory(inv,{status:'cancelled',lastDownloadAt:Date.now(),downloaded:completed,failed});
    }else{
      const completeKnown=inv.context?.completeKnown!==false;
      const status=failed?'done_with_errors':(completeKnown?'done':'partial');
      await updateJob(tabId,{status,currentFile:''});
      const h=await upsertHistory(inv,{status,lastDownloadAt:Date.now(),downloaded:completed,failed});
      if(status==='done'){inv.previousDownload=h;await setSession(invKey(tabId),inv);}
    }
  }catch(e){
    if(String(e?.message||e)==='__CANCELLED__'){
      await updateJob(tabId,{status:'cancelled'});await upsertHistory(inv,{status:'cancelled',lastDownloadAt:Date.now()});
    }else{
      await appendJobError(tabId,e?.message||e);await updateJob(tabId,{status:'error'});await upsertHistory(inv,{status:'error',lastDownloadAt:Date.now(),lastError:String(e?.message||e)});
    }
  }finally{runningJobs.delete(tabId);await setTabBadge(tabId);}
}

async function startJob(tabId,selected) {
  if(runningJobs.has(tabId))throw new Error('Tab này đang tải DICOM.');
  const inv=await getSession(invKey(tabId));if(!inv)throw new Error('Chưa nhận diện được study.');
  const existing=await getSession(jobKey(tabId));
  if(existing && ['preparing','downloading','cancelling'].includes(existing.status))throw new Error('Tab này đang tải DICOM.');
  const job={id:crypto.randomUUID(),tabId,status:'preparing',adapter:inv.adapter,studyUid:inv.studyUid||'',selectedSeries:selected,current:0,total:0,completed:0,failed:0,bytesPrepared:0,activeDownloadIds:[],cancelRequested:false,errors:[],startedAt:Date.now(),updatedAt:Date.now()};
  await setSession(jobKey(tabId),job);await setTabBadge(tabId);
  const promise=runJob(inv,selected);runningJobs.set(tabId,promise);return job;
}

async function cancelJob(tabId){
  const j=await getSession(jobKey(tabId),{});if(!j?.id)return true;
  await updateJob(tabId,{cancelRequested:true,status:'cancelling'});
  for(const id of (j.activeDownloadIds||[])){try{await chrome.downloads.cancel(id);}catch{}}
  return true;
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target==='offscreen')return false;
  (async()=>{
    if(message?.type==='PAGE_HINTS'){const id=Number(sender?.tab?.id ?? message.tabId);if(id>=0)await applyPageHints(id,message.hint||{});return {ok:true};}
    if(message?.type==='SCAN_TAB'){const s=await scanTab(Number(message.tabId));return {ok:true,summary:s};}
    if(message?.type==='ANALYZE_TAB'){const inv=await analyzeTab(Number(message.tabId));return {ok:true,inventory:inv};}
    if(message?.type==='GET_INVENTORY'){return {ok:true,inventory:await getSession(invKey(Number(message.tabId)))};}
    if(message?.type==='GET_TAB_STATE'){return {ok:true,state:await getTabState(Number(message.tabId))};}
    if(message?.type==='START_TRACKING'){await startTracking(Number(message.tabId),'manual',message.deep!==false);return {ok:true,state:await getTabState(Number(message.tabId))};}
    if(message?.type==='STOP_TRACKING'){await stopTracking(Number(message.tabId));return {ok:true,state:await getTabState(Number(message.tabId))};}
    if(message?.type==='GET_TRACKING_OVERVIEW'){return {ok:true,tabs:await trackingOverview()};}
    if(message?.type==='RESET_CAPTURE'){await resetCapture(Number(message.tabId));return {ok:true};}
    if(message?.type==='GET_HISTORY'){return {ok:true,history:await getHistory()};}
    if(message?.type==='CLEAR_HISTORY'){await chrome.storage.local.set({[HISTORY_KEY]:[]});chrome.runtime.sendMessage({type:'HISTORY_UPDATED',history:[]}).catch(()=>{});return {ok:true};}
    if(message?.type==='START_DOWNLOAD'){return {ok:true,job:await startJob(Number(message.tabId),message.selectedSeries||[])};}
    if(message?.type==='GET_JOB'){return {ok:true,job:await getSession(jobKey(Number(message.tabId)))};}
    if(message?.type==='CANCEL_JOB'){await cancelJob(Number(message.tabId));return {ok:true};}
    if(message?.type==='OPEN_DOWNLOADS_FOLDER'){chrome.downloads.showDefaultFolder();return {ok:true};}
    return {ok:false,error:'Unknown message'};
  })().then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});
