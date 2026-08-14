/**
 * Móc vào WebSocket của GE Centricity Universal Viewer (Zero Footprint).
 *
 * Chạy ở MAIN world, lúc document_start — viewer mở WebSocket ngay khi nạp
 * trang, gắn muộn là mất sạch cấu trúc study lẫn những ảnh đầu tiên.
 *
 * Vì sao phải làm thế này: dòng ZFP KHÔNG chuyển ảnh qua HTTP. Pixel đi trong
 * `ws://.../image-provider` theo giao thức JSON riêng của GE, nên
 * chrome.webRequest không nhìn thấy gì để mà học.
 *
 * QUAN TRỌNG — vì sao chỉ HỨNG chứ không HỎI:
 * bản trước gửi lệnh `GET_DICOM_IMAGE` y hệt viewer (đúng socket của trang,
 * đúng cấu trúc payload, correlationId dạng UUID) và server im lặng 100% số
 * lần. Đã loại trừ bằng thực nghiệm trên ca thật: sai định dạng
 * correlationId (không phải), sai socket (thử cả 4, đều câm), series chưa
 * hiển thị (series đang mở cũng câm), server bỏ qua ảnh đã gửi rồi (ảnh chưa
 * từng nạp cũng câm). Trong lúc server đang bơm 600 khung của chính viewer thì
 * không khung nào mang SOP mình hỏi. Server chỉ phục vụ ảnh do engine của nó
 * quyết định — không nhận lệnh của người ngoài.
 *
 * Nhưng chính viewer tự nạp gần trọn study khi mở trang (đo được 261/264 ảnh
 * trong ~45 giây). Nên ở đây ta không xin: ta ghép mỗi khung metadata với khung
 * nhị phân đi ngay sau nó trên cùng socket, xếp vào hàng đợi, rồi đẩy dần sang
 * extension. Mỗi ảnh lấy ra là bỏ khỏi hàng đợi ngay — giữ cả 264 ảnh trong
 * trang là ~138 MB, đủ để tab chết.
 */
