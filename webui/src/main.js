import "./styles.css";
import { api, configureApi } from "./api.js";
import {
  captureActiveViewport,
  initViewer,
  invertView,
  registerSeries,
  resetView,
  roiVolumeMl,
  saveAnnotations,
  setMprPrimaryPlane,
  setTool,
  show3d,
  showMpr,
  showStacks,
  toggleCine,
  viewerDiagnostics,
} from "./viewer.js";

const app = document.querySelector("#app");
const token = new URLSearchParams(location.search).get("token") || "";
configureApi(token);

const state = {
  bootstrap: null,
  archive: { root: "", series: [] },
  selectedId: "",
  compareId: "",
  mode: "single",
  tool: "window",
  downloadOpen: true,
  studies: [],
  status: "Đang khởi động...",
  sliceText: "",
  busyViewer: false,
  cine: false,
  mprPrimary: "axial",
};
let viewerQueue = Promise.resolve();
let viewerRequestId = 0;

const icons = {
  crosshair: "⊕",
  rotate3d: "⟳",
  folder: "📂",
  current: "⌂",
  single: "▣",
  compare: "▥",
  montage6: "▦",
  montage8: "▦",
  mpr: "✣",
  volume3d: "◇",
  window: "◐",
  pan: "✋",
  zoom: "⌕",
  length: "╱",
  angle: "∠",
  ellipse: "◯",
  freehand: "✎",
  reset: "↺",
  invert: "◑",
  cine: "▶",
  capture: "▧",
  save: "💾",
  volume: "㎖",
};

function selectedSeries() {
  return state.archive.series.find((item) => item.id === state.selectedId) || null;
}

