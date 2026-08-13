'use strict';

let activeTab=null, summary=null, inventory=null, pollTimer=null;
let analyzeBusy=false, autoAnalyzeTimer=null;
const $=id=>document.getElementById(id);
const TERMINAL=new Set(['done','done_with_errors','error','cancelled']);

function toast(text,kind=''){const el=$('toast');el.textContent=text;el.className=`toast ${kind}`.trim();clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),4200);}
function chip(el,text,kind='neutral'){el.textContent=text;el.className=`chip ${kind}`;}
function show(id,on=true){$(id).classList.toggle('hidden',!on);}
function fmtDate(s){s=String(s||'');return /^\d{8}$/.test(s)?`${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`:(s||'—');}
function fmtWhen(ts){if(!ts)return'';try{return new Date(ts).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return'';}}
async function send(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.error||'Lỗi extension');return r;}
async function currentTab(){const tabs=await chrome.tabs.query({active:true,currentWindow:true});return tabs[0]||null;}

function detectorKind(d){if(['DICOMWEB','VRAD','VRPACS'].includes(d))return'good';if(['RENDERED_ONLY','VRAD_SHELL','VIEWER_SHELL'].includes(d))return'warn';return'neutral';}
function detectorReady(s){
  const req=s?.requests||[];
  if(s?.detector==='DICOMWEB')return req.some(x=>['QIDO_SERIES','QIDO_INSTANCES','DICOM_METADATA','DICOM_INSTANCE','DICOM_FRAME','WADO'].includes(x.type));
  if(s?.detector==='VRPACS')return req.some(x=>x.type==='VRPACS_MANIFEST');
  if(s?.detector==='VRAD')return req.some(x=>x.type==='VRAD_MANIFEST');
  return false;
}
function clearStudyUI(){inventory=null;show('studyCard',false);show('seriesCard',false);$('seriesList').textContent='';$('downloadBtn').disabled=true;}
function setWaiting(on,title='Đang chờ PACS…',text='Đang tìm viewer thật và manifest DICOM.'){
  show('waitingCard',on);$('waitingTitle').textContent=title;$('waitingText').textContent=text;
}

function renderSummary(){
  if(!summary)return;
  chip($('detectorChip'),summary.detector||'UNKNOWN',detectorKind(summary.detector));
  $('endpointCount').textContent=`${summary.requests?.length||0} endpoint`;
  $('pageTitle').textContent=summary.title||'Trang PACS hiện tại';
  $('currentUrl').textContent=summary.currentUrl||'—';
  const recovered=summary.bestViewerUrl&&summary.currentUrl&&summary.bestViewerUrl!==summary.currentUrl;
  show('recoveredBox',recovered);$('recoveredUrl').textContent=recovered?summary.bestViewerUrl:'';
  const frame=(summary.frameUrls||[]).find(u=>u&&u!==summary.currentUrl&&/viewer|vrviewer|pacs|7198|view\?/i.test(u));
  show('frameBox',!!frame);$('frameUrl').textContent=frame||'';
}

async function scan({silent=false}={}){
  const tab=await currentTab(); if(!tab?.id)return null;
  const oldTabId=activeTab?.id, oldScope=summary?.scopeKey||'';
  activeTab=tab;
  if(oldTabId!=null&&oldTabId!==tab.id)clearStudyUI();
  if(!silent)chip($('detectorChip'),'Đang quét…','neutral');
  const r=await send('SCAN_TAB',{tabId:tab.id}); const next=r.summary;
  if(oldScope&&next.scopeKey&&oldScope!==next.scopeKey)clearStudyUI();
  summary=next;renderSummary();
  const inv=await send('GET_INVENTORY',{tabId:tab.id});
  if(inv.inventory && (!next.scopeKey||inv.inventory.summary?.scopeKey===next.scopeKey)){
    inventory=inv.inventory;renderInventory();setWaiting(false);
  }else if(!inventory || inventory?.tabId!==tab.id){clearStudyUI();}
  await refreshJob();
  return next;
}

async function performAnalyze({silent=false}={}){
  if(!activeTab?.id||analyzeBusy)return null;
  analyzeBusy=true;
  try{
    const r=await send('ANALYZE_TAB',{tabId:activeTab.id});
    inventory=r.inventory;renderInventory();setWaiting(false);await refreshHistory();
    if(!silent)toast(`Đã nhận diện ${inventory.adapter}: ${inventory.series.length} series.`,'good');
    return inventory;
  }finally{analyzeBusy=false;}
}

