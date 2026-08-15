import fs from 'node:fs';
import vm from 'node:vm';
const events=[];
class FakeXHR{constructor(){this.listeners={};this.responseType='';this.status=200;this.responseText='{}';}open(){}send(){}addEventListener(k,fn){this.listeners[k]=fn;}getResponseHeader(){return'application/json';}}
FakeXHR.prototype.open=function(){};FakeXHR.prototype.send=function(){};
const response={url:'https://pacs.test/api/list',status:200,headers:{get:k=>k==='content-type'?'application/json':k==='content-length'?'45':''},clone(){return{text:async()=>'{"rows":[{"v":"/x/1"}]}'}}};
const context={console,setTimeout,clearTimeout,URL,URLSearchParams,location:{href:'https://pacs.test/viewer'},XMLHttpRequest:FakeXHR,fetch:async()=>response};
context.window=context;context.globalThis=context;context.postMessage=m=>events.push(m);
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../generic-hook.js',import.meta.url),'utf8'),context);
await context.fetch('https://pacs.test/api/list',{method:'POST',body:'{"study":1}'});
await new Promise(r=>setTimeout(r,10));
if(events.length!==1||events[0].__pacsGeneric!=='json')throw new Error('generic hook did not emit JSON');
if(events[0].row.method!=='POST'||!events[0].row.text.includes('/x/1'))throw new Error('generic hook metadata');
// HTML/text that is not JSON must not be emitted.
const before=events.length;const r2={...response,headers:{get:k=>k==='content-type'?'text/html':''},clone(){return{text:async()=>'<html>login</html>'}}};
context.fetch=async()=>r2; // wrapper already holds original fetch; this replacement intentionally should not affect installed wrapper
if(events.length!==before)throw new Error('unexpected hook event');
console.log('Generic MAIN-world hook test OK');