function compareSeries() {
  return state.archive.series.find((item) => item.id === state.compareId) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function iconButton(id, icon, title, active = false, disabled = false, label = "") {
  return `<button class="icon-button ${active ? "active" : ""} ${label ? "with-label" : ""}" data-action="${id}"
    title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${disabled ? "disabled" : ""}>
    <span>${icon}</span>${label ? `<small>${escapeHtml(label)}</small>` : ""}
  </button>`;
}

function renderInteractionTools(series) {
  if (state.mode === "volume3d") {
    return [
      iconButton("tool-crosshair", icons.crosshair, "Kéo tâm giao điểm trên ba mặt phẳng MPR", state.tool === "crosshair", false, "Định vị MPR"),
      iconButton("tool-rotate3d", icons.rotate3d, "Kéo chuột trái để xoay mô hình", state.tool === "rotate3d", false, "Xoay 3D"),
      iconButton("tool-pan", icons.pan, "Kéo chuột trái để di chuyển mô hình", state.tool === "pan", false, "Di chuyển"),
      iconButton("tool-zoom", icons.zoom, "Kéo chuột trái để thu/phóng", state.tool === "zoom", false, "Thu/phóng"),
    ].join("");
  }
  if (state.mode === "mpr") {
    return [
      iconButton("tool-crosshair", icons.crosshair, "Kéo tâm giao điểm để định vị đồng thời ba mặt phẳng", state.tool === "crosshair", false, "Định vị"),
      iconButton("tool-window", icons.window, "Kéo chuột trái để chỉnh sáng/tương phản", state.tool === "window", false, "Sáng"),
      iconButton("tool-pan", icons.pan, "Kéo chuột trái để di chuyển ảnh", state.tool === "pan", false, "Di chuyển"),
      iconButton("tool-zoom", icons.zoom, "Kéo chuột trái để thu/phóng", state.tool === "zoom", false, "Thu/phóng"),
      iconButton("tool-length", icons.length, "Đo chiều dài theo mm", state.tool === "length", false, "Đo dài"),
      iconButton("tool-angle", icons.angle, "Đo góc", state.tool === "angle", false, "Đo góc"),
      iconButton("tool-ellipse", icons.ellipse, "Vẽ ROI ellipse và đo diện tích", state.tool === "ellipse", false, "ROI ellipse"),
      iconButton("tool-freehand", icons.freehand, "Vẽ ROI tự do và đo diện tích", state.tool === "freehand", false, "ROI tự do"),
    ].join("");
  }
  return [
    iconButton("tool-window", icons.window, "Sáng/tương phản", state.tool === "window"),
    iconButton("tool-pan", icons.pan, "Bàn tay: di chuyển ảnh", state.tool === "pan"),
    iconButton("tool-zoom", icons.zoom, "Phóng to/thu nhỏ", state.tool === "zoom"),
    iconButton("tool-length", icons.length, series?.geometry ? "Đo chiều dài (mm)" : "Đo chiều dài (pixel)", state.tool === "length"),
    iconButton("tool-angle", icons.angle, "Đo góc", state.tool === "angle"),
    iconButton("tool-ellipse", icons.ellipse, "ROI ellipse", state.tool === "ellipse"),
    iconButton("tool-freehand", icons.freehand, "ROI tự do", state.tool === "freehand"),
  ].join("");
}

function renderUtilityTools(series) {
  if (state.mode === "volume3d") {
    return [
      iconButton("reset", icons.reset, "Đặt lại góc nhìn", false, false, "Đặt lại"),
      iconButton("capture", icons.capture, "Lưu ảnh 3D hiện tại", false, false, "Lưu ảnh"),
    ].join("");
  }
  if (state.mode === "mpr") {
    return [
      iconButton("reset", icons.reset, "Đặt lại ba mặt phẳng"),
      iconButton("capture", icons.capture, "Lưu ảnh khung đang xem"),
      iconButton("save-annotations", icons.save, "Lưu đo/ROI"),
      iconButton("roi-volume", icons.volume, "Tính thể tích các ROI thủ công", false, !series?.mprReady, "Thể tích ROI"),
    ].join("");
  }
  return [
    iconButton("reset", icons.reset, "Đặt lại hiển thị"),
    iconButton("invert", icons.invert, "Đảo màu"),
    iconButton("cine", state.cine ? "Ⅱ" : icons.cine, state.cine ? "Dừng chạy phim" : "Chạy phim", state.cine, state.mode !== "single"),
    iconButton("capture", icons.capture, "Lưu ảnh khung đang xem"),
    iconButton("save-annotations", icons.save, "Lưu đo/ROI"),
    iconButton("roi-volume", icons.volume, "Tính thể tích các ROI thủ công", false, !series?.mprReady),
  ].join("");
}

function render() {
  const series = selectedSeries();
  const mprDisabled = !series?.mprReady;
  app.innerHTML = `
    <div class="app-shell ${state.downloadOpen ? "" : "download-collapsed"}">
      <header class="app-header">
        <button class="brand" data-action="toggle-download" title="Ẩn/hiện khu tải phim">
          <span class="brand-mark">D</span>
          <span><b>DCom JPG PACS</b><small>OFFLINE · v1.1</small></span>
        </button>
        <div class="series-selects">
          <label>Series
            <select data-field="series">${state.archive.series.map((item) =>
              `<option value="${item.id}" ${item.id === state.selectedId ? "selected" : ""}>
                ${escapeHtml(item.description)} · ${item.sliceCount} lát
              </option>`).join("")}
            </select>
          </label>
          ${state.mode === "compare" ? `<label>So sánh với
            <select data-field="compare">${state.archive.series.map((item) =>
              `<option value="${item.id}" ${item.id === state.compareId ? "selected" : ""}>
                ${escapeHtml(item.description)} · ${item.sliceCount} lát
              </option>`).join("")}
            </select></label>` : ""}
        </div>
        <div class="header-actions">
          ${iconButton("choose-archive", icons.folder, "Mở thư mục phim")}
          ${iconButton("refresh-archive", "⟳", "Quét lại thư mục hiện tại", false, !state.archive.root)}
          <button class="soft-button" data-action="classic" title="Khởi động lại bằng --classic">Classic</button>
        </div>
      </header>

      <aside class="download-panel">
        <div class="panel-title"><b>TẢI MRI / CT</b><button data-action="toggle-download">×</button></div>
        <div class="hospital-row">
          ${(state.bootstrap?.hospitals || []).map((item, index) =>
            `<label><input type="radio" name="hospital" value="${item.id}" ${index === 0 ? "checked" : ""}>
              ${escapeHtml(item.name)}</label>`).join("")}
        </div>
        <label class="field">Mã bệnh nhân
          <div class="inline-field"><input id="patient-id" autocomplete="off"><button data-action="search">Tìm ca</button></div>
        </label>
        <div class="study-list">${renderStudies()}</div>
        <label class="field">Hoặc dán link viewer
          <textarea id="direct-url" rows="2" spellcheck="false"></textarea>
        </label>
        <div class="download-options">
          <label>JPG <input id="quality" type="number" min="70" max="100" value="100"></label>
          <label><input id="show-browser" type="checkbox"> Hiện trình duyệt tải</label>
        </div>
        <label class="field">Thư mục lưu
          <div class="inline-field"><input id="output-root" value="${escapeHtml(state.bootstrap?.outputRoot || "")}" readonly>
            <button data-action="choose-output">…</button></div>
        </label>
        <div class="download-actions">
          <button class="primary" data-action="download-selected" ${state.studies.length ? "" : "disabled"}>Tải ca đã chọn</button>
          <button data-action="download-direct">Tải link</button>
          <button class="danger" data-action="stop-job">Dừng</button>
        </div>
        <pre class="job-log">${escapeHtml((state.bootstrap?.job?.logs || []).slice(-80).join("\n"))}</pre>
      </aside>

      <main class="viewer-main">
        <nav class="toolbar">
          <div class="tool-cluster layout-tools">
            ${iconButton("mode-single", icons.single, "Một khung ảnh", state.mode === "single")}
            ${iconButton("mode-compare", icons.compare, "So sánh hai series cạnh nhau", state.mode === "compare")}
            ${iconButton("mode-montage6", icons.montage6, "Xem tuần tự 6 lát", state.mode === "montage6", false, "6")}
            ${iconButton("mode-montage8", icons.montage8, "Xem tuần tự 8 lát", state.mode === "montage8", false, "8")}
            ${iconButton("mode-mpr", icons.mpr, mprDisabled ? series?.mprReason || "Series không đủ MPR" : "MPR ba mặt phẳng", state.mode === "mpr", mprDisabled)}
            ${iconButton("mode-volume3d", icons.volume3d, mprDisabled ? series?.mprReason || "Series không đủ 3D" : "Dựng volume 3D toàn màn hình", state.mode === "volume3d", mprDisabled, "3D")}
          </div>
          ${state.mode === "mpr" ? `<label class="mpr-primary-control">
            Khung lớn
            <select data-field="mpr-primary">
              <option value="axial" ${state.mprPrimary === "axial" ? "selected" : ""}>Axial</option>
              <option value="coronal" ${state.mprPrimary === "coronal" ? "selected" : ""}>Coronal</option>
              <option value="sagittal" ${state.mprPrimary === "sagittal" ? "selected" : ""}>Sagittal</option>
            </select>
          </label>` : ""}
          <span class="toolbar-divider"></span>
          <div class="tool-cluster interaction-tools">${renderInteractionTools(series)}</div>
          <div class="tool-cluster legacy-interaction-tools" hidden>
            ${iconButton("tool-window", icons.window, "Sáng/tương phản", state.tool === "window", state.mode === "volume3d")}
            ${iconButton("tool-pan", icons.pan, "Bàn tay: di chuyển ảnh", state.tool === "pan")}
            ${iconButton("tool-zoom", icons.zoom, "Phóng to/thu nhỏ", state.tool === "zoom")}
            ${iconButton("tool-length", icons.length, series?.geometry ? "Đo chiều dài (mm)" : "Đo chiều dài (pixel, series thiếu hình học)", state.tool === "length", state.mode === "volume3d")}
            ${iconButton("tool-angle", icons.angle, "Đo góc", state.tool === "angle", state.mode === "volume3d")}
            ${iconButton("tool-ellipse", icons.ellipse, series?.geometry ? "ROI ellipse (mm²)" : "ROI ellipse (pixel²)", state.tool === "ellipse", state.mode === "volume3d")}
            ${iconButton("tool-freehand", icons.freehand, series?.geometry ? "ROI đa giác/tự do (mm²)" : "ROI đa giác/tự do (pixel²)", state.tool === "freehand", state.mode === "volume3d")}
          </div>
          <span class="toolbar-spacer"></span>
          <div class="tool-cluster utility-tools">${renderUtilityTools(series)}</div>
          <div class="tool-cluster legacy-utility-tools" hidden>
            ${iconButton("reset", icons.reset, "Đặt lại hiển thị")}
            ${iconButton("invert", icons.invert, "Đảo màu", false, state.mode === "volume3d")}
            ${iconButton("cine", state.cine ? "Ⅱ" : icons.cine, state.cine ? "Dừng chạy phim" : "Chạy phim", state.cine, state.mode !== "single")}
            ${iconButton("capture", icons.capture, "Lưu ảnh khung đang xem")}
            ${iconButton("save-annotations", icons.save, "Lưu đo/ROI")}
            ${iconButton("roi-volume", icons.volume, "Tính thể tích các ROI thủ công", false, !series?.mprReady)}
          </div>
        </nav>

        <div class="series-strip">
          ${state.archive.series.map((item) => `<button class="series-card ${item.id === state.selectedId ? "active" : ""}"
            data-series-id="${item.id}" title="${escapeHtml(item.mprReason || item.description)}">
            <span>${item.mprReady ? "3D" : "2D"}</span>
            <b>${escapeHtml(item.description)}</b>
            <small>${item.sliceCount} lát</small>
          </button>`).join("")}
        </div>

        <section id="workspace" class="workspace-grid">
          ${state.archive.series.length
            ? `<div class="viewer-loading">${state.busyViewer ? "Đang dựng khung xem…" : ""}</div>`
            : `<div class="empty-state"><b>Mở thư mục JPG/DICOM đã chuyển</b>
              <span>Series T1 đủ hình học sẽ tự bật MPR và 3D.</span>
              <button class="primary" data-action="choose-archive">Chọn thư mục phim</button></div>`}
        </section>
        <footer class="status-bar">
          <span class="status-dot ${state.busyViewer ? "busy" : ""}"></span>
          <span>${escapeHtml(state.status)}</span>
          <span class="status-slice">${escapeHtml(state.sliceText)}</span>
          <span class="status-root">${escapeHtml(state.archive.root)}</span>
        </footer>
      </main>
    </div>
  `;
  bindEvents();
}

function renderStudies() {
  if (!state.studies.length) return '<span class="muted">Chưa tìm ca chụp.</span>';
  return state.studies.map((study, index) => `
    <label class="study-item">
      <input type="checkbox" data-study-index="${index}" checked>
      <span><b>${escapeHtml(study.modality)} · ${escapeHtml(study.date)}</b>
        <small>${escapeHtml(study.desc || study.study_uid)}</small></span>
    </label>`).join("");
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => action(element.dataset.action));
  });
  app.querySelector("[data-field='series']")?.addEventListener("change", (event) => {
    state.selectedId = event.target.value;
    const selected = selectedSeries();
    if ((state.mode === "mpr" || state.mode === "volume3d") && !selected?.mprReady) {
      state.mode = "single";
      state.tool = "window";
    }
    render();
    renderViewer();
  });
  app.querySelector("[data-field='compare']")?.addEventListener("change", (event) => {
    state.compareId = event.target.value;
    renderViewer();
  });
  app.querySelector("[data-field='mpr-primary']")?.addEventListener("change", (event) => {
    state.mprPrimary = event.target.value;
    setMprPrimaryPlane(state.mprPrimary);
  });
  app.querySelectorAll("[data-series-id]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedId = element.dataset.seriesId;
      const selected = selectedSeries();
      if ((state.mode === "mpr" || state.mode === "volume3d") && !selected?.mprReady) {
        state.mode = "single";
        state.tool = "window";
      }
      render();
      renderViewer();
    });
  });
}

