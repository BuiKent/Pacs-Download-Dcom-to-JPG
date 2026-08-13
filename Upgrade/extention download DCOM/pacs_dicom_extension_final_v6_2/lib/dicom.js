'use strict';

const LONG_VR = new Set(['OB','OD','OF','OL','OV','OW','SQ','UC','UR','UT','UN']);
const TEXT_VR = new Set(['AE','AS','CS','DA','DS','DT','IS','LO','LT','PN','SH','ST','TM','UC','UI','UR','UT']);
const NUMERIC_VR = new Set(['US','SS','UL','SL','SV','UV','FL','FD','AT']);
const BINARY_VR = new Set(['OB','OD','OF','OL','OV','OW','UN']);
const enc = new TextEncoder();
const decUtf8 = new TextDecoder('utf-8', {fatal:false});
const decLatin1 = new TextDecoder('latin1', {fatal:false});

function ascii(s){ return enc.encode(String(s)); }
function u16(v){ const a=new Uint8Array(2); new DataView(a.buffer).setUint16(0,Number(v)||0,true); return a; }
function i16(v){ const a=new Uint8Array(2); new DataView(a.buffer).setInt16(0,Number(v)||0,true); return a; }
function u32(v){ const a=new Uint8Array(4); new DataView(a.buffer).setUint32(0,Number(v)>>>0,true); return a; }
function i32(v){ const a=new Uint8Array(4); new DataView(a.buffer).setInt32(0,Number(v)|0,true); return a; }
function u64(v){ const a=new Uint8Array(8); new DataView(a.buffer).setBigUint64(0,BigInt(v||0),true); return a; }
function i64(v){ const a=new Uint8Array(8); new DataView(a.buffer).setBigInt64(0,BigInt(v||0),true); return a; }
function f32(v){ const a=new Uint8Array(4); new DataView(a.buffer).setFloat32(0,Number(v),true); return a; }
function f64(v){ const a=new Uint8Array(8); new DataView(a.buffer).setFloat64(0,Number(v),true); return a; }

export function concatBytes(parts){
  const arrays=(parts||[]).filter(Boolean).map(p=>p instanceof Uint8Array?p:new Uint8Array(p));
  const total=arrays.reduce((n,a)=>n+a.byteLength,0); const out=new Uint8Array(total); let off=0;
  for(const a of arrays){out.set(a,off);off+=a.byteLength;} return out;
}

function tagBytes(tag){
  const t=String(tag).replace(/[^0-9A-Fa-f]/g,'').padStart(8,'0');
  return concatBytes([u16(parseInt(t.slice(0,4),16)),u16(parseInt(t.slice(4,8),16))]);
}
function base64ToBytes(s){ const bin=atob(String(s||''));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out; }
function padEven(bytes,pad=0){ if(bytes.byteLength%2===0)return bytes;const out=new Uint8Array(bytes.byteLength+1);out.set(bytes);out[out.length-1]=pad;return out; }
function personName(v){ if(v&&typeof v==='object')return [v.Alphabetic||'',v.Ideographic||'',v.Phonetic||''].join('=').replace(/=+$/,'');return String(v??''); }
function textValue(vr,values){ const vals=Array.isArray(values)?values:(values==null?[]:[values]);const text=vals.map(v=>vr==='PN'?personName(v):String(v??'')).join('\\');return padEven(enc.encode(text),vr==='UI'?0:0x20); }

function binaryValue(vr,values){
  const vals=Array.isArray(values)?values:(values==null?[]:[values]);const parts=[];
  for(const v of vals){
    if(vr==='US')parts.push(u16(v)); else if(vr==='SS')parts.push(i16(v));
    else if(vr==='UL')parts.push(u32(v)); else if(vr==='SL')parts.push(i32(v));
    else if(vr==='UV')parts.push(u64(v)); else if(vr==='SV')parts.push(i64(v));
    else if(vr==='FL')parts.push(f32(v)); else if(vr==='FD')parts.push(f64(v));
    else if(vr==='AT'){const t=String(v).replace(/[^0-9A-Fa-f]/g,'').padStart(8,'0');parts.push(u16(parseInt(t.slice(0,4),16)),u16(parseInt(t.slice(4,8),16)));}
  }
  return concatBytes(parts);
}

