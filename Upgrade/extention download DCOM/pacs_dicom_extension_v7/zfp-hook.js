/**
 * GE Centricity Universal Viewer (Zero Footprint) WebSocket hook.
 *
 * Runs in MAIN world at document_start — viewer opens WebSockets immediately
 * on page load, late hooking loses study structure and initial image frames.
 *
 * Why this is needed: GE ZFP does NOT transfer pixel data over HTTP.
 * Frames are sent across `ws://.../image-provider` in GE's private binary/JSON
 * protocol, invisible to chrome.webRequest.
 *
 * CAPTURE ONLY, NEVER INJECT:
 * The viewer loads almost the entire study automatically upon opening.
 * We pair each metadata frame with the binary payload directly following it
 * on the same socket, place it in an bounded queue, and stream to extension.
 */
(() => {
  if (window.__zfp) return;

  // Maximum memory limit for queue (96 MB)
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
    // If a consumer is already waiting, deliver immediately without queuing
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
    // Metadata and pixel bytes arrive as two sequential messages on the same socket.
    // Verify byte size matches rows * cols * bits/8 * samples before accepting.
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

  store.take = take;
  store.stats = stats;

  // Bridge to content script (ISOLATED world) via postMessage
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
        reply = {error: 'Unsupported command: ' + m.kind};
      }
    } catch (e) {
      reply = {error: String((e && e.message) || e)};
    }
    window.postMessage({__zfp: 'res', id: m.id, reply}, '*');
  });
})();