async function action(name) {
  try {
    if (name === "toggle-download") {
      state.downloadOpen = !state.downloadOpen;
      app.querySelector(".app-shell")?.classList.toggle("download-collapsed", !state.downloadOpen);
      return;
    }
    if (name === "choose-archive") {
      if (!window.pywebview?.api) throw new Error("Chọn thư mục cần chạy trong ứng dụng WebView2.");
      const archive = await window.pywebview.api.choose_archive();
      if (archive) applyArchive(archive);
      return;
    }
    if (name === "choose-output") {
      const result = await window.pywebview?.api?.choose_output();
      if (result) {
        state.bootstrap.outputRoot = result.outputRoot;
        const field = app.querySelector("#output-root");
        if (field) field.value = result.outputRoot;
      }
      return;
    }
    if (name === "refresh-archive") {
      applyArchive(await api("/api/archive/open", {
        method: "POST",
        body: JSON.stringify({ path: state.archive.root }),
      }));
      return;
    }
    if (name === "search") {
      const patientId = app.querySelector("#patient-id").value.trim();
      const hospital = app.querySelector("input[name='hospital']:checked")?.value;
      await api("/api/search", { method: "POST", body: JSON.stringify({ patientId, hospital }) });
      startJobPolling();
      return;
    }
    if (name === "download-selected") {
      const studies = [...app.querySelectorAll("[data-study-index]:checked")]
        .map((item) => state.studies[Number(item.dataset.studyIndex)]);
      await api("/api/download", {
        method: "POST",
        body: JSON.stringify({ studies, ...downloadOptions() }),
      });
      startJobPolling();
      return;
    }
    if (name === "download-direct") {
      await api("/api/download/direct", {
        method: "POST",
        body: JSON.stringify({ url: app.querySelector("#direct-url").value.trim(), ...downloadOptions() }),
      });
      startJobPolling();
      return;
    }
    if (name === "stop-job") {
      await api("/api/job/stop", { method: "POST", body: "{}" });
      return;
    }
    if (name?.startsWith("mode-")) {
      state.mode = name.slice(5);
      if (state.mode === "volume3d") {
        state.tool = "rotate3d";
      } else if (state.mode === "mpr") {
        state.tool = "crosshair";
      } else if (state.tool === "rotate3d" || state.tool === "crosshair") {
        state.tool = "window";
      }
      if (state.mode === "compare" && !state.compareId) {
        state.compareId = state.archive.series.find((item) => item.id !== state.selectedId)?.id || state.selectedId;
      }
      render();
      await renderViewer();
      return;
    }
    if (name?.startsWith("tool-")) {
      state.tool = name.slice(5);
      setTool(state.tool);
      app.querySelectorAll(".interaction-tools .icon-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.action === name);
      });
      return;
    }
    if (name === "reset") resetView();
    if (name === "invert") invertView();
    if (name === "cine") {
      state.cine = toggleCine(selectedSeries(), (index) => {
        state.sliceText = `${index + 1}/${selectedSeries().sliceCount}`;
        updateStatusOnly();
      });
      const button = app.querySelector("[data-action='cine']");
      if (button) {
        button.classList.toggle("active", state.cine);
        button.querySelector("span").textContent = state.cine ? "Ⅱ" : icons.cine;
        button.title = state.cine ? "Dừng chạy phim" : "Chạy phim";
      }
    }
    if (name === "capture") await captureActiveViewport();
    if (name === "save-annotations") {
      const count = await saveAnnotations();
      setStatus(`Đã lưu ${count} phép đo/ROI vào thư mục series.`);
    }
    if (name === "roi-volume") {
      const volume = roiVolumeMl();
      setStatus(`Thể tích ROI thủ công: ${volume.toFixed(2)} mL (tổng diện tích lát × khoảng cách lát).`);
    }
    if (name === "classic") {
      if (!window.pywebview?.api) throw new Error("Chế độ classic chỉ có trong ứng dụng desktop.");
      await window.pywebview.api.restart_classic();
    }
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

function downloadOptions() {
  return {
    outputRoot: state.bootstrap.outputRoot,
    quality: Number(app.querySelector("#quality").value || 100),
    showBrowser: app.querySelector("#show-browser").checked,
  };
}

function applyArchive(archive) {
  state.archive = archive;
  for (const series of archive.series) registerSeries(series);
  if (!archive.series.some((item) => item.id === state.selectedId)) {
    state.selectedId = archive.series[0]?.id || "";
  }
  if (!archive.series.some((item) => item.id === state.compareId)) {
    state.compareId = archive.series.find((item) => item.id !== state.selectedId)?.id || state.selectedId;
  }
  state.mode = "single";
  state.tool = "window";
  render();
  renderViewer();
}

function renderViewer() {
  const series = selectedSeries();
  const mode = state.mode;
  const comparison = compareSeries();
  if (!series) return viewerQueue;
  const requestId = ++viewerRequestId;
  const requestedWorkspace = document.querySelector("#workspace");
  if (!requestedWorkspace) return viewerQueue;
  const immediateLoadingText = mode === "mpr"
    ? `Đang dựng MPR từ ${series.sliceCount} lát…`
    : mode === "volume3d"
      ? `Đang dựng mô hình 3D từ ${series.sliceCount} lát…`
      : "Đang mở ảnh…";
  state.busyViewer = true;
  window.__viewerReadyMode = "";
  requestedWorkspace.dataset.loadingText = immediateLoadingText;
  requestedWorkspace.classList.add("busy");
  app.querySelector(".status-dot")?.classList.add("busy");
  setStatus(immediateLoadingText);

  const renderTask = async () => {
    const workspace = requestedWorkspace;
    if (requestId !== viewerRequestId || !workspace.isConnected) {
      workspace.classList.remove("busy");
      delete workspace.dataset.loadingText;
      return;
    }
    state.busyViewer = true;
    window.__viewerReadyMode = "";
    const loadingText = mode === "mpr"
      ? `Đang dựng MPR từ ${series.sliceCount} lát…`
      : mode === "volume3d"
        ? `Đang dựng mô hình 3D từ ${series.sliceCount} lát…`
        : "Đang mở ảnh…";
    workspace.dataset.loadingText = loadingText;
    workspace.classList.add("busy");
    app.querySelector(".status-dot")?.classList.add("busy");
    setStatus(loadingText);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (requestId !== viewerRequestId || !workspace.isConnected) return;
      if (mode === "mpr") {
        await showMpr(workspace, series, state.mprPrimary);
      } else if (mode === "volume3d") {
        await show3d(workspace, series);
      } else {
        await showStacks(workspace, series, mode, comparison);
      }
      if (requestId !== viewerRequestId || !workspace.isConnected) return;
      window.__lastViewerError = null;
      window.__viewerReadyMode = mode;
      window.__viewerDiagnostics = viewerDiagnostics();
    } catch (error) {
      if (requestId !== viewerRequestId || !workspace.isConnected) return;
      window.__lastViewerError = {
        message: error?.message || String(error),
        stack: error?.stack || "",
      };
      workspace.innerHTML = `<div class="empty-state error"><b>Không mở được khung xem</b><span>${escapeHtml(error.message)}</span></div>`;
      setStatus(error.message, true);
    } finally {
      workspace.classList.remove("busy");
      delete workspace.dataset.loadingText;
      if (requestId === viewerRequestId) {
        state.busyViewer = false;
        app.querySelector(".status-dot")?.classList.remove("busy");
      }
    }
  };

  // Cornerstone shares one rendering engine/cache. Serialize layout changes so
  // a rapid click cannot destroy an engine while its stack/volume is loading.
  viewerQueue = viewerQueue.catch(() => undefined).then(renderTask);
  return viewerQueue;
}

