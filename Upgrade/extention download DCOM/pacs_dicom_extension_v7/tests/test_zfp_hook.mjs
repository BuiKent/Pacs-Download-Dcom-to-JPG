/**
 * Moc WebSocket cua GE ZFP — phan HUNG anh.
 *
 * Day la cho de sai nhat cua ca dong ZFP: metadata va pixel la HAI khung roi
 * nhau tren cung mot socket, ghep lech mot nhip la ghi pixel cua anh khac vao
 * file benh nhan. Test nay chay THAT ca file moc tren mot window gia.
 *
 * Chay duoc voi ca hai ban cai: extension (`zfp-hook.js`) va app Python
 * (`_ZFP_HOOK` trong dcom_pipeline.py, truyen duong dan file tam qua argv) —
 * hai ban phai xu su y het nhau, nen dung chung mot bo test.
 *
 *   node tests/test_zfp_hook.mjs [duong-dan-moc.js]
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
const hasBridge = pageHandlers.length > 0;   // ban extension co cau postMessage

const take = ms => window.__zfp.take(ms);
const ROWS = 4, COLS = 4, BYTES = ROWS * COLS * 2;
function meta(sop) {
  return {sopClassUid: '1.2.840.10008.5.1.4.1.1.4', sopInstanceUid: sop,
          dimensions: {rows: ROWS, columns: COLS}, bitsAllocated: 16, samplesPerPixel: 1};
}
function pixels(fill) { const b = new Uint8Array(BYTES); b.fill(fill); return b.buffer; }

// Socket anh phai duoc moc; socket khac thi khong dinh dang gi.
const img = new window.WebSocket('wss://host/image-provider');
const data = new window.WebSocket('wss://host/data-provider');
if (window.__zfp.imageSockets.length !== 1) throw new Error('khong nhan ra socket anh');

// 1. Cau truc study doc tu data-provider.
data.fire(JSON.stringify({eventName: 'ON_DICOM_GROUP_ADDED',
  payload: JSON.stringify({groupId: 'g1', description: 'LOC 3 PLAN', dicomSops: [{sopInstanceUid: 'a'}]})}));
data.fire(JSON.stringify({eventName: 'ON_STUDY_ADDED', payload: JSON.stringify({studyId: 's1'})}));
if (window.__zfp.groups.length !== 1) throw new Error('khong doc duoc group');
if (!window.__zfp.study) throw new Error('khong doc duoc study');

// 2. Cap metadata + pixel dung kich thuoc -> vao hang doi.
img.fire(JSON.stringify(meta('sop.1')));
img.fire(pixels(0x11));
let r = await take(50);
if (r.sop !== 'sop.1') throw new Error('lay nham anh: ' + r.sop);
if (r.size !== BYTES) throw new Error('sai so byte: ' + r.size);
if (Buffer.from(r.b64, 'base64')[0] !== 0x11) throw new Error('pixel khong phai cua anh nay');

// 3. Khung nhi phan KHONG co metadata di ngay truoc thi bo — day chinh la cho
//    de ghi nham pixel sang file khac.
img.fire(pixels(0x22));
r = await take(50);
if (!r.empty) throw new Error('nhan pixel mo coi, se ghi nham file');

// 4. Metadata roi mot khung text khac roi moi den pixel: metadata cu het hieu
//    luc, khong duoc ghep bua.
img.fire(JSON.stringify(meta('sop.2')));
img.fire(JSON.stringify({command: 'SOMETHING_ELSE'}));
img.fire(pixels(0x33));
r = await take(50);
if (!r.empty) throw new Error('ghep metadata voi pixel cach quang');

// 5. Sai so byte so voi rows*cols*bits/8 (JPEG xem nhanh, khung dieu khien...)
//    thi bo, tha thieu con hon sai.
img.fire(JSON.stringify(meta('sop.3')));
img.fire(new Uint8Array(BYTES - 2).buffer);
r = await take(50);
if (!r.empty) throw new Error('nhan khung sai kich thuoc');
if (window.__zfp.mismatched !== 1) throw new Error('khong dem khung lech');

// 6. Doi anh: chua co thi cho, den thi tra ngay — luc dang tai day la duong di
//    thuong truc, nho no bo nho trang khong phinh len.
const waiting = take(4000);
img.fire(JSON.stringify(meta('sop.4')));
img.fire(pixels(0x44));
r = await waiting;
if (r.sop !== 'sop.4') throw new Error('cho anh khong nhan duoc: ' + JSON.stringify(r));

// 7. Trung sop thi khong xep hai lan vao hang doi.
img.fire(JSON.stringify(meta('sop.5'))); img.fire(pixels(0x55));
img.fire(JSON.stringify(meta('sop.5'))); img.fire(pixels(0x55));
if (window.__zfp.queue.length !== 1) throw new Error('sop trung bi xep hai lan');
await take(50);

// 8. Het anh thi bao rong kem so lieu, khong treo mai.
r = await take(60);
if (!r.empty) throw new Error('phai bao rong');
if (r.captured !== window.__zfp.captured) throw new Error('so lieu bao rong khong khop');

// 9. Moc TUYET DOI khong duoc gui gi len socket anh: server ZFP tu choi moi
//    lenh xin anh cua nguoi ngoai, gui chi to gay nhieu phien cua viewer.
if (img.sent.length) throw new Error('moc da gui lenh len socket anh: ' + img.sent[0]);

// Dem duoc 4 anh: sop.1, sop.4 va sop.5 (bom hai lan). sop.2/sop.3 bi loai o
// buoc tren nen KHONG duoc tinh la bat duoc.
const stats = window.__zfp.stats();
if (stats.captured !== 4 || stats.sockets !== 1) throw new Error('stats sai: ' + JSON.stringify(stats));

// 10. Ban extension con phai tra loi qua postMessage (content script o world
//     khac, khong voi duoc window.__zfp).
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
  if (reply.groups?.length !== 1) throw new Error('cau postMessage khong tra ve cau truc study');
}

console.log(`GE ZFP hook (hung anh) tests OK — ${hasBridge ? 'ban extension' : 'ban app Python'}`);
