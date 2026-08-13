'use strict';

const LONG_VR = new Set(['OB','OD','OF','OL','OV','OW','SQ','UC','UR','UT','UN']);
const TEXT_VR = new Set(['AE','AS','CS','DA','DS','DT','IS','LO','LT','PN','SH','ST','TM','UC','UI','UR','UT']);
const encoder = new TextEncoder();

function ascii(s) { return encoder.encode(String(s)); }
function u16(v) { const a=new Uint8Array(2); new DataView(a.buffer).setUint16(0,v,true); return a; }
function i16(v) { const a=new Uint8Array(2); new DataView(a.buffer).setInt16(0,v,true); return a; }
function u32(v) { const a=new Uint8Array(4); new DataView(a.buffer).setUint32(0,v>>>0,true); return a; }
function i32(v) { const a=new Uint8Array(4); new DataView(a.buffer).setInt32(0,v|0,true); return a; }
function f32(v) { const a=new Uint8Array(4); new DataView(a.buffer).setFloat32(0,Number(v),true); return a; }
function f64(v) { const a=new Uint8Array(8); new DataView(a.buffer).setFloat64(0,Number(v),true); return a; }

export function concatBytes(parts) {
  const arrays = parts.filter(Boolean).map(p => p instanceof Uint8Array ? p : new Uint8Array(p));
  const total = arrays.reduce((n,a)=>n+a.byteLength,0);
  const out = new Uint8Array(total); let off=0;
  for (const a of arrays) { out.set(a,off); off+=a.byteLength; }
  return out;
}

function tagBytes(tag) {
  const t = String(tag).replace(/[^0-9A-Fa-f]/g,'').padStart(8,'0');
  return concatBytes([u16(parseInt(t.slice(0,4),16)), u16(parseInt(t.slice(4,8),16))]);
}

function base64ToBytes(s) {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}

function padEven(bytes, pad=0) {
  if (bytes.byteLength % 2 === 0) return bytes;
  const out = new Uint8Array(bytes.byteLength+1); out.set(bytes); out[out.length-1]=pad; return out;
}

function personName(v) {
  if (v && typeof v === 'object') return [v.Alphabetic||'', v.Ideographic||'', v.Phonetic||''].join('=').replace(/=+$/,'');
  return String(v ?? '');
}

function textValue(vr, values) {
  const vals = Array.isArray(values) ? values : (values == null ? [] : [values]);
  const text = vals.map(v => vr === 'PN' ? personName(v) : String(v ?? '')).join('\\');
  return padEven(ascii(text), vr === 'UI' ? 0x00 : 0x20);
}

function binaryValue(vr, values) {
  const vals = Array.isArray(values) ? values : (values == null ? [] : [values]);
  const parts = [];
  for (const v of vals) {
    if (vr === 'US') parts.push(u16(Number(v)||0));
    else if (vr === 'SS') parts.push(i16(Number(v)||0));
    else if (vr === 'UL') parts.push(u32(Number(v)||0));
    else if (vr === 'SL') parts.push(i32(Number(v)||0));
    else if (vr === 'FL') parts.push(f32(v));
    else if (vr === 'FD') parts.push(f64(v));
    else if (vr === 'AT') {
      const t=String(v).replace(/[^0-9A-Fa-f]/g,'').padStart(8,'0');
      parts.push(u16(parseInt(t.slice(0,4),16)),u16(parseInt(t.slice(4,8),16)));
    }
  }
  return concatBytes(parts);
}

function itemElement(datasetBytes) {
  return concatBytes([u16(0xFFFE),u16(0xE000),u32(datasetBytes.byteLength),datasetBytes]);
}

function encodeSequence(values) {
  const parts=[];
  for (const item of (Array.isArray(values)?values:[])) parts.push(itemElement(encodeDataset(item || {})));
  return concatBytes(parts);
}

function encodeElement(tag, element) {
  const vr = String(element?.vr || element?.VR || 'UN').toUpperCase();
  let value;
  if (vr === 'SQ') value = encodeSequence(element?.Value || []);
  else if (element?.InlineBinary) value = padEven(base64ToBytes(element.InlineBinary),0);
  else if (TEXT_VR.has(vr)) value = textValue(vr, element?.Value || []);
  else if (['US','SS','UL','SL','FL','FD','AT'].includes(vr)) value = binaryValue(vr, element?.Value || []);
  else if (element?.Value && Array.isArray(element.Value)) value = textValue('LO',element.Value);
  else return null;

  const head=[tagBytes(tag), ascii(vr.slice(0,2).padEnd(2,' '))];
  if (LONG_VR.has(vr)) head.push(new Uint8Array(2),u32(value.byteLength));
  else head.push(u16(value.byteLength));
  return concatBytes([...head,value]);
}

export function encodeDataset(meta) {
  const tags = Object.keys(meta || {}).filter(t => /^[0-9A-Fa-f]{8}$/.test(t) && !t.startsWith('0002') && t.toUpperCase() !== '7FE00010').sort((a,b)=>parseInt(a,16)-parseInt(b,16));
  const parts=[];
  for (const tag of tags) {
    try { const e=encodeElement(tag,meta[tag]); if (e) parts.push(e); } catch {}
  }
  return concatBytes(parts);
}

function rawElement(tag, vr, value) {
  const val = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  const head=[tagBytes(tag),ascii(vr)];
  if (LONG_VR.has(vr)) head.push(new Uint8Array(2),u32(val.byteLength)); else head.push(u16(val.byteLength));
  return concatBytes([...head,val]);
}

