import "./styles.css";
import { api, apiBlob, configureApi, getApiSession, mediaAuthUrl, setApiSession, thumbnailPath } from "./api.js";
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
  clearViewer,
  compareScrollSyncState,
  cycleMaximizedSeries,
  defaultWindowPreset,
  disposeViewer,
  configureTextPrompt,
  getActiveCompareInfo,
  getActiveSliceIndex,
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

let app = typeof document !== "undefined" ? document.querySelector("#app") : null;

function getDomRoot() {
  if (typeof document === "undefined") return null;
  if (!app || !app.isConnected) {
    app = document.querySelector("#app");
  }
  return (app && app.isConnected) ? app : document;
}
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
  // The text/JSON file currently in the reading pane: { seriesId, index, name,
  // language, text }. Null until a text series is opened.
  textDoc: null,
  // Which file of a multi-file photo or video series is shown, keyed by series
  // id so switching away and back keeps the reader's place.
  mediaIndex: {},
  // Rectangle the user dragged on the photo, in source-image pixels. Null when
  // nothing is selected: the editing tools then say so rather than inventing a
  // region, which is what the fixed 5% crop used to do.
  photoSelection: null,
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
  isError: false,
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
  showLoginCard: false,
  loginCardAction: null,
  showFileInfoModal: false,
  fileInfoData: null,
  fileInfoLoading: false,
  fileInfoError: "",
  fileInfoTagFilter: "",
  showConcatModal: false,
  concatClips: [],
  concatTargetHeight: 1080,
  concatTargetFps: 30,
  mediaIndex: {},
  mediaEdits: {},
  photoWorkingPath: null,
  videoWorkingPath: null,
  tabs: [],
  activeTabId: "worklist",
  worklistSearch: "",
  // Which Worklist tab is showing: the patient/study list or the queue+history.
  worklistTab: "studies",
  // Latest /api/job snapshot, kept so the Activity panel can draw it.
  job: null,
};
let viewerQueue = Promise.resolve();
let viewerRequestId = 0;

// Icons that carry a real meaning are drawn, not borrowed from Unicode: "↺" and
// "↻" were near-identical for reset and rotate, and no glyph reads as "flip" or
// "orbit". Each SVG below follows the shape used by mainstream DICOM viewers.
const icons = {
  crosshair: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`,
  // Used by the text/JSON reading pane and by the file-info button.
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  info: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  externalLink: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
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

/** Update series thumbnails and study-level timeline highlighting in place. */
function updateSeriesCardHighlight() {
  for (const card of app.querySelectorAll(".series-card[data-series-id]")) {
    const panes = seriesVisiblePanes(card.dataset.seriesId);
    card.classList.toggle("active", panes.length > 0);
    if (panes.length) {
      card.dataset.pane = panes.join(",");
    } else {
      delete card.dataset.pane;
    }
  }
  for (const row of app.querySelectorAll(".tl-item[data-timeline-members]")) {
    const memberIds = row.dataset.timelineMembers.split(",").filter(Boolean);
    row.classList.toggle("on", memberIds.some((id) => seriesVisiblePanes(id).length > 0));
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
function renderToolbarGroups(series) {
  if (state.mode === "volume3d") {
    const nav3d = [
      iconButton("tool-orbit3d", icons.orbit3d, t("Xoay khối 3D tự do"), state.tool === "orbit3d"),
      iconButton("tool-crosshair", icons.crosshair, t("Định vị MPR"), state.tool === "crosshair"),
      iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
      iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
    ].join("");
    const orient3d = [
      iconButton("rotate-clockwise", icons.rotateClockwise, t("Xoay khung đang chọn 90° theo chiều kim đồng hồ")),
      iconButton("flip-horizontal", icons.flipHorizontal, t("Lật ngang khung đang chọn")),
      iconButton("flip-vertical", icons.flipVertical, t("Lật dọc khung đang chọn")),
      iconButton("invert", icons.invert, t("Đảo màu")),
      iconButton("reset", icons.reset, t("Đặt lại góc nhìn")),
    ].join("");
    const output3d = [
      iconButton("capture", icons.capture, t("Lưu ảnh 3D")),
      iconButton("file-info", icons.info, t("Thông tin file & Link tải")),
    ].join("");

    return [
      `<div class="tool-cluster nav-tools">${nav3d}</div>`,
      `<span class="toolbar-divider"></span>`,
      `<div class="tool-cluster orientation-tools">${orient3d}</div>`,
      `<span class="toolbar-divider"></span>`,
      `<div class="tool-cluster output-tools">${output3d}</div>`,
    ].join("");
  }

  const nav = (state.mode === "mpr"
    ? [
        iconButton("tool-crosshair", icons.crosshair, t("Định vị MPR"), state.tool === "crosshair"),
        iconButton("tool-window", icons.window, t("Sáng/tương phản"), state.tool === "window"),
        iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
        iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
      ]
    : [
        iconButton("tool-window", icons.window, t("Sáng/tương phản"), state.tool === "window"),
        iconButton("tool-pan", icons.pan, t("Di chuyển"), state.tool === "pan"),
        iconButton("tool-zoom", icons.zoom, t("Thu/phóng"), state.tool === "zoom"),
      ]
  ).join("");

  const measure = [
    iconButton("tool-length", icons.length, t(state.mode === "mpr" || series?.geometry ? "Đo chiều dài (mm)" : "Đo chiều dài (pixel)"), state.tool === "length"),
    iconButton("tool-angle", icons.angle, t("Đo góc"), state.tool === "angle"),
    iconButton("tool-ellipse", icons.ellipse, t("ROI ellipse"), state.tool === "ellipse"),
    iconButton("tool-freehand", icons.freehand, t("ROI tự do"), state.tool === "freehand"),
    iconButton("tool-text", icons.text, t("Ghi chú chữ lên ảnh"), state.tool === "text"),
  ].join("");

  const orientation = [
    iconButton("rotate-clockwise", icons.rotateClockwise, t("Xoay khung đang chọn 90° theo chiều kim đồng hồ")),
    iconButton("flip-horizontal", icons.flipHorizontal, t("Lật ngang khung đang chọn")),
    iconButton("flip-vertical", icons.flipVertical, t("Lật dọc khung đang chọn")),
    iconButton("invert", icons.invert, t("Đảo màu")),
    iconButton("reset", icons.reset, t(state.mode === "mpr" ? "Đặt lại ba mặt phẳng" : "Đặt lại hiển thị")),
  ].join("");

  const markup = [
    iconButton("clear-annotations", icons.clearAnnotations, t("Xóa mọi phép đo, ROI và ghi chú")),
    iconButton("save-annotations", icons.save, t("Lưu đo/ROI/ghi chú")),
    iconButton("roi-volume", icons.volume, t("Tính thể tích ROI"), false, !series?.mprReady),
  ].join("");

  const compareTools = isCompareMode()
    ? [
        `<span class="toolbar-divider"></span>`,
        // Toggles name what they do; whether they are on is already visible
        // from the pressed state, so the tooltip does not spell it out.
        `<div class="tool-cluster compare-tools">
          ${iconButton("scroll-sync", icons.scrollSync, t("Khoá cuộn theo vị trí"), state.scrollSync)}
          ${iconButton("reference-lines", icons.referenceLines, t("Đường tham chiếu"), state.referenceLines)}
          ${iconButton("reference-cursor", icons.referenceCursor, t("Con trỏ tham chiếu"), state.referenceCursor)}
        </div>`,
      ]
    : [];

  const output = [
    iconButton("capture", icons.capture, t("Lưu ảnh")),
    iconButton("file-info", icons.info, t("Thông tin file & Link tải")),
  ].join("");

  return [
    `<div class="tool-cluster nav-tools">${nav}</div>`,
    `<span class="toolbar-divider"></span>`,
    `<div class="tool-cluster measure-tools">${measure}</div>`,
    `<span class="toolbar-divider"></span>`,
    `<div class="tool-cluster orientation-tools">${orientation}</div>`,
    `<span class="toolbar-divider"></span>`,
    `<div class="tool-cluster markup-tools">${markup}</div>`,
    ...compareTools,
    `<span class="toolbar-divider"></span>`,
    `<div class="tool-cluster output-tools">${output}</div>`,
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

export function formatDisplayDate(dateStr) {
  if (!dateStr) return t("Chưa rõ ngày");
  const clean = String(dateStr).replace(/\D/g, "");
  if (clean.length === 8) {
    const yyyy = clean.slice(0, 4);
    const mm = clean.slice(4, 6);
    const dd = clean.slice(6, 8);
    return `${dd}/${mm}/${yyyy}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [yyyy, mm, dd] = dateStr.split("-");
    return `${dd}/${mm}/${yyyy}`;
  }
  return dateStr;
}

