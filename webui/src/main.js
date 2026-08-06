import "./styles.css";
import { api, configureApi } from "./api.js";
import { getLanguage, setLanguage, t, tf, translateLog } from "./i18n.js";
import {
  applyWindowPreset,
  availableWindowPresets,
  captureActiveViewport,
  clearActiveMeasurements,
  defaultWindowPreset,
  disposeViewer,
  flipActiveViewportHorizontal,
  initViewer,
  invertView,
  persistActiveAnnotations,
  registerSeries,
  resetView,
  roiVolumeMl,
  rotateActiveViewportClockwise,
  saveAnnotations,
  seriesSafetyNotice,
  seriesSupportsHounsfield,
  setTool,
  show3d,
  showMpr,
  showStacks,
  stepSlice,
  toggleCine,
  viewerDiagnostics,
} from "./viewer.js";

const app = document.querySelector("#app");
const sessionUrl = new URL(location.href);
let sessionToken = sessionUrl.searchParams.get("token") || "";
configureApi(sessionToken);
const hasSessionToken = Boolean(sessionToken);
sessionToken = "";
sessionUrl.searchParams.delete("token");
history.replaceState(
  history.state,
  "",
  `${sessionUrl.pathname}${sessionUrl.search}${sessionUrl.hash}`,
);