function rawElement(tag,vr,value){
  const val=value instanceof Uint8Array?value:new Uint8Array(value||0);const head=[tagBytes(tag),ascii(vr)];
  if(LONG_VR.has(vr))head.push(new Uint8Array(2),u32(val.byteLength));else head.push(u16(val.byteLength));
  return concatBytes([...head,val]);
}
function stringElement(tag,vr,value){return rawElement(tag,vr,textValue(vr,[value]));}
function numericElement(tag,vr,value){return rawElement(tag,vr,binaryValue(vr,[value]));}
function itemElement(datasetBytes){return concatBytes([u16(0xFFFE),u16(0xE000),u32(datasetBytes.byteLength),datasetBytes]);}

function encodeSequence(values,options){
  const parts=[];for(const item of (Array.isArray(values)?values:[]))parts.push(itemElement(encodeDataset(item||{},{...options,addCharset:false})));return concatBytes(parts);
}

function encodeElement(tag,element,options={}){
  let vr=String(element?.vr||element?.VR||'UN').toUpperCase();
  if(!/^[A-Z]{2}$/.test(vr))vr='UN';
  let value=null;
  if(vr==='SQ')value=encodeSequence(element?.Value||[],options);
  else if(element?.InlineBinary)value=padEven(base64ToBytes(element.InlineBinary),0);
  else if(TEXT_VR.has(vr))value=textValue(vr,element?.Value||[]);
  else if(NUMERIC_VR.has(vr))value=binaryValue(vr,element?.Value||[]);
  else if(BINARY_VR.has(vr))return null;
  else return null;
  const head=[tagBytes(tag),ascii(vr)];if(LONG_VR.has(vr))head.push(new Uint8Array(2),u32(value.byteLength));else head.push(u16(value.byteLength));
  return concatBytes([...head,value]);
}

export function encodeDataset(meta,options={}){
  const source={...(meta||{})};if(options.addCharset!==false||source['00080005'])source['00080005']={vr:'CS',Value:['ISO_IR 192']};
  const tags=Object.keys(source).filter(t=>/^[0-9A-Fa-f]{8}$/.test(t)&&!t.startsWith('0002')&&t.toUpperCase()!=='7FE00010').sort((a,b)=>parseInt(a,16)-parseInt(b,16));
  const parts=[];
  for(const tag of tags){
    try{const e=encodeElement(tag,source[tag],options);if(e)parts.push(e);}catch{}
  }
  return concatBytes(parts);
}

function generateUid(){const a=crypto.getRandomValues(new Uint32Array(4));let n=0n;for(const x of a)n=(n<<32n)|BigInt(x);return `2.25.${n}`;}
function metaString(meta,tag,fallback=''){const v=meta?.[tag]?.Value;return Array.isArray(v)&&v.length?String(v[0]??fallback):fallback;}
function fileMeta(meta,transferSyntax){
  const sopClass=metaString(meta,'00080016','1.2.840.10008.5.1.4.1.1.7');const sopInstance=metaString(meta,'00080018',generateUid());
  const rest=concatBytes([
    rawElement('00020001','OB',new Uint8Array([0,1])),stringElement('00020002','UI',sopClass),stringElement('00020003','UI',sopInstance),
    stringElement('00020010','UI',transferSyntax),stringElement('00020012','UI','1.2.826.0.1.3680043.10.543.99.6'),stringElement('00020013','SH','PACSDLCM_600')
  ]);
  return concatBytes([numericElement('00020000','UL',rest.byteLength),rest]);
}
function pixelDataNative(frames,bitsAllocated){return rawElement('7FE00010',Number(bitsAllocated||16)>8?'OW':'OB',padEven(concatBytes(frames),0));}
function pixelDataEncapsulated(frames){
  const head=concatBytes([tagBytes('7FE00010'),ascii('OB'),new Uint8Array(2),u32(0xFFFFFFFF)]);const items=[concatBytes([u16(0xFFFE),u16(0xE000),u32(0)])];
  for(const frame of frames){const f=padEven(frame,0);items.push(concatBytes([u16(0xFFFE),u16(0xE000),u32(f.byteLength),f]));}
  return concatBytes([head,...items,u16(0xFFFE),u16(0xE0DD),u32(0)]);
}

