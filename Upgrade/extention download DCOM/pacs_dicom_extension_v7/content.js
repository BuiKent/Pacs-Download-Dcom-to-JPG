(()=>{
  if(globalThis.__PACS_DICOM_V7_CONTENT__)return;
  globalThis.__PACS_DICOM_V7_CONTENT__=true;
  let timer=null,last='';
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
    // Detect GE Centricity Universal Viewer (ZFP) to load WebSocket hook,
    // as it does not fetch image frames over HTTP.
    const zfpViewer=/\/ZFP(\/|\?|#|$)/i.test(url)||/Universal Viewer|Zero Footprint/i.test(title);
    if(zfpViewer)add(40,'ge-zfp');
    return{score:Math.min(100,Math.max(0,score)),reasons:[...new Set(reasons)].slice(0,8),iframeUrls:[...new Set(iframeUrls)].slice(0,60),url,title,readyState:document.readyState,zfpViewer};
  }
  function report(){const h=scorePage(),sig=`${h.score}|${h.reasons.join(',')}|${h.iframeUrls.join('|')}|${h.url}`;if(sig===last)return;last=sig;chrome.runtime.sendMessage({type:'PAGE_HINTS',hint:h}).catch(()=>{});}


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
  const ZFP_KINDS={ZFP_INFO:'info',ZFP_TAKE:'take',ZFP_STATS:'stats'};
  chrome.runtime.onMessage.addListener((m,_s,sendResponse)=>{
    const kind=ZFP_KINDS[m?.type];if(!kind)return false;
    zfpAsk(kind,m.args,m.timeoutMs).then(sendResponse);
    return true;
  });
  function schedule(){clearTimeout(timer);timer=setTimeout(report,300);}
  const start=()=>{try{new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','class']});}catch{}schedule();};
  if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  window.addEventListener('load',schedule,{once:true});window.addEventListener('hashchange',schedule,true);window.addEventListener('popstate',schedule,true);setInterval(report,5000);
})();
