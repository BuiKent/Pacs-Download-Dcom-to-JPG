/**
 * Undefined-length sequences must not cause the parser to fail.
 */
import {parseDicomMeta, validatePart10} from '../lib/dicom.js';

const enc = new TextEncoder();
const bytes = a => new Uint8Array(a);
function u16(v){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,v,true);return a;}
function u32(v){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,v>>>0,true);return a;}
function cat(list){const n=list.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of list){o.set(a,p);p+=a.length;}return o;}
function pad(s){return s.length%2?s+' ':s;}
function elem(group,element,vr,text){
  const v=enc.encode(pad(text));
  return cat([u16(group),u16(element),enc.encode(vr),u16(v.length),v]);
}
function longElem(group,element,vr,value){
  return cat([u16(group),u16(element),enc.encode(vr),u16(0),u32(value.length),value]);
}
/** SQ with length 0xFFFFFFFF, closed by Sequence Delimitation Item. */
function undefinedSq(group,element,inner){
  return cat([u16(group),u16(element),enc.encode('SQ'),u16(0),u32(0xFFFFFFFF),
              inner, u16(0xFFFE),u16(0xE0DD),u32(0)]);
}
/** Undefined-length Item, closed by Item Delimitation Item. */
function undefinedItem(inner){
  return cat([u16(0xFFFE),u16(0xE000),u32(0xFFFFFFFF), inner, u16(0xFFFE),u16(0xE00D),u32(0)]);
}

const fileMeta = cat([
  elem(0x0002,0x0002,'UI','1.2.840.10008.5.1.4.1.1.4'),
  elem(0x0002,0x0003,'UI','1.2.3.4'),
  elem(0x0002,0x0010,'UI','1.2.840.10008.1.2.1'),
]);
const preamble = cat([new Uint8Array(128), enc.encode('DICM'),
                      cat([u16(0x0002),u16(0x0000),enc.encode('UL'),u16(4),u32(fileMeta.length)]), fileMeta]);

// Nested SQ + undefined-length item test case
const nested = undefinedSq(0x0008,0x1140, undefinedItem(cat([
  elem(0x0008,0x1150,'UI','1.2.840.10008.5.1.4.1.1.4'),
  undefinedSq(0x0040,0xA730, undefinedItem(elem(0x0008,0x0100,'SH','X'))),
])));

const dataset = cat([
  elem(0x0008,0x0020,'DA','20260730'),
  nested,
  elem(0x0010,0x0010,'PN','NGUYEN THI VAN'),
  elem(0x0010,0x0020,'LO','BG20260730-188'),
  elem(0x0020,0x000D,'UI','1.2.392.200036.9123.1.1'),
  elem(0x0028,0x0008,'IS','3'),
  longElem(0x7FE0,0x0010,'OW', bytes([1,0,2,0,3,0,4,0])),
]);

const dcm = cat([preamble, dataset]);
const meta = parseDicomMeta(dcm);

if (meta.patientName !== 'NGUYEN THI VAN') throw new Error(`PatientName after SQ lost: "${meta.patientName}"`);
if (meta.patientId !== 'BG20260730-188') throw new Error(`PatientID after SQ lost: "${meta.patientId}"`);
if (meta.studyUid !== '1.2.392.200036.9123.1.1') throw new Error(`StudyUID after SQ lost: "${meta.studyUid}"`);
if (meta.studyDate !== '20260730') throw new Error('StudyDate before SQ must be intact');
if (!meta.hasPixelData) throw new Error('Must locate Pixel Data');
if (!validatePart10(dcm).ok) throw new Error('validatePart10 must accept this file');

console.log('Undefined-length sequence tests OK');

