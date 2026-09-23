'use strict';
import { decodeQrFromBlob, decodeQrFromDataUrl, parseQrResult, isLikelyPacsViewerUrl } from './lib/qr_decoder.js';
import { resolveBulkDicomSaveMode } from './lib/save_policy.js';
import { formatLogsAsText } from './lib/logger.js';
import { FINISHING_STATUS, isActiveDownload, isTerminalDownload, panelPhase, reconcileInventory, shouldShowInventoryEditor } from './lib/download_ui_state.js';
const $=id=>document.getElementById(id),show=(id,on)=>$(id).classList.toggle('hidden',!on);
let tabId=null,summary=null,state=null,inventory=null,job=null,history=[],revealDownloaded=false,refreshTimer=null,activeTabUrl='',isStartingDownload=false,currentQrUrl='',refreshRevision=0,lastTerminalRefreshKey='';
let jobRevision=0,inventoryRevision=0,bindRevision=0,contextRevision=0,terminalRefreshTimer=null;
function setTopLoader(on){const e=$('topLoader');if(e)e.classList.toggle('active',Boolean(on));}
function panelJob(){return isStartingDownload&&!isActiveDownload(job)?{...(job||{}),status:'preparing'}:job;}
const FS_DB='pacs_dicom_fs_v1',FS_STORE='handles',FS_KEY='download-root',SAVE_MODE_KEY='pacs6_save_mode',FOLDER_NAME_KEY='pacs6_folder_name',SUBFOLDER_KEY='pacs6_subfolder_name',DEFAULT_SUBFOLDER='DCom to JPG';