const state = {
  bootstrap: null,
  archive: { root: "", series: [] },
  selectedId: "",
  compareId: "",
  mode: "single",
  tool: "window",
  downloadOpen: true,
  studies: [],
  patient: null,
  status: "Đang khởi động...",
  sliceText: "",
  busyViewer: false,
  cine: false,
  mprPrimary: "axial",
  windowPreset: "full",
  history: [],
  // The last folder a direct link filled. A retry has to merge into it instead
  // of creating a second folder for the same study.
  lastDirectUrl: "",
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
  zoom: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5"></circle>
    <path d="M15.5 15.5 21 21"></path>
  </svg>`,
  length: "╱",
  angle: "∠",
  ellipse: "◯",
  freehand: "✎",
  reset: "↺",
  rotateClockwise: "↻",
  flipHorizontal: "↔",
  clearAnnotations: "×",
  invert: "◑",
  cine: "▶",
  capture: "▧",
  save: "💾",
  volume: "㎖",
  history: "🕘",
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
  // Mode, tool and cine buttons are stateful, so screen readers need the state
  // that the highlight conveys visually.
  const stateful = /^(mode-|tool-)/.test(id) || id === "cine";
  return `<button class="icon-button ${active ? "active" : ""} ${label ? "with-label" : ""}" data-action="${id}"
    title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"
    ${stateful ? `aria-pressed="${active ? "true" : "false"}"` : ""} ${disabled ? "disabled" : ""}>
    <span>${icon}</span>${label ? `<small>${escapeHtml(label)}</small>` : ""}
  </button>`;
}

function renderInteractionTools(series) {
  if (state.mode === "volume3d") {
    return [
      iconButton("tool-crosshair", icons.crosshair, t("Định vị MPR"), state.tool === "crosshair"),
      iconButton("tool-rotate3d", icons.rotate3d, t("Xoay 3D"), state.tool === "rotate3d"),
      iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
      iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
    ].join("");
  }
  if (state.mode === "mpr") {
    return [
      iconButton("tool-crosshair", icons.crosshair, t("Định vị MPR"), state.tool === "crosshair"),
      iconButton("tool-window", icons.window, t("Sáng/tương phản"), state.tool === "window"),
      iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
      iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
      iconButton("tool-length", icons.length, t("Đo chiều dài (mm)"), state.tool === "length"),
      iconButton("tool-angle", icons.angle, t("Đo góc"), state.tool === "angle"),
      iconButton("tool-ellipse", icons.ellipse, t("ROI ellipse"), state.tool === "ellipse"),
      iconButton("tool-freehand", icons.freehand, t("ROI tự do"), state.tool === "freehand"),
    ].join("");
  }
  return [
    iconButton("tool-window", icons.window, t("Sáng/tương phản"), state.tool === "window"),
    iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
    iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
    iconButton("tool-length", icons.length,
      t(series?.geometry ? "Đo chiều dài (mm)" : "Đo chiều dài (pixel)"), state.tool === "length"),
    iconButton("tool-angle", icons.angle, t("Đo góc"), state.tool === "angle"),
    iconButton("tool-ellipse", icons.ellipse, t("ROI ellipse"), state.tool === "ellipse"),
    iconButton("tool-freehand", icons.freehand, t("ROI tự do"), state.tool === "freehand"),
  ].join("");
}

function renderUtilityTools(series) {
  const viewportActions = [
    iconButton("reset", icons.reset, t(state.mode === "mpr"
      ? "Đặt lại ba mặt phẳng"
      : state.mode === "volume3d"
        ? "Đặt lại góc nhìn"
        : "Đặt lại hiển thị")),
    iconButton("clear-annotations", icons.clearAnnotations, t("Xóa tất cả đo dài, đo góc và ROI")),
    iconButton("rotate-clockwise", icons.rotateClockwise, t("Xoay khung đang chọn 90° theo chiều kim đồng hồ")),
    iconButton("flip-horizontal", icons.flipHorizontal, t("Lật ngang khung đang chọn")),
  ];
  if (state.mode === "volume3d") {
    return [
      ...viewportActions,
      iconButton("capture", icons.capture, t("Lưu ảnh 3D")),
    ].join("");
  }
  if (state.mode === "mpr") {
    return [
      ...viewportActions,
      iconButton("capture", icons.capture, t("Lưu ảnh")),
      iconButton("save-annotations", icons.save, t("Lưu đo/ROI")),
      iconButton("roi-volume", icons.volume, t("Tính thể tích ROI"), false, !series?.mprReady),
    ].join("");
  }
  return [
    ...viewportActions,
    iconButton("invert", icons.invert, t("Đảo màu")),
    iconButton("cine", state.cine ? "Ⅱ" : icons.cine,
      t(state.cine ? "Dừng chạy phim" : "Chạy phim"), state.cine, state.mode !== "single"),
    iconButton("capture", icons.capture, t("Lưu ảnh")),
    iconButton("save-annotations", icons.save, t("Lưu đo/ROI")),
    iconButton("roi-volume", icons.volume, t("Tính thể tích ROI"), false, !series?.mprReady),
  ].join("");
}

function renderHistoryOptions() {
  if (!state.history.length) {
    return `<option value="" disabled selected>${escapeHtml(t("Chưa có lịch sử"))}</option>`;
  }
  const options = state.history.map((item, index) => {
    const name = String(item.folder).split(/[\\/]/).filter(Boolean).pop() || item.folder;
    const suffix = item.exists ? "" : ` ${t("(thư mục không còn)")}`;
    return `<option value="${index}" ${item.exists ? "" : "disabled"}
      title="${escapeHtml(item.folder)}">${escapeHtml(`${item.time}  •  ${name}${suffix}`)}</option>`;
  }).join("");
  return `<option value="" selected>${escapeHtml(t("Lịch sử"))}…</option>${options}`;
}

function formatGroupLabel(groupKey) {
  if (!groupKey || groupKey === "Không rõ ca chụp") return t("📁 Ca chụp chưa phân loại");
  const parts = groupKey.split(" - ");
  if (parts.length >= 2) {
    const dateStr = parts[0];
    const modality = parts[1];
    const desc = parts.slice(2).join(" - ");
    let dateFmt = dateStr;
    const dp = dateStr.split("-");
    if (dp.length === 3) dateFmt = `${dp[2]}/${dp[1]}`;
    const extra = [modality, desc].filter(Boolean).join(" ");
    return getLanguage() === "en"
      ? `📁 ${dateFmt} (${extra})`
      : `📁 Ngày ${dateFmt} (${extra})`;
  }
  return `📁 ${groupKey}`;
}

function renderSeriesOptions(archive, selectedId) {
  const groups = {};
  for (const item of archive.series) {
    const groupKey = item.studyGroup || "Khác";
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(item);
  }
  return Object.entries(groups).map(([groupKey, items]) => {
    const options = items.map((item) =>
      `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>
        ▪ ${escapeHtml(item.description)} · ${item.sliceCount} ${escapeHtml(t("lát"))}
      </option>`
    ).join("");
    return `<optgroup label="${escapeHtml(formatGroupLabel(groupKey))}">${options}</optgroup>`;
  }).join("");
}

function windowPresetHint(series) {
  if (seriesSupportsHounsfield(series)) {
    return "Cửa sổ Hounsfield chuẩn, tính trực tiếp trên pixel CT gốc";
  }
  if (series?.sourceType === "dicom") {
    // MR has no absolute intensity scale, so no fixed window can be offered.
    return "Cửa sổ hiển thị trên pixel DICOM gốc, quy chiếu theo WC/WW trong file";
  }
  return "Preset thị giác trên dữ liệu ảnh 8-bit";
}

function render() {
  const series = selectedSeries();
  // Switching from a CT to an MR series strands any Hounsfield preset, which
  // that series cannot honour. Fall back before the select is drawn so the
  // control never shows a preset that is not in force.
  if (!availableWindowPresets(series).some((item) => item.id === state.windowPreset)) {
    state.windowPreset = defaultWindowPreset(series);
  }
  const safety = seriesSafetyNotice(series);
  const mprDisabled = !series?.mprReady;
  app.innerHTML = `
    <div class="app-shell ${state.downloadOpen ? "" : "download-collapsed"}">
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">D</span>
          <span><b>DICOM/JPG Downloader & Viewer</b><small>OFFLINE · v1.1</small></span>
        </div>
        <div class="series-selects">
          <label>${escapeHtml(t("Series"))}
            <select data-field="series">${renderSeriesOptions(state.archive, state.selectedId)}</select>
          </label>
          ${state.mode === "compare" ? `<label>${escapeHtml(t("So sánh với"))}
            <select data-field="compare">${renderSeriesOptions(state.archive, state.compareId)}</select></label>` : ""}
        </div>
        <div class="header-actions">
          ${iconButton(
        "toggle-download",
        state.downloadOpen ? "⇤" : "⇥",
        t(state.downloadOpen ? "Thu gọn khu tải phim" : "Mở khu tải phim"),
        state.downloadOpen,
        false,
        t("Tải phim"),
      )}
          ${iconButton("choose-archive", icons.folder, t("Mở folder DICOM hoặc JPG/PNG trong viewer"))}
          ${iconButton("refresh-archive", "⟳", t("Quét lại thư mục hiện tại"), false, !state.archive.root)}
          <button class="soft-button" data-action="toggle-language"
            title="${escapeHtml(t("Chuyển sang tiếng Anh"))}">${getLanguage() === "en" ? "VI" : "EN"}</button>
          <button class="soft-button" data-action="classic"
            title="${escapeHtml(t("Khởi động lại bằng --classic"))}">Classic</button>
        </div>
      </header>

      <aside class="download-panel">
        <div class="panel-title"><b>${escapeHtml(t("TẢI MRI / CT"))}</b>
          <button data-action="toggle-download" title="${escapeHtml(t("Thu gọn khu tải phim"))}">×</button></div>
        <label class="field history-field">${icons.history} ${escapeHtml(t("Lịch sử"))}
          <select data-field="history" title="${escapeHtml(t("Mở lại thư mục đã tải hoặc đã xem"))}"
            ${state.history.length ? "" : "disabled"}>${renderHistoryOptions()}</select>
        </label>
        <section class="dicom-source-card">
          <button data-action="import-dicom-folder"
            title="${escapeHtml(t("Tính năng xuất JPG riêng; không dùng để mở DICOM trong viewer."))}">${escapeHtml(t("Chuyển Dcom → JPG"))}</button>
        </section>
        <div class="hospital-row">
          ${(state.bootstrap?.hospitals || []).map((item, index) =>
        `<label><input type="radio" name="hospital" value="${item.id}"
          ${state.patient?.hospitalKey ? (item.id === state.patient.hospitalKey ? "checked" : "") : ((item.isDefault ?? (index === 0)) ? "checked" : "")}>
              ${escapeHtml(item.name)}</label>`).join("")}
        </div>
        <label class="field">${escapeHtml(t("Mã bệnh nhân"))}
          <div class="inline-field"><input id="patient-id" autocomplete="off" value="${escapeHtml(state.patient?.patientId || "")}">
            <button data-action="search" title="${escapeHtml(t("Tìm các ca MRI/CT của mã bệnh nhân này trên RIS"))}">${escapeHtml(t("Tìm ca"))}</button></div>
        </label>
        <div class="patient-status">${renderPatientStatus()}</div>
        <div class="study-list">${renderStudies()}</div>
        <div class="download-actions">
          <button class="primary" data-action="download-selected"
            title="${escapeHtml(t("Tải các ca đang tích ở danh sách trên"))}"
            ${state.studies.some((item) => item.local_status !== "downloaded") && !state.patient?.nameConflict ? "" : "disabled"}>${escapeHtml(t("Tải ca đã chọn"))}</button>
          <button class="danger" data-action="stop-job"
            title="${escapeHtml(t("Dừng an toàn tác vụ đang chạy"))}">${escapeHtml(t("Dừng"))}</button>
        </div>
        <label class="field">${escapeHtml(t("Hoặc dán link viewer"))}
          <textarea id="direct-url" rows="2" spellcheck="false">${escapeHtml(state.lastDirectUrl)}</textarea>
        </label>
        <div class="link-actions">
          <button data-action="download-direct"
            title="${escapeHtml(t("Tải mới từ link đã dán vào một folder riêng"))}">${escapeHtml(t("Tải link"))}</button>
          <button data-action="download-retry"
            title="${escapeHtml(t("Thử lại link vừa dán và gộp vào folder cũ, bỏ qua ảnh đã có"))}">${escapeHtml(t("Thử lại"))}</button>
        </div>
        <div class="download-options">
          <label title="${escapeHtml(t("Chất lượng JPG (70-100)"))}">JPG
            <input id="quality" type="number" min="70" max="100" value="100"></label>
          <label><input id="show-browser" type="checkbox"> ${escapeHtml(t("Hiện trình duyệt tải"))}</label>
        </div>
        <label class="field">${escapeHtml(t("Thư mục lưu"))}
          <div class="inline-field"><input id="output-root" value="${escapeHtml(state.bootstrap?.outputRoot || "")}" readonly>
            <button data-action="choose-output" title="${escapeHtml(t("Đổi thư mục lưu"))}">…</button></div>
        </label>
        <pre class="job-log">${escapeHtml((state.bootstrap?.job?.logs || []).slice(-80).map(translateLog).join("\n"))}</pre>
        <div class="panel-credit">Superkent.bui@gmail.com</div>
      </aside>

      <main class="viewer-main">
        <nav class="toolbar mode-${state.mode}">
          <div class="tool-cluster layout-tools">
            ${iconButton("mode-single", icons.single, t("Một khung ảnh"), state.mode === "single")}
            ${iconButton("mode-compare", icons.compare, t("So sánh hai series cạnh nhau"), state.mode === "compare")}
            ${iconButton("mode-montage6", icons.montage6, t("Xem tuần tự 6 lát"), state.mode === "montage6", false, "6")}
            ${iconButton("mode-montage8", icons.montage8, t("Xem tuần tự 8 lát"), state.mode === "montage8", false, "8")}
            ${iconButton("mode-mpr", icons.mpr, mprDisabled ? series?.mprReason || t("Series không đủ MPR") : t("MPR ba mặt phẳng"), state.mode === "mpr", mprDisabled)}
            ${iconButton("mode-volume3d", icons.volume3d, mprDisabled ? series?.mprReason || t("Series không đủ 3D") : t("Dựng volume 3D toàn màn hình"), state.mode === "volume3d", mprDisabled, "3D")}
          </div>
          ${state.mode !== "volume3d" ? `<label class="window-preset-control">
            ${escapeHtml(t("Hiển thị"))}
            <select data-field="window-preset" title="${escapeHtml(t(windowPresetHint(series)))}">
              ${availableWindowPresets(series).map((preset) => `<option value="${preset.id}" ${state.windowPreset === preset.id ? "selected" : ""}>${escapeHtml(preset.detail ? `${t(preset.label)} · ${preset.detail}` : t(preset.label))}</option>`).join("")}
            </select>
          </label>` : ""}
          <span class="toolbar-divider"></span>
          <div class="tool-cluster interaction-tools">${renderInteractionTools(series)}</div>
          <span class="toolbar-spacer"></span>
          <div class="tool-cluster utility-tools">${renderUtilityTools(series)}</div>
          ${iconButton("shortcuts", "⌨", t("Xem danh sách phím tắt"))}
        </nav>

        <div class="series-strip">
          ${state.archive.series.map((item) => `<button class="series-card ${item.id === state.selectedId ? "active" : ""}"
            data-series-id="${item.id}" title="${escapeHtml(item.mprReason || item.description)}">
            <span>${item.mprReady ? "3D" : "2D"}</span>
            <b>${escapeHtml(item.description)}</b>
            <small>${item.sliceCount} ${escapeHtml(t("lát"))}</small>
          </button>`).join("")}
        </div>

        <div class="safety-notice ${safety?.level || ""}" ${safety ? "" : "hidden"}>
          <b>${escapeHtml(t("An toàn hiển thị"))}</b><span>${escapeHtml(safety ? t(safety.text) : "")}</span>
        </div>
        <section id="workspace" class="workspace-grid">
          ${state.archive.series.length
      ? `<div class="viewer-loading">${state.busyViewer ? escapeHtml(t("Đang dựng khung xem…")) : ""}</div>`
      : `<div class="empty-state"><b>${escapeHtml(t("Mở folder DICOM hoặc JPG/PNG"))}</b>
              <span>${escapeHtml(t("DICOM được đọc trực tiếp với pixel gốc; không tạo JPG trung gian. Geometry hợp lệ sẽ bật MPR/3D."))}</span>
              <div class="empty-actions"><button class="primary" data-action="choose-archive">${escapeHtml(t("Mở folder trong viewer"))}</button></div></div>`}
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
  if (!state.studies.length) return `<span class="muted">${escapeHtml(t("Chưa tìm ca chụp."))}</span>`;
  return state.studies.map((study, index) => `
    <label class="study-item">
      <input type="checkbox" data-study-index="${index}"
        ${study.local_status === "downloaded" || state.patient?.nameConflict ? "" : "checked"}
        ${state.patient?.nameConflict ? "disabled" : ""}>
      <span><b>${escapeHtml(study.modality)} · ${escapeHtml(study.date)}</b>
        <small>${escapeHtml(study.desc || study.study_uid)}</small>
        <em class="study-state ${escapeHtml(study.local_status || "new")}">${escapeHtml(t({
          downloaded: "Đã tải",
          incomplete: "Tải chưa hoàn tất",
          new: "Phim mới",
        }[study.local_status] || "Phim mới"))}</em></span>
    </label>`).join("");
}

