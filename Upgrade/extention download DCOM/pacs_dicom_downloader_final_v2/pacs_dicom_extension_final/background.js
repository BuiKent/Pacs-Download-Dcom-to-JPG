'use strict';

import {
  cleanUrl, classifyPacsUrl, viewerUrlScore, originPattern, parseVradManifest,
  parseVrpacsManifest, parseDicomwebSeries, deriveDicomweb, bestDetectedRequest,
  dicomJsonValue, sanitizeSegment, seriesFolderName, safeHeaders, NON_IMAGE_MODALITIES,
  viewerStudyHint, classifyViewerShell
} from './lib/pacs.js';

const TAB_PREFIX='pacs_tab_';
const INV_PREFIX='pacs_inv_';
const JOB_KEY='pacs_current_job';
const HISTORY_KEY='pacs_history_v2';
const MAX_HISTORY=80;
const MAX_NAV_URLS=40, MAX_REQUESTS=300;
let offscreenCreating=null;
let runningJob=null;
const downloadWaiters=new Map();

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const tabKey=(id)=>`${TAB_PREFIX}${id}`;
const invKey=(id)=>`${INV_PREFIX}${id}`;

async function getSession(key, fallback=null) { const o=await chrome.storage.session.get(key); return o[key] ?? fallback; }
async function setSession(key,val) { await chrome.storage.session.set({[key]:val}); }

async function getHistory() {
  const o=await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(o[HISTORY_KEY]) ? o[HISTORY_KEY] : [];
}
function historyIdentity(inv) {
  return `${inv?.adapter||'UNKNOWN'}|${inv?.studyUid||inv?.summary?.studyHint||inv?.summary?.scopeKey||''}`;
}
async function upsertHistory(inv, patch={}) {
  if(!inv)return;
  const key=historyIdentity(inv); if(!key || key.endsWith('|'))return;
  const list=await getHistory();
  const idx=list.findIndex(x=>x.key===key);
  const old=idx>=0?list[idx]:{};
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
    ...patch,
    updatedAt:Date.now()
  };
  if(idx>=0)list.splice(idx,1);
  list.unshift(item);
  if(list.length>MAX_HISTORY)list.length=MAX_HISTORY;
  await chrome.storage.local.set({[HISTORY_KEY]:list});
  chrome.runtime.sendMessage({type:'HISTORY_UPDATED',history:list}).catch(()=>{});
}

function pushUnique(list,value,max) { if(!value)return; const i=list.indexOf(value); if(i>=0)list.splice(i,1); list.push(value); if(list.length>max)list.splice(0,list.length-max); }

async function getTabState(tabId) {
  return await getSession(tabKey(tabId), {tabId,navUrls:[],pendingNavUrls:[],frameUrls:[],pacsRequests:[],headersByOrigin:{},currentUrl:'',mainDocumentId:'',studyHint:'',updatedAt:Date.now()});
}
async function saveTabState(tabId,state) { state.updatedAt=Date.now(); await setSession(tabKey(tabId),state); }

async function invalidateInventory(tabId, reason='navigation') {
  await chrome.storage.session.remove(invKey(tabId));
  chrome.runtime.sendMessage({type:'TAB_CONTEXT_CHANGED',tabId,reason}).catch(()=>{});
}

async function rememberBeforeNavigate(tabId,raw) {
  if(tabId<0)return; const url=cleanUrl(raw); if(!url)return;
  const s=await getTabState(tabId);
  s.pendingNavUrls = s.pendingNavUrls || [];
  pushUnique(s.pendingNavUrls,url,MAX_NAV_URLS);
  s.currentUrl=url;
  await saveTabState(tabId,s);
}

async function rememberCommitted(d) {
  if(d.tabId<0 || d.frameId!==0)return; const url=cleanUrl(d.url); if(!url)return;
  const s=await getTabState(d.tabId);
  const changedDocument = Boolean(s.mainDocumentId && d.documentId && s.mainDocumentId!==d.documentId);
  if(changedDocument) {
    const pending=[...(s.pendingNavUrls||[])];
    s.navUrls=[]; for(const u of pending)pushUnique(s.navUrls,u,MAX_NAV_URLS);
    s.pacsRequests=[]; s.frameUrls=[];
    s.studyHint=viewerStudyHint(url)||'';
    await invalidateInventory(d.tabId,'document');
  }
  pushUnique(s.navUrls,url,MAX_NAV_URLS);
  s.pendingNavUrls=[]; s.currentUrl=url; s.mainDocumentId=d.documentId||s.mainDocumentId||'';
  if(!s.studyHint)s.studyHint=viewerStudyHint(url)||'';
  await saveTabState(d.tabId,s);
}

