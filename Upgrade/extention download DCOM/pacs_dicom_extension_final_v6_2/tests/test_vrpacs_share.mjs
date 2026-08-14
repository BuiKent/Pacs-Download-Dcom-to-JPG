/**
 * VRPACS (link chia se dang /viewershare?params=<base64 JSON>).
 *
 * Truoc day phai bat duoc POST `get-share-patient-image` luc viewer nap thi moi
 * doc duoc danh sach anh — mo extension sau khi trang da tai xong la muon, mat
 * sach. Nay adapter dung lai POST do tu chinh tham so `params` tren URL.
 *
 * Cho de sai nhat: body phai la DUNG chuoi JSON goc. background.js phuc hoi body
 * bang atob(chunks) roi lay charCode, nen chunks phai la base64 cua tung byte
 * body — sai mot nhip la server tra trang HTML kem HTTP 200.
 */
import { VrpacsAdapter } from '../lib/adapters/vrpacs.js';
import { parseVrpacsManifest, replayContentType } from '../lib/pacs.js';

const SHARE = {link: 'a1b2c3d4', pName: 'DAO THI HOA', pCode: '2600093794'};
const PARAMS = Buffer.from(JSON.stringify(SHARE), 'utf8').toString('base64');
const VIEWER_URL = `https://pacs.benhvienbaichay.vn/viewershare?params=${PARAMS}`;

// Ban sao dung y restoreBody() cua background.js — test nay canh dung cai hop
// dong do, khong phai canh cach viet.
function restoreBody(stored){
  const bins=(stored.chunks||[]).map(c=>Buffer.from(c,'base64').toString('binary'));
  const len=bins.reduce((n,b)=>n+b.length,0),out=new Uint8Array(len);let off=0;
  for(const b of bins){for(let i=0;i<b.length;i++)out[off+i]=b.charCodeAt(i);off+=b.length;}
  return out;
}

const manifest = {data: {pName: SHARE.pName, pCode: SHARE.pCode, studyList: [{
  studyUID: '1.2.840.113619.2.1.99', studyDate: '20260812',
  seriesList: [
    {SeriesInsUID: 'se.1', SeriesNumber: '2', SeriesDescription: 'T2 TSE Ax', Modality: 'MR',
     imageIds: ['wadouri:vrpacs-file/image/1.dcm', 'wadouri:vrpacs-file/image/2.dcm']},
    {SeriesInsUID: 'se.2', SeriesNumber: '3', SeriesDescription: 'DWI', Modality: 'MR',
     imageIds: ['wadouri:vrpacs-file/image/3.dcm']},
  ]}]}};

// 1. Nhan ra dong VRPACS chi tu URL, khong can bat duoc request nao.
if (!VrpacsAdapter.match({currentUrl: VIEWER_URL, requests: []})) throw new Error('khong nhan ra link chia se VRPACS');
// ...nhung khong duoc vo dua: URL khong co `params` thi khong phai viec cua no.
if (VrpacsAdapter.match({currentUrl: 'https://viewer.example.com/viewer?study=1', requests: []}))
  throw new Error('nhan bua link khong phai VRPACS');

// 2. analyze dung lai dung POST manifest.
let seen = null;
const ctx = {
  summary: {currentUrl: VIEWER_URL, requests: [], navUrls: [], frameUrls: []},
  state: {pacsRequests: [], headersByOrigin: {}},
  normalizeStudy: x => x,
  headersForUrl: () => ({}),
  fetchJson: (url, accept, req) => { seen = {url, req}; return manifest; },
};
const inv = await VrpacsAdapter.analyze(ctx);

if (seen.url !== 'https://pacs.benhvienbaichay.vn/vrpacs-file/get-share-patient-image')
  throw new Error('goi sai endpoint manifest: ' + seen.url);
if (seen.req.method !== 'POST') throw new Error('phai la POST');
const bodyText = Buffer.from(restoreBody(seen.req.requestBody)).toString('utf8');
if (bodyText !== JSON.stringify(SHARE)) throw new Error('body dung lai khong khop JSON goc: ' + bodyText);
if (replayContentType({}, seen.url, seen.req) !== 'application/json')
  throw new Error('Content-Type sai — ASMX/VRPACS gap sai kieu se tra HTML kem HTTP 200');

// 3. Ho ten va ma benh nhan nam o goc payload (pName/pCode), khong nam trong
//    studyList — doc thieu la thu muc luu tut thanh "Unknown - NoID".
if (inv.patient.name !== 'DAO THI HOA') throw new Error('sai ten BN: ' + inv.patient.name);
if (inv.patient.id !== '2600093794') throw new Error('sai ma BN: ' + inv.patient.id);
if (inv.studyUid !== '1.2.840.113619.2.1.99') throw new Error('sai studyUid: ' + inv.studyUid);
if (inv.series.length !== 2) throw new Error('sai so series');

// 4. enumerate dung lai request tu inventory khi state khong con ghi nho gi.
inv.context = inv.context || {};
const tasks = await VrpacsAdapter.enumerate({...inv, studyUid: inv.studyUid}, [inv.series[0].id], ctx);
if (tasks.length !== 2) throw new Error('sai so task: ' + tasks.length);
if (!tasks[0].url.startsWith('https://pacs.benhvienbaichay.vn/vrpacs-file/image/'))
  throw new Error('URL anh sai: ' + tasks[0].url);
if (!tasks[0].relativePath.startsWith('01 - 2 - T2 TSE Ax/')) throw new Error('duong dan sai: ' + tasks[0].relativePath);

// 5. Ten benh nhan co dau: `params` la base64 cua byte UTF-8, dung lai body
//    phai ra DUNG tung byte do. Xu ly nham thanh chuoi Unicode roi ma hoa lai
//    la body lech, server tu choi.
const VN = {link: 'z9', pName: 'ĐÀO THỊ HOA', pCode: '260009'};
const vnJson = JSON.stringify(VN);
const vnUrl = `https://pacs.benhvienbaichay.vn/viewershare?params=${Buffer.from(vnJson, 'utf8').toString('base64')}`;
let vnSeen = null;
await VrpacsAdapter.analyze({...ctx, summary: {currentUrl: vnUrl, requests: [], navUrls: [], frameUrls: []},
  fetchJson: (url, accept, req) => { vnSeen = req; return manifest; }});
if (Buffer.from(restoreBody(vnSeen.requestBody)).toString('utf8') !== vnJson)
  throw new Error('body co dau bi lech byte');

// 6. Parser doc duoc pName/pCode ngay ca khi studyList khong co gi.
const bare = parseVrpacsManifest({data: {pName: 'X', pID: '9', studyList: []}});
if (bare.patient.name !== 'X' || bare.patient.id !== '9') throw new Error('parser bo qua pName/pID');

console.log('VRPACS share-link tests OK');
