import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPart10FromFrames,validatePart10,parseDicomMeta,parseMultipart} from '../lib/dicom.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const meta={
 '00080016':{vr:'UI',Value:['1.2.840.10008.5.1.4.1.1.4']},
 '00080018':{vr:'UI',Value:['1.2.826.0.1.3680043.2.1125.1']},
 '00080020':{vr:'DA',Value:['20260813']},
 '00080060':{vr:'CS',Value:['MR']},
 '00081030':{vr:'LO',Value:['CT sọ não tiếng Việt']},
 '00100010':{vr:'PN',Value:[{Alphabetic:'ĐÀO^THỊ^LOAN'}]},
 '00100020':{vr:'LO',Value:['BN001']},
 '0020000D':{vr:'UI',Value:['1.2.3.4.5']},
 '0020000E':{vr:'UI',Value:['1.2.3.4.5.6']},
 '00200011':{vr:'IS',Value:['7']},
 '00200013':{vr:'IS',Value:['1']},
 '00280002':{vr:'US',Value:[1]},
 '00280004':{vr:'CS',Value:['MONOCHROME2']},
 '00280010':{vr:'US',Value:[2]},
 '00280011':{vr:'US',Value:[2]},
 '00280100':{vr:'US',Value:[16]},
 '00280101':{vr:'US',Value:[12]},
 '00280102':{vr:'US',Value:[11]},
 '00280103':{vr:'US',Value:[0]}
};
const raw=new Uint8Array([1,0,2,0,3,0,4,0]);
const dcm=buildPart10FromFrames(meta,[raw],'application/octet-stream; transfer-syntax=1.2.840.10008.1.2');
const v=validatePart10(dcm);if(!v.ok)throw new Error(v.reason);const parsed=parseDicomMeta(dcm);if(parsed.transferSyntax!=='1.2.840.10008.1.2.1')throw new Error(`Unexpected TS ${parsed.transferSyntax}`);if(parsed.patientId!=='BN001')throw new Error('Patient ID');
fs.writeFileSync(path.join(here,'writer_raw.dcm'),dcm);
const jpeg=new Uint8Array([0xFF,0xD8,0xFF,0xD9]);const compressed=buildPart10FromFrames({...meta,'00080018':{vr:'UI',Value:['1.2.826.0.1.3680043.2.1125.2']}},[jpeg],'image/jpeg; transfer-syntax=1.2.840.10008.1.2.4.50');
if(!validatePart10(compressed).ok)throw new Error('Compressed invalid');fs.writeFileSync(path.join(here,'writer_jpeg.dcm'),compressed);
const boundary='abc123';const head=`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`;const tail=`\r\n--${boundary}--\r\n`;const multipart=new Uint8Array(Buffer.concat([Buffer.from(head,'latin1'),Buffer.from(dcm),Buffer.from(tail,'latin1')]));const parts=parseMultipart(multipart,`multipart/related; boundary=${boundary}`);if(parts.length!==1||!validatePart10(parts[0].data).ok)throw new Error('Multipart parser');
console.log('DICOM writer tests OK');
