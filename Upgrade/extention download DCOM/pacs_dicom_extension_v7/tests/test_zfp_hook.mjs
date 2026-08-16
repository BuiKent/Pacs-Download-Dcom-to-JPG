/**
 * GE ZFP WebSocket hook test.
 *
 * This is the trickiest part of the entire ZFP pipeline: metadata and pixels
 * are two separate streams over the same socket. Getting out of sync causes
 * pixels from one image to be written into another patient's file.
 * This test runs the actual hook code on a simulated window.
 *
 * Runs with both versions: extension (`zfp-hook.js`) and Python app
 * (`_ZFP_HOOK` in dcom_pipeline.py, passing temp file path via argv) —
 * both must behave identically, so they share the same test suite.
 *
 *   node tests/test_zfp_hook.mjs [path-to-hook.js]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const hookPath = process.argv[2] ? resolve(process.argv[2]) : join(root, '..', 'zfp-hook.js');
const src = readFileSync(hookPath, 'utf8');

class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; this.handlers = []; this.sent = []; }
  addEventListener(_type, fn) { this.handlers.push(fn); }
  removeEventListener(_type, fn) { this.handlers = this.handlers.filter(h => h !== fn); }
  send(data) { this.sent.push(data); }
  fire(data) { for (const h of [...this.handlers]) h({data}); }
}

const pageHandlers = [];
const window = {
  WebSocket: FakeSocket,
  addEventListener: (_t, fn) => pageHandlers.push(fn),
  postMessage: msg => { for (const h of [...pageHandlers]) h({source: window, data: msg}); },
};
new Function('window', 'btoa', src)(window, (s) => Buffer.from(s, 'binary').toString('base64'));
const hasBridge = pageHandlers.length > 0;

const take = ms => window.__zfp.take(ms);
const ROWS = 4, COLS = 4, BYTES = ROWS * COLS * 2;
function meta(sop) {
  return {sopClassUid: '1.2.840.10008.5.1.4.1.1.4', sopInstanceUid: sop,
          dimensions: {rows: ROWS, columns: COLS}, bitsAllocated: 16, samplesPerPixel: 1};
}
function pixels(fill) { const b = new Uint8Array(BYTES); b.fill(fill); return b.buffer; }

// Image socket must be hooked; other sockets are ignored.
const img = new window.WebSocket('wss://host/image-provider');
const data = new window.WebSocket('wss://host/data-provider');
if (window.__zfp.imageSockets.length !== 1) throw new Error('Failed to recognize image socket');

// 1. Read study structure from data-provider.
data.fire(JSON.stringify({eventName: 'ON_DICOM_GROUP_ADDED',
  payload: JSON.stringify({groupId: 'g1', description: 'LOC 3 PLAN', dicomSops: [{sopInstanceUid: 'a'}]})}));
data.fire(JSON.stringify({eventName: 'ON_STUDY_ADDED', payload: JSON.stringify({studyId: 's1'})}));
if (window.__zfp.groups.length !== 1) throw new Error('Failed to read group');
if (!window.__zfp.study) throw new Error('Failed to read study');

// 2. Matching metadata + pixel pairs are queued.
img.fire(JSON.stringify(meta('sop.1')));
img.fire(pixels(0x11));
let r = await take(50);
if (r.sop !== 'sop.1') throw new Error('Wrong image retrieved: ' + r.sop);
if (r.size !== BYTES) throw new Error('Wrong byte length: ' + r.size);
if (Buffer.from(r.b64, 'base64')[0] !== 0x11) throw new Error('Pixel does not match image');

// 3. Binary frames without prior metadata must be discarded.
img.fire(pixels(0x22));
r = await take(50);
if (!r.empty) throw new Error('Orphan pixel frame accepted');

// 4. Interrupted metadata must not match subsequent pixels.
img.fire(JSON.stringify(meta('sop.2')));
img.fire(JSON.stringify({command: 'SOMETHING_ELSE'}));
img.fire(pixels(0x33));
r = await take(50);
if (!r.empty) throw new Error('Non-contiguous metadata paired with pixel');

// 5. Mismatched byte length is discarded.
img.fire(JSON.stringify(meta('sop.3')));
img.fire(new Uint8Array(BYTES - 2).buffer);
r = await take(50);
if (!r.empty) throw new Error('Mismatched frame size accepted');
if (window.__zfp.mismatched !== 1) throw new Error('Mismatched frame count not incremented');

// 6. Await arriving image frame.
const waiting = take(4000);
img.fire(JSON.stringify(meta('sop.4')));
img.fire(pixels(0x44));
r = await waiting;
if (r.sop !== 'sop.4') throw new Error('Waiting take did not receive image: ' + JSON.stringify(r));

// 7. Duplicate SOP is not queued twice.
img.fire(JSON.stringify(meta('sop.5'))); img.fire(pixels(0x55));
img.fire(JSON.stringify(meta('sop.5'))); img.fire(pixels(0x55));
if (window.__zfp.queue.length !== 1) throw new Error('Duplicate SOP queued twice');
await take(50);

// 8. Empty queue reports status, without blocking.
r = await take(60);

// 9. Hook must NEVER send requests to the image socket.
if (img.sent.length) throw new Error('Hook sent commands to image socket: ' + img.sent[0]);

// Counted 4 images: sop.1, sop.4, and sop.5 (sent twice). sop.2/sop.3 were rejected.
const stats = window.__zfp.stats();
if (stats.captured !== 4 || stats.sockets !== 1) throw new Error('Stats incorrect: ' + JSON.stringify(stats));

// 10. Extension bridge communicates via postMessage across world boundary.
if (hasBridge) {
  const reply = await new Promise(res => {
    const listener = ev => {
      if (ev.data?.__zfp !== 'res' || ev.data.id !== 'x1') return;
      pageHandlers.splice(pageHandlers.indexOf(listener), 1);
      res(ev.data.reply);
    };
    pageHandlers.push(listener);
    window.postMessage({__zfp: 'req', id: 'x1', kind: 'info'});
  });
  if (reply.groups?.length !== 1) throw new Error('postMessage bridge did not return study structure');
}

console.log(`GE ZFP hook tests OK — ${hasBridge ? 'extension build' : 'python build'}`);