async function rememberSameDocument(tabId,raw) {
  if(tabId<0)return; const url=cleanUrl(raw); if(!url)return;
  const s=await getTabState(tabId);
  const oldHint=s.studyHint||''; const newHint=viewerStudyHint(url)||'';
  if(oldHint && newHint && oldHint!==newHint) {
    s.navUrls=[]; s.pacsRequests=[]; s.frameUrls=[]; s.studyHint=newHint;
    await invalidateInventory(tabId,'study');
  } else if(!oldHint && newHint) s.studyHint=newHint;
  pushUnique(s.navUrls,url,MAX_NAV_URLS); s.currentUrl=url; await saveTabState(tabId,s);
}

async function rememberRequest(tabId,raw,source='network',extra={}) {
  if(tabId<0)return; const hit=classifyPacsUrl(raw); if(!hit)return;
  const s=await getTabState(tabId); const id=`${hit.type}|${hit.url}`;
  const idx=s.pacsRequests.findIndex(x=>`${x.type}|${x.url}`===id); if(idx>=0)s.pacsRequests.splice(idx,1);
  s.pacsRequests.push({...hit,...extra,source,time:Date.now()});
  if(s.pacsRequests.length>MAX_REQUESTS)s.pacsRequests.splice(0,s.pacsRequests.length-MAX_REQUESTS);
  await saveTabState(tabId,s);
  chrome.runtime.sendMessage({type:'PACS_SIGNAL',tabId,signal:hit.type}).catch(()=>{});
}

async function rememberFrameCommitted(d) {
  if(d.tabId<0 || d.frameId===0)return;
  const url=cleanUrl(d.url); if(!url)return;
  const s=await getTabState(d.tabId);
  pushUnique(s.frameUrls,url,MAX_NAV_URLS);
  await saveTabState(d.tabId,s);
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
chrome.webRequest.onBeforeRequest.addListener(d=>{ if(d.tabId>=0) rememberRequest(d.tabId,d.url,'webRequest',{method:d.method,requestBody:serializeRequestBody(d.requestBody)}); },{urls:['http://*/*','https://*/*']},['requestBody','extraHeaders']);
chrome.webRequest.onBeforeSendHeaders.addListener(d=>{
  if(d.tabId<0 || !classifyPacsUrl(d.url))return;
  (async()=>{
    const h={}; for(const item of (d.requestHeaders||[])) if(item.name && item.value!=null)h[item.name]=item.value;
    const sh=safeHeaders(h); if(!Object.keys(sh).length)return;
    const s=await getTabState(d.tabId); let origin=''; try{origin=new URL(d.url).origin;}catch{return;}
    s.headersByOrigin[origin]={...(s.headersByOrigin[origin]||{}),...sh}; await saveTabState(d.tabId,s);
  })();
},{urls:['http://*/*','https://*/*']},['requestHeaders','extraHeaders']);

chrome.tabs.onRemoved.addListener(tabId=>chrome.storage.session.remove([tabKey(tabId),invKey(tabId)]));

chrome.runtime.onInstalled.addListener(()=>{ chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{}); });
chrome.runtime.onStartup.addListener(()=>{ chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{}); });
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
      readyState:document.readyState
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
  return {
    tabId:state.tabId,title:top?.title||'',currentUrl,bestViewerUrl,
    navUrls:nav,frameUrls:frames.map(f=>f.url),discoveredUrls:discovered,requests,
    detector,viewerShell:shell?.type||'',origins,studyHint,scopeKey,
    performanceError:perfs.map(p=>p.error).filter(Boolean).join(' | ')
  };
}

async function scanTab(tabId) {
  const state=await getTabState(tabId);
  const [perf,frames]=await Promise.all([scanPerformance(tabId),scanFrameUrls(tabId)]);
  state.frameUrls=frames.map(f=>f.url); await saveTabState(tabId,state);
  return summarize(state,perf,frames);
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
  return undefined;
}
async function fetchJson(url,state,accept='application/json, application/dicom+json',requestMeta=null) {
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
  return {adapter:'DICOMWEB',studyUid:d.studyUid,patient,series:enriched,context:{rsBase:d.rsBase,studyUid:d.studyUid,seriesUrl,wadoTemplate:wado?.url||''}};
}

