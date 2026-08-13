'use strict';

const $=id=>document.getElementById(id);
const TERMINAL=new Set(['done','partial','done_with_errors','error','cancelled']);
let tabId=null,tabTitle='',summary=null,inventory=null,history=[],revealDownloaded=false,pollTimer=null,refreshTimer=null;

function show(id,on=true){$(id).classList.toggle('hidden',!on)}
function chip(el,text,kind='neutral'){el.textContent=text;el.className=`chip ${kind}`}
function toast(text,kind=''){const el=$('toast');el.textContent=text;el.className=`toast ${kind}`.trim();clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),3500)}
function fmtName(raw){return String(raw||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim()}
function fmtDate(raw){const s=String(raw||'').trim();if(/^\d{8}$/.test(s))return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;if(/^\d{4}-\d{2}-\d{2}/.test(s))return `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;return s||'—'}
function fmtWhen(ts){if(!ts)return'';try{return new Date(ts).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return''}}
async function send(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.error||'Lỗi extension');return r}

function detectorKind(d){if(['DICOMWEB','VRAD','VRPACS','CAPTURED','CAPTURED_DIRECT'].includes(d))return'good';if(['RENDERED_ONLY','VRAD_SHELL','VIEWER_SHELL'].includes(d))return'warn';return'neutral'}
function trackingLabel(state){if(state?.tracking==='stopped')return'Đã dừng';if(state?.tracking==='watching')return state?.cdpAttached?'Đang bắt DICOM':'Đang theo dõi';return'Chưa theo dõi'}

function renderStatus(state){
  const detector=inventory?.adapter||summary?.detector||'UNKNOWN';
  const tracking=state?.tracking||summary?.tracking||'idle';
  const ready=Boolean(inventory?.series?.length);
  let text=trackingLabel(state||summary),kind='neutral';
  if(ready){text='Đã nhận diện';kind='good'}
  else if(tracking==='watching'){kind='warn'}
  else if(tracking==='stopped'){kind='neutral'}
  chip($('statusChip'),text,kind);
  $('pageTitle').textContent=tabTitle||summary?.title||'Trang hiện tại';
  if(ready){
    const unknownComplete=inventory?.context?.completeKnown===false;
    const count=(inventory.series||[]).reduce((n,s)=>n+(Number(s.imageCount)||0),0);
    $('statusText').textContent=unknownComplete?`Đã bắt ${count||'?'} DICOM · tiếp tục theo dõi`:`${detector} · ${inventory.series.length} series`;
    if(unknownComplete)chip($('statusChip'),'Đang thu thập','warn');
  }
  else if(tracking==='watching')$('statusText').textContent='Đang theo dõi trang và viewer của tab này.';
  else $('statusText').textContent='Chưa thấy DICOM trên tab này.';
  $('trackBtn').textContent=tracking==='watching'?'Dừng theo dõi':'Theo dõi';
  show('waitingCard',tracking==='watching'&&!ready);
}

function clearStudy(){inventory=null;revealDownloaded=false;show('alreadyCard',false);show('studyCard',false);show('seriesCard',false);$('seriesList').textContent=''}

function renderInventory(){
  if(!inventory){show('alreadyCard',false);show('studyCard',false);show('seriesCard',false);return}
  const previous=inventory.previousDownload;
  if(previous&&!revealDownloaded){
    show('alreadyCard',true);show('studyCard',false);show('seriesCard',false);
    $('alreadyMeta').textContent=`${fmtName(inventory.patient?.name)||'Unknown'}${inventory.patient?.id?` · ${inventory.patient.id}`:''}${inventory.patient?.studyDate?` · ${fmtDate(inventory.patient.studyDate)}`:''}`;
    return;
  }
  show('alreadyCard',false);show('studyCard',true);show('seriesCard',true);
  chip($('adapterChip'),inventory.adapter||'DICOM','good');
  $('studyTitle').textContent=inventory.patient?.description||'Study';
  $('studySub').textContent=inventory.studyUid||'';
  $('patientName').textContent=fmtName(inventory.patient?.name)||'—';
  $('patientId').textContent=inventory.patient?.id||'—';
  $('studyDate').textContent=fmtDate(inventory.patient?.studyDate);
  $('seriesCount').textContent=String(inventory.series?.length||0);
  const list=$('seriesList');list.textContent='';
  for(const s of (inventory.series||[])){
    const row=document.createElement('label');row.className='series-row';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.dataset.id=s.id;cb.addEventListener('change',updateSelected);
    const main=document.createElement('div');main.className='series-main';
    const title=document.createElement('div');title.className='series-title';title.textContent=`${s.number?`${s.number} · `:''}${s.description||'Series'}`;
    const meta=document.createElement('div');meta.className='series-meta';
    const a=document.createElement('span');a.textContent=s.modality||'DICOM';const b=document.createElement('span');b.textContent=s.sequenceHint||'';meta.append(a,b);main.append(title,meta);
    const count=document.createElement('span');count.className='series-count';count.textContent=s.imageCount?`${s.imageCount} ảnh`:'? ảnh';row.append(cb,main,count);list.append(row);
  }
  updateSelected();
}

function selectedIds(){return [...$('seriesList').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.dataset.id)}
function updateSelected(){const ids=selectedIds(),total=inventory?.series?.length||0,images=(inventory?.series||[]).filter(s=>ids.includes(s.id)).reduce((n,s)=>n+(Number(s.imageCount)||0),0);$('selectedSummary').textContent=`${ids.length}/${total} series${images?` · ~${images} ảnh`:''}`;$('downloadBtn').disabled=!ids.length;$('downloadBtnText').textContent=ids.length?`Tải DICOM (${ids.length} series)`:'Chọn series'}

function jobKind(status){if(status==='done')return'good';if(status==='partial')return'warn';if(['error','done_with_errors'].includes(status))return'bad';if(['cancelled','cancelling'].includes(status))return'warn';return'neutral'}
function jobLabel(status){return({preparing:'Chuẩn bị',downloading:'Đang tải',done:'Hoàn tất',partial:'Đã lưu',done_with_errors:'Có lỗi',error:'Lỗi',cancelling:'Đang dừng',cancelled:'Đã dừng'})[status]||status||'—'}
function renderJob(job){
  if(!job||Number(job.tabId)!==Number(tabId)){show('progressCard',false);stopPolling();return}
  show('progressCard',true);chip($('jobBadge'),jobLabel(job.status),jobKind(job.status));$('jobMeta').textContent=job.adapter||'DICOM';
  const total=Number(job.total)||0,ok=Number(job.completed)||0,failed=Number(job.failed)||0,done=ok+failed,pct=total?Math.min(100,Math.round(done*100/total)):0;
  $('progressBar').style.width=`${pct}%`;$('progressText').textContent=`${done} / ${total||'?'}`;$('failedText').textContent=`${failed} lỗi`;$('currentFile').textContent=job.currentFile||'';
  $('jobTitle').textContent=job.status==='done'?'Tải hoàn tất':job.status==='partial'?'Đã lưu DICOM đã bắt':job.status==='done_with_errors'?'Hoàn tất nhưng có lỗi':'Đang tải DICOM';
  $('cancelBtn').disabled=!['preparing','downloading','cancelling'].includes(job.status);
  const errs=job.errors||[];show('errorDetails',!!errs.length);$('errorLog').textContent=errs.join('\n');
  if(TERMINAL.has(job.status)){stopPolling();refreshAll().catch(()=>{});refreshHistory().catch(()=>{})}
  else startPolling();
}

async function refreshJob(){if(tabId==null)return;try{const r=await send('GET_JOB',{tabId});renderJob(r.job)}catch{}}
function startPolling(){if(pollTimer)return;pollTimer=setInterval(refreshJob,750)}
function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}

async function refreshAll(){
  if(tabId==null)return;
  try{
    const [s,st,inv]=await Promise.all([send('SCAN_TAB',{tabId}),send('GET_TAB_STATE',{tabId}),send('GET_INVENTORY',{tabId})]);
    summary=s.summary;inventory=inv.inventory||null;renderStatus(st.state);renderInventory();await refreshJob();
  }catch(e){$('statusText').textContent=e.message||String(e)}
}

async function bindTab(){const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];if(!tab?.id)return;tabId=tab.id;tabTitle=tab.title||'';$('tabLabel').textContent=tabTitle||`Tab ${tabId}`;await refreshAll()}

async function toggleTracking(){
  if(tabId==null)return;
  try{
    const st=(await send('GET_TAB_STATE',{tabId})).state;
    if(st?.tracking==='watching')await send('STOP_TRACKING',{tabId});else await send('START_TRACKING',{tabId,deep:true});
    await refreshAll();
  }catch(e){toast(e.message||String(e),'error')}
}

async function reanalyze(){
  if(tabId==null)return;$('reanalyzeBtn').disabled=true;
  try{
    await send('START_TRACKING',{tabId,deep:true});
    try{const r=await send('ANALYZE_TAB',{tabId});inventory=r.inventory;renderInventory();toast('Đã cập nhật study.','good')}
    catch{toast('Đang theo dõi. Study sẽ tự hiện khi PACS phát DICOM.')}
    await refreshAll();
  }catch(e){toast(e.message||String(e),'error')}finally{$('reanalyzeBtn').disabled=false}
}

async function startDownload(){const ids=selectedIds();if(!ids.length||tabId==null)return;$('downloadBtn').disabled=true;try{const r=await send('START_DOWNLOAD',{tabId,selectedSeries:ids});renderJob(r.job);startPolling()}catch(e){toast(e.message||String(e),'error');$('downloadBtn').disabled=false}}

function historyStatusClass(s){if(s==='done')return'done';if(s==='partial')return'';if(['error','done_with_errors'].includes(s))return'bad';return''}
function historyStatusText(s){return({done:'Đã tải',partial:'Đã lưu',done_with_errors:'Tải có lỗi',error:'Lỗi',cancelled:'Đã dừng',viewed:'Đã xem'})[s]||'Đã xem'}
function renderHistory(){
  const q=$('historySearch').value.trim().toLowerCase(),el=$('historyList');el.textContent='';
  const list=history.filter(h=>!q||`${h.patientName||''} ${h.patientId||''} ${h.studyDate||''} ${h.description||''}`.toLowerCase().includes(q));
  if(!list.length){const d=document.createElement('div');d.className='empty';d.textContent='Không có kết quả.';el.append(d);return}
  for(const h of list.slice(0,50)){
    const item=document.createElement('div');item.className='history-item';const top=document.createElement('div');top.className='history-top';
    const left=document.createElement('div');const name=document.createElement('div');name.className='history-name';name.textContent=`${fmtName(h.patientName)||'Unknown'}${h.patientId?` · ${h.patientId}`:''}`;
    const meta=document.createElement('div');meta.className='history-meta';meta.textContent=`${fmtDate(h.studyDate)}${h.seriesCount?` · ${h.seriesCount} series`:''}${h.lastDownloadAt?` · ${fmtWhen(h.lastDownloadAt)}`:''}`;left.append(name,meta);
    const st=document.createElement('span');st.className=`history-status ${historyStatusClass(h.status)}`;st.textContent=historyStatusText(h.status);top.append(left,st);item.append(top);el.append(item);
  }
}
async function refreshHistory(){try{history=(await send('GET_HISTORY')).history||[];renderHistory()}catch{}}

function scheduleRefresh(delay=250){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refreshAll().catch(()=>{}),delay)}

$('trackBtn').addEventListener('click',toggleTracking);
$('reanalyzeBtn').addEventListener('click',reanalyze);
$('selectAllBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=true);updateSelected()});
$('selectNoneBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=false);updateSelected()});
$('downloadBtn').addEventListener('click',startDownload);
$('cancelBtn').addEventListener('click',async()=>{try{await send('CANCEL_JOB',{tabId});startPolling()}catch(e){toast(e.message||String(e),'error')}});
$('openFolderBtn').addEventListener('click',()=>send('OPEN_DOWNLOADS_FOLDER').catch(()=>{}));
$('openFolderDoneBtn').addEventListener('click',()=>send('OPEN_DOWNLOADS_FOLDER').catch(()=>{}));
$('revealDownloadedBtn').addEventListener('click',()=>{revealDownloaded=true;renderInventory()});
$('historyToggle').addEventListener('click',async()=>{const open=$('historyCard').classList.contains('hidden');show('historyCard',open);$('historyToggle').querySelector('span').textContent=open?'⌄':'›';if(open)await refreshHistory()});
$('historySearch').addEventListener('input',renderHistory);
$('clearHistoryBtn').addEventListener('click',async()=>{try{await send('CLEAR_HISTORY');await refreshHistory()}catch(e){toast(e.message||String(e),'error')}});

chrome.runtime.onMessage.addListener(m=>{
  if(Number(m?.tabId)!==Number(tabId)&&['JOB_UPDATED','INVENTORY_UPDATED','PACS_SIGNAL','TRACKING_UPDATED','TAB_CONTEXT_CHANGED'].includes(m?.type))return;
  if(m?.type==='JOB_UPDATED')renderJob(m.job);
  else if(m?.type==='INVENTORY_UPDATED'){inventory=m.inventory;renderInventory();scheduleRefresh(80)}
  else if(['PACS_SIGNAL','TRACKING_UPDATED'].includes(m?.type))scheduleRefresh(180);
  else if(m?.type==='TAB_CONTEXT_CHANGED'){clearStudy();scheduleRefresh(180)}
  else if(m?.type==='HISTORY_UPDATED'){history=m.history||[];if(!$('historyCard').classList.contains('hidden'))renderHistory()}
});

bindTab().then(refreshHistory).catch(e=>toast(e.message||String(e),'error'));
