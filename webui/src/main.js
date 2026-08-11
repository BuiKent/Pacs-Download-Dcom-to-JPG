import "./styles.css";
import { api, configureApi } from "./api.js";
import { getLanguage, setLanguage, t, tf, translateLog } from "./i18n.js";
import {
  hasCompleteSeriesSelection,
  initialiseStudySelections,
  rememberSeriesSelections,
  restoreSeriesSelections,
  selectedStudies as chosenStudies,
  seriesSelections as buildSeriesSelections,
} from "./download-selection.js";
import {
  applyWindowPreset,
  availableWindowPresets,
  captureActiveViewport,
  clearActiveMeasurements,
  compareScrollSyncState,
  cycleMaximizedSeries,
  defaultWindowPreset,
  disposeViewer,
  configureTextPrompt,
  getActiveCompareInfo,
  setCompareScrollSync,
  setReferenceCursor,
  setReferenceLines,
  flipActiveViewportHorizontal,
  flipActiveViewportVertical,
  initViewer,
  invertView,
  persistActiveAnnotations,
  registerSeries,
  resetView,
  resetAllViews,
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
  swapComparePane,
  toggleCine,
  undoLastAnnotation,
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
  // Series shown beside the primary one; index 0 is pane B, index 1 is pane C.
  compareIds: ["", ""],
  scrollSync: true,
  referenceLines: true,
  referenceCursor: true,
  mode: "single",
  tool: "window",
  downloadOpen: true,
  studies: [],
  patient: null,
  downloadAllFiles: true,
  seriesInventory: [],
  rememberedSeriesSelections: {},
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
  showManualInfo: false,
  manualPatientName: "",
  manualPatientId: "",
  manualPatientDob: "",
};
let viewerQueue = Promise.resolve();
let viewerRequestId = 0;

// Icons that carry a real meaning are drawn, not borrowed from Unicode: "↺" and
// "↻" were near-identical for reset and rotate, and no glyph reads as "flip" or
// "orbit". Each SVG below follows the shape used by mainstream DICOM viewers.
const icons = {
  crosshair: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`,
  current: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  single: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`,
  compare: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>`,
  compare3: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
  scrollSync: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  referenceLines: `<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
  referenceCursor: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`,
  montage6: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
  montage8: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
  mpr: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
  volume3d: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
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
  // A square caught mid-turn inside the arrow: "rotate the image", never "undo".
  // The tilted square is what separates this from the plain circular arrow of reset.
  rotateClockwise: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
    <path d="M21 3v5h-5"></path>
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" transform="rotate(45 12 12)"></rect>
  </svg>`,
  reset: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
  orbit3d: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.1 13A8 8 0 0 1 12 18"/><path d="M19.1 11A8 8 0 0 0 12 6"/><path d="M12 6a8 8 0 0 0-7.1 5"/><path d="M12 18a8 8 0 0 1-7.1-5"/></svg>`,
  invert: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/></svg>`,
  clearAnnotations: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
  cine: `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
  capture: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M14 16H5.3"/></svg>`,
  history: "🕘",
};

function selectedSeries() {
  return state.archive.series.find((item) => item.id === state.selectedId) || null;
}

const COMPARE_PANES = { compare: 2, compare3: 3 };

function isCompareMode(mode = state.mode) {
  return Boolean(COMPARE_PANES[mode]);
}

/** The series for the secondary panes, one entry per extra pane. */
function compareSeriesList(mode = state.mode) {
  const extra = (COMPARE_PANES[mode] || 1) - 1;
  return Array.from({ length: extra }, (_, slot) => (
    state.archive.series.find((item) => item.id === state.compareIds[slot]) || null
  ));
}

/** Give every comparison slot a series, preferring ones not already shown. */
function fillCompareSlots(mode = state.mode) {
  const extra = (COMPARE_PANES[mode] || 1) - 1;
  const taken = [state.selectedId];
  for (let slot = 0; slot < extra; slot += 1) {
    const current = state.compareIds[slot];
    const usable = current && state.archive.series.some((item) => item.id === current);
    if (usable && !taken.includes(current)) {
      taken.push(current);
      continue;
    }
    const next = state.archive.series.find((item) => !taken.includes(item.id))
      || state.archive.series.find((item) => item.id !== state.selectedId)
      || state.archive.series[0];
    state.compareIds[slot] = next?.id || state.selectedId;
    taken.push(state.compareIds[slot]);
  }
}

/** Which compare pane indices currently show this series? Empty in non-compare modes. */
function seriesVisiblePanes(seriesId) {
  if (!isCompareMode()) return seriesId === state.selectedId ? [0] : [];
  const panes = [];
  if (seriesId === state.selectedId) panes.push(0);
  for (let slot = 0; slot < state.compareIds.length; slot += 1) {
    if (state.compareIds[slot] === seriesId) panes.push(slot + 1);
  }
  return panes;
}

/** Update the series-card strip highlighting without rebuilding the DOM. */
function updateSeriesCardHighlight() {
  for (const card of app.querySelectorAll("[data-series-id]")) {
    const panes = seriesVisiblePanes(card.dataset.seriesId);
    card.classList.toggle("active", panes.length > 0);
    if (panes.length) {
      card.dataset.pane = panes.join(",");
    } else {
      delete card.dataset.pane;
    }
  }
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
  const stateful = /^(mode-|tool-)/.test(id)
    || ["cine", "scroll-sync", "reference-lines", "reference-cursor"].includes(id);
  return `<button class="icon-button ${active ? "active" : ""} ${label ? "with-label" : ""}" data-action="${id}"
    title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"
    ${stateful ? `aria-pressed="${active ? "true" : "false"}"` : ""} ${disabled ? "disabled" : ""}>
    <span>${icon}</span>${label ? `<small>${escapeHtml(label)}</small>` : ""}
  </button>`;
}