async function analyzeVrpacs(summary,state) {
  const hit=bestDetectedRequest(summary.requests,['VRPACS_MANIFEST']); if(!hit)throw new Error('Chưa thấy manifest VRPACS. Hãy tải lại trang phim rồi Phân tích lại.');
  const payload=await fetchJson(hit.url,state,'application/json',hit); const p=parseVrpacsManifest(payload);
  const st=p.studies?.[0]||{}; const studyUid=String(st.studyInstanceUID||st.StudyInstanceUID||st.studyUid||st.StudyInsUID||st.studyUID||'');
  return {adapter:'VRPACS',studyUid,patient:p.patient,series:p.series,context:{manifestUrl:hit.url,host:new URL(hit.url).origin}};
}

async function analyzeVrad(summary,state) {
  const man=bestDetectedRequest(summary.requests,['VRAD_MANIFEST']);
  const template=bestDetectedRequest(summary.requests,['DICOM_IMAGE_API']);
  if(!man)throw new Error('Chưa thấy StudyData/GetStudies. Hãy tải lại viewer rồi Phân tích lại.');
  const payload=await fetchJson(man.url,state,'application/json',man); const p=parseVradManifest(payload);
  return {adapter:'VRAD',studyUid:String(p.study?.StuInsUID||p.study?.StudyInstanceUID||''),patient:p.patient,series:p.series,context:{manifestUrl:man.url,templateUrl:template?.url||''}};
}