function groupSeriesHierarchically(seriesList) {
  if (!Array.isArray(seriesList) || !seriesList.length) return [];

  const dateMap = new Map();

  for (const item of seriesList) {
    let dateKey = "";
    let rawDate = item.studyDate || "";
    if (!rawDate && item.studyGroup) {
      const parts = item.studyGroup.split(" - ");
      if (/^\d{4}-\d{2}-\d{2}/.test(parts[0])) {
        rawDate = parts[0];
      } else if (/^\d{8}/.test(parts[0])) {
        rawDate = parts[0];
      }
    }
    const cleanDigits = String(rawDate || "").replace(/\D/g, "");
    if (cleanDigits.length >= 8) {
      dateKey = `${cleanDigits.slice(0, 4)}-${cleanDigits.slice(4, 6)}-${cleanDigits.slice(6, 8)}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      dateKey = rawDate.slice(0, 10);
    } else {
      dateKey = "0000-00-00";
    }

    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, new Map());
    }
    const studyMap = dateMap.get(dateKey);

    let studyTitle = item.studyGroup || "";
    if (studyTitle) {
      const parts = studyTitle.split(" - ");
      if (parts.length >= 2 && (/^\d{4}-\d{2}-\d{2}/.test(parts[0]) || /^\d{8}/.test(parts[0]))) {
        studyTitle = parts.slice(1).join(" - ");
      }
    }
    if (!studyTitle || studyTitle === "Không rõ ca chụp") {
      const mod = item.modality && item.modality !== "UNKNOWN" ? item.modality : "";
      const desc = item.studyDescription || "";
      studyTitle = [mod, desc].filter(Boolean).join(" · ") || t("Ca chụp chưa phân loại");
    }

    if (!studyMap.has(studyTitle)) {
      studyMap.set(studyTitle, []);
    }
    studyMap.get(studyTitle).push(item);
  }

  const sortedDates = Array.from(dateMap.keys()).sort((a, b) => {
    if (a === "0000-00-00") return 1;
    if (b === "0000-00-00") return -1;
    return b.localeCompare(a);
  });

  const result = [];
  for (const dateKey of sortedDates) {
    const displayDate = dateKey === "0000-00-00" ? t("Chưa rõ ngày chụp") : formatDisplayDate(dateKey);
    for (const [studyTitle, items] of dateMap.get(dateKey).entries()) {
      result.push({ dateKey, displayDate, studyTitle, items });
    }
  }

  return result;
}

function seriesLabel(item) {
  return item.description || item.name || t("Series");
}

function renderSeriesOptions(archive, selectedId) {
  const groups = groupSeriesHierarchically(archive.series);
  if (!groups.length) return "";
  return groups.map((group) => {
    const optgroupLabel = getLanguage() === "en"
      ? `📁 ${group.displayDate} (${group.studyTitle})`
      : `📁 Ngày ${group.displayDate} (${group.studyTitle})`;

    const options = group.items.map((item) =>
      `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>
        ${escapeHtml(seriesLabel(item))} · ${escapeHtml(seriesFrameLabel(item))}
      </option>`
    ).join("");

    return `<optgroup label="${escapeHtml(optgroupLabel)}">${options}</optgroup>`;
  }).join("");
}

function renderSeriesStripContent(seriesList) {
  const groups = groupSeriesHierarchically(seriesList);
  if (!groups.length) return "";

  const multiGroup = groups.length > 1;

  return groups.map((group) => {
    const dateLabel = getLanguage() === "en"
      ? `${group.displayDate}`
      : `Ngày ${group.displayDate}`;

    const groupHeader = multiGroup
      ? `<div class="series-group-badge" title="${escapeHtml(`${dateLabel} - ${group.studyTitle}`)}">
          <span class="badge-date">${escapeHtml(dateLabel)}</span>
          <span class="badge-study">${escapeHtml(group.studyTitle)}</span>
         </div>`
      : "";

    const cards = group.items.map((item) => {
      const visiblePanes = seriesVisiblePanes(item.id);
      const isVisible = visiblePanes.length > 0;
      const label = seriesLabel(item);
      return `<button class="series-card ${isVisible ? "active" : ""}"
              data-series-id="${item.id}" title="${escapeHtml(label)}"
              ${isVisible ? `data-pane="${visiblePanes.join(",")}"` : ""}>
              <div class="series-thumb-box">
                <img class="series-card-thumb" data-thumb-id="${item.id}" alt="" />
                ${item.mprReady ? `<span class="badge-3d">3D</span>` : ""}
                <div class="series-thumb-overlay">
                  <b class="series-thumb-title">${escapeHtml(label)}</b>
                  <span class="series-thumb-count">${item.sliceCount || 0}</span>
                </div>
              </div>
            </button>`;
    }).join("");

    return groupHeader + cards;
  }).join("");
}

function seriesFrameLabel(series) {
  // A multi-frame file is expanded into one slice per frame, so the count is
  // the real number of images either way; only the noun changes.
  const numberOfFrames = Number(series?.pixelData?.numberOfFrames || 1);
  const unit = numberOfFrames > 1 ? t("khung") : t("lát");
  return `${series?.sliceCount || 0} ${unit}`;
}


function windowPresetHint(series) {
  if (seriesSupportsHounsfield(series)) return "Cửa sổ Hounsfield (HU)";
  // MR has no absolute intensity scale, so no fixed window can be offered.
  if (series?.sourceType === "dicom") return "Cửa sổ theo WC/WW trong file";
  return "Preset thị giác 8-bit";
}

function renderWinbar() {
  const worklistActive = state.activeTabId === "worklist";
  const tabItems = state.tabs.map((tab) => {
    const isActive = tab.id === state.activeTabId;
    const title = `${tab.patientId ? tab.patientId + " - " : ""}${tab.patientName || "Bệnh nhân"}`;
    const modality = tab.archive?.series?.[0]?.modality || "DICOM";
    return `<div class="winbar-tab${isActive ? " active" : ""}" data-tab-id="${tab.id}">
      <span class="winbar-tab-icon">👤</span>
      <span class="winbar-tab-title" title="${escapeHtml(title)}">${escapeHtml(title)} [${escapeHtml(modality)}]</span>
      <button class="winbar-tab-close" data-action="close-tab" data-tab-id="${tab.id}" title="${escapeHtml(t("Đóng tab"))}">×</button>
    </div>`;
  }).join("");

  return `<nav class="winbar">
    <div class="winbar-tab${worklistActive ? " active" : ""}" data-tab-id="worklist">
      <span class="winbar-tab-icon">📋</span>
      <span class="winbar-tab-title">Worklist</span>
    </div>
    ${tabItems}
    <button class="winbar-add-btn" data-action="choose-archive" title="${escapeHtml(t("Mở folder DICOM hoặc JPG/PNG trong viewer"))}">+</button>
  </nav>`;
}

/** Media types the viewer knows how to open. */
const MEDIA_TYPES = new Set(["dicom", "photo", "video", "doc", "text", "pdf"]);

/**
 * Which viewer a series opens in, as decided by the backend.
 *
 * The catalog reads it off the files on disk and sends it as `mediaType`. This
 * used to be guessed here instead, by looking for "mổ" and "phẫu thuật" in the
 * study description — which routed every post-operative follow-up ("MR khớp
 * gối sau mổ", "CT bụng sau mổ ruột thừa") into the video trimmer, and left a
 * genuine surgical video named in English on the DICOM canvas. A file's type
 * is a property of the file, so nothing is inferred from prose here.
 *
 * An unknown value falls back to the diagnostic canvas: showing a series in
 * the reading view is always recoverable, dropping it is not.
 */
function getSeriesMediaType(series) {
  if (!series) return "dicom";
  return MEDIA_TYPES.has(series.mediaType) ? series.mediaType : "dicom";
}

function formatVideoTime(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(remSec).padStart(2, "0");
  return `${mm}:${ss}`;
}

function renderSurgeryVideoStudio(series) {
  if (!series) return `<div class="empty-state"><b>${escapeHtml(t("Chưa có video nào"))}</b></div>`;
  // A work file is served by its random name; both work and archive streams
  // carry the active tab's read-only media credentials in the URL.
  // The work path comes back from the backend with Windows separators, so
  // splitting on "/" alone left the whole path in place as the file name.
  const workName = workFileName(state.videoWorkingPath);
  const bookmarks = state.videoBookmarks || [];
  const filmstrip = state.videoFilmstrip || [];
  return `
    <div class="surgery-video-studio">
      <div class="surgery-video-toolbar" style="display:flex; gap:8px; padding:8px 12px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle); align-items:center; flex-wrap:wrap;">
        ${renderMediaFileNav(series)}
        ${renderEditHistoryNav(series)}
        <button class="tool-btn" data-action="video-tool-trim" title="${escapeHtml(t("Cắt đoạn video"))}">✂ ${escapeHtml(t("Cắt đoạn"))}</button>
        <button class="tool-btn" data-action="video-tool-concat" title="${escapeHtml(t("Ghép các clip video"))}">🔗 ${escapeHtml(t("Ghép clips"))}</button>
        <button class="tool-btn" data-action="video-tool-burn-text" title="${escapeHtml(t("Đóng dấu / Chèn thông tin phẫu thuật"))}">🏷 ${escapeHtml(t("Đóng dấu thông tin"))}</button>
        <button class="tool-btn" data-action="video-tool-thumb" title="${escapeHtml(t("Trích xuất ảnh đại diện Thumbnail"))}">🖼 ${escapeHtml(t("Tạo Thumbnail"))}</button>
        <button class="tool-btn" data-action="video-tool-filmstrip" title="${escapeHtml(t("Tạo chuỗi ảnh Filmstrip"))}">🎞 ${escapeHtml(t("Tạo Filmstrip"))}</button>
        <button class="tool-btn" data-action="video-tool-transcode" title="${escapeHtml(t("Tối ưu hoá mã hoá MP4 (H.264)"))}">⚡ ${escapeHtml(t("Tối ưu MP4"))}</button>
        <span style="flex:1;"></span>
        <div id="video-meta-badge" class="badge" style="font-size:11px; padding:4px 8px; opacity:0.85;">🎬 ${escapeHtml(series.patientName || "Video Phẫu Thuật")}</div>
      </div>
      <div class="surgery-video-body">
        <div class="surgery-video-stage">
          <video id="surgery-video-player" class="surgery-video-element" src="${escapeHtml(videoStreamUrl(series, workName))}" playsinline preload="metadata"></video>
        </div>
        <aside class="surgery-video-sidebar">
          <div class="surgery-video-sidebar-header">
            <span>📌 ${escapeHtml(t("Mốc phẫu thuật / Ghi chú"))}</span>
            <button class="control-btn primary" data-action="add-video-bookmark">+ ${escapeHtml(t("Đánh dấu mốc"))}</button>
          </div>
          <div class="surgery-video-bookmarks">
            ${bookmarks.length === 0 ? `<div class="empty-state" style="padding:20px; font-size:12px;">${escapeHtml(t("Chưa có mốc ghi chú nào"))}</div>` : bookmarks.map((bm, i) => `
              <div class="surgery-bookmark-card" data-action="seek-video" data-time="${bm.time}">
                <div class="surgery-bookmark-time">⏱ ${formatVideoTime(bm.time)}</div>
                <div class="surgery-bookmark-text">${escapeHtml(bm.text || t("Mốc phẫu thuật"))}</div>
              </div>
            `).join("")}
          </div>
        </aside>
      </div>
      ${filmstrip.length > 0 ? `
        <div class="surgery-video-filmstrip" style="display:flex; gap:6px; padding:6px 12px; background:var(--bg-canvas); overflow-x:auto; border-top:1px solid var(--border-subtle);">
          ${filmstrip.map((framePath, idx) => {
            const frameName = framePath.split(/[\\/]/).pop();
            const frameUrl = mediaAuthUrl(`/api/media/work-file?name=${encodeURIComponent(frameName)}`);
            return `<img src="${escapeHtml(frameUrl)}" style="height:48px; border-radius:4px; cursor:pointer; border:1px solid var(--border-subtle);" title="Frame ${idx + 1}" data-action="seek-filmstrip-idx" data-idx="${idx}" data-total="${filmstrip.length}" />`;
          }).join("")}
        </div>
      ` : ""}
      <div class="surgery-video-controls">
        <button class="control-btn" data-action="video-play-pause" title="${escapeHtml(t("Phát / Tạm dừng"))}">⏯</button>
        <button class="control-btn" data-action="video-rewind-5" title="${escapeHtml(t("Tua lùi 5s"))}">-5s</button>
        <button class="control-btn" data-action="video-forward-5" title="${escapeHtml(t("Tua tới 5s"))}">+5s</button>
        <span id="video-time-display" class="video-time">00:00 / 00:00</span>
        <input type="range" id="surgery-video-scrubber" class="video-scrubber" min="0" max="100" step="0.1" value="0">
        <select id="video-speed-select" class="control-btn" title="${escapeHtml(t("Tốc độ"))}">
          <option value="0.5">0.5x</option>
          <option value="1.0" selected>1.0x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2.0">2.0x</option>
        </select>
        <button class="control-btn" data-action="video-snapshot" title="${escapeHtml(t("Chụp khung hình"))}">📸 ${escapeHtml(t("Chụp"))}</button>
      </div>
    </div>
  `;
}

/**
 * Which file of a multi-file media series is on screen.
 *
 * A folder of intra-operative photos or clips is one series with many files.
 * Both studios addressed `/image/0` and showed only the first, so a timeline
 * row reading "10 ảnh" opened a single picture with no way to reach the rest.
 */
function mediaFileIndex(series) {
  const total = Number(series?.sliceCount) || 1;
  const raw = Number(state.mediaIndex?.[series?.id] ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(Math.trunc(raw), total - 1));
}

/** Move the cursor within the current media series and repaint its pane. */
function stepMediaFile(series, delta) {
  if (!series) return;
  const total = Number(series.sliceCount) || 1;
  const next = Math.max(0, Math.min(mediaFileIndex(series) + delta, total - 1));
  if (next === mediaFileIndex(series)) return;
  state.mediaIndex = { ...(state.mediaIndex || {}), [series.id]: next };
  // Each file owns its own edit chain. Restore the chain for the page landed
  // on instead of carrying page 1's derivative into page 2.
  restoreMediaEditState(series);
  state.photoRotation = 0;
  state.videoFilmstrip = [];
  render();
  renderViewer();
}

/** The `‹ n/N ›` strip both media studios share, hidden for a lone file. */
function renderMediaFileNav(series) {
  const total = Number(series?.sliceCount) || 1;
  if (total <= 1) return "";
  const index = mediaFileIndex(series);
  return `
    <span class="media-file-nav">
      <button class="tool-btn" data-action="media-file-prev" ${index <= 0 ? "disabled" : ""}>‹</button>
      <span class="media-file-count">${index + 1}/${total}</span>
      <button class="tool-btn" data-action="media-file-next" ${index >= total - 1 ? "disabled" : ""}>›</button>
    </span>
  `;
}

function renderPhotoEditorStudio(series) {
  if (!series) return `<div class="empty-state"><b>${escapeHtml(t("Chưa có ảnh nào"))}</b></div>`;
  // Naming the edit in the markup is what makes undo work and what stops any
  // re-render from silently dropping back to the untouched file.
  const workName = workFileName(state.photoWorkingPath);
  const source = workName ? `work:${workName}` : `${series.id}:${mediaFileIndex(series)}`;
  return `
    <div class="photo-editor-studio">
      <div class="photo-editor-toolbar">
        ${renderMediaFileNav(series)}
        ${renderEditHistoryNav(series)}
        <button class="tool-btn" data-action="photo-rotate-cw">↻ ${escapeHtml(t("Xoay 90°"))}</button>
        <button class="tool-btn" data-action="photo-tool-crop">✂ ${escapeHtml(t("Cắt vùng chọn"))}</button>
        <button class="tool-btn" data-action="photo-tool-redact">⬛ ${escapeHtml(t("Che tên/danh tính"))}</button>
        <button class="tool-btn" data-action="photo-tool-arrow">↗ ${escapeHtml(t("Vẽ mũi tên"))}</button>
        <button class="tool-btn" data-action="photo-tool-box">▢ ${escapeHtml(t("Khoanh vùng"))}</button>
        <button class="tool-btn" data-action="photo-tool-text">T ${escapeHtml(t("Ghi chú chữ"))}</button>
        <span style="flex:1;"></span>
        <button class="tool-btn" data-action="photo-save-edit" ${state.photoWorkingPath ? "" : "disabled"}>💾 ${escapeHtml(t("Lưu vào hồ sơ"))}</button>
        <button class="tool-btn primary" data-action="photo-export-pdf">📄 ${escapeHtml(t("Xuất file PDF"))}</button>
      </div>
      <div class="photo-editor-stage">
        <div class="photo-editor-canvas-wrap" id="photo-editor-canvas">
          <img id="photo-editor-img" class="photo-editor-image" data-media-src="${escapeHtml(source)}" style="transform: rotate(${state.photoRotation || 0}deg);" alt="${escapeHtml(series.description || "")}">
          <div id="photo-selection" class="photo-selection" hidden></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * The loaded text document, but only when it belongs to `series`.
 *
 * Both halves must be checked explicitly. Comparing `state.textDoc?.seriesId`
 * against `series?.id` looks equivalent and is not: with no archive open and
 * nothing loaded, both sides are `undefined`, the comparison passes, and the
 * caller dereferences a null document. That is what made the app fail to boot
 * with an empty archive.
 */
function currentTextDoc(series) {
  if (!series || !state.textDoc) return null;
  return state.textDoc.seriesId === series.id ? state.textDoc : null;
}

/**
 * The text/JSON reading pane.
 *
 * Content arrives from `/api/series/<id>/text` after the pane mounts, so this
 * renders the frame and a loading line; `loadTextContent` fills it in. Text
 * belongs to the diagnostic side of the app — an operative report is read, not
 * edited — so it carries no editing tools, only navigation between files.
 */
function renderTextViewer(series) {
  if (!series) return `<div class="empty-state"><b>${escapeHtml(t("Chưa có văn bản nào"))}</b></div>`;
  const doc = currentTextDoc(series);
  const total = Number(series.sliceCount) || 1;
  const index = doc ? doc.index : 0;

  return `
    <div class="text-viewer">
      <div class="text-viewer-bar">
        <span class="text-viewer-name">${escapeHtml(doc?.name || series.name || "")}</span>
        ${total > 1 ? `
          <span class="text-viewer-nav">
            <button class="tool-btn" data-action="text-prev" ${index <= 0 ? "disabled" : ""}>‹</button>
            <span class="text-viewer-count">${index + 1}/${total}</span>
            <button class="tool-btn" data-action="text-next" ${index >= total - 1 ? "disabled" : ""}>›</button>
          </span>
        ` : ""}
        <span style="flex:1;"></span>
        ${doc?.language === "json" ? `<span class="text-viewer-badge">JSON</span>` : ""}
        <button class="tool-btn" data-action="text-copy" ${doc ? "" : "disabled"}>${escapeHtml(t("Chép"))}</button>
      </div>
      <pre class="text-viewer-body" id="text-viewer-body">${
        doc ? escapeHtml(doc.text) : escapeHtml(t("Đang đọc file…"))
      }</pre>
    </div>
  `;
}

/**
 * Point a media element at an API URL it cannot fetch by itself.
 *
 * Every /api route requires the `X-DCom-Token` header, which `<img src>`,
 * `<video src>` and `<embed src>` cannot send — assigning the URL directly
 * produced a 401 and a broken element. The blob is fetched with the header and
 * the element gets an object URL.
 */
async function setMediaElementSrc(element, url) {
  if (!element || !url) return;
  try {
    const parsed = new URL(url, window.location?.origin || "http://127.0.0.1");
    const workName = parsed.pathname === "/api/media/work-file"
      ? parsed.searchParams.get("name")
      : "";
    const seriesMatch = parsed.pathname.match(/^\/api\/series\/([a-f0-9]{20})\/image\/(\d+)$/);
    const descriptor = workName
      ? `work:${workName}`
      : seriesMatch
        ? `${seriesMatch[1]}:${seriesMatch[2]}`
        : "";
    element.src = descriptor
      ? await mediaBlobUrl(descriptor)
      : URL.createObjectURL(await apiBlob(url));
  } catch (error) {
    setStatus(humanError(error), true);
  }
}

/**
 * Object URLs for media files fetched through the authenticated API.
 *
 * `<img src>` and `<embed src>` cannot carry the `X-DCom-Token` header, so
 * pointing them straight at `/api/series/.../image/N` returned 401 and the
 * photo pane showed a broken image. Each file is fetched once as a blob — the
 * same trick the thumbnail strip already used — and the object URL is what the
 * element gets.
 */
const mediaObjectUrls = new Map();

/**
 * The blob for one media descriptor, fetched once.
 *
 * A descriptor is either `seriesId:index` for a file in the archive or
 * `work:name` for one the editor has just written. Both go through the same
 * cache so a pane that is showing an edit survives a re-render: the markup
 * says which file it wants and this resolves it.
 */
function mediaBlobUrl(descriptor) {
  const key = String(descriptor);
  let pending = mediaObjectUrls.get(key);
  if (!pending) {
    const separator = key.indexOf(":");
    const head = key.slice(0, separator);
    const tail = key.slice(separator + 1);
    const path = head === "work"
      ? `/api/media/work-file?name=${encodeURIComponent(tail)}`
      : `/api/series/${head}/image/${Number(tail) || 0}`;
    pending = apiBlob(path).then((blob) => URL.createObjectURL(blob));
    pending.catch(() => mediaObjectUrls.delete(key));
    mediaObjectUrls.set(key, pending);
  }
  return pending;
}

function mediaFileUrl(seriesId, index) {
  return mediaBlobUrl(`${seriesId}:${index}`);
}

/**
 * The URL the surgical player reads from.
 *
 * Video is the one medium that must not go through `apiBlob`: a clip of a
 * whole operation would be held in memory in full, would only start playing
 * once every byte had arrived, and could not be seeked. The stream URL carries
 * its own credentials so the element can fetch ranges by itself.
 */
function videoStreamUrl(series, workName = "") {
  if (workName) return mediaAuthUrl(`/api/media/work-file?name=${encodeURIComponent(workName)}`);
  return mediaAuthUrl(`/api/series/${series.id}/image/${mediaFileIndex(series)}`);
}

/** Point a video element at a freshly rendered work file, still streaming. */
function setVideoElementSrc(element, url) {
  if (!element || !url) return;
  element.src = mediaAuthUrl(url);
  element.load();
}

/**
 * Hand the reader a file the API will only release with a token.
 *
 * An `<a download href="/api/...">` cannot send the header, so both export
 * buttons were answering 401 and saving nothing. jsdom never performs the
 * navigation, which is why the tests stayed green.
 */
async function downloadApiFile(url, filename) {
  const blob = await apiBlob(url);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/**
 * Drop the blobs held for records that are no longer on screen.
 *
 * Every opened file used to stay in `mediaObjectUrls` for the life of the
 * window, so reading through a worklist grew the browser's memory by the size
 * of every photo and document that had been looked at.
 */
function releaseMediaObjectUrls(keepSeriesId = "") {
  for (const [key, pending] of [...mediaObjectUrls]) {
    if (keepSeriesId && key.startsWith(`${keepSeriesId}:`)) continue;
    mediaObjectUrls.delete(key);
    Promise.resolve(pending).then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
}

/**
 * The chain of edits made to one record since it was opened.
 *
 * Each tool writes a new file into the scratch folder and leaves the previous
 * one there, so stepping back is only a matter of pointing at the earlier file
 * again — nothing is recomputed, and the file in the archive is never touched
 * by any of it. A reader who crops too tightly or redacts the wrong corner had
 * no way back before this except reopening the record.
 */
function editHistoryFor(seriesId, index = 0) {
  const all = state.mediaEdits || (state.mediaEdits = {});
  const key = `${seriesId}:${Math.max(0, Number(index) || 0)}`;
  return all[key] || (all[key] = { steps: [], cursor: -1 });
}

function seriesEditHistory(series) {
  return editHistoryFor(series.id, mediaFileIndex(series));
}

/** Record the file a tool just produced as the newest step. */
function pushMediaEdit(series, result) {
  if (!series || !result?.outputPath) return;
  const history = seriesEditHistory(series);
  // Editing after stepping back replaces the branch that was undone.
  history.steps = history.steps.slice(0, history.cursor + 1);
  history.steps.push({ path: result.outputPath, url: result.url || "" });
  history.cursor = history.steps.length - 1;
  syncEditHistoryButtons(series);
}

/** Cursor -1 is the untouched file the archive holds. */
function currentMediaEdit(series) {
  if (!series) return null;
  const history = seriesEditHistory(series);
  return history.cursor >= 0 ? history.steps[history.cursor] : null;
}

function canUndoMediaEdit(series) {
  return Boolean(series) && seriesEditHistory(series).cursor >= 0;
}

function canRedoMediaEdit(series) {
  if (!series) return false;
  const history = seriesEditHistory(series);
  return history.cursor < history.steps.length - 1;
}

/** Move along the chain and repaint the pane at the step landed on. */
function stepMediaEdit(series, delta) {
  if (!series) return;
  const history = seriesEditHistory(series);
  const next = Math.max(-1, Math.min(history.cursor + delta, history.steps.length - 1));
  if (next === history.cursor) return;
  history.cursor = next;
  const step = next >= 0 ? history.steps[next] : null;
  if (getSeriesMediaType(series) === "video") {
    state.videoWorkingPath = step ? step.path : null;
  } else {
    state.photoWorkingPath = step ? step.path : null;
    // The rotation was baked into the file the step points at.
    state.photoRotation = 0;
  }
  // The pane names the file it wants in its markup, so a plain re-render is
  // enough to bring the right one back.
  render();
  renderViewer();
  setStatus(step
    ? tf(delta < 0 ? "Đã hoàn tác đến bước {}/{}." : "Đã làm lại đến bước {}/{}.", next + 1, history.steps.length)
    : t("Đã quay lại file gốc trong hồ sơ."));
}

/** Restore the derivative, if any, for the selected file in this series. */
function restoreMediaEditState(series) {
  const step = currentMediaEdit(series);
  if (getSeriesMediaType(series) === "video") {
    state.videoWorkingPath = step?.path || null;
    state.photoWorkingPath = null;
  } else {
    state.photoWorkingPath = step?.path || null;
    state.videoWorkingPath = null;
  }
}

/** Keep the two arrows in step with the history without a full re-render. */
function syncEditHistoryButtons(series) {
  const root = getDomRoot();
  if (!root) return;
  const undo = root.querySelector("[data-action='media-edit-undo']");
  const redo = root.querySelector("[data-action='media-edit-redo']");
  if (undo) undo.disabled = !canUndoMediaEdit(series);
  if (redo) redo.disabled = !canRedoMediaEdit(series);
  const save = root.querySelector("[data-action='photo-save-edit']");
  if (save) save.disabled = !state.photoWorkingPath;
}

/** The undo/redo pair both studios share. */
function renderEditHistoryNav(series) {
  return `
    <button class="tool-btn" data-action="media-edit-undo" ${canUndoMediaEdit(series) ? "" : "disabled"}
      title="${escapeHtml(t("Hoàn tác bước chỉnh sửa"))}">↶</button>
    <button class="tool-btn" data-action="media-edit-redo" ${canRedoMediaEdit(series) ? "" : "disabled"}
      title="${escapeHtml(t("Làm lại bước vừa hoàn tác"))}">↷</button>
  `;
}

/** The scratch file name a work path points at, for a media descriptor. */
function workFileName(workPath) {
  return String(workPath || "").split(/[\\/]/).pop() || "";
}

/** Point every media element at its authenticated blob once the page is up. */
function hydrateMediaSources() {
  const root = getDomRoot();
  if (!root) return;
  for (const element of root.querySelectorAll("[data-media-src]")) {
    const descriptor = String(element.dataset.mediaSrc);
    if (!descriptor.includes(":")) continue;
    mediaBlobUrl(descriptor)
      .then((url) => { element.src = url; })
      .catch((error) => setStatus(humanError(error), true));
  }
}

/**
 * The PDF reading pane.
 *
 * Scanned paperwork is read, never edited, so this is a plain embed of the
 * file the archive already serves — no toolbar, no annotation layer. The
 * worklist has always counted these documents; until now nothing could open
 * one.
 */
function renderPdfViewer(series) {
  if (!series) return `<div class="empty-state"><b>${escapeHtml(t("Chưa có tài liệu nào"))}</b></div>`;
  const index = mediaFileIndex(series);
  return `
    <div class="pdf-viewer">
      <div class="pdf-viewer-bar">
        <span class="pdf-viewer-name">${escapeHtml(series.description || series.name || "")}</span>
        ${renderMediaFileNav(series)}
      </div>
      <embed class="pdf-viewer-frame" type="application/pdf"
        data-media-src="${escapeHtml(series.id)}:${index}">
    </div>
  `;
}

/**
 * Which pane fills the workspace for the selected series.
 *
 * One switch on the media type the backend reported, so adding a reader means
 * adding a branch here rather than threading another condition through the
 * shell markup.
 */
function renderWorkspacePane(series) {
  switch (getSeriesMediaType(series)) {
    case "video":
      return renderSurgeryVideoStudio(series);
    case "photo":
    case "doc":
      return renderPhotoEditorStudio(series);
    case "text":
      return renderTextViewer(series);
    case "pdf":
      return renderPdfViewer(series);
    default:
      break;
  }
  if (state.archive.series.length) {
    return `<div class="viewer-loading">${state.busyViewer ? escapeHtml(t("Đang dựng khung xem…")) : ""}</div>`;
  }
  return `<div class="empty-state"><b>${escapeHtml(t("Chưa mở hồ sơ nào"))}</b>
      <p>${escapeHtml(t("Mở folder hồ sơ; app tự phân loại phim DICOM, ảnh, video và văn bản bên trong."))}</p>
      <div class="empty-actions">
        <button class="primary" data-action="choose-archive">${escapeHtml(t("Mở folder"))}</button>
      </div></div>`;
}

/**
 * Whether the download column is on screen.
 *
 * Downloading belongs to the worklist: that tab is where a record is found,
 * fetched and kept up to date. A viewer tab gives the same column to the
 * patient rail instead, so the two never compete for the left edge.
 */
function downloadPanelVisible() {
  return state.activeTabId === "worklist" && state.downloadOpen;
}

/** Labels for the media kinds a timeline entry can carry. */
const MEDIA_KIND_LABELS = {
  dicom: "Phim chụp",
  photo: "Ảnh",
  doc: "Bệnh án",
  video: "Video",
  text: "Văn bản",
  pdf: "Bệnh án PDF",
};

/**
 * The open archive grouped into study/media rows, then days, newest first.
 *
 * The rail is a chronological record of one patient, so the grouping key is
 * the study date. A series whose date was never recorded lands in a single
 * undated bucket at the end rather than being stamped with today.
 */
function buildMediaTimeline(seriesList, timelineLabels = {}) {
  const days = new Map();
  for (const item of seriesList || []) {
    let rawDate = item.studyDate || "";
    if (!rawDate && item.studyGroup) rawDate = item.studyGroup.split(" - ")[0];
    const digits = String(rawDate).replace(/\D/g, "");
    const key = digits.length >= 8 ? digits.slice(0, 8) : "";
    if (!days.has(key)) days.set(key, new Map());
    const kind = getSeriesMediaType(item);
    const legacyIdentity = item.studyGroup || item.studyDescription
      || (kind === "dicom" ? item.modality : item.id) || item.id;
    const timelineKey = item.timelineKey || `legacy:${key}:${kind}:${legacyIdentity}`;
    const groups = days.get(key);
    if (!groups.has(timelineKey)) {
      groups.set(timelineKey, { key: timelineKey, kind, series: [] });
    }
    groups.get(timelineKey).series.push(item);
  }
  return [...days.entries()]
    .sort((a, b) => {
      // The undated bucket sorts last whichever side it appears on.
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return b[0].localeCompare(a[0]);
    })
    .map(([key, groups]) => ({
      key,
      label: key ? `${key.slice(6, 8)}/${key.slice(4, 6)}/${key.slice(0, 4)}` : t("Chưa rõ ngày chụp"),
      items: [...groups.values()].map((group) => {
        const descriptions = group.series
          .map((item) => String(item.studyDescription || "").trim())
          .filter(Boolean);
        let defaultTitle = descriptions[0] || "";
        if (!defaultTitle) {
          defaultTitle = String(group.series[0]?.studyGroup || "")
            .replace(/^\d{4}(?:-?\d{2}){2}\s*-\s*/, "")
            .trim();
        }
        if (!defaultTitle || defaultTitle === "Không rõ ca chụp") {
          defaultTitle = String(group.series[0]?.description || group.series[0]?.name || "").trim();
        }
        const modality = String(group.series[0]?.modality || "").trim();
        if (
          group.kind === "dicom"
          && modality
          && defaultTitle
          && !defaultTitle.toUpperCase().startsWith(modality.toUpperCase())
        ) {
          defaultTitle = `${modality} ${defaultTitle}`;
        }
        if (!defaultTitle) defaultTitle = t(MEDIA_KIND_LABELS[group.kind] || "Phim chụp");
        const primary = [...group.series].sort((left, right) => (
          Number(Boolean(right.mprReady)) - Number(Boolean(left.mprReady))
          || Number(right.sliceCount || 0) - Number(left.sliceCount || 0)
        ))[0];
        return {
          ...group,
          defaultTitle,
          title: String(timelineLabels?.[group.key] || "").trim() || defaultTitle,
          primaryId: primary?.id || "",
          memberIds: group.series.map((item) => item.id),
        };
      }),
    }));
}

/** The simple study/media count shown at the right edge of one timeline row. */
function timelineItemCount(group) {
  if (group.kind === "dicom") return tf("{} phim", group.series.length);
  const total = group.series.reduce((sum, item) => {
    const count = Number(item.sliceCount);
    return sum + (Number.isFinite(count) && count > 0 ? count : 0);
  }, 0);
  if (!total) return "";
  switch (group.kind) {
    case "video": return tf("{} video", total);
    case "pdf": return tf("{} bản PDF", total);
    case "text": return tf("{} file", total);
    case "doc": return tf("{} trang", total);
    case "photo": return tf("{} ảnh", total);
    default: return "";
  }
}

/**
 * The patient rail down the left of a viewer tab: who this is, then what has
 * been recorded for them and when.
 *
 * Identity comes from `patient-index.json` by way of the archive snapshot.
 * Every field the manifest does not carry prints "—": this block sits beside
 * the images a clinician is about to read, so a plausible-looking guess here
 * is exactly the failure the archive rules exist to prevent.
 */
function renderPatientRail() {
  const patient = state.archive?.patient || {};
  const series = state.archive?.series || [];
  const dash = (value) => (String(value || "").trim() || "—");

  const identity = [patient.gender, patient.birthYear, patient.age ? tf("{} tuổi", patient.age) : ""]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");

  const timeline = buildMediaTimeline(series, patient.timelineLabels || {});

  return `
    <aside class="rec-rail">
      <div class="rec-id">
        <b>${escapeHtml(dash(patient.patientName) === "—"
          ? t("Chưa có tên bệnh nhân")
          : patient.patientName)}</b>
        <small>${escapeHtml(dash(patient.patientId))}${identity ? ` · ${escapeHtml(identity)}` : ""}</small>
      </div>

      <dl class="rec-facts">
        <div class="rfact"><dt>${escapeHtml(t("Bệnh viện"))}</dt><dd>${escapeHtml(dash(patient.hospital))}</dd></div>
        <div class="rfact">
          <dt>${escapeHtml(t("Chẩn đoán"))}</dt>
          <dd><button class="rfact-edit" type="button" data-action="edit-diagnosis"
            title="${escapeHtml(t("Ghi chẩn đoán cho hồ sơ này"))}">${escapeHtml(dash(patient.diagnosis))}</button></dd>
        </div>
      </dl>

      <div class="rec-timeline-head"><b>${escapeHtml(t("Timeline hồ sơ"))}</b></div>
      <div class="tl">
        ${timeline.length === 0
          ? `<div class="tl-empty">${escapeHtml(t("Chưa có dữ liệu nào trong hồ sơ này."))}</div>`
          : timeline.map((day) => `
            <div class="tl-day">
              <div class="tl-date">${escapeHtml(day.label)}</div>
              ${day.items.map((item) => {
                const kind = item.kind;
                const count = timelineItemCount(item);
                const active = item.memberIds.includes(state.selectedId);
                return `
                  <div class="tl-item ${kind}${active ? " on" : ""}"
                    data-timeline-key="${escapeHtml(item.key)}"
                    data-timeline-members="${escapeHtml(item.memberIds.join(","))}"
                    data-timeline-label="${escapeHtml(item.title)}"
                    data-default-label="${escapeHtml(item.defaultTitle)}"
                    title="${escapeHtml(`${t(MEDIA_KIND_LABELS[kind] || "Phim chụp")} · ${item.title}`)}">
                    <button class="tl-open" type="button" data-series-id="${escapeHtml(item.primaryId)}">
                      <i></i>
                      <span class="nm">${escapeHtml(item.title)}</span>
                      ${count ? `<span class="ct">${escapeHtml(count)}</span>` : ""}
                    </button>
                    <input class="tl-name-input" value="${escapeHtml(item.title)}"
                      maxlength="120" aria-label="${escapeHtml(t("Tên hiển thị trên timeline"))}">
                    <button class="tl-edit" type="button" data-action="edit-timeline-label"
                      title="${escapeHtml(t("Đổi tên lần chụp hoặc loại media"))}" aria-label="${escapeHtml(t("Đổi tên lần chụp hoặc loại media"))}">✎</button>
                    <button class="tl-edit-save" type="button" data-action="save-timeline-label"
                      title="${escapeHtml(t("Lưu tên"))}" aria-label="${escapeHtml(t("Lưu tên"))}">✓</button>
                    <button class="tl-edit-cancel" type="button" data-action="cancel-timeline-label"
                      title="${escapeHtml(t("Bỏ thay đổi tên"))}" aria-label="${escapeHtml(t("Bỏ thay đổi tên"))}">×</button>
                  </div>
                `;
              }).join("")}
            </div>
          `).join("")}
      </div>
    </aside>
  `;
}

/** History rows matching the worklist search box. */
function filteredHistoryEntries() {
  const search = (state.worklistSearch || "").toLowerCase().trim();
  return (state.history || []).filter((entry) => {
    if (!search) return true;
    return `${entry.folder || ""} ${entry.url || ""}`.toLowerCase().includes(search);
  });
}

/**
 * The scanned patient tree, or bare history rows until the scan lands.
 *
 * `state.worklistPatients` comes from `/api/worklist`, the only code that has
 * actually walked the disk and read `patient-index.json`. The fallback exists
 * so a folder opened seconds ago is still reachable before that answers — it
 * carries only what a history row really holds, a path and the time it was
 * opened, and leaves every count null so the tree prints "—" instead of
 * claiming a series or a slice nobody counted.
 */
function getEffectiveWorklistPatients() {
  if (Array.isArray(state.worklistPatients) && state.worklistPatients.length > 0) {
    return state.worklistPatients;
  }
  const history = state.history || [];
  return history.map((entry, idx) => {
    const folderName = entry.folder ? entry.folder.split(/[\\/]/).pop() : "";
    return {
      id: `p_hist_${idx}`,
      // The folder name is the only identifier on hand. It is a real string off
      // the disk, but it is not a patient name: sex, birth year and hospital
      // stay blank rather than being guessed out of it.
      patientId: folderName,
      patientName: "",
      gender: "",
      birthYear: "",
      hospital: "",
      folder: entry.folder,
      totalSizeFormatted: "",
      mediaSummary: null,
      studies: [
        {
          id: `s_hist_${idx}`,
          // `entry.time` is when the folder was opened, not when the scan was
          // taken — printing it as a study date would misdate the images.
          studyDate: "",
          studyName: folderName,
          modality: "",
          seriesCount: null,
          sliceCount: null,
          folder: entry.folder,
          status: entry.exists === false ? "miss" : "new",
          statusLabel: entry.exists === false ? t("Thiếu folder") : t("Chưa quét"),
          mediaCounts: null,
          primaryMediaType: "",
        },
      ],
    };
  });
}

/**
 * Pull the patient tree the backend built from disk and `patient-index.json`.
 *
 * Kept separate from `refreshHistory` because the scan walks every study
 * folder: it runs when something on disk may have changed, not on every poll.
 */
async function refreshWorklist({ repaint = true } = {}) {
  try {
    const result = await api("/api/worklist");
    state.worklistPatients = Array.isArray(result?.patients) ? result.patients : [];
  } catch (_) {
    // A failed scan leaves the previous list in place; blanking the tree the
    // doctor is reading would be worse than showing a slightly stale one.
    return;
  }
  if (repaint) refreshStudyListPanel();
}

/** Repaint the Study List tree, its summary strip and the tab count in place. */
function refreshStudyListPanel() {
  if (state.activeTabId !== "worklist" || state.worklistTab === "activity") return;
  const root = getDomRoot();
  const tree = root?.querySelector(".worklist-tree");
  if (!tree) return;
  tree.innerHTML = renderWorklistTreeInner();
  bindWorklistOpenButtons(tree);

  const summary = root.querySelector(".worklist-summary");
  if (summary) summary.innerHTML = renderWorklistSummaryInner();

  const count = root.querySelector(".worklist-tab[data-worklist-tab='studies'] .worklist-tab-count");
  if (count) count.textContent = String(filteredPatientList().length);
}

/** Patients matching the search box. */
function filteredPatientList() {
  const search = (state.worklistSearch || "").toLowerCase().trim();
  const patients = getEffectiveWorklistPatients();
  if (!search) return patients;

  return patients.filter((p) => {
    const pText = `${p.patientId || ""} ${p.patientName || ""} ${p.hospital || ""} ${p.gender || ""} ${p.birthYear || ""}`.toLowerCase();
    if (pText.includes(search)) return true;
    return (p.studies || []).some((s) => {
      const sText = `${s.studyDate || ""} ${s.studyName || ""} ${s.modality || ""} ${s.folder || ""}`.toLowerCase();
      return sText.includes(search);
    });
  });
}

/**
 * The "name · sex · birth year" line, dropping whatever the archive does not
 * actually know.
 *
 * Never substitutes a default: a made-up sex or birth year sitting next to a
 * patient's images is exactly the kind of detail a clinician trusts to confirm
 * they opened the right chart.
 */
function patientIdentityLine(patient) {
  const parts = [patient.patientName, patient.gender, patient.birthYear]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : t("Chưa có thông tin hành chính");
}

/**
 * The "date · description" heading of a study row.
 *
 * A study whose date was never recorded shows the description alone rather
 * than a dangling separator; neither half is ever filled with a placeholder
 * date, because two scans of one patient are told apart by exactly this line.
 */
function studyHeadingLine(study) {
  const parts = [study.studyDate, study.studyName]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : t("Ca chụp chưa có mô tả");
}

/**
 * The "N series · N lát" sub-line, listing only the halves that were counted.
 *
 * `seriesCount` and `sliceCount` are null on a folder nothing has scanned yet.
 * That is not the same as zero, so an uncounted study says so instead of
 * printing a number the app made up.
 */
function studyCountLine(study) {
  const parts = [];
  if (Number.isFinite(study.seriesCount)) parts.push(tf("{} series", study.seriesCount));
  if (Number.isFinite(study.sliceCount)) parts.push(tf("{} lát", study.sliceCount));
  return parts.length ? parts.join(" · ") : t("Chưa đếm");
}

/** Media count chips, skipping every type the scan did not actually find. */
function mediaTags(counts, labels = {}) {
  if (!counts) return "";
  return ["dicom", "photo", "video", "doc"]
    .filter((kind) => Number(counts[kind]) > 0)
    .map((kind) => {
      const suffix = labels[kind] ? ` ${escapeHtml(labels[kind])}` : "";
      return `<span class="mtag ${kind}"><i></i>${Number(counts[kind])}${suffix}</span>`;
    })
    .join("");
}

/**
 * Inner HTML of `.worklist-tree`, rendering the multi-level patient study tree.
 */
function renderWorklistTreeInner() {
  const patients = filteredPatientList();
  if (patients.length === 0) {
    return `
      <div class="empty-state">
        <b>${escapeHtml(t("Chưa có hồ sơ nào trong danh sách"))}</b>
        <div class="empty-actions" style="margin-top: 10px;">
          <button class="primary" data-action="choose-archive">${escapeHtml(t("Mở folder bệnh nhân"))}</button>
        </div>
      </div>
    `;
  }

  state.expandedPatients = state.expandedPatients || {};

  return `
    <div class="plist">
      ${patients.map((p) => {
        const isExpanded = state.expandedPatients[p.id] !== false;
        return `
          <div class="prow" role="button" tabindex="0" aria-expanded="${isExpanded}" data-toggle-patient="${escapeHtml(p.id)}">
            <span class="twist">▶</span>
            <span class="who">
              <b>${escapeHtml(p.patientId || t("Chưa rõ mã BN"))}</b>
              <small>${escapeHtml(patientIdentityLine(p))}</small>
            </span>
            <span class="meta">${escapeHtml(p.hospital || "—")}</span>
            <span class="media">
              ${mediaTags(p.mediaSummary, {
                dicom: t("series"), photo: t("ảnh"), video: t("video"), doc: t("trang"),
              })}
            </span>
            <span class="meta">${escapeHtml(p.totalSizeFormatted || "—")}</span>
            <span class="rowacts">
              <button class="soft-button" type="button" data-action="open-patient-record" data-patient-id="${escapeHtml(p.id)}">
                ${escapeHtml(t("Mở hồ sơ"))}
              </button>
            </span>
          </div>

          <div class="studies${isExpanded ? " on" : ""}" data-studies="${escapeHtml(p.id)}">
            ${(p.studies || []).map((s) => `
                <div class="srow">
                  <span class="rail"></span>
                  <span class="who">
                    <b>${escapeHtml(studyHeadingLine(s))}</b>
                    <small>${escapeHtml(studyCountLine(s))}</small>
                  </span>
                  <span class="meta">${escapeHtml(s.modality ? t(s.modality) : "—")}</span>
                  <span class="media">${mediaTags(s.mediaCounts)}</span>
                  <span class="badge ${s.status || "done"}">${escapeHtml(t(s.statusLabel || "Đã tải"))}</span>
                  <span class="rowacts">
                    ${s.status === "part" && s.viewerUrl ? `
                      <button class="soft-button" type="button" data-action="resume-study-download" data-url="${escapeHtml(s.viewerUrl)}">
                        ${escapeHtml(t("Tải tiếp"))}
                      </button>
                    ` : ""}
                    <button class="soft-button primary" type="button" data-action="open-study-viewer" data-folder="${escapeHtml(s.folder || "")}" ${s.status === "miss" ? "disabled" : ""}>
                      ${escapeHtml(t("Mở viewer"))}
                    </button>
                    <button class="soft-button" type="button" data-action="reveal-study-folder" data-folder="${escapeHtml(s.folder || "")}" ${s.status === "miss" ? "disabled" : ""}>
                      ${escapeHtml(t("Thư mục"))}
                    </button>
                  </span>
                </div>
              `).join("")}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

/** Attach tree accordion and button listeners to worklist markup. */
function bindWorklistOpenButtons(host) {
  if (!host) return;

  host.querySelectorAll("[data-toggle-patient]").forEach((prow) => {
    prow.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const pid = prow.dataset.togglePatient;
      state.expandedPatients = state.expandedPatients || {};
      state.expandedPatients[pid] = !(state.expandedPatients[pid] !== false);
      const studies = host.querySelector(`[data-studies='${pid}']`);
      if (studies) {
        studies.classList.toggle("on", state.expandedPatients[pid]);
        prow.setAttribute("aria-expanded", String(state.expandedPatients[pid]));
      }
    });
  });

  host.querySelectorAll("[data-action='open-study-viewer']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const folder = btn.dataset.folder;
      if (folder) openHistoryEntry({ folder });
    });
  });

  host.querySelectorAll("[data-action='open-patient-record']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = btn.dataset.patientId;
      const patient = getEffectiveWorklistPatients().find((p) => p.id === pid);
      if (!patient) return;
      // "Mở hồ sơ" means the whole record. Opening `studies[0].folder` gave
      // one study — and, with the rows sorted wrong, often not even the newest
      // one — leaving the timeline showing a single visit out of four.
      const folder = patient.folder || patient.studies?.[0]?.folder;
      if (folder) openHistoryEntry({ folder });
    });
  });

  host.querySelectorAll("[data-action='reveal-study-folder']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const folder = btn.dataset.folder;
      if (folder) {
        try {
          await api("/api/worklist/reveal-folder", {
            method: "POST",
            body: JSON.stringify({ folder }),
          });
        } catch (err) {
          log(t("Không thể mở thư mục: ") + err.message);
        }
      }
    });
  });

  host.querySelectorAll("[data-action='open-worklist-item']").forEach((button) => {
    button.addEventListener("click", () => {
      const folder = button.dataset.folder;
      if (folder) openHistoryEntry({ folder });
    });
  });

  host.querySelectorAll("[data-action='resume-study-download']").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      resumeStudyDownload(button.dataset.url || "");
    });
  });
}