export function transferSyntaxFromContentType(contentType=''){
  const ct=String(contentType).toLowerCase();const m=ct.match(/transfer-syntax\s*=\s*"?([0-9.]+)/i);if(m)return m[1];
  if(ct.includes('image/jpeg'))return '1.2.840.10008.1.2.4.50';
  if(ct.includes('image/jls')||ct.includes('image/x-jls'))return '1.2.840.10008.1.2.4.80';
  if(ct.includes('image/jp2')||ct.includes('image/j2c')||ct.includes('image/x-j2c'))return '1.2.840.10008.1.2.4.90';
  if(ct.includes('image/jphc'))return '1.2.840.10008.1.2.4.201';
  return '1.2.840.10008.1.2.1';
}

export function buildPart10FromFrames(meta,frames,frameContentType=''){
  if(!meta||!frames?.length)throw new Error('Thiếu metadata/frames để dựng DICOM.');
  const sourceTs=transferSyntaxFromContentType(frameContentType);if(sourceTs==='1.2.840.10008.1.2.2')throw new Error('Không dựng raw Big Endian an toàn.');
  const compressed=!['1.2.840.10008.1.2','1.2.840.10008.1.2.1'].includes(sourceTs);
  const outputTs=compressed?sourceTs:'1.2.840.10008.1.2.1';
  const bits=Number(metaString(meta,'00280100','16'))||16;const preamble=new Uint8Array(132);preamble.set(ascii('DICM'),128);
  return concatBytes([preamble,fileMeta(meta,outputTs),encodeDataset(meta,{utf8:true}),compressed?pixelDataEncapsulated(frames):pixelDataNative(frames,bits)]);
}

export function isPart10(bytes){const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);return a.byteLength>132&&a[128]===68&&a[129]===73&&a[130]===67&&a[131]===77;}

function indexOfBytes(haystack,needle,start=0){outer:for(let i=Math.max(0,start);i<=haystack.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(haystack[i+j]!==needle[j])continue outer;return i;}return -1;}
function boundaryFromPrefix(a){const max=Math.min(a.length,512);let end=-1;for(let i=0;i+1<max;i++){if(a[i]===13&&a[i+1]===10){end=i;break;}}if(end<3||a[0]!==45||a[1]!==45)return'';return decLatin1.decode(a.slice(2,end)).trim();}

export function parseMultipart(bytes,contentType=''){
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);let boundary='';const m=String(contentType).match(/boundary="?([^";,\s]+)"?/i);if(m)boundary=m[1];if(!boundary)boundary=boundaryFromPrefix(a);if(!boundary)return[];
  const marker=ascii(`--${boundary}`),crlfMarker=concatBytes([new Uint8Array([13,10]),marker]),headerSep=new Uint8Array([13,10,13,10]);const out=[];let markerPos=indexOfBytes(a,marker,0);
  while(markerPos>=0){
    let p=markerPos+marker.length;if(a[p]===45&&a[p+1]===45)break;if(a[p]===13&&a[p+1]===10)p+=2;
    const headerEnd=indexOfBytes(a,headerSep,p);if(headerEnd<0)break;const headerText=decLatin1.decode(a.slice(p,headerEnd));const payloadStart=headerEnd+4;
    let next=indexOfBytes(a,crlfMarker,payloadStart);if(next<0){const raw=indexOfBytes(a,marker,payloadStart);next=raw<0?a.length:raw;}let payloadEnd=next;
    while(payloadEnd>payloadStart&&(a[payloadEnd-1]===13||a[payloadEnd-1]===10))payloadEnd--;
    const ct=(headerText.match(/content-type:\s*([^\r\n]+)/i)||[])[1]||'';out.push({contentType:ct.trim(),data:a.slice(payloadStart,payloadEnd)});
    markerPos=next<a.length?(a[next]===13?next+2:next):-1;
  }
  return out;
}

