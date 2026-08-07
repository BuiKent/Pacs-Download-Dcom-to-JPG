/* ─── DICOM Download & Viewer — Single Page Frontend ─────────────────────── */
(function () {
  "use strict";

  // ── API layer ───────────────────────────────────────────────────────────
  const sessionUrl = new URL(location.href);
  const TOKEN = sessionUrl.searchParams.get("token") || "";
  sessionUrl.searchParams.delete("token");
  history.replaceState(null, "", sessionUrl.pathname + sessionUrl.search);

  async function api(method, path, body) {
    const opts = {
      method,
      headers: { "X-DCom-Token": TOKEN, "Content-Type": "application/json" },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const GET = (p) => api("GET", p);
  const POST = (p, b) => api("POST", p, b || {});

  // ── DOM refs ────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const urlInput = $("#url-input");
  const btnClearUrl = $("#btn-clear-url");
  const outputPath = $("#output-path");
  const btnChooseOutput = $("#btn-choose-output");
  const btnDownload = $("#btn-download");
  const btnStop = $("#btn-stop");
  const btnOpenOutput = $("#btn-open-output");
  const logWrapper = $("#log-wrapper");
  const logArea = $("#log-area");

  const btnOpenFolder = $("#btn-open-folder");
  const seriesList = $("#series-list");
  const sliceInfo = $("#slice-info");
  const btnMpr = $("#btn-mpr");
  const btnStack = $("#btn-stack");

  const stackView = $("#stack-view");
  const mprView = $("#mpr-view");
  const stackCanvas = $("#stack-canvas");
  const placeholder = $("#viewer-placeholder");

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    outputRoot: "",
    archive: { root: "", series: [] },
    selectedSeriesId: "",
    mode: "stack",
    tool: "scroll",
    jobRunning: false,
    lastOutput: "",
  };

  // ── Clear button (×) on URL input ──────────────────────────────────────
  function updateClearButton() {
    btnClearUrl.style.display = urlInput.value.trim() ? "" : "none";
  }

  urlInput.addEventListener("input", updateClearButton);
  btnClearUrl.addEventListener("click", () => {
    urlInput.value = "";
    updateClearButton();
    urlInput.focus();
  });

  // ── Auto-paste from clipboard ──────────────────────────────────────────
  async function tryAutoPaste() {
    try {
      if (window.pywebview && window.pywebview.api) {
        const clip = await window.pywebview.api.read_clipboard();
        if (clip && clip.url && !urlInput.value) {
          urlInput.value = clip.url;
          updateClearButton();
        }
      }
    } catch (_) {}
  }

  // Re-check clipboard when window gains focus
  window.addEventListener("focus", () => {
    if (!urlInput.value.trim()) tryAutoPaste();
  });

  // ── Tool mode ───────────────────────────────────────────────────────────
  $$(".tool-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tool-btn[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tool = btn.dataset.mode;
    });
  });

  // ── Bootstrap ───────────────────────────────────────────────────────────
  async function bootstrap() {
    try {
      const data = await GET("/api/bootstrap");
      state.outputRoot = data.outputRoot || "";
      outputPath.value = state.outputRoot;
      if (data.archive && data.archive.series && data.archive.series.length) {
        state.archive = data.archive;
        renderSeriesList();
      }
    } catch (e) {
      console.error("Bootstrap error:", e);
    }
    tryAutoPaste();
  }

  // ── Download ────────────────────────────────────────────────────────────
  btnChooseOutput.addEventListener("click", async () => {
    try {
      if (window.pywebview && window.pywebview.api) {
        const result = await window.pywebview.api.choose_output();
        if (result && result.outputRoot) {
          state.outputRoot = result.outputRoot;
          outputPath.value = state.outputRoot;
        }
      }
    } catch (e) {
      appendLog("Lỗi: " + e.message, "error");
    }
  });

  btnDownload.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) {
      appendLog("Hãy nhập link viewer.", "warning");
      return;
    }
    try {
      logArea.innerHTML = "";
      logWrapper.style.display = "";
      await POST("/api/download", { url, outputRoot: state.outputRoot });
      state.jobRunning = true;
      updateButtons();
      pollJob();
    } catch (e) {
      appendLog("Lỗi: " + e.message, "error");
    }
  });

  btnStop.addEventListener("click", async () => {
    try {
      await POST("/api/job/stop");
      appendLog("Đang dừng...", "warning");
    } catch (_) {}
  });

  btnOpenOutput.addEventListener("click", async () => {
    const folder = state.lastOutput || state.outputRoot;
    if (!folder) return;
    try {
      if (window.pywebview && window.pywebview.api) {
        await window.pywebview.api.open_in_explorer(folder);
      }
    } catch (e) {
      appendLog("Lỗi mở folder: " + e.message, "error");
    }
  });

  function updateButtons() {
    btnDownload.disabled = state.jobRunning;
    btnStop.disabled = !state.jobRunning;
  }

  function appendLog(text, type) {
    logWrapper.style.display = "";
    const span = document.createElement("span");
    span.className = "log-line" + (type ? ` log-${type}` : "");
    span.textContent = text + "\n";
    logArea.appendChild(span);
    logArea.scrollTop = logArea.scrollHeight;
  }

  let _lastLogCount = 0;

  async function pollJob() {
    if (!state.jobRunning) return;
    try {
      const job = await GET("/api/job");
      const logs = job.logs || [];
      for (let i = _lastLogCount; i < logs.length; i++) {
        const line = logs[i];
        let type = "";
        if (line.includes("✓") || line.includes("Hoàn tất") || line.includes("HOÀN TẤT"))
          type = "success";
        else if (line.includes("❌") || line.includes("Lỗi") || line.includes("!!!"))
          type = "error";
        else if (line.includes("⚠") || line.includes("Cảnh báo"))
          type = "warning";
        appendLog(line, type);
      }
      _lastLogCount = logs.length;

      if (job.status === "running") {
        setTimeout(pollJob, 800);
      } else {
        state.jobRunning = false;
        _lastLogCount = 0;
        updateButtons();
        if (job.status === "complete" && job.result) {
          state.lastOutput = job.result.output || "";
          if (job.result.archive) {
            state.archive = job.result.archive;
            renderSeriesList();
            appendLog(
              `✓ Tải xong ${job.result.dicom || "?"} ảnh DICOM. Chọn series bên trái để xem.`,
              "success"
            );
          }
        } else if (job.status === "error") {
          appendLog("Tải thất bại.", "error");
        }
      }
    } catch (e) {
      setTimeout(pollJob, 2000);
    }
  }

  // ── Viewer: open folder ─────────────────────────────────────────────────
  btnOpenFolder.addEventListener("click", async () => {
    try {
      if (window.pywebview && window.pywebview.api) {
        const result = await window.pywebview.api.choose_folder();
        if (result) {
          state.jobRunning = true;
          pollViewerOpen();
        }
      }
    } catch (e) {
      alert("Lỗi: " + e.message);
    }
  });

  async function pollViewerOpen() {
    try {
      const job = await GET("/api/job");
      if (job.status === "running") {
        setTimeout(pollViewerOpen, 500);
      } else {
        state.jobRunning = false;
        if (job.status === "complete" && job.result) {
          state.archive = job.result;
          renderSeriesList();
        } else if (job.status === "error") {
          alert("Lỗi quét folder: " + (job.message || "không rõ"));
        }
      }
    } catch (_) {
      setTimeout(pollViewerOpen, 1000);
    }
  }

  // ── Series list ─────────────────────────────────────────────────────────
  function renderSeriesList() {
    seriesList.innerHTML = "";
    const series = state.archive.series || [];
    if (!series.length) {
      seriesList.innerHTML = '<div class="empty-state">Chưa có dữ liệu</div>';
      return;
    }
    const groups = {};
    for (const s of series) {
      const g = s.studyGroup || "Không rõ";
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    }
    for (const [groupName, items] of Object.entries(groups)) {
      if (Object.keys(groups).length > 1) {
        const header = document.createElement("div");
        header.className = "series-group-header";
        header.textContent = groupName;
        seriesList.appendChild(header);
      }
      for (const s of items) {
        const div = document.createElement("div");
        div.className = "series-item";
        if (s.id === state.selectedSeriesId) div.classList.add("active");
        div.dataset.id = s.id;
        let meta = `${s.sliceCount} lát`;
        if (s.modality && s.modality !== "UNKNOWN") meta += ` · ${s.modality}`;
        let badge = s.mprReady ? '<span class="mpr-badge">MPR</span>' : "";
        div.innerHTML = `<span class="series-name">${escHtml(s.description || s.name)}${badge}</span>
          <span class="series-meta">${escHtml(meta)}</span>`;
        div.addEventListener("click", () => selectSeries(s.id));
        seriesList.appendChild(div);
      }
    }
  }

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Series selection & viewing ──────────────────────────────────────────
  let imageCache = {};
  let currentSeries = null;
  let currentSlice = 0;
  let windowCenter = 0;
  let windowWidth = 1;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let dragStartCenter = 0, dragStartWidth = 0;

  async function selectSeries(id) {
    state.selectedSeriesId = id;
    imageCache = {};
    currentSlice = 0;

    $$(".series-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === id);
    });

    currentSeries = (state.archive.series || []).find((s) => s.id === id) || null;
    if (!currentSeries) return;

    btnMpr.disabled = !currentSeries.mprReady;
    switchToStack();

    if (currentSeries.pixelData) {
      const pd = currentSeries.pixelData;
      windowCenter = pd.windowCenter != null ? pd.windowCenter : 128;
      windowWidth = pd.windowWidth != null && pd.windowWidth > 0 ? pd.windowWidth : 256;
    }

    placeholder.style.display = "none";
    await loadAndRender(0);

    for (let i = 1; i <= 3 && i < currentSeries.sliceCount; i++) {
      loadSliceData(i);
    }
  }

  async function loadSliceData(index) {
    if (!currentSeries) return null;
    if (imageCache[index]) return imageCache[index];

    const res = await fetch(`/api/series/${currentSeries.id}/image/${index}`, {
      headers: { "X-DCom-Token": TOKEN },
    });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const meta = {
      pixelType: res.headers.get("X-DCom-Pixel-Type") || "uint16",
      rows: parseInt(res.headers.get("X-DCom-Rows") || "0"),
      columns: parseInt(res.headers.get("X-DCom-Columns") || "0"),
      rawMin: parseInt(res.headers.get("X-DCom-Min") || "0"),
      rawMax: parseInt(res.headers.get("X-DCom-Max") || "0"),
      slope: parseFloat(res.headers.get("X-DCom-Slope") || "1"),
      intercept: parseFloat(res.headers.get("X-DCom-Intercept") || "0"),
      windowCenter: parseFloat(res.headers.get("X-DCom-Window-Center") || "128"),
      windowWidth: parseFloat(res.headers.get("X-DCom-Window-Width") || "256"),
      photometric: res.headers.get("X-DCom-Photometric") || "MONOCHROME2",
    };

    let typedArray;
    switch (meta.pixelType) {
      case "int8":    typedArray = new Int8Array(buffer); break;
      case "uint8":   typedArray = new Uint8Array(buffer); break;
      case "int16":   typedArray = new Int16Array(buffer); break;
      case "uint16":  typedArray = new Uint16Array(buffer); break;
      case "int32":   typedArray = new Int32Array(buffer); break;
      case "uint32":  typedArray = new Uint32Array(buffer); break;
      default:        typedArray = new Int16Array(buffer);
    }

    const entry = { pixels: typedArray, meta };
    imageCache[index] = entry;
    return entry;
  }

  async function loadAndRender(index) {
    if (!currentSeries || index < 0 || index >= currentSeries.sliceCount) return;
    currentSlice = index;
    sliceInfo.textContent = `${index + 1}/${currentSeries.sliceCount}  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;

    const entry = await loadSliceData(index);
    if (!entry) return;

    if (Object.keys(imageCache).length <= 1) {
      windowCenter = entry.meta.windowCenter;
      windowWidth = entry.meta.windowWidth;
    }

    renderToCanvas(stackCanvas, entry.pixels, entry.meta, windowCenter, windowWidth);

    const pre = [index - 1, index + 1, index + 2, index - 2];
    for (const p of pre) {
      if (p >= 0 && p < currentSeries.sliceCount && !imageCache[p]) loadSliceData(p);
    }
  }

  function renderToCanvas(canvas, pixels, meta, wc, ww) {
    const rows = meta.rows, cols = meta.columns;
    if (rows <= 0 || cols <= 0) return;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, rows);
    const data = imgData.data;
    const slope = meta.slope, intercept = meta.intercept;
    const lower = wc - ww / 2, upper = wc + ww / 2, range = upper - lower || 1;
    const invert = meta.photometric === "MONOCHROME1";

    for (let i = 0, len = rows * cols; i < len; i++) {
      const hu = (pixels[i] !== undefined ? pixels[i] : 0) * slope + intercept;
      let gray = ((hu - lower) / range) * 255;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      if (invert) gray = 255 - gray;
      const g = gray | 0;
      const off = i * 4;
      data[off] = g; data[off + 1] = g; data[off + 2] = g; data[off + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ── Stack interactions ──────────────────────────────────────────────────
  stackView.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!currentSeries) return;
    if (state.tool === "scroll") {
      const delta = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(currentSeries.sliceCount - 1, currentSlice + delta));
      if (next !== currentSlice) loadAndRender(next);
    } else {
      windowWidth = Math.max(1, windowWidth + (e.deltaY > 0 ? 10 : -10));
      renderCurrent();
    }
  });

  stackView.addEventListener("mousedown", (e) => {
    if (state.tool !== "window" || !currentSeries) return;
    isDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragStartCenter = windowCenter; dragStartWidth = windowWidth;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    windowWidth = Math.max(1, dragStartWidth + (e.clientX - dragStartX));
    windowCenter = dragStartCenter - (e.clientY - dragStartY);
    renderCurrent();
  });

  document.addEventListener("mouseup", () => { isDragging = false; });

  document.addEventListener("keydown", (e) => {
    if (!currentSeries) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (state.mode === "mpr") return;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.max(0, currentSlice - 1);
      if (next !== currentSlice) loadAndRender(next);
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min((currentSeries.sliceCount || 1) - 1, currentSlice + 1);
      if (next !== currentSlice) loadAndRender(next);
    }
  });

  function renderCurrent() {
    if (!currentSeries) return;
    const entry = imageCache[currentSlice];
    if (!entry) return;
    renderToCanvas(stackCanvas, entry.pixels, entry.meta, windowCenter, windowWidth);
    sliceInfo.textContent = `${currentSlice + 1}/${currentSeries.sliceCount}  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;
  }

  // ── View mode switching ─────────────────────────────────────────────────
  btnStack.addEventListener("click", switchToStack);
  btnMpr.addEventListener("click", switchToMpr);

  function switchToStack() {
    state.mode = "stack";
    stackView.style.display = "";
    mprView.style.display = "none";
    btnStack.classList.add("active");
    btnMpr.classList.remove("active");
  }

  async function switchToMpr() {
    if (!currentSeries || !currentSeries.mprReady) return;
    state.mode = "mpr";
    stackView.style.display = "none";
    mprView.style.display = "";
    btnMpr.classList.add("active");
    btnStack.classList.remove("active");
    await loadMprVolume();
  }

  // ── MPR ─────────────────────────────────────────────────────────────────
  let mprVolume = null;
  let mprMeta = null;
  let mprSlices = { axial: 0, coronal: 0, sagittal: 0 };

  async function loadMprVolume() {
    if (!currentSeries || !currentSeries.mprReady) return;
    const manifest = await GET(`/api/series/${currentSeries.id}/manifest`);
    if (!manifest) return;

    const sliceCount = manifest.slice_count || 0;
    const rows = manifest.rows || 0;
    const cols = manifest.columns || 0;

    sliceInfo.textContent = `MPR: đang tải ${sliceCount} lát...`;

    const volume = new Float32Array(sliceCount * rows * cols);
    let slope = 1, intercept = 0, wc = 128, ww = 256;

    for (let i = 0; i < sliceCount; i++) {
      const entry = await loadSliceData(i);
      if (!entry) continue;
      if (i === 0) {
        slope = entry.meta.slope; intercept = entry.meta.intercept;
        wc = entry.meta.windowCenter; ww = entry.meta.windowWidth;
      }
      const offset = i * rows * cols;
      for (let j = 0; j < rows * cols && j < entry.pixels.length; j++) {
        volume[offset + j] = entry.pixels[j] * slope + intercept;
      }
    }

    mprVolume = volume;
    mprMeta = { sliceCount, rows, cols, wc, ww };
    windowCenter = wc; windowWidth = ww;

    $("#slider-axial").max = sliceCount - 1;
    $("#slider-axial").value = Math.floor(sliceCount / 2);
    $("#slider-coronal").max = rows - 1;
    $("#slider-coronal").value = Math.floor(rows / 2);
    $("#slider-sagittal").max = cols - 1;
    $("#slider-sagittal").value = Math.floor(cols / 2);

    mprSlices.axial = Math.floor(sliceCount / 2);
    mprSlices.coronal = Math.floor(rows / 2);
    mprSlices.sagittal = Math.floor(cols / 2);

    renderAllMpr();
    sliceInfo.textContent = `MPR: ${sliceCount} lát · W:${Math.round(ww)} L:${Math.round(wc)}`;
  }

  function renderMprPlane(plane) {
    if (!mprVolume || !mprMeta) return;
    const { sliceCount, rows, cols } = mprMeta;
    const canvas = $(`#mpr-${plane}`);
    const lower = windowCenter - windowWidth / 2;
    const range = windowWidth || 1;
    let w, h, getVal;

    if (plane === "axial") {
      w = cols; h = rows;
      const z = mprSlices.axial;
      if (z < 0 || z >= sliceCount) return;
      const off = z * rows * cols;
      getVal = (r, c) => mprVolume[off + r * cols + c];
    } else if (plane === "coronal") {
      w = cols; h = sliceCount;
      const y = mprSlices.coronal;
      if (y < 0 || y >= rows) return;
      getVal = (z, c) => mprVolume[z * rows * cols + y * cols + c];
    } else {
      w = rows; h = sliceCount;
      const x = mprSlices.sagittal;
      if (x < 0 || x >= cols) return;
      getVal = (z, r) => mprVolume[z * rows * cols + r * cols + x];
    }

    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        let gray = ((getVal(r, c) - lower) / range) * 255;
        gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
        const g = gray | 0;
        const off = (r * w + c) * 4;
        data[off] = g; data[off + 1] = g; data[off + 2] = g; data[off + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function renderAllMpr() {
    renderMprPlane("axial");
    renderMprPlane("coronal");
    renderMprPlane("sagittal");
  }

  // MPR slider + scroll
  ["axial", "coronal", "sagittal"].forEach((plane) => {
    const slider = $(`#slider-${plane}`);
    slider.addEventListener("input", () => {
      mprSlices[plane] = parseInt(slider.value);
      renderMprPlane(plane);
    });

    const canvas = $(`#mpr-${plane}`);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const max = parseInt(slider.max);
      mprSlices[plane] = Math.max(0, Math.min(max, mprSlices[plane] + (e.deltaY > 0 ? 1 : -1)));
      slider.value = mprSlices[plane];
      renderMprPlane(plane);
    });

    // W/L drag on MPR
    let md = false, mx = 0, my = 0, mwc = 0, mww = 0;
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2 || state.tool === "window") {
        md = true; mx = e.clientX; my = e.clientY;
        mwc = windowCenter; mww = windowWidth;
        e.preventDefault();
      }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (!md) return;
      windowWidth = Math.max(1, mww + (e.clientX - mx));
      windowCenter = mwc - (e.clientY - my);
      renderAllMpr();
      sliceInfo.textContent = `MPR  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;
    });
    document.addEventListener("mouseup", () => { md = false; });
  });

  // ── Init ────────────────────────────────────────────────────────────────
  bootstrap();
})();