function setStatus(message, isError = false) {
  state.status = message;
  const bar = app.querySelector(".status-bar");
  if (bar) {
    bar.classList.toggle("error", isError);
    const span = bar.querySelector("span:nth-child(2)");
    if (span) span.textContent = message;
  }
}

function updateStatusOnly() {
  const element = app.querySelector(".status-slice");
  if (element) element.textContent = state.sliceText;
}

let jobPoll = null;
function startJobPolling() {
  if (jobPoll) window.clearInterval(jobPoll);
  jobPoll = window.setInterval(pollJob, 1000);
  pollJob();
}

async function pollJob() {
  const job = await api("/api/job");
  state.bootstrap.job = job;
  if (job.kind === "search" && job.status === "complete") {
    state.studies = job.result || [];
    render();
    if (state.archive.series.length) await renderViewer();
  }
  if ((job.kind === "download" || job.kind === "direct-download") && job.status === "complete") {
    const archive = job.result?.archive;
    if (archive) {
      window.clearInterval(jobPoll);
      jobPoll = null;
      applyArchive(archive);
      return;
    }
  }
  const log = app.querySelector(".job-log");
  if (log) {
    log.textContent = (job.logs || []).slice(-80).join("\n");
    log.scrollTop = log.scrollHeight;
  }
  setStatus(job.message || job.status);
  if (["complete", "error", "stopped"].includes(job.status)) {
    window.clearInterval(jobPoll);
    jobPoll = null;
  }
}

async function boot() {
  if (!token) throw new Error("Thiếu token phiên local.");
  state.bootstrap = await api("/api/bootstrap");
  state.archive = state.bootstrap.archive;
  state.selectedId = state.archive.series[0]?.id || "";
  state.compareId = state.archive.series[1]?.id || state.selectedId;
  for (const series of state.archive.series) registerSeries(series);
  await initViewer({
    onStatus: (message) => setStatus(message),
    onSlice: ({ index, count }) => {
      state.sliceText = `${index + 1}/${count}`;
      updateStatusOnly();
    },
  });
  state.status = "Sẵn sàng.";
  render();
  await renderViewer();
}

boot().catch((error) => {
  app.innerHTML = `<div class="fatal-error"><b>Không khởi động được DCom JPG PACS</b><pre>${escapeHtml(error.stack || error.message)}</pre></div>`;
});