export function sopInstanceUid(meta){return metaString(meta,'00080018','');}
export function numberOfFrames(meta){return Math.max(1,Number(metaString(meta,'00280008','1'))||1);}
function readTextValue(bytes,start,length,decoder=decUtf8){if(!length||start<0||start+length>bytes.length)return'';return decoder.decode(bytes.slice(start,start+length)).replace(/\0/g,'').trim();}
function tagKey(group,element){return group.toString(16).padStart(4,'0').toUpperCase()+element.toString(16).padStart(4,'0').toUpperCase();}
const META_TEXT_TAGS=new Set(['00080005','00080016','00080018','00080020','00080021','00080022','00080023','00080050','00080060','00081030','0008103E','00100010','00100020','00100030','0020000D','0020000E','00200011','00200013']);
function dicomTextDecoder(charset=''){const c=String(charset||'').toUpperCase().split('\\')[0].trim();if(c.includes('ISO_IR 192')||c.includes('UTF-8'))return decUtf8;if(c.includes('ISO_IR 100')||c.includes('8859-1'))return decLatin1;return decLatin1;}
function decodeKnownMeta(tag,bytes,start,length,decoder=decLatin1){if(!META_TEXT_TAGS.has(tag))return'';let value=readTextValue(bytes,start,length,decoder);if(tag==='00100010')value=value.replace(/\^+/g,' ').replace(/\s+/g,' ').trim();return value;}

function readElementSpan(bytes,dv,pos,little,explicit){
  if(pos+8>bytes.length)return null;
  if(!explicit)return{valuePos:pos+8,len:dv.getUint32(pos+4,little)};
  const vr=String.fromCharCode(bytes[pos+4]||0,bytes[pos+5]||0);
  if(!/^[A-Z]{2}$/.test(vr))return null;
  if(LONG_VR.has(vr))return pos+12>bytes.length?null:{valuePos:pos+12,len:dv.getUint32(pos+8,little)};
  return{valuePos:pos+8,len:dv.getUint16(pos+6,little)};
}

/**
 * Nhảy qua trọn một sequence có ĐỘ DÀI KHÔNG XÁC ĐỊNH (0xFFFFFFFF), trả về vị
 * trí ngay sau Sequence Delimitation Item (FFFE,E0DD).
 *
 * Trước đây gặp sequence kiểu này là parser bỏ cuộc luôn, nên mọi tag nằm phía
 * sau đều mất. Máy Hitachi ghi (0008,1140) ReferencedImageSequence ngay trước
 * nhóm 0010, tức là mất sạch PatientName/PatientID/StudyInstanceUID — tên thư
 * mục lưu tụt xuống "Unknown - NoID - NoDate".
 */
function skipUndefinedLength(bytes,dv,start,little,explicit){
  let pos=start,depth=1,guard=0;
  while(pos+8<=bytes.length&&guard++<400000){
    if(dv.getUint16(pos,little)===0xFFFE){
      const element=dv.getUint16(pos+2,little),len=dv.getUint32(pos+4,little);
      pos+=8;
      if(element===0xE0DD){if(--depth===0)return pos;}
      else if(element===0xE000&&len!==0xFFFFFFFF)pos+=len;   // item có độ dài rõ ràng
      continue;                                              // (FFFE,E00D) chỉ đóng item
    }
    const span=readElementSpan(bytes,dv,pos,little,explicit);
    if(!span)return -1;
    if(span.len===0xFFFFFFFF){depth++;pos=span.valuePos;}     // sequence lồng nhau
    else{pos=span.valuePos+span.len;if(pos>bytes.length)return -1;}
  }
  return -1;
}

