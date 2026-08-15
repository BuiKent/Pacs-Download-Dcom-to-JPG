/**
 * Lightweight MAIN-world JSON observer for PACS discovery.
 * It never copies binary image/DICOM responses. Only small JSON/text responses
 * are cloned, capped, and posted to the isolated content script.
 */
(()=>{
  if(globalThis.__PACS_DICOM_V7_GENERIC_HOOK__)return;
  globalThis.__PACS_DICOM_V7_GENERIC_HOOK__=true;
  const MAX_TEXT=2*1024*1024;
  const sensitive=u=>/\/(?:auth|login|signin|password|otp)(?:\/|\?|$)/i.test(String(u||''));
  const maybeJsonText=t=>{const s=String(t||'').trim();return(s.startsWith('{')&&s.endsWith('}'))||(s.startsWith('[')&&s.endsWith(']'));};
  const cleanBody=b=>{
    if(b==null)return null;
    if(typeof b==='string')return b.length<=256*1024?b:null;
    if(b instanceof URLSearchParams)return b.toString().slice(0,256*1024);
    return null;
  };
  function emit(row){
    try{if(!row?.url||sensitive(row.url))return;window.postMessage({__pacsGeneric:'json',row},'*');}catch{}
  }
  async function inspectFetchResponse(resp,req){
    try{
      const ct=String(resp.headers.get('content-type')||'').toLowerCase();
      const len=Number(resp.headers.get('content-length')||0);
      if(!(ct.includes('json')||ct.includes('javascript')||ct.includes('text/plain')||(!ct&&len>0&&len<=MAX_TEXT)))return;
      if(len>MAX_TEXT)return;
      const text=await resp.clone().text();if(text.length>MAX_TEXT||!maybeJsonText(text))return;
      emit({url:resp.url||req.url,method:req.method,status:resp.status,contentType:ct,requestBody:req.body||null,text});
    }catch{}
  }
  const origFetch=window.fetch;
  if(typeof origFetch==='function'){
    window.fetch=function(input,init){
      let url='',method='GET',body=null;
      try{url=typeof input==='string'?input:(input?.url||'');method=String(init?.method||input?.method||'GET').toUpperCase();body=cleanBody(init?.body);}catch{}
      const p=origFetch.apply(this,arguments);p.then(r=>inspectFetchResponse(r,{url,method,body})).catch(()=>{});return p;
    };
  }
  const XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url){try{this.__pacsV7={method:String(method||'GET').toUpperCase(),url:new URL(String(url),location.href).href};}catch{this.__pacsV7={method:String(method||'GET').toUpperCase(),url:String(url||'')};}return XO.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(body){const self=this,meta=this.__pacsV7||{method:'GET',url:''};meta.body=cleanBody(body);this.addEventListener('load',()=>{try{if(sensitive(meta.url))return;const ct=String(self.getResponseHeader('content-type')||'').toLowerCase();const len=Number(self.getResponseHeader('content-length')||0);if(len>MAX_TEXT)return;let text='';if(self.responseType===''||self.responseType==='text')text=String(self.responseText||'');else if(self.responseType==='json')text=JSON.stringify(self.response);else return;if(text.length>MAX_TEXT||!maybeJsonText(text))return;emit({url:self.responseURL||meta.url,method:meta.method,status:self.status,contentType:ct,requestBody:meta.body||null,text});}catch{}},{once:true});return XS.apply(this,arguments);};
})();