function pageStillLoading(s){
  const states=s?.frameReadyStates||[];
  return states.some(x=>x?.readyState && x.readyState!=='complete');
}
function isSlowPortal(s){
  return Boolean(s?.slowPortal || s?.viewerShell==='TOKEN_PORTAL' || /pportal\.|[?&]token=/i.test(s?.currentUrl||''));
}

async function waitForDetector(tabId,{hardTimeoutMs=30000,softTimeoutMs=18000,idleGraceMs=12000,label='Đang bắt manifest…'}={}){
  const start=Date.now(); let last=null, lastActivity=Date.now(), prevActivity=-1;
  while(Date.now()-start<hardTimeoutMs){
    if(!activeTab||activeTab.id!==tabId)throw new Error('Bạn đã chuyển sang tab khác.');
    last=await scan({silent:true});
    const activity=Number(last?.activityCount||0);
    if(activity!==prevActivity){prevActivity=activity;lastActivity=Date.now();}
    const elapsed=Math.floor((Date.now()-start)/1000);
    const n=last?.requests?.length||0;
    const loading=pageStillLoading(last);
    const slow=isSlowPortal(last);
    setWaiting(true,label,
      `${last?.viewerShell?'Đã thấy portal/viewer. ':''}${loading?'Trang vẫn đang tải. ':''}`+
      `Đã ghi nhận ${n} endpoint PACS · ${activity} resource · ${elapsed}s.`
    );
    if(detectorReady(last))return last;
    // Portal chậm: không cắt chỉ vì soft timeout nếu trang còn tải hoặc network còn hoạt động.
    if(!slow && Date.now()-start>=softTimeoutMs && !loading && Date.now()-lastActivity>=idleGraceMs)return last;
    if(slow && Date.now()-start>=softTimeoutMs && !loading && Date.now()-lastActivity>=Math.max(idleGraceMs,20000))return last;
    await new Promise(r=>setTimeout(r,700));
  }
  return last;
}

async function analyze(){
  if(analyzeBusy)return;
  const tab=await currentTab();if(!tab?.id)return;activeTab=tab;
  $('analyzeBtn').disabled=true;$('analyzeBtn').textContent='Đang phân tích…';
  clearStudyUI();setWaiting(true,'Đang phân tích…','Theo dõi wrapper, iframe và network của study hiện tại.');
  try{
    let s=await scan({silent:true});
    if(detectorReady(s)){
      try{await performAnalyze();return;}catch(e){/* tiếp tục theo dõi trước khi cân nhắc reload */}
    }

    // Với portal token/UI tải chậm, TUYỆT ĐỐI không reload ngay: reload có thể
    // làm restart bootstrap hoặc làm token một-lần bị mất. Chờ thụ động trước.
    const slow=isSlowPortal(s);
    s=await waitForDetector(tab.id, slow
      ? {hardTimeoutMs:180000,softTimeoutMs:60000,idleGraceMs:25000,label:'Portal đang khởi tạo viewer…'}
      : {hardTimeoutMs:35000,softTimeoutMs:18000,idleGraceMs:12000,label:'Đang bắt manifest…'}
    );
    if(detectorReady(s)){await performAnalyze();return;}

    if(slow){
      const diag=(s?.diagnosticUrls||[]).slice(-5);
      const extra=diag.length?` Các API gần nhất: ${diag.map(x=>{try{return new URL(x).pathname}catch{return x}}).join(', ')}`:'';
      throw new Error(`Portal đã ngừng tải nhưng chưa phát endpoint DICOM/manifest mà extension nhận diện.${extra}`);
    }

    // Viewer thường: nếu manifest chạy trước khi panel mở, reload đúng một lần để bắt lại.
    await send('RESET_CAPTURE',{tabId:tab.id});
    setWaiting(true,'Đang tải lại viewer một lần…','Extension sẽ bắt network từ lúc wrapper/iframe khởi tạo.');
    await chrome.tabs.reload(tab.id,{bypassCache:true});
    s=await waitForDetector(tab.id,{hardTimeoutMs:60000,softTimeoutMs:25000,idleGraceMs:15000,label:'Đang bắt manifest sau reload…'});
    if(!detectorReady(s)){
      const frame=(s?.frameUrls||[]).find(u=>u&&u!==s.currentUrl)||s?.bestViewerUrl||'';
      throw new Error(frame
        ? `Đã thấy viewer thật (${frame}) nhưng chưa thấy manifest/DICOM endpoint.`
        : 'Không tìm thấy iframe viewer hoặc manifest/DICOM endpoint.');
    }
    await performAnalyze();
  }catch(e){setWaiting(false);toast(e.message||String(e),'error');}
  finally{$('analyzeBtn').disabled=false;$('analyzeBtn').textContent='Phân tích study hiện tại';}
}

