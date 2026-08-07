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
  const toolbar = $("#viewer-toolbar");
  const seriesStrip = $("#series-strip");

  const stackView = $("#stack-view");
  const mprView = $("#mpr-view");
  const compareView = $("#compare-view");
  const canvasContainer = $("#canvas-container");
  const stackCanvas = $("#stack-canvas");
  const placeholder = $("#viewer-placeholder");

  const statusText = $("#status-text");
  const statusSlice = $("#status-slice");
  const statusRoot = $("#status-root");
  const statusDot = $(".status-dot");

  // ── SVG Icons (ported from full app) ────────────────────────────────────
  const icons = {
    single: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`,
    compare: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>`,
    mpr: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
    window: "◐",
    pan: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 7.5a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M10 8a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M6 9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M18 11v1a8 8 0 1 1-16 0v-2.5"/></svg>`,
    zoom: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    length: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`,
    angle: "∠",
    ellipse: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>`,
    freehand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`,
    text: `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>`,
    flipHorizontal: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/><path d="M12 2v20"/></svg>`,
    flipVertical: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M4 12h16"/></svg>`,
    rotateClockwise: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" transform="rotate(45 12 12)"></rect>
    </svg>`,
    reset: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    invert: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/></svg>`,
    cine: `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
    capture: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
    clearAnnotations: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
    scrollSync: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  };

  // ── CT Window Presets (Hounsfield) ──────────────────────────────────────
  const CT_WINDOW_PRESETS = [
    { id: "ct-brain", label: "Não", width: 80, center: 40 },
    { id: "ct-stroke", label: "Đột quỵ / hố sau", width: 40, center: 40 },
    { id: "ct-subdural", label: "Máu tụ dưới màng cứng", width: 215, center: 75 },
    { id: "ct-bone", label: "Xương", width: 1800, center: 400 },
    { id: "ct-temporal", label: "Xương thái dương", width: 4000, center: 700 },
  ];

  const RELATIVE_PRESETS = [
    { id: "full", label: "DICOM mặc định", scale: 1 },
    { id: "soft", label: "Cửa sổ rộng", scale: 1.5 },
    { id: "contrast", label: "Cửa sổ hẹp", scale: 0.6 },
  ];

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    outputRoot: "",
    archive: { root: "", series: [] },
    selectedSeriesId: "",
    mode: "stack",         // "stack" | "mpr" | "compare"
    tool: "window",        // current tool
    jobRunning: false,
    lastOutput: "",
    windowPreset: "full",
    cine: false,
    crosslink: true,       // sync slice position between series with same FrameOfReferenceUID
    // View transforms (stack mode)
    panX: 0, panY: 0,
    zoomLevel: 1,
    flipH: false, flipV: false,
    rotateDeg: 0,
    invertColors: false,
    // Compare mode state
    comparePanes: {
      left:  { seriesId: "", slice: 0, wc: 128, ww: 256, cache: {} },
      right: { seriesId: "", slice: 0, wc: 128, ww: 256, cache: {} },
    },
  };

  let cineTimer = null;

  // ── Helper: HTML escape ─────────────────────────────────────────────────
  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Helper: Icon button ─────────────────────────────────────────────────
  function iconButton(id, icon, title, active, disabled, label) {
    return `<button class="icon-button ${active ? "active" : ""} ${label ? "with-label" : ""}" data-action="${id}"
      title="${escHtml(title)}" aria-label="${escHtml(title)}"
      ${disabled ? "disabled" : ""}>
      <span>${icon}</span>${label ? `<small>${escHtml(label)}</small>` : ""}
    </button>`;
  }

  // ── Determine if series supports Hounsfield (matches full app logic) ────
  function seriesSupportsHounsfield(series) {
    if (!series || !series.pixelData) return false;
    if (series.modality !== "CT") return false;
    const pixel = series.pixelData;
    return Number.isFinite(pixel.rescaleSlope)
      && pixel.rescaleSlope !== 0
      && Number.isFinite(pixel.rescaleIntercept);
  }

  // ── Available window presets for current series ─────────────────────────
  function availablePresets(series) {
    const relative = RELATIVE_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
    }));
    if (!seriesSupportsHounsfield(series)) return relative;
    const ct = CT_WINDOW_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      detail: `W${p.width}/L${p.center}`,
    }));
    return [...ct, ...relative];
  }

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

  window.addEventListener("focus", () => {
    if (!urlInput.value.trim()) tryAutoPaste();
  });

  // ── Render toolbar ─────────────────────────────────────────────────────
  function renderToolbar() {
    const series = currentSeries;
    const mprDisabled = !series || !series.mprReady;
    const isMpr = state.mode === "mpr";
    const measureDisabled = true; // Canvas renderer can't do Cornerstone measurements

    // Layout buttons
    const layoutBtns = [
      iconButton("mode-single", icons.single, "Một khung ảnh", state.mode === "stack"),
      iconButton("mode-compare", icons.compare, "So sánh hai series cạnh nhau", state.mode === "compare"),
      iconButton("mode-mpr", icons.mpr, mprDisabled ? (series?.mprReason || "Series không đủ MPR") : "MPR ba mặt phẳng", state.mode === "mpr", mprDisabled),
    ].join("");

    // Window preset
    const presets = availablePresets(series);
    // Fallback preset if current one isn't available for this series
    if (!presets.some((p) => p.id === state.windowPreset)) {
      state.windowPreset = seriesSupportsHounsfield(series) ? "ct-brain" : "full";
    }
    const presetOptions = presets.map((p) =>
      `<option value="${p.id}" ${state.windowPreset === p.id ? "selected" : ""}>${escHtml(p.detail ? `${p.label} · ${p.detail}` : p.label)}</option>`
    ).join("");
    const presetHtml = `<label class="window-preset-control">
      Hiển thị
      <select data-field="window-preset">${presetOptions}</select>
    </label>`;

    // Crosslink: check if there are linkable series (same FrameOfReferenceUID)
    const hasLinkable = canCrosslink();
    const crosslinkBtn = hasLinkable
      ? iconButton("scroll-sync", icons.scrollSync,
        state.crosslink
          ? "Đang đồng bộ vị trí lát giữa các series — bấm để tắt"
          : "Đồng bộ vị trí lát giữa các series cùng tọa độ",
        state.crosslink)
      : "";

    // All buttons flat — natural flex-wrap handles overflow
    const allBtns = [
      // Layout
      layoutBtns,
      // Preset
      presetHtml,
      '<span class="toolbar-divider"></span>',
      // Interaction tools
      iconButton("tool-window", icons.window, "Sáng/tương phản", state.tool === "window"),
      iconButton("tool-pan", icons.pan, "Di chuyển", state.tool === "pan"),
      iconButton("tool-zoom", icons.zoom, "Thu/phóng", state.tool === "zoom"),
      iconButton("tool-length", icons.length, "Đo chiều dài (cần Cornerstone)", false, measureDisabled),
      iconButton("tool-angle", icons.angle, "Đo góc (cần Cornerstone)", false, measureDisabled),
      iconButton("tool-ellipse", icons.ellipse, "ROI ellipse (cần Cornerstone)", false, measureDisabled),
      iconButton("tool-freehand", icons.freehand, "ROI tự do (cần Cornerstone)", false, measureDisabled),
      iconButton("tool-text", icons.text, "Ghi chú chữ (cần Cornerstone)", false, measureDisabled),
      // Spacer
      '<span class="toolbar-spacer"></span>',
      // Utility tools
      crosslinkBtn,
      iconButton("rotate-clockwise", icons.rotateClockwise, "Xoay 90° theo chiều kim đồng hồ"),
      iconButton("flip-horizontal", icons.flipHorizontal, "Lật ngang", state.flipH),
      iconButton("flip-vertical", icons.flipVertical, "Lật dọc", state.flipV),
      iconButton("invert", icons.invert, "Đảo màu", state.invertColors),
      iconButton("reset", icons.reset, isMpr ? "Đặt lại ba mặt phẳng" : "Đặt lại hiển thị"),
      iconButton("cine", state.cine ? "Ⅱ" : icons.cine,
        state.cine ? "Dừng chạy phim" : "Chạy phim", state.cine, isMpr),
      iconButton("capture", icons.capture, "Lưu ảnh"),
    ].join("");

    toolbar.innerHTML = allBtns;

    // Bind toolbar events
    toolbar.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", handleToolbarAction);
    });
    const presetSelect = toolbar.querySelector("[data-field='window-preset']");
    if (presetSelect) {
      presetSelect.addEventListener("change", () => {
        state.windowPreset = presetSelect.value;
        applyWindowPreset(state.windowPreset);
      });
    }
  }

  // ── Toolbar action handler ─────────────────────────────────────────────
  function handleToolbarAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;

    if (action === "mode-single") {
      switchToStack();
      renderToolbar();
    } else if (action === "mode-compare") {
      switchToCompare();
      renderToolbar();
    } else if (action === "mode-mpr") {
      switchToMpr();
      renderToolbar();
    } else if (action === "tool-window") {
      state.tool = "window";
      renderToolbar();
    } else if (action === "tool-pan") {
      state.tool = "pan";
      renderToolbar();
    } else if (action === "tool-zoom") {
      state.tool = "zoom";
      renderToolbar();
    } else if (action === "rotate-clockwise") {
      state.rotateDeg = (state.rotateDeg + 90) % 360;
      applyCanvasTransform();
    } else if (action === "flip-horizontal") {
      state.flipH = !state.flipH;
      applyCanvasTransform();
      renderToolbar();
    } else if (action === "flip-vertical") {
      state.flipV = !state.flipV;
      applyCanvasTransform();
      renderToolbar();
    } else if (action === "invert") {
      state.invertColors = !state.invertColors;
      renderCurrent();
      renderAllMpr();
      renderToolbar();
    } else if (action === "reset") {
      resetView();
    } else if (action === "scroll-sync") {
      state.crosslink = !state.crosslink;
      renderToolbar();
    } else if (action === "cine") {
      toggleCine();
      renderToolbar();
    } else if (action === "capture") {
      captureScreenshot();
    }
  }

  // ── Crosslink: sync slice between series with same FrameOfReferenceUID ─
  function canCrosslink() {
    if (!currentSeries || !currentSeries.geometry) return false;
    const myFrame = currentSeries.geometry.frameOfReferenceUID;
    if (!myFrame) return false;
    return (state.archive.series || []).some((s) =>
      s.id !== currentSeries.id && s.geometry && s.geometry.frameOfReferenceUID === myFrame
    );
  }

  /** Remember the physical position for the current slice so other series can sync to it. */
  function crosslinkPosition() {
    if (!currentSeries || !currentSeries.geometry || !currentSeries.mprReady) return null;
    if (!mprMeta || !mprVolume) return null;
    // Use the manifest to get slice positions
    return {
      frameUID: currentSeries.geometry.frameOfReferenceUID,
      sliceIndex: currentSlice,
      sliceCount: currentSeries.sliceCount || mprMeta.sliceCount,
    };
  }

  // ── Apply window preset ────────────────────────────────────────────────
  function applyWindowPreset(presetId) {
    if (!currentSeries) return;
    const ctPreset = CT_WINDOW_PRESETS.find((p) => p.id === presetId);
    if (ctPreset && seriesSupportsHounsfield(currentSeries)) {
      windowCenter = ctPreset.center;
      windowWidth = ctPreset.width;
    } else {
      const rel = RELATIVE_PRESETS.find((p) => p.id === presetId);
      if (rel) {
        const pd = currentSeries.pixelData || {};
        const slope = pd.rescaleSlope != null ? pd.rescaleSlope : 1;
        const intercept = pd.rescaleIntercept != null ? pd.rescaleIntercept : 0;
        const defCenter = pd.windowCenter != null ? pd.windowCenter : 128;
        const defWidth = pd.windowWidth != null && pd.windowWidth > 0 ? pd.windowWidth : 256;
        windowCenter = defCenter;
        windowWidth = defWidth * rel.scale;
      }
    }
    renderCurrent();
    renderAllMpr();
    updateStatusSlice();
  }

  // ── Canvas transform (stack mode) ──────────────────────────────────────
  function applyCanvasTransform() {
    const parts = [];
    if (state.panX !== 0 || state.panY !== 0) {
      parts.push(`translate(${state.panX}px, ${state.panY}px)`);
    }
    if (state.zoomLevel !== 1) {
      parts.push(`scale(${state.zoomLevel})`);
    }
    if (state.rotateDeg !== 0) {
      parts.push(`rotate(${state.rotateDeg}deg)`);
    }
    if (state.flipH) parts.push(`scaleX(-1)`);
    if (state.flipV) parts.push(`scaleY(-1)`);
    stackCanvas.style.transform = parts.join(" ");

    // Also apply to MPR canvases
    $$(".mpr-canvas").forEach((c) => {
      const mprParts = [];
      if (state.flipH) mprParts.push("scaleX(-1)");
      if (state.flipV) mprParts.push("scaleY(-1)");
      c.style.transform = mprParts.join(" ");
    });
  }

  function resetView() {
    state.panX = 0;
    state.panY = 0;
    state.zoomLevel = 1;
    state.flipH = false;
    state.flipV = false;
    state.rotateDeg = 0;
    state.invertColors = false;
    applyCanvasTransform();

    // Reset W/L to default
    if (currentSeries) {
      const pd = currentSeries.pixelData || {};
      windowCenter = pd.windowCenter != null ? pd.windowCenter : 128;
      windowWidth = pd.windowWidth != null && pd.windowWidth > 0 ? pd.windowWidth : 256;
      state.windowPreset = seriesSupportsHounsfield(currentSeries) ? "ct-brain" : "full";
      applyWindowPreset(state.windowPreset);
    }

    if (state.cine) {
      stopCine();
    }

    renderToolbar();
    renderCurrent();
    renderAllMpr();
  }

  // ── Cine playback ──────────────────────────────────────────────────────
  function toggleCine() {
    if (state.cine) {
      stopCine();
    } else {
      startCine();
    }
  }

  function startCine() {
    if (!currentSeries || state.mode !== "stack") return;
    state.cine = true;
    cineTimer = setInterval(() => {
      if (!currentSeries) { stopCine(); return; }
      let next = currentSlice + 1;
      if (next >= currentSeries.sliceCount) next = 0;
      loadAndRender(next);
    }, 80); // ~12.5 fps
  }

  function stopCine() {
    state.cine = false;
    if (cineTimer) {
      clearInterval(cineTimer);
      cineTimer = null;
    }
  }

  // ── Capture screenshot ─────────────────────────────────────────────────
  function captureScreenshot() {
    let sourceCanvas = null;
    if (state.mode === "stack") {
      sourceCanvas = stackCanvas;
    } else {
      sourceCanvas = $("#mpr-axial");
    }
    if (!sourceCanvas || sourceCanvas.width <= 0) return;

    // Create a composite canvas with transforms applied
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d");
    ctx.save();
    if (state.flipH) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    if (state.flipV) { ctx.translate(0, h); ctx.scale(1, -1); }
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();

    const link = document.createElement("a");
    link.download = `dicom_capture_${Date.now()}.png`;
    link.href = offscreen.toDataURL("image/png");
    link.click();
  }

  // ── Update status ──────────────────────────────────────────────────────
  function updateStatusSlice() {
    if (!currentSeries) {
      statusSlice.textContent = "";
      return;
    }
    if (state.mode === "mpr") {
      statusSlice.textContent = `MPR  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;
    } else {
      statusSlice.textContent = `${currentSlice + 1}/${currentSeries.sliceCount}  W:${Math.round(windowWidth)} L:${Math.round(windowCenter)}`;
    }
  }

  function setStatus(text, busy) {
    statusText.textContent = text;
    statusDot.classList.toggle("busy", !!busy);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────
  async function bootstrap() {
    try {
      const data = await GET("/api/bootstrap");
      state.outputRoot = data.outputRoot || "";
      outputPath.value = state.outputRoot;
      if (data.archive && data.archive.series && data.archive.series.length) {
        state.archive = data.archive;
        renderSeriesList();
        renderSeriesStrip();
        statusRoot.textContent = state.archive.root || "";
      }
    } catch (e) {
      console.error("Bootstrap error:", e);
    }
    tryAutoPaste();
    renderToolbar();
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
      setStatus("Đang tải...", true);
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
        setStatus("Sẵn sàng", false);
        if (job.status === "complete" && job.result) {
          state.lastOutput = job.result.output || "";
          if (job.result.archive) {
            state.archive = job.result.archive;
            renderSeriesList();
            renderSeriesStrip();
            statusRoot.textContent = state.archive.root || "";
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
          setStatus("Đang quét folder...", true);
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
        setStatus("Sẵn sàng", false);
        if (job.status === "complete" && job.result) {
          state.archive = job.result;
          renderSeriesList();
          renderSeriesStrip();
          statusRoot.textContent = state.archive.root || "";
        } else if (job.status === "error") {
          alert("Lỗi quét folder: " + (job.message || "không rõ"));
        }
      }
    } catch (_) {
      setTimeout(pollViewerOpen, 1000);
    }
  }

  // ── Series list (left panel) ───────────────────────────────────────────
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

  // ── Series strip (horizontal cards below toolbar) ──────────────────────
  function renderSeriesStrip() {
    const series = state.archive.series || [];
    if (!series.length) {
      seriesStrip.innerHTML = "";
      return;
    }
    seriesStrip.innerHTML = series.map((item) =>
      `<button class="series-card ${item.id === state.selectedSeriesId ? "active" : ""}"
        data-series-id="${item.id}" title="${escHtml(item.mprReason || item.description)}">
        <span>${item.mprReady ? "3D" : "2D"}</span>
        <b>${escHtml(item.description)}</b>
        <small>${item.sliceCount} lát</small>
      </button>`
    ).join("");

    seriesStrip.querySelectorAll(".series-card").forEach((card) => {
      card.addEventListener("click", () => {
        selectSeries(card.dataset.seriesId);
      });
    });
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
  let dragStartPanX = 0, dragStartPanY = 0;

  async function selectSeries(id) {
    state.selectedSeriesId = id;
    imageCache = {};
    currentSlice = 0;
    stopCine();

    // Reset transforms
    state.panX = 0; state.panY = 0;
    state.zoomLevel = 1;
    state.flipH = false; state.flipV = false;
    state.rotateDeg = 0;
    state.invertColors = false;
    applyCanvasTransform();

    $$(".series-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === id);
    });
    $$(".series-card").forEach((el) => {
      el.classList.toggle("active", el.dataset.seriesId === id);
    });

    currentSeries = (state.archive.series || []).find((s) => s.id === id) || null;
    if (!currentSeries) return;

    // Set default window preset
    state.windowPreset = seriesSupportsHounsfield(currentSeries) ? "ct-brain" : "full";

    switchToStack();
    renderToolbar();

    if (currentSeries.pixelData) {
      const pd = currentSeries.pixelData;
      windowCenter = pd.windowCenter != null ? pd.windowCenter : 128;
      windowWidth = pd.windowWidth != null && pd.windowWidth > 0 ? pd.windowWidth : 256;
    }

    // Apply default preset for CT
    if (seriesSupportsHounsfield(currentSeries)) {
      applyWindowPreset("ct-brain");
    }

    // Crosslink: sync to remembered position from previous series
    if (state.crosslink && crosslinkSliceMap[currentSeries.id] != null) {
      currentSlice = crosslinkSliceMap[currentSeries.id];
    }

    placeholder.style.display = "none";
    setStatus(`Đang tải series: ${currentSeries.description || currentSeries.name}`, true);
    await loadAndRender(0);
    setStatus("Sẵn sàng", false);

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
    updateStatusSlice();

    const entry = await loadSliceData(index);
    if (!entry) return;

    if (Object.keys(imageCache).length <= 1) {
      windowCenter = entry.meta.windowCenter;
      windowWidth = entry.meta.windowWidth;
    }

    renderToCanvas(stackCanvas, entry.pixels, entry.meta, windowCenter, windowWidth);

    // Crosslink: propagate slice position to linked series
    if (state.crosslink && currentSeries && currentSeries.geometry) {
      propagateCrosslink(currentSeries, index);
    }

    const pre = [index - 1, index + 1, index + 2, index - 2];
    for (const p of pre) {
      if (p >= 0 && p < currentSeries.sliceCount && !imageCache[p]) loadSliceData(p);
    }
  }

  // ── Crosslink slice map ─────────────────────────────────────────────────
  // Maps series ID → remembered slice index for crosslink sync
  const crosslinkSliceMap = {};

  function propagateCrosslink(fromSeries, fromIndex) {
    if (!fromSeries.geometry) return;
    const myFrame = fromSeries.geometry.frameOfReferenceUID;
    if (!myFrame) return;
    const ratio = fromSeries.sliceCount > 1 ? fromIndex / (fromSeries.sliceCount - 1) : 0;
    for (const s of (state.archive.series || [])) {
      if (s.id === fromSeries.id) continue;
      if (!s.geometry || s.geometry.frameOfReferenceUID !== myFrame) continue;
      // Map by ratio (proportional position)
      const targetSlice = Math.round(ratio * Math.max(0, s.sliceCount - 1));
      crosslinkSliceMap[s.id] = targetSlice;
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
    const invertPhoto = meta.photometric === "MONOCHROME1";
    const invertFinal = state.invertColors ? !invertPhoto : invertPhoto;

    for (let i = 0, len = rows * cols; i < len; i++) {
      const hu = (pixels[i] !== undefined ? pixels[i] : 0) * slope + intercept;
      let gray = ((hu - lower) / range) * 255;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      if (invertFinal) gray = 255 - gray;
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
    if (state.tool === "zoom") {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      state.zoomLevel = Math.max(0.1, Math.min(10, state.zoomLevel * factor));
      applyCanvasTransform();
    } else {
      // Default: scroll slices
      const delta = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(currentSeries.sliceCount - 1, currentSlice + delta));
      if (next !== currentSlice) loadAndRender(next);
    }
  });

  stackView.addEventListener("mousedown", (e) => {
    if (!currentSeries) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartCenter = windowCenter;
    dragStartWidth = windowWidth;
    dragStartPanX = state.panX;
    dragStartPanY = state.panY;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (state.tool === "window") {
      windowWidth = Math.max(1, dragStartWidth + dx);
      windowCenter = dragStartCenter - dy;
      renderCurrent();
    } else if (state.tool === "pan") {
      state.panX = dragStartPanX + dx;
      state.panY = dragStartPanY + dy;
      applyCanvasTransform();
    } else if (state.tool === "zoom") {
      const factor = 1 + dy * -0.005;
      state.zoomLevel = Math.max(0.1, Math.min(10, state.zoomLevel * factor));
      dragStartY = e.clientY; // Continuous zoom
      applyCanvasTransform();
    }
  });

  document.addEventListener("mouseup", () => { isDragging = false; });

  document.addEventListener("keydown", (e) => {
    if (!currentSeries) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

    // Keyboard shortcuts matching full app
    if (e.key === "w" || e.key === "W") {
      state.tool = "window"; renderToolbar(); return;
    }
    if (e.key === "p" || e.key === "P") {
      state.tool = "pan"; renderToolbar(); return;
    }
    if (e.key === "z" || e.key === "Z") {
      state.tool = "zoom"; renderToolbar(); return;
    }
    if (e.key === "r" || e.key === "R") {
      resetView(); return;
    }
    if (e.key === "i" || e.key === "I") {
      state.invertColors = !state.invertColors;
      renderCurrent(); renderAllMpr(); renderToolbar(); return;
    }

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
    updateStatusSlice();
  }

  // ── View mode switching ─────────────────────────────────────────────────
  function hideAllViews() {
    stackView.style.display = "none";
    mprView.style.display = "none";
    compareView.style.display = "none";
  }

  function switchToStack() {
    state.mode = "stack";
    hideAllViews();
    stackView.style.display = "";
    stopCine();
  }

  function switchToCompare() {
    state.mode = "compare";
    hideAllViews();
    compareView.style.display = "";
    stopCine();
    initCompareMode();
  }

  async function switchToMpr() {
    if (!currentSeries || !currentSeries.mprReady) return;
    state.mode = "mpr";
    hideAllViews();
    mprView.style.display = "";
    stopCine();
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

    setStatus(`MPR: đang tải ${sliceCount} lát...`, true);

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

    // Apply CT preset if CT
    if (seriesSupportsHounsfield(currentSeries)) {
      state.windowPreset = "ct-brain";
      applyWindowPreset("ct-brain");
    }

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
    setStatus("Sẵn sàng", false);
    updateStatusSlice();
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
      // FIX: Flip Z-axis for correct radiological orientation
      // (superior at top, inferior at bottom)
      getVal = (z, c) => mprVolume[(sliceCount - 1 - z) * rows * cols + y * cols + c];
    } else {
      w = rows; h = sliceCount;
      const x = mprSlices.sagittal;
      if (x < 0 || x >= cols) return;
      // FIX: Flip Z-axis for correct radiological orientation
      getVal = (z, r) => mprVolume[(sliceCount - 1 - z) * rows * cols + r * cols + x];
    }

    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const invertFinal = state.invertColors;

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        let gray = ((getVal(r, c) - lower) / range) * 255;
        gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
        if (invertFinal) gray = 255 - gray;
        const g = gray | 0;
        const off = (r * w + c) * 4;
        data[off] = g; data[off + 1] = g; data[off + 2] = g; data[off + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Fix aspect ratio: use physical dimensions from geometry
    if (currentSeries && currentSeries.geometry) {
      const ps = currentSeries.geometry.pixelSpacing; // [row, col]
      const ss = currentSeries.geometry.sliceSpacing;
      if (ps && ps.length >= 2 && ss > 0) {
        let physW, physH;
        if (plane === "axial") {
          physW = w * ps[1]; // cols * colSpacing
          physH = h * ps[0]; // rows * rowSpacing
        } else if (plane === "coronal") {
          physW = w * ps[1]; // cols * colSpacing
          physH = h * ss;    // sliceCount * sliceSpacing
        } else {
          physW = w * ps[0]; // rows * rowSpacing
          physH = h * ss;    // sliceCount * sliceSpacing
        }
        canvas.style.aspectRatio = `${physW} / ${physH}`;
      }
    }
  }

  function renderAllMpr() {
    renderMprPlane("axial");
    renderMprPlane("coronal");
    renderMprPlane("sagittal");
  }

  // MPR slider + scroll + W/L drag
  ["axial", "coronal", "sagittal"].forEach((plane) => {
    const slider = $(`#slider-${plane}`);
    slider.addEventListener("input", () => {
      mprSlices[plane] = parseInt(slider.value);
      renderMprPlane(plane);
    });

    const canvas = $(`#mpr-${plane}`);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (state.tool === "zoom") {
        // Zoom MPR
        return; // zoom handled by CSS transform on parent
      }
      const max = parseInt(slider.max);
      mprSlices[plane] = Math.max(0, Math.min(max, mprSlices[plane] + (e.deltaY > 0 ? 1 : -1)));
      slider.value = mprSlices[plane];
      renderMprPlane(plane);
    });

    // W/L drag on MPR (right-click or W/L mode)
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
      updateStatusSlice();
    });
    document.addEventListener("mouseup", () => { md = false; });
  });

  // ── Compare mode engine ─────────────────────────────────────────────
  function initCompareMode() {
    const series = state.archive.series || [];
    if (!series.length) return;

    // Default: left = current series, right = next linkable or next series
    const leftId = state.selectedSeriesId || series[0].id;
    let rightId = "";
    if (state.crosslink) {
      const leftSeries = series.find((s) => s.id === leftId);
      const leftFrame = leftSeries?.geometry?.frameOfReferenceUID;
      if (leftFrame) {
        const linked = series.find((s) => s.id !== leftId && s.geometry?.frameOfReferenceUID === leftFrame);
        if (linked) rightId = linked.id;
      }
    }
    if (!rightId) {
      const other = series.find((s) => s.id !== leftId);
      rightId = other ? other.id : leftId;
    }

    state.comparePanes.left.seriesId = leftId;
    state.comparePanes.left.slice = crosslinkSliceMap[leftId] || 0;
    state.comparePanes.left.cache = {};
    state.comparePanes.right.seriesId = rightId;
    state.comparePanes.right.slice = crosslinkSliceMap[rightId] || 0;
    state.comparePanes.right.cache = {};

    renderCompareSelects();
    loadComparePane("left");
    loadComparePane("right");
    setupCompareEvents();
  }

  function renderCompareSelects() {
    const series = state.archive.series || [];
    for (const pane of ["left", "right"]) {
      const sel = $(`.compare-series-select[data-pane="${pane}"]`);
      const currentId = state.comparePanes[pane].seriesId;
      sel.innerHTML = series.map((s) =>
        `<option value="${s.id}" ${s.id === currentId ? "selected" : ""}>${escHtml(s.description || s.name)} (${s.sliceCount} lát)</option>`
      ).join("");
    }
  }

  async function loadCompareSlice(pane, seriesId, index) {
    const paneState = state.comparePanes[pane];
    if (paneState.cache[index]) return paneState.cache[index];
    const res = await fetch(`/api/series/${seriesId}/image/${index}`, {
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
    paneState.cache[index] = entry;
    return entry;
  }

  async function loadComparePane(pane) {
    const paneState = state.comparePanes[pane];
    const series = (state.archive.series || []).find((s) => s.id === paneState.seriesId);
    if (!series) return;
    const canvas = $(`#compare-canvas-${pane}`);
    const info = $(`.compare-slice-info[data-pane="${pane}"]`);
    const idx = Math.max(0, Math.min(series.sliceCount - 1, paneState.slice));
    paneState.slice = idx;

    const entry = await loadCompareSlice(pane, series.id, idx);
    if (!entry) return;

    // Set W/L on first load
    if (Object.keys(paneState.cache).length <= 1) {
      paneState.wc = entry.meta.windowCenter;
      paneState.ww = entry.meta.windowWidth;
      // Apply CT preset
      if (seriesSupportsHounsfield(series)) {
        const ctPreset = CT_WINDOW_PRESETS.find((p) => p.id === "ct-brain");
        if (ctPreset) { paneState.wc = ctPreset.center; paneState.ww = ctPreset.width; }
      }
    }

    renderToCanvas(canvas, entry.pixels, entry.meta, paneState.wc, paneState.ww);
    info.textContent = `${idx + 1} / ${series.sliceCount}  ·  W/L: ${Math.round(paneState.ww)}/${Math.round(paneState.wc)}  ·  ${series.description || series.name}`;

    // Prefetch neighbors
    for (const p of [idx - 1, idx + 1]) {
      if (p >= 0 && p < series.sliceCount && !paneState.cache[p]) {
        loadCompareSlice(pane, series.id, p);
      }
    }
  }

  function scrollComparePane(pane, delta) {
    const paneState = state.comparePanes[pane];
    const series = (state.archive.series || []).find((s) => s.id === paneState.seriesId);
    if (!series) return;
    const next = Math.max(0, Math.min(series.sliceCount - 1, paneState.slice + delta));
    if (next === paneState.slice) return;
    paneState.slice = next;
    loadComparePane(pane);

    // Crosslink: sync other pane
    if (state.crosslink) {
      const otherPane = pane === "left" ? "right" : "left";
      const otherState = state.comparePanes[otherPane];
      const otherSeries = (state.archive.series || []).find((s) => s.id === otherState.seriesId);
      if (otherSeries) {
        const myFrame = series.geometry?.frameOfReferenceUID;
        const otherFrame = otherSeries.geometry?.frameOfReferenceUID;
        if (myFrame && myFrame === otherFrame) {
          // Proportional sync
          const ratio = series.sliceCount > 1 ? next / (series.sliceCount - 1) : 0;
          const otherIdx = Math.round(ratio * Math.max(0, otherSeries.sliceCount - 1));
          if (otherIdx !== otherState.slice) {
            otherState.slice = otherIdx;
            loadComparePane(otherPane);
          }
        }
      }
    }
  }

  let compareEventsSetup = false;
  function setupCompareEvents() {
    if (compareEventsSetup) return;
    compareEventsSetup = true;

    // Series selectors
    for (const pane of ["left", "right"]) {
      const sel = $(`.compare-series-select[data-pane="${pane}"]`);
      sel.addEventListener("change", () => {
        state.comparePanes[pane].seriesId = sel.value;
        state.comparePanes[pane].slice = 0;
        state.comparePanes[pane].cache = {};
        loadComparePane(pane);
      });

      // Wheel scroll
      const wrap = $(`#compare-canvas-${pane}`).parentElement;
      wrap.addEventListener("wheel", (e) => {
        e.preventDefault();
        scrollComparePane(pane, e.deltaY > 0 ? 1 : -1);
      });

      // W/L drag
      let dragging = false, startX = 0, startY = 0, startWc = 0, startWw = 0;
      wrap.addEventListener("mousedown", (e) => {
        if (e.button === 2 || state.tool === "window") {
          dragging = true;
          startX = e.clientX; startY = e.clientY;
          startWc = state.comparePanes[pane].wc;
          startWw = state.comparePanes[pane].ww;
          e.preventDefault();
        }
      });
      wrap.addEventListener("contextmenu", (e) => e.preventDefault());
      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        state.comparePanes[pane].ww = Math.max(1, startWw + (e.clientX - startX));
        state.comparePanes[pane].wc = startWc - (e.clientY - startY);
        loadComparePane(pane);
      });
      document.addEventListener("mouseup", () => { dragging = false; });
    }
  }

  // ── Init ────────────────────────────────────────────────────────────
  bootstrap();
})();