async function analyzeTab(tabId) {
  const summary=await scanTab(tabId); const state=await getTabState(tabId); let inv;
  if(summary.detector==='DICOMWEB')inv=await analyzeDicomweb(summary,state);
  else if(summary.detector==='VRPACS')inv=await analyzeVrpacs(summary,state);
  else if(summary.detector==='VRAD')inv=await analyzeVrad(summary,state);
  else if(summary.detector==='RENDERED_ONLY')throw new Error('Viewer hiện chỉ lộ ảnh render JPEG; chưa thấy endpoint DICOM/manifest để tải DICOM gốc.');
  else throw new Error('Chưa nhận diện được manifest/DICOMweb. Hãy cấp quyền site, tải lại trang phim và thử lại.');
  inv.tabId=tabId; inv.summary=summary; inv.createdAt=Date.now(); await setSession(invKey(tabId),inv); await upsertHistory(inv,{analyzedAt:Date.now(),status:'viewed'}); return inv;
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


async function buildVradTasks(inv,selected,state) {
  const req=(await getTabState(inv.tabId)).pacsRequests.find(x=>x.type==='VRAD_MANIFEST'&&x.url===inv.context.manifestUrl); const payload=await fetchJson(inv.context.manifestUrl,state,'application/json',req); const p=parseVradManifest(payload); const selectedSet=new Set(selected);
  let templateBase='', tmpl=new URLSearchParams();
  if(inv.context.templateUrl){const tp=new URL(inv.context.templateUrl);templateBase=`${tp.protocol}//${tp.host}${tp.pathname}`;tmpl=new URLSearchParams(tp.search);}
  const tasks=[];
  for(let si=0;si<p.rawSeries.length;si++){
    const raw=p.rawSeries[si],choice=p.series[si]; if(!selectedSet.has(choice.id))continue;
    const folder=seriesFolderName(choice,si); let k=0;
    for(const im of (raw.ImageList||[])){
      const io=objectKey(im.WebUrl||''); if(!io)continue;
      let base=templateBase;
      if(!base && raw.ImageBaseUrl){try{base=new URL(String(raw.ImageBaseUrl),inv.context.manifestUrl).href.split('?')[0];}catch{base=String(raw.ImageBaseUrl||'');}}
      if(!base)continue; k++;
      const qs=new URLSearchParams(tmpl); qs.set('imageObjKey',io); qs.set('signature',im.Signature||'');
      qs.set('seriesuid',raw.SeriesInsUID||qs.get('seriesuid')||''); qs.set('studyuid',raw.StuInsUID||qs.get('studyuid')||'');
      qs.set('imageUid',im.SOPInstanceUID||''); qs.set('imageid',String(im.ImageID||0)); if(raw.Expires||im.Expires)qs.set('expires',String(raw.Expires||im.Expires));
      tasks.push({mode:'direct-http',url:`${base}?${qs}`,filename:`PACS_DICOM/${studyFolderName(inv)}/${folder}/IM_${String(k).padStart(5,'0')}.dcm`,headers:headersForUrl(state,base)});
    }
  }
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
  const set=new Set(selected),tasks=[]; const q=inv.context.seriesUrl; const rs=inv.context.rsBase,study=inv.context.studyUid;
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
    let insts=[]; try{insts=await fetchJson(iu,state,'application/dicom+json, application/json');}catch{}
    if(!Array.isArray(insts)||!insts.length){try{insts=await fetchJson(inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/metadata`,q),state,'application/dicom+json, application/json');}catch{insts=[];}}
    if(!Array.isArray(insts)||!insts.length){const groups=await studyWide();insts=groups[s.seriesUid]||[];}
    let k=0;
    for(const inst of (Array.isArray(insts)?insts:[])){
      const iuid=getInstancesUid(inst); if(!iuid)continue; k++; const filename=`PACS_DICOM/${studyFolderName(inv)}/${folder}/IM_${String(k).padStart(5,'0')}_${sanitizeSegment(iuid,'instance')}.dcm`;
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

async function buildTasks(inv,selected) {
  const state=await getTabState(inv.tabId);
  if(inv.adapter==='VRAD')return buildVradTasks(inv,selected,state);
  if(inv.adapter==='VRPACS')return buildVrpacsTasks(inv,selected,state);
  if(inv.adapter==='DICOMWEB')return buildDicomwebTasks(inv,selected,state);
  return [];
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

async function updateJob(patch) {
  const job=await getSession(JOB_KEY,{}); Object.assign(job,patch,{updatedAt:Date.now()}); await setSession(JOB_KEY,job); chrome.runtime.sendMessage({type:'JOB_UPDATED',job}).catch(()=>{}); return job;
}
async function appendJobError(text){const j=await getSession(JOB_KEY,{});const errors=[...(j.errors||[])];errors.push(String(text));if(errors.length>40)errors.shift();return updateJob({errors});}

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
  const job=await getSession(JOB_KEY,{});
  const active=[...(job.activeDownloadIds||[]),id];
  await updateJob({activeDownloadIds:active,currentFile:task.filename,current:index+1,total,...extra});
}
async function unregisterActiveDownload(id) {
  const job=await getSession(JOB_KEY,{});
  await updateJob({activeDownloadIds:(job.activeDownloadIds||[]).filter(x=>x!==id)});
}

async function directHttpDownload(task,index,total) {
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
  await unregisterActiveDownload(id);
  if(!done.ok)throw new Error(`Download trực tiếp bị gián đoạn: ${done.error||'unknown'}`);
  const mime=String(done.item?.mime||'').toLowerCase();
  if(mime.includes('text/html')||mime.includes('application/json')){
    throw new Error(`PACS trả ${mime} thay vì DICOM (có thể link/session đã hết hạn).`);
  }
  return true;
}

async function blobPreparedDownload(task,index,total) {
  let prep;
  try{prep=await offscreenPrepare(task);}catch(e){if(task.fallback)prep=await offscreenPrepare({...task.fallback,filename:task.filename});else throw e;}
  if((await getSession(JOB_KEY,{})).cancelRequested){await revokeBlob(prep.blobUrl);throw new Error('__CANCELLED__');}
  const id=await chrome.downloads.download({url:prep.blobUrl,filename:task.filename,conflictAction:'uniquify',saveAs:false});
  const job=await getSession(JOB_KEY,{});
  await registerActiveDownload(id,task,index,total,{bytesPrepared:(job.bytesPrepared||0)+(prep.size||0)});
  const done=await waitDownload(id); await revokeBlob(prep.blobUrl); await unregisterActiveDownload(id);
  if(!done.ok)throw new Error(`Download bị gián đoạn: ${done.error||task.filename}`);
  return true;
}

async function processTask(task,index,total) {
  if((await getSession(JOB_KEY,{})).cancelRequested)throw new Error('__CANCELLED__');
  const attempts=task.mode==='direct-http'?3:2;
  let lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    if((await getSession(JOB_KEY,{})).cancelRequested)throw new Error('__CANCELLED__');
    try{
      if(task.mode==='direct-http')return await directHttpDownload(task,index,total);
      return await blobPreparedDownload(task,index,total);
    }catch(e){
      if(String(e?.message||e)==='__CANCELLED__')throw e;
      lastError=e;
      if(attempt<attempts)await sleep(600*attempt);
    }
  }
  throw lastError||new Error('Không tải được DICOM.');
}

async function runJob(inv,selected) {
  try{
    const tasks=await buildTasks(inv,selected); if(!tasks.length)throw new Error('Không tạo được danh sách DICOM cần tải.');
    await updateJob({status:'downloading',total:tasks.length,current:0,completed:0,failed:0,currentFile:'',errors:[]});
    let next=0,completed=0,failed=0;
    async function worker(){
      while(true){const idx=next++;if(idx>=tasks.length)return;try{await processTask(tasks[idx],idx,tasks.length);completed++;await updateJob({completed});}catch(e){if(String(e?.message||e)==='__CANCELLED__')return;failed++;await appendJobError(`${tasks[idx].filename}: ${e?.message||e}`);await updateJob({failed});}}
    }
    await Promise.all([worker(),worker(),worker()]);
    const j=await getSession(JOB_KEY,{}); if(j.cancelRequested){await updateJob({status:'cancelled',currentFile:''});await upsertHistory(inv,{status:'cancelled',lastDownloadAt:Date.now(),downloaded:completed,failed});} else {const status=failed?'done_with_errors':'done';await updateJob({status,currentFile:''});await upsertHistory(inv,{status,lastDownloadAt:Date.now(),downloaded:completed,failed});}
  } catch(e){ if(String(e?.message||e)==='__CANCELLED__'){await updateJob({status:'cancelled'});await upsertHistory(inv,{status:'cancelled',lastDownloadAt:Date.now()});} else{await appendJobError(e?.message||e);await updateJob({status:'error'});await upsertHistory(inv,{status:'error',lastDownloadAt:Date.now(),lastError:String(e?.message||e)});} }
  finally{runningJob=null;}
}

async function startJob(tabId,selected) {
  if(runningJob)throw new Error('Đang có một lượt tải khác chạy.'); const inv=await getSession(invKey(tabId)); if(!inv)throw new Error('Hãy Phân tích study trước.');
  const job={id:crypto.randomUUID(),tabId,status:'preparing',adapter:inv.adapter,studyUid:inv.studyUid||'',selectedSeries:selected,current:0,total:0,completed:0,failed:0,bytesPrepared:0,activeDownloadIds:[],cancelRequested:false,errors:[],startedAt:Date.now(),updatedAt:Date.now()}; await setSession(JOB_KEY,job);
  runningJob=runJob(inv,selected); return job;
}

async function cancelJob(){const j=await getSession(JOB_KEY,{});await updateJob({cancelRequested:true,status:'cancelling'});for(const id of (j.activeDownloadIds||[])){try{await chrome.downloads.cancel(id);}catch{}}return true;}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target==='offscreen')return false;
  (async()=>{
    if(message?.type==='SCAN_TAB'){const s=await scanTab(Number(message.tabId));return {ok:true,summary:s};}
    if(message?.type==='ANALYZE_TAB'){const inv=await analyzeTab(Number(message.tabId));return {ok:true,inventory:inv};}
    if(message?.type==='GET_INVENTORY'){return {ok:true,inventory:await getSession(invKey(Number(message.tabId)))};}
    if(message?.type==='RESET_CAPTURE'){await resetCapture(Number(message.tabId));return {ok:true};}
    if(message?.type==='GET_HISTORY'){return {ok:true,history:await getHistory()};}
    if(message?.type==='CLEAR_HISTORY'){await chrome.storage.local.set({[HISTORY_KEY]:[]});chrome.runtime.sendMessage({type:'HISTORY_UPDATED',history:[]}).catch(()=>{});return {ok:true};}
    if(message?.type==='START_DOWNLOAD'){return {ok:true,job:await startJob(Number(message.tabId),message.selectedSeries||[])};}
    if(message?.type==='GET_JOB'){return {ok:true,job:await getSession(JOB_KEY)};}
    if(message?.type==='CANCEL_JOB'){await cancelJob();return {ok:true};}
    if(message?.type==='OPEN_DOWNLOADS_FOLDER'){chrome.downloads.showDefaultFolder();return {ok:true};}
    return {ok:false,error:'Unknown message'};
  })().then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});
