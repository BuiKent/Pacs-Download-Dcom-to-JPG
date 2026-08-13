import {classifyViewerShell, classifyPacsUrl, viewerStudyHint} from '../lib/pacs.js';
const named='https://vietmy.pmr.vn/Pages/ShareStudy.aspx?stoken=0123456789abcdef01234567';
const unnamed='https://vietmy.pmr.vn/Pages/ShareStudy.aspx?=0123456789abcdef01234567';
for (const url of [named, unnamed]) {
  const hit=classifyViewerShell(url);
  if(hit?.type!=='SHARE_STUDY'||hit.score<80) throw new Error(`ShareStudy detect failed: ${url}`);
  const hint=viewerStudyHint(url);
  if(!hint||hint.includes('0123456789abcdef01234567')) throw new Error('Study hint must exist without storing full token');
}
console.log('PACS URL tests OK');

const vmManifest=classifyPacsUrl('https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo');
if(vmManifest?.type!=='VIETMY_MANIFEST') throw new Error('VietMy manifest URL detect failed');
const vmDcm=classifyPacsUrl('https://vietmy.pmr.vn/ws/getfile.ashx?x=1&stoken=abc');
if(vmDcm?.type!=='VIETMY_DICOM') throw new Error('VietMy DICOM URL detect failed');
const vmRendered=classifyPacsUrl('https://vietmy.pmr.vn/ws/getimagefile.ashx?x=1');
if(vmRendered?.type!=='RENDERED_JPEG') throw new Error('VietMy rendered URL classification failed');
console.log('VietMy URL tests OK');
