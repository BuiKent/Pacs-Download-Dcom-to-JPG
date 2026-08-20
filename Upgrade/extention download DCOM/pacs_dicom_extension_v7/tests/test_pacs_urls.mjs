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

import {deriveDicomweb} from '../lib/pacs.js';
const huuNghiUrl = 'https://pacs.benhvienhuunghi.vn:6868/viewer?StudyInstanceUIDs=1.2.840.113619.2.417.3.2831206433.879.1786071210.832&StudyNo=11001008.0';
const derived = deriveDicomweb(huuNghiUrl);
if (!derived || derived.studyUid !== '1.2.840.113619.2.417.3.2831206433.879.1786071210.832') {
  throw new Error(`Failed to derive studyUid from OHIF URL: ${JSON.stringify(derived)}`);
}
if (derived.rsBase !== 'https://pacs.benhvienhuunghi.vn:6868') {
  throw new Error(`Failed to derive rsBase from OHIF URL: ${JSON.stringify(derived)}`);
}
console.log('OHIF / Benh Vien Huu Nghi URL tests OK');

