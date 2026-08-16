/**
 * VRPACS share-link testing (/viewershare?params=<base64 JSON>).
 */
import { VrpacsAdapter } from '../lib/adapters/vrpacs.js';
import { parseVrpacsManifest, replayContentType } from '../lib/pacs.js';

const SHARE = {link: 'a1b2c3d4', pName: 'DAO THI HOA', pCode: '2600093794'};
const PARAMS = Buffer.from(JSON.stringify(SHARE), 'utf8').toString('base64');
const VIEWER_URL = `https://pacs.benhvienbaichay.vn/viewershare?params=${PARAMS}`;

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

// 1. Recognize VRPACS from URL alone.
if (!VrpacsAdapter.match({currentUrl: VIEWER_URL, requests: []})) throw new Error('Did not recognize VRPACS share link');
if (VrpacsAdapter.match({currentUrl: 'https://viewer.example.com/viewer?study=1', requests: []}))
  throw new Error('Incorrectly matched non-VRPACS link');

// 2. analyze reconstructs correct POST manifest.
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
  throw new Error('Called wrong manifest endpoint: ' + seen.url);
if (seen.req.method !== 'POST') throw new Error('Must be POST');
const bodyText = Buffer.from(restoreBody(seen.req.requestBody)).toString('utf8');
if (bodyText !== JSON.stringify(SHARE)) throw new Error('Reconstructed body does not match original JSON: ' + bodyText);
if (replayContentType({}, seen.url, seen.req) !== 'application/json')
  throw new Error('Wrong Content-Type — ASMX/VRPACS returns HTML with HTTP 200 on wrong type');

// 3. Patient name and ID located at payload root (pName/pCode).
if (inv.patient.name !== 'DAO THI HOA') throw new Error('Wrong patientName: ' + inv.patient.name);
if (inv.patient.id !== '2600093794') throw new Error('Wrong patientId: ' + inv.patient.id);
if (inv.studyUid !== '1.2.840.113619.2.1.99') throw new Error('Wrong studyUid: ' + inv.studyUid);
if (inv.series.length !== 2) throw new Error('Wrong series count');

// 4. enumerate reconstructs requests from inventory.
inv.context = inv.context || {};
const tasks = await VrpacsAdapter.enumerate({...inv, studyUid: inv.studyUid}, [inv.series[0].id], ctx);
if (tasks.length !== 2) throw new Error('Wrong task count: ' + tasks.length);
if (!tasks[0].url.startsWith('https://pacs.benhvienbaichay.vn/vrpacs-file/image/'))
  throw new Error('Wrong image URL: ' + tasks[0].url);
if (!tasks[0].relativePath.startsWith('01 - 2 - T2 TSE Ax/')) throw new Error('Wrong relative path: ' + tasks[0].relativePath);

// 5. UTF-8 multi-byte strings in params.
const VN = {link: 'z9', pName: 'DAO THI HOA', pCode: '260009'};
const vnJson = JSON.stringify(VN);
const vnUrl = `https://pacs.benhvienbaichay.vn/viewershare?params=${Buffer.from(vnJson, 'utf8').toString('base64')}`;
let vnSeen = null;
await VrpacsAdapter.analyze({...ctx, summary: {currentUrl: vnUrl, requests: [], navUrls: [], frameUrls: []},
  fetchJson: (url, accept, req) => { vnSeen = req; return manifest; }});
if (Buffer.from(restoreBody(vnSeen.requestBody)).toString('utf8') !== vnJson)
  throw new Error('UTF-8 body byte mismatch');

// 6. Parser reads pName/pCode even with empty studyList.
const bare = parseVrpacsManifest({data: {pName: 'X', pID: '9', studyList: []}});
if (bare.patient.name !== 'X' || bare.patient.id !== '9') throw new Error('Parser ignored pName/pID');

console.log('VRPACS share-link tests OK');

