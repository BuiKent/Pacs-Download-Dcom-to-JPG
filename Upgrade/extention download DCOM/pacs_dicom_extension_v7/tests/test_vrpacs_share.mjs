/**
 * VRPACS share-link testing (/viewershare?params=<base64 JSON>).
 */
import { VrpacsAdapter } from '../lib/adapters/vrpacs.js';
import { parseVrpacsManifest, replayContentType, isVrpacsPlaceholderImageId } from '../lib/pacs.js';

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

// 7. Multi-port healing: when viewer is on port 82 and returns 405, adapter probes port 740 and succeeds.
const MULTI_PORT_VIEWER = `http://113.160.182.21:82/viewershare?params=${PARAMS}`;
let probedPorts = [];
const multiPortCtx = {
  summary: {currentUrl: 'http://113.160.182.21:4040/view-image?sid=103004', frameUrls: [MULTI_PORT_VIEWER], requests: [], navUrls: []},
  state: {pacsRequests: [], headersByOrigin: {}},
  normalizeStudy: x => x,
  headersForUrl: () => ({}),
  fetchJson: (url) => {
    probedPorts.push(url);
    if (url.includes(':82/')) throw new Error('HTTP 405 Method Not Allowed');
    if (url.includes(':740/')) return manifest;
    throw new Error('HTTP 404 Not Found');
  },
};
if (!VrpacsAdapter.match(multiPortCtx.summary)) throw new Error('Failed to match VRPACS via frameUrls');
const multiPortInv = await VrpacsAdapter.analyze(multiPortCtx);
if (multiPortInv.context.manifestUrl !== 'http://113.160.182.21:740/vrpacs-file/get-share-patient-image')
  throw new Error('Did not heal to winning port 740 manifest: ' + multiPortInv.context.manifestUrl);
if (multiPortInv.series.length !== 2) throw new Error('Wrong series count in multi-port recovery');
if (probedPorts[0] !== 'http://113.160.182.21:82/vrpacs-file/get-share-patient-image')
  throw new Error('Must try the viewer own port first, tried: ' + probedPorts[0]);

// 8. Images follow the port that answered, not the port the viewer sits on.
const healedTasks = await VrpacsAdapter.enumerate(multiPortInv, [multiPortInv.series[0].id], multiPortCtx);
if (!healedTasks[0].url.startsWith('http://113.160.182.21:740/vrpacs-file/image/'))
  throw new Error('Image URL did not follow the healed port: ' + healedTasks[0].url);

// 9. Entries that hold no image are left out without renumbering the rest.
// Real VRPACS series carry no UID, so ids and folders come from the manifest
// position (a live study listed a PhoenixZIPReport SR and a HIS placeholder,
// which failed 7 of 262 "images" that were never images).
const scu = (f) => `wadouri:/vrpacs-scu/study-get-public?link=L&file=${f}`;
const mixed = {data: {pName: 'X', pCode: '1', studyList: [{studyUID: '1.2.3', seriesList: [
  {seriesDescription: 'Scout', modality: 'MR', dcmFileCount: 2, imageIds: [scu('1.dcm'), scu('2.dcm')]},
  {seriesDescription: 'PhoenixZIPReport', modality: 'SR', dcmFileCount: 1, imageIds: [scu('3.dcm')]},
  {seriesDescription: 't2_tse_sag', modality: 'MR', dcmFileCount: 2, imageIds: ['wadouri:/assets/NoImage.dcm', scu('4.dcm'), scu('5.dcm')]},
  {seriesDescription: 'HIS', modality: '', dcmFileCount: 0, imageIds: ['wadouri:/assets/NoImage.dcm']},
]}]}};
const mixedCtx = {...ctx, fetchJson: async () => mixed};
const mixedInv = await VrpacsAdapter.analyze(mixedCtx);
if (JSON.stringify(mixedInv.series.map(s => s.id)) !== JSON.stringify(['vrpacs:0', 'vrpacs:2']))
  throw new Error('Image series must keep their manifest-position ids: ' + mixedInv.series.map(s => s.id));
if (mixedInv.series[1].imageCount !== 2) throw new Error('A placeholder was counted as an image: ' + mixedInv.series[1].imageCount);
const skipped = mixedInv.context.skippedSeries.map(s => `${s.id}:${s.reason}`).join(',');
if (skipped !== 'vrpacs:1:non-image,vrpacs:3:placeholder') throw new Error('Wrong skipped series: ' + skipped);
const mixedTasks = await VrpacsAdapter.enumerate(mixedInv, mixedInv.series.map(s => s.id), mixedCtx);
if (mixedTasks.length !== 4) throw new Error('Wrong task count with non-image entries: ' + mixedTasks.length);
if (mixedTasks.some(t => /noimage/i.test(t.url))) throw new Error('A placeholder became a download task');
// Folder "03" and file "00002" are what a download made before this filter
// wrote; resuming must find them where they are.
if (!mixedTasks[2].relativePath.startsWith('03 - t2_tse_sag/IM_00002_'))
  throw new Error('Folder or file numbering shifted: ' + mixedTasks[2].relativePath);
const staleTasks = await VrpacsAdapter.enumerate(mixedInv, ['vrpacs:0', 'vrpacs:1', 'vrpacs:2', 'vrpacs:3'], mixedCtx);
if (staleTasks.length !== 4) throw new Error('A stale selection revived a non-image series: ' + staleTasks.length);
for (const [id, expected] of [
  ['wadouri:/assets/NoImage.dcm', true], ['http://h:82/assets/NoImage.dcm?v=2', true],
  [scu('NoImage.dcm'), false], [scu('1.dcm'), false], ['', false],
]) {
  if (isVrpacsPlaceholderImageId(id) !== expected) throw new Error(`Placeholder check wrong for ${id}`);
}

// 10. The viewer's own origin waits longer than guessed ports, and when every
// probe fails the reported error is the viewer origin's, not the last filtered
// port's "signal is aborted without reason".
const calls = [];
const deadPortsCtx = {...ctx,
  summary: {currentUrl: `http://10.0.0.5:82/viewershare?params=${PARAMS}`, requests: [], navUrls: [], frameUrls: []},
  fetchJson: async (url, accept, req, timeoutMs) => {
    calls.push({url, timeoutMs});
    if (url.includes(':82/')) throw new Error('HTTP 502: /vrpacs-file/get-share-patient-image');
    throw new Error('signal is aborted without reason');
  }};
let deadPortsError = null;
try { await VrpacsAdapter.analyze(deadPortsCtx); } catch (e) { deadPortsError = e; }
if (!/HTTP 502/.test(deadPortsError?.message || '')) throw new Error('Reported the wrong failure: ' + deadPortsError?.message);
const ownPort = calls.filter(c => c.url.includes(':82/')), guessed = calls.filter(c => !c.url.includes(':82/'));
if (!ownPort.length || ownPort.some(c => !(c.timeoutMs > 4000))) throw new Error('The viewer origin kept the short timeout');
if (!guessed.length || guessed.some(c => c.timeoutMs !== 4000)) throw new Error('Guessed ports lost their short timeout');

console.log('VRPACS share-link tests OK');