async function send(type,payload={}){const r=await chrome.runtime.sendMessage({type,...payload});if(!r?.ok)throw new Error(r?.error||'Extension error');return r;}
function toast(text,bad=false){const e=$('toast');e.textContent=text;e.classList.toggle('error',bad);e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2600);}
function fmtName(x){return String(x||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim();}
function fmtDate(x){const d=String(x||'').replace(/[^0-9]/g,'');return d.length>=8?`${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`:(x||'—');}
function fmtWhen(x){if(!x)return'';return new Date(x).toLocaleString('en-US',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function chip(el,text,kind='neutral'){el.textContent=text;el.className=`chip ${kind}`;}
function patternsFor(url){try{const u=new URL(url);const list=[`${u.protocol}//${u.host}/*`];if(u.port==='7198')list.push(`${u.protocol}//${u.hostname}:7194/*`);else if(u.port==='7194')list.push(`${u.protocol}//${u.hostname}:7198/*`);else if(u.port==='8083')list.push(`${u.protocol}//${u.hostname}:8085/*`);else if(u.port==='8085')list.push(`${u.protocol}//${u.hostname}:8083/*`);return list;}catch{return[];}}
function patternFor(url){return patternsFor(url)[0]||'';}

function openFsDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(FS_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(FS_STORE))r.result.createObjectStore(FS_STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function fsGet(){const db=await openFsDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readonly'),r=tx.objectStore(FS_STORE).get(FS_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function fsSet(h){const db=await openFsDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readwrite');tx.objectStore(FS_STORE).put(h,FS_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function fsDelete(){const db=await openFsDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readwrite');tx.objectStore(FS_STORE).delete(FS_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function ensureFolder(interactive=false){let h=await fsGet();if(!h&&interactive){try{h=await window.showDirectoryPicker({id:'pacs-dicom',startIn:'downloads',mode:'readwrite'});if(h){await fsSet(h);await chrome.storage.local.set({[SAVE_MODE_KEY]:'filesystem',[FOLDER_NAME_KEY]:h.name||'Selected Folder'});}}catch(e){if(e?.name!=='AbortError')console.warn(e);return null;}}if(!h)return null;let p='prompt';try{p=typeof h.queryPermission==='function'?await h.queryPermission({mode:'readwrite'}):'granted';if(p!=='granted'&&interactive&&typeof h.requestPermission==='function'){p=await h.requestPermission({mode:'readwrite'});}}catch{}if(interactive&&p!=='granted')return null;return h;}
// Accurately show where files will be saved without dropping persisted handle.
async function renderFolder(){
  try{
    const st=await chrome.storage.local.get([FOLDER_NAME_KEY,SUBFOLDER_KEY]);
    const savedName=st[FOLDER_NAME_KEY]||'';
    const sub=String(st[SUBFOLDER_KEY]||'').trim()||DEFAULT_SUBFOLDER;
    if($('subfolderInput')&&document.activeElement!==$('subfolderInput'))$('subfolderInput').value=sub;
    const h=await fsGet();
    const useFs=Boolean(h);
    const displayName=h?.name||savedName||'Custom Folder';
    if(useFs){
      $('folderText').textContent=`📁 ${displayName} / ${sub}`;
      $('folderText').title=`${displayName} / ${sub}`;
      show('folderResetBtn',true);
    }else{
      $('folderText').textContent='Choose a writable folder before downloading';
      $('folderText').title='Bulk DICOM download requires a writable folder';
      show('folderResetBtn',false);
    }
  }catch{
    $('folderText').textContent='Choose a writable folder before downloading';
    show('folderResetBtn',false);
  }
}

async function grantAccess(){
  let pats=[...(summary?.missingOrigins||[])];
  if(!pats.length){
    pats=patternsFor(activeTabUrl);
  }else{
    const extra=[];
    for(const p of pats){
      try{
        const u=new URL(p.replace(/\/\*$/,'/'));
        for(const ep of patternsFor(u.href))extra.push(ep);
      }catch{}
    }
    pats=[...new Set([...pats,...extra])];
  }
  if(!pats.length)return true;
  const needed=[];
  for(const p of pats){
    try{
      const has=await chrome.permissions?.contains?.({origins:[p]});
      if(!has)needed.push(p);
    }catch{
      needed.push(p);
    }
  }
  if(!needed.length)return true;
  let ok=false;
  try{
    ok=await (chrome.permissions?.request ? chrome.permissions.request({origins:needed}) : true);
  }catch(e){
    toast(e?.message||String(e),true);
    return false;
  }
  if(!ok){
    toast('Site permission not granted.',true);
    return false;
  }
  await send('SITE_ACCESS_CHANGED',{tabId});
  toast('Permission granted.');
  await refresh();
  return true;
}

function compactCandidate(row){const ct=String(row.contentType||'').split(';')[0],bits=[row.method||'GET'];if(row.status)bits.push(String(row.status));if(ct)bits.push(ct.replace('application/',''));return bits.join(' · ');}
function renderLearning(){const active=Boolean(state?.learning?.active),rows=[...(state?.learnCandidates||[])].reverse();show('learnCard',!isActiveDownload(panelJob())&&!inventory&&state?.tracking==='watching');if($('learnCard').classList.contains('hidden'))return;$('learnToggleBtn').textContent=active?'Stop learning':'Start learning';$('learnText').textContent=active?`${rows.length} requests recorded. Interact with viewer, then pick candidate.`:'Enable when site is not yet supported.';const el=$('learnList');el.textContent='';if(!active&&!rows.length){el.innerHTML='<div class="empty">No learning requests captured yet.</div>';return;}for(const row of rows.slice(0,24)){const item=document.createElement('div');item.className='learn-item';const info=document.createElement('div');info.className='learn-info';const name=document.createElement('div');name.className='learn-name';name.textContent=row.display||row.url||'Request';const meta=document.createElement('div');meta.className='learn-meta';meta.textContent=compactCandidate(row);info.append(name,meta);const acts=document.createElement('div');acts.className='learn-actions';const dicom=document.createElement('button');dicom.textContent='DICOM';dicom.title='Mark as DICOM endpoint';dicom.addEventListener('click',()=>learnCandidate(row,'dicom'));const manifest=document.createElement('button');manifest.textContent='Manifest';manifest.title='Mark as JSON containing image list/URLs';manifest.addEventListener('click',()=>learnCandidate(row,'manifest'));acts.append(dicom,manifest);item.append(info,acts);el.append(item);}}
async function learnCandidate(row,role){try{const r=await send('LEARN_CANDIDATE',{tabId,url:row.url,role});if(role==='dicom')toast('Learned DICOM endpoint.');else toast(r.result?.valid?`Learned manifest · ${r.result.valid} DICOM`:'Saved manifest template.');await refresh();}catch(e){toast(e.message||String(e),true);}}
function renderStatus(){
  const conf=Number(summary?.confidence||state?.confidence||0),ready=Boolean(inventory?.series?.length),missing=summary?.missingOrigins||[],trimmed=Boolean(state?.truncated||summary?.storageTruncated||inventory?.context?.storageTruncated||state?.dicomwebPayloadsTruncated),activeJob=panelJob(),phase=panelPhase({job:activeJob,hasInventory:ready,tracking:state?.tracking,confidence:conf});
  if(phase==='downloading'){
    const total=Number(activeJob?.total)||0,done=Number(activeJob?.completed||0)+Number(activeJob?.failed||0),pct=total?Math.min(100,Math.round(done*100/total)):0;
    $('scoreText').textContent=total?`${pct}%`:'';
    $('statusTitle').textContent=activeJob?.status==='cancelling'?'Cancelling':activeJob?.status===FINISHING_STATUS?'Finishing':'Downloading';
    $('statusText').textContent=`${activeJob?.adapter||inventory?.adapter||'DICOM'} · ${done}/${total||'?'} images`;
    chip($('siteChip'),'Downloading','neutral');
  }else{
    $('scoreText').textContent=conf?`${conf}%`:'';
    if(phase==='ready'&&inventory.series.every(s=>s.downloadReady===false)){
      $('statusTitle').textContent='Waiting for images';
      $('statusText').textContent='Series detected. Load images in the viewer before downloading.';
      chip($('siteChip'),'Capture needed','warn');
    }
    else if(phase==='ready'&&trimmed){$('statusTitle').textContent='Ready · rescan recommended';$('statusText').textContent=inventory?.storageWarning||'Chrome trimmed captured requests; reload the PACS page and scan again to verify every series.';chip($('siteChip'),'Partial cache','warn');}
    else if(phase==='ready'){$('statusTitle').textContent='Ready';$('statusText').textContent=`${inventory.adapter} · ${inventory.series.length} series`;chip($('siteChip'),'PACS','good');}
    else if(phase==='tracking'){$('statusTitle').textContent='Tracking';$('statusText').textContent='Waiting for manifest or DICOM from viewer';chip($('siteChip'),'Tracking','warn');}
    else if(phase==='candidate'){$('statusTitle').textContent='Possible PACS';$('statusText').textContent=missing.length?'Grant site permission to analyze':'Click Track tab';chip($('siteChip'),'PACS?','warn');}
    else if(phase==='stopped'){$('statusTitle').textContent='Stopped';$('statusText').textContent='This tab is not tracked';chip($('siteChip'),'Stopped','neutral');}
    else{$('statusTitle').textContent='No PACS detected';$('statusText').textContent='Manual tracking can be enabled for this tab';chip($('siteChip'),'Normal Tab','neutral');}
  }
  const busy=phase==='downloading';
  show('permissionBox',!busy&&missing.length>0);$('permissionText').textContent=missing.length>1?`Permission needed for ${missing.length} sites`:'Site permission required';
  $('trackBtn').disabled=busy;$('scanBtn').disabled=busy;$('trackBtn').textContent=busy?'Download in progress':state?.tracking==='watching'?'Stop tracking':'Track tab';
  show('deepScanBtn',!busy&&!ready&&state?.tracking==='watching'&&!missing.length&&Boolean(state?.binaryCandidates?.length));
}

// Result labels for previous download
const RESULT_LABELS={done:'Download complete',partial:'Saved (partial images)',done_with_errors:'Completed with errors',error:'Download failed',cancelled:'Cancelled'};
const RESULT_KINDS={done:'good',partial:'warn',done_with_errors:'bad',error:'bad',cancelled:'warn'};
// Direct viewer link — keep full string for accurate copying
function renderLink(){
  const real=summary?.bestViewerUrl||summary?.currentUrl||activeTabUrl||'';
  show('linkCard',Boolean(real));
  if(!real)return;
  $('viewerUrl').textContent=real;
  $('viewerUrl').title=real;
  $('linkNote').textContent=(summary?.currentUrl&&real!==summary.currentUrl)?'Direct viewer link — differs from address bar':'Current page link';
}
function jobMatchesInventory(){
  if(!inventory||!job||Number(job.tabId)!==Number(tabId))return false;
  if(job.studyUid&&inventory.studyUid)return job.studyUid===inventory.studyUid;
  if(job.studyKey&&inventory.context?.studyKey)return job.studyKey===inventory.context.studyKey;
  // Generic discovery may learn the Study UID only after downloading a file.
  // In that case match the captured inventory, not merely the tab or series IDs.
  return Boolean(job.inventoryCreatedAt&&job.inventoryCreatedAt===inventory.createdAt);
}
function previousResult(){
  // JOB_UPDATED can arrive before the finalized inventory. Do not reopen the
  // series editor in the gap between these two messages.
  if(jobMatchesInventory()&&isTerminalDownload(job))return {...job,lastDownloadAt:job.updatedAt||job.startedAt};
  const p=inventory?.previousDownload;return p&&p.lastDownloadAt&&RESULT_LABELS[p.status]?p:null;
}
function fillStudyCard(){$('studySub').textContent=inventory.studyUid||inventory.patient?.description||'—';chip($('adapterChip'),inventory.adapter||'DICOM','good');$('patientName').textContent=fmtName(inventory.patient?.name)||'—';$('patientId').textContent=inventory.patient?.id||'—';$('studyDate').textContent=fmtDate(inventory.patient?.studyDate);$('seriesCount').textContent=String(inventory.series?.length||0);}
let lastRenderedStudyKey='';
let mach7Capture=null;
function mach7CaptureKey(){return `${tabId}:${contextRevision}:${inventory?.context?.studyKey||inventory?.studyUid||activeTabUrl}`;}
function renderMach7Note(){
  const key=mach7CaptureKey();
  if(mach7Capture?.key!==key)mach7Capture={key,busy:false,message:''};
  const capture=mach7Capture,note=$('adapterNote');
  note.textContent='Mach7: load series in the viewer to capture their DICOM links. Only captured images can be downloaded. ';
  const button=document.createElement('button');
  button.id='btnMach7Autofetch';button.className='btn secondary';
  button.textContent=capture.busy?'Loading series...':capture.message||'Load all series in viewer';
  button.disabled=capture.busy;
  button.addEventListener('click',async()=>{
    if(capture.busy)return;
    const requestedTab=tabId;capture.busy=true;renderMach7Note();
    try{
      const response=await chrome.tabs.sendMessage(requestedTab,{type:'AUTOFETCH_MACH7_SERIES'});
      capture.message=`Requested ${Number(response?.count)||0} series. Load again`;
    }catch{capture.message='Retry loading series';}
    finally{
      capture.busy=false;
      if(inventory?.adapter==='MACH7'&&mach7Capture===capture&&mach7CaptureKey()===key)renderMach7Note();
    }
  });
  note.append(button);
}
function renderInventory(){
  if(!shouldShowInventoryEditor(panelJob())){show('doneCard',false);show('studyCard',false);show('seriesCard',false);show('stickyBar',false);show('partialBanner',false);return;}
  if(!inventory){show('doneCard',false);show('studyCard',false);show('seriesCard',false);show('stickyBar',false);show('partialBanner',false);return;}
  const result=previousResult();
  if(result&&!revealDownloaded){
    fillStudyCard();
    show('doneCard',true);show('studyCard',true);show('seriesCard',false);show('stickyBar',false);show('partialBanner',false);
    $('doneTitle').textContent=RESULT_LABELS[result.status];
    chip($('doneBadge'),`${result.completed||0}/${result.total||'?'} images`,RESULT_KINDS[result.status]||'neutral');
    $('doneMeta').textContent=[fmtName(inventory.patient?.name)||'Study',inventory.patient?.id,fmtDate(inventory.patient?.studyDate),fmtWhen(result.lastDownloadAt)].filter(Boolean).join(' · ');
    return;
  }
  show('doneCard',false);show('studyCard',true);show('seriesCard',true);show('stickyBar',true);fillStudyCard();
  const prev=inventory.previousDownload;
  show('partialBanner',Boolean(prev&&prev.status!=='done'&&prev.lastDownloadAt));
  if(prev&&prev.status!=='done'&&prev.lastDownloadAt)$('partialBanner').textContent=`Previous run: ${prev.completed||0}/${prev.total||'?'} images · retry will skip existing files.`;
  show('adapterNote',inventory.adapter==='ZFP'||inventory.adapter==='MACH7');
  if(inventory.adapter==='ZFP')$('adapterNote').textContent='GE viewer does not support on-demand image fetching. The extension captures images loaded by the viewer itself, so this tab will reload automatically — keep tab untouched during download.';
  else if(inventory.adapter==='MACH7')renderMach7Note();

  const currentStudyKey=inventoryStudyKey();
  const isSameStudy=(currentStudyKey&&currentStudyKey===lastRenderedStudyKey);
  const existingCbs=$('seriesList').querySelectorAll('input[type=checkbox]');
  const hadUserSelection=isSameStudy&&existingCbs.length>0;
  const currentCheckedIds=new Set([...existingCbs].filter(x=>x.checked).map(x=>x.dataset.id));
  const jobSelected=new Set(jobSelectionIds());
  lastRenderedStudyKey=currentStudyKey;

  const list=$('seriesList');
  list.textContent='';
  for(const s of(inventory.series||[])){
    const row=document.createElement('label');
    row.className='series-row';
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.disabled=s.downloadReady===false;
    cb.checked=!cb.disabled&&(hadUserSelection?currentCheckedIds.has(s.id):jobSelected.size?jobSelected.has(s.id):true);
    cb.dataset.id=s.id;
    cb.addEventListener('change',updateSelected);
    const main=document.createElement('div');
    main.className='series-main';
    const title=document.createElement('div');
    title.className='series-title';
    title.textContent=`${s.number?`${s.number} · `:''}${s.description||'Series'}`;
    const meta=document.createElement('div');
    meta.className='series-meta';
    const m1=document.createElement('span');
    m1.textContent=s.modality||'DICOM';
    const m2=document.createElement('span');
    m2.textContent=s.sequenceHint||'';
    meta.append(m1,m2);
    main.append(title,meta);
    const count=document.createElement('span');
    count.className='series-count';
    const isCaptured=Number.isFinite(s.capturedImageCount);
    count.textContent=isCaptured?`${s.capturedImageCount}/${s.imageCount||'?'} captured`:(s.imageCount?`${s.imageCount} images`:'? images');
    if(isCaptured){
      if(s.downloadReady===false){
        count.classList.add('uncaptured');
        count.title='No images captured yet. Load series in viewer.';
      }else if(s.captureComplete===false||(s.imageCount&&s.capturedImageCount<s.imageCount)){
        count.classList.add('partial');
        count.title=`Partially captured (${s.capturedImageCount}/${s.imageCount||'?'}). Scroll in viewer to capture remaining images.`;
      }else{
        count.classList.add('complete');
        count.title=`All images captured (${s.capturedImageCount}/${s.imageCount||s.capturedImageCount}).`;
      }
    }
    row.append(cb,main,count);
    list.append(row);
  }
  updateSelected();
}
// A study with neither a DICOM UID nor an adapter key is still the SAME
// study across re-analyses; only a tab bind or TAB_CONTEXT_CHANGED means a
// different one. Keying on `createdAt` made every INVENTORY_UPDATED look
// like a new study, so a routine re-analysis re-ticked the series the
// reader had just excluded, and `stillCurrent()` abandoned a download that
// was waiting on the folder picker.
function inventoryStudyKey(){return inventory?.studyUid||inventory?.context?.studyKey||`snapshot:${tabId}:${contextRevision}`;}
function jobSelectionIds(){return jobMatchesInventory()&&Array.isArray(job.selectedSeries)?job.selectedSeries.filter(id=>inventory.series?.some(s=>s.id===id&&s.downloadReady!==false)):[];}
function selectedIds(){
  if(!inventory)return [];
  const boxes=[...$('seriesList').querySelectorAll('input[type=checkbox]')];
  if(boxes.length&&lastRenderedStudyKey===inventoryStudyKey())return boxes.filter(x=>x.checked&&!x.disabled).map(x=>x.dataset.id);
  return jobSelectionIds();
}
function updateSelected(){
  const ids=selectedIds(),sel=(inventory?.series||[]).filter(s=>ids.includes(s.id)),images=sel.reduce((n,s)=>n+(Number(s.capturedImageCount??s.imageCount)||0),0);
  $('selectedSummary').textContent=`${ids.length}/${inventory?.series?.length||0} series${images?` · ~${images} images`:''}`;
  $('stickyTitle').textContent=`${ids.length} series${images?` · ${images} ${inventory?.adapter==='MACH7'?'captured':'images'}`:''}`;
  $('stickySub').textContent='Name - ID - Date / Series';
  const isBusy=isActiveDownload(panelJob());
  if(isBusy){
    $('downloadBtn').disabled=true;
    $('downloadBtn').classList.add('btn-loading');
    $('resumeBtn').disabled=true;
    $('resumeBtn').classList.add('btn-loading');
    if(!job||job.status==='preparing'||isStartingDownload){
      $('resumeBtn').innerHTML='<span class="spinner"></span> Reconnecting...';
    }
    return;
  }
  $('downloadBtn').classList.remove('btn-loading');
  $('downloadBtn').disabled=!ids.length;
  const prev=inventory?.previousDownload;
  const hasPartial=Boolean(prev&&prev.status!=='done'&&Number(prev.completed||0)>0);
  $('downloadBtn').textContent=hasPartial?'Download missing':'Download DICOM';
  $('resumeBtn').classList.remove('btn-loading');
  $('resumeBtn').disabled=!ids.length||!jobMatchesInventory();
}

function jobLabel(s){return({preparing:'Preparing',downloading:'Downloading',finishing:'Finishing',done:'Completed',partial:'Partial',done_with_errors:'Errors',error:'Failed',cancelling:'Cancelling',cancelled:'Cancelled'})[s]||s||'—';}
function renderJob(){
  if(!job||Number(job.tabId)!==Number(tabId)){show('progressCard',false);setTopLoader(false);return;}
  show('progressCard',true);
  const total=Number(job.total)||0,done=Number(job.completed||0)+Number(job.failed||0),pct=total?Math.min(100,Math.round(done*100/total)):0;
  $('progressBar').style.width=`${pct}%`;
  $('progressText').textContent=`${done} / ${total||'?'}`;
  $('failedText').textContent=`${job.failed||0} errors${job.skipped?` · ${job.skipped} skipped`:''}`;
  $('currentFile').textContent=job.currentFile||'';
  $('jobTitle').textContent=job.status==='partial'?'Saved captured data':job.status==='done'?'Download complete':job.status==='done_with_errors'?'Completed with errors':job.status==='cancelled'?'Download stopped':'Downloading DICOM';
  $('jobMeta').textContent=`${job.adapter||'DICOM'}${job.original||job.reconstructed?` · ${job.original||0} original${job.reconstructed?` · ${job.reconstructed} reconstructed`:''}`:''}`;
  const kind=job.status==='done'?'good':['error','done_with_errors'].includes(job.status)?'bad':['partial','cancelled'].includes(job.status)?'warn':'neutral';
  chip($('jobBadge'),jobLabel(job.status),kind);
  const isBusy=isActiveDownload(panelJob());
  setTopLoader(isBusy);
  if(isBusy){
    if(job.status===FINISHING_STATUS){
      show('cancelBtn',false);
      show('resumeBtn',false);
      show('jobNote',true);
      $('jobNote').textContent='All images fetched. Writing study metadata...';
    }else if(['downloading','cancelling'].includes(job.status)){
      show('cancelBtn',true);
      show('resumeBtn',false);
      show('jobNote',false);
      $('cancelBtn').disabled=(job.status==='cancelling');
      $('cancelBtn').textContent=(job.status==='cancelling'?'Cancelling...':'Cancel');
    }else{
      show('cancelBtn',false);
      show('resumeBtn',true);
      $('resumeBtn').disabled=true;
      $('resumeBtn').classList.add('btn-loading');
      const resumeHtml='<span class="spinner"></span> Reconnecting...';
      if($('resumeBtn').innerHTML!==resumeHtml)$('resumeBtn').innerHTML=resumeHtml;
      show('jobNote',true);
      $('jobNote').textContent='Preparing and reconnecting to PACS...';
    }
    $('downloadBtn').disabled=true;
    $('downloadBtn').classList.add('btn-loading');
    const dlHtml=`<span class="spinner"></span> ${jobLabel(job?.status||'preparing')}...`;
    if($('downloadBtn').innerHTML!==dlHtml)$('downloadBtn').innerHTML=dlHtml;
  }else{
    $('cancelBtn').textContent='Cancel';
    if(['cancelled','done_with_errors','error','partial'].includes(job.status)){
      show('cancelBtn',false);
      show('resumeBtn',true);
      show('jobNote',true);
      const remaining=Math.max(0,total-Number(job.completed||0));
      const isPartial=job.status==='partial'||Boolean(inventory?.series?.length>1&&!job.allSeriesSelected);
      const hasProgress=Number(job.completed||0)>0;
      $('resumeBtn').innerHTML=hasProgress
        ?(remaining?`🔄 Resume missing (${remaining})`:(isPartial?'🔄 Resume remaining':'🔄 Retry'))
        :'🔄 Retry';
      $('jobNote').textContent=job.status==='cancelled'
        ?`Download stopped. Safely saved ${job.completed||0}/${total||'?'} images. Click 'Resume' to download remaining files.`
        :job.status==='done_with_errors'
        ?`Saved ${job.completed||0}/${total||'?'} images (${job.failed||0} errors). Click 'Resume' to retry failed files.`
        :job.status==='error'
        ?`Download failed. Click 'Resume' to retry connecting.`
        :job.status==='partial'
        ?`Saved ${job.completed||0}/${total||'?'} images. Click 'Resume' to finish remaining files.`
        :`Incomplete download (${job.completed||0}/${total||'?'}). Click 'Resume' to finish.`;
    }else{
      show('cancelBtn',false);
      show('resumeBtn',false);
      show('jobNote',false);
    }
    updateSelected();
  }
  const errs=job.errors||[];show('errorDetails',errs.length>0);$('errorLog').textContent=errs.join('\n');
  if(isTerminalDownload(job)){
    const terminalKey=`${job.id||tabId}|${job.status}`;
    if(terminalKey!==lastTerminalRefreshKey){
      lastTerminalRefreshKey=terminalKey;
      refreshHistory().catch(()=>{});
      const revision=contextRevision;
      clearTimeout(terminalRefreshTimer);
      terminalRefreshTimer=setTimeout(()=>{if(revision===contextRevision)scheduleRefresh(0);},250);
    }
  }else lastTerminalRefreshKey='';
}

function historyStatus(s){return({done:'Downloaded',partial:'Partial',done_with_errors:'Errors',error:'Failed',cancelled:'Cancelled',viewed:'Viewed'})[s]||'Viewed';}
function historyKind(s){return s==='done'?'done':['error','done_with_errors'].includes(s)?'bad':['partial','cancelled'].includes(s)?'warn':'';}
function historyCounts(h){const done=Number(h.completed||0),total=Number(h.total||0);if(!total&&!done)return'';const failed=Number(h.failed||0);return`${done}/${total||'?'} images${failed?` · ${failed} errors`:''}`;}
function renderHistory(){const q=$('historySearch').value.trim().toLowerCase(),el=$('historyList');el.textContent='';const rows=history.filter(h=>!q||`${h.patientName||''} ${h.patientId||''} ${h.studyDate||''} ${h.description||''}`.toLowerCase().includes(q));if(!rows.length){el.innerHTML='<div class="empty">No results.</div>';return;}for(const h of rows.slice(0,70)){const item=document.createElement('div');item.className='history-item';const top=document.createElement('div');top.className='history-top';const left=document.createElement('div'),name=document.createElement('div');name.className='history-name';name.textContent=`${fmtName(h.patientName)||'Unknown'}${h.patientId?` · ${h.patientId}`:''}`;const meta=document.createElement('div');meta.className='history-meta';meta.textContent=[fmtDate(h.studyDate),h.seriesCount?`${h.seriesCount} series`:'',historyCounts(h),h.lastDownloadAt?fmtWhen(h.lastDownloadAt):''].filter(Boolean).join(' · ');left.append(name,meta);const st=document.createElement('span');st.className=`history-status ${historyKind(h.status)}`;st.textContent=historyStatus(h.status);top.append(left,st);item.append(top);el.append(item);}}
async function refreshHistory(){try{history=(await send('GET_HISTORY')).history||[];renderHistory();}catch{}}

async function refresh(){
  if(tabId==null)return;
  const requestedTabId=tabId,revision=++refreshRevision,requestedJobRevision=jobRevision,requestedInventoryRevision=inventoryRevision;
  try{
    const r=await send('GET_OVERVIEW',{tabId:requestedTabId});
    if(revision!==refreshRevision||requestedTabId!==tabId)return;
    summary=r.summary;state=r.state;
    // Progress and inventory have independent freshness. A busy job must not
    // starve the initial context response, nor may that response rewind it.
    if(requestedJobRevision===jobRevision)job=r.job;
    if(requestedInventoryRevision===inventoryRevision)inventory=reconcileInventory(inventory,r.inventory,panelJob());
    renderStatus();renderLink();renderInventory();renderJob();renderLearning();
  }catch(e){if(revision===refreshRevision&&requestedTabId===tabId)$('statusText').textContent=e.message||String(e);}
  if(revision===refreshRevision&&requestedTabId===tabId)await renderFolder();
}
function resetPanelContext(){
  contextRevision++;refreshRevision++;jobRevision++;inventoryRevision++;
  clearTimeout(refreshTimer);clearTimeout(terminalRefreshTimer);
  summary=null;state=null;inventory=null;job=null;isStartingDownload=false;revealDownloaded=false;
  lastRenderedStudyKey='';lastTerminalRefreshKey='';$('seriesList').textContent='';
  renderStatus();renderLink();renderInventory();renderJob();renderLearning();
}
async function bindActive(){
  const revision=++bindRevision,urlTab=new URLSearchParams(location.search).get('tabId');
  let t=urlTab?await chrome.tabs.get(Number(urlTab)).catch(()=>null):null;
  if(!t)t=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if(revision!==bindRevision||!t?.id)return;
  const changed=Number(tabId)!==Number(t.id);
  tabId=t.id;activeTabUrl=t.url||'';
  if(changed)resetPanelContext();
  await refresh();
}
function scheduleRefresh(ms=500){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(()=>{}),ms);}

/**
 * Bulk downloads write through a granted directory handle. The picker is shown
 * once when no handle exists; cancelling it stops before any files are queued.
 */
async function startDownload(){
  if(isStartingDownload)return;
  if(isActiveDownload(job))return;
  const selectedSeries=selectedIds(),requestedTabId=tabId,revision=contextRevision,studyKey=inventoryStudyKey();
  if(!selectedSeries.length)return;
  const stillCurrent=()=>revision===contextRevision&&requestedTabId===tabId&&studyKey===inventoryStudyKey();
  let needAccess=(summary?.missingOrigins||[]).length>0;
  if(!needAccess&&activeTabUrl){
    for(const pat of patternsFor(activeTabUrl)){
      try{
        if(chrome.permissions?.contains&&!(await chrome.permissions.contains({origins:[pat]}))){
          needAccess=true;
          break;
        }
      }catch{}
    }
  }
  if(needAccess){
    const granted=await grantAccess();
    if(!granted||!stillCurrent())return;
  }
  isStartingDownload=true;
  renderStatus();renderInventory();renderLearning();
  $('downloadBtn').disabled=true;
  $('downloadBtn').classList.add('btn-loading');
  $('downloadBtn').innerHTML='<span class="spinner"></span> Starting...';
  $('resumeBtn').disabled=true;
  $('resumeBtn').classList.add('btn-loading');
  $('resumeBtn').innerHTML='<span class="spinner"></span> Reconnecting...';
  setTopLoader(true);
  show('jobNote',true);
  $('jobNote').textContent='Preparing and reconnecting to PACS...';
  try{
    const st=await chrome.storage.local.get([SAVE_MODE_KEY,SUBFOLDER_KEY]);
    const requestedMode=st[SAVE_MODE_KEY]||'';
    const subfolder=String(st[SUBFOLDER_KEY]||'').trim()||DEFAULT_SUBFOLDER;
    const h=await ensureFolder(true).catch(()=>null);
    if(!stillCurrent())return;
    if(!h){
      setTopLoader(false);
      isStartingDownload=false;
      renderStatus();renderInventory();renderLearning();
      show('jobNote',true);
      $('jobNote').textContent='Cần chọn thư mục lưu (hoặc cấp quyền ghi) để tải ngầm toàn bộ ảnh DICOM.';
      toast('Chưa cấp quyền thư mục. Đã dừng để tránh hiện hàng loạt popup lưu file.',true);
      updateSelected();
      return;
    }
    const saveMode=resolveBulkDicomSaveMode(Boolean(h),requestedMode);
    await chrome.storage.local.set({[SAVE_MODE_KEY]:saveMode,[FOLDER_NAME_KEY]:h.name||'Selected Folder'});
    await renderFolder();
    if(!stillCurrent())return;
    const requestedJobRevision=jobRevision;
    const r=await send('START_DOWNLOAD',{tabId:requestedTabId,selectedSeries,options:{concurrency:6,frameConcurrency:6,saveMode,subfolder}});
    if(!stillCurrent())return;
    if(requestedJobRevision===jobRevision){job=r.job;jobRevision++;}
    renderStatus();renderInventory();renderJob();renderLearning();
  }catch(e){
    if(!stillCurrent())return;
    toast(e.message||String(e),true);
    setTopLoader(false);
    isStartingDownload=false;
    show('jobNote',true);
    $('jobNote').textContent=`Connection error: ${e.message||String(e)}`;
    $('resumeBtn').disabled=false;
    $('resumeBtn').classList.remove('btn-loading');
    $('resumeBtn').innerHTML='🔄 Retry';
    updateSelected();
  }finally{
    if(revision===contextRevision){
      isStartingDownload=false;
      renderStatus();renderInventory();renderJob();renderLearning();
    }
  }
}

function setQrResult(raw,sourceLabel='Found QR'){if(!raw){toast('No QR code detected.',true);return;}const parsed=parseQrResult(raw);currentQrUrl=parsed.url||parsed.text;show('qrCard',true);$('qrTitle').textContent=isLikelyPacsViewerUrl(currentQrUrl)?'PACS QR':'QR Code';$('qrStatusText').textContent=sourceLabel;$('qrUrlText').textContent=currentQrUrl;$('qrUrlText').title=currentQrUrl;$('qrOpenBtn').textContent=parsed.isUrl?'Open ↗':'Search ↗';toast('QR Code detected!');}
async function handleQrFileUpload(file){if(!file)return;setTopLoader(true);try{const raw=await decodeQrFromBlob(file);if(raw)setQrResult(raw,`File: ${file.name}`);else toast('No QR code found in image.',true);}catch(e){toast(e?.message||'Failed to scan image',true);}finally{setTopLoader(false);}}
async function scanActivePageQr(){if(tabId==null)return;setTopLoader(true);try{let r=await chrome.tabs.sendMessage(tabId,{type:'SCAN_PAGE_QR'}).catch(()=>null);if(r?.ok&&r?.results?.length){setQrResult(r.results[0],'Page QR');return;}const cap=await send('CAPTURE_TAB_FOR_QR');if(cap?.ok&&cap?.dataUrl){const raw=await decodeQrFromDataUrl(cap.dataUrl);if(raw){setQrResult(raw,'Page screenshot');return;}}toast('No QR code found on active tab.',true);}catch(e){toast(e?.message||'Page scan failed',true);}finally{setTopLoader(false);}}
async function handleClipboardPaste(e){const items=e?.clipboardData?.items||[];for(const item of items){if(item.type&&item.type.startsWith('image/')){const blob=item.getAsFile();if(blob){setTopLoader(true);try{const raw=await decodeQrFromBlob(blob);if(raw){setQrResult(raw,'Clipboard image');return;}else toast('No QR code found in pasted image.',true);}catch(err){toast(err?.message||'Paste scan failed',true);}finally{setTopLoader(false);}}}}}
async function handlePasteBtnClick(){try{if(navigator.clipboard?.read){const items=await navigator.clipboard.read().catch(()=>null);if(items&&items.length){for(const item of items){const imageType=item.types.find(t=>t.startsWith('image/'));if(imageType){const blob=await item.getType(imageType);setTopLoader(true);try{const raw=await decodeQrFromBlob(blob);if(raw){setQrResult(raw,'Clipboard image');return;}}finally{setTopLoader(false);}}}}}}catch(_){}toast('Paste image containing QR (Ctrl+V)');}

$('qrUploadBtn').addEventListener('click',()=>$('qrFileInput').click());
$('qrFileInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)handleQrFileUpload(f);e.target.value='';});
$('qrScanPageBtn').addEventListener('click',scanActivePageQr);
$('qrPasteBtn').addEventListener('click',handlePasteBtnClick);
$('qrCloseBtn').addEventListener('click',()=>show('qrCard',false));
$('qrCopyBtn').addEventListener('click',async()=>{if(!currentQrUrl)return;try{await navigator.clipboard.writeText(currentQrUrl);toast('QR content copied.');}catch(e){toast('Copy failed.',true);}});
$('qrOpenBtn').addEventListener('click',async()=>{if(!currentQrUrl)return;const parsed=parseQrResult(currentQrUrl);if(parsed.isUrl)await chrome.tabs.create({url:parsed.url});else await chrome.tabs.create({url:`https://www.google.com/search?q=${encodeURIComponent(parsed.text)}`});});
window.addEventListener('paste',handleClipboardPaste);

$('grantBtn').addEventListener('click',async()=>{if($('grantBtn').disabled)return;$('grantBtn').disabled=true;try{await grantAccess();}catch(e){toast(e.message||String(e),true);}finally{$('grantBtn').disabled=false;}});
$('folderBtn').addEventListener('click',async()=>{try{const h=await window.showDirectoryPicker({id:'pacs-dicom',startIn:'downloads',mode:'readwrite'});if(h){await fsSet(h);await chrome.storage.local.set({[SAVE_MODE_KEY]:'filesystem',[FOLDER_NAME_KEY]:h.name||'Selected Folder'});await renderFolder();toast(`Saved folder: ${h.name}`);}}catch(e){if(e?.name!=='AbortError')toast(e.message||String(e),true);}});
$('copyLinkBtn').addEventListener('click',async()=>{const t=$('viewerUrl').textContent||'';if(!t||t==='—')return;try{await navigator.clipboard.writeText(t);toast('Viewer link copied to clipboard.');}catch(e){toast('Copy failed; select URL to copy manually.',true);}});
$('folderResetBtn').addEventListener('click',async()=>{try{await fsDelete();await chrome.storage.local.remove([SAVE_MODE_KEY,FOLDER_NAME_KEY]);await renderFolder();toast('Saved folder cleared. Choose a folder before downloading.');}catch(e){toast(e.message||String(e),true);}});
if($('subfolderInput')){$('subfolderInput').addEventListener('input',async(e)=>{const val=String(e.target.value||'').trim()||DEFAULT_SUBFOLDER;await chrome.storage.local.set({[SUBFOLDER_KEY]:val});await renderFolder();});$('subfolderInput').addEventListener('change',async(e)=>{const val=String(e.target.value||'').trim()||DEFAULT_SUBFOLDER;await chrome.storage.local.set({[SUBFOLDER_KEY]:val});await renderFolder();toast(`Subfolder: ${val}`);});}
$('trackBtn').addEventListener('click',async()=>{if($('trackBtn').disabled)return;$('trackBtn').disabled=true;$('trackBtn').innerHTML='<span class="spinner dark"></span> Processing...';setTopLoader(true);try{if(state?.tracking==='watching')await send('STOP_TRACKING',{tabId});else{if((summary?.missingOrigins||[]).length)await grantAccess();await send('START_TRACKING',{tabId});}await refresh();}catch(e){toast(e.message||String(e),true);}finally{renderStatus();setTopLoader(isActiveDownload(panelJob()));}});
$('scanBtn').addEventListener('click',async()=>{if($('scanBtn').disabled)return;$('scanBtn').disabled=true;const old=$('scanBtn').textContent;$('scanBtn').innerHTML='<span class="spinner dark"></span> Scanning...';setTopLoader(true);try{await send('ANALYZE_TAB',{tabId});await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('scanBtn').textContent=old;renderStatus();setTopLoader(isActiveDownload(panelJob()));}});
$('deepScanBtn').addEventListener('click',async()=>{if($('deepScanBtn').disabled)return;$('deepScanBtn').disabled=true;const old=$('deepScanBtn').textContent;$('deepScanBtn').innerHTML='<span class="spinner dark"></span> Deep scanning...';setTopLoader(true);try{const r=await send('DEEP_SCAN',{tabId});toast(r.valid?.length?`Identified ${r.valid.length} DICOM endpoints.`:'No DICOM endpoints verified.',!r.valid?.length);await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('deepScanBtn').disabled=false;$('deepScanBtn').textContent=old;setTopLoader(false);}});
$('learnToggleBtn').addEventListener('click',async()=>{if($('learnToggleBtn').disabled)return;$('learnToggleBtn').disabled=true;try{if(state?.learning?.active)await send('STOP_LEARNING',{tabId});else{if((summary?.missingOrigins||[]).length)await grantAccess();await send('START_LEARNING',{tabId});}await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('learnToggleBtn').disabled=false;}});
$('selectAllBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=!x.disabled);updateSelected();});
$('selectNoneBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=false);updateSelected();});
$('downloadBtn').addEventListener('click',startDownload);
$('resumeBtn').addEventListener('click',startDownload);
$('cancelBtn').addEventListener('click',()=>send('CANCEL_JOB',{tabId}).then(()=>scheduleRefresh(100)).catch(e=>toast(e.message||String(e),true)));
$('revealDownloadedBtn').addEventListener('click',()=>{revealDownloaded=true;renderInventory();});
$('historyOpenBtn').addEventListener('click',async()=>{show('historyCard',true);$('historyToggle').querySelector('span').textContent='⌄';await refreshHistory();});
$('historyToggle').addEventListener('click',async()=>{const open=$('historyCard').classList.contains('hidden');show('historyCard',open);$('historyToggle').querySelector('span').textContent=open?'⌄':'›';if(open)await refreshHistory();});
$('historySearch').addEventListener('input',renderHistory);
$('clearHistoryBtn').addEventListener('click',async()=>{await send('CLEAR_HISTORY');await refreshHistory();});
if($('openLogBtn'))$('openLogBtn').addEventListener('click',async()=>{try{await chrome.tabs.create({url:chrome.runtime.getURL('log_viewer.html')});}catch(e){toast(e.message||String(e),true);}});
if($('exportLogBtn'))$('exportLogBtn').addEventListener('click',async()=>{
  try{
    const logs=(await send('GET_LOGS')).logs||[];
    if(!logs.length)return toast('No activity has been logged yet.',true);
    const blob=new Blob([formatLogsAsText(logs,chrome.runtime.getManifest().version)],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`pacs_extension_activity_${new Date().toISOString().slice(0,10)}.log`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch(e){toast(e.message||String(e),true);}
});
// Bulk DICOM always lands in the folder picked through File System Access
// (`resolveBulkDicomSaveMode`), and that API exposes no path the extension may
// hand to the shell. So this names the destination instead of opening it:
// revealing Chrome's default downloads folder would point the reader at a
// folder the images were deliberately kept out of since 7.0.3.
if($('historyFolderBtn'))$('historyFolderBtn').addEventListener('click',async()=>{
  const st=await chrome.storage.local.get([FOLDER_NAME_KEY,SUBFOLDER_KEY]);
  const folder=String(st[FOLDER_NAME_KEY]||'').trim();
  const sub=String(st[SUBFOLDER_KEY]||'').trim()||DEFAULT_SUBFOLDER;
  toast(folder?`Saving to: ${folder}/${sub}`:'No save folder chosen yet.',!folder);
});
chrome.tabs.onActivated.addListener(()=>bindActive().catch(()=>{}));chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(id===tabId&&(change.url||change.title||change.status==='complete')){activeTabUrl=tab.url||activeTabUrl;scheduleRefresh(150);}});
chrome.runtime.onMessage.addListener(m=>{
  if(['JOB_UPDATED','INVENTORY_UPDATED','PACS_SIGNAL','TAB_CONTEXT_CHANGED','LEARN_UPDATED'].includes(m?.type)&&Number(m.tabId)!==Number(tabId))return;
  if(m?.type==='JOB_UPDATED'){
    jobRevision++;
    const wasActive=isActiveDownload(panelJob());
    job=m.job;
    renderStatus();
    if(wasActive!==isActiveDownload(panelJob()))renderInventory();
    renderJob();renderLearning();
  }else if(m?.type==='INVENTORY_UPDATED'){
    inventoryRevision++;
    inventory=reconcileInventory(inventory,m.inventory,panelJob());
    renderStatus();renderInventory();renderLearning();
    if(!isActiveDownload(panelJob()))scheduleRefresh(80);
  }else if(m?.type==='TAB_CONTEXT_CHANGED'){
    contextRevision++;refreshRevision++;inventoryRevision++;
    inventory=null;summary=null;isStartingDownload=false;lastRenderedStudyKey='';$('seriesList').textContent='';
    renderStatus();renderLink();renderInventory();renderJob();renderLearning();
    scheduleRefresh(80);
  }else if(['PACS_SIGNAL','LEARN_UPDATED'].includes(m?.type)){
    if(!isActiveDownload(panelJob()))scheduleRefresh(800);
  }else if(m?.type==='HISTORY_UPDATED'){
    history=m.history||[];if(!$('historyCard').classList.contains('hidden'))renderHistory();
  }
});
bindActive().then(refreshHistory).catch(e=>toast(e.message||String(e),true));

