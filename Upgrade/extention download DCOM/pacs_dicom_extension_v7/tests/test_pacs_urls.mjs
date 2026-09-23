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

const meditecUrl = 'https://ketqua.meditecclinic.com.vn/externalinterface/viewexi?MODE=UL&LID=hispacs&LPW=123&TYPE=V&AN=1030396';
const meditecShell = classifyViewerShell(meditecUrl);
if (meditecShell?.type !== 'MEDITEC_ULITE' || meditecShell.score < 90) {
  throw new Error(`Meditec ULite shell detect failed: ${JSON.stringify(meditecShell)}`);
}
const meditecHint = viewerStudyHint(meditecUrl);
if (!meditecHint.includes('an=1030396')) {
  throw new Error(`Meditec accession hint failed: ${meditecHint}`);
}
const meditecExportZip = classifyPacsUrl('https://ketqua.meditecclinic.com.vn/requestDataReadOnly/ExportStudy2ZIP');
if (meditecExportZip?.type !== 'MEDITEC_EXPORT_ZIP') {
  throw new Error(`Meditec ExportStudy2ZIP detect failed: ${JSON.stringify(meditecExportZip)}`);
}
const meditecWorklist = classifyPacsUrl('https://ketqua.meditecclinic.com.vn/requestData/RequestWorklistData');
if (meditecWorklist?.type !== 'MEDITEC_WORKLIST') {
  throw new Error(`Meditec RequestWorklistData detect failed: ${JSON.stringify(meditecWorklist)}`);
}
console.log('Meditec ULite URL tests OK');


import {resourceUrl, inheritQuery} from '../lib/pacs.js';
{
  // A viewer's QIDO call (`series?SeriesInstanceUID=undefined`) seeds the study.
  const seed='http://pacs.test:8081/ws/rest/v1/session/abc/wado-rs/studies/1.2/series?SeriesInstanceUID=undefined&token=t1';
  const base=inheritQuery('http://pacs.test:8081/ws/rest/v1/session/abc/wado-rs/studies/1.2/series/3.4/instances/5.6',seed);
  if(base!=='http://pacs.test:8081/ws/rest/v1/session/abc/wado-rs/studies/1.2/series/3.4/instances/5.6?token=t1')
    throw new Error(`inheritQuery kept a QIDO filter: ${base}`);
  const frame=resourceUrl(base,'/frames/1');
  if(frame!=='http://pacs.test:8081/ws/rest/v1/session/abc/wado-rs/studies/1.2/series/3.4/instances/5.6/frames/1?token=t1')
    throw new Error(`resourceUrl put the path inside the query: ${frame}`);
  if(resourceUrl('https://x.test/rs/instances/9/','/metadata')!=='https://x.test/rs/instances/9/metadata')
    throw new Error('resourceUrl doubled a slash');
  const paged=inheritQuery('https://x.test/rs/studies/1/series/2/instances','https://x.test/rs/studies/1/series?limit=100&offset=200&00200013=1');
  if(paged!=='https://x.test/rs/studies/1/series/2/instances')throw new Error(`inheritQuery carried paging: ${paged}`);
  console.log('DICOMweb resource URL tests OK');
}