(() => {
  if (window.__zfp) return;

  // Trần bộ nhớ hàng đợi. Cao hơn thì mở viewer xong bấm tải ngay vẫn còn đủ
  // ảnh cũ; cao quá thì tab viewer nặng thêm đúng bằng ngần đó.
  const MAX_QUEUE_BYTES = 96 * 1024 * 1024;

  const store = {
    groups: [], study: null, imageSockets: [], seen: {},
    queue: [], queueBytes: 0, waiters: [],
    captured: 0, dropped: 0, mismatched: 0, sopsQueued: {},
  };
  window.__zfp = store;

  function pack(meta, bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return {sop: String(meta.sopInstanceUid || ''), meta: meta, b64: btoa(s), size: bytes.length,
            captured: store.captured, dropped: store.dropped, queued: store.queue.length};
  }

  function push(meta, bytes) {
    const uid = String(meta.sopInstanceUid || '');
    if (!uid) return;
    store.captured++;
    // Có người đang chờ thì đưa thẳng, khỏi qua hàng đợi — đây là đường đi
    // thường trực lúc đang tải, nhờ nó bộ nhớ trang gần như không tăng.
    const w = store.waiters.shift();
    if (w) { clearTimeout(w.timer); w.resolve(pack(meta, bytes)); return; }
    if (store.sopsQueued[uid]) return;
    store.sopsQueued[uid] = 1;
    store.queue.push({meta: meta, bytes: bytes});
    store.queueBytes += bytes.length;
    while (store.queueBytes > MAX_QUEUE_BYTES && store.queue.length > 1) {
      const old = store.queue.shift();
      store.queueBytes -= old.bytes.length;
      delete store.sopsQueued[String(old.meta.sopInstanceUid || '')];
      store.dropped++;
    }
  }

  function take(timeoutMs) {
    return new Promise(resolve => {
      if (store.queue.length) {
        const it = store.queue.shift();
        store.queueBytes -= it.bytes.length;
        delete store.sopsQueued[String(it.meta.sopInstanceUid || '')];
        resolve(pack(it.meta, it.bytes));
        return;
      }
      const w = {};
      w.timer = setTimeout(() => {
        const i = store.waiters.indexOf(w);
        if (i >= 0) store.waiters.splice(i, 1);
        resolve({empty: true, captured: store.captured, dropped: store.dropped, sockets: liveSockets()});
      }, timeoutMs || 20000);
      w.resolve = resolve;
      store.waiters.push(w);
    });
  }

  function liveSockets() { return store.imageSockets.filter(s => s && s.readyState === 1).length; }

  function watchImages(ws) {
    // Metadata và pixel là HAI khung liền nhau trên cùng socket; ghép sai cặp là
    // ghi pixel của ảnh khác vào file. Số byte phải đúng rows*cols*bits/8*samples
    // mới nhận — khung nào không khớp (JPEG xem nhanh, ảnh định vị, khung điều
    // khiển) thì bỏ, thà thiếu còn hơn sai.
    let meta = null;
    ws.addEventListener('message', ev => {
      if (typeof ev.data === 'string') {
        let d = null;
        try { d = JSON.parse(ev.data); } catch (e) { d = null; }
        meta = (d && d.sopClassUid) ? d : null;
        return;
      }
      const m = meta; meta = null;
      if (!m) return;
      const dim = m.dimensions || {};
      const need = (dim.rows | 0) * (dim.columns | 0)
                 * (((m.bitsAllocated | 0) || 16) / 8)
                 * ((m.samplesPerPixel | 0) || 1);
      const b = new Uint8Array(ev.data);
      if (need && b.length !== need) { store.mismatched++; return; }
      push(m, b);
    });
  }

  const Orig = window.WebSocket;
  const Hooked = function (url, protocols) {
    const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    const u = String(url);
    if (u.indexOf('data-provider') >= 0) {
      ws.addEventListener('message', ev => {
        if (typeof ev.data !== 'string') return;
        if (ev.data.indexOf('ON_DICOM_GROUP_ADDED') < 0 && ev.data.indexOf('ON_STUDY_ADDED') < 0) return;
        try {
          const msg = JSON.parse(ev.data);
          const body = JSON.parse(msg.payload);
          if (msg.eventName === 'ON_STUDY_ADDED') store.study = body;
          else if (body.groupId && !store.seen[body.groupId]) {
            store.seen[body.groupId] = 1;
            store.groups.push(body);
          }
        } catch (e) {}
      });
    } else if (u.indexOf('image-provider') >= 0) {
      try { ws.binaryType = 'arraybuffer'; } catch (e) {}
      store.imageSockets.push(ws);
      watchImages(ws);
    }
    return ws;
  };
  Hooked.prototype = Orig.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Hooked[k] = Orig[k];
  window.WebSocket = Hooked;

  function stats() {
    let total = 0;
    for (const g of store.groups) total += ((g && g.dicomSops) || []).length;
    return {captured: store.captured, queued: store.queue.length, dropped: store.dropped,
            mismatched: store.mismatched, sockets: liveSockets(), totalImages: total,
            groups: store.groups.length};
  }

  // Cùng bề mặt với bản trong app Python (`_ZFP_HOOK` của dcom_pipeline.py) để
  // hai bên test được bằng đúng một bộ test, và gõ tay được từ console.
  store.take = take;
  store.stats = stats;

  // Cầu nối sang content script (ISOLATED world) — hai bên không thấy biến của
  // nhau nên phải đi qua postMessage.
  window.addEventListener('message', async ev => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.__zfp !== 'req' || !m.id) return;
    let reply;
    try {
      if (m.kind === 'info') {
        reply = {groups: store.groups, study: store.study, sockets: liveSockets(), stats: stats()};
      } else if (m.kind === 'take') {
        reply = await take((m.args && m.args.timeoutMs) || 20000);
      } else if (m.kind === 'stats') {
        reply = stats();
      } else {
        reply = {error: 'Lệnh không hỗ trợ: ' + m.kind};
      }
    } catch (e) {
      reply = {error: String((e && e.message) || e)};
    }
    window.postMessage({__zfp: 'res', id: m.id, reply}, '*');
  });
})();