function renderPatientStatus() {
  const patient = state.patient;
  if (!patient) return "";
  if (patient.nameConflict) {
    return `<div class="patient-alert danger"><b>${escapeHtml(t("Không tự động gộp bệnh nhân"))}</b>
      <span>${escapeHtml(tf(
        "Mã {} đã lưu tên “{}”, nhưng RIS trả “{}”. Hãy kiểm tra lại.",
        patient.patientId, patient.storedPatientName, patient.patientName,
      ))}</span></div>`;
  }
  if (!patient.patientName) {
    return `<div class="patient-alert warning"><b>${escapeHtml(patient.patientId)} · ${escapeHtml(patient.hospitalName)}</b>
      <span>${escapeHtml(t("RIS chưa trả tên bệnh nhân. App vẫn có thể tải nhưng folder sẽ ghi CHUA_RO_TEN; hãy kiểm tra tên trên RIS/DICOM."))}</span></div>`;
  }
  const identity = [patient.patientId, patient.patientName, patient.hospitalName]
    .filter(Boolean).map(escapeHtml).join(" · ");
  const summary = patient.exists
    ? tf(
      "Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất",
      patient.downloadedStudies, patient.newStudies, patient.incompleteStudies,
    )
    : tf("{} ca chưa có trong kho; app sẽ tạo một folder bệnh nhân.", patient.newStudies);
  const legacy = patient.legacyStudiesDetected
    ? ` · ${tf("Đã nhận diện {} ca từ folder Classic cũ", patient.legacyStudiesDetected)}`
    : "";
  return `<div class="patient-alert ${patient.exists ? "existing" : "new"}">
    <b>${identity}</b><span>${summary}${legacy}</span>
    ${patient.folder ? `<small>${escapeHtml(patient.folder)}</small>` : ""}</div>`;
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => action(element.dataset.action));
  });
  app.querySelector(".app-header [data-action='toggle-download']")
    ?.setAttribute("aria-expanded", state.downloadOpen ? "true" : "false");
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
  app.querySelector("[data-field='history']")?.addEventListener("change", (event) => {
    const entry = state.history[Number(event.target.value)];
    event.target.selectedIndex = 0;
    if (entry) openHistoryEntry(entry);
  });
  app.querySelector("[data-field='window-preset']")?.addEventListener("change", async (event) => {
    state.windowPreset = event.target.value;
    await applyWindowPreset(state.windowPreset);
    window.__viewerDiagnostics = viewerDiagnostics();
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
  app.querySelectorAll("[data-study-index]").forEach((item) => {
    item.addEventListener("change", syncDownloadButton);
  });
  syncDownloadButton();
}

function syncDownloadButton() {
  const button = app.querySelector("[data-action='download-selected']");
  if (button) button.disabled = Boolean(state.patient?.nameConflict)
    || !app.querySelector("[data-study-index]:checked");
}

async function openHistoryEntry(entry) {
  try {
    // Re-opening restores the link that filled the folder, so a retry after a
    // restart still knows which link to resume.
    state.lastDirectUrl = entry.url || "";
    const field = app.querySelector("#direct-url");
    if (field) field.value = state.lastDirectUrl;
    state.bootstrap.job = await api("/api/history/open", {
      method: "POST",
      body: JSON.stringify({ folder: entry.folder }),
    });
    setStatus(t("Đang mở lại thư mục từ lịch sử…"));
    startJobPolling();
  } catch (error) {
    setStatus(humanError(error), true);
  }
}

async function refreshHistory() {
  try {
    const result = await api("/api/history");
    state.history = Array.isArray(result?.history) ? result.history : [];
    const select = app.querySelector("[data-field='history']");
    if (select) {
      select.innerHTML = renderHistoryOptions();
      select.disabled = !state.history.length;
    }
  } catch (_) {
    // History is a convenience; a failed refresh must not disturb the session.
  }
}

async function action(name) {
  try {
    if (name === "toggle-download") {
      state.downloadOpen = !state.downloadOpen;
      app.querySelector(".app-shell")?.classList.toggle("download-collapsed", !state.downloadOpen);
      const toggle = app.querySelector(".app-header [data-action='toggle-download']");
      if (toggle) {
        toggle.classList.toggle("active", state.downloadOpen);
        toggle.setAttribute("aria-expanded", state.downloadOpen ? "true" : "false");
        toggle.title = t(state.downloadOpen ? "Thu gọn khu tải phim" : "Mở khu tải phim");
        const icon = toggle.querySelector("span");
        if (icon) icon.textContent = state.downloadOpen ? "⇤" : "⇥";
      }
      return;
    }
    if (name === "toggle-language") {
      // The download panel keeps live text (link, patient code, job log), so
      // the fields are carried across the re-render instead of being reset.
      const url = app.querySelector("#direct-url")?.value ?? state.lastDirectUrl;
      const patientId = app.querySelector("#patient-id")?.value ?? "";
      const quality = app.querySelector("#quality")?.value ?? "100";
      const showBrowser = app.querySelector("#show-browser")?.checked ?? false;
      setLanguage(getLanguage() === "en" ? "vi" : "en");
      state.lastDirectUrl = url;
      render();
      const patientField = app.querySelector("#patient-id");
      if (patientField) patientField.value = patientId;
      const qualityField = app.querySelector("#quality");
      if (qualityField) qualityField.value = quality;
      const browserField = app.querySelector("#show-browser");
      if (browserField) browserField.checked = showBrowser;
      setStatus(state.status);
      await api("/api/settings/language", {
        method: "POST",
        body: JSON.stringify({ language: getLanguage() }),
      });
      // render() replaced #workspace, so the Cornerstone canvases went with it.
      // The layout has to be rebuilt exactly as a mode change does, otherwise
      // the viewer is left blank after switching language.
      await renderViewer();
      return;
    }
    if (name === "choose-archive") {
      if (!window.pywebview?.api) throw new Error(t("Chọn thư mục cần chạy trong ứng dụng WebView2."));
      const job = await window.pywebview.api.choose_archive();
      if (job) {
        state.bootstrap.job = job;
        setStatus(t("Đang nhận diện DICOM hoặc JPG/PNG trong folder…"));
        startJobPolling();
      }
      return;
    }
    if (name === "import-dicom-folder") {
      if (!window.pywebview?.api) throw new Error(t("Nhập DICOM local cần chạy trong ứng dụng WebView2."));
      const job = await window.pywebview.api.choose_dicom_folder(downloadOptions());
      if (job) {
        state.bootstrap.job = job;
        setStatus(t("Đang đọc và chuyển folder DICOM local…"));
        startJobPolling();
      }
      return;
    }
    if (name === "choose-output") {
      const result = await window.pywebview?.api?.choose_output();
      if (result) {
        state.bootstrap.outputRoot = result.outputRoot;
        state.studies = [];
        state.patient = null;
        const field = app.querySelector("#output-root");
        if (field) field.value = result.outputRoot;
        renderStudyList();
        setStatus(t("Đã đổi kho lưu; hãy tìm lại mã bệnh nhân để đối chiếu phim cũ/mới."));
      }
      return;
    }
    if (name === "refresh-archive") {
      state.bootstrap.job = await api("/api/archive/scan", {
        method: "POST",
        body: JSON.stringify({ path: state.archive.root }),
      });
      setStatus(t("Đang quét lại thư mục phim trong nền…"));
      startJobPolling();
      return;
    }
    if (name === "search") {
      const patientId = app.querySelector("#patient-id").value.trim();
      const hospital = app.querySelector("input[name='hospital']:checked")?.value;
      state.studies = [];
      state.patient = null;
      renderStudyList();
      await api("/api/search", { method: "POST", body: JSON.stringify({ patientId, hospital }) });
      startJobPolling();
      return;
    }
    if (name === "download-selected") {
      if (state.patient?.nameConflict) throw new Error(t("Tên bệnh nhân không khớp; app đã chặn tự động gộp."));
      const studies = [...app.querySelectorAll("[data-study-index]:checked")]
        .map((item) => state.studies[Number(item.dataset.studyIndex)]);
      if (!studies.length) throw new Error(t("Không có phim mới/chưa hoàn tất được chọn để tải."));
      await api("/api/download", {
        method: "POST",
        body: JSON.stringify({
          studies,
          patientId: state.patient?.patientId,
          patientName: state.patient?.patientName,
          hospital: state.patient?.hospitalKey,
          allStudies: state.studies,
          ...downloadOptions(),
        }),
      });
      startJobPolling();
      return;
    }
    if (name === "download-direct" || name === "download-retry") {
      const url = app.querySelector("#direct-url").value.trim();
      if (!url) throw new Error(t("Chưa có link viewer để tải."));
      state.lastDirectUrl = url;
      await api("/api/download/direct", {
        method: "POST",
        body: JSON.stringify({
          url,
          // A retry merges into the folder the first attempt created and skips
          // slices already on disk; these viewer links expire fast, so
          // re-downloading everything is often not even possible.
          resume: name === "download-retry",
          ...downloadOptions(),
        }),
      });
      startJobPolling();
      return;
    }
    if (name === "stop-job") {
      await api("/api/job/stop", { method: "POST", body: "{}" });
      return;
    }
    if (name?.startsWith("mode-")) {
      const mode = name.slice(5);
      if (mode === state.mode) return;
      state.mode = mode;
      state.tool = defaultToolForMode(mode, state.tool);
      state.cine = false;
      if (state.mode === "compare" && !state.compareId) {
        state.compareId = state.archive.series.find((item) => item.id !== state.selectedId)?.id || state.selectedId;
      }
      render();
      await renderViewer();
      return;
    }
    if (name?.startsWith("tool-")) {
      // setTool reports the tool actually in force, so the highlight can never
      // claim a tool the current layout refused.
      state.tool = setTool(name.slice(5));
      syncToolHighlight();
      return;
    }
    if (name === "shortcuts") {
      setStatus(t(SHORTCUT_HINT));
      return;
    }
    if (name === "reset") {
      state.windowPreset = defaultWindowPreset(selectedSeries());
      resetView();
      // resetProperties restores the file's own window, so the preset has to be
      // re-applied or the select would name a window that is not on screen.
      await applyWindowPreset(state.windowPreset);
      window.__viewerDiagnostics = viewerDiagnostics();
      const select = app.querySelector("[data-field='window-preset']");
      if (select) select.value = state.windowPreset;
    }
    if (name === "clear-annotations") {
      const count = await clearActiveMeasurements();
      setStatus(count
        ? tf("Đã xóa {} phép đo/ROI.", count)
        : t("Khung xem hiện tại không có phép đo/ROI để xóa."));
    }
    if (name === "rotate-clockwise") {
      if (!rotateActiveViewportClockwise()) throw new Error(t("Chưa chọn khung ảnh để xoay."));
      window.__viewerDiagnostics = viewerDiagnostics();
    }
    if (name === "flip-horizontal") {
      if (!flipActiveViewportHorizontal()) throw new Error(t("Chưa chọn khung ảnh để lật."));
      window.__viewerDiagnostics = viewerDiagnostics();
    }
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
        button.title = t(state.cine ? "Dừng chạy phim" : "Chạy phim");
      }
    }
    if (name === "capture") {
      const pane = await captureActiveViewport();
      setStatus(tf('Đã lưu ảnh PNG của khung "{}".', pane));
    }
    if (name === "save-annotations") {
      const count = await saveAnnotations();
      setStatus(tf("Đã lưu {} phép đo/ROI.", count));
    }
    if (name === "roi-volume") {
      const volume = roiVolumeMl();
      setStatus(tf(
        "Thể tích ROI thủ công: {} mL (tổng diện tích lát × khoảng cách lát).",
        volume.toFixed(2),
      ));
    }
    if (name === "classic") {
      if (!window.pywebview?.api) throw new Error(t("Chế độ classic chỉ có trong ứng dụng desktop."));
      await window.pywebview.api.restart_classic();
    }
  } catch (error) {
    setStatus(humanError(error), true);
  }
}