function stringElement(tag, vr, value) { return rawElement(tag,vr,textValue(vr,[value])); }
function numericElement(tag, vr, value) { return rawElement(tag,vr,binaryValue(vr,[value])); }

function generateUid() {
  // 2.25.<decimal UUID-ish 128-bit>; deterministic uniqueness is sufficient here.
  const a = crypto.getRandomValues(new Uint32Array(4));
  let n=0n; for (const x of a) n=(n<<32n)|BigInt(x);
  return `2.25.${n}`;
}

function metaString(meta, tag, fallback='') {
  const v=meta?.[tag]?.Value; return Array.isArray(v)&&v.length ? String(v[0] ?? fallback) : fallback;
}

function fileMeta(meta, transferSyntax) {
  const sopClass = metaString(meta,'00080016','1.2.840.10008.5.1.4.1.1.7');
  const sopInstance = metaString(meta,'00080018',generateUid());
  const implUid = '1.2.826.0.1.3680043.10.543.99.1';
  const parts=[
    rawElement('00020001','OB',new Uint8Array([0,1])),
    stringElement('00020002','UI',sopClass),
    stringElement('00020003','UI',sopInstance),
    stringElement('00020010','UI',transferSyntax),
    stringElement('00020012','UI',implUid),
    stringElement('00020013','SH','PACSDLCM_100')
  ];
  const rest=concatBytes(parts);
  return concatBytes([numericElement('00020000','UL',rest.byteLength),rest]);
}

function pixelDataNative(frames, bitsAllocated) {
  const raw=padEven(concatBytes(frames),0);
  return rawElement('7FE00010',Number(bitsAllocated||16)>8?'OW':'OB',raw);
}

function pixelDataEncapsulated(frames) {
  const head=concatBytes([tagBytes('7FE00010'),ascii('OB'),new Uint8Array(2),u32(0xFFFFFFFF)]);
  const items=[concatBytes([u16(0xFFFE),u16(0xE000),u32(0)])]; // Basic Offset Table rỗng
  for (const frame of frames) {
    const f=padEven(frame,0);
    items.push(concatBytes([u16(0xFFFE),u16(0xE000),u32(f.byteLength),f]));
  }
  const delim=concatBytes([u16(0xFFFE),u16(0xE0DD),u32(0)]);
  return concatBytes([head,...items,delim]);
}

export function transferSyntaxFromContentType(contentType='') {
  const ct=String(contentType).toLowerCase();
  const m=ct.match(/transfer-syntax\s*=\s*"?([0-9.]+)/i); if (m) return m[1];
  if (ct.includes('image/jpeg')) return '1.2.840.10008.1.2.4.50';
  if (ct.includes('image/jls') || ct.includes('image/x-jls')) return '1.2.840.10008.1.2.4.80';
  if (ct.includes('image/jp2') || ct.includes('image/j2c') || ct.includes('image/x-j2c')) return '1.2.840.10008.1.2.4.90';
  if (ct.includes('image/jphc')) return '1.2.840.10008.1.2.4.201';
  return '1.2.840.10008.1.2.1';
}

export function buildPart10FromFrames(meta, frames, frameContentType='') {
  if (!meta || !frames?.length) throw new Error('Thiếu metadata/frames để dựng DICOM.');
  const ts=transferSyntaxFromContentType(frameContentType);
  const compressed = !['1.2.840.10008.1.2','1.2.840.10008.1.2.1'].includes(ts);
  const bits = Number(metaString(meta,'00280100','16')) || 16;
  const preamble=new Uint8Array(132); preamble.set(ascii('DICM'),128);
  const body=encodeDataset(meta);
  const pixel=compressed?pixelDataEncapsulated(frames):pixelDataNative(frames,bits);
  return concatBytes([preamble,fileMeta(meta,ts),body,pixel]);
}

export function isPart10(bytes) {
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);
  return a.byteLength>132 && String.fromCharCode(...a.slice(128,132))==='DICM';
}

export function parseMultipart(bytes, contentType='') {
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);
  let boundary='';
  const m=String(contentType).match(/boundary="?([^";,\s]+)"?/i); if (m) boundary=m[1];
  if (!boundary) {
    const prefix=new TextDecoder('latin1').decode(a.slice(0,Math.min(a.length,300)));
    const first=prefix.match(/^--([^\r\n]+)/); if (first) boundary=first[1].trim();
  }
  if (!boundary) return [];
  const text=new TextDecoder('latin1').decode(a);
  const marker=`--${boundary}`;
  const out=[]; let pos=0;
  while (true) {
    let start=text.indexOf(marker,pos); if (start<0) break;
    start+=marker.length;
    if (text.substr(start,2)==='--') break;
    if (text.substr(start,2)==='\r\n') start+=2;
    const headerEnd=text.indexOf('\r\n\r\n',start); if (headerEnd<0) break;
    const headerText=text.slice(start,headerEnd);
    let payloadStart=headerEnd+4;
    let next=text.indexOf(`\r\n${marker}`,payloadStart); if (next<0) next=text.indexOf(marker,payloadStart); if (next<0) next=text.length;
    let payloadEnd=next; while (payloadEnd>payloadStart && (a[payloadEnd-1]===10 || a[payloadEnd-1]===13)) payloadEnd--;
    const ct=(headerText.match(/content-type:\s*([^\r\n]+)/i)||[])[1]||'';
    out.push({contentType:ct.trim(),data:a.slice(payloadStart,payloadEnd)});
    pos=next+2;
  }
  return out;
}

export function sopInstanceUid(meta) { return metaString(meta,'00080018',''); }
export function numberOfFrames(meta) { return Math.max(1,Number(metaString(meta,'00280008','1'))||1); }