function renderInventory(){
  if(!inventory)return;
  show('studyCard',true);show('seriesCard',true);setWaiting(false);
  chip($('adapterChip'),inventory.adapter||'—','good');
  $('studySub').textContent=inventory.patient?.description||'Study đã nhận diện';
  $('patientName').textContent=inventory.patient?.name||'—';$('patientId').textContent=inventory.patient?.id||'—';
  $('studyDate').textContent=fmtDate(inventory.patient?.studyDate);$('seriesCount').textContent=String(inventory.series?.length||0);
  $('studyUid').textContent=inventory.studyUid?`StudyInstanceUID: ${inventory.studyUid}`:'';
  const list=$('seriesList');list.textContent='';
  (inventory.series||[]).forEach((s,i)=>{
    const row=document.createElement('label');row.className='series-row';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.dataset.id=s.id;cb.addEventListener('change',updateSelected);
    const main=document.createElement('div');main.className='series-main';
    const title=document.createElement('div');title.className='series-title';title.textContent=`${s.number?`${s.number} · `:''}${s.description||'Series'}`;
    const meta=document.createElement('div');meta.className='series-meta';const m1=document.createElement('span');m1.textContent=s.modality||'DICOM';const m2=document.createElement('span');m2.textContent=s.sequenceHint||'';meta.append(m1,m2);main.append(title,meta);
    const count=document.createElement('span');count.className='series-count';count.textContent=s.imageCount?`${s.imageCount} ảnh`:'? ảnh';row.append(cb,main,count);list.append(row);
  });updateSelected();
}
function selectedIds(){return [...$('seriesList').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.dataset.id);}
function updateSelected(){const ids=selectedIds();const total=inventory?.series?.length||0;const images=(inventory?.series||[]).filter(s=>ids.includes(s.id)).reduce((n,s)=>n+(s.imageCount||0),0);$('selectedSummary').textContent=`${ids.length}/${total} series${images?` · ~${images} ảnh`:''}`;$('downloadBtn').disabled=!ids.length;$('downloadBtnText').textContent=ids.length?`Tải DICOM (${ids.length} series)`:'Chọn series để tải';}

async function startDownload(){const ids=selectedIds();if(!ids.length||!activeTab?.id)return;$('downloadBtn').disabled=true;try{const r=await send('START_DOWNLOAD',{tabId:activeTab.id,selectedSeries:ids});renderJob(r.job);toast('Đã bắt đầu tải DICOM.','good');startPolling();}catch(e){toast(e.message||String(e),'error');$('downloadBtn').disabled=false;}}
function jobKind(status){if(status==='done')return'good';if(['error','done_with_errors'].includes(status))return'bad';if(['cancelled','cancelling'].includes(status))return'warn';return'neutral';}
function jobLabel(status){return({preparing:'Chuẩn bị',downloading:'Đang tải',done:'Hoàn tất',done_with_errors:'Có lỗi',error:'Lỗi',cancelling:'Đang dừng',cancelled:'Đã dừng'})[status]||status||'—';}
function renderJob(job){
  if(!job){show('progressCard',false);return;}
  // Do not let a completed job from another tab masquerade as current study state.
  if(activeTab?.id&&job.tabId!==activeTab.id&&TERMINAL.has(job.status)){show('progressCard',false);return;}
  show('progressCard',true);chip($('jobBadge'),jobLabel(job.status),jobKind(job.status));$('jobMeta').textContent=`${job.adapter||''}${job.studyUid?` · ${job.studyUid}`:''}`;
  const total=job.total||0,complete=job.completed||0,failed=job.failed||0,done=complete+failed,pct=total?Math.min(100,Math.round(done*100/total)):0;
  $('progressBar').style.width=`${pct}%`;$('progressText').textContent=`${done} / ${total||'?'}`;$('failedText').textContent=`${failed} lỗi`;$('currentFile').textContent=job.currentFile||'';
  $('jobTitle').textContent=job.status==='done'?'Tải DICOM hoàn tất':job.status==='done_with_errors'?'Hoàn tất nhưng có lỗi':'Đang tải DICOM';$('cancelBtn').disabled=!['preparing','downloading','cancelling'].includes(job.status);
  const errs=job.errors||[];show('errorDetails',!!errs.length);$('errorLog').textContent=errs.join('\n');if(TERMINAL.has(job.status)){$('downloadBtn').disabled=false;stopPolling();refreshHistory().catch(()=>{});}
}
async function refreshJob(){try{const r=await send('GET_JOB');renderJob(r.job);}catch{}}
function startPolling(){if(pollTimer)return;pollTimer=setInterval(refreshJob,700);}function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}

