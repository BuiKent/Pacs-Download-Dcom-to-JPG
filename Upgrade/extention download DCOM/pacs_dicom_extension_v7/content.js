(()=>{
  if(globalThis.__PACS_DICOM_V7_CONTENT__)return;
  globalThis.__PACS_DICOM_V7_CONTENT__=true;
  let timer=null,last='';
  function extractPatientFromDom(){
    const p={};
    const isMach7=/ClinicalStudio/i.test(location.href)||/Diagnostic\s*Studio|MACH7/i.test(document.title)||Boolean(document.querySelector('#patientBanner, #appCrumbBanner, .m7t-app-container, .m7t-drk-body'));
    if(isMach7)p.isMach7=true;

    // Collect text from specific overlay elements as well as full body
    const overlayEls = document.querySelectorAll(
      '.overlay, .viewport-overlay, [class*="overlay" i], .cornerstone-overlay, [class*="corner" i], .m7t-sub-header, .patient-banner, .patient-info, .patient-header, [id*="patient" i], [id*="viewport" i], [class*="viewport" i], [class*="view-port" i]'
    );
    let overlayText = '';
    for(const el of overlayEls){
      const t = el.innerText?.trim();
      if(t) overlayText += '\n' + t;
    }
    const rawText = (overlayText + '\n' + (document.body?.innerText || '')).slice(0, 100000);

    const nameEl = document.querySelector('#patientBanner .patient-name, #patientBanner .pat-name, .patientName, [id*="patname" i], [class*="patname" i]');
    if(nameEl?.innerText?.trim()) p.patientName = nameEl.innerText.trim();

    const idEl = document.querySelector('#patientBanner .patient-id, #patientBanner .pat-id, .patientId, [id*="patid" i], [id*="mrn" i]');
    if(idEl?.innerText?.trim()) p.patientId = idEl.innerText.trim();

    // 1. Check for standard medical corner overlay pattern:
    // Name
    // <ID> <Sex> <Age> (e.g., "26100659 F 014Y" or "26100659 M 50Y" or "PID: 12345")
    // <Date> <Time> (e.g., "7/2/2026 2:34 PM" or "07/02/2026 14:34")
    const idSexAgeMatch = rawText.match(/(?:^|\n)\s*([^\n\r]{3,60})\s*\n\s*(\d{5,16})\s+([MFmf])\s+(\d{1,3}[YyMmDdTt]|\d{1,3}\s*(?:tuổi|yo|y))\s*\n\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)?)/);
    if(idSexAgeMatch){
      const candName = idSexAgeMatch[1].trim();
      if(!/BENH\s*VIEN|HOSPITAL|STUDIO|VIEWER|MACH7|CLINICAL/i.test(candName) && candName.length >= 3){
        if(!p.patientName) p.patientName = candName;
      }
      if(!p.patientId) p.patientId = idSexAgeMatch[2].trim();
      if(!p.patientAge) p.patientAge = idSexAgeMatch[4].trim();
      if(!p.studyDate) p.studyDate = idSexAgeMatch[5].trim();
    }

    // Secondary search for PID + Sex + Age line
    if(!p.patientId || !p.patientName){
      const lineMatch = rawText.match(/(?:^|\n)\s*(\d{5,16})\s+([MFmf])\s+(\d{1,3}[YyMmDdTt]|\d{1,3}\s*(?:tuổi|yo|y))/);
      if(lineMatch){
        if(!p.patientId) p.patientId = lineMatch[1].trim();
        if(!p.patientAge) p.patientAge = lineMatch[3].trim();
        const idx = rawText.indexOf(lineMatch[0]);
        if(idx > 0){
          const before = rawText.slice(Math.max(0, idx - 150), idx).trim().split('\n');
          const lastLine = before[before.length - 1]?.trim();
          if(lastLine && !/BENH\s*VIEN|HOSPITAL|STUDIO|VIEWER|MACH7|CLINICAL/i.test(lastLine) && lastLine.length >= 3){
            if(!p.patientName) p.patientName = lastLine;
          }
        }
      }
    }

    // Accession / Exam: "Ex: 10742287"
    if(!p.accessionNumber){
      const exMatch = rawText.match(/(?:Ex|Exam|Accession|Số\s*phiếu)\s*[:：#]?\s*(\d{4,16})/i);
      if(exMatch) p.accessionNumber = exMatch[1].trim();
    }

    // Study Description: line following "Ex: ..."
    if(!p.studyDescription){
      const exDescMatch = rawText.match(/(?:Ex|Exam)\s*[:：#]?\s*\d{4,16}\s*\n\s*([^\n\r]{4,80})/i);
      if(exDescMatch){
        const candDesc = exDescMatch[1].trim();
        if(!/^Se\s*:\s*\d+/i.test(candDesc) && !/^Im\s*:\s*\d+/i.test(candDesc)){
          p.studyDescription = candDesc;
        }
      }
    }

    // General fallback regexes for Patient Name
    if(!p.patientName){
      const m=rawText.match(/(?:Họ\s*tên|Tên\s*BN|Bệnh\s*nhân|Patient\s*Name|Pat\.?\s*Name)\s*[:：]\s*([^\n\r\t|/]+)/i);
      if(m&&m[1]?.trim()){
        const cand=m[1].trim();
        if(!/^(Diagnostic|Studio|Clinical|Login|Mach7|Hospital|Viewer)$/i.test(cand))p.patientName=cand;
      }
    }

    // General fallback for Patient ID
    if(!p.patientId){
      const m=rawText.match(/(?:Mã\s*BN|Mã\s*NB|Mã\s*bệnh\s*nhân|PID|Pat\.?\s*ID|Patient\s*ID|MRN)\s*[:：#]?\s*([A-Za-z0-9_-]{3,24})/i);
      if(m&&m[1]?.trim())p.patientId=m[1].trim();
    }

    // General fallback for Study Date
    if(!p.studyDate){
      const m=rawText.match(/(?:Ngày\s*chụp|Ngày\s*khám|Ngày\s*thực\s*hiện|Study\s*Date|Exam\s*Date|Date)\s*[:：]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})/i)
        || rawText.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
      if(m&&m[1]?.trim())p.studyDate=m[1].trim();
    }

    // General fallback for Modality
    if(/Chụp\s*cộng\s*hưởng\s*từ|Cộng\s*hưởng\s*từ|MRI|MR\b/i.test(rawText)) p.modality = 'MR';
    else if(/Cắt\s*lớp\s*vi\s*tính|CLVT|CT\s*Scan|CT\b/i.test(rawText)) p.modality = 'CT';
    else if(/X-Quang|X-Ray|CR\b|DX\b/i.test(rawText)) p.modality = 'DX';

    return p;
  }

  function extractSeriesFromDom(){
    const list = [];
    const seenNumbers = new Set();

    // 1. Search viewports text for Se: X ... Im: Y / Total
    const fullText = document.body?.innerText || '';
    const seMatches = [...fullText.matchAll(/Se\s*:\s*(\d+)(?:[^\n]*\n)*?\s*(?:(?:W\/L:[^\n]*\n\s*)?(\d+)\s*\/\s*(\d+))/gi)];
    for(const m of seMatches){
      const seNum = m[1];
      const count = Number(m[3]) || 0;
      if(!seenNumbers.has(seNum)){
        seenNumbers.add(seNum);
        list.push({
          number: seNum,
          description: `Series ${seNum}`,
          imageCount: count
        });
      }
    }

    // 2. Search thumbnail cards in sidebar
    const thumbEls = document.querySelectorAll('.thumbnail, [class*="thumbnail" i], [class*="series-item" i], [class*="seriesItem" i], [id*="series" i], .m7t-thumbnail');
    if(thumbEls.length > list.length){
      thumbEls.forEach((el, i) => {
        const text = el.innerText || '';
        const numM = text.match(/(?:Se\s*:\s*|Series\s*)(\d+)/i);
        const countM = text.match(/(?:^|\s)(\d+)\s*(?:ảnh|images|ims?|\/)/i);
        const num = numM ? numM[1] : String(i + 1);
        if(!seenNumbers.has(num)){
          seenNumbers.add(num);
          list.push({
            number: num,
            description: `Series ${num}`,
            imageCount: countM ? Number(countM[1]) : 0
          });
        }
      });
    }

    return list;
  }

  async function autoFetchMach7Series(){
    const thumbEls = Array.from(document.querySelectorAll('.thumbnail, [class*="thumbnail" i], [class*="series-item" i], [class*="seriesItem" i], [id*="series" i], .m7t-thumbnail'));
    if(!thumbEls.length) return {ok: false, message: 'No thumbnail elements found.'};
    for(let i=0; i<thumbEls.length; i++){
      const el = thumbEls[i];
      try{
        el.click();
        el.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
      }catch(_){}
      await new Promise(r=>setTimeout(r, 450));
    }
    report();
    return {ok: true, count: thumbEls.length};
  }

  function scorePage(){
    const url=location.href,title=document.title||'',host=location.hostname||'';let score=0;const reasons=[];const add=(n,r)=>{score+=n;reasons.push(r)};
    if(/(^|\.)(pportal|portal|ketqua|pacs|ris|radiology|rad)(\.|$)/i.test(host))add(28,'portal');
    if(/hospital|benhvien|hfh|pmr|cdhaviet|thanhnhan/i.test(host)&&location.port)add(16,'medical-host');
    if(/viewer|vrviewer|sharestudy|pacs|dicom|ohif|cornerstone/i.test(url))add(30,'viewer');
    if(/[?&#](?:token|stoken|study|studyuid|session|share|id)=/i.test(url))add(16,'key');
    if(/pacs|dicom|radiolog|diagnostic\s*imaging|view\s*image|image\s*viewer|chẩn đoán hình ảnh|xem ảnh|ct scan|mri/i.test(title))add(16,'title');
    if(document.querySelector('.cornerstone-canvas,[class*="cornerstone" i],[data-cornerstone-enabled]'))add(55,'cornerstone');
    else if(document.querySelectorAll('canvas').length>=2)add(9,'canvas');
    const iframeUrls=[];for(const f of document.querySelectorAll('iframe[src],frame[src]')){try{const u=new URL(f.getAttribute('src')||'',location.href);if(/^https?:$/.test(u.protocol))iframeUrls.push(u.href);}catch{}}
    if(iframeUrls.length)add(Math.min(18,iframeUrls.length*5),'frames');
    let text='';try{text=(document.body?.innerText||'').slice(0,18000);}catch{}if(/xem\s*(?:hình|ảnh)|chẩn\s*đoán\s*hình\s*ảnh|diagnostic\s*imaging|view\s*image|pacs|dicom/i.test(text))add(14,'medical-ui');
    // Detect GE Centricity Universal Viewer (ZFP)
    const zfpViewer=/\/ZFP(\/|\?|#|$)/i.test(url)||/Universal Viewer|Zero Footprint/i.test(title);
    if(zfpViewer)add(40,'ge-zfp');
    // Detect Mach7 Diagnostic Studio (ClinicalStudio)
    const isMach7=/ClinicalStudio/i.test(url)||/Diagnostic\s*Studio|MACH7/i.test(title)||Boolean(document.querySelector('#patientBanner, #appCrumbBanner, .m7t-app-container, .m7t-drk-body'));
    if(isMach7)add(45,'mach7');
    const domPatient=extractPatientFromDom();
    const domSeries=extractSeriesFromDom();
    return{score:Math.min(100,Math.max(0,score)),reasons:[...new Set(reasons)].slice(0,8),iframeUrls:[...new Set(iframeUrls)].slice(0,60),url,title,readyState:document.readyState,zfpViewer,domPatient,domSeries};
  }
  function report(){const h=scorePage(),sig=`${h.score}|${h.reasons.join(',')}|${h.iframeUrls.join('|')}|${h.url}|${JSON.stringify(h.domPatient||{})}|${JSON.stringify(h.domSeries||[])}`;if(sig===last)return;last=sig;chrome.runtime.sendMessage({type:'PAGE_HINTS',hint:h}).catch(()=>{});}


  // --- Bridge generic MAIN-world JSON observer --------------------------------
  // Only forward small JSON payloads; binary DICOM/pixel data never passes through postMessage.
  window.addEventListener('message',ev=>{
    if(ev.source!==window)return;const m=ev.data;
    if(!m||m.__pacsGeneric!=='json'||!m.row)return;
    chrome.runtime.sendMessage({type:'GENERIC_JSON_CAPTURE',row:m.row}).catch(()=>{});
  });

  // --- Bridge to GE ZFP WebSocket hook (MAIN world) ----------------------------
  // Isolated world and MAIN world communicate via postMessage bridge.
  let zfpSeq=0;const zfpWaiting=new Map();
  window.addEventListener('message',ev=>{
    if(ev.source!==window)return;const m=ev.data;
    if(!m||m.__zfp!=='res'||!zfpWaiting.has(m.id))return;
    const{resolve,timer}=zfpWaiting.get(m.id);zfpWaiting.delete(m.id);clearTimeout(timer);resolve(m.reply);
  });
  function zfpAsk(kind,args,timeoutMs){
    return new Promise(resolve=>{
      const id=`${Date.now()}-${++zfpSeq}`;
      const timer=setTimeout(()=>{zfpWaiting.delete(id);resolve({error:'Page did not respond (ZFP hook not loaded?).'});},timeoutMs||50000);
      zfpWaiting.set(id,{resolve,timer});
      window.postMessage({__zfp:'req',id,kind,args},'*');
    });
  }
  async function scanPageForQr(){
    const found=new Set();
    if(typeof globalThis.BarcodeDetector==='function'){
      try{
        const detector=new globalThis.BarcodeDetector({formats:['qr_code']});
        for(const c of document.querySelectorAll('canvas')){
          if((c.width||0)>20&&(c.height||0)>20){
            try{const r=await detector.detect(c);for(const x of r)if(x.rawValue)found.add(x.rawValue);}catch(_){}
          }
        }
        for(const img of document.querySelectorAll('img')){
          if(img.src&&((img.naturalWidth||img.width||0)>20)){
            try{const r=await detector.detect(img);for(const x of r)if(x.rawValue)found.add(x.rawValue);}catch(_){}
          }
        }
      }catch(_){}
    }
    return Array.from(found);
  }

  const ZFP_KINDS={ZFP_INFO:'info',ZFP_TAKE:'take',ZFP_STATS:'stats'};
  chrome.runtime.onMessage.addListener((m,_s,sendResponse)=>{
    if(m?.type==='SCAN_PAGE_QR'){
      scanPageForQr().then(results=>sendResponse({ok:true,results})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
      return true;
    }
    if(m?.type==='AUTOFETCH_MACH7_SERIES'){
      autoFetchMach7Series().then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
      return true;
    }
    const kind=ZFP_KINDS[m?.type];if(!kind)return false;
    zfpAsk(kind,m.args,m.timeoutMs).then(sendResponse);
    return true;
  });
  function schedule(){clearTimeout(timer);timer=setTimeout(report,300);}
  const start=()=>{try{new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','class']});}catch{}schedule();};
  if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  window.addEventListener('load',schedule,{once:true});window.addEventListener('hashchange',schedule,true);window.addEventListener('popstate',schedule,true);setInterval(report,5000);
})();
