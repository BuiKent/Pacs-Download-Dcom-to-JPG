'use strict';
import { buildPart10FromFrames, isPart10, parseMultipart, numberOfFrames } from './lib/dicom.js';

const liveUrls = new Set();

function requestHeaders(task, accept='') {
  const h = new Headers();
  for (const [k,v] of Object.entries(task.headers || {})) {
    try { h.set(k,String(v)); } catch {}
  }
  if (accept) h.set('Accept',accept);
  return h;
}

async function fetchBytes(url, task, accept='') {
  const r = await fetch(url, {
    method:'GET', credentials:'include', cache:'no-store', redirect:'follow',
    headers:requestHeaders(task,accept)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} khi tải ${new URL(url).pathname}`);
  return { bytes:new Uint8Array(await r.arrayBuffer()), contentType:r.headers.get('content-type') || '' };
}

async function fetchJson(url, task) {
  const r = await fetch(url, {
    method:'GET', credentials:'include', cache:'no-store', redirect:'follow',
    headers:requestHeaders(task,'application/dicom+json, application/json')
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} khi đọc metadata`);
  return r.json();
}

function dicomFromResponse(bytes, contentType) {
  if (isPart10(bytes)) return bytes;
  const parts=parseMultipart(bytes,contentType);
  for (const p of parts) if (isPart10(p.data)) return p.data;
  return null;
}

async function prepareDicomwebInstance(task) {
  let firstError='';
  try {
    const {bytes,contentType}=await fetchBytes(task.instanceBase,task,'multipart/related; type="application/dicom", application/dicom, */*');
    const dcm=dicomFromResponse(bytes,contentType);
    if (dcm) return dcm;
  } catch (e) { firstError=String(e?.message || e); }

  let meta=task.meta || null;
  if (Array.isArray(meta)) meta=meta[0] || {};
  const enough = meta && meta['00080016'] && meta['00080018'] && meta['00280010'] && meta['00280011'] && meta['00280100'];
  if (!enough) {
    const mj=await fetchJson(`${task.instanceBase}/metadata`,task);
    meta=Array.isArray(mj)?(mj[0]||{}):mj;
  }
  if (!meta || !Object.keys(meta).length) throw new Error(firstError || 'Không có metadata cho instance.');

  const nf=Math.max(Number(task.numberOfFrames)||1,numberOfFrames(meta));
  const frames=[]; let frameCt='';
  for (let i=1;i<=nf;i++) {
    const got=await fetchBytes(`${task.instanceBase}/frames/${i}`,task,'multipart/related; type="application/octet-stream", */*');
    const parts=parseMultipart(got.bytes,got.contentType);
    if (parts.length) {
      frameCt=frameCt || parts[0].contentType || got.contentType;
      for (const p of parts) frames.push(p.data);
    } else {
      frameCt=frameCt || got.contentType;
      frames.push(got.bytes);
    }
  }
  if (!frames.length) throw new Error(firstError || 'Không lấy được frame ảnh.');
  return buildPart10FromFrames(meta,frames,frameCt);
}

async function prepare(task) {
  let bytes;
  if (task.mode==='dicomweb-instance') bytes=await prepareDicomwebInstance(task);
  else if (task.mode==='fetch-dicom') {
    const got=await fetchBytes(task.url,task,'application/dicom, multipart/related; type="application/dicom", */*');
    bytes=dicomFromResponse(got.bytes,got.contentType);
    if (!bytes) throw new Error('Endpoint không trả DICOM Part-10.');
  } else throw new Error(`Chế độ không hỗ trợ: ${task.mode}`);

  const blob=new Blob([bytes],{type:'application/dicom'});
  const blobUrl=URL.createObjectURL(blob); liveUrls.add(blobUrl);
  return { blobUrl, size:blob.size };
}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if (message?.target!=='offscreen') return false;
  if (message.type==='PREPARE_FILE') {
    prepare(message.task).then(result=>sendResponse({ok:true,...result})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
    return true;
  }
  if (message.type==='REVOKE_BLOB') {
    const url=message.url;
    if (liveUrls.has(url)) { URL.revokeObjectURL(url); liveUrls.delete(url); }
    sendResponse({ok:true}); return false;
  }
  if (message.type==='REVOKE_ALL') {
    for (const url of liveUrls) URL.revokeObjectURL(url);
    liveUrls.clear(); sendResponse({ok:true}); return false;
  }
  return false;
});
