'use strict';
import {cleanUrl,classifyPacsUrl,viewerUrlScore,originPattern,bestDetectedRequest,safeHeaders,replayContentType,viewerStudyHint,classifyViewerShell,sanitizeSegment,computeUrlFingerprint,RecipeStoreV2} from './lib/pacs.js';
import {matchingAdapters,adapterById} from './lib/adapters/registry.js';
import {compatibleAdapterIds,mapSeriesSelection,tasksBelongToStudy,cumulativeAttemptCounters,inventoryIsCovered,dedupeTasksBySop} from './lib/orchestrator.js';
import {extractManifestCandidates,candidateProbePlan,recordsForSuccessfulShapes,manifestRecipeFromDiscovery,studyProfileFromProbeDetails,looksLikeDicomJson,urlShape} from './lib/generic_discovery.js';

const TAB_PREFIX='pacs6_tab_',INV_PREFIX='pacs6_inv_',JOB_PREFIX='pacs6_job_',HISTORY_KEY='pacs6_history',RECIPES_KEY='pacs6_site_recipes';
const MAX_HISTORY=100,MAX_NAV=60,MAX_REQUESTS=500,AUTO_SCORE=55;
const analyzeTimers=new Map(),contextTimers=new Map(),probeTimers=new Map(),learnTimers=new Map(),jobMemory=new Map(),jobFlushTimers=new Map();
let learnedRecipes={};
const tabKey=id=>`${TAB_PREFIX}${id}`,invKey=id=>`${INV_PREFIX}${id}`,jobKey=id=>`${JOB_PREFIX}${id}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pathSignature(raw){try{const u=new URL(raw),parts=u.pathname.split('/').map(seg=>{if(!seg)return'';if(/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(seg)||/^[0-9a-f]{20,}$/i.test(seg)||/^\d+(?:\.\d+){3,}$/.test(seg)||seg.length>40)return'*';return seg;});const keys=[...u.searchParams.keys()].filter(k=>!/(token|sig|signature|session|auth|key|password|pass|stoken)/i.test(k)).sort();return`${u.origin}${parts.join('/')}?${keys.join('&')}`;}catch{return'';}}
function recipeForOrigin(origin, rawInput){
  const raw=rawInput || learnedRecipes[origin];
  const empty=()=>({schemaVersion:3,dicom:[],manifest:[],manifestRecipes:[],adapters:{},capabilities:{},updatedAt:Date.now()});
  if(!raw||typeof raw!=='object')return empty();
  if(Array.isArray(raw))return{...empty(),dicom:[...raw]};
  return{
    schemaVersion:3,
    dicom:Array.isArray(raw.dicom)?raw.dicom:[],
    manifest:Array.isArray(raw.manifest)?raw.manifest:[],
    manifestRecipes:Array.isArray(raw.manifestRecipes)?raw.manifestRecipes:[],
    adapters:(raw.adapters&&typeof raw.adapters==='object')?raw.adapters:{},
    capabilities:(raw.capabilities&&typeof raw.capabilities==='object')?raw.capabilities:{},
    updatedAt:raw.updatedAt || Date.now(),
  };
}
/**
 * Recipe storage key based on link structure. Writing and reading MUST go through this function.
 */
function recipeKeyForUrl(rawUrl){return computeUrlFingerprint(rawUrl);}
function recipeForUrl(rawUrl){
  if(!rawUrl)return recipeForOrigin('');
  const fp=recipeKeyForUrl(rawUrl);
  if(learnedRecipes[fp])return learnedRecipes[fp];
  try{
    const origin=new URL(rawUrl).origin;
    if(learnedRecipes[origin])return learnedRecipes[origin];
  }catch{}
  return recipeForOrigin('');
}
async function loadRecipes(){
  const o=await chrome.storage.local.get(RECIPES_KEY);
  const rawMap=o[RECIPES_KEY]&&typeof o[RECIPES_KEY]==='object'?o[RECIPES_KEY]:{};
  learnedRecipes={};
  for(const [key, raw] of Object.entries(rawMap)){
    learnedRecipes[key]=recipeForOrigin(key, raw);
  }
  learnedRecipes=RecipeStoreV2.purgeExpired(learnedRecipes);
  learnedRecipes=RecipeStoreV2.pruneCapacity(learnedRecipes, 200);
}
function learnedRole(raw,role){const sig=pathSignature(raw);if(!sig)return false;try{return recipeForOrigin(new URL(raw).origin)[role]?.includes(sig)||false;}catch{return false;}}
function isLearnedUrl(raw){return learnedRole(raw,'dicom');}
function isLearnedManifestUrl(raw){return learnedRole(raw,'manifest');}
async function learnUrl(raw,role='dicom'){
  const sig=pathSignature(raw);
  if(!sig||!['dicom','manifest'].includes(role))return;
  let origin='';
  try{origin=new URL(raw).origin;}catch{return;}
  const recipe=recipeForOrigin(origin),list=[...(recipe[role]||[])];
  if(!list.includes(sig))list.push(sig);
  recipe[role]=list.slice(-40);
  recipe.updatedAt=Date.now();
  learnedRecipes[origin]=recipe;
  learnedRecipes=RecipeStoreV2.purgeExpired(learnedRecipes);
  learnedRecipes=RecipeStoreV2.pruneCapacity(learnedRecipes, 200);
  await chrome.storage.local.set({[RECIPES_KEY]:learnedRecipes});
}
async function recordCapabilities(rawUrl,patch={}){
  if(!rawUrl)return;try{const origin=new URL(rawUrl).origin,recipe=recipeForOrigin(origin),old=recipe.capabilities||{},next={...old};for(const[k,v]of Object.entries(patch)){if(Array.isArray(v))next[k]=[...new Set([...(Array.isArray(old[k])?old[k]:[]),...v])].slice(-20);else next[k]=v;}next.updatedAt=Date.now();recipe.capabilities=next;recipe.updatedAt=Date.now();learnedRecipes[origin]=recipe;await chrome.storage.local.set({[RECIPES_KEY]:learnedRecipes});}catch{}
}
async function recordAdapterOutcome(urlOrOrigin,adapterId,outcome={}){
  if(!urlOrOrigin||!adapterId)return;
  const now=Date.now();
  let origin='';
  let fingerprint='';
  if(urlOrOrigin.startsWith('http://')||urlOrOrigin.startsWith('https://')){
    try{
      origin=new URL(urlOrOrigin).origin;
      fingerprint=recipeKeyForUrl(urlOrOrigin);
    }catch{}
  }else{
    origin=urlOrOrigin;
  }

  if(origin){
    const recipe=recipeForOrigin(origin);
    recipe.updatedAt=now;
    const adapters=recipe.adapters||{};
    adapters[adapterId]=RecipeStoreV2.updateRecipe(adapters[adapterId],adapterId,outcome,now);
    recipe.adapters=adapters;
    learnedRecipes[origin]=recipe;
  }

  if(fingerprint && fingerprint!==origin){
    const fpRecipe=learnedRecipes[fingerprint]||{schemaVersion:3,fingerprint,dicom:[],manifest:[],manifestRecipes:[],adapters:{},capabilities:{},updatedAt:now};
    fpRecipe.updatedAt=now;
    const fpAdapters=fpRecipe.adapters||{};
    fpAdapters[adapterId]=RecipeStoreV2.updateRecipe(fpAdapters[adapterId],adapterId,outcome,now);
    fpRecipe.adapters=fpAdapters;
    learnedRecipes[fingerprint]=fpRecipe;
  }

  learnedRecipes=RecipeStoreV2.purgeExpired(learnedRecipes, now);
  learnedRecipes=RecipeStoreV2.pruneCapacity(learnedRecipes, 200);
  await chrome.storage.local.set({[RECIPES_KEY]:learnedRecipes});
}
/** Adapter ranking score for this link pattern based on previous downloads. */
function adapterScore(ad){
  if(!ad)return 0;
  // If adapter has successfully downloaded this link pattern previously, promote it to the top.
  const proven=RecipeStoreV2.getPreferredAdapter(ad)?1000:0;
  const wins=(ad.success||0)-((ad.failure||0)+(ad.failureByClass?.auth||0)*2);
  const slowness=ad.latencyEwmaMs?Math.min(50,ad.latencyEwmaMs/100):0;
  return proven+wins*100-slowness;
}
function candidateDisplay(raw){try{const u=new URL(raw),keys=[...u.searchParams.keys()].filter(Boolean);return`${u.host}${u.pathname}${keys.length?`?${keys.join('&')}`:''}`;}catch{return String(raw||'');}}

async function getSession(key,fallback=null){const o=await chrome.storage.session.get(key);return o[key]??fallback;}
async function setSession(key,value){await chrome.storage.session.set({[key]:value});}
function defaultState(tabId){return{tabId,navUrls:[],pendingNavUrls:[],frameUrls:[],pacsRequests:[],headersByOrigin:{},currentUrl:'',mainDocumentId:'',studyHint:'',tracking:'idle',confidence:0,pageHintScore:0,pageHintReasons:[],genericDirectUrls:[],genericDirectMeta:{},genericEntries:[],genericProfile:{},binaryCandidates:[],binaryProbed:[],lastDeepProbeAt:0,learning:{active:false,startedAt:0},learnCandidates:[],vietmyRecaptureDone:false,zfpViewer:false,zfpReloadDone:false,genericHookActive:false,updatedAt:Date.now()};}
async function getTabState(tabId){return getSession(tabKey(tabId),defaultState(tabId));}
async function saveTabState(tabId,s){s.updatedAt=Date.now();await setSession(tabKey(tabId),s);}
function pushUnique(list,value,max=MAX_NAV){if(!value)return;const i=list.indexOf(value);if(i>=0)list.splice(i,1);list.push(value);if(list.length>max)list.splice(0,list.length-max);}

async function getHistory(){const o=await chrome.storage.local.get(HISTORY_KEY);return Array.isArray(o[HISTORY_KEY])?o[HISTORY_KEY]:[];}
function historyKey(inv){if(inv?.studyUid)return`study|${inv.studyUid}`;const p=inv?.patient||{};return p.id&&p.studyDate?`patient|${p.id}|${p.studyDate}|${p.description||''}`:'';}
async function findHistory(inv){const h=await getHistory();if(inv?.studyUid){const x=h.find(v=>v.studyUid===inv.studyUid);if(x)return x;}const p=inv?.patient||{};if(p.id&&p.studyDate){let c=h.filter(v=>v.patientId===p.id&&v.studyDate===p.studyDate);if(p.accession)c=c.filter(v=>!v.accession||v.accession===p.accession);if(p.description)c=c.filter(v=>!v.description||v.description===p.description);return c.length===1?c[0]:null;}return null;}
async function upsertHistory(inv,patch={}){if(!inv)return null;const key=historyKey(inv);if(!key)return null;const list=await getHistory();let i=list.findIndex(x=>x.key===key||(inv.studyUid&&x.studyUid===inv.studyUid));const old=i>=0?list[i]:{};const next={...old,key,adapter:inv.adapter||old.adapter||'',studyUid:inv.studyUid||old.studyUid||'',patientName:inv.patient?.name||old.patientName||'',patientId:inv.patient?.id||old.patientId||'',studyDate:inv.patient?.studyDate||old.studyDate||'',description:inv.patient?.description||old.description||'',accession:inv.patient?.accession||old.accession||'',seriesCount:inv.series?.length||old.seriesCount||0,...patch,updatedAt:Date.now()};if(old.status==='done'&&patch.status&&patch.status!=='done')next.status='done';if(i>=0)list.splice(i,1);list.unshift(next);list.length=Math.min(list.length,MAX_HISTORY);await chrome.storage.local.set({[HISTORY_KEY]:list});chrome.runtime.sendMessage({type:'HISTORY_UPDATED',history:list}).catch(()=>{});return next;}

function urlConfidence(raw){const shell=classifyViewerShell(raw);return Math.max(0,Number(viewerUrlScore(raw))||0,Number(shell?.score)||0);}
async function hasOrigin(url){const p=originPattern(url);if(!p)return false;return chrome.permissions.contains({origins:[p]});}
async function missingPatterns(urls){const out=[];for(const p of [...new Set((urls||[]).map(originPattern).filter(Boolean))])if(!(await chrome.permissions.contains({origins:[p]})))out.push(p);return out;}
async function injectContent(tabId){try{await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:['content.js']});return true;}catch{try{await chrome.scripting.executeScript({target:{tabId},files:['content.js']});return true;}catch{return false;}}}
async function injectGenericHook(tabId){try{await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',files:['generic-hook.js']});return true;}catch{try{await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['generic-hook.js']});return true;}catch{return false;}}}
async function ensurePanel(tabId){try{await chrome.sidePanel.setOptions({path:'sidepanel.html',enabled:true});if(tabId)await chrome.sidePanel.setOptions({tabId,path:'sidepanel.html',enabled:true});}catch{}}

async function setBadge(tabId){if(tabId<0)return;const s=await getTabState(tabId),inv=await getSession(invKey(tabId)),job=jobMemory.get(tabId)||await getSession(jobKey(tabId));let text='',color='#64748b',title='PACS DICOM Downloader';if(job&&['preparing','downloading','cancelling'].includes(job.status)){text='↓';color='#2563eb';title='Downloading DICOM';}else if(inv?.previousDownload?.status==='done'){text='✓';color='#168a52';title='Study downloaded';}else if(inv?.series?.length){text=String(Math.min(99,inv.series.length));color='#168a52';title=`${inv.series.length} series`;}else if(s.tracking==='watching'){text='•';color='#2563eb';title='Tracking PACS';}else if(s.tracking==='candidate'){text='?';color='#b7791f';title='Possible PACS';}else if(s.tracking==='stopped'){text='Ⅱ';color='#7c8798';title='Tracking stopped';}await chrome.action.setBadgeBackgroundColor({tabId,color}).catch(()=>{});await chrome.action.setBadgeText({tabId,text}).catch(()=>{});await chrome.action.setTitle({tabId,title}).catch(()=>{});}

async function markCandidate(tabId,url){const clean=cleanUrl(url);if(tabId<0||!clean)return;const score=urlConfidence(clean);const s=await getTabState(tabId);s.currentUrl=clean;s.confidence=Math.max(Number(s.confidence)||0,Math.min(100,Math.round(score)));if(score>=AUTO_SCORE&&!['watching','stopped'].includes(s.tracking)){s.tracking='candidate';if(await hasOrigin(clean))await injectContent(tabId);}await saveTabState(tabId,s);await setBadge(tabId);}
async function maybeRecaptureVietmy(tabId){try{const s=await getTabState(tabId);if(s.tracking!=='watching'||s.vietmyRecaptureDone)return;const shell=classifyViewerShell(s.currentUrl||'');if(shell?.type!=='SHARE_STUDY')return;const summary=await scanTab(tabId),seen=summary.requests.some(x=>x.type==='VIETMY_MANIFEST'),captured=(s.pacsRequests||[]).some(x=>x.type==='VIETMY_MANIFEST');if(seen&&!captured){s.vietmyRecaptureDone=true;await saveTabState(tabId,s);await chrome.tabs.reload(tabId);}}catch{}}
async function startTracking(tabId,manual=false){const s=await getTabState(tabId);s.tracking='watching';if(manual)s.manual=true;await saveTabState(tabId,s);await injectContent(tabId);await injectGenericHook(tabId);s.genericHookActive=true;await saveTabState(tabId,s);await setBadge(tabId);scheduleAnalyze(tabId,250);if(manual)setTimeout(()=>maybeRecaptureVietmy(tabId),450);return s;}
async function stopTracking(tabId){const s=await getTabState(tabId);s.tracking='stopped';await saveTabState(tabId,s);await setBadge(tabId);return s;}

async function rememberBeforeNavigate(tabId,raw){if(tabId<0)return;const u=cleanUrl(raw);if(!u)return;const s=await getTabState(tabId);pushUnique(s.pendingNavUrls,u);s.currentUrl=u;await saveTabState(tabId,s);markCandidate(tabId,u).catch(()=>{});}
async function invalidate(tabId,reason){await chrome.storage.session.remove(invKey(tabId));chrome.runtime.sendMessage({type:'TAB_CONTEXT_CHANGED',tabId,reason}).catch(()=>{});}
async function rememberCommitted(d){if(d.tabId<0)return;const u=cleanUrl(d.url);if(!u)return;if(d.frameId!==0){const s=await getTabState(d.tabId);pushUnique(s.frameUrls,u);await saveTabState(d.tabId,s);markCandidate(d.tabId,u).catch(()=>{});if(await hasOrigin(u))setTimeout(()=>{injectContent(d.tabId);getTabState(d.tabId).then(x=>{if(x.tracking==='watching')injectGenericHook(d.tabId);});},100);return;}const s=await getTabState(d.tabId);const changed=Boolean(s.mainDocumentId&&d.documentId&&s.mainDocumentId!==d.documentId);if(changed){s.navUrls=[...(s.pendingNavUrls||[])];s.pacsRequests=[];s.frameUrls=[];s.genericDirectUrls=[];s.genericDirectMeta={};s.genericEntries=[];s.genericProfile={};s.binaryCandidates=[];s.binaryProbed=[];s.lastDeepProbeAt=0;s.pageHintScore=0;s.pageHintReasons=[];s.confidence=0;s.studyHint=viewerStudyHint(u)||'';s.vietmyRecaptureDone=false;if(s.tracking==='stopped')s.tracking='idle';await invalidate(d.tabId,'document');}pushUnique(s.navUrls,u);s.pendingNavUrls=[];s.currentUrl=u;s.mainDocumentId=d.documentId||s.mainDocumentId||'';if(!s.studyHint)s.studyHint=viewerStudyHint(u)||'';await saveTabState(d.tabId,s);await markCandidate(d.tabId,u);if(await hasOrigin(u))setTimeout(()=>{injectContent(d.tabId);getTabState(d.tabId).then(x=>{if(x.tracking==='watching')injectGenericHook(d.tabId);});},100);}
async function rememberSameDocument(tabId,raw){if(tabId<0)return;const u=cleanUrl(raw);if(!u)return;const s=await getTabState(tabId);const old=s.studyHint||'',next=viewerStudyHint(u)||'';if(old&&next&&old!==next){s.pacsRequests=[];s.frameUrls=[];s.genericDirectUrls=[];s.genericDirectMeta={};s.genericEntries=[];s.genericProfile={};s.binaryCandidates=[];s.binaryProbed=[];s.lastDeepProbeAt=0;s.studyHint=next;await invalidate(tabId,'study');}else if(!old&&next)s.studyHint=next;pushUnique(s.navUrls,u);s.currentUrl=u;await saveTabState(tabId,s);await markCandidate(tabId,u);}
chrome.webNavigation.onBeforeNavigate.addListener(d=>{if(d.frameId===0)rememberBeforeNavigate(d.tabId,d.url).catch(()=>{});});
chrome.webNavigation.onCommitted.addListener(d=>rememberCommitted(d).catch(()=>{}));
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>{if(d.frameId===0)rememberSameDocument(d.tabId,d.url).catch(()=>{});else rememberCommitted(d).catch(()=>{});});
chrome.webNavigation.onReferenceFragmentUpdated.addListener(d=>{if(d.frameId===0)rememberSameDocument(d.tabId,d.url).catch(()=>{});else rememberCommitted(d).catch(()=>{});});

function serializeRequestBody(rb){if(!rb)return null;if(rb.formData)return{kind:'form',data:rb.formData};if(Array.isArray(rb.raw)&&rb.raw.length){const chunks=[];for(const p of rb.raw)if(p.bytes){const a=new Uint8Array(p.bytes);let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));chunks.push(btoa(s));}if(chunks.length)return{kind:'raw',chunks};}return null;}
function storedBodySignature(stored){if(!stored)return'';let raw='';try{raw=stored.kind==='form'?JSON.stringify(stored.data||{}):(stored.kind==='raw'?(stored.chunks||[]).join('|'):JSON.stringify(stored));}catch{}let h=2166136261;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619);}return`${raw.length}:${(h>>>0).toString(16)}`;}
function learnCandidateAllowed(url,type=''){if(!/^https?:/i.test(url)||/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(url))return false;if(/\.(?:js|css|map|woff2?|ttf|png|jpe?g|gif|svg|ico|mp4|webm|mp3)(?:\?|$)/i.test(url))return false;return ['xmlhttprequest','other','fetch'].includes(String(type||'').toLowerCase())||/\/(?:api|rest|services?|viewer|study|series|image|dicom|exam|patient)/i.test(url);}
async function rememberLearningRequest(tabId,details,state=null){const s=state||await getTabState(tabId);if(!s.learning?.active||!learnCandidateAllowed(details.url,details.type))return;const sensitive=/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(details.url);const body=!sensitive&&!['GET','HEAD'].includes(String(details.method||'GET').toUpperCase())?serializeRequestBody(details.requestBody):null;const key=String(details.requestId||`${String(details.method||'GET').toUpperCase()}|${details.url}|${storedBodySignature(body)}`),list=(s.learnCandidates||[]).filter(x=>String(x.requestKey||'')!==key);list.push({url:cleanUrl(details.url),display:candidateDisplay(details.url),method:String(details.method||'GET').toUpperCase(),requestBody:body,requestId:details.requestId||'',requestKey:key,type:details.type||'',contentType:'',status:0,contentLength:0,time:Date.now()});s.learnCandidates=list.slice(-140);await saveTabState(tabId,s);chrome.runtime.sendMessage({type:'LEARN_UPDATED',tabId}).catch(()=>{});}
async function rememberLearningResponse(tabId,details,contentType='',contentLength=0){const s=await getTabState(tabId);if(!s.learning?.active)return;const list=s.learnCandidates||[],rev=[...list].reverse(),i=rev.findIndex(x=>(details.requestId&&String(x.requestId||'')===String(details.requestId))||(!details.requestId&&x.url===cleanUrl(details.url)));if(i<0)return;const idx=list.length-1-i;list[idx]={...list[idx],contentType:String(contentType||'').toLowerCase(),status:Number(details.statusCode)||0,contentLength:Number(contentLength)||0,time:Date.now()};s.learnCandidates=list;await saveTabState(tabId,s);chrome.runtime.sendMessage({type:'LEARN_UPDATED',tabId}).catch(()=>{});}
function scheduleLearnedManifest(tabId,url,requestMeta,delay=500){const key=`${tabId}|${pathSignature(url)}`;clearTimeout(learnTimers.get(key));learnTimers.set(key,setTimeout(()=>{learnTimers.delete(key);materializeLearnedManifest(tabId,url,requestMeta).catch(()=>{});},delay));}
function requestMetaForObserved(state,url,method='GET',requestId=''){
  const m=String(method||'GET').toUpperCase(),rows=[...(state.pacsRequests||[])].reverse();if(requestId){const exact=rows.find(x=>String(x.requestId||'')===String(requestId));if(exact)return exact;}return rows.find(x=>x.url===cleanUrl(url)&&String(x.method||'GET').toUpperCase()===m)||null;
}
function probeTaskFromRow(state,row){return{url:row.url,method:row.method||'GET',requestBody:row.requestBody||null,contentType:row.contentType||'',headers:headersForUrl(state,row.url)};}
function genericEntryKey(entry){return entry?.requestKey||`${String(entry?.method||'GET').toUpperCase()}|${entry?.url||''}|${storedBodySignature(entry?.requestBody)}`;}
function mergeGenericEntry(list,entry){const key=genericEntryKey(entry);const out=(list||[]).filter(x=>genericEntryKey(x)!==key);out.push({...entry,requestKey:key});return out.slice(-6000);}
async function saveManifestDiscoveryRecipe(manifestUrl,requestMeta,winningRows){
  const learned=manifestRecipeFromDiscovery(manifestUrl,requestMeta,winningRows);if(!learned)return;
  try{const origin=new URL(manifestUrl).origin,recipe=recipeForOrigin(origin),rows=[...(recipe.manifestRecipes||[])].filter(x=>x.manifestShape!==learned.manifestShape);rows.push(learned);recipe.manifestRecipes=rows.slice(-30);recipe.updatedAt=Date.now();learnedRecipes[origin]=recipe;await chrome.storage.local.set({[RECIPES_KEY]:learnedRecipes});}catch{}
}
async function processGenericManifestPayload(tabId,url,requestMeta,payload,source='replay'){
  const state=await getTabState(tabId),originRecipe=(()=>{try{return recipeForOrigin(new URL(url).origin);}catch{return recipeForOrigin('');}})();
  const learned=(originRecipe.manifestRecipes||[]).find(x=>x.manifestShape===urlShape(url))||null;
  const candidates=extractManifestCandidates(payload,url);if(!candidates.length)return{valid:[],discovered:0,dicomJson:looksLikeDicomJson(payload)};
  const plan=candidateProbePlan(candidates,learned,{maxGroups:30,samplesPerGroup:2});if(!plan.length)return{valid:[],discovered:candidates.length};
  await ensureOffscreen();const valid=[];
  for(let i=0;i<plan.length;i+=24){const probes=plan.slice(i,i+24).map(r=>({url:r.url,method:'GET',headers:headersForUrl(state,r.url)}));const resp=await chrome.runtime.sendMessage({target:'offscreen',type:'PROBE_DICOM_URLS',probes}).catch(()=>null);if(Array.isArray(resp?.valid))valid.push(...resp.valid);}
  const validSet=new Set(valid),successShapes=[...new Set(plan.filter(x=>validSet.has(x.url)).map(x=>x.clusterShape||x.shape))];if(!successShapes.length)return{valid:[],discovered:candidates.length};
  const winning=recordsForSuccessfulShapes(candidates,successShapes);const reps=[];for(const shape of successShapes){const row=winning.find(x=>x.shape===shape);if(row)reps.push({url:row.url,method:'GET',headers:headersForUrl(state,row.url)});}
  const inspected=await chrome.runtime.sendMessage({target:'offscreen',type:'INSPECT_DICOM_URLS',probes:reps}).catch(()=>null);const details=Array.isArray(inspected?.details)?inspected.details.filter(x=>x.ok):[],detailByUrl=new Map(details.map(x=>[x.url,x]));
  const profile={...(state.genericProfile||{}),...studyProfileFromProbeDetails(details)};let entries=[...(state.genericEntries||[])];
  for(const row of winning){const d=detailByUrl.get(row.url);entries=mergeGenericEntry(entries,{url:row.url,method:'GET',requestBody:null,contentType:d?.contentType||'',declared:row.meta||{},meta:d?.meta||null,shape:row.shape,source:`manifest:${source}`});}
  const fresh=await getTabState(tabId);fresh.genericEntries=entries;fresh.genericProfile={...(fresh.genericProfile||{}),...profile};fresh.genericDirectUrls=[...new Set([...(fresh.genericDirectUrls||[]),...winning.map(x=>x.url)])].slice(-6000);for(const row of winning)fresh.genericDirectMeta[row.url]={contentType:detailByUrl.get(row.url)?.contentType||'application/octet-stream',learned:true};fresh.confidence=Math.max(Number(fresh.confidence)||0,97);await saveTabState(tabId,fresh);
  for(const row of plan.filter(x=>validSet.has(x.url)))await learnUrl(row.url,'dicom');await learnUrl(url,'manifest');await saveManifestDiscoveryRecipe(url,requestMeta,winning);await recordCapabilities(url,{genericManifest:true,directDicom:true,manifestMethods:[String(requestMeta?.method||'GET').toUpperCase()]});scheduleAnalyze(tabId,100);return{valid:winning.map(x=>x.url),discovered:candidates.length,groups:successShapes.length};
}
async function materializeLearnedManifest(tabId,url,requestMeta){const s=await getTabState(tabId);let payload;try{payload=await fetchJsonFor(s,url,'application/json, application/dicom+json, text/json, */*',requestMeta);}catch{return{valid:[],discovered:0};}return processGenericManifestPayload(tabId,url,requestMeta,payload,'replay');}
async function startLearning(tabId){const s=await startTracking(tabId,true);s.learning={active:true,startedAt:Date.now()};s.learnCandidates=[];await saveTabState(tabId,s);chrome.runtime.sendMessage({type:'LEARN_UPDATED',tabId}).catch(()=>{});return s;}
async function stopLearning(tabId){const s=await getTabState(tabId);s.learning={active:false,startedAt:s.learning?.startedAt||0};await saveTabState(tabId,s);chrome.runtime.sendMessage({type:'LEARN_UPDATED',tabId}).catch(()=>{});return s;}
async function markLearnCandidate(tabId,url,role){const s=await getTabState(tabId),row=[...(s.learnCandidates||[])].reverse().find(x=>x.url===cleanUrl(url));if(!row)throw new Error('Request is no longer in learning session.');if(role==='dicom'){await ensureOffscreen();const task=probeTaskFromRow(s,row);const r=await chrome.runtime.sendMessage({target:'offscreen',type:'PROBE_DICOM_URLS',probes:[task]});if(!r?.valid?.includes(row.url))throw new Error('This request does not return DICOM Part-10.');const inspected=await chrome.runtime.sendMessage({target:'offscreen',type:'INSPECT_DICOM_URLS',probes:[task]}).catch(()=>null),detail=inspected?.details?.find(x=>x.ok)||null;await learnUrl(row.url,'dicom');s.genericEntries=mergeGenericEntry(s.genericEntries,{url:row.url,method:row.method||'GET',requestBody:row.requestBody||null,contentType:row.contentType||detail?.contentType||'',declared:{},meta:detail?.meta||null,shape:pathSignature(row.url),source:'manual-learn'});pushUnique(s.genericDirectUrls,row.url,6000);s.genericDirectMeta[row.url]={contentType:row.contentType||'application/octet-stream',learned:true};if(detail?.meta)s.genericProfile={...(s.genericProfile||{}),...studyProfileFromProbeDetails([detail])};await saveTabState(tabId,s);scheduleAnalyze(tabId,80);return{role,valid:1};}if(role==='manifest'){await learnUrl(row.url,'manifest');const r=await materializeLearnedManifest(tabId,row.url,row);return{role,...r};}throw new Error('Invalid learning role.');}
function encodePageBody(body){if(typeof body!=='string'||!body)return null;const bytes=new TextEncoder().encode(body),chunks=[];let bin='';for(let i=0;i<bytes.length;i+=0x8000){bin='';for(const b of bytes.subarray(i,i+0x8000))bin+=String.fromCharCode(b);chunks.push(btoa(bin));}return{kind:'raw',chunks};}
async function handleGenericJsonCapture(tabId,row){if(tabId<0||!row?.url)return;const s=await getTabState(tabId);if(s.tracking!=='watching')return;if(/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(row.url))return;const recorded=requestMetaForObserved(s,row.url,row.method);if(!recorded)return;let payload;try{payload=JSON.parse(String(row.text||''));}catch{return;}const r=await processGenericManifestPayload(tabId,row.url,recorded,payload,'main-world');if(r?.valid?.length)recordCapabilities(row.url,{mainWorldJson:true}).catch(()=>{});}
async function rememberRequest(tabId,raw,extra={}){if(tabId<0)return;const hit=classifyPacsUrl(raw);const learnedManifest=isLearnedManifestUrl(raw);const s=await getTabState(tabId);if(!hit&&s.tracking!=='watching'&&!learnedManifest)return;const generic=hit||(/\/(?:api|rest|services?)\//i.test(raw)&&/(study|series|instance|image|dicom|exam|patient)/i.test(raw)?{type:'PACS_GENERIC_API',url:cleanUrl(raw),score:35}:null)||(learnedManifest?{type:'LEARNED_MANIFEST',url:cleanUrl(raw),score:72}:null)||(s.tracking==='watching'&&learnCandidateAllowed(raw,extra.resourceType||extra.type)?{type:'PACS_OBSERVED_API',url:cleanUrl(raw),score:12}:null);if(!generic)return;const method=String(extra.method||'GET').toUpperCase(),bodySig=storedBodySignature(extra.requestBody),id=extra.requestId?`${generic.type}|req:${extra.requestId}`:`${generic.type}|${generic.url}|${method}|${bodySig}`;const i=s.pacsRequests.findIndex(x=>x._id===id);if(i>=0)s.pacsRequests.splice(i,1);s.pacsRequests.push({...generic,...extra,_id:id,time:Date.now()});if(s.pacsRequests.length>MAX_REQUESTS)s.pacsRequests.splice(0,s.pacsRequests.length-MAX_REQUESTS);s.confidence=Math.max(Number(s.confidence)||0,Math.min(100,Number(generic.score)||0));if(s.tracking!=='stopped')s.tracking='watching';await saveTabState(tabId,s);await setBadge(tabId);if(Number(generic.score||0)>=80||['PACS_GENERIC_API','DICOM_IMAGE_API'].includes(generic.type))scheduleAnalyze(tabId,450);if(learnedManifest)scheduleLearnedManifest(tabId,generic.url,extra,450);chrome.runtime.sendMessage({type:'PACS_SIGNAL',tabId,signal:generic.type}).catch(()=>{});}
async function rememberHeaders(tabId,url,rawHeaders,requestId=''){if(/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(url))return;const s=await getTabState(tabId);if(!['watching','candidate'].includes(s.tracking))return;const h={};for(const x of(rawHeaders||[]))if(x.name&&x.value!=null)h[x.name]=x.value;const safe=safeHeaders(h);if(!Object.keys(safe).length)return;let ct='';for(const[k,v]of Object.entries(safe))if(k.toLowerCase()==='content-type'&&v){ct=String(v);break;}
if(ct){const u=cleanUrl(url);for(const r of(s.pacsRequests||[]))if(((requestId&&String(r.requestId||'')===String(requestId))||(!requestId&&r.url===u))&&!r.contentType)r.contentType=ct;}
try{const origin=new URL(url).origin;s.headersByOrigin[origin]={...(s.headersByOrigin[origin]||{}),...safe};await saveTabState(tabId,s);}catch{}}
async function rememberDicomResponse(tabId,url,contentType,status,method='GET',contentLength=0,requestId=''){
  if(tabId<0||Number(status)>=400)return;
  const m=String(method||'GET').toUpperCase(),ct=String(contentType||'').toLowerCase(),hit=classifyPacsUrl(url),learned=isLearnedUrl(url),u=cleanUrl(url);if(!u)return;
  const s=await getTabState(tabId);if(s.tracking==='stopped')return;const req=requestMetaForObserved(s,u,m,requestId);
  const strong=ct.includes('application/dicom')||/\.dcm(?:\?|$)/i.test(url)||(hit&&['WADO','DICOM_INSTANCE','DICOM_IMAGE_API','VRPACS_DICOM','VIETMY_DICOM'].includes(hit.type))||(learned&&ct.includes('application/octet-stream'));
  if(!strong&&!['watching','candidate'].includes(s.tracking))return;
  if(strong){
    const entry={url:u,method:m,requestBody:req?.requestBody||null,contentType:req?.contentType||ct,requestId:req?.requestId||requestId||'',requestKey:`${m}|${u}|${storedBodySignature(req?.requestBody)}`,declared:{},meta:null,shape:pathSignature(u),source:'observed-dicom'};
    s.genericEntries=mergeGenericEntry(s.genericEntries,entry);if(m==='GET')s.genericDirectUrls=[...new Set([...(s.genericDirectUrls||[]),u])].slice(-6000);s.genericDirectMeta[u]={contentType:ct,learned};s.confidence=Math.max(Number(s.confidence)||0,learned?95:90);await saveTabState(tabId,s);recordCapabilities(u,{directDicom:true,retrieveMethods:[m]}).catch(()=>{});scheduleAnalyze(tabId,500);return;
  }
  const binary=(ct.includes('application/octet-stream')||ct.includes('application/binary')||ct.includes('binary/octet-stream'))&&!/\.(?:js|css|woff2?|ttf|png|jpe?g|gif|svg|ico|mp4|webm)(?:\?|$)/i.test(u)&&!/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(u);
  if(binary&&s.tracking==='watching'){
    const sig=`${pathSignature(u)}|${m}|${storedBodySignature(req?.requestBody)}`;if(sig&&!(s.binaryProbed||[]).includes(sig)){const row={url:u,method:m,requestBody:req?.requestBody||null,requestId:req?.requestId||requestId||'',requestKey:`${m}|${u}|${storedBodySignature(req?.requestBody)}`,contentType:req?.contentType||ct,contentLength:Number(contentLength)||0,time:Date.now()};const list=(s.binaryCandidates||[]).filter(x=>String(x.requestKey||'')!==row.requestKey);list.push(row);s.binaryCandidates=list.slice(-120);await saveTabState(tabId,s);scheduleDeepProbe(tabId,900);}
  }
}
chrome.webRequest.onBeforeRequest.addListener(d=>{
  if(d.tabId<0)return;
  const hit=classifyPacsUrl(d.url),learnedManifest=isLearnedManifestUrl(d.url);
  getTabState(d.tabId).then(s=>{
    if(s.learning?.active)rememberLearningRequest(d.tabId,d,s).catch(()=>{});
    if(s.tracking==='stopped')return;
    if(!hit&&!learnedManifest&&!['watching','candidate'].includes(s.tracking))return;
    const sensitive=/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(d.url);
    const body=!sensitive&&!['GET','HEAD'].includes(String(d.method||'GET').toUpperCase())?serializeRequestBody(d.requestBody):null;
    rememberRequest(d.tabId,d.url,{method:d.method,requestBody:body,requestId:d.requestId,resourceType:d.type,source:'webRequest'}).catch(()=>{});
  });
},{urls:['<all_urls>']},['requestBody']);
chrome.webRequest.onBeforeSendHeaders.addListener(d=>{
  if(d.tabId>=0)rememberHeaders(d.tabId,d.url,d.requestHeaders,d.requestId).catch(()=>{});
},{urls:['<all_urls>']},['requestHeaders','extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(d=>{
  if(d.tabId<0)return;
  let ct='',len=0;
  for(const h of(d.responseHeaders||[])){
    const n=String(h.name).toLowerCase();
    if(n==='content-type')ct=String(h.value||'');
    else if(n==='content-length')len=Number(h.value)||0;
  }
  rememberDicomResponse(d.tabId,d.url,ct,d.statusCode,d.method,len,d.requestId).catch(()=>{});
  rememberLearningResponse(d.tabId,d,ct,len).catch(()=>{});
},{urls:['<all_urls>']},['responseHeaders','extraHeaders']);

function scheduleDeepProbe(tabId,delay=1000){clearTimeout(probeTimers.get(tabId));probeTimers.set(tabId,setTimeout(()=>{probeTimers.delete(tabId);deepProbeTab(tabId).catch(()=>{});},delay));}
async function deepProbeTab(tabId){
  const s=await getTabState(tabId);if(s.tracking!=='watching')return[];const now=Date.now();if(now-Number(s.lastDeepProbeAt||0)<5000)return[];
  const probed=new Set(s.binaryProbed||[]),rows=[];for(const row of[...(s.binaryCandidates||[])].reverse()){const sig=`${pathSignature(row.url)}|${String(row.method||'GET').toUpperCase()}|${storedBodySignature(row.requestBody)}`;if(!sig||probed.has(sig))continue;rows.push(row);probed.add(sig);if(rows.length>=8)break;}if(!rows.length)return[];
  s.lastDeepProbeAt=now;s.binaryProbed=[...probed].slice(-120);await saveTabState(tabId,s);await ensureOffscreen();
  const probes=rows.map(row=>probeTaskFromRow(s,row));const r=await chrome.runtime.sendMessage({target:'offscreen',type:'PROBE_DICOM_URLS',probes}).catch(()=>null);const valid=Array.isArray(r?.valid)?r.valid:[];if(!valid.length)return[];const inspected=await chrome.runtime.sendMessage({target:'offscreen',type:'INSPECT_DICOM_URLS',probes:probes.filter(p=>valid.includes(p.url)).slice(0,8)}).catch(()=>null),details=Array.isArray(inspected?.details)?inspected.details.filter(x=>x.ok):[],detailMap=new Map(details.map(x=>[x.url,x]));
  const fresh=await getTabState(tabId);for(const row of rows.filter(x=>valid.includes(x.url))){const url=row.url,d=detailMap.get(url);await learnUrl(url);fresh.genericEntries=mergeGenericEntry(fresh.genericEntries,{url,method:row.method||'GET',requestBody:row.requestBody||null,contentType:row.contentType||d?.contentType||'application/octet-stream',declared:{},meta:d?.meta||null,shape:pathSignature(url),source:'binary-probe'});if(String(row.method||'GET').toUpperCase()==='GET')fresh.genericDirectUrls=[...new Set([...(fresh.genericDirectUrls||[]),cleanUrl(url)])].slice(-6000);fresh.genericDirectMeta[cleanUrl(url)]={contentType:'application/octet-stream',learned:true};}fresh.genericProfile={...(fresh.genericProfile||{}),...studyProfileFromProbeDetails(details)};fresh.confidence=Math.max(Number(fresh.confidence)||0,96);await saveTabState(tabId,fresh);if(valid[0])recordCapabilities(valid[0],{directDicom:true,retrieveMethods:[String(rows.find(x=>x.url===valid[0])?.method||'GET').toUpperCase()]}).catch(()=>{});scheduleAnalyze(tabId,120);return valid;
}

async function applyPageHints(tabId,hint={}){if(tabId<0)return;const s=await getTabState(tabId),score=Math.min(100,Math.max(0,Number(hint.score)||0));s.pageHintScore=Math.max(Number(s.pageHintScore)||0,score);s.pageHintReasons=[...new Set([...(s.pageHintReasons||[]),...(hint.reasons||[])])].slice(-12);s.confidence=Math.max(Number(s.confidence)||0,score);for(const u of(hint.iframeUrls||[]))pushUnique(s.frameUrls,cleanUrl(u));if(score>=AUTO_SCORE&&s.tracking==='idle')s.tracking='candidate';if(hint.zfpViewer)s.zfpViewer=true;await saveTabState(tabId,s);await setBadge(tabId);
if(hint.zfpViewer&&s.tracking==='watching')maybeReloadForZfp(tabId,s).catch(()=>{});
if(score>=AUTO_SCORE&&s.tracking==='watching')scheduleAnalyze(tabId,400);}

async function scanPerformance(tabId){const allowed=await hasOrigin((await chrome.tabs.get(tabId)).url||'');if(!allowed)return[];const probe=()=>{const resolve=raw=>{try{return new URL(raw,location.href).href}catch{return''}},dom=new Set(),add=raw=>{const u=resolve(raw);if(/^https?:/i.test(u))dom.add(u)};for(const el of document.querySelectorAll('iframe[src],frame[src],embed[src],object[data],form[action],a[href],script[src],link[href]'))add(el.getAttribute('src')||el.getAttribute('data')||el.getAttribute('action')||el.getAttribute('href')||'');return{href:location.href,title:document.title||'',navigationUrl:performance.getEntriesByType('navigation')[0]?.name||'',resources:performance.getEntriesByType('resource').map(e=>e.name).filter(Boolean).slice(-3000),domUrls:[...dom].slice(-800),readyState:document.readyState,viewerDom:Boolean(document.querySelector('.cornerstone-canvas,[class*="cornerstone" i],[data-cornerstone-enabled],canvas')),vietmyStudyId:(()=>{for(const el of document.querySelectorAll('a[id^="series"]')){const m=String(el.id||'').match(/^series(?:_filter)?_?(\d{3,})/);if(m)return m[1];}return'';})()};};try{return(await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:probe})).map(x=>({frameId:x.frameId,...(x.result||{})}));}catch{return[];}}
async function scanFrameUrls(tabId){try{return(await chrome.webNavigation.getAllFrames({tabId})).map(f=>({frameId:f.frameId,url:cleanUrl(f.url),documentId:f.documentId||''})).filter(f=>f.url);}catch{return[];}}
function summarize(state,perfs,frames){const top=perfs.find(x=>x.frameId===0)||perfs[0]||{},nav=[...(state.navUrls||[])],discovered=[];for(const f of frames){pushUnique(nav,f.url);pushUnique(discovered,f.url,300);}for(const p of perfs){for(const u of[p.navigationUrl,p.href]){pushUnique(nav,cleanUrl(u));pushUnique(discovered,cleanUrl(u),300);}for(const u of(p.domUrls||[]))pushUnique(discovered,cleanUrl(u),300);}const map=new Map();for(const r of(state.pacsRequests||[]))map.set(`${r.type}|${r.url}`,r);for(const p of perfs)for(const raw of[...(p.resources||[]),...(p.domUrls||[])]){const h=classifyPacsUrl(raw);if(!h)continue;const key=`${h.type}|${h.url}`;
if(!map.has(key))map.set(key,{...h,source:`page:${p.frameId}`,time:Date.now()});}const requests=[...map.values()].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,MAX_REQUESTS),candidates=[...new Set([...nav,...discovered])],ranked=candidates.map(url=>({url,score:viewerUrlScore(url)})).sort((a,b)=>b.score-a.score),currentUrl=cleanUrl(top.href)||state.currentUrl||'',bestViewerUrl=ranked[0]?.url||currentUrl,shell=candidates.map(classifyViewerShell).filter(Boolean).sort((a,b)=>(b.score||0)-(a.score||0))[0]||null;let detector='UNKNOWN';if(requests.some(x=>x.type.startsWith('VIETMY_')))detector='VIETMY';else if(requests.some(x=>['QIDO_SERIES','QIDO_INSTANCES','DICOM_METADATA','DICOM_INSTANCE','DICOM_FRAME','WADO'].includes(x.type)))detector='DICOMWEB';else if(requests.some(x=>x.type.startsWith('VRPACS_')))detector='VRPACS';else if(requests.some(x=>x.type.startsWith('VRAD_')||x.type==='DICOM_IMAGE_API'))detector='VRAD';else if(requests.some(x=>x.type==='RENDERED_JPEG'))detector='RENDERED_ONLY';else if(shell)detector='VIEWER_SHELL';let confidence=Math.max(Number(state.confidence)||0,Number(shell?.score)||0,...requests.map(r=>Number(r.score)||0),Number(ranked[0]?.score)||0,Number(state.pageHintScore)||0);confidence=Math.max(0,Math.min(100,Math.round(confidence)));return{tabId:state.tabId,title:top.title||'',currentUrl,bestViewerUrl,navUrls:nav,frameUrls:frames.map(f=>f.url),requests,detector,viewerShell:shell?.type||'',origins:[...new Set([...candidates,...requests.map(r=>r.url)].map(originPattern).filter(Boolean))],studyHint:state.studyHint||viewerStudyHint(bestViewerUrl)||'',confidence,tracking:state.tracking||'idle',performanceError:'',vietmyStudyId:perfs.map(p=>p.vietmyStudyId).find(Boolean)||''};}
async function scanTab(tabId){const state=await getTabState(tabId),[perf,frames]=await Promise.all([scanPerformance(tabId),scanFrameUrls(tabId)]);state.frameUrls=frames.map(f=>f.url);let summary=summarize(state,perf,frames);summary.missingOrigins=await missingPatterns([summary.currentUrl,...summary.frameUrls,...summary.requests.map(r=>r.url)]);summary.siteAccess=summary.missingOrigins.length===0&&Boolean(summary.currentUrl);if(summary.confidence>=AUTO_SCORE&&state.tracking==='idle'){state.tracking='candidate';state.confidence=Math.max(state.confidence,summary.confidence);await saveTabState(tabId,state);}summary.tracking=state.tracking;
if(state.zfpViewer){const info=await zfpInfo(tabId);if(info){summary.zfpInfo=info;summary.zfpGroups=info.groups;summary.detector='ZFP';summary.confidence=Math.max(summary.confidence,92);}}
return summary;}

function headersForUrl(state,url){try{const h={...(state.headersByOrigin?.[new URL(url).origin]||{})};for(const k of Object.keys(h)){const l=k.toLowerCase();if(['content-type','cookie','origin','referer','host','content-length'].includes(l))delete h[k];}return h;}catch{return{};}}
function restoreBody(stored){if(!stored)return undefined;if(stored.kind==='form'){const p=new URLSearchParams();for(const[k,vals]of Object.entries(stored.data||{}))for(const v of(Array.isArray(vals)?vals:[vals]))p.append(k,v);return p;}if(stored.kind==='raw'){const bins=(stored.chunks||[]).map(atob),len=bins.reduce((n,b)=>n+b.length,0),out=new Uint8Array(len);let off=0;for(const b of bins){for(let i=0;i<b.length;i++)out[off+i]=b.charCodeAt(i);off+=b.length;}return out;}return undefined;}
async function fetchJsonFor(state,url,accept='application/json, application/dicom+json',requestMeta=null){const method=String(requestMeta?.method||'GET').toUpperCase(),body=['GET','HEAD'].includes(method)?undefined:restoreBody(requestMeta?.requestBody),headers={...headersForUrl(state,url),Accept:accept};if(!['GET','HEAD'].includes(method)){const ct=replayContentType(state,url,requestMeta,body);if(ct)headers['Content-Type']=ct;}const r=await fetch(url,{method,body,credentials:'include',cache:'no-store',redirect:'follow',headers});if(!r.ok)throw new Error(`HTTP ${r.status}: ${new URL(url).pathname}`);const text=await r.text(),head=text.trim().slice(0,1);
if(head!=='{'&&head!=='['){const kind=/^\s*</.test(text)?'HTML page':'non-JSON data';throw new Error(`Server returned ${kind} instead of manifest JSON (${new URL(url).pathname}). The link may have expired, or reopen the viewer after enabling "Track tab" to record the request.`);}
try{return JSON.parse(text);}catch(e){throw new Error(`Corrupted manifest, failed to parse JSON (${new URL(url).pathname}).`);}}
function inheritQuery(target,source){const t=new URL(target),s=new URL(source);for(const[k,v]of s.searchParams)if(!t.searchParams.has(k))t.searchParams.append(k,v);return t.href;}
function normalizeStudy(inv){const p=inv.patient||{};return{adapter:inv.adapter||'',studyUid:String(inv.studyUid||''),patient:{name:String(p.name||''),id:String(p.id||''),birthDate:String(p.birthDate||''),studyDate:String(p.studyDate||''),description:String(p.description||''),accession:String(p.accession||'')},series:Array.isArray(inv.series)?inv.series:[],context:inv.context||{}};}
function adapterContext(summary,state){return{summary,state,fetchJson:(url,accept,req)=>fetchJsonFor(state,url,accept,req),headersForUrl:url=>headersForUrl(state,url),inheritQuery,normalizeStudy,zfpInfo:()=>zfpInfo(state.tabId)};}
async function analyzeTab(tabId){
  const summary=await scanTab(tabId),state=await getTabState(tabId);
  let inv=null,lastError=null;
  const inventories={};
  const allMatching=matchingAdapters(summary,state);
  const currentUrl=summary.currentUrl||state.currentUrl||'';
  const recipe=recipeForUrl(currentUrl);
  // Tie-breaker maintains registry order — JS sort is stable.
  const ranked=[...allMatching].sort((a,b)=>adapterScore(recipe.adapters?.[b.id])-adapterScore(recipe.adapters?.[a.id]));
  for(const adapter of ranked){
    try{
      const candidate=await adapter.analyze(adapterContext(summary,state));
      if(candidate)inventories[adapter.id]={...candidate,adapter:adapter.id,tabId,createdAt:Date.now()};
    }catch(e){lastError=e;}
  }
  const primaryId=ranked.map(a=>a.id).find(id=>inventories[id]);
  if(primaryId){
    inv={...inventories[primaryId]};
    inv.adapterCandidates=compatibleAdapterIds(inv,inventories,ranked.map(a=>a.id));
    inv.adapterInventories=Object.fromEntries(inv.adapterCandidates.map(id=>[id,inventories[id]]));
  }
  if(!inv){
    if(summary.detector==='RENDERED_ONLY')throw new Error('Viewer currently serves rendered images only, no DICOM data.');
    throw lastError||new Error(summary.tracking==='stopped'?'Tracking stopped.':'No DICOM/manifest captured yet.');
  }
  inv.tabId=tabId;inv.summary=summary;inv.createdAt=Date.now();
  const prev=await findHistory(inv);
  if(prev)inv.previousDownload=prev;
  await setSession(invKey(tabId),inv);
  await upsertHistory(inv,{status:prev?.status==='done'?'done':'viewed',analyzedAt:Date.now()});
  await setBadge(tabId);
  return inv;
}
function scheduleAnalyze(tabId,delay=500){clearTimeout(analyzeTimers.get(tabId));analyzeTimers.set(tabId,setTimeout(async()=>{analyzeTimers.delete(tabId);try{const inv=await analyzeTab(tabId);chrome.runtime.sendMessage({type:'INVENTORY_UPDATED',tabId,inventory:inv}).catch(()=>{});}catch{}},delay));}

async function ensureOffscreen(){const url=chrome.runtime.getURL('offscreen.html');const c=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});if(c.length)return;await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'Download and write DICOM directly to user selected directory.'});}
function safeFolderName(inv){const p=inv.patient||{},name=sanitizeSegment(String(p.name||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim(),'Unknown'),id=sanitizeSegment(p.id||'NoID','NoID');let d=String(p.studyDate||'').replace(/[^0-9]/g,'');const date=d.length>=8?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:sanitizeSegment(p.studyDate||'NoDate','NoDate');return`${name} - ${id} - ${date}`;}
async function buildTasksForAdapter(inv,selected,adapterId){const id=adapterId||inv.adapter,state=await getTabState(inv.tabId),adapter=adapterById(id);if(!adapter)throw new Error(`Adapter ${id} not found.`);const sourceInv=id===inv.adapter?inv:inv.adapterInventories?.[id];if(!sourceInv)throw new Error(`Adapter ${id} has not successfully analyzed this study.`);const mappedSelected=id===inv.adapter?selected:mapSeriesSelection(inv,sourceInv,selected);if(!mappedSelected.length)throw new Error(`Unable to map selected series to adapter ${id}.`);const ctx=adapterContext(sourceInv.summary||inv.summary||await scanTab(inv.tabId),state);const tasks=dedupeTasksBySop(await adapter.enumerate(sourceInv,mappedSelected,ctx));if(!tasksBelongToStudy(tasks,inv.studyUid))throw new Error(`Adapter ${id} returned tasks with mismatched StudyInstanceUID.`);const learnedRoutes=RecipeStoreV2.getPreferredRoutes(recipeForUrl(inv.summary?.currentUrl||inv.context?.url||'').adapters?.[id]);return tasks.map(t=>learnedRoutes.length?{...t,tabId:inv.tabId,preferredRoutes:learnedRoutes}:{...t,tabId:inv.tabId});}
async function buildTasks(inv,selected){return buildTasksForAdapter(inv,selected,inv.adapter);}

function scheduleJobFlush(tabId,force=false){if(force){clearTimeout(jobFlushTimers.get(tabId));jobFlushTimers.delete(tabId);const j=jobMemory.get(tabId);if(j)setSession(jobKey(tabId),j).catch(()=>{});return;}if(jobFlushTimers.has(tabId))return;jobFlushTimers.set(tabId,setTimeout(()=>{jobFlushTimers.delete(tabId);const j=jobMemory.get(tabId);if(j)setSession(jobKey(tabId),j).catch(()=>{});},600));}
async function getJob(tabId){return jobMemory.get(tabId)||await getSession(jobKey(tabId));}
async function finalizeJob(tabId,engineResult){let job=jobMemory.get(tabId)||await getSession(jobKey(tabId),{tabId});let inv=await getSession(invKey(tabId));job={...job,...engineResult,updatedAt:Date.now()};if(inv&&engineResult?.resolvedMeta){const m=engineResult.resolvedMeta||{},p={...(inv.patient||{})};if(!p.name&&m.patientName)p.name=m.patientName;if(!p.id&&m.patientId)p.id=m.patientId;if(!p.studyDate&&m.studyDate)p.studyDate=m.studyDate;if(!inv.studyUid&&m.studyUid)inv.studyUid=m.studyUid;inv={...inv,patient:p};await setSession(invKey(tabId),inv);}const known=Boolean(inv?.context?.completeKnown),fullSelection=Boolean(job.allSeriesSelected);if(job.status==='done'&&(!known||!fullSelection))job.status='partial';if(job.status==='done_with_errors'&&(!known||!fullSelection)&&job.completed)job.status='partial';jobMemory.set(tabId,job);scheduleJobFlush(tabId,true);
if(inv){
  const completedSopUids = Array.isArray(job.completedSopUids) ? job.completedSopUids : [];
  const row=await upsertHistory(inv,{status:job.status,lastDownloadAt:Date.now(),completed:job.completed||0,total:job.total||0,failed:job.failed||0,completedSopUids});
  if(row){inv={...inv,previousDownload:row};await setSession(invKey(tabId),inv);}
  try{
    const studyUrl=inv.summary?.currentUrl||inv.context?.url||'';
    if(studyUrl&&job.adapter){
      let errorClass='other';
      if(job.errors?.length){
        const errText=job.errors.join(' ').toLowerCase();
        if(errText.includes('timeout')||errText.includes('stall')||errText.includes('deadline')){
          errorClass='timeout';
        }else if(errText.includes('401')||errText.includes('403')||errText.includes('auth')||errText.includes('token')||errText.includes('login')||errText.includes('expired')||errText.includes('hết hạn')){
          errorClass='auth';
        }else if(errText.includes('500')||errText.includes('502')||errText.includes('503')||errText.includes('504')||errText.includes('server')){
          errorClass='server';
        }else if(errText.includes('dicom')||errText.includes('dataset')||errText.includes('sop')||errText.includes('studyinstanceuid')){
          errorClass='invalidDicom';
        }
      }
      const preferredRoutes=Array.isArray(engineResult?.preferredRoutes)&&engineResult.preferredRoutes.length
        ? engineResult.preferredRoutes
        : (Array.isArray(job.preferredRoutes)?job.preferredRoutes:[]);
      await recordAdapterOutcome(studyUrl,job.adapter,{
        status:job.status,
        latencyMs:Date.now()-(job.startedAt||Date.now()),
        preferredRoutes,
        errorClass
      });
    }
  }catch{}
}chrome.runtime.sendMessage({type:'JOB_UPDATED',tabId,job}).catch(()=>{});if(inv)chrome.runtime.sendMessage({type:'INVENTORY_UPDATED',tabId,inventory:inv}).catch(()=>{});await setDownloadUi(true);await setBadge(tabId);}
async function startJob(tabId,selected,options={}){
  const existing=await getJob(tabId);
  if(existing&&['preparing','downloading','cancelling'].includes(existing.status))throw new Error('This tab is currently downloading DICOM.');
  const inv=await getSession(invKey(tabId));
  if(!inv)throw new Error('Study not yet recognized.');
  const tasks=await buildTasks(inv,selected);
  if(!tasks.length)throw new Error('No DICOM images in selected series.');
  await ensureOffscreen();
  const attemptId=crypto.randomUUID();
  const expectedSopUids=[...new Set(tasks.map(t=>String(t.sopInstanceUid||'').trim()).filter(Boolean))];
  const prevCompletedSopUids = (inv.previousDownload && Array.isArray(inv.previousDownload.completedSopUids))
    ? inv.previousDownload.completedSopUids
    : (Array.isArray(existing?.completedSopUids) ? existing.completedSopUids : []);
  const baselineCompleted = tasks.filter(t => t.sopInstanceUid && prevCompletedSopUids.includes(String(t.sopInstanceUid).trim())).length;
  const job={
    id:crypto.randomUUID(),
    attemptId,
    tabId,
    status:'preparing',
    adapter:inv.adapter,
    adapterCandidates:inv.adapterCandidates||[inv.adapter],
    attemptIndex:0,
    options,
    studyUid:inv.studyUid||'',
    selectedSeries:selected,
    allSeriesSelected:selected.length===Number(inv.series?.length||0),
    total:tasks.length,
    completed:baselineCompleted,
    failed:0,
    skipped:0,
    bytesWritten:0,
    currentFile:'',
    errors:[],
    completedSopUids:prevCompletedSopUids,
    expectedSopUids,
    logicalTotal:tasks.length,
    attemptBaseOriginal:0,
    attemptBaseReconstructed:0,
    attemptBaseBytes:0,
    startedAt:Date.now(),
    updatedAt:Date.now()
  };
  jobMemory.set(tabId,job);
  scheduleJobFlush(tabId,true);
  await setBadge(tabId);
  chrome.runtime.sendMessage({type:'JOB_UPDATED',tabId,job}).catch(()=>{});
  job.status='downloading';
  const spec={
    jobId:job.id,
    attemptId,
    tabId,
    tasks,
    studyFolder:safeFolderName(inv),
    folderInfo:{patientName:inv.patient?.name||'',patientId:inv.patient?.id||'',studyDate:inv.patient?.studyDate||''},
    saveMode:options.saveMode==='downloads'?'downloads':'filesystem',
    concurrency:options.concurrency||6,
    frameConcurrency:options.frameConcurrency||6,
    alreadyCompletedSopUids:prevCompletedSopUids,
    baselineCompleted,
    logicalTotal:tasks.length
  };
  job.saveMode=spec.saveMode;
  if(spec.saveMode==='downloads')await setDownloadUi(false);
  const r=await chrome.runtime.sendMessage({target:'offscreen',type:'START_ENGINE',spec}).catch(e=>({ok:false,error:String(e?.message||e)}));
  if(!r?.ok){
    await finalizeJob(tabId,{status:'error',failed:tasks.length,completed:0,errors:[r?.error||'Engine error']});
    throw new Error(r?.error||'Failed to start download engine.');
  }
  return job;
}

async function cancelJob(tabId){const j=await getJob(tabId);if(!j)return;jobMemory.set(tabId,{...j,status:'cancelling',updatedAt:Date.now()});scheduleJobFlush(tabId,true);await ensureOffscreen();await chrome.runtime.sendMessage({target:'offscreen',type:'CANCEL_ENGINE',tabId}).catch(()=>{});}

async function siteAccessChanged(tabId){await injectContent(tabId);await startTracking(tabId,true);return scanTab(tabId);}
async function currentOverview(tabId){const [summary,state,inventory,job]=await Promise.all([scanTab(tabId),getTabState(tabId),getSession(invKey(tabId)),getJob(tabId)]);return{summary,state,inventory,job};}

async function handleEngineProgress(m){
  const tabId=Number(m.tabId),stored=jobMemory.get(tabId)||await getSession(jobKey(tabId),{tabId,id:m.jobId});
  if(stored.id&&m.jobId&&stored.id!==m.jobId)return;
  if(stored.attemptId&&m.attemptId&&stored.attemptId!==m.attemptId)return;
  const cumulative=cumulativeAttemptCounters(stored,m);
  const job={
    ...stored,
    status:m.status||stored.status,
    total:m.total??stored.total,
    completed:m.completed??stored.completed,
    failed:m.failed??stored.failed,
    skipped:m.skipped??stored.skipped,
    ...cumulative,
    currentFile:m.currentFile??stored.currentFile,
    errors:m.errors||stored.errors||[],
    updatedAt:m.updatedAt||Date.now()
  };
  jobMemory.set(tabId,job);scheduleJobFlush(tabId);chrome.runtime.sendMessage({type:'JOB_UPDATED',tabId,job}).catch(()=>{});setBadge(tabId).catch(()=>{});
}

// chrome.downloads only runs in service workers: offscreen documents only have chrome.runtime.
// Offscreen builds the blob and delegates download handling to this worker.
// --- GE Centricity Universal Viewer (ZFP) ---------------------------------
// Pixel data travels via WebSocket over GE proprietary protocol.
// `zfp-hook.js` is injected into MAIN world at document_start to extract image data via content script.
const ZFP_SCRIPT_ID='zfp-hook';
async function ensureZfpHook(url){
  const pattern=originPattern(url);
  if(!pattern||!(await chrome.permissions.contains({origins:[pattern]}).catch(()=>false)))return false;
  const existing=(await chrome.scripting.getRegisteredContentScripts({ids:[ZFP_SCRIPT_ID]}).catch(()=>[]))||[];
  const matches=new Set(existing[0]?.matches||[]);
  if(matches.has(pattern))return true;
  matches.add(pattern);
  const spec={id:ZFP_SCRIPT_ID,js:['zfp-hook.js'],matches:[...matches],runAt:'document_start',
              world:'MAIN',allFrames:true,persistAcrossSessions:true};
  try{
    if(existing.length)await chrome.scripting.updateContentScripts([spec]);
    else await chrome.scripting.registerContentScripts([spec]);
    return true;
  }catch{return false;}
}
async function zfpAsk(tabId,type,args,timeoutMs){
  // Send specifically to top frame (frameId: 0) to avoid unhooked subframes replying first.
  try{const r=await chrome.tabs.sendMessage(tabId,{type,args,timeoutMs},{frameId:0});return r||{error:'No response.'};}
  catch(e){return{error:String(e?.message||e)};}
}
async function zfpInfo(tabId){const r=await zfpAsk(tabId,'ZFP_INFO',{},8000);return r?.groups?.length?r:null;}
// GE ZFP viewer reloads study to stream un-cached image frames.
async function zfpReloadViewer(tabId){
  try{await chrome.tabs.reload(tabId);}catch(e){return{ok:false,error:String(e?.message||e)};}
  for(let i=0;i<45;i++){
    await new Promise(r=>setTimeout(r,1000));
    const info=await zfpInfo(tabId);
    if(info?.groups?.length)return{ok:true,groups:info.groups.length};
  }
  return{ok:false,error:'Viewer reloaded but study structure could not be read.'};
}
// Registered hook takes effect on next page load, so reload tab once if needed.
async function maybeReloadForZfp(tabId,state){
  if(state.zfpReloadDone)return;
  const tab=await chrome.tabs.get(tabId).catch(()=>null);
  if(!tab?.url||!(await ensureZfpHook(tab.url)))return;
  if(await zfpInfo(tabId))return;                 // hook already running
  state.zfpReloadDone=true;await saveTabState(tabId,state);
  await chrome.tabs.reload(tabId).catch(()=>{});
}

const activeDownloads=new Map();
// Disable download shelf/bubbles while running to perform silent background downloads.
async function setDownloadUi(enabled){try{await chrome.downloads.setUiOptions({enabled});}catch{}}
function waitDownload(downloadId,timeoutMs=120000){return new Promise((resolve,reject)=>{let done=false;const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);chrome.downloads.onChanged.removeListener(listener);err?reject(err):resolve();};const listener=delta=>{if(delta.id!==downloadId)return;if(delta.error?.current)finish(new Error(delta.error.current));else if(delta.state?.current==='complete')finish();};chrome.downloads.onChanged.addListener(listener);const timer=setTimeout(()=>finish(new Error('Download timeout')),timeoutMs);chrome.downloads.search({id:downloadId}).then(rows=>{const item=rows?.[0];if(item?.state==='complete')finish();else if(item?.state==='interrupted')finish(new Error(item.error||'Download interrupted'));}).catch(()=>{});});}
async function downloadBlobUrl(jobId,url,filename){
  // Accept only blob: URLs with validated bytes.
  if(!String(url||'').startsWith('blob:'))throw new Error('Can only save pre-downloaded data (blob:).');
  const id=await chrome.downloads.download({url,filename,conflictAction:'overwrite',saveAs:false});
  let set=activeDownloads.get(jobId);if(!set){set=new Set();activeDownloads.set(jobId,set);}
  set.add(id);
  try{await waitDownload(id);}finally{set.delete(id);if(!set.size)activeDownloads.delete(jobId);}
}
function cancelDownloads(jobId){const set=activeDownloads.get(jobId);if(!set)return;for(const id of set)chrome.downloads.cancel(id).catch(()=>{});activeDownloads.delete(jobId);}

chrome.runtime.onMessage.addListener((m,sender,sendResponse)=>{
  if(m?.target==='offscreen')return false;
  if(m?.type==='ENGINE_PROGRESS'){handleEngineProgress(m).catch(()=>{});return false;}
  if(m?.type==='ENGINE_LEARNED_URL'){learnUrl(m.url).catch(()=>{});return false;}
  if(m?.type==='ENGINE_FINISHED'){
    (async()=>{
      const tabId=Number(m.tabId),old=jobMemory.get(tabId)||await getSession(jobKey(tabId));
      if(old?.id&&m.jobId&&old.id!==m.jobId)return;
      if(old?.attemptId&&m.attemptId&&old.attemptId!==m.attemptId)return;
      const res=m.result||{status:'error',errors:['Engine finished with no result.']};
      const completedSopList=[...new Set([...(old?.completedSopUids||[]),...(res.completedSopUids||[])])];
      if(old)old.completedSopUids=completedSopList;
      if(old)res.completed=Math.max(Number(res.completed)||0,completedSopList.length);
      if(old){res.original=(Number(old.attemptBaseOriginal)||0)+(Number(res.original)||0);res.reconstructed=(Number(old.attemptBaseReconstructed)||0)+(Number(res.reconstructed)||0);res.bytesWritten=(Number(old.attemptBaseBytes)||0)+(Number(res.bytesWritten)||0);}
      const isPartialOrError=['partial','done_with_errors','error'].includes(res.status);
      const candidates=old?.adapterCandidates||[];
      const nextIdx=(old?.attemptIndex||0)+1;

      if(isPartialOrError&&nextIdx<candidates.length&&old?.status!=='cancelling'){
        const inv=await getSession(invKey(tabId));
        if(inv){
          for(let candidateIndex=nextIdx;candidateIndex<candidates.length;candidateIndex++){
            const nextAdapterId=candidates[candidateIndex];
            try{
              const priorState={...old,expectedSopUids:[...(old.expectedSopUids||[])],attemptHistory:[...(old.attemptHistory||[])]};
              const allNewTasks=await buildTasksForAdapter(inv,old.selectedSeries||[],nextAdapterId);
              if(!allNewTasks.length)continue;
              const newExpectedSops=allNewTasks.map(t=>String(t.sopInstanceUid||'').trim()).filter(Boolean);
              old.expectedSopUids=[...new Set([...(old.expectedSopUids||[]),...newExpectedSops])];
              old.logicalTotal=Math.max(Number(old.logicalTotal)||0,Number(old.total)||0,allNewTasks.length,old.expectedSopUids.length);
              const newTasks=allNewTasks.filter(t=>{
                const sop=String(t.sopInstanceUid||'').trim();
                return !sop||!completedSopList.includes(sop);
              });
              if(!newTasks.length){
                if(inventoryIsCovered(old,completedSopList)){res.status='done';res.completed=completedSopList.length;res.failed=0;break;}
                continue;
              }
              let origin='';try{origin=new URL(inv.summary?.currentUrl||inv.context?.url||'').origin;}catch{}
              if(origin&&old.adapter){
                await recordAdapterOutcome(origin,old.adapter,{status:res.status,errorClass:'fallback'});
              }
              old.attemptHistory=[...(old.attemptHistory||[]),{
                adapter:old.adapter,attemptId:old.attemptId||'',status:res.status,total:res.total??old.total,
                completed:res.completed??old.completed,failed:res.failed??old.failed,
                finishedAt:Date.now()
              }];
              const nextAttemptId=crypto.randomUUID();
              old.attemptId=nextAttemptId;
              old.attemptIndex=candidateIndex;
              old.adapter=nextAdapterId;
              old.status='downloading';
              old.total=old.logicalTotal;
              old.completed=completedSopList.length;
              old.failed=0;
              old.skipped=0;
              old.attemptBaseOriginal=Number(res.original)||0;
              old.attemptBaseReconstructed=Number(res.reconstructed)||0;
              old.attemptBaseBytes=Number(res.bytesWritten)||0;
              old.original=old.attemptBaseOriginal;
              old.reconstructed=old.attemptBaseReconstructed;
              old.bytesWritten=old.attemptBaseBytes;
              old.errors=[];
              jobMemory.set(tabId,old);
              scheduleJobFlush(tabId,true);
              chrome.runtime.sendMessage({type:'JOB_UPDATED',tabId,job:old}).catch(()=>{});
              const spec={
                jobId:old.id,
                attemptId:nextAttemptId,
                tabId,
                tasks:newTasks,
                studyFolder:safeFolderName(inv),
                folderInfo:{patientName:inv.patient?.name||'',patientId:inv.patient?.id||'',studyDate:inv.patient?.studyDate||''},
                saveMode:old.saveMode||'filesystem',
                concurrency:old.options?.concurrency||6,
                frameConcurrency:old.options?.frameConcurrency||6,
                alreadyCompletedSopUids:completedSopList,
                baselineCompleted:completedSopList.length,
                logicalTotal:old.logicalTotal
              };
              const nextResp=await chrome.runtime.sendMessage({target:'offscreen',type:'START_ENGINE',spec}).catch(()=>null);
              if(nextResp?.ok)return;
              Object.assign(old,priorState);
              jobMemory.set(tabId,old);
              scheduleJobFlush(tabId,true);
              chrome.runtime.sendMessage({type:'JOB_UPDATED',tabId,job:old}).catch(()=>{});
            }catch{}
          }
        }
      }
      if(old&&res.status==='done'&&(Number(res.completed)||0)<(Number(old.logicalTotal)||Number(old.total)||0))res.status='partial';
      await finalizeJob(tabId,res);
      const exists=await chrome.tabs.get(tabId).then(()=>true).catch(()=>false);
      if(!exists){
        jobMemory.delete(tabId);
        chrome.storage.session.remove([tabKey(tabId),invKey(tabId),jobKey(tabId)]).catch(()=>{});
      }
    })().catch(()=>{});
    return false;
  }
  (async()=>{
    if(m?.type==='ZFP_TAKE_REQUEST'){const r=await zfpAsk(Number(m.tabId),'ZFP_TAKE',m.args,m.timeoutMs||50000);return{ok:!r?.error,...r};}
    if(m?.type==='ZFP_RELOAD_REQUEST')return await zfpReloadViewer(Number(m.tabId));
    if(m?.type==='DOWNLOAD_BLOB'){await downloadBlobUrl(m.jobId,m.url,m.filename);return{ok:true};}
    if(m?.type==='DOWNLOAD_CANCEL'){cancelDownloads(m.jobId);return{ok:true};}
    if(m?.type==='GENERIC_JSON_CAPTURE'){const id=Number(sender?.tab?.id??m.tabId);await handleGenericJsonCapture(id,m.row||{});return{ok:true};}
    if(m?.type==='PAGE_HINTS'){const id=Number(sender?.tab?.id??m.tabId);await applyPageHints(id,m.hint||{});return{ok:true};}
    if(m?.type==='SCAN_TAB')return{ok:true,summary:await scanTab(Number(m.tabId))};
    if(m?.type==='GET_OVERVIEW')return{ok:true,...await currentOverview(Number(m.tabId))};
    if(m?.type==='GET_INVENTORY')return{ok:true,inventory:await getSession(invKey(Number(m.tabId)))};
    if(m?.type==='ANALYZE_TAB')return{ok:true,inventory:await analyzeTab(Number(m.tabId))};
    if(m?.type==='DEEP_SCAN'){const valid=await deepProbeTab(Number(m.tabId));return{ok:true,valid};}
    if(m?.type==='START_LEARNING')return{ok:true,state:await startLearning(Number(m.tabId))};
    if(m?.type==='STOP_LEARNING')return{ok:true,state:await stopLearning(Number(m.tabId))};
    if(m?.type==='LEARN_CANDIDATE')return{ok:true,result:await markLearnCandidate(Number(m.tabId),m.url,m.role)};
    if(m?.type==='START_TRACKING')return{ok:true,state:await startTracking(Number(m.tabId),true)};
    if(m?.type==='STOP_TRACKING')return{ok:true,state:await stopTracking(Number(m.tabId))};
    if(m?.type==='SITE_ACCESS_CHANGED')return{ok:true,summary:await siteAccessChanged(Number(m.tabId))};
    if(m?.type==='START_DOWNLOAD')return{ok:true,job:await startJob(Number(m.tabId),m.selectedSeries||[],m.options||{})};
    if(m?.type==='GET_JOB')return{ok:true,job:await getJob(Number(m.tabId))};
    if(m?.type==='CANCEL_JOB'){await cancelJob(Number(m.tabId));return{ok:true};}
    if(m?.type==='GET_HISTORY')return{ok:true,history:await getHistory()};
    if(m?.type==='CLEAR_HISTORY'){await chrome.storage.local.set({[HISTORY_KEY]:[]});chrome.runtime.sendMessage({type:'HISTORY_UPDATED',history:[]}).catch(()=>{});return{ok:true};}
    return{ok:false,error:'Unknown message'};
  })().then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;
});

chrome.tabs.onCreated.addListener(tab=>{if(tab.id)ensurePanel(tab.id).catch(()=>{});});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{ensurePanel(tabId).catch(()=>{});const u=change.url||tab.url||'';if(u)markCandidate(tabId,u).catch(()=>{});if(change.status==='complete'&&u)hasOrigin(u).then(ok=>{if(ok)setTimeout(()=>{injectContent(tabId);getTabState(tabId).then(x=>{if(x.tracking==='watching')injectGenericHook(tabId);});},150);}).catch(()=>{});});
chrome.tabs.onRemoved.addListener(tabId=>{(async()=>{const j=jobMemory.get(tabId)||await getSession(jobKey(tabId));if(j&&['preparing','downloading','cancelling'].includes(j.status)){chrome.storage.session.remove(tabKey(tabId)).catch(()=>{});return;}jobMemory.delete(tabId);chrome.storage.session.remove([tabKey(tabId),invKey(tabId),jobKey(tabId)]).catch(()=>{});})().catch(()=>{});});
async function boot(){await setDownloadUi(true);await loadRecipes();await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});await chrome.sidePanel.setOptions({path:'sidepanel.html',enabled:true}).catch(()=>{});for(const tab of await chrome.tabs.query({})){if(!tab.id)continue;await ensurePanel(tab.id);if(tab.url){await markCandidate(tab.id,tab.url);if(await hasOrigin(tab.url))await injectContent(tab.id);}}}
chrome.runtime.onInstalled.addListener(details=>{boot().catch(()=>{});if(details?.reason==='install')chrome.tabs.create({url:chrome.runtime.getURL('onboarding.html')}).catch(()=>{});});chrome.runtime.onStartup.addListener(()=>boot().catch(()=>{}));chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});chrome.sidePanel.setOptions({path:'sidepanel.html',enabled:true}).catch(()=>{});