function historyStatusClass(s){if(s==='done')return'done';if(['error','done_with_errors'].includes(s))return'bad';return'viewed';}
function historyStatusText(s){return({done:'Đã tải',done_with_errors:'Tải có lỗi',error:'Lỗi tải',cancelled:'Đã dừng',viewed:'Đã xem'})[s]||'Đã xem';}
async function refreshHistory(){
  const r=await send('GET_HISTORY');const list=r.history||[],el=$('historyList');el.textContent='';
  if(!list.length){const d=document.createElement('div');d.className='empty';d.textContent='Chưa có lịch sử.';el.append(d);return;}
  for(const h of list.slice(0,30)){
    const item=document.createElement('div');item.className='history-item';const top=document.createElement('div');top.className='history-top';
    const left=document.createElement('div');const name=document.createElement('div');name.className='history-name';name.textContent=`${h.patientName||'Unknown'}${h.patientId?` · ${h.patientId}`:''}`;
    const meta=document.createElement('div');meta.className='history-meta';meta.textContent=`${fmtDate(h.studyDate)} · ${h.seriesCount||0} series${h.lastDownloadAt?` · ${fmtWhen(h.lastDownloadAt)}`:h.analyzedAt?` · ${fmtWhen(h.analyzedAt)}`:''}`;left.append(name,meta);
    const st=document.createElement('span');st.className=`history-status ${historyStatusClass(h.status)}`;st.textContent=historyStatusText(h.status);top.append(left,st);item.append(top);el.append(item);
  }
}

function scheduleAutoAnalyze(){
  clearTimeout(autoAnalyzeTimer);autoAnalyzeTimer=setTimeout(async()=>{
    if(analyzeBusy||inventory)return;
    try{const s=await scan({silent:true});if(detectorReady(s))await performAnalyze({silent:true});}catch{}
  },250);
}

$('rescanBtn').addEventListener('click',async()=>{clearStudyUI();try{await scan();scheduleAutoAnalyze();}catch(e){toast(e.message,'error');}});
$('analyzeBtn').addEventListener('click',analyze);
$('selectAllBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=true);updateSelected();});
$('selectNoneBtn').addEventListener('click',()=>{$('seriesList').querySelectorAll('input').forEach(x=>x.checked=false);updateSelected();});
$('downloadBtn').addEventListener('click',startDownload);
$('openFolderBtn').addEventListener('click',()=>send('OPEN_DOWNLOADS_FOLDER').catch(()=>{}));
$('cancelBtn').addEventListener('click',async()=>{try{await send('CANCEL_JOB');toast('Đang dừng các download đang chạy.');startPolling();}catch(e){toast(e.message,'error');}});
$('clearHistoryBtn').addEventListener('click',async()=>{try{await send('CLEAR_HISTORY');await refreshHistory();}catch(e){toast(e.message,'error');}});

chrome.runtime.onMessage.addListener(m=>{
  if(m?.type==='JOB_UPDATED')renderJob(m.job);
  if(m?.type==='HISTORY_UPDATED')refreshHistory().catch(()=>{});
  if(m?.type==='TAB_CONTEXT_CHANGED'&&m.tabId===activeTab?.id){clearStudyUI();setWaiting(true,'Đang chuyển study…','Study cũ đã được bỏ khỏi UI. Đang theo dõi trang mới.');setTimeout(()=>scan({silent:true}).then(scheduleAutoAnalyze).catch(()=>{}),250);}
  if(m?.type==='PACS_SIGNAL'&&m.tabId===activeTab?.id){scheduleAutoAnalyze();}
});
chrome.tabs.onActivated.addListener(()=>{clearStudyUI();summary=null;setTimeout(()=>scan().then(scheduleAutoAnalyze).catch(()=>{}),120);});
chrome.tabs.onUpdated.addListener((tabId,info)=>{
  if(tabId!==activeTab?.id)return;
  if(info.status==='loading'||info.url){clearStudyUI();setWaiting(true,'Đang tải trang mới…','Study cũ đã được xóa khỏi giao diện.');}
  if(info.status==='complete')setTimeout(()=>scan({silent:true}).then(scheduleAutoAnalyze).catch(()=>{}),300);
});

Promise.all([scan(),refreshHistory()]).then(()=>scheduleAutoAnalyze()).catch(e=>toast(e.message||String(e),'error'));
