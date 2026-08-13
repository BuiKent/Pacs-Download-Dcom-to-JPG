'use strict';

let timer=null;
let lastSignature='';

function scorePage(){
  const url=location.href;
  const title=document.title||'';
  const host=location.hostname||'';
  const path=location.pathname||'';
  let score=0;
  const reasons=[];
  const add=(n,r)=>{score+=n;reasons.push(r)};

  if(/(^|\.)(pportal|portal|ketqua|pacs|ris|radiology|rad)(\.|$)/i.test(host)) add(30,'portal-host');
  if(/hospital|benhvien|hfh|pmr|cdhaviet/i.test(host) && location.port) add(18,'medical-port');
  if(/viewer|vrviewer|sharestudy|pacs|dicom|ohif|cornerstone/i.test(url)) add(28,'viewer-url');
  if(/[?&#](?:token|stoken|study|studyuid|session|share|id)=/i.test(url)) add(18,'viewer-key');
  if(/pacs|dicom|radiolog|chẩn đoán hình ảnh|xem ảnh|hình ảnh|ct scan|mri/i.test(title)) add(18,'viewer-title');

  const hasCornerstone=Boolean(document.querySelector('.cornerstone-canvas,[class*="cornerstone" i],[data-cornerstone-enabled]'));
  const canvases=document.querySelectorAll('canvas').length;
  const frames=document.querySelectorAll('iframe,frame').length;
  if(hasCornerstone)add(55,'cornerstone');
  else if(canvases>=2)add(10,'canvas');
  if(frames)add(Math.min(18,frames*5),'frames');

  let bodyText='';
  try{bodyText=(document.body?.innerText||'').slice(0,24000)}catch{}
  if(/xem\s*(?:hình|ảnh)|hình\s*ảnh|chẩn\s*đoán\s*hình\s*ảnh|pacs|dicom/i.test(bodyText))add(18,'medical-ui');
  if(/\b(?:CT|MRI|MR|PET|X[- ]?RAY)\b/i.test(bodyText) && /kết quả|study|series|xem|ảnh|exam/i.test(bodyText))add(8,'modality-ui');

  const iframeUrls=[];
  for(const f of document.querySelectorAll('iframe[src],frame[src]')){
    try{const u=new URL(f.getAttribute('src')||'',location.href);if(/^https?:$/.test(u.protocol))iframeUrls.push(u.href)}catch{}
  }
  score=Math.max(0,Math.min(100,score));
  return {score,reasons:[...new Set(reasons)].slice(0,8),iframeUrls:[...new Set(iframeUrls)].slice(0,40),url,title,readyState:document.readyState};
}

function report(){
  const hint=scorePage();
  const signature=`${hint.score}|${hint.reasons.join(',')}|${hint.iframeUrls.join('|')}|${hint.url}`;
  if(signature===lastSignature)return;
  lastSignature=signature;
  chrome.runtime.sendMessage({type:'PAGE_HINTS',hint}).catch(()=>{});
}

function schedule(){clearTimeout(timer);timer=setTimeout(report,350)}
report();
const observer=new MutationObserver(schedule);
function attachObserver(){
  const root=document.documentElement;if(!root)return false;
  try{observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','class','style']});return true}catch{return false}
}
if(!attachObserver())document.addEventListener('DOMContentLoaded',()=>{attachObserver();schedule()},{once:true});
else document.addEventListener('DOMContentLoaded',schedule,{once:true});
window.addEventListener('load',schedule,{once:true});
window.addEventListener('hashchange',schedule,true);
window.addEventListener('popstate',schedule,true);
setInterval(report,5000);