/**
 * Load a half-finished study's viewer link back into the download panel.
 *
 * The manifest kept the link the first run came from, and the download panel
 * already knows how to resume: "Thử lại" merges into the folder that run
 * created and skips slices on disk. So this hands the link to that flow rather
 * than opening a second, parallel download path.
 */
function resumeStudyDownload(url) {
  if (!url) {
    setStatus(t("Ca chụp này không lưu link viewer để tải tiếp."), true);
    return;
  }
  state.lastDirectUrl = url;
  state.showManualInfo = true;
  state.downloadOpen = true;
  render();
  const field = getDomRoot()?.querySelector("#direct-url");
  if (field) {
    field.value = url;
    field.focus();
  }
  setStatus(t("Đã nạp link của ca chụp. Quét series rồi bấm Thử lại để tải tiếp."));
}

/** Human-readable byte size, matching what the backend formats per patient. */
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, power);
  return `${scaled.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

/**
 * Inner HTML of the summary strip above the tree.
 *
 * Every tile is a sum over the rows actually on screen — nothing here is a
 * target, an estimate or a carried-over mockup number. A tile whose input was
 * never measured (video length on folders the pipeline did not download) is
 * dropped rather than shown as zero.
 */
function renderWorklistSummaryInner() {
  const patients = filteredPatientList();
  const studies = patients.flatMap((p) => p.studies || []);
  const sliceTotal = studies.reduce(
    (sum, s) => sum + (Number.isFinite(s.sliceCount) ? s.sliceCount : 0), 0,
  );
  const sizeTotal = patients.reduce((sum, p) => sum + (Number(p.totalSizeBytes) || 0), 0);
  const durationTotal = studies.reduce(
    (sum, s) => sum + (Number.isFinite(s.durationSeconds) ? s.durationSeconds : 0), 0,
  );
  const needsAttention = studies.filter((s) => s.status === "part" || s.status === "miss").length;

  const tiles = [
    { value: patients.length, label: t("bệnh nhân") },
    { value: studies.length, label: t("hồ sơ") },
    { value: sliceTotal.toLocaleString("vi-VN"), label: t("ảnh & lát") },
  ];
  if (durationTotal > 0) {
    const minutes = String(Math.floor(durationTotal / 60)).padStart(2, "0");
    const seconds = String(Math.round(durationTotal % 60)).padStart(2, "0");
    tiles.push({ value: `${minutes}:${seconds}`, label: t("phút video") });
  }
  if (sizeTotal > 0) tiles.push({ value: formatBytes(sizeTotal), label: t("trên đĩa") });
  if (needsAttention > 0) {
    tiles.push({ value: needsAttention, label: t("cần xử lý"), alert: true });
  }

  return tiles.map((tile) => `
    <div class="activity-stat${tile.alert ? " alert" : ""}">
      <b>${escapeHtml(String(tile.value))}</b>
      <small>${escapeHtml(tile.label)}</small>
    </div>
  `).join("");
}

function renderStudyListPanel() {
  return `
    <div class="worklist-filter-bar filters">
      <input type="search" data-field="worklist-search" placeholder="${escapeHtml(t("Tìm theo tên hoặc mã bệnh nhân, đợt khám…"))}" value="${escapeHtml(state.worklistSearch || "")}">
    </div>

    <div class="worklist-summary activity-summary">${renderWorklistSummaryInner()}</div>

    <div class="worklist-tree">${renderWorklistTreeInner()}</div>
  `;
}

/** Job kinds carry internal names; the queue shows what the doctor started. */
const JOB_KIND_LABELS = {
  "download": "Tải ca theo mã bệnh nhân",
  "direct-download": "Tải theo link viewer",
  "local-import": "Nhập thư mục từ đĩa",
  "archive": "Quét lại kho",
  "search": "Tìm ca chụp",
  "series-discovery": "Dò danh sách series",
};

/**
 * Inner HTML of the Activity & Queue panel.
 *
 * Split out from `renderWorklistView` because `pollJob` refreshes this alone
 * every second: a full `render()` would rebuild `#app` and tear the viewer
 * canvas down with it.
 */