/* The toolbar reads left to right in the order a study is actually worked:
   what the mouse does (navigate → measure → annotate), then what happens to the
   view (orient → reset), then the mark-up, then the output. */
function renderInteractionTools(series) {
  const navigate = {
    crosshair: iconButton("tool-crosshair", icons.crosshair, t("Định vị MPR"), state.tool === "crosshair"),
    orbit3d: iconButton("tool-orbit3d", icons.orbit3d, t("Xoay khối 3D tự do"), state.tool === "orbit3d"),
    window: iconButton("tool-window", icons.window, t("Sáng/tương phản"), state.tool === "window"),
    pan: iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
    zoom: iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
  };
  if (state.mode === "volume3d") {
    return [navigate.orbit3d, navigate.crosshair, navigate.pan, navigate.zoom].join("");
  }
  const measure = [
    iconButton("tool-length", icons.length,
      t(state.mode === "mpr" || series?.geometry ? "Đo chiều dài (mm)" : "Đo chiều dài (pixel)"),
      state.tool === "length"),
    iconButton("tool-angle", icons.angle, t("Đo góc"), state.tool === "angle"),
    iconButton("tool-ellipse", icons.ellipse, t("ROI ellipse"), state.tool === "ellipse"),
    iconButton("tool-freehand", icons.freehand, t("ROI tự do"), state.tool === "freehand"),
    iconButton("tool-text", icons.text, t("Ghi chú chữ lên ảnh"), state.tool === "text"),
  ];
  const head = state.mode === "mpr"
    ? [navigate.crosshair, navigate.window, navigate.pan, navigate.zoom]
    : [navigate.window, navigate.pan, navigate.zoom];
  return [...head, ...measure].join("");
}

function renderUtilityTools(series) {
  // Orientation acts on the pane under the cursor in every layout.
  const orientation = [
    iconButton("rotate-clockwise", icons.rotateClockwise,
      t("Xoay khung đang chọn 90° theo chiều kim đồng hồ")),
    iconButton("flip-horizontal", icons.flipHorizontal, t("Lật ngang khung đang chọn")),
    iconButton("flip-vertical", icons.flipVertical, t("Lật dọc khung đang chọn")),
    iconButton("invert", icons.invert, t("Đảo màu")),
    iconButton("reset", icons.reset, t(state.mode === "mpr"
      ? "Đặt lại ba mặt phẳng"
      : state.mode === "volume3d"
        ? "Đặt lại góc nhìn"
        : "Đặt lại hiển thị")),
  ];
  if (state.mode === "volume3d") {
    // A 3D volume render carries no annotations, so only the view controls and
    // the capture apply here.
    return [...orientation, iconButton("capture", icons.capture, t("Lưu ảnh 3D"))].join("");
  }
  const markup = [
    iconButton("clear-annotations", icons.clearAnnotations,
      t("Xóa mọi phép đo, ROI và ghi chú")),
    iconButton("save-annotations", icons.save, t("Lưu đo/ROI/ghi chú")),
    iconButton("roi-volume", icons.volume, t("Tính thể tích ROI"), false, !series?.mprReady),
  ];
  // Only the comparison layouts can lock panes together.
  const compareTools = isCompareMode()
    ? [iconButton("scroll-sync", icons.scrollSync,
      t(state.scrollSync
        ? "Đang khoá cuộn theo vị trí — bấm để cuộn từng khung riêng"
        : "Cuộn từng khung riêng — bấm để khoá theo độ lệch hiện tại"),
      state.scrollSync),
      iconButton("reference-lines", icons.referenceLines,
        t(state.referenceLines
          ? "Đường tham chiếu đang bật — bấm để tắt"
          : "Đường tham chiếu đang tắt — bấm để bật"),
        state.referenceLines),
      iconButton("reference-cursor", icons.referenceCursor,
        t(state.referenceCursor
          ? "Con trỏ tham chiếu đang bật — bấm để tắt"
          : "Con trỏ tham chiếu đang tắt — bấm để bật"),
        state.referenceCursor)]
    : [];
  const output = [
    iconButton("cine", state.cine ? "Ⅱ" : icons.cine,
      t(state.cine ? "Dừng chạy phim" : "Chạy phim"), state.cine),
    iconButton("capture", icons.capture, t("Lưu ảnh")),
  ];
  // Cine only means anything on a single stack; MPR drops it rather than
  // showing a control that can never be used.
  return [
    ...compareTools,
    ...orientation,
    ...markup,
    ...(state.mode === "mpr" ? output.slice(1) : output),
  ].join("");
}

