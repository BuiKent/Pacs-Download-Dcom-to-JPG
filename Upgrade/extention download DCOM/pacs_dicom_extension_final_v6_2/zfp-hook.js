/**
 * Móc vào WebSocket của GE Centricity Universal Viewer (Zero Footprint).
 *
 * Chạy ở MAIN world, lúc document_start — viewer mở WebSocket ngay khi nạp
 * trang, gắn muộn là mất sạch cấu trúc study.
 *
 * Vì sao phải làm thế này: dòng ZFP KHÔNG chuyển ảnh qua HTTP. Pixel đi trong
 * `ws://.../image-provider` theo giao thức JSON riêng của GE, nên chrome.webRequest
 * không nhìn thấy gì để mà học. Ở đây ta nghe `data-provider` để lấy cấu trúc
 * study, giữ tham chiếu tới socket ảnh, rồi tự hỏi từng ảnh khi cần tải.
 */
(() => {
  if (window.__zfp) return;
  const store = {groups: [], study: null, imageSockets: [], seen: {}};
  window.__zfp = store;

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
    }
    return ws;
  };
  Hooked.prototype = Orig.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Hooked[k] = Orig[k];
  window.WebSocket = Hooked;

  function fetchImage(a) {
    return new Promise(resolve => {
      // Phải gửi trên CHÍNH socket của trang: socket tự mở sẽ được cấp session
      // mới chưa LOAD_STUDY nên server lặng thinh.
      const ws = store.imageSockets.find(s => s && s.readyState === 1);
      if (!ws) { resolve({error: 'Không còn kết nối ảnh nào đang mở. Hãy mở lại viewer.'}); return; }
      const want = String(a.sop).split('#')[0];
      let meta = null;
      const off = () => ws.removeEventListener('message', onMsg);
      const timer = setTimeout(() => { off(); resolve({error: 'Quá hạn chờ ảnh.'}); }, a.timeoutMs || 45000);
      function onMsg(ev) {
        if (typeof ev.data === 'string') {
          try { const d = JSON.parse(ev.data); if (d.sopClassUid) meta = d; } catch (e) {}
          return;
        }
        // Viewer cũng đang xin ảnh trên đúng socket này. Chỉ nhận khối nhị phân
        // đi NGAY SAU metadata của đúng ảnh mình hỏi VÀ đúng số byte suy ra từ
        // metadata — thiếu một trong hai là rất dễ ghi nhầm pixel của ảnh khác.
        if (!meta || meta.sopInstanceUid !== want) { meta = null; return; }
        const dim = meta.dimensions || {};
        const need = (dim.rows | 0) * (dim.columns | 0)
                   * (((meta.bitsAllocated | 0) || 16) / 8)
                   * ((meta.samplesPerPixel | 0) || 1);
        const b = new Uint8Array(ev.data);
        if (need && b.length !== need) { meta = null; return; }
        clearTimeout(timer); off();
        let s = ''; const CH = 0x8000;
        for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
        resolve({meta: meta, b64: btoa(s), size: b.length});
      }
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({
        command: 'GET_DICOM_IMAGE',
        payLoad: JSON.stringify({
          Token: {StudyInstanceUid: a.studyUid, GroupId: a.groupId, SopInstanceUid: a.sop},
          Options: {MaxResolution: 0, QualityLevel: 75, OutputFormat: 'IT_RAW'}
        }),
        correlationId: 'dl-' + Math.random().toString(36).slice(2)
      }));
    });
  }

  // Cầu nối sang content script (ISOLATED world) — hai bên không thấy biến của
  // nhau nên phải đi qua postMessage.
  window.addEventListener('message', async ev => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.__zfp !== 'req' || !m.id) return;
    let reply;
    try {
      if (m.kind === 'info') {
        reply = {groups: store.groups, study: store.study,
                 sockets: store.imageSockets.filter(s => s && s.readyState === 1).length};
      } else if (m.kind === 'image') {
        reply = await fetchImage(m.args || {});
      } else {
        reply = {error: 'Lệnh không hỗ trợ: ' + m.kind};
      }
    } catch (e) {
      reply = {error: String((e && e.message) || e)};
    }
    window.postMessage({__zfp: 'res', id: m.id, reply}, '*');
  });
})();