export function parseDicomMeta(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input||0);if(bytes.length<12)return null;const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let pos=isPart10(bytes)?132:0;let transferSyntax='1.2.840.10008.1.2.1';
  while(pos+8<=bytes.length){const group=dv.getUint16(pos,true),element=dv.getUint16(pos+2,true);if(group!==0x0002)break;const vr=String.fromCharCode(bytes[pos+4]||0,bytes[pos+5]||0);let len=0,valuePos=0;if(LONG_VR.has(vr)){if(pos+12>bytes.length)break;len=dv.getUint32(pos+8,true);valuePos=pos+12;}else{len=dv.getUint16(pos+6,true);valuePos=pos+8;}if(valuePos+len>bytes.length)break;if(element===0x0010)transferSyntax=readTextValue(bytes,valuePos,len)||transferSyntax;pos=valuePos+len;}
  const explicit=transferSyntax!=='1.2.840.10008.1.2',little=transferSyntax!=='1.2.840.10008.1.2.2',out={transferSyntax};let guard=0,textDecoder=decLatin1;
  while(pos+8<=bytes.length&&guard++<200000){const group=dv.getUint16(pos,little),element=dv.getUint16(pos+2,little),tag=tagKey(group,element);if(tag==='7FE00010'){out.hasPixelData=true;out.pixelDataOffset=pos;break;}let len=0,valuePos=0;if(explicit){const vr=String.fromCharCode(bytes[pos+4]||0,bytes[pos+5]||0);if(!/^[A-Z]{2}$/.test(vr))break;if(LONG_VR.has(vr)){if(pos+12>bytes.length)break;len=dv.getUint32(pos+8,little);valuePos=pos+12;}else{len=dv.getUint16(pos+6,little);valuePos=pos+8;}}else{len=dv.getUint32(pos+4,little);valuePos=pos+8;}if(len===0xFFFFFFFF){const after=skipUndefinedLength(bytes,dv,valuePos,little,explicit);if(after<0)break;pos=after;continue;}if(valuePos+len>bytes.length)break;const decoded=decodeKnownMeta(tag,bytes,valuePos,len,textDecoder);if(decoded){out[tag]=decoded;if(tag==='00080005')textDecoder=dicomTextDecoder(decoded);}pos=valuePos+len;}
  if(!out.hasPixelData){const pat=little?new Uint8Array([0xE0,0x7F,0x10,0x00]):new Uint8Array([0x7F,0xE0,0x00,0x10]);const at=indexOfBytes(bytes,pat,Math.min(bytes.length,132));if(at>=0){out.hasPixelData=true;out.pixelDataOffset=at;}}
  return {transferSyntax:out.transferSyntax,specificCharacterSet:out['00080005']||'',sopClassUid:out['00080016']||'',sopInstanceUid:out['00080018']||'',studyDate:out['00080020']||out['00080021']||out['00080022']||out['00080023']||'',accessionNumber:out['00080050']||'',modality:out['00080060']||'',studyDescription:out['00081030']||'',seriesDescription:out['0008103E']||'',patientName:out['00100010']||'',patientId:out['00100020']||'',patientBirthDate:out['00100030']||'',studyUid:out['0020000D']||'',seriesUid:out['0020000E']||'',seriesNumber:out['00200011']||'',instanceNumber:out['00200013']||'',hasPixelData:Boolean(out.hasPixelData),pixelDataOffset:Number(out.pixelDataOffset||0)};
}

export function validatePart10(input,{requirePixelData=true}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input||0);if(!isPart10(bytes))return{ok:false,reason:'Không có DICOM Part-10 preamble.'};
  const meta=parseDicomMeta(bytes);if(!meta)return{ok:false,reason:'Không đọc được File Meta.'};if(!meta.transferSyntax)return{ok:false,reason:'Thiếu Transfer Syntax.'};if(requirePixelData&&!meta.hasPixelData)return{ok:false,reason:'DICOM không có Pixel Data.',meta};return{ok:true,meta};
}
