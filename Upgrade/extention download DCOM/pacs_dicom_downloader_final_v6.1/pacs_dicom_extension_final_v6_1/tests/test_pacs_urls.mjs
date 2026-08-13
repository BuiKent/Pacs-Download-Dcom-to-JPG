import {classifyViewerShell, viewerStudyHint} from '../lib/pacs.js';
const named='https://vietmy.pmr.vn/Pages/ShareStudy.aspx?stoken=0123456789abcdef01234567';
const unnamed='https://vietmy.pmr.vn/Pages/ShareStudy.aspx?=0123456789abcdef01234567';
for (const url of [named, unnamed]) {
  const hit=classifyViewerShell(url);
  if(hit?.type!=='SHARE_STUDY'||hit.score<80) throw new Error(`ShareStudy detect failed: ${url}`);
  const hint=viewerStudyHint(url);
  if(!hint||hint.includes('0123456789abcdef01234567')) throw new Error('Study hint must exist without storing full token');
}
console.log('PACS URL tests OK');
