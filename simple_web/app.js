/* ─── DICOM Download & Viewer — Frontend ─────────────────────────────────── */
/* Vanilla JS, no build tools, no framework. */

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

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    outputRoot: "",
    archive: { root: "", series: [] },
    selectedSeriesId: "",
    mode: "stack", // "stack" or "mpr"
    tool: "scroll", // "scroll" or "window"
    jobRunning: false,
    lastOutput: "",
  };

  // ── DOM refs ────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const urlInput = $("#url-input");
  const outputPath = $("#output-path");
  const btnPaste = $("#btn-paste");
  const btnChooseOutput = $("#btn-choose-output");
  const btnDownload = $("#btn-download");
  const btnStop = $("#btn-stop");
  const btnOpenOutput = $("#btn-open-output");
  const logArea = $("#log-area");
  const statusText = $("#status-text");

  const btnOpenFolder = $("#btn-open-folder");
  const seriesList = $("#series-list");
  const sliceInfo = $("#slice-info");
  const btnMpr = $("#btn-mpr");
  const btnStack = $("#btn-stack");

  const stackView = $("#stack-view");
  const mprView = $("#mpr-view");
  const stackCanvas = $("#stack-canvas");
  const placeholder = $("#viewer-placeholder");

  // ── Tab switching ───────────────────────────────────────────────────────
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      $(`#tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ── Tool mode switching ─────────────────────────────────────────────────
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
    // Auto-paste from clipboard
    tryAutoPaste();
  }

  async function tryAutoPaste() {
    try {
      if (window.pywebview && window.pywebview.api) {
        const clip = await window.pywebview.api.read_clipboard();
        if (clip && clip.url && !urlInput.value) {
          urlInput.value = clip.url;
        }
      }
    } catch (_) {}
  }

  // ── Download ────────────────────────────────────────────────────────────
  btnPaste.addEventListener("click", async () => {
    try {
      if (window.pywebview && window.pywebview.api) {
        const clip = await window.pywebview.api.read_clipboard();
        if (clip && clip.url) urlInput.value = clip.url;
      } else {
        const text = await navigator.clipboard.readText();
        if (text && text.match(/^https?:\/\//i)) urlInput.value = text;
      }
    } catch (_) {}
  });

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
      appendLog("Hãy nhập link viewer trước.", "warning");
      return;
    }
    try {
      logArea.innerHTML = "";
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
      // Append new logs
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
      statusText.textContent = job.message || job.status;

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
              `\n✓ Tải xong ${job.result.dicom || "?"} ảnh DICOM. Chuyển sang tab "Xem ảnh" để xem.`,
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
          // Job started → poll
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
      statusText.textContent = job.message || job.status;
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
        statusText.textContent = "Sẵn sàng";
      }
    } catch (_) {
      setTimeout(pollViewerOpen, 1000);
    }
  }

  // ── Series list rendering ───────────────────────────────────────────────
  function renderSeriesList() {
    seriesList.innerHTML = "";
    const series = state.archive.series || [];
    if (!series.length) {
      seriesList.innerHTML =
        '<div style="padding:16px;color:var(--text-dim);font-size:13px">Chưa mở folder nào</div>';
      return;
    }
    // Group by studyGroup
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
        let badge = "";
        if (s.mprReady) badge = '<span class="mpr-badge">MPR</span>';

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

  // ── Series selection & image loading ────────────────────────────────────
  let imageCache = {}; // index → {imageData, meta}
  let currentSeries = null;
  let currentSlice = 0;
  let windowCenter = 0;
  let windowWidth = 1;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartCenter = 0;
  let dragStartWidth = 0;

  async function selectSeries(id) {
    state.selectedSeriesId = id;
    imageCache = {};
    currentSlice = 0;

    // Update UI
    $$(".series-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === id);
    });

    currentSeries = (state.archive.series || []).find((s) => s.id === id) || null;
    if (!currentSeries) return;

    // Update MPR button
    btnMpr.disabled = !currentSeries.mprReady;

    // Reset to stack mode
    switchToStack();

    // Set default window from first pixel data
    if (currentSeries.pixelData) {
      const pd = currentSeries.pixelData;
      windowCenter = pd.windowCenter != null ? pd.windowCenter : 128;
      windowWidth = pd.windowWidth != null && pd.windowWidth > 0 ? pd.windowWidth : 256;
    }

    placeholder.style.display = "none";
    await loadAndRender(0);

    // Preload a few nearby slices
    for (let i = 1; i <= 3 && i < currentSeries.sliceCount; i++) {
      loadSliceData(i); // fire & forget
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
    sliceInfo.textContent = `${index + 1} / ${currentSeries.sliceCount}  |  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;

    const entry = await loadSliceData(index);
    if (!entry) return;

    // Set window on first load from DICOM header
    if (Object.keys(imageCache).length <= 1) {
      windowCenter = entry.meta.windowCenter;
      windowWidth = entry.meta.windowWidth;
    }

    renderToCanvas(stackCanvas, entry.pixels, entry.meta, windowCenter, windowWidth);

    // Preload neighbors
    const pre = [index - 1, index + 1, index + 2, index - 2];
    for (const p of pre) {
      if (p >= 0 && p < currentSeries.sliceCount && !imageCache[p]) {
        loadSliceData(p); // fire & forget
      }
    }
  }

  function renderToCanvas(canvas, pixels, meta, wc, ww) {
    const rows = meta.rows;
    const cols = meta.columns;
    if (rows <= 0 || cols <= 0) return;

    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, rows);
    const data = imgData.data;

    const slope = meta.slope;
    const intercept = meta.intercept;
    const lower = wc - ww / 2;
    const upper = wc + ww / 2;
    const range = upper - lower || 1;
    const invert = meta.photometric === "MONOCHROME1";

    for (let i = 0, len = rows * cols; i < len; i++) {
      const raw = pixels[i] !== undefined ? pixels[i] : 0;
      const hu = raw * slope + intercept;
      let gray = ((hu - lower) / range) * 255;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      if (invert) gray = 255 - gray;
      const g = gray | 0;
      const off = i * 4;
      data[off] = g;
      data[off + 1] = g;
      data[off + 2] = g;
      data[off + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ── Stack view interactions ─────────────────────────────────────────────

  // Scroll through slices
  stackView.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!currentSeries) return;
    if (state.tool === "scroll") {
      const delta = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(currentSeries.sliceCount - 1, currentSlice + delta));
      if (next !== currentSlice) loadAndRender(next);
    } else {
      // Window/Level via scroll
      windowWidth = Math.max(1, windowWidth + (e.deltaY > 0 ? 10 : -10));
      renderCurrent();
    }
  });

  // Window/Level drag
  stackView.addEventListener("mousedown", (e) => {
    if (state.tool !== "window" || !currentSeries) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartCenter = windowCenter;
    dragStartWidth = windowWidth;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    windowWidth = Math.max(1, dragStartWidth + dx);
    windowCenter = dragStartCenter - dy;
    renderCurrent();
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (!currentSeries) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (state.mode === "mpr") return; // MPR has its own controls

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
    sliceInfo.textContent = `${currentSlice + 1} / ${currentSeries.sliceCount}  |  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;
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
  let mprVolume = null; // Float32Array [slices][rows][cols]
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

    // Load all slices
    const volume = new Float32Array(sliceCount * rows * cols);
    let slope = 1, intercept = 0, wc = 128, ww = 256;

    for (let i = 0; i < sliceCount; i++) {
      const entry = await loadSliceData(i);
      if (!entry) continue;
      if (i === 0) {
        slope = entry.meta.slope;
        intercept = entry.meta.intercept;
        wc = entry.meta.windowCenter;
        ww = entry.meta.windowWidth;
      }
      const offset = i * rows * cols;
      for (let j = 0; j < rows * cols && j < entry.pixels.length; j++) {
        volume[offset + j] = entry.pixels[j] * slope + intercept;
      }
    }

    mprVolume = volume;
    mprMeta = { sliceCount, rows, cols, wc, ww };
    windowCenter = wc;
    windowWidth = ww;

    // Set slider ranges
    const sliderAxial = $("#slider-axial");
    const sliderCoronal = $("#slider-coronal");
    const sliderSagittal = $("#slider-sagittal");

    sliderAxial.max = sliceCount - 1;
    sliderAxial.value = Math.floor(sliceCount / 2);
    sliderCoronal.max = rows - 1;
    sliderCoronal.value = Math.floor(rows / 2);
    sliderSagittal.max = cols - 1;
    sliderSagittal.value = Math.floor(cols / 2);

    mprSlices.axial = Math.floor(sliceCount / 2);
    mprSlices.coronal = Math.floor(rows / 2);
    mprSlices.sagittal = Math.floor(cols / 2);

    renderAllMpr();
    sliceInfo.textContent = `MPR: ${sliceCount} lát · W:${Math.round(ww)} L:${Math.round(wc)}`;
  }

  function renderMprAxial() {
    if (!mprVolume || !mprMeta) return;
    const { rows, cols, sliceCount } = mprMeta;
    const z = mprSlices.axial;
    if (z < 0 || z >= sliceCount) return;
    const canvas = $("#mpr-axial");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, rows);
    const data = imgData.data;
    const lower = windowCenter - windowWidth / 2;
    const range = windowWidth || 1;
    const offset = z * rows * cols;
    for (let i = 0; i < rows * cols; i++) {
      let gray = ((mprVolume[offset + i] - lower) / range) * 255;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      const g = gray | 0;
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function renderMprCoronal() {
    if (!mprVolume || !mprMeta) return;
    const { rows, cols, sliceCount } = mprMeta;
    const y = mprSlices.coronal;
    if (y < 0 || y >= rows) return;
    const canvas = $("#mpr-coronal");
    canvas.width = cols;
    canvas.height = sliceCount;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, sliceCount);
    const data = imgData.data;
    const lower = windowCenter - windowWidth / 2;
    const range = windowWidth || 1;
    for (let z = 0; z < sliceCount; z++) {
      for (let x = 0; x < cols; x++) {
        const val = mprVolume[z * rows * cols + y * cols + x];
        let gray = ((val - lower) / range) * 255;
        gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
        const g = gray | 0;
        const off = (z * cols + x) * 4;
        data[off] = g;
        data[off + 1] = g;
        data[off + 2] = g;
        data[off + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function renderMprSagittal() {
    if (!mprVolume || !mprMeta) return;
    const { rows, cols, sliceCount } = mprMeta;
    const x = mprSlices.sagittal;
    if (x < 0 || x >= cols) return;
    const canvas = $("#mpr-sagittal");
    canvas.width = rows;
    canvas.height = sliceCount;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(rows, sliceCount);
    const data = imgData.data;
    const lower = windowCenter - windowWidth / 2;
    const range = windowWidth || 1;
    for (let z = 0; z < sliceCount; z++) {
      for (let y = 0; y < rows; y++) {
        const val = mprVolume[z * rows * cols + y * cols + x];
        let gray = ((val - lower) / range) * 255;
        gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
        const g = gray | 0;
        const off = (z * rows + y) * 4;
        data[off] = g;
        data[off + 1] = g;
        data[off + 2] = g;
        data[off + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function renderAllMpr() {
    renderMprAxial();
    renderMprCoronal();
    renderMprSagittal();
  }

  // MPR slider events
  ["axial", "coronal", "sagittal"].forEach((plane) => {
    const slider = $(`#slider-${plane}`);
    slider.addEventListener("input", () => {
      mprSlices[plane] = parseInt(slider.value);
      if (plane === "axial") renderMprAxial();
      else if (plane === "coronal") renderMprCoronal();
      else renderMprSagittal();
    });
  });

  // MPR canvas scroll
  ["axial", "coronal", "sagittal"].forEach((plane) => {
    const canvas = $(`#mpr-${plane}`);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const slider = $(`#slider-${plane}`);
      const max = parseInt(slider.max);
      const delta = e.deltaY > 0 ? 1 : -1;
      mprSlices[plane] = Math.max(0, Math.min(max, mprSlices[plane] + delta));
      slider.value = mprSlices[plane];
      if (plane === "axial") renderMprAxial();
      else if (plane === "coronal") renderMprCoronal();
      else renderMprSagittal();
    });

    // Window/Level drag on MPR canvases
    let mprDragging = false;
    let mprDragX = 0, mprDragY = 0, mprDragWC = 0, mprDragWW = 0;

    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2 || state.tool === "window") {
        mprDragging = true;
        mprDragX = e.clientX;
        mprDragY = e.clientY;
        mprDragWC = windowCenter;
        mprDragWW = windowWidth;
        e.preventDefault();
      }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("mousemove", (e) => {
      if (!mprDragging) return;
      windowWidth = Math.max(1, mprDragWW + (e.clientX - mprDragX));
      windowCenter = mprDragWC - (e.clientY - mprDragY);
      renderAllMpr();
      sliceInfo.textContent = `MPR  |  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;
    });

    document.addEventListener("mouseup", () => {
      mprDragging = false;
    });
  });

  // ── Init ────────────────────────────────────────────────────────────────
  bootstrap();
})();