function renderHistoryOptions() {
  if (!state.history.length) {
    return `<option value="" disabled selected hidden>${icons.history} ${escapeHtml(t("Chưa có lịch sử"))}</option>`;
  }
  const options = state.history.map((item, index) => {
    const name = String(item.folder).split(/[\\/]/).filter(Boolean).pop() || item.folder;
    const suffix = item.exists ? "" : ` ${t("(thư mục không còn)")}`;
    return `<option value="${index}" ${item.exists ? "" : "disabled"}
      title="${escapeHtml(item.folder)}">${escapeHtml(`${item.time}  •  ${name}${suffix}`)}</option>`;
  }).join("");
  return `<option value="" disabled selected hidden>${icons.history} ${escapeHtml(t("Lịch sử"))}…</option>${options}`;
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
        ▪ ${escapeHtml(item.description)} · ${escapeHtml(seriesFrameLabel(item))}
      </option>`
    ).join("");
    return `<optgroup label="${escapeHtml(formatGroupLabel(groupKey))}">${options}</optgroup>`;
  }).join("");
}

function seriesFrameLabel(series) {
  // A multi-frame file is expanded into one slice per frame, so the count is
  // the real number of images either way; only the noun changes.
  const numberOfFrames = Number(series?.pixelData?.numberOfFrames || 1);
  const unit = numberOfFrames > 1 ? t("khung") : t("lát");
  return `${series?.sliceCount || 0} ${unit}`;
}

function seriesDateInfo(series) {
  if (series.studyDate) {
    return series.studyDate; // From manifest or DICOM
  }
  const groupParts = (series.studyGroup || "").split(" - ");
  if (groupParts.length > 0 && groupParts[0] !== "Không rõ ca chụp") {
    // If the folder starts with a date, use it
    if (/^\d{4}-\d{2}-\d{2}/.test(groupParts[0])) {
      return `${groupParts[0]} (thư mục)`;
    }
  }
  return "";
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
        <label class="field history-field">
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
        <div class="field-row">
          <fieldset class="boxed-field">
            <legend>${escapeHtml(t("Mã bệnh nhân"))}</legend>
            <span class="clearable">
              <input id="patient-id" autocomplete="off" value="${escapeHtml(state.patient?.patientId || "")}">
              <button class="clear-field" data-action="clear-patient-id" tabindex="-1"
                title="${escapeHtml(t("Xóa mã bệnh nhân"))}" aria-label="${escapeHtml(t("Xóa mã bệnh nhân"))}">×</button>
            </span>
          </fieldset>
          <button data-action="search"
            title="${escapeHtml(t("Tìm các ca MRI/CT của mã bệnh nhân này trên RIS"))}">${escapeHtml(t("Tìm ca"))}</button>
        </div>
        <div class="patient-status">${renderPatientStatus()}</div>
        <div class="study-list">${renderStudies()}</div>
        <div class="download-actions">
          <button class="primary" data-action="download-selected"
            title="${escapeHtml(t("Tải các ca đang tích ở danh sách trên"))}"
            ${state.studies.some((item) => item.local_status !== "downloaded") && !state.patient?.nameConflict ? "" : "disabled"}>${escapeHtml(t("Tải ca đã chọn"))}</button>
          <button class="danger" data-action="stop-job"
            title="${escapeHtml(t("Dừng an toàn tác vụ đang chạy"))}">${escapeHtml(t("Dừng"))}</button>
        </div>
        <fieldset class="boxed-field">
          <legend>${escapeHtml(t("Link viewer"))}</legend>
          <span class="clearable">
            <input id="direct-url" type="text" spellcheck="false" value="${escapeHtml(state.lastDirectUrl)}">
            <button class="clear-field" data-action="clear-direct-url" tabindex="-1"
              title="${escapeHtml(t("Xóa link viewer"))}" aria-label="${escapeHtml(t("Xóa link viewer"))}">×</button>
          </span>
        </fieldset>
        <div class="link-actions">
          <button data-action="download-direct"
            title="${escapeHtml(t("Tải mới từ link đã dán vào một folder riêng"))}">${escapeHtml(t("Tải link"))}</button>
          <button data-action="download-retry"
            title="${escapeHtml(t("Thử lại link vừa dán và gộp vào folder cũ, bỏ qua ảnh đã có"))}">${escapeHtml(t("Thử lại"))}</button>
        </div>
        <div class="manual-info-toggle">
          <label><input type="checkbox" id="manual-info-toggle" ${state.showManualInfo ? "checked" : ""}> ${escapeHtml(t("Bổ sung thông tin bệnh nhân"))}</label>
        </div>
        <div id="manual-info-container">
          ${renderManualInfoPanel()}
        </div>
        <div class="download-options">
          <label title="${escapeHtml(t("Chất lượng JPG (70-100)"))}">JPG
            <input id="quality" type="number" min="70" max="100" value="100"></label>
          <label><input id="download-all-files" type="checkbox" ${state.downloadAllFiles ? "checked" : ""}>
            ${escapeHtml(t("Tải tất cả file"))}</label>
          <label><input id="show-browser" type="checkbox"> ${escapeHtml(t("Hiện trình duyệt tải"))}</label>
        </div>
        <div id="series-picker" class="series-picker ${state.downloadAllFiles ? "hidden" : ""}">
          ${renderSeriesPicker()}
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
            ${iconButton("mode-compare", icons.compare, t("So sánh hai series cạnh nhau"), state.mode === "compare", false, "2")}
            ${iconButton("mode-compare3", icons.compare3, t("So sánh ba series cạnh nhau"), state.mode === "compare3", false, "3")}
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
          ${state.archive.series.map((item) => {
    const visiblePanes = seriesVisiblePanes(item.id);
    const isVisible = visiblePanes.length > 0;
    const dateInfo = seriesDateInfo(item);
    return `<button class="series-card ${isVisible ? "active" : ""}"
            data-series-id="${item.id}" title="${escapeHtml(item.mprReason || item.description)}"
            ${isVisible ? `data-pane="${visiblePanes.join(",")}"` : ""}>
            <span>${item.mprReady ? "3D" : "2D"}</span>
            <b>${escapeHtml([dateInfo, item.modality].filter(Boolean).join(" · "))}</b>
            <b>${escapeHtml(item.description)}</b>
            <small>${escapeHtml(seriesFrameLabel(item))}</small>
          </button>`;
  }).join("")}
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
        ${study.selected && !state.patient?.nameConflict ? "checked" : ""}
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

function renderManualInfoPanel() {
  if (!state.showManualInfo) return "";
  return `
    <div class="manual-info-panel">
      <label>${escapeHtml(t("Tên bệnh nhân"))} <input id="manual-patient-name" type="text" value="${escapeHtml(state.manualPatientName)}" autocomplete="off"></label>
      <label>${escapeHtml(t("Mã BN (ID)"))} <input id="manual-patient-id" type="text" value="${escapeHtml(state.manualPatientId)}" autocomplete="off"></label>
      <label>${escapeHtml(t("Năm sinh / Ngày sinh"))} <input id="manual-patient-dob" type="text" value="${escapeHtml(state.manualPatientDob)}" autocomplete="off" placeholder="DD/MM/YYYY hoặc YYYY"></label>
    </div>
  `;
}

function renderManualInfoPanelOnly() {
  const container = app.querySelector("#manual-info-container");
  if (container) {
    container.innerHTML = renderManualInfoPanel();
    bindManualInfoEvents();
  }
}

function bindManualInfoEvents() {
  app.querySelector("#manual-patient-name")?.addEventListener("input", (e) => {
    state.manualPatientName = e.target.value;
  });
  app.querySelector("#manual-patient-id")?.addEventListener("input", (e) => {
    state.manualPatientId = e.target.value;
  });
  app.querySelector("#manual-patient-dob")?.addEventListener("input", (e) => {
    state.manualPatientDob = e.target.value;
  });
}

function syncManualInfoVisibility(urlValue) {
  const hasUrl = Boolean(String(urlValue || "").trim());
  if (state.showManualInfo !== hasUrl) {
    state.showManualInfo = hasUrl;
    const toggle = app.querySelector("#manual-info-toggle");
    if (toggle) toggle.checked = state.showManualInfo;
    renderManualInfoPanelOnly();
  }
}

function renderSeriesPicker() {
  const actions = `
    <div class="series-picker-actions">
      <button data-action="discover-series">${escapeHtml(t("Quét danh sách series"))}</button>
      ${state.seriesInventory.length ? `
        <button data-action="select-series-all">${escapeHtml(t("Chọn tất cả series"))}</button>
        <button data-action="deselect-series-all">${escapeHtml(t("Bỏ chọn tất cả series"))}</button>` : ""}
    </div>`;
  if (!state.seriesInventory.length) {
    return `${actions}<small class="series-picker-hint">${escapeHtml(t(
      "Bỏ chế độ tải tất cả, sau đó quét để chọn T1, T2, FLAIR hoặc series cụ thể.",
    ))}</small>`;
  }
  return `${actions}${state.seriesInventory.map((group, groupIndex) => `
    <section class="series-choice-group">
      <b>${escapeHtml([
      group.studyDate,
      group.studyDescription,
    ].filter(Boolean).join(" · ") || t("Link viewer"))}</b>
      ${(group.series || []).map((series, seriesIndex) => `
        <label class="series-choice">
          <input type="checkbox" data-series-group="${groupIndex}" data-series-choice="${seriesIndex}"
            ${series.selected === false ? "" : "checked"}>
          <span>
            ${series.sequenceHint ? `<strong>${escapeHtml(series.sequenceHint)}</strong>` : ""}
            <b>${escapeHtml(series.description || series.id)}</b>
            <small>${escapeHtml([
      series.number ? `#${series.number}` : "",
      series.imageCount ? `${series.imageCount} ${t("ảnh")}` : "",
    ].filter(Boolean).join(" · "))}</small>
          </span>
        </label>`).join("")}
    </section>`).join("")}`;
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
  installClipboardFields();
  app.querySelectorAll("[data-series-id]").forEach((element) => {
    element.addEventListener("click", async () => {
      const seriesId = element.dataset.seriesId;
      const newSeries = state.archive.series.find((item) => item.id === seriesId);
      if (!newSeries) return;

      // In compare mode: hot-swap the focused pane's series (no rebuild).
      if (isCompareMode()) {
        const info = getActiveCompareInfo();
        if (!info) return;
        // Update state to track which series is where
        if (info.paneIndex === 0) {
          state.selectedId = seriesId;
        } else {
          state.compareIds[info.paneIndex - 1] = seriesId;
        }
        await swapComparePane(newSeries);
        // Update card highlighting without full render()
        updateSeriesCardHighlight();
        if (state.windowPreset !== "full") {
          await applyWindowPreset(state.windowPreset);
        }
        // The new pane can change the pair relationship, so the scroll-lock
        // state and the diagnostics a gate reads must be refreshed too.
        window.__viewerDiagnostics = viewerDiagnostics();
        state.scrollSync = compareScrollSyncState().enabled;
        const syncButton = app.querySelector("[data-action='scroll-sync']");
        if (syncButton) {
          syncButton.classList.toggle("active", state.scrollSync);
          syncButton.setAttribute("aria-pressed", state.scrollSync ? "true" : "false");
        }
        return;
      }

      // Non-compare modes: full rebuild as before.
      state.selectedId = seriesId;
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
    item.addEventListener("change", () => updateStudySelection(item));
  });
  app.querySelector("#download-all-files")?.addEventListener("change", (event) => {
    state.downloadAllFiles = event.target.checked;
    app.querySelector("#series-picker")?.classList.toggle("hidden", state.downloadAllFiles);
    syncDownloadButton();
  });
  app.querySelector("#direct-url")?.addEventListener("input", (e) => {
    state.lastDirectUrl = e.target.value;
    syncManualInfoVisibility(e.target.value);
    if (state.seriesInventory.some((group) => group.studyUid === "direct")) {
      state.seriesInventory = [];
      delete state.rememberedSeriesSelections.direct;
      renderSeriesPickerOnly();
    }
  });
  app.querySelectorAll("input[name='hospital']").forEach((item) => {
    item.addEventListener("change", () => {
      state.seriesInventory = [];
      state.rememberedSeriesSelections = {};
      renderSeriesPickerOnly();
    });
  });
  app.querySelector("#manual-info-toggle")?.addEventListener("change", (e) => {
    state.showManualInfo = e.target.checked;
    renderManualInfoPanelOnly();
  });
  bindManualInfoEvents();
  bindSeriesPickerEvents();
  syncDownloadButton();
}

function bindSeriesPickerEvents() {
  app.querySelectorAll("[data-series-group][data-series-choice]").forEach((item) => {
    item.addEventListener("change", () => {
      const series = state.seriesInventory[Number(item.dataset.seriesGroup)]
        ?.series?.[Number(item.dataset.seriesChoice)];
      if (series) series.selected = item.checked;
      state.rememberedSeriesSelections = rememberSeriesSelections(
        state.seriesInventory,
        state.rememberedSeriesSelections,
      );
      syncDownloadButton();
    });
  });
}

function renderSeriesPickerOnly() {
  const picker = app.querySelector("#series-picker");
  if (!picker) return;
  picker.classList.toggle("hidden", state.downloadAllFiles);
  picker.innerHTML = renderSeriesPicker();
  picker.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => action(element.dataset.action));
  });
  bindSeriesPickerEvents();
}

function selectedSeriesSelections() {
  return buildSeriesSelections(state.seriesInventory);
}

function updateStudySelection(element) {
  state.rememberedSeriesSelections = rememberSeriesSelections(
    state.seriesInventory,
    state.rememberedSeriesSelections,
  );
  const study = state.studies[Number(element.dataset.studyIndex)];
  if (!study) return;
  study.selected = element.checked;
  const selectedUids = new Set(chosenStudies(state.studies).map((item) => item.study_uid));
  state.seriesInventory = state.seriesInventory.filter((group) => selectedUids.has(group.studyUid));
  renderSeriesPickerOnly();
  syncDownloadButton();
}

function syncDownloadButton() {
  const button = app.querySelector("[data-action='download-selected']");
  const hasSeriesSelection = state.downloadAllFiles
    || hasCompleteSeriesSelection(state.studies, state.seriesInventory);
  if (button) button.disabled = Boolean(state.patient?.nameConflict)
    || !chosenStudies(state.studies).length
    || !hasSeriesSelection;
}

async function openHistoryEntry(entry) {
  try {
    // Re-opening restores the link that filled the folder, so a retry after a
    // restart still knows which link to resume.
    state.lastDirectUrl = entry.url || "";
    const field = app.querySelector("#direct-url");
    if (field) field.value = state.lastDirectUrl;
    syncManualInfoVisibility(state.lastDirectUrl);
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
      applyTextPromptLanguage();
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
    if (name === "clear-patient-id" || name === "clear-direct-url") {
      const target = CLIPBOARD_FIELDS.find((item) => name === `clear-${item.id}`);
      const field = target && app.querySelector(`#${target.id}`);
      if (field) await clearClipboardField(field, target.kind);
      if (target?.kind === "url") {
        state.seriesInventory = state.seriesInventory.filter((group) => group.studyUid !== "direct");
        delete state.rememberedSeriesSelections.direct;
        renderSeriesPickerOnly();
      }
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
        state.seriesInventory = [];
        state.rememberedSeriesSelections = {};
        const field = app.querySelector("#output-root");
        if (field) field.value = result.outputRoot;
        renderStudyList();
        renderSeriesPickerOnly();
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
      state.seriesInventory = [];
      state.rememberedSeriesSelections = {};
      renderStudyList();
      renderSeriesPickerOnly();
      await api("/api/search", { method: "POST", body: JSON.stringify({ patientId, hospital }) });
      startJobPolling();
      return;
    }
    if (name === "select-series-all" || name === "deselect-series-all") {
      const selected = name === "select-series-all";
      state.seriesInventory.forEach((group) => {
        (group.series || []).forEach((series) => { series.selected = selected; });
      });
      state.rememberedSeriesSelections = rememberSeriesSelections(
        state.seriesInventory,
        state.rememberedSeriesSelections,
      );
      renderSeriesPickerOnly();
      syncDownloadButton();
      return;
    }
    if (name === "discover-series") {
      const studies = chosenStudies(state.studies);
      const url = app.querySelector("#direct-url")?.value.trim() || "";
      if (state.studies.length && !studies.length) {
        throw new Error(t("Hãy tích ít nhất một ngày chụp trước khi quét series."));
      }
      if (!state.studies.length && !url) {
        throw new Error(t("Hãy chọn ca chụp hoặc nhập link viewer trước khi quét series."));
      }
      state.rememberedSeriesSelections = rememberSeriesSelections(
        state.seriesInventory,
        state.rememberedSeriesSelections,
      );
      state.seriesInventory = [];
      renderSeriesPickerOnly();
      await api("/api/series/discover", {
        method: "POST",
        body: JSON.stringify({
          studies,
          url: studies.length ? "" : url,
          hospital: state.patient?.hospitalKey
            || app.querySelector("input[name='hospital']:checked")?.value,
          showBrowser: app.querySelector("#show-browser").checked,
        }),
      });
      setStatus(t("Đang quét danh sách series; chưa tải file ảnh…"));
      startJobPolling();
      return;
    }
    if (name === "download-selected") {
      if (state.patient?.nameConflict) throw new Error(t("Tên bệnh nhân không khớp; app đã chặn tự động gộp."));
      const studies = chosenStudies(state.studies);
      if (!studies.length) throw new Error(t("Không có phim mới/chưa hoàn tất được chọn để tải."));
      await api("/api/download", {
        method: "POST",
        body: JSON.stringify({
          studies,
          patientId: state.patient?.patientId,
          patientName: state.patient?.patientName,
          hospital: state.patient?.hospitalKey,
          allStudies: state.studies,
          seriesSelections: state.downloadAllFiles ? undefined : selectedSeriesSelections(),
          ...downloadOptions(),
        }),
      });
      startJobPolling();
      return;
    }
    if (name === "download-direct" || name === "download-retry") {
      const url = app.querySelector("#direct-url").value.trim();
      if (!url) throw new Error(t("Chưa có link viewer để tải."));
      if (!state.downloadAllFiles && !(selectedSeriesSelections().direct || []).length) {
        throw new Error(t("Chưa quét hoặc chưa chọn series cho link viewer."));
      }
      state.lastDirectUrl = url;
      await api("/api/download/direct", {
        method: "POST",
        body: JSON.stringify({
          url,
          // A retry merges into the folder the first attempt created and skips
          // slices already on disk; these viewer links expire fast, so
          // re-downloading everything is often not even possible.
          resume: name === "download-retry",
          selectedSeriesIds: state.downloadAllFiles
            ? undefined
            : selectedSeriesSelections().direct || [],
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
      if (isCompareMode()) {
        fillCompareSlots();
        // A fresh comparison starts locked, so the panes move 1-1-1, 2-2-2.
        state.scrollSync = true;
        // Both cross-viewport aids default on for compare.
        setReferenceLines(state.referenceLines);
        setReferenceCursor(state.referenceCursor);
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
    if (name === "scroll-sync") {
      // Switching on captures wherever the panes currently sit, so a deliberate
      // offset between series is preserved instead of being snapped away.
      state.scrollSync = setCompareScrollSync(!state.scrollSync);
      const button = app.querySelector("[data-action='scroll-sync']");
      if (button) {
        button.classList.toggle("active", state.scrollSync);
        button.setAttribute("aria-pressed", state.scrollSync ? "true" : "false");
        button.title = t(state.scrollSync
          ? "Đang khoá cuộn theo vị trí — bấm để cuộn từng khung riêng"
          : "Cuộn từng khung riêng — bấm để khoá theo độ lệch hiện tại");
      }
      const { anchor, spatialMode } = compareScrollSyncState();
      if (state.scrollSync) {
        const positions = (anchor || []).map((index) => index + 1).join(" · ");
        const modeHint = spatialMode === "spatial"
          ? t("đồng bộ theo vị trí 3D")
          : spatialMode === "index"
            ? t("⚠ đồng bộ theo số thứ tự lát (không có đồng bộ không gian)")
            : t("chỉ đồng bộ các cặp tương thích; mặt phẳng khác hướng giữ lát độc lập");
        setStatus(tf("Đã khoá cuộn: {} — {}.", positions, modeHint));
      } else if (["reference", "blocked"].includes(spatialMode)) {
        setStatus(t(spatialMode === "reference"
          ? "Hai mặt phẳng giữ lát độc lập; đường tham chiếu biểu diễn giao tuyến 3D."
          : "Không khoá cuộn vì hai series khác hệ tọa độ (Frame of Reference)."));
      } else {
        setStatus(t("Đã bỏ khoá: mỗi khung cuộn riêng."));
      }
      return;
    }
    if (name === "reference-lines") {
      state.referenceLines = setReferenceLines(!state.referenceLines);
      const button = app.querySelector("[data-action='reference-lines']");
      if (button) {
        button.classList.toggle("active", state.referenceLines);
        button.setAttribute("aria-pressed", state.referenceLines ? "true" : "false");
        button.title = t(state.referenceLines
          ? "Đường tham chiếu đang bật — bấm để tắt"
          : "Đường tham chiếu đang tắt — bấm để bật");
      }
      setStatus(t(state.referenceLines
        ? "Đường tham chiếu đã bật."
        : "Đường tham chiếu đã tắt."));
      return;
    }
    if (name === "reference-cursor") {
      state.referenceCursor = setReferenceCursor(!state.referenceCursor);
      const button = app.querySelector("[data-action='reference-cursor']");
      if (button) {
        button.classList.toggle("active", state.referenceCursor);
        button.setAttribute("aria-pressed", state.referenceCursor ? "true" : "false");
        button.title = t(state.referenceCursor
          ? "Con trỏ tham chiếu đang bật — bấm để tắt"
          : "Con trỏ tham chiếu đang tắt — bấm để bật");
      }
      setStatus(t(state.referenceCursor
        ? "Con trỏ tham chiếu đã bật: rê chuột trên một khung để thấy đúng điểm đó trên khung kia."
        : "Con trỏ tham chiếu đã tắt."));
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
    if (name === "reset-all") {
      state.windowPreset = defaultWindowPreset(selectedSeries());
      resetAllViews();
      await applyWindowPreset(state.windowPreset);
      window.__viewerDiagnostics = viewerDiagnostics();
      const select = app.querySelector("[data-field='window-preset']");
      if (select) select.value = state.windowPreset;
    }
    if (name === "undo-annotation") {
      undoLastAnnotation();
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
    if (name === "flip-vertical") {
      if (!flipActiveViewportVertical()) throw new Error(t("Chưa chọn khung ảnh để lật."));
      window.__viewerDiagnostics = viewerDiagnostics();
    }
    if (name === "invert") {
      // Every live pane inverts, including the volume-rendered one. The guard
      // is for a layout that has no invertible pane at all, so the button
      // reports that instead of appearing to do nothing.
      const panes = invertView();
      window.__viewerDiagnostics = viewerDiagnostics();
      if (!panes) throw new Error(t("Khung đang xem không đảo màu được."));
    }
    if (name === "cine") {
      state.cine = toggleCine(selectedSeries(), (index) => {
        state.sliceText = `${index + 1}/${selectedSeries().sliceCount}`;
        updateStatusOnly();
      });
      const button = app.querySelector("[data-action='cine']");
      if (button) {
        button.classList.toggle("active", state.cine);
        // icons.cine is SVG markup, so it has to be parsed, not written as text.
        button.querySelector("span").innerHTML = state.cine ? "Ⅱ" : icons.cine;
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

const DEFAULT_TOOLS = { volume3d: "orbit3d", mpr: "crosshair" };

function defaultToolForMode(mode, currentTool) {
  if (DEFAULT_TOOLS[mode]) return DEFAULT_TOOLS[mode];
  return currentTool === "orbit3d" || currentTool === "crosshair" ? "window" : currentTool;
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
  const options = {
    outputRoot: state.bootstrap.outputRoot,
    quality: Number(app.querySelector("#quality").value || 100),
    showBrowser: app.querySelector("#show-browser").checked,
    downloadAllFiles: state.downloadAllFiles,
  };
  if (state.showManualInfo) {
    options.manualInfo = {
      patientName: state.manualPatientName,
      patientId: state.manualPatientId,
      patientDob: state.manualPatientDob,
    };
  }
  return options;
}

function applyArchive(archive) {
  state.archive = archive;
  for (const series of archive.series) registerSeries(series);
  if (!archive.series.some((item) => item.id === state.selectedId)) {
    state.selectedId = archive.series[0]?.id || "";
  }
  fillCompareSlots("compare3");
  state.mode = "single";
  state.tool = "window";
  state.windowPreset = defaultWindowPreset(selectedSeries());
  render();
  renderViewer();
}

function renderViewer() {
  const series = selectedSeries();
  const mode = state.mode;
  const comparison = compareSeriesList();
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
      if (mode === "compare" || mode === "compare3") {
        const sync = compareScrollSyncState();
        state.scrollSync = sync.enabled;
        const button = app.querySelector("[data-action='scroll-sync']");
        if (button) {
          button.classList.toggle("active", state.scrollSync);
          button.setAttribute("aria-pressed", state.scrollSync ? "true" : "false");
          button.title = t(state.scrollSync
            ? "Đang khoá cuộn theo vị trí — bấm để cuộn từng khung riêng"
            : "Cuộn từng khung riêng — bấm để khoá theo độ lệch hiện tại");
        }
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
  }
}

function updateStatusOnly() {
}

const SHORTCUT_HINT = "Phím tắt: ←/→, PgUp/PgDn, Home/End: đổi lát · 1..8: bộ công cụ · C: định vị"
  + " · R/Shift+R: đặt lại · I: đảo màu · Space: chạy phim · S: lưu đo · P: lưu ảnh"
  + " · Tab: xoay vòng series · Ctrl+Z: hoàn tác đo · Ctrl+Chuột Trái: chỉnh sáng tối.";

const SHORTCUT_TOOLS = {
  1: "window",
  2: "pan",
  3: "zoom",
  4: "length",
  5: "angle",
  6: "ellipse",
  7: "freehand",
  8: "text",
};

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select"));
}

function installKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;
    
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      if (document.querySelector(".viewport-maximized")) {
        event.preventDefault();
        cycleMaximizedSeries();
        return;
      }
    }
    
    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      action("undo-annotation");
      return;
    }
    
    if (event.ctrlKey || event.altKey || event.metaKey) return;
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
    
    if (event.key === "R") {
      action("reset-all");
      return;
    }
    
    const key = event.key.toLowerCase();
    if (key === "c") action("tool-crosshair");
    else if (key === "r") action("reset");
    else if (key === "i") action("invert");
    else if (key === "s") action("save-annotations");
    else if (key === "p") action("capture");
    else if (event.key === " ") {
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
    item.addEventListener("change", () => updateStudySelection(item));
  });
  syncDownloadButton();
}

async function pollJob() {
  const job = await api("/api/job");
  state.bootstrap.job = job;
  if (job.kind === "search" && job.status === "complete") {
    const foundStudies = Array.isArray(job.result) ? job.result : job.result?.studies || [];
    state.patient = Array.isArray(job.result) ? null : job.result?.patient || null;
    state.studies = initialiseStudySelections(
      foundStudies,
      Boolean(state.patient?.nameConflict),
    );
    // Only the study list changed. A full render() would replace #workspace and
    // throw away the layout, camera and measurements the user is working with.
    renderStudyList();
  }
  if (job.kind === "series-discovery" && job.status === "complete") {
    const groups = Array.isArray(job.result?.groups) ? job.result.groups : [];
    state.seriesInventory = restoreSeriesSelections(
      groups,
      state.rememberedSeriesSelections,
    );
    window.clearInterval(jobPoll);
    jobPoll = null;
    renderSeriesPickerOnly();
    syncDownloadButton();
    setStatus(tf(
      "Đã quét {} nhóm series; hãy bỏ tích những series không muốn tải.",
      state.seriesInventory.length,
    ));
    return;
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

// The two fields that accept a clipboard value, each with the only shape it
// takes. WebView2 refuses `navigator.clipboard.readText()` without a user
// gesture, so the native bridge reports those shapes and nothing else.
const CLIPBOARD_FIELDS = [
  { id: "patient-id", kind: "patientId" },
  { id: "direct-url", kind: "url" },
];

async function clipboardValueFor(kind) {
  if (!window.pywebview?.api?.read_clipboard) return "";
  try {
    return (await window.pywebview.api.read_clipboard())?.[kind] || "";
  } catch (_) {
    // Another process can hold the clipboard open; auto-paste simply skips.
    return "";
  }
}

function syncClearButton(field) {
  const button = app.querySelector(`[data-action="clear-${field.id}"]`);
  if (button) button.hidden = !field.value;
}

/** Put a matching clipboard value into `field`.
 *
 * The classic app replaced the field whenever the clipboard differed, which is
 * what makes copy-then-click feel immediate; that behaviour is kept here. The
 * one refusal is a value the user just cleared with ×, which would otherwise
 * come straight back and make the button look broken.
 */
async function fillFromClipboard(field, kind) {
  const value = await clipboardValueFor(kind);
  if (!value || value === field.value.trim()) return false;
  if (field.dataset.dismissed === value) return false;
  field.value = value;
  if (kind === "url") {
    state.lastDirectUrl = value;
    syncManualInfoVisibility(value);
  }
  syncClearButton(field);
  return true;
}

async function clearClipboardField(field, kind) {
  field.value = "";
  if (kind === "url") {
    state.lastDirectUrl = "";
    syncManualInfoVisibility("");
  }
  // Record what the clipboard holds before focusing, otherwise the focus
  // handler would immediately paste back the value just cleared.
  const clip = await clipboardValueFor(kind);
  if (clip) field.dataset.dismissed = clip;
  syncClearButton(field);
  field.focus();
}

function installClipboardField(field, kind) {
  // Only a click that *caused* the focus may keep its selection. Arming this on
  // every focus would swallow the next click after the field was focused by Tab
  // or by ×, and the caret would refuse to move until a second click.
  let selectOnRelease = false;
  let pressPoint = null;
  const acceptClipboard = async (alwaysSelect) => {
    const pasted = await fillFromClipboard(field, kind);
    // Select after a paste so the value can be replaced by typing; on focus,
    // select even without one so leftover content is highlighted.
    if ((pasted || alwaysSelect) && document.activeElement === field) field.select();
  };
  field.addEventListener("focus", () => {
    selectOnRelease = pressPoint !== null;
    field.select();
    acceptClipboard(true);
  });
  field.addEventListener("mousedown", (event) => {
    pressPoint = { x: event.clientX, y: event.clientY };
    // The classic app re-read the clipboard on every click, not only on the
    // first focus. Clicking an already-focused field keeps the caret where the
    // user put it unless a new value actually arrived.
    if (document.activeElement === field) acceptClipboard(false);
  });
  field.addEventListener("mouseup", (event) => {
    const dragged = pressPoint !== null
      && (Math.abs(event.clientX - pressPoint.x) > 3 || Math.abs(event.clientY - pressPoint.y) > 3);
    pressPoint = null;
    if (!selectOnRelease) return;
    selectOnRelease = false;
    // A click focuses the field and then places the caret, which would drop the
    // selection made on focus. Keeping it means the leftover value can be
    // replaced by typing straight away — but a drag is the user selecting a
    // range by hand, so that one is left alone.
    if (!dragged) event.preventDefault();
  });
  field.addEventListener("blur", () => { selectOnRelease = false; pressPoint = null; });
  field.addEventListener("input", () => {
    // Typing makes the value the user's own, so a value dismissed earlier stops
    // being relevant and the clipboard may fill this field again.
    delete field.dataset.dismissed;
    if (kind === "url") state.lastDirectUrl = field.value;
    syncClearButton(field);
  });
  syncClearButton(field);
}

function installClipboardFields() {
  for (const { id, kind } of CLIPBOARD_FIELDS) {
    const field = app.querySelector(`#${id}`);
    if (field) installClipboardField(field, kind);
  }
}

/** Fill both fields on window focus, as the classic app does. */
async function autoPasteFromClipboard() {
  for (const { id, kind } of CLIPBOARD_FIELDS) {
    const field = app.querySelector(`#${id}`);
    if (field) await fillFromClipboard(field, kind);
  }
}

/** Keep the viewer's own text-note dialog in the selected language. */
function applyTextPromptLanguage() {
  configureTextPrompt({
    label: t("Nội dung ghi chú"),
    confirm: t("Thêm"),
    cancel: t("Bỏ"),
  });
}

async function boot() {
  if (!hasSessionToken) throw new Error(t("Thiếu token phiên local."));
  state.bootstrap = await api("/api/bootstrap");
  setLanguage(state.bootstrap.language || "en");
  applyTextPromptLanguage();
  state.history = Array.isArray(state.bootstrap.history) ? state.bootstrap.history : [];
  state.lastDirectUrl = state.bootstrap.lastDirectUrl || "";
  state.showManualInfo = Boolean(state.lastDirectUrl.trim());
  state.status = "Đang khởi động...";
  state.archive = state.bootstrap.archive;
  state.selectedId = state.archive.series[0]?.id || "";
  state.compareIds = [
    state.archive.series[1]?.id || state.selectedId,
    state.archive.series[2]?.id || state.archive.series[1]?.id || state.selectedId,
  ];
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