const DEFAULT_TOOLS = { volume3d: "rotate3d", mpr: "crosshair" };

function defaultToolForMode(mode, currentTool) {
  if (DEFAULT_TOOLS[mode]) return DEFAULT_TOOLS[mode];
  return currentTool === "rotate3d" || currentTool === "crosshair" ? "window" : currentTool;
}

function syncToolHighlight() {
  app.querySelectorAll(".interaction-tools .icon-button").forEach((button) => {
    const active = button.dataset.action === `tool-${state.tool}`;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

const ERROR_HINTS = [
  [/cachedSizeExceeded|Cache size|cacheSize/i,
    "Hết bộ đệm ảnh. Hãy đóng series khác hoặc chọn series ít lát hơn rồi thử lại."],
  [/Failed to fetch|NetworkError|load failed/i,
    "Mất kết nối tới dịch vụ nội bộ của ứng dụng. Hãy khởi động lại ứng dụng."],
  [/WebGL|GPU|context lost/i,
    "Trình kết xuất GPU gặp sự cố. Hãy khởi động lại ứng dụng; nếu lặp lại, cập nhật driver card đồ họa."],
];

function humanError(error) {
  const raw = translateLog(error?.message || String(error));
  const hint = ERROR_HINTS.find(([pattern]) => pattern.test(raw));
  return hint ? `${t(hint[1])} (${t("chi tiết")}: ${raw})` : raw;
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
  state.windowPreset = defaultWindowPreset(selectedSeries());
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
    ? tf("Đang dựng MPR từ {} lát…", series.sliceCount)
    : mode === "volume3d"
      ? tf("Đang dựng mô hình 3D từ {} lát…", series.sliceCount)
      : t("Đang mở ảnh…");
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
      ? tf("Đang dựng MPR từ {} lát…", series.sliceCount)
      : mode === "volume3d"
        ? tf("Đang dựng mô hình 3D từ {} lát…", series.sliceCount)
        : t("Đang mở ảnh…");
    workspace.dataset.loadingText = loadingText;
    workspace.classList.add("busy");
    app.querySelector(".status-dot")?.classList.add("busy");
    setStatus(loadingText);
    try {
      // Rebuilding a layout drops every in-memory annotation, so measurements
      // are written to the series folder first instead of being lost silently.
      const saved = await persistActiveAnnotations();
      if (saved === -1) setStatus(t("Không lưu được phép đo trước khi đổi khung xem."), true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (requestId !== viewerRequestId || !workspace.isConnected) return;
      let applied = state.tool;
      if (mode === "mpr") {
        applied = await showMpr(workspace, series, state.mprPrimary, state.tool);
      } else if (mode === "volume3d") {
        applied = await show3d(workspace, series, state.tool);
      } else {
        applied = await showStacks(workspace, series, mode, comparison, state.tool);
      }
      if (requestId !== viewerRequestId || !workspace.isConnected) return;
      if (applied && applied !== state.tool) {
        state.tool = applied;
        syncToolHighlight();
      }
      // Cornerstone establishes the file's own VOI while the stack actor is
      // being attached. Re-applying an equivalent range in that same transition
      // can blank a ContextPool stack on WebView2, so skip only "full", which
      // is that same window by definition.
      if (mode !== "volume3d" && state.windowPreset !== "full") {
        await applyWindowPreset(state.windowPreset);
      }
      window.__lastViewerError = null;
      window.__viewerReadyMode = mode;
      window.__viewerDiagnostics = viewerDiagnostics();
    } catch (error) {
      // A superseded build is the expected outcome of a fast mode change; the
      // newer request owns the workspace and reports its own state.
      if (error?.superseded) return;
      if (requestId !== viewerRequestId || !workspace.isConnected) return;
      const message = humanError(error);
      window.__lastViewerError = {
        message: error?.message || String(error),
        stack: error?.stack || "",
      };
      workspace.innerHTML = `<div class="empty-state error"><b>${escapeHtml(t("Không mở được khung xem"))}</b>
        <span>${escapeHtml(message)}</span>
        <button class="primary" data-action="retry-viewer">${escapeHtml(t("Thử lại"))}</button></div>`;
      workspace.querySelector("[data-action='retry-viewer']")
        ?.addEventListener("click", () => renderViewer());
      setStatus(message, true);
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

const SHORTCUT_HINT = "Phím tắt: ←/→ hoặc PgUp/PgDn đổi lát · Home/End lát đầu/cuối · 1 sáng · 2 pan"
  + " · 3 zoom · 4 đo dài · 5 góc · 6 ROI ellipse · 7 ROI tự do · C định vị · R đặt lại · I đảo màu"
  + " · Space chạy phim · S lưu đo · P lưu ảnh.";

const SHORTCUT_TOOLS = {
  1: "window",
  2: "pan",
  3: "zoom",
  4: "length",
  5: "angle",
  6: "ellipse",
  7: "freehand",
};

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select"));
}

function installKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
    if (state.busyViewer || !state.archive.series.length) return;
    const step = { ArrowLeft: -1, ArrowUp: -1, PageUp: -5, ArrowRight: 1, ArrowDown: 1, PageDown: 5 };
    if (event.key in step) {
      if (stepSlice(step[event.key])) event.preventDefault();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      const series = selectedSeries();
      if (series && stepSlice(event.key === "Home" ? -series.sliceCount : series.sliceCount)) {
        event.preventDefault();
      }
      return;
    }
    if (SHORTCUT_TOOLS[event.key]) {
      action(`tool-${SHORTCUT_TOOLS[event.key]}`);
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "c") action("tool-crosshair");
    else if (key === "r") action("reset");
    else if (key === "i") action("invert");
    else if (key === "s") action("save-annotations");
    else if (key === "p") action("capture");
    else if (event.key === " " && state.mode === "single") {
      event.preventDefault();
      action("cine");
    }
  });
}

let jobPoll = null;
function startJobPolling() {
  if (jobPoll) window.clearInterval(jobPoll);
  jobPoll = window.setInterval(pollJob, 1000);
  pollJob();
}

function renderStudyList() {
  const list = app.querySelector(".study-list");
  if (list) list.innerHTML = renderStudies();
  const patient = app.querySelector(".patient-status");
  if (patient) patient.innerHTML = renderPatientStatus();
  app.querySelectorAll("[data-study-index]").forEach((item) => {
    item.addEventListener("change", syncDownloadButton);
  });
  syncDownloadButton();
}

async function pollJob() {
  const job = await api("/api/job");
  state.bootstrap.job = job;
  if (job.kind === "search" && job.status === "complete") {
    state.studies = Array.isArray(job.result) ? job.result : job.result?.studies || [];
    state.patient = Array.isArray(job.result) ? null : job.result?.patient || null;
    // Only the study list changed. A full render() would replace #workspace and
    // throw away the layout, camera and measurements the user is working with.
    renderStudyList();
  }
  if (["download", "direct-download", "local-import"].includes(job.kind) && job.status === "complete") {
    const archive = job.result?.archive;
    if (job.result?.patient) state.patient = job.result.patient;
    if (Array.isArray(job.result?.studies)) {
      const completed = new Map(job.result.studies.map((item) => [item.study_uid, item.local_status]));
      state.studies.forEach((item) => {
        if (completed.has(item.study_uid)) item.local_status = completed.get(item.study_uid);
      });
    }
    if (archive) {
      window.clearInterval(jobPoll);
      jobPoll = null;
      applyArchive(archive);
      refreshHistory();
      return;
    }
  }
  if (job.kind === "archive" && job.status === "complete") {
    window.clearInterval(jobPoll);
    jobPoll = null;
    applyArchive(job.result || { root: "", series: [] });
    refreshHistory();
    return;
  }
  const log = app.querySelector(".job-log");
  if (log) {
    log.textContent = (job.logs || []).slice(-80).map(translateLog).join("\n");
    log.scrollTop = log.scrollHeight;
  }
  // The viewer owns the status bar while it is building a layout.
  if (!state.busyViewer) setStatus(translateLog(job.message || job.status));
  if (["complete", "error", "stopped"].includes(job.status)) {
    window.clearInterval(jobPoll);
    jobPoll = null;
    // Any finished job may have added a folder worth remembering.
    refreshHistory();
  }
}

/** Fill the link and patient-code fields from the clipboard, as the classic app does.
 *
 * WebView2 refuses `navigator.clipboard.readText()` without a user gesture, so
 * the native bridge reports only the two shapes worth pasting. A field the user
 * is typing in is never overwritten.
 */
async function autoPasteFromClipboard() {
  if (!window.pywebview?.api?.read_clipboard) return;
  let clip = null;
  try {
    clip = await window.pywebview.api.read_clipboard();
  } catch (_) {
    return;
  }
  if (!clip) return;
  const urlField = app.querySelector("#direct-url");
  if (clip.url && urlField && document.activeElement !== urlField && urlField.value.trim() !== clip.url) {
    urlField.value = clip.url;
    state.lastDirectUrl = clip.url;
  }
  const patientField = app.querySelector("#patient-id");
  if (clip.patientId && patientField && document.activeElement !== patientField
    && patientField.value.trim() !== clip.patientId) {
    patientField.value = clip.patientId;
  }
}

async function boot() {
  if (!hasSessionToken) throw new Error(t("Thiếu token phiên local."));
  state.bootstrap = await api("/api/bootstrap");
  setLanguage(state.bootstrap.language || "vi");
  state.history = Array.isArray(state.bootstrap.history) ? state.bootstrap.history : [];
  state.lastDirectUrl = state.bootstrap.lastDirectUrl || "";
  state.status = "Đang khởi động...";
  state.archive = state.bootstrap.archive;
  state.selectedId = state.archive.series[0]?.id || "";
  state.compareId = state.archive.series[1]?.id || state.selectedId;
  for (const series of state.archive.series) registerSeries(series);
  await initViewer({
    onStatus: (message, progress) => {
      setStatus(message);
      // Keep the blocking overlay in step with the load instead of freezing on
      // the text it was given when the layout change started.
      const workspace = document.querySelector("#workspace.busy");
      if (workspace && progress) {
        workspace.dataset.loadingText = `${message} (${progress.loaded}/${progress.total})`;
      }
    },
    onSlice: ({ label, index, count }) => {
      state.sliceText = `${label ? `${label} · ` : ""}${index + 1}/${count}`;
      updateStatusOnly();
    },
  });
  app.addEventListener("mprprimarychange", (event) => {
    if (event.detail?.plane) state.mprPrimary = event.detail.plane;
  });
  installKeyboardShortcuts();
  // Releasing the GPU contexts on close keeps a WebView2 restart from
  // inheriting a page that still holds them.
  window.addEventListener("pagehide", disposeViewer);
  // Copying a viewer link or patient code in another window and coming back is
  // the normal workflow, so returning focus is when the paste is wanted.
  window.addEventListener("focus", autoPasteFromClipboard);
  state.status = t("Sẵn sàng. Nhấn ⌨ trên thanh công cụ để xem phím tắt.");
  render();
  autoPasteFromClipboard();
  await renderViewer();
}

boot().catch((error) => {
  app.innerHTML = `<div class="fatal-error"><b>${escapeHtml(t("Không khởi động được DICOM/JPG Downloader & Viewer"))}</b>
    <pre>${escapeHtml(error.stack || error.message)}</pre>
    <button class="primary" id="fatal-reload">${escapeHtml(t("Tải lại"))}</button></div>`;
  // The local API forbids inline handlers, so the listener is attached here.
  document.querySelector("#fatal-reload")?.addEventListener("click", () => location.reload());
});
