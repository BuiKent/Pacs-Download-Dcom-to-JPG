'use strict';
const $=id=>document.getElementById(id),show=(id,on)=>$(id).classList.toggle('hidden',!on);const TERMINAL=new Set(['done','partial','done_with_errors','error','cancelled']);
let tabId=null,summary=null,state=null,inventory=null,job=null,history=[],revealDownloaded=false,refreshTimer=null,activeTabUrl='',isStartingDownload=false;
function setTopLoader(on){const e=$('topLoader');if(e)e.classList.toggle('active',Boolean(on));}
const FS_DB='pacs_dicom_fs_v1',FS_STORE='handles',FS_KEY='download-root',SAVE_MODE_KEY='pacs6_save_mode';

async function send(type,payload={}){const r=await chrome.runtime.sendMessage({type,...payload});if(!r?.ok)throw new Error(r?.error||'Lỗi extension');return r;}
function toast(text,bad=false){const e=$('toast');e.textContent=text;e.classList.toggle('error',bad);e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2600);}
function fmtName(x){return String(x||'').replace(/\^+/g,' ').replace(/\s+/g,' ').trim();}
function fmtDate(x){const d=String(x||'').replace(/[^0-9]/g,'');return d.length>=8?`${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`:(x||'—');}
function fmtWhen(x){if(!x)return'';return new Date(x).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function chip(el,text,kind='neutral'){el.textContent=text;el.className=`chip ${kind}`;}
function patternFor(url){try{const u=new URL(url);return`${u.protocol}//${u.host}/*`;}catch{return'';}}

function openFsDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(FS_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(FS_STORE))r.result.createObjectStore(FS_STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function fsGet(){const db=await openFsDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readonly'),r=tx.objectStore(FS_STORE).get(FS_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function fsSet(h){const db=await openFsDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(FS_STORE,'readwrite');tx.objectStore(FS_STORE).put(h,FS_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function ensureFolder(interactive=false){let h=await fsGet();if(!h&&interactive){h=await window.showDirectoryPicker({id:'pacs-dicom',startIn:'downloads',mode:'readwrite'});await fsSet(h);await chrome.storage.local.set({[SAVE_MODE_KEY]:'filesystem'});}if(!h)return null;let p=typeof h.queryPermission==='function'?await h.queryPermission({mode:'readwrite'}):'granted';if(p!=='granted'&&interactive&&typeof h.requestPermission==='function')p=await h.requestPermission({mode:'readwrite'});if(p!=='granted')return null;return h;}
// Chỗ này phải nói ĐÚNG nơi file sẽ rơi vào. Trước đây chưa chọn gì cũng hiện
// "Downloads / PACS_DICOM" nên trông như đã cấu hình xong, trong khi bấm Tải lại
// bật hộp thoại chọn thư mục — nhìn một đằng chạy một nẻo.
async function renderFolder(){
  try{
    const pref=(await chrome.storage.local.get(SAVE_MODE_KEY))[SAVE_MODE_KEY]||'',h=await ensureFolder(false);
    const useFs=Boolean(h&&pref==='filesystem');
    $('folderText').textContent=useFs?`${h.name} / PACS_DICOM`
      :pref==='downloads'?'Downloads / PACS_DICOM':'Downloads / PACS_DICOM (mặc định)';
    show('folderResetBtn',useFs);   // chọn thư mục riêng rồi vẫn quay về được
  }catch{$('folderText').textContent='Downloads / PACS_DICOM (mặc định)';show('folderResetBtn',false);}
}

async function grantAccess(){let pats=[...(summary?.missingOrigins||[])];if(!pats.length){const p=patternFor(activeTabUrl);if(p)pats=[p];}if(!pats.length)return;const ok=await chrome.permissions.request({origins:pats});if(!ok)return toast('Chưa cấp quyền site.',true);await send('SITE_ACCESS_CHANGED',{tabId});toast('Đã cấp quyền.');await refresh();}

function compactCandidate(row){const ct=String(row.contentType||'').split(';')[0],bits=[row.method||'GET'];if(row.status)bits.push(String(row.status));if(ct)bits.push(ct.replace('application/',''));return bits.join(' · ');}
function renderLearning(){const active=Boolean(state?.learning?.active),rows=[...(state?.learnCandidates||[])].reverse();show('learnCard',!inventory&&state?.tracking==='watching');if($('learnCard').classList.contains('hidden'))return;$('learnToggleBtn').textContent=active?'Dừng học':'Bắt đầu học';$('learnText').textContent=active?`${rows.length} request đã ghi. Thao tác Xem ảnh rồi chọn request phù hợp.`:'Bật khi site chưa được hỗ trợ.';const el=$('learnList');el.textContent='';if(!active&&!rows.length){el.innerHTML='<div class="empty">Chưa có request học site.</div>';return;}for(const row of rows.slice(0,24)){const item=document.createElement('div');item.className='learn-item';const info=document.createElement('div');info.className='learn-info';const name=document.createElement('div');name.className='learn-name';name.textContent=row.display||row.url||'Request';const meta=document.createElement('div');meta.className='learn-meta';meta.textContent=compactCandidate(row);info.append(name,meta);const acts=document.createElement('div');acts.className='learn-actions';const dicom=document.createElement('button');dicom.textContent='DICOM';dicom.title='Đánh dấu endpoint trả DICOM';dicom.addEventListener('click',()=>learnCandidate(row,'dicom'));const manifest=document.createElement('button');manifest.textContent='Danh sách';manifest.title='Đánh dấu JSON chứa danh sách/URL ảnh';manifest.addEventListener('click',()=>learnCandidate(row,'manifest'));acts.append(dicom,manifest);item.append(info,acts);el.append(item);}}
async function learnCandidate(row,role){try{const r=await send('LEARN_CANDIDATE',{tabId,url:row.url,role});if(role==='dicom')toast('Đã học endpoint DICOM.');else toast(r.result?.valid?`Đã học danh sách · ${r.result.valid} DICOM`:'Đã lưu mẫu danh sách.');await refresh();}catch(e){toast(e.message||String(e),true);}}
function renderStatus(){const conf=Number(summary?.confidence||state?.confidence||0),ready=Boolean(inventory?.series?.length),missing=summary?.missingOrigins||[];$('scoreText').textContent=conf?`${conf}%`:'';if(ready){$('statusTitle').textContent='Sẵn sàng';$('statusText').textContent=`${inventory.adapter} · ${inventory.series.length} series`;chip($('siteChip'),'PACS','good');}else if(state?.tracking==='watching'){$('statusTitle').textContent='Đang theo dõi';$('statusText').textContent='Chờ manifest hoặc DICOM từ viewer';chip($('siteChip'),'Theo dõi','warn');}else if(state?.tracking==='candidate'||conf>=55){$('statusTitle').textContent='Có thể là PACS';$('statusText').textContent=missing.length?'Cấp quyền site để phân tích':'Bấm Theo dõi tab';chip($('siteChip'),'PACS?','warn');}else if(state?.tracking==='stopped'){$('statusTitle').textContent='Đã dừng';$('statusText').textContent='Tab này không được theo dõi';chip($('siteChip'),'Dừng','neutral');}else{$('statusTitle').textContent='Không phát hiện PACS';$('statusText').textContent='Có thể bật theo dõi thủ công cho tab này';chip($('siteChip'),'Tab thường','neutral');}show('permissionBox',missing.length>0);$('permissionText').textContent=missing.length>1?`Cần quyền ${missing.length} site`:'Cần quyền truy cập site';$('trackBtn').textContent=state?.tracking==='watching'?'Dừng theo dõi':'Theo dõi tab';show('deepScanBtn',!ready&&state?.tracking==='watching'&&!missing.length&&Boolean(state?.binaryCandidates?.length));}

// Ket qua cua lan tai truoc, kem nhan hien thi. Truoc day chi coi 'done' la
// "da tai", nen tai xong ma thieu anh hoac co loi thi panel van hien y nhu chua
// tai gi - khong phan biet duoc da luu / tai loi.
const RESULT_LABELS={done:'Đã tải xong',partial:'Đã lưu (chưa đủ ảnh)',done_with_errors:'Đã tải, có lỗi',error:'Tải lỗi',cancelled:'Đã dừng giữa chừng'};
const RESULT_KINDS={done:'good',partial:'warn',done_with_errors:'bad',error:'bad',cancelled:'warn'};
// Link viewer THAT - tuc URL truoc khi bi rut gon/boc qua wrapper. Day la thu
// can copy de dan sang app hoac gui cho nguoi khac, nen giu nguyen ban day du
// (chi cat bang CSS) thay vi cat chuoi.
function renderLink(){
  const real=summary?.bestViewerUrl||summary?.currentUrl||activeTabUrl||'';
  show('linkCard',Boolean(real));
  if(!real)return;
  $('viewerUrl').textContent=real;
  $('viewerUrl').title=real;
  $('linkNote').textContent=(summary?.currentUrl&&real!==summary.currentUrl)?'Viewer thật — khác link trên thanh địa chỉ':'Link trang hiện tại';
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
    chip($('doneBadge'),`${result.completed||0}/${result.total||'?'} ảnh`,RESULT_KINDS[result.status]||'neutral');
    $('doneMeta').textContent=[fmtName(inventory.patient?.name)||'Study',inventory.patient?.id,fmtDate(inventory.patient?.studyDate),fmtWhen(result.lastDownloadAt)].filter(Boolean).join(' · ');
    return;
  }
  show('doneCard',false);show('studyCard',true);show('seriesCard',true);show('stickyBar',true);fillStudyCard();
  const prev=inventory.previousDownload;
  show('partialBanner',Boolean(prev&&prev.status!=='done'&&prev.lastDownloadAt));
  if(prev&&prev.status!=='done'&&prev.lastDownloadAt)$('partialBanner').textContent=`Lần trước: ${prev.completed||0}/${prev.total||'?'} ảnh · tải lại sẽ bỏ qua file đã có.`;
  show('adapterNote',inventory.adapter==='ZFP');
  if(inventory.adapter==='ZFP')$('adapterNote').textContent='Viewer GE không cho tải ảnh theo yêu cầu. Extension hứng ảnh do chính viewer nạp, nên tab này sẽ tự nạp lại — để yên tab trong lúc tải.';

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
    count.textContent=s.imageCount?`${s.imageCount} ảnh`:'? ảnh';
    row.append(cb,main,count);
    list.append(row);
  }
  updateSelected();
}
function selectedIds(){return[...$('seriesList').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.dataset.id);}
function updateSelected(){
  const ids=selectedIds(),sel=(inventory?.series||[]).filter(s=>ids.includes(s.id)),images=sel.reduce((n,s)=>n+(Number(s.imageCount)||0),0);
  $('selectedSummary').textContent=`${ids.length}/${inventory?.series?.length||0} series${images?` · ~${images} ảnh`:''}`;
  $('stickyTitle').textContent=`${ids.length} series${images?` · ~${images} ảnh`:''}`;
  $('stickySub').textContent='Tên - ID - Ngày / Series';
  const isBusy=isStartingDownload||(job&&['preparing','downloading','cancelling'].includes(job.status));
  if(isBusy){
    $('downloadBtn').disabled=true;
    $('downloadBtn').classList.add('btn-loading');
    $('resumeBtn').disabled=true;
    $('resumeBtn').classList.add('btn-loading');
    return;
  }
  $('downloadBtn').classList.remove('btn-loading');
  $('downloadBtn').disabled=!ids.length;
  $('downloadBtn').textContent=inventory?.previousDownload&&inventory.previousDownload.status!=='done'?'Tải phần thiếu':'Tải DICOM';
  $('resumeBtn').classList.remove('btn-loading');
  $('resumeBtn').disabled=!ids.length;
}

function jobLabel(s){return({preparing:'Chuẩn bị',downloading:'Đang tải',done:'Hoàn tất',partial:'Đã lưu',done_with_errors:'Có lỗi',error:'Lỗi',cancelling:'Đang dừng',cancelled:'Đã dừng'})[s]||s||'—';}
function renderJob(){
  if(!job||Number(job.tabId)!==Number(tabId)){show('progressCard',false);setTopLoader(false);return;}
  show('progressCard',true);
  const total=Number(job.total)||0,done=Number(job.completed||0)+Number(job.failed||0),pct=total?Math.min(100,Math.round(done*100/total)):0;
  $('progressBar').style.width=`${pct}%`;
  $('progressText').textContent=`${done} / ${total||'?'}`;
  $('failedText').textContent=`${job.failed||0} lỗi${job.skipped?` · ${job.skipped} có sẵn`:''}`;
  $('currentFile').textContent=job.currentFile||'';
  $('jobTitle').textContent=job.status==='partial'?'Đã lưu dữ liệu bắt được':job.status==='done'?'Tải hoàn tất':job.status==='done_with_errors'?'Hoàn tất có lỗi':job.status==='cancelled'?'Đã dừng tải':'Đang tải DICOM';
  $('jobMeta').textContent=`${job.adapter||'DICOM'}${job.original||job.reconstructed?` · ${job.original||0} gốc${job.reconstructed?` · ${job.reconstructed} dựng lại`:''}`:''}`;
  const kind=job.status==='done'?'good':['error','done_with_errors'].includes(job.status)?'bad':['partial','cancelled'].includes(job.status)?'warn':'neutral';
  chip($('jobBadge'),jobLabel(job.status),kind);
  const isBusy=['preparing','downloading','cancelling'].includes(job.status);
  setTopLoader(isBusy);
  if(isBusy){
    show('cancelBtn',true);
    show('resumeBtn',false);
    show('jobNote',false);
    $('cancelBtn').disabled=(job.status==='cancelling');
    $('cancelBtn').textContent=(job.status==='cancelling'?'Đang dừng...':'Dừng tải');
    $('downloadBtn').disabled=true;
    $('downloadBtn').classList.add('btn-loading');
    $('downloadBtn').innerHTML=`<span class="spinner"></span> ${jobLabel(job.status)}...`;
  }else{
    $('cancelBtn').textContent='Dừng tải';
    if(['cancelled','done_with_errors','error','partial'].includes(job.status)){
      show('cancelBtn',false);
      show('resumeBtn',true);
      show('jobNote',true);
      const remaining=Math.max(0,total-Number(job.completed||0));
      $('resumeBtn').innerHTML=remaining?`🔄 Tải tiếp (${remaining} ảnh)`:'🔄 Tải lại';
      $('jobNote').textContent=job.status==='cancelled'
        ?`Đã dừng tải. Đã lưu an toàn ${job.completed||0}/${total||'?'} ảnh. Bấm 'Tải tiếp' để hoàn tất phần còn lại.`
        :job.status==='done_with_errors'
        ?`Đã lưu ${job.completed||0}/${total||'?'} ảnh (${job.failed||0} lỗi). Bấm 'Tải tiếp' để thử lại file lỗi.`
        :job.status==='error'
        ?`Gặp sự cố khi tải. Bấm 'Tải tiếp' để thử kết nối lại.`
        :job.status==='partial'
        ?`Đã lưu ${job.completed||0}/${total||'?'} ảnh. Bấm 'Tải tiếp' để tải phần còn thiếu.`
        :`Chưa hoàn tất (${job.completed||0}/${total||'?'}). Bấm 'Tải tiếp' để hoàn thành.`;
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

function historyStatus(s){return({done:'Đã tải',partial:'Đã lưu',done_with_errors:'Có lỗi',error:'Tải lỗi',cancelled:'Đã dừng',viewed:'Đã xem'})[s]||'Đã xem';}
function historyKind(s){return s==='done'?'done':['error','done_with_errors'].includes(s)?'bad':['partial','cancelled'].includes(s)?'warn':'';}
// "Đã lưu" chi co nghia khi biet luu duoc bao nhieu tren tong bao nhieu.
function historyCounts(h){const done=Number(h.completed||0),total=Number(h.total||0);if(!total&&!done)return'';const failed=Number(h.failed||0);return`${done}/${total||'?'} ảnh${failed?` · ${failed} lỗi`:''}`;}
function renderHistory(){const q=$('historySearch').value.trim().toLowerCase(),el=$('historyList');el.textContent='';const rows=history.filter(h=>!q||`${h.patientName||''} ${h.patientId||''} ${h.studyDate||''} ${h.description||''}`.toLowerCase().includes(q));if(!rows.length){el.innerHTML='<div class="empty">Chưa có kết quả.</div>';return;}for(const h of rows.slice(0,70)){const item=document.createElement('div');item.className='history-item';const top=document.createElement('div');top.className='history-top';const left=document.createElement('div'),name=document.createElement('div');name.className='history-name';name.textContent=`${fmtName(h.patientName)||'Unknown'}${h.patientId?` · ${h.patientId}`:''}`;const meta=document.createElement('div');meta.className='history-meta';meta.textContent=[fmtDate(h.studyDate),h.seriesCount?`${h.seriesCount} series`:'',historyCounts(h),h.lastDownloadAt?fmtWhen(h.lastDownloadAt):''].filter(Boolean).join(' · ');left.append(name,meta);const st=document.createElement('span');st.className=`history-status ${historyKind(h.status)}`;st.textContent=historyStatus(h.status);top.append(left,st);item.append(top);el.append(item);}}
async function refreshHistory(){try{history=(await send('GET_HISTORY')).history||[];renderHistory();}catch{}}

async function refresh(){if(tabId==null)return;try{const r=await send('GET_OVERVIEW',{tabId});summary=r.summary;state=r.state;inventory=r.inventory;job=r.job;renderStatus();renderLink();renderInventory();renderJob();renderLearning();}catch(e){$('statusText').textContent=e.message||String(e);}await renderFolder();}
async function bindActive(){const urlTab=new URLSearchParams(location.search).get('tabId');let t=urlTab?await chrome.tabs.get(Number(urlTab)).catch(()=>null):null;if(!t)t=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!t?.id)return;tabId=t.id;activeTabUrl=t.url||'';$('tabLabel').textContent=t.title||t.url||`Tab ${tabId}`;revealDownloaded=false;await refresh();}
function scheduleRefresh(ms=180){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(()=>{}),ms);}

/**
 * Bấm Tải là tải, KHÔNG bao giờ mở hộp thoại chọn thư mục.
 *
 * Luồng cũ không nhất quán: lần đầu bấm Tải thì hiện Explorer dù ô "Thư mục lưu"
 * đã ghi sẵn một đích; hủy hộp thoại thì nó vừa tải luôn vừa âm thầm ghi đè lựa
 * chọn thành 'downloads', nên từ lần sau lại không hỏi nữa. Giờ mặc định là
 * Downloads như v2/v2.1; muốn thư mục riêng thì bấm "Đổi" — chọn ở đó, một lần.
 */
async function startDownload(){
  if(isStartingDownload)return;
  if(job&&['preparing','downloading','cancelling'].includes(job.status))return;
  if(!selectedIds().length)return;
  isStartingDownload=true;
  $('downloadBtn').disabled=true;
  $('downloadBtn').classList.add('btn-loading');
  $('downloadBtn').innerHTML='<span class="spinner"></span> Đang chuẩn bị...';
  $('resumeBtn').disabled=true;
  $('resumeBtn').classList.add('btn-loading');
  $('resumeBtn').innerHTML='<span class="spinner"></span> Đang kết nối lại...';
  setTopLoader(true);
  show('jobNote',true);
  $('jobNote').textContent='Đang chuẩn bị dữ liệu và kết nối lại PACS...';
  try{
    const pref=(await chrome.storage.local.get(SAVE_MODE_KEY))[SAVE_MODE_KEY]||'';
    let saveMode='downloads';
    // Chỉ khi người dùng ĐÃ tự chọn thư mục mới đi đường File System Access.
    // Handle khôi phục từ IndexedDB có thể cần xin lại quyền ghi, và cú bấm Tải
    // chính là user gesture để hỏi — hỏi quyền chứ không mở lại Explorer.
    if(pref==='filesystem'&&await fsGet()){
      const h=await ensureFolder(true).catch(()=>null);
      if(h)saveMode='filesystem';
      // Từ chối quyền thì lần này lưu tạm vào Downloads, KHÔNG đổi luôn lựa chọn
      // của người dùng — để lần sau vẫn hỏi lại đúng thư mục họ đã chọn.
      else toast('Chưa có quyền ghi thư mục đã chọn — lần này lưu vào Downloads.');
    }
    await renderFolder();
    const r=await send('START_DOWNLOAD',{tabId,selectedSeries:selectedIds(),options:{concurrency:saveMode==='downloads'?3:6,frameConcurrency:6,saveMode}});
    job=r.job;renderJob();
  }catch(e){
    toast(e.message||String(e),true);
    setTopLoader(false);
    isStartingDownload=false;
    show('jobNote',true);
    $('jobNote').textContent=`Không thể kết nối lại: ${e.message||String(e)}`;
    $('resumeBtn').disabled=false;
    $('resumeBtn').classList.remove('btn-loading');
    $('resumeBtn').innerHTML='🔄 Thử lại';
    updateSelected();
  }finally{
    isStartingDownload=false;
  }
}

$('grantBtn').addEventListener('click',async()=>{if($('grantBtn').disabled)return;$('grantBtn').disabled=true;try{await grantAccess();}catch(e){toast(e.message||String(e),true);}finally{$('grantBtn').disabled=false;}});
$('folderBtn').addEventListener('click',async()=>{try{const h=await window.showDirectoryPicker({id:'pacs-dicom',startIn:'downloads',mode:'readwrite'});await fsSet(h);await chrome.storage.local.set({[SAVE_MODE_KEY]:'filesystem'});await renderFolder();toast('Đã chọn thư mục tải nhanh.');}catch(e){if(e?.name!=='AbortError')toast(e.message||String(e),true);}});
$('copyLinkBtn').addEventListener('click',async()=>{const t=$('viewerUrl').textContent||'';if(!t||t==='—')return;try{await navigator.clipboard.writeText(t);toast('Đã chép link viewer.');}catch(e){toast('Không chép được, bôi đen dòng link để copy tay.',true);}});
$('folderResetBtn').addEventListener('click',async()=>{try{await chrome.storage.local.set({[SAVE_MODE_KEY]:'downloads'});await renderFolder();toast('Sẽ lưu vào Downloads / PACS_DICOM.');}catch(e){toast(e.message||String(e),true);}});
$('trackBtn').addEventListener('click',async()=>{if($('trackBtn').disabled)return;$('trackBtn').disabled=true;const old=$('trackBtn').textContent;$('trackBtn').innerHTML='<span class="spinner dark"></span> Đang xử lý...';setTopLoader(true);try{if(state?.tracking==='watching')await send('STOP_TRACKING',{tabId});else{if((summary?.missingOrigins||[]).length)await grantAccess();await send('START_TRACKING',{tabId});}await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('trackBtn').disabled=false;$('trackBtn').textContent=old;setTopLoader(false);}});
$('scanBtn').addEventListener('click',async()=>{if($('scanBtn').disabled)return;$('scanBtn').disabled=true;const old=$('scanBtn').textContent;$('scanBtn').innerHTML='<span class="spinner dark"></span> Đang quét...';setTopLoader(true);try{await send('ANALYZE_TAB',{tabId});await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('scanBtn').disabled=false;$('scanBtn').textContent=old;setTopLoader(false);}});
$('deepScanBtn').addEventListener('click',async()=>{if($('deepScanBtn').disabled)return;$('deepScanBtn').disabled=true;const old=$('deepScanBtn').textContent;$('deepScanBtn').innerHTML='<span class="spinner dark"></span> Đang quét sâu...';setTopLoader(true);try{const r=await send('DEEP_SCAN',{tabId});toast(r.valid?.length?`Đã nhận diện ${r.valid.length} endpoint DICOM.`:'Chưa xác nhận được endpoint DICOM.',!r.valid?.length);await refresh();}catch(e){toast(e.message||String(e),true);}finally{$('deepScanBtn').disabled=false;$('deepScanBtn').textContent=old;setTopLoader(false);}});
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
chrome.tabs.onActivated.addListener(()=>bindActive().catch(()=>{}));chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(id===tabId&&(change.url||change.title||change.status==='complete')){activeTabUrl=tab.url||activeTabUrl;$('tabLabel').textContent=tab.title||tab.url||`Tab ${id}`;scheduleRefresh(150);}});
chrome.runtime.onMessage.addListener(m=>{if(['JOB_UPDATED','INVENTORY_UPDATED','PACS_SIGNAL','TAB_CONTEXT_CHANGED','LEARN_UPDATED'].includes(m?.type)&&Number(m.tabId)!==Number(tabId))return;if(m?.type==='JOB_UPDATED'){job=m.job;renderJob();}else if(m?.type==='INVENTORY_UPDATED'){inventory=m.inventory;renderInventory();scheduleRefresh(80);}else if(['PACS_SIGNAL','TAB_CONTEXT_CHANGED','LEARN_UPDATED'].includes(m?.type))scheduleRefresh(180);else if(m?.type==='HISTORY_UPDATED'){history=m.history||[];if(!$('historyCard').classList.contains('hidden'))renderHistory();}});
bindActive().then(refreshHistory).catch(e=>toast(e.message||String(e),true));