function renderActivityPanelInner() {
  const job = state.job || state.bootstrap?.job || {};
  const running = job.status === "running";
  const series = state.archive?.series || [];
  const sliceTotal = series.reduce((sum, item) => sum + (Number(item.sliceCount) || 0), 0);
  const history = state.history || [];

  const stats = [
    { value: history.length, label: t("Hồ sơ gần đây") },
    { value: state.tabs.length, label: t("Tab đang mở") },
    { value: series.length, label: t("Series trong kho") },
    { value: sliceTotal.toLocaleString("vi-VN"), label: t("Ảnh & lát cắt") },
  ];

  return `
    <div class="activity-summary">
      ${stats.map((item) => `
        <div class="activity-stat">
          <b>${escapeHtml(String(item.value))}</b>
          <small>${escapeHtml(item.label)}</small>
        </div>
      `).join("")}
    </div>

    <div class="activity-head">${escapeHtml(t("Đang xử lý"))}</div>
    ${running ? `
      <div class="activity-job">
        <b>${escapeHtml(t(JOB_KIND_LABELS[job.kind] || "Tác vụ nền"))}</b>
        <button class="soft-button danger" data-action="stop-job">${escapeHtml(t("Dừng"))}</button>
        <div class="activity-bar indeterminate"><i></i></div>
        <small class="activity-job-msg">${escapeHtml(translateLog(job.message || "") || t("Đang chạy..."))}</small>
      </div>
    ` : `
      <div class="activity-idle">${escapeHtml(t("Không có tác vụ nào đang chạy."))}</div>
    `}

    <div class="activity-head">${escapeHtml(t("Gần đây"))}</div>
    <div class="activity-history">
      ${history.length === 0 ? `
        <div class="activity-idle">${escapeHtml(t("Chưa có thư mục nào được mở hoặc tải."))}</div>
      ` : history.map((entry) => `
        <div class="activity-hrow">
          <span class="activity-time">${escapeHtml(entry.time || "")}</span>
          <span class="activity-path" title="${escapeHtml(entry.folder || "")}">${escapeHtml(entry.folder || "")}</span>
          <span class="activity-acts">
            <button class="soft-button" data-action="open-worklist-item" data-folder="${escapeHtml(entry.folder || "")}">${escapeHtml(t("Mở"))}</button>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

/** Repaint only the Activity panel, leaving the rest of the shell untouched. */
function refreshActivityPanel() {
  if (state.activeTabId !== "worklist" || state.worklistTab !== "activity") return;
  const host = getDomRoot()?.querySelector("#activity-panel");
  if (!host) return;
  host.innerHTML = renderActivityPanelInner();
  // innerHTML drops the old listeners with the old nodes, so the buttons this
  // panel owns have to be wired again on every repaint.
  bindWorklistOpenButtons(host);
  host.querySelector("[data-action='stop-job']")
    ?.addEventListener("click", () => action("stop-job"));
}

function renderWorklistView() {
  const tab = state.worklistTab === "activity" ? "activity" : "studies";
  const job = state.job || state.bootstrap?.job || {};
  const activityCount = job.status === "running" ? 1 : 0;

  return `
    <main class="worklist-view">
      <div class="worklist-header">
        <div class="worklist-title-group">
          <h2>${escapeHtml(t("Worklist & Danh Sách Ca Chụp"))}</h2>
        </div>
      </div>

      <div class="worklist-tabs" role="tablist">
        <button class="worklist-tab${tab === "studies" ? " active" : ""}" role="tab"
          aria-selected="${tab === "studies"}"
          data-action="worklist-tab" data-worklist-tab="studies">
          ${escapeHtml(t("Study List"))}
          <span class="worklist-tab-count">${filteredPatientList().length}</span>
        </button>
        <button class="worklist-tab${tab === "activity" ? " active" : ""}" role="tab"
          aria-selected="${tab === "activity"}"
          data-action="worklist-tab" data-worklist-tab="activity">
          ${escapeHtml(t("Activity & Queue"))}
          ${activityCount ? `<span class="worklist-tab-count running">${activityCount}</span>` : ""}
        </button>
      </div>

      ${tab === "studies"
      ? renderStudyListPanel()
      : `<div id="activity-panel" class="activity-panel">${renderActivityPanelInner()}</div>`}
    </main>
  `;
}

function render() {
  const series = selectedSeries();
  // Switching from a CT to an MR series strands any Hounsfield preset, which
  // that series cannot honour. Fall back before the select is drawn so the
  // control never shows a preset that is not in force.
  if (!availableWindowPresets(series).some((item) => item.id === state.windowPreset)) {
    state.windowPreset = defaultWindowPreset(series);
  }
  // Window/level, MPR, mm measurement and the grey-scale safety banner all
  // describe a diagnostic image. On a video, a photo or an operative report
  // they measure nothing, and a banner saying "do not quantify grey levels"
  // over a JSON file is noise the reader has to learn to ignore.
  const isDiagnosticSeries = getSeriesMediaType(series) === "dicom";
  const safety = isDiagnosticSeries ? seriesSafetyNotice(series) : null;
  const mprDisabled = !series?.mprReady;
  if (!app && typeof document !== "undefined") app = document.querySelector("#app");
  if (!app) return;
  app.innerHTML = `
    <div class="app-shell ${downloadPanelVisible() ? "" : "download-collapsed"}">
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
          ${state.activeTabId === "worklist" ? iconButton(
      "toggle-download",
      state.downloadOpen ? "⇤" : "⇥",
      t(state.downloadOpen ? "Thu gọn khu tải phim" : "Mở khu tải phim"),
      state.downloadOpen,
      false,
      t("Tải phim"),
    ) : ""}
          ${iconButton("choose-archive", icons.folder, t("Mở folder hồ sơ: phim, ảnh, video và văn bản đều được nhận diện"))}
          ${iconButton("refresh-archive", "⟳", t("Quét lại thư mục hiện tại"), false, !state.archive.root)}
          <button class="soft-button" data-action="toggle-language"
            title="${escapeHtml(t("Chuyển sang tiếng Anh"))}">${getLanguage() === "en" ? "VI" : "EN"}</button>
        </div>
      </header>

      ${renderWinbar()}

      ${downloadPanelVisible() ? `
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
      ` : ""}

      ${state.activeTabId === "worklist" ? renderWorklistView() : `
      <main class="viewer-main">
        ${renderPatientRail()}
        ${isDiagnosticSeries ? `
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
          ${state.mode !== "volume3d" ? `<div class="window-preset-control">
            <select data-field="window-preset" aria-label="${escapeHtml(t("Cài đặt hiển thị"))}" title="${escapeHtml(t(windowPresetHint(series)))}">
              ${availableWindowPresets(series).map((preset) => `<option value="${preset.id}" ${state.windowPreset === preset.id ? "selected" : ""}>${escapeHtml(preset.detail ? `${t(preset.label)} · ${preset.detail}` : t(preset.label))}</option>`).join("")}
            </select>
          </div>` : ""}
          <span class="toolbar-divider"></span>
          ${renderToolbarGroups(series)}
        </nav>
        ` : ""}

        <div class="series-strip">
          ${renderSeriesStripContent(state.archive.series)}
        </div>

        <div class="safety-notice ${safety?.level || ""}" ${safety ? "" : "hidden"}>
          <b>${escapeHtml(t("An toàn hiển thị"))}</b><span>${escapeHtml(safety ? t(safety.text) : "")}</span>
        </div>
        <section id="workspace" class="workspace-grid ${getSeriesMediaType(series) !== "dicom" ? "media-mode" : ""}">
          ${renderWorkspacePane(series)}
        </section>
        <footer class="status-bar ${state.isError ? "error" : ""}">
          <span class="status-dot ${state.busyViewer ? "busy" : ""}"></span>
          <span class="status-text">${escapeHtml(state.status || "")}</span>
          <span class="status-root" title="${escapeHtml(state.archive.root || "")}">${escapeHtml(state.archive.root || "")}</span>
        </footer>
      </main>
      `}
      ${renderLoginCard()}
      ${renderFileInfoModal()}
      ${renderConcatModal()}
    </div>
  `;
  bindEvents();
  hydrateSeriesThumbs();
  initMediaEvents();
}

function renderLoginCard() {
  if (!state.showLoginCard) return "";
  return `
    <div class="modal-overlay">
      <div class="login-card">
        <h3>${escapeHtml(t("Đăng nhập RIS thất bại"))}</h3>
        <p>${escapeHtml(t("Vui lòng nhập tài khoản RIS dự phòng:"))}</p>
        <label class="field">${escapeHtml(t("Tài khoản"))}
          <input id="custom-ris-user" type="text" autocomplete="off" autofocus>
        </label>
        <label class="field">${escapeHtml(t("Mật khẩu"))}
          <input id="custom-ris-pass" type="password">
        </label>
        <div class="login-card-actions">
          <button data-action="cancel-login">${escapeHtml(t("Huỷ"))}</button>
          <button class="primary" data-action="retry-login">${escapeHtml(t("Đăng nhập & Thử lại"))}</button>
        </div>
      </div>
    </div>
  `;
}

function visibleDicomTags() {
  const tags = state.fileInfoData?.dicomTags || [];
  const query = (state.fileInfoTagFilter || "").toLowerCase().trim();
  if (!query) return tags;
  return tags.filter((tag) =>
    (tag.tag || "").toLowerCase().includes(query) ||
    (tag.name || "").toLowerCase().includes(query) ||
    (tag.value || "").toLowerCase().includes(query));
}

function renderDicomTagRows(tags) {
  if (!tags.length) {
    return `<tr><td colspan="4" class="dicom-tags-empty">${escapeHtml(t("Không tìm thấy thẻ phù hợp"))}</td></tr>`;
  }
  return tags.map((tag) => `
    <tr>
      <td class="dicom-tag-col-tag">${escapeHtml(tag.tag)}</td>
      <td class="dicom-tag-col-vr">${escapeHtml(tag.vr)}</td>
      <td class="dicom-tag-col-name">${escapeHtml(tag.name)}</td>
      <td class="dicom-tag-col-val">${escapeHtml(tag.value)}</td>
    </tr>
  `).join("");
}

function renderFileInfoModal() {
  if (!state.showFileInfoModal) return "";
  const data = state.fileInfoData;
  const isLoading = state.fileInfoLoading;
  const error = state.fileInfoError;

  if (isLoading) {
    return `
      <div class="file-info-overlay">
        <div class="file-info-dialog">
          <header class="file-info-header">
            <div class="file-info-title-wrap">
              <h3 class="file-info-title">ℹ ${escapeHtml(t("Chi tiết file & Thẻ DICOM"))}</h3>
            </div>
            <button class="file-info-close-btn" data-action="close-file-info">✕</button>
          </header>
          <div class="file-info-body">
            <div class="viewer-loading">${escapeHtml(t("Đang đọc thông tin file..."))}</div>
          </div>
        </div>
      </div>
    `;
  }

  if (error) {
    return `
      <div class="file-info-overlay">
        <div class="file-info-dialog">
          <header class="file-info-header">
            <div class="file-info-title-wrap">
              <h3 class="file-info-title">ℹ ${escapeHtml(t("Chi tiết file & Thẻ DICOM"))}</h3>
            </div>
            <button class="file-info-close-btn" data-action="close-file-info">✕</button>
          </header>
          <div class="file-info-body">
            <div class="safety-notice high">
              <b>${escapeHtml(t("Lỗi"))}</b>
              <span>${escapeHtml(error)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (!data) return "";

  const file = data.file || {};
  const prov = data.provenance || {};
  const demo = data.demographics || {};
  const study = data.study || {};
  const series = data.series || {};

  const filteredTags = visibleDicomTags();

  const downloadUrl = prov.downloadUrl || prov.viewerUrl || "";

  return `
    <div class="file-info-overlay">
      <div class="file-info-dialog">
        <header class="file-info-header">
          <div class="file-info-title-wrap">
            <h3 class="file-info-title">ℹ ${escapeHtml(t("Chi tiết file & Thẻ DICOM"))}</h3>
            <span class="file-info-subtitle">${escapeHtml(file.fileName || series.seriesDescription || "")} (${escapeHtml(file.sliceIndexDisplay || "1/1")})</span>
          </div>
          <button class="file-info-close-btn" data-action="close-file-info" title="${escapeHtml(t("Đóng"))}">✕</button>
        </header>

        <div class="file-info-body">
          <!-- Provenance / Download Link Card -->
          <div class="provenance-card">
            <div class="provenance-card-title">
              <span>🌐</span> ${escapeHtml(t("Nguồn gốc & Link tải"))}
            </div>
            ${downloadUrl ? `
              <div class="provenance-link-row">
                <span class="provenance-url-text" title="${escapeHtml(downloadUrl)}">${escapeHtml(downloadUrl)}</span>
                <button class="provenance-action-btn" data-action="copy-download-url" data-url="${escapeHtml(downloadUrl)}">
                  ${icons.copy} ${escapeHtml(t("Sao chép link"))}
                </button>
                <button class="provenance-action-btn secondary" data-action="open-download-url" data-url="${escapeHtml(downloadUrl)}">
                  ${icons.externalLink} ${escapeHtml(t("Mở liên kết"))}
                </button>
              </div>
            ` : `
              <span class="muted">${escapeHtml(t("Chưa có thông tin link tải cho file này."))}</span>
            `}
            <div class="provenance-badges-grid">
              ${prov.patientCode ? `
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${escapeHtml(t("Mã bệnh nhân"))}</span>
                  <span class="provenance-badge-value">${escapeHtml(prov.patientCode)}</span>
                </div>
              ` : ""}
              ${prov.accessionNumber ? `
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${escapeHtml(t("Mã ca chụp (Accession No)"))}</span>
                  <span class="provenance-badge-value">${escapeHtml(prov.accessionNumber)}</span>
                </div>
              ` : ""}
              ${prov.hospitalName ? `
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${escapeHtml(t("Bệnh viện / Cơ sở"))}</span>
                  <span class="provenance-badge-value">${escapeHtml(prov.hospitalName)}</span>
                </div>
              ` : ""}
              ${study.studyDate ? `
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${escapeHtml(t("Ngày chụp"))}</span>
                  <span class="provenance-badge-value">${escapeHtml(formatDisplayDate(study.studyDate))}</span>
                </div>
              ` : ""}
            </div>
          </div>

          <!-- Demographics & Study Info -->
          <div class="info-section">
            <h4 class="info-section-title">${escapeHtml(t("Thông tin ca chụp"))}</h4>
            <div class="info-grid">
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Tên bệnh nhân"))}</span>
                <span class="info-cell-value">${escapeHtml(demo.patientName || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Mã BN (ID)"))}</span>
                <span class="info-cell-value">${escapeHtml(demo.patientId || prov.patientCode || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Năm sinh / Ngày sinh"))}</span>
                <span class="info-cell-value">${escapeHtml(demo.patientBirthDate ? formatDisplayDate(demo.patientBirthDate) : "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Giới tính"))}</span>
                <span class="info-cell-value">${escapeHtml(demo.patientSex || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Modality"))}</span>
                <span class="info-cell-value">${escapeHtml(study.modality || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Mô tả ca"))}</span>
                <span class="info-cell-value">${escapeHtml(study.studyDescription || "—")}</span>
              </div>
            </div>
          </div>

          <!-- File & Image Parameters -->
          <div class="info-section">
            <h4 class="info-section-title">${escapeHtml(t("Thông số ảnh"))}</h4>
            <div class="info-grid">
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Đường dẫn file"))}</span>
                <span class="info-cell-value" title="${escapeHtml(file.filePath || "")}">${escapeHtml(file.filePath || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Kích thước file"))}</span>
                <span class="info-cell-value">${escapeHtml(file.fileSizeFormatted || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Lát cắt hiện tại"))}</span>
                <span class="info-cell-value">${escapeHtml(file.sliceIndexDisplay || "—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Độ phân giải"))}</span>
                <span class="info-cell-value">${series.columns && series.rows ? `${series.columns} × ${series.rows}` : "—"}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Pixel Spacing"))}</span>
                <span class="info-cell-value">${Array.isArray(series.pixelSpacing) ? series.pixelSpacing.map((v) => Number(v).toFixed(3)).join(" × ") + " mm" : "—"}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${escapeHtml(t("Khoảng cách lát cắt"))}</span>
                <span class="info-cell-value">${series.sliceSpacing ? `${Number(series.sliceSpacing).toFixed(2)} mm` : "—"}</span>
              </div>
            </div>
          </div>

          <!-- DICOM Header Tags Table -->
          <div class="info-section">
            <h4 class="info-section-title">${escapeHtml(t("Bảng thẻ DICOM Header"))} (<span data-field="dicom-tag-count">${filteredTags.length}</span>)</h4>
            <div class="dicom-tags-container">
              <div class="dicom-tag-filter-row">
                <input class="dicom-tag-search-input" id="dicom-tag-filter" type="text"
                  placeholder="${escapeHtml(t("Tìm kiếm thẻ (Tag, Tên, Giá trị)..."))}"
                  value="${escapeHtml(state.fileInfoTagFilter || "")}">
              </div>
              <div class="dicom-tags-table-wrap">
                <table class="dicom-tags-table">
                  <thead>
                    <tr>
                      <th style="width: 110px;">${escapeHtml(t("Tag"))}</th>
                      <th style="width: 50px;">${escapeHtml(t("VR"))}</th>
                      <th style="width: 220px;">${escapeHtml(t("Tên thẻ"))}</th>
                      <th>${escapeHtml(t("Giá trị"))}</th>
                    </tr>
                  </thead>
                  <tbody>${renderDicomTagRows(filteredTags)}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderConcatModal() {
  if (!state.showConcatModal) return "";
  const clips = state.concatClips || [];
  const selectedCount = clips.filter((c) => c.selected).length;
  return `
    <div class="modal-overlay concat-modal-overlay">
      <div class="concat-modal-card">
        <div class="concat-modal-header">
          <h3>🔗 ${escapeHtml(t("Ghép & Sắp xếp thứ tự clip phẫu thuật"))}</h3>
          <button class="icon-button" data-action="close-concat-modal" title="${escapeHtml(t("Đóng"))}">✕</button>
        </div>
        <p style="margin:0; font-size:12px; color:var(--label-muted,#7890a2);">${escapeHtml(t("Chọn các clip và sử dụng nút ▲/▼ để sắp xếp thứ tự ghép nối theo trình tự phẫu thuật:"))}</p>
        <div class="concat-clip-list">
          ${clips.length === 0 ? `<div class="empty-state" style="padding:20px;"><b>${escapeHtml(t("Không tìm thấy clip video nào trong ca mổ"))}</b></div>` : clips.map((clip, idx) => `
            <div class="concat-clip-item ${clip.selected ? "" : "disabled"}" data-clip-id="${escapeHtml(`${clip.seriesId}:${clip.index ?? 0}`)}">
              <input type="checkbox" class="concat-clip-checkbox" data-action="toggle-concat-clip" data-clip-idx="${idx}" ${clip.selected ? "checked" : ""} style="cursor:pointer;" title="${escapeHtml(t("Bật/tắt clip này"))}">
              <span class="concat-clip-order">#${idx + 1}</span>
              <div class="concat-clip-info">
                <div class="concat-clip-title">${escapeHtml(clip.name)}</div>
                <div class="concat-clip-meta">⏱ ${clip.duration ? formatVideoTime(clip.duration) : t("Không rõ thời lượng")}</div>
              </div>
              <div class="concat-clip-reorder">
                <button class="concat-reorder-btn" data-action="move-concat-clip-up" data-clip-idx="${idx}" ${idx === 0 ? "disabled" : ""} title="${escapeHtml(t("Di chuyển lên trước"))}">▲</button>
                <button class="concat-reorder-btn" data-action="move-concat-clip-down" data-clip-idx="${idx}" ${idx === clips.length - 1 ? "disabled" : ""} title="${escapeHtml(t("Di chuyển xuống sau"))}">▼</button>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="concat-settings">
          <label>
            <span>${escapeHtml(t("Độ phân giải:"))}</span>
            <select id="concat-resolution-select" data-field="concat-resolution">
              <option value="1080" ${state.concatTargetHeight === 1080 ? "selected" : ""}>1080p (Full HD)</option>
              <option value="720" ${state.concatTargetHeight === 720 ? "selected" : ""}>720p (HD)</option>
              <option value="480" ${state.concatTargetHeight === 480 ? "selected" : ""}>480p (SD)</option>
            </select>
          </label>
          <label>
            <span>${escapeHtml(t("Tốc độ khung hình:"))}</span>
            <select id="concat-fps-select" data-field="concat-fps">
              <option value="30" ${state.concatTargetFps === 30 ? "selected" : ""}>30 fps (${escapeHtml(t("Tiêu chuẩn"))})</option>
              <option value="60" ${state.concatTargetFps === 60 ? "selected" : ""}>60 fps (${escapeHtml(t("Mượt"))})</option>
            </select>
          </label>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
          <button class="control-btn" data-action="close-concat-modal">${escapeHtml(t("Hủy"))}</button>
          <button class="control-btn primary" data-action="start-concat-video" ${selectedCount < 2 ? "disabled" : ""}>
            🔗 ${escapeHtml(tf("Bắt đầu ghép ({} clip)", selectedCount))}
          </button>
        </div>
      </div>
    </div>
  `;
}

function showCopyToast(message = t("Đã sao chép link tải vào clipboard!")) {
  const existing = document.querySelector(".copy-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2500);
}

async function copyTextToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showCopyToast();
  } catch (_) {
    showCopyToast(t("Không thể sao chép liên kết"));
  }
}

async function openFileInfoModal() {
  if (!state.selectedId) return;
  state.showFileInfoModal = true;
  state.fileInfoLoading = true;
  state.fileInfoError = "";
  state.fileInfoTagFilter = "";
  render();
  try {
    const sliceIndex = getActiveSliceIndex();
    const data = await api(`/api/series/${state.selectedId}/file-info?index=${sliceIndex}`);
    state.fileInfoData = data;
    state.fileInfoLoading = false;
  } catch (err) {
    state.fileInfoLoading = false;
    state.fileInfoError = err.message || t("Không tải được thông tin file");
  }
  render();
}

function closeFileInfoModal() {
  state.showFileInfoModal = false;
  state.fileInfoData = null;
  state.fileInfoError = "";
  render();
}

/**
 * Fetch one text/JSON file of a series and paint it into the reading pane.
 *
 * Kept out of `renderViewer` so moving between files repaints the pane alone,
 * the same way the activity panel refreshes without rebuilding the shell.
 */
async function loadTextContent(series, index = 0) {
  if (!series) return;
  try {
    const doc = await api(`/api/series/${series.id}/text?index=${Number(index) || 0}`);
    state.textDoc = { seriesId: series.id, ...doc };
  } catch (error) {
    state.textDoc = {
      seriesId: series.id,
      index: Number(index) || 0,
      name: series.name || "",
      language: "text",
      text: humanError(error),
    };
  }
  const pane = getDomRoot()?.querySelector(".text-viewer");
  if (!pane) return;
  pane.outerHTML = renderTextViewer(series);
  bindTextViewerButtons(getDomRoot());
  setStatus(t("Sẵn sàng."));
}

/** Wire the reading pane's file navigation; repaints replace these nodes. */
function bindTextViewerButtons(host) {
  if (!host) return;
  const series = selectedSeries();
  if (!series) return;
  const total = Number(series.sliceCount) || 1;
  const index = currentTextDoc(series)?.index || 0;

  host.querySelector("[data-action='text-prev']")?.addEventListener("click", () => {
    if (index > 0) loadTextContent(series, index - 1);
  });
  host.querySelector("[data-action='text-next']")?.addEventListener("click", () => {
    if (index < total - 1) loadTextContent(series, index + 1);
  });
  host.querySelector("[data-action='text-copy']")?.addEventListener("click", () => {
    if (state.textDoc?.text) copyTextToClipboard(state.textDoc.text);
  });
}

// The thumbnail endpoint sits behind the same bearer token as every other
// /api route, and an <img src> cannot carry the X-DCom-Token header. Each
// thumbnail is fetched once as a blob and kept as an object URL so the
// frequent full re-renders reuse it instead of decoding the slice again.
const seriesThumbs = new Map();

function seriesThumbUrl(seriesId) {
  let pending = seriesThumbs.get(seriesId);
  if (!pending) {
    pending = apiBlob(thumbnailPath(seriesId)).then((blob) => URL.createObjectURL(blob));
    // Drop failures so a later render can retry instead of caching the error.
    pending.catch(() => seriesThumbs.delete(seriesId));
    seriesThumbs.set(seriesId, pending);
  }
  return pending;
}

function hydrateSeriesThumbs() {
  const live = new Set(state.archive.series.map((item) => item.id));
  for (const [seriesId, pending] of seriesThumbs) {
    if (live.has(seriesId)) continue;
    seriesThumbs.delete(seriesId);
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  for (const img of app.querySelectorAll(".series-card-thumb[data-thumb-id]")) {
    const seriesId = img.dataset.thumbId;
    seriesThumbUrl(seriesId)
      .then((url) => {
        img.src = url;
      })
      .catch(() => {
        img.remove();
      });
  }
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

// Re-ticking "Bổ sung thông tin bệnh nhân" when a viewer link is pasted is
// DESIRED behaviour, not a bug: the form has to be ready to capture or correct
// the patient details that come back with the link.
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
  if (!app && typeof document !== "undefined") app = document.querySelector("#app");
  if (!app) return;
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => action(element.dataset.action, element));
  });
  // Backdrop click closes the dialog; a click that lands inside it must not,
  // so the overlay checks the target rather than having the dialog swallow the
  // event on its way up.
  const fileInfoOverlay = app.querySelector(".file-info-overlay");
  fileInfoOverlay?.addEventListener("click", (event) => {
    if (event.target === fileInfoOverlay) closeFileInfoModal();
  });

  const concatOverlay = app.querySelector(".concat-modal-overlay");
  concatOverlay?.addEventListener("click", (event) => {
    if (event.target === concatOverlay) {
      state.showConcatModal = false;
      render();
    }
  });
  app.querySelector("[data-field='concat-resolution']")?.addEventListener("change", (event) => {
    state.concatTargetHeight = Number(event.target.value) || 1080;
  });
  app.querySelector("[data-field='concat-fps']")?.addEventListener("change", (event) => {
    state.concatTargetFps = Number(event.target.value) || 30;
  });
  // Only the tag rows depend on the filter, so they are swapped in place.
  // Re-rendering the dialog here would mean calling bindEvents() again, which
  // adds a second click listener to every [data-action] in the app — one more
  // per keystroke, so a later click on a header button would fire many times.
  app.querySelector("#dicom-tag-filter")?.addEventListener("input", (event) => {
    state.fileInfoTagFilter = event.target.value;
    const tags = visibleDicomTags();
    const body = app.querySelector(".dicom-tags-table tbody");
    if (body) body.innerHTML = renderDicomTagRows(tags);
    const counter = app.querySelector("[data-field='dicom-tag-count']");
    if (counter) counter.textContent = String(tags.length);
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
  app.querySelectorAll(".winbar-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", (event) => {
      if (event.target.closest(".winbar-tab-close")) return;
      const tabId = tabEl.dataset.tabId;
      if (tabId) switchTab(tabId);
    });
  });
  app.querySelectorAll(".winbar-tab-close").forEach((closeBtn) => {
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const tabId = closeBtn.dataset.tabId;
      if (tabId) closeTab(tabId);
    });
  });
  bindWorklistOpenButtons(app);
  bindTextViewerButtons(app);
  app.querySelector("[data-field='worklist-search']")?.addEventListener("input", (event) => {
    state.worklistSearch = event.target.value;
    // Tree, summary tiles and tab count all read the filtered list, so they
    // are repainted together rather than drifting apart.
    refreshStudyListPanel();
  });
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
  app.querySelectorAll(".tl-name-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.closest(".tl-item")?.querySelector("[data-action='save-timeline-label']")?.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.closest(".tl-item")?.querySelector("[data-action='cancel-timeline-label']")?.click();
      }
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

/** Whether two archive paths name the same folder, ignoring case and slashes. */
function sameFolder(left, right) {
  const clean = (value) => String(value || "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  const a = clean(left);
  return Boolean(a) && a === clean(right);
}

/**
 * Open a record in its own viewer tab, backed by its own catalog.
 *
 * Each patient gets a backend session so tabs stop sharing one archive. The
 * shared catalog is what made a second tab report "Không tìm thấy series" for
 * the first patient's slices, and it is why every write had to guess which
 * record it belonged to.
 */
async function openHistoryEntry(entry) {
  try {
    const folder = entry.folder || "";
    // One tab per record: reopening one already on screen focuses it instead
    // of stacking a duplicate tab on the same folder.
    const existing = state.tabs.find((tab) => sameFolder(tab.folder, folder));
    if (existing) {
      await switchTab(existing.id);
      return;
    }

    // Re-opening restores the link that filled the folder, so a retry after a
    // restart still knows which link to resume.
    state.lastDirectUrl = entry.url || "";
    const field = getDomRoot()?.querySelector("#direct-url");
    if (field) field.value = state.lastDirectUrl;
    syncManualInfoVisibility(state.lastDirectUrl);

    setStatus(t("Đang mở hồ sơ…"));
    const result = await api("/api/sessions/create", {
      method: "POST",
      body: JSON.stringify({ path: folder }),
    });
    setApiSession(result.sessionId || "");
    applyArchive(result.archive, result.sessionId || "", folder);
    refreshHistory();
    setStatus(t("Sẵn sàng."));
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

/**
 * Let the reader drag a rectangle on the photo.
 *
 * The tools used to act on made-up regions — crop took a fixed 5% off each
 * edge, redact always covered the top-left corner — so what a clinician got
 * had no relation to what they meant to hide or keep. The drag is recorded in
 * source-image pixels, because that is the coordinate space the photo engine
 * works in and the displayed image is scaled to fit.
 */
function initPhotoSelection() {
  const wrap = getDomRoot()?.querySelector("#photo-editor-canvas");
  const img = getDomRoot()?.querySelector("#photo-editor-img");
  const box = getDomRoot()?.querySelector("#photo-selection");
  if (!wrap || !img || !box) return;

  let origin = null;

  /** Displayed pixels -> source-image pixels. */
  const toSource = (rect) => {
    const bounds = img.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const scaleX = (img.naturalWidth || bounds.width) / bounds.width;
    const scaleY = (img.naturalHeight || bounds.height) / bounds.height;
    return {
      x: Math.max(0, Math.round(rect.left * scaleX)),
      y: Math.max(0, Math.round(rect.top * scaleY)),
      width: Math.max(1, Math.round(rect.width * scaleX)),
      height: Math.max(1, Math.round(rect.height * scaleY)),
    };
  };

  const paint = (rect) => {
    box.hidden = false;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  };

  const rectFrom = (event) => {
    const bounds = img.getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    const clampX = (value) => Math.min(Math.max(value, bounds.left), bounds.right);
    const clampY = (value) => Math.min(Math.max(value, bounds.top), bounds.bottom);
    const x1 = clampX(origin.x);
    const y1 = clampY(origin.y);
    const x2 = clampX(event.clientX);
    const y2 = clampY(event.clientY);
    return {
      left: Math.min(x1, x2) - wrapBox.left,
      top: Math.min(y1, y2) - wrapBox.top,
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      imageLeft: Math.min(x1, x2) - bounds.left,
      imageTop: Math.min(y1, y2) - bounds.top,
    };
  };

  img.addEventListener("mousedown", (event) => {
    event.preventDefault();
    origin = { x: event.clientX, y: event.clientY };
    state.photoSelection = null;
    box.hidden = true;
  });

  window.addEventListener("mousemove", (event) => {
    if (!origin) return;
    paint(rectFrom(event));
  });

  window.addEventListener("mouseup", (event) => {
    if (!origin) return;
    const rect = rectFrom(event);
    origin = null;
    // A click without a drag clears the selection instead of leaving a sliver.
    if (rect.width < 4 || rect.height < 4) {
      state.photoSelection = null;
      box.hidden = true;
      return;
    }
    state.photoSelection = toSource({
      left: rect.imageLeft, top: rect.imageTop, width: rect.width, height: rect.height,
    });
    setStatus(tf(
      "Đã chọn vùng {}×{} px. Chọn công cụ để áp dụng.",
      state.photoSelection.width, state.photoSelection.height,
    ));
  });
}

/**
 * The rectangle a photo tool should act on.
 *
 * Throws rather than falling back to a default region: a redact box that lands
 * somewhere the reader did not choose can leave the patient's name on screen
 * while looking like it worked.
 */
function requirePhotoSelection() {
  const rect = state.photoSelection;
  if (!rect || rect.width < 1 || rect.height < 1) {
    throw new Error(t("Hãy kéo chuột trên ảnh để chọn vùng trước."));
  }
  return rect;
}

function initMediaEvents() {
  hydrateMediaSources();
  initPhotoSelection();
  const video = app.querySelector("#surgery-video-player");
  if (video) {
    const timeDisplay = app.querySelector("#video-time-display");
    const scrubber = app.querySelector("#surgery-video-scrubber");
    const speedSelect = app.querySelector("#video-speed-select");

    video.ontimeupdate = () => {
      if (timeDisplay) {
        timeDisplay.textContent = `${formatVideoTime(video.currentTime)} / ${formatVideoTime(video.duration || 0)}`;
      }
      if (scrubber && video.duration) {
        scrubber.value = String((video.currentTime / video.duration) * 100);
      }
    };

    if (scrubber) {
      scrubber.oninput = () => {
        if (video.duration) {
          video.currentTime = (Number(scrubber.value) / 100) * video.duration;
        }
      };
    }

    if (speedSelect) {
      speedSelect.onchange = () => {
        video.playbackRate = Number(speedSelect.value) || 1.0;
      };
    }

    const metaBadge = (app || document).querySelector("#video-meta-badge");
    const series = selectedSeries();
    if (metaBadge && series && !series._videoInfoLoaded) {
      getVideoSourcePath(series).then((path) => {
        if (!path) return;
        return api("/api/media/video/info", {
          method: "POST",
          body: JSON.stringify({ path }),
        }).then((res) => {
          const info = res?.info;
          if (info) {
            series._videoInfoLoaded = true;
            const resText = info.width && info.height ? `${info.width}x${info.height}` : "";
            const fpsText = info.fps ? `${Math.round(info.fps)}fps` : "";
            const codecText = info.codec || "";
            const durText = info.durationSeconds ? formatVideoTime(info.durationSeconds) : "";
            const details = [resText, fpsText, codecText, durText].filter(Boolean).join(" · ");
            if (details) {
              metaBadge.textContent = `🎬 ${series.patientName || "Video Phẫu Thuật"} (${details})`;
            }
          }
        });
      }).catch(() => null);
    }
  }
}

/**
 * Every video file in the record, in the order it would be joined.
 *
 * Read off the files rather than the series so a folder holding three clips
 * of one operation offers three lines to order and tick.
 */
async function concatClipCandidates() {
  const candidates = [];
  for (const series of state.archive?.series || []) {
    if (getSeriesMediaType(series) !== "video") continue;
    const response = await api(`/api/series/${series.id}/file-paths`).catch(() => null);
    const paths = (response?.images || []).filter(Boolean);
    paths.forEach((path, index) => {
      candidates.push({
        seriesId: series.id,
        index,
        path,
        name: String(path).split(/[\\/]/).pop() || series.description || series.name,
        // Only a lone clip in a folder can be matched to the duration the
        // catalog reports; there is no per-file duration for the rest.
        duration: paths.length === 1 ? (series.durationSeconds || 0) : 0,
        selected: true,
      });
    });
  }
  return candidates;
}

async function getVideoSourcePath(series) {
  if (!series) return null;
  if (state.videoWorkingPath && (!state.selectedId || series.id === state.selectedId)) {
    return state.videoWorkingPath;
  }
  const filePathsRes = await api(`/api/series/${series.id}/file-paths`).catch(() => null);
  const paths = filePathsRes?.images || [];
  return paths[mediaFileIndex(series)] || paths[0] || null;
}

async function getPhotoSourcePath(series) {
  if (!series) return null;
  if (state.photoWorkingPath && (!state.selectedId || series.id === state.selectedId)) {
    return state.photoWorkingPath;
  }
  const filePathsRes = await api(`/api/series/${series.id}/file-paths`).catch(() => null);
  const paths = filePathsRes?.images || [];
  return paths[mediaFileIndex(series)] || paths[0] || null;
}

async function action(name, element = null) {
  try {
    if (name === "cancel-login") {
      state.showLoginCard = false;
      state.loginCardAction = null;
      render();
      return;
    }
    if (name === "retry-login") {
      const user = app.querySelector("#custom-ris-user")?.value.trim();
      const pass = app.querySelector("#custom-ris-pass")?.value;
      if (!user) throw new Error("Chưa nhập tài khoản dự phòng.");
      
      const retryAction = state.loginCardAction;
      state.showLoginCard = false;
      state.loginCardAction = null;
      render();
      
      // Inject the credentials into the global context for the next action
      // Or we can just modify the specific fetch calls to pull from these fields if they exist?
      // Since action() will just call api('/api/search', { body: JSON.stringify({...}) }),
      // we can inject credentials by temporarily storing them in state, and have downloadOptions() or the fetch payloads read them.
      // Wait, in my previous plan, I said I'll pass them in payload.
      // Let me just store them in state and read them in the corresponding handlers.
      state.customRisUser = user;
      state.customRisPass = pass;
      
      return action(retryAction);
    }
    
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
    if (name === "worklist-tab") {
      const next = element?.dataset?.worklistTab === "activity" ? "activity" : "studies";
      // Clicking the tab that is already open must not rebuild the shell: a
      // full render tears down and re-creates the viewer canvas below it.
      if (next === state.worklistTab) return;
      state.worklistTab = next;
      render();
      // Coming back to the Study List is the moment a stale count shows, so
      // the scan is re-run instead of trusting whatever was cached.
      if (next === "studies") refreshWorklist();
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
    if (name === "photo-save-edit") {
      const series = selectedSeries();
      if (!series) return;
      if (!state.photoWorkingPath) throw new Error(t("Chưa có chỉnh sửa nào để lưu."));
      const editedIndex = mediaFileIndex(series);
      const saved = await api("/api/media/save", {
        method: "POST",
        // Named after the page that was edited, not the folder's first file.
        body: JSON.stringify({
          path: state.photoWorkingPath,
          seriesId: series.id,
          mediaIndex: editedIndex,
        }),
      });
      // The archive now holds one more file, so the strip and the rail have to
      // be re-read or the saved edit stays invisible until the next restart.
      const archive = await api("/api/archive/open", {
        method: "POST",
        body: JSON.stringify({ path: state.archive.root }),
      }).catch(() => null);
      if (archive?.series) applyArchive(archive, getApiSession(), state.archive.root);
      const refreshed = selectedSeries();
      if (refreshed?.id === series.id) {
        const filePaths = await api(`/api/series/${series.id}/file-paths`).catch(() => null);
        const savedIndex = (filePaths?.images || []).findIndex((path) => sameFolder(path, saved.savedPath));
        if (savedIndex >= 0) {
          state.mediaIndex = { ...(state.mediaIndex || {}), [series.id]: savedIndex };
        }
        const history = editHistoryFor(series.id, editedIndex);
        history.steps = [];
        history.cursor = -1;
        state.photoWorkingPath = null;
        render();
        renderViewer();
      }
      setStatus(tf("Đã lưu vào hồ sơ: {}", saved.name));
      return;
    }
    if (name === "media-edit-undo" || name === "media-edit-redo") {
      stepMediaEdit(selectedSeries(), name === "media-edit-redo" ? 1 : -1);
      return;
    }
    if (name === "media-file-prev" || name === "media-file-next") {
      stepMediaFile(selectedSeries(), name === "media-file-next" ? 1 : -1);
      return;
    }
    if (name === "edit-diagnosis") {
      // Typed by the reader because nothing else in a local archive knows it:
      // no RIS, and StudyDescription is the exam type, not a finding.
      const current = state.archive?.patient?.diagnosis || "";
      const next = window.prompt(t("Chẩn đoán của hồ sơ này:"), current);
      if (next === null || next.trim() === current.trim()) return;
      const result = await api("/api/patient/diagnosis", {
        method: "POST",
        // Name the record this tab is showing. The backend refuses to write
        // when the folder belongs to a different patient, so a note cannot
        // land in the chart of whichever archive happened to be opened last.
        body: JSON.stringify({
          diagnosis: next,
          archiveRoot: state.archive?.root || "",
          patientId: state.archive?.patient?.patientId || "",
        }),
      });
      state.archive.patient = result.patient || state.archive.patient;
      render();
      setStatus(t("Đã lưu chẩn đoán vào hồ sơ bệnh nhân."));
      return;
    }
    if (name === "edit-timeline-label") {
      const row = element?.closest(".tl-item");
      const input = row?.querySelector(".tl-name-input");
      if (!row || !input) return;
      row.classList.add("editing");
      input.value = row.dataset.timelineLabel || row.dataset.defaultLabel || "";
      input.focus();
      input.select();
      return;
    }
    if (name === "cancel-timeline-label") {
      const row = element?.closest(".tl-item");
      const input = row?.querySelector(".tl-name-input");
      if (!row) return;
      if (input) input.value = row.dataset.timelineLabel || row.dataset.defaultLabel || "";
      row.classList.remove("editing");
      return;
    }
    if (name === "save-timeline-label") {
      const row = element?.closest(".tl-item");
      const input = row?.querySelector(".tl-name-input");
      const timelineKey = row?.dataset.timelineKey || "";
      if (!row || !input || !timelineKey) return;
      const next = input.value.trim();
      const current = row.dataset.timelineLabel || row.dataset.defaultLabel || "";
      if (next === current) {
        row.classList.remove("editing");
        return;
      }
      const result = await api("/api/patient/timeline-label", {
        method: "POST",
        body: JSON.stringify({
          timelineKey,
          label: next,
          archiveRoot: state.archive?.root || "",
          patientId: state.archive?.patient?.patientId || "",
        }),
      });
      state.archive.patient = result.patient || state.archive.patient;
      const display = result.label || row.dataset.defaultLabel || t("Chưa có mô tả");
      row.dataset.timelineLabel = display;
      row.querySelector(".nm").textContent = display;
      input.value = display;
      row.classList.remove("editing");
      setStatus(t("Đã lưu tên hiển thị trên timeline."));
      return;
    }
    if (name === "file-info") {
      await openFileInfoModal();
      return;
    }
    if (name === "close-file-info") {
      closeFileInfoModal();
      return;
    }
    if (name === "copy-download-url") {
      const url = element?.dataset?.url;
      if (url) await copyTextToClipboard(url);
      return;
    }
    if (name === "open-download-url") {
      const url = element?.dataset?.url;
      if (url) window.open(url, "_blank");
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
      await api("/api/search", { method: "POST", body: JSON.stringify({ 
        patientId, 
        hospital,
        customUsername: state.customRisUser,
        customPassword: state.customRisPass,
      }) });
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
          customUsername: state.customRisUser,
          customPassword: state.customRisPass,
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
      }
      setStatus(t(state.referenceCursor
        ? "Con trỏ tham chiếu đã bật."
        : "Con trỏ tham chiếu đã tắt."));
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

    // Cine has no toolbar button any more, so Space is its only control and
    // the status bar is the only place the user can see whether it is running.
    if (name === "cine") {
      state.cine = toggleCine(selectedSeries());
      setStatus(t(state.cine ? "Đang chạy phim — nhấn Space để dừng." : "Đã dừng chạy phim."));
      return;
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
    if (name === "video-play-pause") {
      const video = app.querySelector("#surgery-video-player");
      if (video) {
        if (video.paused) video.play();
        else video.pause();
      }
      return;
    }
    if (name === "video-rewind-5") {
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      if (video) video.currentTime = Math.max(0, video.currentTime - 5);
      return;
    }
    if (name === "video-forward-5") {
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      return;
    }
    if (name === "add-video-bookmark") {
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      const currentTime = video ? video.currentTime : 0;
      const note = prompt(t("Nhập ghi chú / mốc phẫu thuật:")) || t("Mốc phẫu thuật");
      if (!state.videoBookmarks) state.videoBookmarks = [];
      state.videoBookmarks.push({ time: currentTime, text: note });
      render();
      initMediaEvents();
      return;
    }
    if (name === "seek-video") {
      const time = Number(element?.dataset?.time || 0);
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      if (video) video.currentTime = time;
      return;
    }
    if (name === "video-snapshot") {
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      if (video) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const link = document.createElement("a");
        link.download = `snapshot_${Math.floor(video.currentTime)}s.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        setStatus(t("Đã lưu khung hình snapshot PNG."));
      }
      return;
    }
    if (name === "seek-filmstrip-idx") {
      const idx = Number(element?.dataset?.idx || 0);
      const total = Number(element?.dataset?.total || 1);
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      if (video && video.duration) {
        video.currentTime = (idx / total) * video.duration;
      }
      return;
    }
    if (name === "video-tool-trim") {
      const series = selectedSeries();
      if (!series) return;
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      const current = video ? video.currentTime : 0;
      const duration = video ? video.duration || 60 : 60;
      const startStr = prompt(t("Nhập thời gian bắt đầu (giây):"), Math.max(0, current - 5).toFixed(1));
      if (startStr === null) return;
      const endStr = prompt(t("Nhập thời gian kết thúc (giây):"), Math.min(duration, current + 5).toFixed(1));
      if (endStr === null) return;
      const startSeconds = parseFloat(startStr);
      const endSeconds = parseFloat(endStr);
      if (isNaN(startSeconds) || isNaN(endSeconds) || startSeconds >= endSeconds) {
        throw new Error(t("Thời gian cắt không hợp lệ (Bắt đầu phải nhỏ hơn Kết thúc)."));
      }
      setStatus(t("Đang cắt video bằng FFmpeg..."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/trim", {
        method: "POST",
        body: JSON.stringify({ path, startSeconds, endSeconds, reencode: false }),
      });
      state.videoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      if (video) {
        setVideoElementSrc(video, res.url);
      }
      setStatus(tf("Đã cắt đoạn video ({:.1f}s - {:.1f}s) thành công.", startSeconds, endSeconds));
      return;
    }
    if (name === "video-tool-burn-text") {
      const series = selectedSeries();
      if (!series) return;
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const video = domRoot?.querySelector("#surgery-video-player");
      const text = prompt(t("Nhập nội dung đóng dấu / thông tin phẫu thuật:"), `${series.patientName || "BN"} - ${new Date().toLocaleDateString()}`);
      if (!text) return;
      setStatus(t("Đang đóng dấu thông tin lên video..."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/burn-text", {
        method: "POST",
        body: JSON.stringify({
          path,
          overlays: [{ text, x: 24, y: 24, font_size: 24, font_color: "yellow", box: true }],
        }),
      });
      state.videoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      if (video) {
        setVideoElementSrc(video, res.url);
      }
      setStatus(t("Đã đóng dấu thông tin lên video thành công."));
      return;
    }
    if (name === "video-tool-filmstrip") {
      const series = selectedSeries();
      if (!series) return;
      setStatus(t("Đang trích xuất chuỗi khung hình filmstrip..."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/filmstrip", {
        method: "POST",
        body: JSON.stringify({ path, count: 6, maxWidth: 160 }),
      });
      state.videoFilmstrip = res.frames || [];
      render();
      initMediaEvents();
      setStatus(tf("Đã trích xuất {} khung hình filmstrip.", state.videoFilmstrip.length));
      return;
    }
    if (name === "video-tool-transcode") {
      const series = selectedSeries();
      if (!series) return;
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const video = domRoot?.querySelector("#surgery-video-player");
      setStatus(t("Đang tối ưu hoá mã hoá video MP4 (H.264)..."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/transcode", {
        method: "POST",
        body: JSON.stringify({ path, crf: 23, use_hw: true }),
      });
      state.videoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      if (video) {
        setVideoElementSrc(video, res.url);
      }
      setStatus(t("Đã tối ưu hoá và xuất video MP4 thành công."));
      return;
    }
    if (name === "video-tool-concat") {
      // A folder of clips is one series with many files. Listing series meant
      // three recordings of one operation offered a single line to tick, and
      // only the first file was ever handed to FFmpeg.
      const clips = await concatClipCandidates();
      if (clips.length < 2) {
        throw new Error(t("Cần ít nhất 2 clip video trong ca mổ để ghép."));
      }
      state.concatClips = clips;
      state.showConcatModal = true;
      render();
      return;
    }
    if (name === "close-concat-modal") {
      state.showConcatModal = false;
      render();
      return;
    }
    if (name === "toggle-concat-clip") {
      const idx = Number(element?.dataset?.clipIdx);
      if (state.concatClips && state.concatClips[idx]) {
        state.concatClips[idx].selected = !state.concatClips[idx].selected;
        render();
      }
      return;
    }
    if (name === "move-concat-clip-up") {
      const idx = Number(element?.dataset?.clipIdx);
      if (state.concatClips && idx > 0) {
        const temp = state.concatClips[idx];
        state.concatClips[idx] = state.concatClips[idx - 1];
        state.concatClips[idx - 1] = temp;
        render();
      }
      return;
    }
    if (name === "move-concat-clip-down") {
      const idx = Number(element?.dataset?.clipIdx);
      if (state.concatClips && idx < state.concatClips.length - 1) {
        const temp = state.concatClips[idx];
        state.concatClips[idx] = state.concatClips[idx + 1];
        state.concatClips[idx + 1] = temp;
        render();
      }
      return;
    }
    if (name === "start-concat-video") {
      const series = selectedSeries();
      if (!series) return;
      const selected = (state.concatClips || []).filter((c) => c.selected);
      if (selected.length < 2) {
        throw new Error(t("Cần chọn ít nhất 2 clip video để ghép."));
      }
      setStatus(tf("Đang chuẩn bị ghép {} clip video...", selected.length));
      const sources = selected.map((clip) => clip.path).filter(Boolean);
      if (sources.length < 2) {
        throw new Error(t("Không đủ số lượng file video hợp lệ để ghép."));
      }
      state.showConcatModal = false;
      render();
      setStatus(tf("Đang ghép {} clip video bằng FFmpeg...", sources.length));
      const res = await api("/api/media/video/concat", {
        method: "POST",
        body: JSON.stringify({
          sources,
          targetHeight: state.concatTargetHeight || 1080,
          targetFps: state.concatTargetFps || 30,
        }),
      });
      state.videoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      if (video) {
        setVideoElementSrc(video, res.url);
      }
      setStatus(tf("Đã ghép thành công {} đoạn video clip.", sources.length));
      return;
    }
    if (name === "video-tool-thumb") {
      const series = selectedSeries();
      if (!series) return;
      const domRoot = getDomRoot();
      const video = domRoot?.querySelector("#surgery-video-player");
      const current = video ? video.currentTime : 0;
      setStatus(tf("Đang tạo ảnh đại diện thumbnail tại {:.1f}s...", current));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/thumbnail", {
        method: "POST",
        body: JSON.stringify({ path, atSeconds: current, maxWidth: 480 }),
      });
      await downloadApiFile(res.url, `thumb_${Math.floor(current)}s.jpg`);
      setStatus(tf("Đã tạo ảnh đại diện thumbnail thành công ({:.1f}s).", current));
      return;
    }

    if (name === "photo-rotate-cw") {
      const series = selectedSeries();
      if (!series) return;
      setStatus(t("Đang xoay ảnh 90°..."));
      const path = await getPhotoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
      const res = await api("/api/media/photo/rotate", {
        method: "POST",
        body: JSON.stringify({ path, degrees: 90 }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = getDomRoot();
      const img = domRoot?.querySelector("#photo-editor-img");
      setMediaElementSrc(img, res.url);
      setStatus(t("Đã xoay ảnh 90° thành công."));
      return;
    }
    if (name === "photo-tool-crop") {
      const series = selectedSeries();
      if (!series) return;
      const path = await getPhotoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
      const rect = requirePhotoSelection();
      setStatus(t("Đang cắt ảnh..."));
      const res = await api("/api/media/photo/crop", {
        method: "POST",
        body: JSON.stringify({ path, rect }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const img = domRoot?.querySelector("#photo-editor-img");
      setMediaElementSrc(img, res.url);
      setStatus(t("Đã cắt vùng chọn ảnh thành công."));
      return;
    }
    if (name === "photo-tool-redact") {
      const series = selectedSeries();
      if (!series) return;
      const path = await getPhotoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
      const regions = [requirePhotoSelection()];
      setStatus(t("Đang che vùng thông tin định danh..."));
      const res = await api("/api/media/photo/redact", {
        method: "POST",
        body: JSON.stringify({ path, regions, fill: [0, 0, 0] }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const img = domRoot?.querySelector("#photo-editor-img");
      setMediaElementSrc(img, res.url);
      setStatus(t("Đã che vùng danh tính (ĐÃ CHE) thành công."));
      return;
    }
    if (name === "photo-tool-arrow") {
      const series = selectedSeries();
      if (!series) return;
      const path = await getPhotoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
      // The drag names the arrow: it runs from where the reader started to
      // where they released, so it points at what they were pointing at.
      const sel = requirePhotoSelection();
      const arrows = [{
        x1: sel.x, y1: sel.y,
        x2: sel.x + sel.width, y2: sel.y + sel.height,
        color: [255, 70, 70],
      }];
      setStatus(t("Đang chèn mũi tên chỉ điểm..."));
      const res = await api("/api/media/photo/annotate", {
        method: "POST",
        body: JSON.stringify({ path, arrows, texts: [], boxes: [] }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const img = domRoot?.querySelector("#photo-editor-img");
      setMediaElementSrc(img, res.url);
      setStatus(t("Đã chèn mũi tên chỉ điểm thành công."));
      return;
    }
    if (name === "photo-tool-box") {
      const series = selectedSeries();
      if (!series) return;
      const path = await getPhotoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
      const boxes = [{ rect: requirePhotoSelection(), color: [255, 70, 70], width: 3 }];
      setStatus(t("Đang khoanh vùng tổn thương..."));
      const res = await api("/api/media/photo/annotate", {
        method: "POST",
        body: JSON.stringify({ path, boxes, texts: [], arrows: [] }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const img = domRoot?.querySelector("#photo-editor-img");
      setMediaElementSrc(img, res.url);
      setStatus(t("Đã khoanh vùng tổn thương thành công."));
      return;
    }
    if (name === "photo-tool-text") {
      const series = selectedSeries();
      if (!series) return;
      const path = await getPhotoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
      const textInput = prompt(t("Nhập ghi chú chữ:")) || t("Ghi chú lâm sàng");
      setStatus(t("Đang chèn chữ..."));
      const info = await api("/api/media/photo/info", {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      const w = info?.info?.width || 800;
      const h = info?.info?.height || 600;
      const texts = [{ text: textInput, x: Math.round(w * 0.1), y: Math.round(h * 0.9), fontSize: 24, color: [255, 255, 0] }];
      const res = await api("/api/media/photo/annotate", {
        method: "POST",
        body: JSON.stringify({ path, texts, arrows: [], boxes: [] }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const img = domRoot?.querySelector("#photo-editor-img");
      setMediaElementSrc(img, res.url);
      setStatus(t("Đã chèn ghi chú chữ thành công."));
      return;
    }
    if (name === "photo-export-pdf") {
      const series = selectedSeries();
      if (!series) return;
      setStatus(t("Đang xuất file PDF..."));
      const payload = state.photoWorkingPath
        ? { sources: [state.photoWorkingPath] }
        : { seriesId: series.id };
      const res = await api("/api/media/photo/export-pdf", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await downloadApiFile(res.url, `patient_document_${Date.now()}.pdf`);
      setStatus(tf("Đã xuất PDF thành công: {}", res.outputPath));
      return;
    }
  } catch (error) {
    const errorMsg = String(error?.message || error);
    if (errorMsg.includes("Không đăng nhập được RIS") || errorMsg.includes("Không thể đăng nhập vào RIS")) {
      state.showLoginCard = true;
      state.loginCardAction = name;
      render();
      return;
    }
    setStatus(humanError(error), true);
  }
}

const DEFAULT_TOOLS = { volume3d: "orbit3d", mpr: "crosshair" };

function defaultToolForMode(mode, currentTool) {
  if (DEFAULT_TOOLS[mode]) return DEFAULT_TOOLS[mode];
  return currentTool === "orbit3d" || currentTool === "crosshair" ? "window" : currentTool;
}

function syncToolHighlight(root = app || (typeof document !== "undefined" ? document : null)) {
  root?.querySelectorAll('.toolbar .icon-button[data-action^="tool-"]').forEach((button) => {
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
    customUsername: state.customRisUser,
    customPassword: state.customRisPass,
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

function saveMediaWorkspaceToTab(tab) {
  if (!tab) return;
  tab.mediaIndex = state.mediaIndex || {};
  tab.mediaEdits = state.mediaEdits || {};
  tab.photoWorkingPath = state.photoWorkingPath || null;
  tab.videoWorkingPath = state.videoWorkingPath || null;
  tab.videoBookmarks = state.videoBookmarks || [];
  tab.videoFilmstrip = state.videoFilmstrip || [];
  tab.lastMediaSeriesId = state._lastPhotoSeriesId || "";
  tab.textDoc = state.textDoc || null;
}

function restoreMediaWorkspaceFromTab(tab) {
  state.mediaIndex = tab?.mediaIndex || {};
  state.mediaEdits = tab?.mediaEdits || {};
  state.photoWorkingPath = tab?.photoWorkingPath || null;
  state.videoWorkingPath = tab?.videoWorkingPath || null;
  state.videoBookmarks = tab?.videoBookmarks || [];
  state.videoFilmstrip = tab?.videoFilmstrip || [];
  state._lastPhotoSeriesId = tab?.lastMediaSeriesId || "";
  state.textDoc = tab?.textDoc || null;
  state.photoSelection = null;
  state.showConcatModal = false;
  state.concatClips = [];
}

function resetMediaWorkspace() {
  restoreMediaWorkspaceFromTab(null);
}

async function switchTab(tabId) {
  if (state.activeTabId === tabId) return;
  const currentTab = state.tabs.find((t) => t.id === state.activeTabId);
  if (currentTab) {
    currentTab.archive = state.archive;
    currentTab.selectedId = state.selectedId;
    currentTab.compareIds = [...state.compareIds];
    currentTab.mode = state.mode;
    currentTab.tool = state.tool;
    currentTab.windowPreset = state.windowPreset;
    currentTab.mprPrimary = state.mprPrimary;
    currentTab.status = state.status;
    saveMediaWorkspaceToTab(currentTab);
  }
  clearViewer();
  state.activeTabId = tabId;
  if (tabId === "worklist") {
    // The worklist scans the shared archive, not one patient's session.
    setApiSession("");
    render();
    return;
  }
  const targetTab = state.tabs.find((t) => t.id === tabId);
  if (targetTab) {
    // Point every subsequent request at this tab's own catalog before any of
    // them go out, or the tab reads whichever archive was opened last.
    setApiSession(targetTab.sessionId || "");
    state.archive = targetTab.archive;
    state.selectedId = targetTab.selectedId;
    state.compareIds = [...targetTab.compareIds];
    state.mode = targetTab.mode;
    state.tool = targetTab.tool;
    state.windowPreset = targetTab.windowPreset;
    state.mprPrimary = targetTab.mprPrimary;
    state.status = targetTab.status;
    restoreMediaWorkspaceFromTab(targetTab);
    for (const series of state.archive.series) registerSeries(series);
  }
  render();
  await renderViewer();
}

async function closeTab(tabId) {
  const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) return;
  const tab = state.tabs[tabIndex];
  if (tab.sessionId) {
    api("/api/sessions/close", {
      method: "POST",
      body: JSON.stringify({ sessionId: tab.sessionId }),
    }).catch(() => {});
  }
  state.tabs.splice(tabIndex, 1);
  // Nothing reads the closed record's files any more. Closing a background
  // tab must leave the record on screen alone, which still holds its blobs.
  releaseMediaObjectUrls(state.activeTabId === tabId ? "" : state.selectedId);
  if (state.activeTabId === tabId) {
    const nextTab = state.tabs[tabIndex] || state.tabs[tabIndex - 1];
    const nextTabId = nextTab ? nextTab.id : "worklist";
    await switchTab(nextTabId);
  } else {
    render();
  }
}

function applyArchive(archive, sessionId = "", folder = "") {
  state.archive = archive;
  for (const series of archive.series) registerSeries(series);
  if (!archive.series.some((item) => item.id === state.selectedId)) {
    state.selectedId = archive.series[0]?.id || "";
  }
  fillCompareSlots("compare3");
  state.mode = "single";
  state.tool = "window";
  state.windowPreset = defaultWindowPreset(selectedSeries());

  const tabName = archive.root ? archive.root.split(/[\\/]/).pop() : (archive.patient?.patientName || "Bệnh nhân");
  let currentTab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!currentTab || state.activeTabId === "worklist") {
    resetMediaWorkspace();
    const newTab = {
      id: `tab-${Date.now()}`,
      sessionId: sessionId || "",
      // The folder this tab reads. Used to focus an open record instead of
      // opening a second tab on it.
      folder: folder || archive.root || "",
      patientId: archive.patient?.patientId || "",
      patientName: archive.patient?.patientName || tabName,
      archive,
      selectedId: state.selectedId,
      compareIds: [...state.compareIds],
      mode: state.mode,
      tool: state.tool,
      windowPreset: state.windowPreset,
      mprPrimary: "axial",
      scrollLinked: false,
      status: "Sẵn sàng.",
      mediaIndex: state.mediaIndex,
      mediaEdits: state.mediaEdits,
      photoWorkingPath: null,
      videoWorkingPath: null,
      videoBookmarks: [],
      videoFilmstrip: [],
      lastMediaSeriesId: "",
      textDoc: null,
    };
    state.tabs.push(newTab);
    state.activeTabId = newTab.id;
  } else {
    currentTab.archive = archive;
    currentTab.selectedId = state.selectedId;
    currentTab.patientName = archive.patient?.patientName || currentTab.patientName;
    currentTab.patientId = archive.patient?.patientId || currentTab.patientId;
    currentTab.folder = folder || archive.root || currentTab.folder || "";
    if (sessionId) currentTab.sessionId = sessionId;
  }

  render();
  renderViewer();
}

function renderViewer() {
  if (state.activeTabId === "worklist") return Promise.resolve();
  const series = selectedSeries();
  if (!series) return viewerQueue;
  const mediaType = getSeriesMediaType(series);
  if (mediaType === "text") {
    clearViewer();
    state.busyViewer = false;
    app.querySelector(".status-dot")?.classList.remove("busy");
    loadTextContent(series, currentTextDoc(series)?.index || 0);
    return Promise.resolve();
  }
  if (mediaType === "pdf") {
    clearViewer();
    state.busyViewer = false;
    getDomRoot()?.querySelector(".status-dot")?.classList.remove("busy");
    // The embed needs its authenticated blob just like the photo pane does.
    hydrateMediaSources();
    setStatus(t("Sẵn sàng."));
    return Promise.resolve();
  }
  if (mediaType === "video" || mediaType === "photo" || mediaType === "doc") {
    if (state._lastPhotoSeriesId !== series.id) {
      state._lastPhotoSeriesId = series.id;
      // Moving to another record releases decoded blobs, while the lightweight
      // edit paths stay attached to their own series/file and can be restored.
      releaseMediaObjectUrls(series.id);
      restoreMediaEditState(series);
      state.photoRotation = 0;
      state.videoFilmstrip = [];
      state._videoInfoLoaded = false;
    }
    clearViewer();
    state.busyViewer = false;
    const requestedWorkspace = document.querySelector("#workspace");
    if (requestedWorkspace) {
      requestedWorkspace.classList.remove("busy");
      delete requestedWorkspace.dataset.loadingText;
    }
    app.querySelector(".status-dot")?.classList.remove("busy");
    setStatus(t("Sẵn sàng."));
    initMediaEvents();
    return Promise.resolve();
  }
  const mode = state.mode;
  const comparison = compareSeriesList();
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
  state.isError = Boolean(isError);
  const container = app || (typeof document !== "undefined" ? document.querySelector("#app") : null);
  const bar = container?.querySelector(".status-bar");
  if (bar) {
    bar.classList.toggle("error", state.isError);
    const textEl = bar.querySelector(".status-text");
    if (textEl) {
      textEl.textContent = message;
    }
  }
}


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
  state.job = job;
  // Repaints the queue card in place. A full render() here would rebuild #app
  // once a second and take the viewer's WebGL canvas down with it.
  refreshActivityPanel();
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
    
    // Intercept RIS login errors from background jobs
    if (job.status === "error" && 
        (String(job.message).includes("Không đăng nhập được RIS") || 
         String(job.message).includes("Không thể đăng nhập vào RIS"))) {
      state.showLoginCard = true;
      state.loginCardAction = job.kind === "search" ? "search" : 
                              job.kind === "series-discovery" ? "discover-series" : "download-selected";
      render();
      return;
    }
    
    // Any finished job may have added a folder worth remembering — and may
    // have changed what is on disk, so the scanned tree is re-read too.
    refreshHistory();
    refreshWorklist();
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
  if (!app) return;
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
  if (state.archive.series && state.archive.series.length > 0) {
    const tabName = state.archive.root ? state.archive.root.split(/[\\/]/).pop() : (state.archive.patient?.patientName || "Bệnh nhân 1");
    const initialTab = {
      id: "tab-init",
      sessionId: "",
      // Without this the boot tab matches no folder, so opening the same
      // record from the worklist added a second tab on top of it.
      folder: state.archive.root || "",
      patientId: state.archive.patient?.patientId || "",
      patientName: state.archive.patient?.patientName || tabName,
      archive: state.archive,
      selectedId: state.selectedId,
      compareIds: [...state.compareIds],
      mode: state.mode,
      tool: state.tool,
      windowPreset: state.windowPreset,
      mprPrimary: "axial",
      scrollLinked: false,
      status: "Sẵn sàng.",
    };
    saveMediaWorkspaceToTab(initialTab);
    state.tabs.push(initialTab);
    state.activeTabId = initialTab.id;
  } else {
    state.activeTabId = "worklist";
  }
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
  // The scan walks every study folder, so it is not awaited: the shell paints
  // from history first and the tree swaps to real counts when they land.
  refreshWorklist();
  await renderViewer();
}

const isRunningInTest = (typeof process !== "undefined" && Boolean(process.env?.VITEST)) || (typeof import.meta !== "undefined" && import.meta.env?.MODE === "test");

if (!isRunningInTest) {
  boot().catch((error) => {
    app.innerHTML = `<div class="fatal-error"><b>${escapeHtml(t("Không khởi động được DICOM/JPG Downloader & Viewer"))}</b>
      <pre>${escapeHtml(error.stack || error.message)}</pre>
      <button class="primary" id="fatal-reload">${escapeHtml(t("Tải lại"))}</button></div>`;
    // The local API forbids inline handlers, so the listener is attached here.
    document.querySelector("#fatal-reload")?.addEventListener("click", () => location.reload());
  });
}

export {
  state,
  action,
  renderWorklistView,
  renderActivityPanelInner,
  filteredHistoryEntries,
  filteredPatientList,
  getEffectiveWorklistPatients,
  renderWorklistTreeInner,
  renderWorklistSummaryInner,
  refreshWorklist,
  studyHeadingLine,
  studyCountLine,
  getSeriesMediaType,
  getPhotoSourcePath,
  getVideoSourcePath,
  concatClipCandidates,
  editHistoryFor,
  canUndoMediaEdit,
  canRedoMediaEdit,
  saveMediaWorkspaceToTab,
  restoreMediaWorkspaceFromTab,
  syncToolHighlight,
  renderSurgeryVideoStudio,
  renderPhotoEditorStudio,
  renderTextViewer,
  renderWorkspacePane,
  renderPatientRail,
  buildMediaTimeline,
  downloadPanelVisible,
  loadTextContent,
  bindTextViewerButtons,
  renderViewer,
  initMediaEvents,
  groupSeriesHierarchically,
  renderSeriesOptions,
  renderSeriesStripContent,
};
