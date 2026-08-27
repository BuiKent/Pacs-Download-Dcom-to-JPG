'use strict';
import { decodeQrFromBlob, decodeQrFromDataUrl, parseQrResult, isLikelyPacsViewerUrl } from './lib/qr_decoder.js';
const $=id=>document.getElementById(id),show=(id,on)=>$(id).classList.toggle('hidden',!on);const TERMINAL=new Set(['done','partial','done_with_errors','error','cancelled']);
let tabId=null,summary=null,state=null,inventory=null,job=null,history=[],revealDownloaded=false,refreshTimer=null,activeTabUrl='',isStartingDownload=false,currentQrUrl='';
function setTopLoader(on){const e=$('topLoader');if(e)e.classList.toggle('active',Boolean(on));}
const FS_DB='pacs_dicom_fs_v1',FS_STORE='handles',FS_KEY='download-root',SAVE_MODE_KEY='pacs6_save_mode',FOLDER_NAME_KEY='pacs6_folder_name',SUBFOLDER_KEY='pacs6_subfolder_name',DEFAULT_SUBFOLDER='DCom to JPG';

async function getSubfolderName(){try{const st=await chrome.storage.local.get(SUBFOLDER_KEY);return String(st[SUBFOLDER_KEY]||'').trim()||DEFAULT_SUBFOLDER;}catch{return DEFAULT_SUBFOLDER;}}
async function send(type,payload={}){const r=await chrome.runtime.sendMessage({type,...payload});if(!r?.ok)throw new Error(r?.error||'Extension error');return r;}
function toast(text,bad=false){const e=$('toast');e.textContent=text;e.classList.toggle('error',bad);e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2600);}
function fmtName(x){return String(x||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim();}
function fmtDate(x){const d=String(x||'').replace(/[^0-9]/g,'');return d.length>=8?`${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`:(x||'—');}
function fmtWhen(x){if(!x)return'';return new Date(x).toLocaleString('en-US',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function chip(el,text,kind='neutral'){el.textContent=text;el.className=`chip ${kind}`;}
function patternFor(url){try{const u=new URL(url);return`${u.protocol}//${u.host}/*`;}catch{return'';}}

function openFsDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(FS_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(FS_STORE))r.result.createObjectStore(FS_STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function fsGet(){const db=await openFsDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readonly'),r=tx.objectStore(FS_STORE).get(FS_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function fsSet(h){const db=await openFsDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readwrite');tx.objectStore(FS_STORE).put(h,FS_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function ensureFolder(interactive=false){let h=await fsGet();if(!h&&interactive){try{h=await window.showDirectoryPicker({id:'pacs-dicom',startIn:'downloads',mode:'readwrite'});if(h){await fsSet(h);await chrome.storage.local.set({[SAVE_MODE_KEY]:'filesystem',[FOLDER_NAME_KEY]:h.name||'Selected Folder'});}}catch(e){if(e?.name!=='AbortError')console.warn(e);return null;}}if(!h)return null;let p='prompt';try{p=typeof h.queryPermission==='function'?await h.queryPermission({mode:'readwrite'}):'granted';if(p!=='granted'&&interactive&&typeof h.requestPermission==='function'){p=await h.requestPermission({mode:'readwrite'});}}catch{}if(interactive&&p!=='granted')return null;return h;}
// Accurately show where files will be saved without dropping persisted handle.
async function renderFolder(){
  try{
    const st=await chrome.storage.local.get([SAVE_MODE_KEY,FOLDER_NAME_KEY,SUBFOLDER_KEY]);
    const pref=st[SAVE_MODE_KEY]||'';
    const savedName=st[FOLDER_NAME_KEY]||'';
    const sub=String(st[SUBFOLDER_KEY]||'').trim()||DEFAULT_SUBFOLDER;
    if($('subfolderInput')&&document.activeElement!==$('subfolderInput'))$('subfolderInput').value=sub;
    const h=await fsGet();
    const useFs=Boolean(pref==='filesystem'&&(h||savedName));
    const displayName=h?.name||savedName||'Custom Folder';
    if(useFs){
      $('folderText').textContent=`📁 ${displayName} / ${sub}`;
      $('folderText').title=`${displayName} / ${sub}`;
      show('folderResetBtn',true);
    }else{
      $('folderText').textContent=`Downloads / ${sub} (default)`;
      $('folderText').title=`Downloads / ${sub}`;
      show('folderResetBtn',false);
    }
  }catch{
    $('folderText').textContent=`Downloads / ${DEFAULT_SUBFOLDER} (default)`;
    show('folderResetBtn',false);
  }
}

async function grantAccess(){let pats=[...(summary?.missingOrigins||[])];if(!pats.length){const p=patternFor(activeTabUrl);if(p)pats=[p];}if(!pats.length)return;const ok=await chrome.permissions.request({origins:pats});if(!ok)return toast('Site permission not granted.',true);await send('SITE_ACCESS_CHANGED',{tabId});toast('Permission granted.');await refresh();}

function compactCandidate(row){const ct=String(row.contentType||'').split(';')[0],bits=[row.method||'GET'];if(row.status)bits.push(String(row.status));if(ct)bits.push(ct.replace('application/',''));return bits.join(' · ');}
function renderLearning(){const active=Boolean(state?.learning?.active),rows=[...(state?.learnCandidates||[])].reverse();show('learnCard',!inventory&&state?.tracking==='watching');if($('learnCard').classList.contains('hidden'))return;$('learnToggleBtn').textContent=active?'Stop learning':'Start learning';$('learnText').textContent=active?`${rows.length} requests recorded. Interact with viewer, then pick candidate.`:'Enable when site is not yet supported.';const el=$('learnList');el.textContent='';if(!active&&!rows.length){el.innerHTML='<div class="empty">No learning requests captured yet.</div>';return;}for(const row of rows.slice(0,24)){const item=document.createElement('div');item.className='learn-item';const info=document.createElement('div');info.className='learn-info';const name=document.createElement('div');name.className='learn-name';name.textContent=row.display||row.url||'Request';const meta=document.createElement('div');meta.className='learn-meta';meta.textContent=compactCandidate(row);info.append(name,meta);const acts=document.createElement('div');acts.className='learn-actions';const dicom=document.createElement('button');dicom.textContent='DICOM';dicom.title='Mark as DICOM endpoint';dicom.addEventListener('click',()=>learnCandidate(row,'dicom'));const manifest=document.createElement('button');manifest.textContent='Manifest';manifest.title='Mark as JSON containing image list/URLs';manifest.addEventListener('click',()=>learnCandidate(row,'manifest'));acts.append(dicom,manifest);item.append(info,acts);el.append(item);}}
async function learnCandidate(row,role){try{const r=await send('LEARN_CANDIDATE',{tabId,url:row.url,role});if(role==='dicom')toast('Learned DICOM endpoint.');else toast(r.result?.valid?`Learned manifest · ${r.result.valid} DICOM`:'Saved manifest template.');await refresh();}catch(e){toast(e.message||String(e),true);}}
function renderStatus(){const conf=Number(summary?.confidence||state?.confidence||0),ready=Boolean(inventory?.series?.length),missing=summary?.missingOrigins||[];$('scoreText').textContent=conf?`${conf}%`:'';if(ready){$('statusTitle').textContent='Ready';$('statusText').textContent=`${inventory.adapter} · ${inventory.series.length} series`;chip($('siteChip'),'PACS','good');}else if(state?.tracking==='watching'){$('statusTitle').textContent='Tracking';$('statusText').textContent='Waiting for manifest or DICOM from viewer';chip($('siteChip'),'Tracking','warn');}else if(state?.tracking==='candidate'||conf>=55){$('statusTitle').textContent='Possible PACS';$('statusText').textContent=missing.length?'Grant site permission to analyze':'Click Track tab';chip($('siteChip'),'PACS?','warn');}else if(state?.tracking==='stopped'){$('statusTitle').textContent='Stopped';$('statusText').textContent='This tab is not tracked';chip($('siteChip'),'Stopped','neutral');}else{$('statusTitle').textContent='No PACS detected';$('statusText').textContent='Manual tracking can be enabled for this tab';chip($('siteChip'),'Normal Tab','neutral');}show('permissionBox',missing.length>0);$('permissionText').textContent=missing.length>1?`Permission needed for ${missing.length} sites`:'Site permission required';$('trackBtn').textContent=state?.tracking==='watching'?'Stop tracking':'Track tab';show('deepScanBtn',!ready&&state?.tracking==='watching'&&!missing.length&&Boolean(state?.binaryCandidates?.length));}

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
function previousResult(){const p=inventory?.previousDownload;return p&&p.lastDownloadAt&&RESULT_LABELS[p.status]?p:null;}
function fillStudyCard(){$('studySub').textContent=inventory.studyUid||inventory.patient?.description||'—';chip($('adapterChip'),inventory.adapter||'DICOM','good');$('patientName').textContent=fmtName(inventory.patient?.name)||'—';$('patientId').textContent=inventory.patient?.id||'—';$('studyDate').textContent=fmtDate(inventory.patient?.studyDate);$('seriesCount').textContent=String(inventory.series?.length||0);}
let lastRenderedStudyKey='';
function renderInventory(){
  if(!inventory){show('doneCard',false);show('studyCard',false);show('seriesCard',false);show('stickyBar',false);return;}
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
  else if(inventory.adapter==='MACH7'){
    const note=$('adapterNote');
    note.innerHTML='Mach7 Diagnostic Studio: Nhấp hoặc kéo các series từ thanh thumbnail vào màn hình để extension nhận đủ toàn bộ các series. <button id="btnMach7Autofetch" style="margin-top:6px;display:block;width:100%;padding:5px 8px;font-size:12px;font-weight:600;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:4px;">⚡ Tự động nạp toàn bộ Series</button>';
    const btn = note.querySelector('#btnMach7Autofetch');
    if(btn){
      btn.onclick = async (e) => {
        e.preventDefault();
        btn.textContent = '⏳ Đang nạp các series...';
        btn.disabled = true;
        try {
          const res = await chrome.tabs.sendMessage(activeTabId, {type: 'AUTOFETCH_MACH7_SERIES'});
          btn.textContent = `✓ Đã nạp ${res?.count || ''} series`;
        } catch(_) {
          btn.textContent = '⚡ Thử lại nạp Series';
          btn.disabled = false;
        }
      };
    }
  }

  const currentStudyKey=inventory.studyUid||`${inventory.patient?.id||''}_${inventory.patient?.studyDate||''}`;
  const isSameStudy=(currentStudyKey&&currentStudyKey===lastRenderedStudyKey);
  const existingCbs=$('seriesList').querySelectorAll('input[type=checkbox]');
  const hadUserSelection=isSameStudy&&existingCbs.length>0;
  const currentCheckedIds=new Set([...existingCbs].filter(x=>x.checked).map(x=>x.dataset.id));
  lastRenderedStudyKey=currentStudyKey;

  const list=$('seriesList');
  list.textContent='';
  for(const s of(inventory.series||[])){
    const row=document.createElement('label');
    row.className='series-row';
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=hadUserSelection?currentCheckedIds.has(s.id):true;
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
    count.textContent=s.imageCount?`${s.imageCount} images`:'? images';
    row.append(cb,main,count);
    list.append(row);
  }
  updateSelected();
}
function selectedIds(){return[...$('seriesList').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.dataset.id);}
function updateSelected(){
  const ids=selectedIds(),sel=(inventory?.series||[]).filter(s=>ids.includes(s.id)),images=sel.reduce((n,s)=>n+(Number(s.imageCount)||0),0);
  $('selectedSummary').textContent=`${ids.length}/${inventory?.series?.length||0} series${images?` · ~${images} images`:''}`;
  $('stickyTitle').textContent=`${ids.length} series${images?` · ~${images} images`:''}`;
  $('stickySub').textContent='Name - ID - Date / Series';
  const isBusy=isStartingDownload||(job&&['preparing','downloading','cancelling'].includes(job.status));
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
  $('downloadBtn').textContent=inventory?.previousDownload&&inventory.previousDownload.status!=='done'?'Download missing':'Download DICOM';
  $('resumeBtn').classList.remove('btn-loading');
  $('resumeBtn').disabled=!ids.length;
}

function jobLabel(s){return({preparing:'Preparing',downloading:'Downloading',done:'Completed',partial:'Partial',done_with_errors:'Errors',error:'Failed',cancelling:'Cancelling',cancelled:'Cancelled'})[s]||s||'—';}
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
  const isBusy=['preparing','downloading','cancelling'].includes(job.status)||isStartingDownload;
  setTopLoader(isBusy);
  if(isBusy){
    if(job&&['downloading','cancelling'].includes(job.status)){
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
      $('resumeBtn').innerHTML='<span class="spinner"></span> Reconnecting...';
      show('jobNote',true);
      $('jobNote').textContent='Preparing and reconnecting to PACS...';
    }
    $('downloadBtn').disabled=true;
    $('downloadBtn').classList.add('btn-loading');
    $('downloadBtn').innerHTML=`<span class="spinner"></span> ${jobLabel(job?.status||'preparing')}...`;
  }else{
    $('cancelBtn').textContent='Cancel';
    if(['cancelled','done_with_errors','error','partial'].includes(job.status)){
      show('cancelBtn',false);
      show('resumeBtn',true);
      show('jobNote',true);
      const remaining=Math.max(0,total-Number(job.completed||0));
      const isPartial=job.status==='partial'||Boolean(inventory?.series?.length>1&&!job.allSeriesSelected);
      $('resumeBtn').innerHTML=remaining?`🔄 Resume missing (${remaining})`:(isPartial?'🔄 Resume remaining':'🔄 Retry');
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
  if(TERMINAL.has(job.status)){refreshHistory().catch(()=>{});setTimeout(refresh,250);}
}

function historyStatus(s){return({done:'Downloaded',partial:'Partial',done_with_errors:'Errors',error:'Failed',cancelled:'Cancelled',viewed:'Viewed'})[s]||'Viewed';}
function historyKind(s){return s==='done'?'done':['error','done_with_errors'].includes(s)?'bad':['partial','cancelled'].includes(s)?'warn':'';}
function historyCounts(h){const done=Number(h.completed||0),total=Number(h.total||0);if(!total&&!done)return'';const failed=Number(h.failed||0);return`${done}/${total||'?'} images${failed?` · ${failed} errors`:''}`;}
function renderHistory(){const q=$('historySearch').value.trim().toLowerCase(),el=$('historyList');el.textContent='';const rows=history.filter(h=>!q||`${h.patientName||''} ${h.patientId||''} ${h.studyDate||''} ${h.description||''}`.toLowerCase().includes(q));if(!rows.length){el.innerHTML='<div class="empty">No results.</div>';return;}for(const h of rows.slice(0,70)){const item=document.createElement('div');item.className='history-item';const top=document.createElement('div');top.className='history-top';const left=document.createElement('div'),name=document.createElement('div');name.className='history-name';name.textContent=`${fmtName(h.patientName)||'Unknown'}${h.patientId?` · ${h.patientId}`:''}`;const meta=document.createElement('div');meta.className='history-meta';meta.textContent=[fmtDate(h.studyDate),h.seriesCount?`${h.seriesCount} series`:'',historyCounts(h),h.lastDownloadAt?fmtWhen(h.lastDownloadAt):''].filter(Boolean).join(' · ');left.append(name,meta);const st=document.createElement('span');st.className=`history-status ${historyKind(h.status)}`;st.textContent=historyStatus(h.status);top.append(left,st);item.append(top);el.append(item);}}
async function refreshHistory(){try{history=(await send('GET_HISTORY')).history||[];renderHistory();}catch{}}

async function refresh(){if(tabId==null)return;try{const r=await send('GET_OVERVIEW',{tabId});summary=r.summary;state=r.state;inventory=r.inventory;job=r.job;renderStatus();renderLink();renderInventory();renderJob();renderLearning();}catch(e){$('statusText').textContent=e.message||String(e);}await renderFolder();}
async function bindActive(){const urlTab=new URLSearchParams(location.search).get('tabId');let t=urlTab?await chrome.tabs.get(Number(urlTab)).catch(()=>null):null;if(!t)t=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!t?.id)return;tabId=t.id;activeTabUrl=t.url||'';revealDownloaded=false;await refresh();}
function scheduleRefresh(ms=180){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(()=>{}),ms);}

/**
 * Download handler directly initiates downloading without unexpected file picker modals.
 */
async function startDownload(){
  if(isStartingDownload)return;
  if(job&&['preparing','downloading','cancelling'].includes(job.status))return;
  if(!selectedIds().length)return;
  isStartingDownload=true;
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
    const pref=st[SAVE_MODE_KEY]||'';
    const subfolder=String(st[SUBFOLDER_KEY]||'').trim()||DEFAULT_SUBFOLDER;
    let saveMode='downloads';
    const storedHandle=await fsGet();
    if(pref==='filesystem'||storedHandle){
      const h=await ensureFolder(true).catch(()=>null);
      if(h)saveMode='filesystem';
      else toast('Write permission not granted for selected folder — saving to Downloads.');
    }
    await renderFolder();
    const r=await send('START_DOWNLOAD',{tabId,selectedSeries:selectedIds(),options:{concurrency:saveMode==='downloads'?3:6,frameConcurrency:6,saveMode,subfolder}});
    job=r.job;renderJob();
  }catch(e){
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
    isStartingDownload=false;
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
$('folderResetBtn').addEventListener('click',async()=>{try{await chrome.storage.local.set({[SAVE_MODE_KEY]:'downloads'});await renderFolder();const sub=await getSubfolderName();toast(`Reset to Downloads / ${sub}`);}catch(e){toast(e.message||String(e),true);}});
if($('subfolderInput')){$('subfolderInput').addEventListener('input',async(e)=>{const val=String(e.target.value||'').trim()||DEFAULT_SUBFOLDER;await chrome.storage.local.set({[SUBFOLDER_KEY]:val});await renderFolder();});$('subfolderInput').addEventListener('change',async(e)=>{const val=String(e.target.value||'').trim()||DEFAULT_SUBFOLDER;await chrome.storage.local.set({[SUBFOLDER_KEY]:val});await renderFolder();toast(`Subfolder: ${val}`);});}
$('trackBtn').addEventListener('click',async()=>{if($('trackBtn').disabled)return;$('trackBtn').disabled=true;const old=$('trackBtn').textContent;$('trackBtn').innerHTML='<span class="spinner dark"></span> Processing...';setTopLoader(true);try{if(state?.tracking==='watching')await send('STOP_TRACKING',{tabId});else{if((summary?.missingOrigins||[]).length)await grantAccess();await send('START_TRACKING',{tabId});}await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('trackBtn').disabled=false;$('trackBtn').textContent=old;setTopLoader(false);}});
$('scanBtn').addEventListener('click',async()=>{if($('scanBtn').disabled)return;$('scanBtn').disabled=true;const old=$('scanBtn').textContent;$('scanBtn').innerHTML='<span class="spinner dark"></span> Scanning...';setTopLoader(true);try{await send('ANALYZE_TAB',{tabId});await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('scanBtn').disabled=false;$('scanBtn').textContent=old;setTopLoader(false);}});
$('deepScanBtn').addEventListener('click',async()=>{if($('deepScanBtn').disabled)return;$('deepScanBtn').disabled=true;const old=$('deepScanBtn').textContent;$('deepScanBtn').innerHTML='<span class="spinner dark"></span> Deep scanning...';setTopLoader(true);try{const r=await send('DEEP_SCAN',{tabId});toast(r.valid?.length?`Identified ${r.valid.length} DICOM endpoints.`:'No DICOM endpoints verified.',!r.valid?.length);await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('deepScanBtn').disabled=false;$('deepScanBtn').textContent=old;setTopLoader(false);}});
$('learnToggleBtn').addEventListener('click',async()=>{if($('learnToggleBtn').disabled)return;$('learnToggleBtn').disabled=true;try{if(state?.learning?.active)await send('STOP_LEARNING',{tabId});else{if((summary?.missingOrigins||[]).length)await grantAccess();await send('START_LEARNING',{tabId});}await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('learnToggleBtn').disabled=false;}});
$('selectAllBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=true);updateSelected();});
$('selectNoneBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=false);updateSelected();});
$('downloadBtn').addEventListener('click',startDownload);
$('resumeBtn').addEventListener('click',startDownload);
$('cancelBtn').addEventListener('click',()=>send('CANCEL_JOB',{tabId}).then(()=>scheduleRefresh(100)).catch(e=>toast(e.message||String(e),true)));
$('revealDownloadedBtn').addEventListener('click',()=>{revealDownloaded=true;renderInventory();});
$('historyOpenBtn').addEventListener('click',async()=>{show('historyCard',true);$('historyToggle').querySelector('span').textContent='⌄';await refreshHistory();});
$('historyToggle').addEventListener('click',async()=>{const open=$('historyCard').classList.contains('hidden');show('historyCard',open);$('historyToggle').querySelector('span').textContent=open?'⌄':'›';if(open)await refreshHistory();});
$('historySearch').addEventListener('input',renderHistory);
$('clearHistoryBtn').addEventListener('click',async()=>{await send('CLEAR_HISTORY');await refreshHistory();});
chrome.tabs.onActivated.addListener(()=>bindActive().catch(()=>{}));chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(id===tabId&&(change.url||change.title||change.status==='complete')){activeTabUrl=tab.url||activeTabUrl;scheduleRefresh(150);}});
chrome.runtime.onMessage.addListener(m=>{if(['JOB_UPDATED','INVENTORY_UPDATED','PACS_SIGNAL','TAB_CONTEXT_CHANGED','LEARN_UPDATED'].includes(m?.type)&&Number(m.tabId)!==Number(tabId))return;if(m?.type==='JOB_UPDATED'){job=m.job;renderJob();}else if(m?.type==='INVENTORY_UPDATED'){inventory=m.inventory;renderInventory();scheduleRefresh(80);}else if(['PACS_SIGNAL','TAB_CONTEXT_CHANGED','LEARN_UPDATED'].includes(m?.type))scheduleRefresh(180);else if(m?.type==='HISTORY_UPDATED'){history=m.history||[];if(!$('historyCard').classList.contains('hidden'))renderHistory();}});
bindActive().then(refreshHistory).catch(e=>toast(e.message||String(e),true));

