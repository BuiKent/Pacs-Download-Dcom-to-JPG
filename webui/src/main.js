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
  studiesMissingSeries,
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
  setScaleOverlay,
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
  scaleOverlayState,
  seriesHasPhysicalSpacing,
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
import {
  ANNOTATOR_COLORS,
  ANNOTATOR_TOOLS,
  canRedoLayer,
  canUndoLayer,
  createLayer,
  defaultStyle,
  isShapeUsable,
  layerPayload,
  redoLayer,
  toolById,
  undoLayer,
} from "./photo-annotator.js";
import {
  createAnnotatorSurface,
  currentSurface,
  destroyActiveSurface,
} from "./photo-editor.js";

let app = typeof document !== "undefined" ? document.querySelector("#app") : null;

function getDomRoot() {
  if (typeof document === "undefined") return null;
  if (!app || !app.isConnected) {
    app = document.querySelector("#app");
  }
  return (app && app.isConnected) ? app : document;
}
// The backend hands the token over once in the query string and it is taken
// straight back out, so it never sits in the address bar, a screenshot or a
// copied link. sessionStorage keeps the only other copy: without it, reloading
// the page — F5, or the Reload button on the fatal-error screen — threw the
// token away and the app could never start again in that window. The store is
// scoped to this window and to host:port, and the server picks a fresh port
// every launch, so a token cannot outlive the server that issued it.
const SESSION_TOKEN_KEY = "dcom.sessionToken";
const sessionUrl = new URL(location.href);
let sessionToken = sessionUrl.searchParams.get("token") || "";
try {
  if (sessionToken) sessionStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
  else sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
} catch (_) {
  // Private modes and file:// origins refuse sessionStorage; the token from
  // the URL still works for this load, only the reload path is lost.
}
configureApi(sessionToken);
const hasSessionToken = Boolean(sessionToken);
sessionToken = "";
sessionUrl.searchParams.delete("token");
history.replaceState(
  history.state,
  "",
  `${sessionUrl.pathname}${sessionUrl.search}${sessionUrl.hash}`,
);

/** Drop a token the server no longer accepts so a reload stops replaying it. */
function forgetSessionToken() {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch (_) {
    // Nothing to forget when the store was never available.
  }
}

const state = {
  bootstrap: null,
  archive: { root: "", series: [] },
  selectedId: "",
  // The text/JSON file currently in the reading pane: { seriesId, index, name,
  // language, text }. Null until a text series is opened.
  textDoc: null,
  // The photo studio's drawing layers, one per file, keyed `seriesId:index`
  // exactly like the edit history. A layer holds the shapes the reader has
  // drawn but not yet flattened, so switching pages and coming back does not
  // throw the annotation away.
  photoLayers: {},
  // Which drawing tool the pointer is holding, and the style new shapes take.
  photoTool: "select",
  photoStyle: defaultStyle(),
  // Display zoom for the photo stage. 0 means fit the image to the stage.
  photoZoom: 0,
  // In and out points on the surgical player, in seconds. They drive both the
  // trim and the span a drawn overlay is shown for; null means unmarked.
  videoIn: null,
  videoOut: null,
  videoDuration: 0,
  // Series shown beside the primary one; index 0 is pane B, index 1 is pane C.
  compareIds: ["", ""],
  scrollSync: true,
  referenceLines: true,
  referenceCursor: true,
  // The mm scale bar. Off by default: it only means anything on a series whose
  // real pixel spacing the archive recorded.
  scaleOverlay: false,
  mode: "single",
  tool: "window",
  downloadOpen: true,
  studies: [],
  patient: null,
  downloadAllFiles: true,
  downloadAttachments: true,
  seriesInventory: [],
  rememberedSeriesSelections: {},
  // Every group a scan returns, kept by studyUid. Unticking a date only hides
  // its series now; the group comes back when the date is ticked again.
  seriesGroupCache: {},
  status: "Đang khởi động...",
  isError: false,
  busyViewer: false,
  cine: false,
  mprPrimary: "axial",
  windowPreset: "full",
  history: [],
  sourceFolders: [],
  editingPatientInfo: false,
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
  // Which file of a multi-file photo or video series is shown, keyed by series
  // id so switching away and back keeps the reader's place.
  mediaIndex: {},
  mediaEdits: {},
  photoWorkingPath: null,
  videoWorkingPath: null,
  tabs: [],
  activeTabId: "worklist",
  worklistSearch: "",
  worklistPatients: [],
  worklistLoaded: false,
  worklistLoading: false,
  worklistError: "",
  // Unsaved administrative fields belong to the tab they were typed in.
  // Keeping the draft separately prevents a tab switch from rebuilding the
  // form with another patient's (or the old) values.
  patientEditDraft: null,
  worklistSortColumn: "date",
  worklistSortOrder: "desc",
  // Study-level filters. A radiologist works a list down by modality and by
  // what is still unread, so these narrow the studies inside each patient row
  // rather than only hiding whole patients.
  worklistModality: "",
  worklistPeriod: "all",
  worklistRead: "all",
  // Which Worklist tab is showing: the patient/study list or the queue+history.
  worklistTab: "studies",
  // Latest /api/job snapshot, kept so the Activity panel can draw it.
  job: null,
  // What the shell has done to the window. Mirrored here because render()
  // rewrites the whole shell: a class toggled straight onto the element is
  // gone the next time anything else re-renders.
  windowMaximized: false,
  zenMode: false,
  showExportModal: false,
  exportModalFolder: "",
  exportModalOptions: null,
  exportModalPatientName: "",
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
  magnify: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><path d="m21 21-5.2-5.2"/></svg>`,
  scaleBar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16h18"/><path d="M3 12v8"/><path d="M21 12v8"/><path d="M8 14v6"/><path d="M13 14v6"/><path d="M18 14v6"/></svg>`,
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
    || ["cine", "scroll-sync", "reference-lines", "reference-cursor", "scale-overlay"].includes(id);
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
    iconButton("tool-magnify", icons.magnify, t("Kính lúp"), state.tool === "magnify"),
    // The scale bar is a measurement, so it is offered only where the archive
    // recorded real millimetre spacing.
    iconButton(
      "scale-overlay",
      icons.scaleBar,
      t("Thước tỉ lệ (mm)"),
      state.scaleOverlay,
      !seriesHasPhysicalSpacing(series),
    ),
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

    // `studyGroup` is "<ngày> - <modality> - <mô tả>", and the date is already
    // this map's outer key. Taking the exam's own name where the backend
    // reports one, and only falling back to the group otherwise, stops the
    // header reading "MR - MR sọ não có tiêm".
    const mod = item.modality && item.modality !== "UNKNOWN" ? item.modality : "";
    let studyTitle = String(item.studyDescription || "").trim();
    if (!studyTitle) {
      const parts = String(item.studyGroup || "").trim().split(" - ");
      if (parts.length >= 2 && (/^\d{4}-\d{2}-\d{2}/.test(parts[0]) || /^\d{8}/.test(parts[0]))) {
        parts.shift();
      }
      studyTitle = parts.join(" - ").trim();
    }
    if (studyTitle === "Không rõ ca chụp") studyTitle = "";
    if (studyTitle && mod && !studyTitle.toUpperCase().startsWith(mod.toUpperCase())) {
      studyTitle = `${mod} · ${studyTitle}`;
    }
    if (!studyTitle) studyTitle = mod || t("Ca chụp chưa phân loại");

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
      ? `<div class="series-group-badge" data-date-key="${escapeHtml(group.dateKey)}" title="${escapeHtml(`${dateLabel} - ${group.studyTitle}`)}">
          <span class="badge-date">📁 ${escapeHtml(dateLabel)}</span>
          <span class="badge-study">${escapeHtml(group.studyTitle)}</span>
         </div>`
      : "";

    const cards = group.items.map((item) => {
      const visiblePanes = seriesVisiblePanes(item.id);
      const isVisible = visiblePanes.length > 0;
      const label = seriesLabel(item);
      const cachedThumb = resolvedThumbUrls.get(item.id) || "";
      return `<button class="series-card ${isVisible ? "active" : ""}"
              data-series-id="${item.id}" 
              data-date-key="${escapeHtml(group.dateKey)}"
              title="${escapeHtml(label)}"
              ${isVisible ? `data-pane="${visiblePanes.join(",")}"` : ""}>
              <div class="series-thumb-box">
                <img class="series-card-thumb" data-thumb-id="${item.id}" ${cachedThumb ? `src="${cachedThumb}"` : ""} alt="" />
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
    const isDicom = tab.archive?.series?.some((s) => s.sourceType === "dicom") ?? false;
    const format = isDicom ? "DICOM" : "JPG";
    const modality = tab.archive?.series?.[0]?.modality || (isDicom ? "DICOM" : "MR");
    const badgeText = `${modality} · ${format}`;
    return `<div class="winbar-tab${isActive ? " active" : ""}" data-tab-id="${tab.id}">
      <span class="winbar-tab-title" title="${escapeHtml(title)}">${escapeHtml(title)} <span class="tab-fmt-badge ${isDicom ? "dicom" : "jpg"}">${escapeHtml(badgeText)}</span></span>
      <button class="winbar-tab-close" data-action="close-tab" data-tab-id="${tab.id}" title="${escapeHtml(t("Đóng tab"))}">×</button>
    </div>`;
  }).join("");

  return `<nav class="winbar">
    <div class="winbar-tab${worklistActive ? " active" : ""}" data-tab-id="worklist">
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

/**
 * The in/out selection on the timeline, or null when nothing is marked.
 *
 * Trimming used to ask for the two times in a pair of `prompt()` boxes, so a
 * surgeon cutting a clip had to read the clock, dismiss the player, type a
 * decimal, and hope. The points are set from the playhead with one key each and
 * shown on the scrubber, which is how every editor does it.
 */
function videoRange() {
  const start = Number(state.videoIn);
  const end = Number(state.videoOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/** The in/out band drawn over the scrubber track. */
function renderVideoRangeBand() {
  const range = videoRange();
  const duration = Number(state.videoDuration) || 0;
  if (!range || !duration) return "";
  const left = Math.max(0, Math.min(100, (range.start / duration) * 100));
  const width = Math.max(0.5, Math.min(100 - left, ((range.end - range.start) / duration) * 100));
  return `<span class="video-range-band" style="left:${left}%; width:${width}%"></span>`;
}

/**
 * Repaint the in/out selection without rebuilding the studio.
 *
 * A full `render()` would replace the `<video>` element, which drops the
 * decoded buffer and jumps the playhead back to zero — marking a point must
 * never cost the reader their place in the operation.
 */
function syncVideoRangeUI() {
  const root = getDomRoot();
  const wrap = root?.querySelector(".video-scrubber-wrap");
  if (!wrap) return;
  const range = videoRange();
  const duration = Number(state.videoDuration) || 0;
  let band = wrap.querySelector(".video-range-band");
  if (!range || !duration) {
    band?.remove();
  } else {
    if (!band) {
      band = document.createElement("span");
      band.className = "video-range-band";
      wrap.prepend(band);
    }
    const left = Math.max(0, Math.min(100, (range.start / duration) * 100));
    band.style.left = `${left}%`;
    band.style.width = `${Math.max(0.5, Math.min(100 - left, ((range.end - range.start) / duration) * 100))}%`;
  }
  const readout = root.querySelector("#video-range-readout");
  if (readout) {
    readout.textContent = range
      ? `${formatVideoTime(range.start)} → ${formatVideoTime(range.end)}`
      : t("Chưa chọn đoạn");
  }
  const clear = root.querySelector("[data-action='video-clear-range']");
  if (clear) clear.disabled = !range;
  const trim = root.querySelector("[data-action='video-tool-trim']");
  if (trim) trim.disabled = !range;
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
  const range = videoRange();
  const pending = pendingShapeCount(series);
  return `
    <div class="surgery-video-studio">
      <div class="photo-editor-toolbar">
        ${renderMediaFileNav(series)}
        ${renderEditHistoryNav(series)}
        <span class="photo-props-divider"></span>
        <button class="tool-btn" data-action="video-tool-trim" ${range ? "" : "disabled"}
          title="${escapeHtml(t("Cắt giữ lại đoạn đã đánh dấu"))}">✂ ${escapeHtml(t("Cắt đoạn"))}</button>
        <button class="tool-btn" data-action="video-tool-concat" title="${escapeHtml(t("Ghép các clip video"))}">🔗 ${escapeHtml(t("Ghép clips"))}</button>
        <button class="tool-btn" data-action="video-tool-burn-text" title="${escapeHtml(t("Đóng dấu / Chèn thông tin phẫu thuật"))}">🏷 ${escapeHtml(t("Đóng dấu thông tin"))}</button>
        <button class="tool-btn" data-action="video-tool-thumb" title="${escapeHtml(t("Trích xuất ảnh đại diện Thumbnail"))}">🖼 ${escapeHtml(t("Tạo Thumbnail"))}</button>
        <button class="tool-btn" data-action="video-tool-filmstrip" title="${escapeHtml(t("Tạo chuỗi ảnh Filmstrip"))}">🎞 ${escapeHtml(t("Tạo Filmstrip"))}</button>
        <button class="tool-btn" data-action="video-tool-transcode" title="${escapeHtml(t("Tối ưu hoá mã hoá MP4 (H.264)"))}">⚡ ${escapeHtml(t("Tối ưu MP4"))}</button>
        <span style="flex:1;"></span>
        <button class="tool-btn primary" data-action="video-apply-shapes" id="photo-apply-shapes"
          ${pending ? "" : "disabled"} title="${escapeHtml(t("Ghi nét vẽ vĩnh viễn vào video"))}">
          ${escapeHtml(t("Áp dụng lên video"))}${pending ? ` (${pending})` : ""}
        </button>
        <div id="video-meta-badge" class="badge" style="font-size:11px; padding:4px 8px; opacity:0.85;">🎬 ${escapeHtml(series.patientName || "Video Phẫu Thuật")}</div>
      </div>
      ${renderPhotoProperties(series)}
      <div class="surgery-video-body">
        ${renderPhotoToolRail()}
        <div class="surgery-video-stage">
          <div class="photo-editor-canvas-wrap" id="photo-editor-canvas">
            <video id="surgery-video-player" class="surgery-video-element" src="${escapeHtml(videoStreamUrl(series, workName))}" playsinline preload="metadata"></video>
            <canvas id="photo-annotation-canvas" class="photo-annotation-canvas"></canvas>
          </div>
        </div>
        <aside class="surgery-video-sidebar">
          <div class="surgery-video-sidebar-header">
            <span>📌 ${escapeHtml(t("Mốc phẫu thuật / Ghi chú"))}</span>
            <button class="control-btn primary" data-action="add-video-bookmark">+ ${escapeHtml(t("Đánh dấu mốc"))}</button>
          </div>
          <div class="surgery-video-bookmarks">
            ${bookmarks.length === 0 ? `<div class="empty-state" style="padding:20px; font-size:12px;">${escapeHtml(t("Chưa có mốc ghi chú nào"))}</div>` : bookmarks.map((bm) => `
              <div class="surgery-bookmark-card" data-action="seek-video" data-time="${bm.time}">
                <div class="surgery-bookmark-time">⏱ ${formatVideoTime(bm.time)}</div>
                <div class="surgery-bookmark-text">${escapeHtml(bm.text || t("Mốc phẫu thuật"))}</div>
              </div>
            `).join("")}
          </div>
        </aside>
      </div>
      ${filmstrip.length > 0 ? `
        <div class="surgery-video-filmstrip">
          ${filmstrip.map((framePath, idx) => {
            const frameName = framePath.split(/[\\/]/).pop();
            const frameUrl = mediaAuthUrl(`/api/media/work-file?name=${encodeURIComponent(frameName)}`);
            return `<img src="${escapeHtml(frameUrl)}" title="Frame ${idx + 1}" data-action="seek-filmstrip-idx" data-idx="${idx}" data-total="${filmstrip.length}" />`;
          }).join("")}
        </div>
      ` : ""}
      <div class="surgery-video-controls">
        <button class="control-btn" data-action="video-play-pause" title="${escapeHtml(t("Phát / Tạm dừng"))}">⏯</button>
        <button class="control-btn" data-action="video-rewind-5" title="${escapeHtml(t("Tua lùi 5s"))}">-5s</button>
        <button class="control-btn" data-action="video-forward-5" title="${escapeHtml(t("Tua tới 5s"))}">+5s</button>
        <span id="video-time-display" class="video-time">00:00 / 00:00</span>
        <span class="video-scrubber-wrap">
          ${renderVideoRangeBand()}
          <input type="range" id="surgery-video-scrubber" class="video-scrubber" min="0" max="100" step="0.1" value="0"
            aria-label="${escapeHtml(t("Thanh tua video"))}">
        </span>
        <button class="control-btn" data-action="video-set-in" title="${escapeHtml(t("Đặt điểm đầu tại vị trí đang xem"))} (I)">⇤ ${escapeHtml(t("Đầu"))}</button>
        <button class="control-btn" data-action="video-set-out" title="${escapeHtml(t("Đặt điểm cuối tại vị trí đang xem"))} (O)">${escapeHtml(t("Cuối"))} ⇥</button>
        <span class="video-time" id="video-range-readout">${
          range
            ? `${formatVideoTime(range.start)} → ${formatVideoTime(range.end)}`
            : escapeHtml(t("Chưa chọn đoạn"))
        }</span>
        <button class="control-btn" data-action="video-clear-range" ${range ? "" : "disabled"}
          title="${escapeHtml(t("Bỏ đoạn đã đánh dấu"))}">✕</button>
        <select id="video-speed-select" class="control-btn" title="${escapeHtml(t("Tốc độ"))}"
          aria-label="${escapeHtml(t("Tốc độ"))}">
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

/**
 * Icons for the drawing tools, in the same 24px stroked style as the viewer's.
 *
 * A tool rail of emoji reads as a chat window; these are the glyphs every
 * drawing application uses, so a surgeon who has ever opened one recognises the
 * rail without reading a single label.
 */
const toolIcons = {
  cursor: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="19" y1="5" x2="5" y2="19"/><polyline points="19 13 19 5 11 5"/></svg>`,
  line: `<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="19" x2="19" y2="5"/></svg>`,
  rect: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>`,
  ellipse: `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.63l4.35-1.33a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/></svg>`,
  text: `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>`,
  marker: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9.5 12 8v8"/><path d="M10.5 16h3"/></svg>`,
  highlight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 11-6 6v3h3l6-6"/><path d="m14.5 5.5 4 4"/><path d="M13 3 21 11l-7.5 7.5-8-8z"/></svg>`,
  pixelate: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
  redact: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="1" fill="currentColor"/></svg>`,
  crop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>`,
};

/** The layer key for a file: the same `seriesId:index` the edit history uses. */
function photoLayerKey(series) {
  return `${series?.id || ""}:${mediaFileIndex(series)}`;
}

/**
 * The drawing layer for the file on screen, created on first use.
 *
 * A layer belongs to a file, not to the studio: paging to photo 3 of an
 * operative set and back must not lose what was drawn on photo 1.
 */
function photoLayer(series) {
  if (!series) return null;
  const all = state.photoLayers || (state.photoLayers = {});
  const key = photoLayerKey(series);
  return all[key] || (all[key] = createLayer());
}

function photoShapes(series) {
  return photoLayer(series)?.shapes || [];
}

/** How many shapes are waiting to be burned into the file. */
function pendingShapeCount(series) {
  return photoShapes(series).filter(isShapeUsable).length;
}

/** The vertical tool rail, the part of the studio the hand lives on. */
function renderPhotoToolRail() {
  return `
    <div class="photo-tool-rail" role="toolbar" aria-label="${escapeHtml(t("Công cụ vẽ"))}">
      ${ANNOTATOR_TOOLS.map((tool) => {
        const active = state.photoTool === tool.id;
        const title = `${t(tool.label)} (${tool.key})`;
        return `<button class="photo-tool ${active ? "active" : ""}" data-action="photo-pick-tool"
          data-tool="${tool.id}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"
          aria-pressed="${active ? "true" : "false"}">${toolIcons[tool.icon] || ""}</button>`;
      }).join("")}
    </div>
  `;
}

/**
 * The properties bar.
 *
 * Colour and size were compiled into the old tools — every arrow was the same
 * red, every note the same 24px yellow — so two findings on one photo could not
 * be told apart. These controls set what the next shape will look like and
 * restyle whatever is selected, which is the behaviour of every drawing
 * application and the thing a reader reaches for first.
 */
function renderPhotoProperties(series) {
  const style = state.photoStyle;
  const shapes = pendingShapeCount(series);
  return `
    <div class="photo-props" id="photo-props">
      <span class="photo-props-label">${escapeHtml(t("Màu"))}</span>
      <span class="photo-swatches">
        ${ANNOTATOR_COLORS.map((color) => `
          <button class="photo-swatch ${style.color.toLowerCase() === color ? "active" : ""}"
            data-action="photo-pick-color" data-color="${color}"
            style="background:${color}" title="${color}" aria-label="${color}"></button>
        `).join("")}
        <input type="color" class="photo-color-input" data-field="photo-color"
          value="${escapeHtml(style.color)}" title="${escapeHtml(t("Chọn màu tuỳ ý"))}"
          aria-label="${escapeHtml(t("Chọn màu tuỳ ý"))}">
      </span>
      <span class="photo-props-divider"></span>
      <label class="photo-props-field">
        <span>${escapeHtml(t("Nét"))}</span>
        <input type="range" min="1" max="32" step="1" value="${style.strokeWidth}" data-field="photo-stroke">
        <b id="photo-stroke-value">${style.strokeWidth}</b>
      </label>
      <label class="photo-props-field" id="photo-font-field">
        <span>${escapeHtml(t("Cỡ chữ"))}</span>
        <input type="range" min="10" max="160" step="2" value="${style.fontSize}" data-field="photo-font">
        <b id="photo-font-value">${style.fontSize}</b>
      </label>
      <label class="photo-props-field">
        <span>${escapeHtml(t("Độ đậm"))}</span>
        <input type="range" min="20" max="100" step="5" value="${Math.round(style.opacity * 100)}" data-field="photo-opacity">
        <b id="photo-opacity-value">${Math.round(style.opacity * 100)}%</b>
      </label>
      <label class="photo-props-check">
        <input type="checkbox" data-field="photo-fill" ${style.filled ? "checked" : ""}>
        <span>${escapeHtml(t("Tô đặc"))}</span>
      </label>
      <span class="photo-props-actions">
        <button class="tool-btn" data-action="photo-apply-crop" id="photo-apply-crop" hidden>
          ✂ ${escapeHtml(t("Cắt theo vùng chọn"))}
        </button>
        <button class="tool-btn" data-action="photo-delete-shape" id="photo-delete-shape" disabled>
          ${escapeHtml(t("Xoá hình đang chọn"))}
        </button>
        <button class="tool-btn" data-action="photo-clear-shapes" ${shapes ? "" : "disabled"}>
          ${escapeHtml(t("Xoá hết nét vẽ"))}
        </button>
      </span>
    </div>
  `;
}

function renderPhotoEditorStudio(series) {
  if (!series) return `<div class="empty-state"><b>${escapeHtml(t("Chưa có ảnh nào"))}</b></div>`;
  // Naming the edit in the markup is what makes undo work and what stops any
  // re-render from silently dropping back to the untouched file.
  const workName = workFileName(state.photoWorkingPath);
  const source = workName ? `work:${workName}` : `${series.id}:${mediaFileIndex(series)}`;
  const pending = pendingShapeCount(series);
  return `
    <div class="photo-editor-studio">
      <div class="photo-editor-toolbar">
        ${renderMediaFileNav(series)}
        ${renderEditHistoryNav(series)}
        <span class="photo-props-divider"></span>
        <button class="tool-btn" data-action="photo-rotate-ccw" title="${escapeHtml(t("Xoay trái 90°"))}">↺</button>
        <button class="tool-btn" data-action="photo-rotate-cw" title="${escapeHtml(t("Xoay phải 90°"))}">↻</button>
        <span class="photo-props-divider"></span>
        <button class="tool-btn" data-action="photo-zoom-out" title="${escapeHtml(t("Thu nhỏ"))}">−</button>
        <button class="tool-btn" data-action="photo-zoom-fit" id="photo-zoom-label"
          title="${escapeHtml(t("Vừa khung"))}">${state.photoZoom ? `${Math.round(state.photoZoom * 100)}%` : escapeHtml(t("Vừa khung"))}</button>
        <button class="tool-btn" data-action="photo-zoom-in" title="${escapeHtml(t("Phóng to"))}">+</button>
        <span style="flex:1;"></span>
        <button class="tool-btn primary" data-action="photo-apply-shapes" id="photo-apply-shapes"
          ${pending ? "" : "disabled"} title="${escapeHtml(t("Vẽ đè vĩnh viễn lên ảnh"))}">
          ${escapeHtml(t("Áp dụng lên ảnh"))}${pending ? ` (${pending})` : ""}
        </button>
        <button class="tool-btn" data-action="photo-save-edit" ${state.photoWorkingPath ? "" : "disabled"}>💾 ${escapeHtml(t("Lưu vào hồ sơ"))}</button>
        <button class="tool-btn" data-action="photo-export-image">⬇ ${escapeHtml(t("Tải ảnh về"))}</button>
        <button class="tool-btn" data-action="photo-export-pdf">📄 ${escapeHtml(t("Xuất file PDF"))}</button>
      </div>
      ${renderPhotoProperties(series)}
      <div class="photo-editor-body">
        ${renderPhotoToolRail()}
        <div class="photo-editor-stage" id="photo-editor-stage">
          <div class="photo-editor-canvas-wrap" id="photo-editor-canvas">
            <img id="photo-editor-img" class="photo-editor-image" data-media-src="${escapeHtml(source)}" alt="${escapeHtml(series.description || "")}">
            <canvas id="photo-annotation-canvas" class="photo-annotation-canvas"></canvas>
          </div>
        </div>
      </div>
      <div class="photo-editor-status">
        <span id="photo-status-hint">${escapeHtml(t(toolById(state.photoTool).label))}</span>
        <span style="flex:1;"></span>
        <span id="photo-status-size"></span>
        <span id="photo-status-count">${pending ? tf("{} nét chưa áp dụng", pending) : escapeHtml(t("Chưa vẽ gì"))}</span>
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

/**
 * One undo button over two stacks.
 *
 * A photo now has both a vector layer that has not been flattened yet and a
 * chain of files already written. Offering two separate undo controls would
 * make the reader guess which one owns their last action, so the pair drives
 * whichever stack actually holds it: the drawing first, because a shape drawn a
 * second ago is always more recent than the file written before it.
 */
function canUndoPhotoStep(series) {
  return canUndoLayer(photoLayer(series)) || canUndoMediaEdit(series);
}

function canRedoPhotoStep(series) {
  return canRedoLayer(photoLayer(series)) || canRedoMediaEdit(series);
}

function isPhotoStudio(series) {
  return ["photo", "doc"].includes(getSeriesMediaType(series));
}

/** Every studio that mounts the drawing layer: photos, documents and video. */
function isDrawStudio(series) {
  return isPhotoStudio(series) || getSeriesMediaType(series) === "video";
}

/** Keep the two arrows in step with the history without a full re-render. */
function syncEditHistoryButtons(series) {
  const root = getDomRoot();
  if (!root) return;
  const photo = isDrawStudio(series);
  const undo = root.querySelector("[data-action='media-edit-undo']");
  const redo = root.querySelector("[data-action='media-edit-redo']");
  if (undo) undo.disabled = !(photo ? canUndoPhotoStep(series) : canUndoMediaEdit(series));
  if (redo) redo.disabled = !(photo ? canRedoPhotoStep(series) : canRedoMediaEdit(series));
  const save = root.querySelector("[data-action='photo-save-edit']");
  if (save) save.disabled = !state.photoWorkingPath;
}

/**
 * Step back one action in the photo studio, whichever stack holds it.
 *
 * Returns false when nothing was undone, so the caller can fall through to the
 * file chain.
 */
function undoPhotoStep(series, delta) {
  const layer = photoLayer(series);
  const moved = delta < 0 ? undoLayer(layer) : redoLayer(layer);
  if (!moved) return false;
  currentSurface()?.select(null);
  currentSurface()?.repaint();
  syncPhotoStudioUI();
  setStatus(t(delta < 0 ? "Đã hoàn tác nét vẽ." : "Đã vẽ lại nét vừa hoàn tác."));
  return true;
}

/** The undo/redo pair both studios share. */
function renderEditHistoryNav(series) {
  const photo = isDrawStudio(series);
  const undoable = photo ? canUndoPhotoStep(series) : canUndoMediaEdit(series);
  const redoable = photo ? canRedoPhotoStep(series) : canRedoMediaEdit(series);
  return `
    <button class="tool-btn" data-action="media-edit-undo" ${undoable ? "" : "disabled"}
      title="${escapeHtml(t("Hoàn tác bước chỉnh sửa"))} (Ctrl+Z)">↶</button>
    <button class="tool-btn" data-action="media-edit-redo" ${redoable ? "" : "disabled"}
      title="${escapeHtml(t("Làm lại bước vừa hoàn tác"))} (Ctrl+Y)">↷</button>
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
 * The record's exam history: one row per examination, newest first.
 *
 * Modelled on the "Lịch sử khám" list a reader already works with in the
 * hospital PACS — each row is the modality and the date and nothing else. An
 * MRI is one row however many sequences it holds; those stay in the viewer's
 * series selector and filmstrip. A series whose date was never recorded lands
 * at the end rather than being stamped with today.
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
  const rows = [...days.entries()]
    .sort((a, b) => {
      // The undated bucket sorts last whichever side it appears on.
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return b[0].localeCompare(a[0]);
    })
    .flatMap(([dateKey, groups]) => [...groups.values()].map((group) => {
      const first = group.series[0] || {};
      const modality = String(first.modality || "").trim().toUpperCase();
      // What kind of examination this was, in the reader's own shorthand: the
      // DICOM modality where there is one, the media kind otherwise.
      const badge = group.kind === "dicom" && modality && modality !== "UNKNOWN"
        ? modality
        : t(MEDIA_KIND_LABELS[group.kind] || "Phim chụp");
      const dateLabel = dateKey
        ? `${dateKey.slice(6, 8)}/${dateKey.slice(4, 6)}/${dateKey.slice(0, 4)}`
        : t("Chưa rõ ngày chụp");
      // The exam's own name is not on the row — it is what tells two exams of
      // the same kind on one day apart, and the hover text.
      const examName = String(first.studyDescription || first.description || first.name || "").trim();
      const primary = [...group.series].sort((left, right) => (
        Number(Boolean(right.mprReady)) - Number(Boolean(left.mprReady))
        || Number(right.sliceCount || 0) - Number(left.sliceCount || 0)
      ))[0];
      // Photos and paperwork often carry no date. "Ảnh - Chưa rõ ngày chụp"
      // says nothing and repeats across folders, so those rows take the
      // folder's own name instead.
      const suffix = dateKey ? dateLabel : (examName || dateLabel);
      return {
        ...group,
        dateKey,
        dateLabel,
        badge,
        examName,
        defaultTitle: `${badge} - ${suffix}`,
        primaryId: primary?.id || "",
        memberIds: group.series.map((item) => item.id),
      };
    }));

  // Two exams of the same kind on one day would read identically, so those —
  // and only those — carry their name as well.
  const seen = new Map();
  for (const row of rows) seen.set(row.defaultTitle, (seen.get(row.defaultTitle) || 0) + 1);
  for (const row of rows) {
    if (seen.get(row.defaultTitle) > 1 && row.examName) {
      row.defaultTitle = `${row.badge} - ${row.dateLabel} · ${row.examName}`;
    }
    row.title = String(timelineLabels?.[row.key] || "").trim() || row.defaultTitle;
  }
  return rows;
}

function patientInfoDraft(patient = {}) {
  return {
    patientName: patient.patientName || "",
    patientId: patient.patientId || "",
    gender: patient.gender || "",
    birthYear: patient.birthYear || "",
    phone: patient.phone || "",
    address: patient.address || "",
    hospital: patient.hospital || "",
    diagnosis: patient.diagnosis || "",
  };
}

function patientInfoFromForm(form) {
  if (!form) return null;
  const formData = new FormData(form);
  return {
    patientName: formData.get("patientName") || "",
    patientId: formData.get("patientId") || "",
    gender: formData.get("gender") || "",
    birthYear: formData.get("birthYear") || "",
    phone: formData.get("phone") || "",
    address: formData.get("address") || "",
    hospital: formData.get("hospital") || "",
    diagnosis: formData.get("diagnosis") || "",
  };
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
  const editPatient = state.patientEditDraft || patientInfoDraft(patient);
  const series = state.archive?.series || [];
  const dash = (value) => (String(value || "").trim() || "—");

  const identity = [patient.gender, patient.birthYear, patient.age ? tf("{} tuổi", patient.age) : ""]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");

  const timeline = buildMediaTimeline(series, patient.timelineLabels || {});

  const renderInfoCard = () => {
    if (state.editingPatientInfo) {
      return `
        <div class="rec-card rec-info-card editing">
          <div class="rec-card-header">
            <b>${escapeHtml(t("Sửa thông tin bệnh nhân"))}</b>
            <div class="rec-card-actions">
              <button class="mini-btn primary" type="button" data-action="save-patient-info" title="${escapeHtml(t("Lưu thay đổi"))}">✓</button>
              <button class="mini-btn" type="button" data-action="cancel-patient-info" title="${escapeHtml(t("Hủy"))}">✕</button>
            </div>
          </div>
          <form class="rec-edit-form" data-field="patient-edit-form" onsubmit="event.preventDefault();">
            <label class="rec-form-field">
              <span>${escapeHtml(t("Họ và tên"))}</span>
              <input name="patientName" maxlength="128" value="${escapeHtml(editPatient.patientName)}" placeholder="${escapeHtml(t("Nhập họ tên"))}">
            </label>
            <label class="rec-form-field">
              <span>${escapeHtml(t("Mã bệnh nhân"))}</span>
              <input name="patientId" maxlength="128" required value="${escapeHtml(editPatient.patientId)}" placeholder="${escapeHtml(t("Nhập mã BN"))}">
            </label>
            <div class="rec-form-row">
              <label class="rec-form-field" style="flex:1;">
                <span>${escapeHtml(t("Giới tính"))}</span>
                <select name="gender">
                  <option value="" ${!editPatient.gender ? "selected" : ""}>—</option>
                  <option value="Nam" ${editPatient.gender === "Nam" ? "selected" : ""}>${escapeHtml(t("Nam"))}</option>
                  <option value="Nữ" ${editPatient.gender === "Nữ" ? "selected" : ""}>${escapeHtml(t("Nữ"))}</option>
                  <option value="Khác" ${editPatient.gender && editPatient.gender !== "Nam" && editPatient.gender !== "Nữ" ? "selected" : ""}>${escapeHtml(t("Khác"))}</option>
                </select>
              </label>
              <label class="rec-form-field" style="flex:1;">
                <span>${escapeHtml(t("Năm sinh"))}</span>
                <input name="birthYear" type="number" min="1900" max="${new Date().getFullYear()}" value="${escapeHtml(editPatient.birthYear)}" placeholder="YYYY">
              </label>
            </div>
            <label class="rec-form-field">
              <span>${escapeHtml(t("Số điện thoại"))}</span>
              <input name="phone" type="tel" value="${escapeHtml(editPatient.phone)}" placeholder="${escapeHtml(t("Nhập SĐT"))}">
            </label>
            <label class="rec-form-field">
              <span>${escapeHtml(t("Địa chỉ"))}</span>
              <input name="address" value="${escapeHtml(editPatient.address)}" placeholder="${escapeHtml(t("Nhập địa chỉ"))}">
            </label>
            <label class="rec-form-field">
              <span>${escapeHtml(t("Bệnh viện"))}</span>
              <input name="hospital" value="${escapeHtml(editPatient.hospital)}" placeholder="${escapeHtml(t("Tên bệnh viện"))}">
            </label>
            <label class="rec-form-field">
              <span>${escapeHtml(t("Chẩn đoán"))}</span>
              <textarea name="diagnosis" rows="2" placeholder="${escapeHtml(t("Chẩn đoán / Ghi chú"))}">${escapeHtml(editPatient.diagnosis)}</textarea>
            </label>
          </form>
        </div>
      `;
    }

    return `
      <div class="rec-card rec-info-card">
        <div class="rec-id">
          <div class="rec-name-row">
            <b>${escapeHtml(dash(patient.patientName) === "—"
              ? t("Chưa có tên bệnh nhân")
              : patient.patientName)}</b>
            <button class="rec-edit-btn" type="button" data-action="edit-patient-info"
              title="${escapeHtml(t("Chỉnh sửa thông tin bệnh nhân"))}">✎</button>
          </div>
          <small>${escapeHtml(dash(patient.patientId))}${identity ? ` · ${escapeHtml(identity)}` : ""}</small>
        </div>
        <dl class="rec-facts">
          <div class="rfact"><dt>${escapeHtml(t("Mã BN"))}</dt><dd>${escapeHtml(dash(patient.patientId))}</dd></div>
          <div class="rfact"><dt>${escapeHtml(t("Giới tính"))}</dt><dd>${escapeHtml(dash(patient.gender))}</dd></div>
          <div class="rfact"><dt>${escapeHtml(t("Năm sinh"))}</dt><dd>${escapeHtml(dash(patient.birthYear))}${patient.age ? ` (${tf("{} tuổi", patient.age)})` : ""}</dd></div>
          <div class="rfact"><dt>${escapeHtml(t("Điện thoại"))}</dt><dd>${escapeHtml(dash(patient.phone))}</dd></div>
          <div class="rfact"><dt>${escapeHtml(t("Địa chỉ"))}</dt><dd>${escapeHtml(dash(patient.address))}</dd></div>
          <div class="rfact"><dt>${escapeHtml(t("Bệnh viện"))}</dt><dd>${escapeHtml(dash(patient.hospital))}</dd></div>
          <div class="rfact">
            <dt>${escapeHtml(t("Chẩn đoán"))}</dt>
            <dd><button class="rfact-edit" type="button" data-action="edit-diagnosis"
              title="${escapeHtml(t("Ghi chẩn đoán cho hồ sơ này"))}">${escapeHtml(dash(patient.diagnosis))}</button></dd>
          </div>
        </dl>
      </div>
    `;
  };

  return `
    <aside class="rec-rail">
      ${renderInfoCard()}

      <div class="rec-timeline-head"><b>${escapeHtml(t("Lịch sử khám"))}</b></div>
      <div class="tl">
        ${timeline.length === 0
          ? `<div class="tl-empty">${escapeHtml(t("Chưa có dữ liệu nào trong hồ sơ này."))}</div>`
          : timeline.map((row) => {
            const active = row.memberIds.includes(state.selectedId);
            return `
              <div class="tl-item ${row.kind}${active ? " on" : ""}"
                data-timeline-key="${escapeHtml(row.key)}"
                data-timeline-members="${escapeHtml(row.memberIds.join(","))}"
                data-timeline-label="${escapeHtml(row.title)}"
                data-default-label="${escapeHtml(row.defaultTitle)}"
                title="${escapeHtml(row.examName ? `${row.title} · ${row.examName}` : row.title)}">
                <div class="tl-row">
                  <button class="tl-open" type="button" data-series-id="${escapeHtml(row.primaryId)}">
                    <div class="tl-card-header">
                      <span class="tl-badge-pill">${escapeHtml(row.badge)}</span>
                      <span class="tl-date-text">${escapeHtml(row.dateLabel)}</span>
                    </div>
                    <div class="tl-card-body">
                      <span class="nm">${escapeHtml(row.title !== row.defaultTitle ? row.title : (row.examName || row.title))}</span>
                    </div>
                  </button>
                  <input class="tl-name-input" value="${escapeHtml(row.title)}"
                    maxlength="120" aria-label="${escapeHtml(t("Tên hiển thị trên timeline"))}">
                  <button class="tl-edit" type="button" data-action="edit-timeline-label"
                    title="${escapeHtml(t("Đổi tên lần chụp hoặc loại media"))}" aria-label="${escapeHtml(t("Đổi tên lần chụp hoặc loại media"))}">✎</button>
                  <button class="tl-edit-save" type="button" data-action="save-timeline-label"
                    title="${escapeHtml(t("Lưu tên"))}" aria-label="${escapeHtml(t("Lưu tên"))}">✓</button>
                  <button class="tl-edit-cancel" type="button" data-action="cancel-timeline-label"
                    title="${escapeHtml(t("Bỏ thay đổi tên"))}" aria-label="${escapeHtml(t("Bỏ thay đổi tên"))}">×</button>
                </div>
              </div>
            `;
          }).join("")}
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

/** The patient tree from the disk scan — history belongs to Activity only. */
function getEffectiveWorklistPatients() {
  return Array.isArray(state.worklistPatients) ? state.worklistPatients : [];
}

/**
 * Pull the patient tree the backend built from disk and `patient-index.json`.
 *
 * Kept separate from `refreshHistory` because the scan walks every study
 * folder: it runs when something on disk may have changed, not on every poll.
 */
async function refreshWorklist({ repaint = true } = {}) {
  if (state.worklistLoading) return;
  state.worklistLoading = true;
  state.worklistError = "";
  if (repaint) refreshStudyListPanel();
  try {
    const result = await api("/api/worklist");
    state.worklistPatients = Array.isArray(result?.patients) ? result.patients : [];
    state.worklistLoaded = true;
  } catch (error) {
    // A failed scan leaves the previous list in place; blanking the tree the
    // doctor is reading would be worse than showing a slightly stale one.
    state.worklistError = humanError(error);
  } finally {
    state.worklistLoading = false;
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

  const filters = root.querySelector(".worklist-filter-bar.secondary");
  if (filters) {
    filters.outerHTML = renderWorklistFilters();
    bindWorklistFilters(root);
  }

  const summary = root.querySelector(".worklist-summary");
  if (summary) summary.innerHTML = renderWorklistSummaryInner();

  const count = root.querySelector(".worklist-tab[data-worklist-tab='studies'] .worklist-tab-count");
  if (count) count.textContent = String(filteredPatientList().length);

  const syncState = root.querySelector(".worklist-sync-state");
  if (syncState) {
    syncState.textContent = state.worklistLoading
      ? t("Đang tải danh sách bệnh nhân…")
      : state.worklistError
        ? t("Không đồng bộ được danh sách")
        : t("Danh sách đã cập nhật");
    syncState.classList.toggle("error", Boolean(state.worklistError));
  }
  const refreshButton = root.querySelector("[data-action='refresh-worklist']");
  if (refreshButton) refreshButton.disabled = state.worklistLoading;
}

function parseStudyDateToTime(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return 0;
  const clean = dateStr.trim();
  const ddmmyyyy = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (ddmmyyyy) {
    const d = Number(ddmmyyyy[1]);
    const m = Number(ddmmyyyy[2]);
    let y = Number(ddmmyyyy[3]);
    if (y < 100) y += 2000;
    return new Date(y, m - 1, d).getTime() || 0;
  }
  const yyyymmdd = clean.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (yyyymmdd) {
    const y = Number(yyyymmdd[1]);
    const m = Number(yyyymmdd[2]);
    const d = Number(yyyymmdd[3]);
    return new Date(y, m - 1, d).getTime() || 0;
  }
  const parsed = Date.parse(clean);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function patientLatestStudyDate(patient) {
  const studies = patient.studies || [];
  let latest = 0;
  for (const s of studies) {
    const t = parseStudyDateToTime(s.studyDate);
    if (t > latest) latest = t;
  }
  return latest;
}

function patientLatestStudyDateString(patient) {
  const studies = patient.studies || [];
  if (!studies.length) return "—";
  let latestTime = 0;
  let latestStr = "";
  for (const s of studies) {
    const t = parseStudyDateToTime(s.studyDate);
    if (t >= latestTime && s.studyDate) {
      latestTime = t;
      latestStr = s.studyDate;
    }
  }
  return latestStr || studies[0]?.studyDate || "—";
}

/** Patients matching the search box, sorted by the active sort column. */
/** Oldest study date still inside the selected period, or null for "all". */
function worklistPeriodCutoff() {
  const days = { today: 0, week: 6, month: 29 }[state.worklistPeriod];
  if (days === undefined) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start.getTime();
}

/**
 * Whether one study survives the modality, period and read filters.
 *
 * A study whose date the scan could not establish is kept whatever the period
 * is: hiding it would quietly drop a record from the list the reader is
 * working through, and "chưa rõ ngày" is not the same as "outside the range".
 */
export function studyMatchesWorklistFilters(study) {
  const modality = (state.worklistModality || "").trim().toUpperCase();
  if (modality && String(study.modality || "").trim().toUpperCase() !== modality) return false;

  if (state.worklistRead === "unread" && study.isRead) return false;
  if (state.worklistRead === "read" && !study.isRead) return false;

  const cutoff = worklistPeriodCutoff();
  if (cutoff !== null) {
    const taken = parseStudyDateToTime(study.studyDate);
    if (Number.isFinite(taken) && taken > 0 && taken < cutoff) return false;
  }
  return true;
}

/** True when any study filter is narrowing the list. */
export function worklistFiltersActive() {
  return Boolean(
    (state.worklistModality || "").trim()
    || (state.worklistPeriod && state.worklistPeriod !== "all")
    || (state.worklistRead && state.worklistRead !== "all"),
  );
}

function filteredPatientList() {
  const search = (state.worklistSearch || "").toLowerCase().trim();
  let patients = getEffectiveWorklistPatients();
  if (worklistFiltersActive()) {
    patients = patients
      .map((p) => ({ ...p, studies: (p.studies || []).filter(studyMatchesWorklistFilters) }))
      .filter((p) => p.studies.length > 0);
  }
  if (search) {
    patients = patients.filter((p) => {
      const pText = `${p.patientId || ""} ${p.patientName || ""} ${p.hospital || ""} ${p.gender || ""} ${p.birthYear || ""}`.toLowerCase();
      if (pText.includes(search)) return true;
      return (p.studies || []).some((s) => {
        const sText = `${s.studyDate || ""} ${s.studyName || ""} ${s.modality || ""} ${s.folder || ""}`.toLowerCase();
        return sText.includes(search);
      });
    });
  }

  const sortCol = state.worklistSortColumn;
  const sortOrder = state.worklistSortOrder || "asc";
  if (!sortCol) return patients;

  return [...patients].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "name") {
      const nameA = String(a.patientName || a.patientId || "").trim();
      const nameB = String(b.patientName || b.patientId || "").trim();
      cmp = nameA.localeCompare(nameB, "vi", { sensitivity: "base", numeric: true });
    } else if (sortCol === "id") {
      const idA = String(a.patientId || "").trim();
      const idB = String(b.patientId || "").trim();
      cmp = idA.localeCompare(idB, undefined, { numeric: true, sensitivity: "base" });
    } else if (sortCol === "date") {
      const dateA = patientLatestStudyDate(a);
      const dateB = patientLatestStudyDate(b);
      cmp = dateA - dateB;
    }
    return sortOrder === "desc" ? -cmp : cmp;
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
function patientDemographicsLine(patient) {
  const parts = [
    patient.gender,
    patient.birthYear ? (String(patient.birthYear).toLowerCase().includes("t") ? patient.birthYear : `${patient.birthYear}`) : "",
    patient.hospital
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : "";
}

function patientIdentityLine(patient) {
  const parts = [patient.patientName, patient.gender, patient.birthYear, patient.hospital]
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

function studyFormatBadge(study) {
  const media = study.primaryMediaType || (study.mediaCounts?.dicom > 0 ? "dicom" : "photo");
  if (media === "dicom" || study.mediaCounts?.dicom > 0) {
    return `<span class="fmt-badge dicom" title="${escapeHtml(t("File DICOM gốc (.dcm)"))}">DICOM</span>`;
  }
  if (media === "photo" || study.mediaCounts?.photo > 0) {
    return `<span class="fmt-badge jpg" title="${escapeHtml(t("Ảnh JPG đã giải nén"))}">JPG</span>`;
  }
  if (media === "video" || study.mediaCounts?.video > 0) {
    return `<span class="fmt-badge video" title="${escapeHtml(t("Video"))}">VIDEO</span>`;
  }
  if (media === "doc" || study.mediaCounts?.doc > 0) {
    return `<span class="fmt-badge doc" title="${escapeHtml(t("Bệnh án / Văn bản"))}">BỆNH ÁN</span>`;
  }
  return `<span class="fmt-badge jpg">JPG</span>`;
}

function patientFormatBadges(patient) {
  const summary = patient.mediaSummary || {};
  const tags = [];
  if (summary.dicom > 0) tags.push(`<span class="fmt-badge dicom">DICOM</span>`);
  if (summary.photo > 0) tags.push(`<span class="fmt-badge jpg">JPG</span>`);
  if (summary.video > 0) tags.push(`<span class="fmt-badge video">VIDEO</span>`);
  if (summary.doc > 0) tags.push(`<span class="fmt-badge doc">DOC</span>`);
  if (tags.length === 0) {
    const hasDicom = (patient.studies || []).some((s) => s.primaryMediaType === "dicom" || s.mediaCounts?.dicom > 0);
    tags.push(hasDicom ? `<span class="fmt-badge dicom">DICOM</span>` : `<span class="fmt-badge jpg">JPG</span>`);
  }
  return tags.join(" ");
}

/**
 * Inner HTML of `.worklist-tree`, rendering the multi-level patient study tree.
 */
function renderWorklistTreeInner() {
  const patients = filteredPatientList();
  if (state.worklistLoading && !state.worklistLoaded && patients.length === 0) {
    return `<div class="worklist-loading" role="status"><i></i><span>${escapeHtml(t("Đang tải danh sách bệnh nhân…"))}</span></div>`;
  }
  if (patients.length === 0) {
    if (state.worklistError) {
      return `<div class="empty-state error">
        <b>${escapeHtml(t("Không tải được danh sách bệnh nhân"))}</b>
        <span>${escapeHtml(state.worklistError)}</span>
        <button class="primary" data-action="refresh-worklist">${escapeHtml(t("Thử quét lại"))}</button>
      </div>`;
    }
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
    ${state.worklistError ? `<div class="worklist-scan-alert" role="status">
      <span>${escapeHtml(t("Đang hiển thị dữ liệu lần quét trước."))} ${escapeHtml(state.worklistError)}</span>
      <button class="soft-button" data-action="refresh-worklist">${escapeHtml(t("Thử quét lại"))}</button>
    </div>` : ""}
    <div class="plist-header">
      <span class="col-stt">${escapeHtml(t("STT"))}</span>
      <button class="col-sort-btn col-who ${state.worklistSortColumn === "name" ? "sorted " + state.worklistSortOrder : ""}" type="button" data-action="sort-worklist" data-sort-col="name" title="${escapeHtml(t("Sắp xếp theo Họ và tên"))}">
        <span>${escapeHtml(t("Họ và tên"))}</span>
        <i class="sort-icon">${state.worklistSortColumn === "name" ? (state.worklistSortOrder === "desc" ? "▼" : "▲") : "↕"}</i>
      </button>
      <button class="col-sort-btn col-pid ${state.worklistSortColumn === "id" ? "sorted " + state.worklistSortOrder : ""}" type="button" data-action="sort-worklist" data-sort-col="id" title="${escapeHtml(t("Sắp xếp theo Mã BN"))}">
        <span>${escapeHtml(t("Mã BN"))}</span>
        <i class="sort-icon">${state.worklistSortColumn === "id" ? (state.worklistSortOrder === "desc" ? "▼" : "▲") : "↕"}</i>
      </button>
      <button class="col-sort-btn col-date ${state.worklistSortColumn === "date" ? "sorted " + state.worklistSortOrder : ""}" type="button" data-action="sort-worklist" data-sort-col="date" title="${escapeHtml(t("Sắp xếp theo Ngày chụp"))}">
        <span>${escapeHtml(t("Ngày chụp"))}</span>
        <i class="sort-icon">${state.worklistSortColumn === "date" ? (state.worklistSortOrder === "desc" ? "▼" : "▲") : "↕"}</i>
      </button>
      <span class="col-format">${escapeHtml(t("Định dạng"))}</span>
      <span class="col-status">${escapeHtml(t("Trạng thái"))}</span>
      <span class="col-acts">${escapeHtml(t("Action"))}</span>
    </div>
    <div class="plist">
      ${patients.map((p, pIdx) => {
        const isExpanded = state.expandedPatients[p.id] !== false;
        const rawStudies = p.studies || [];
        const studyCount = rawStudies.length;
        const demoLine = patientDemographicsLine(p);
        const studies = rawStudies.slice().sort((s1, s2) => {
          if (state.worklistSortColumn === "date") {
            const d1 = parseStudyDateToTime(s1.studyDate);
            const d2 = parseStudyDateToTime(s2.studyDate);
            return state.worklistSortOrder === "desc" ? d2 - d1 : d1 - d2;
          }
          return 0;
        });
        const patientName = p.patientName || p.patientId || t("Chưa rõ tên BN");
        const patientId = p.patientId || "";
        const studyDate = patientLatestStudyDateString(p);
        return `
          <div class="prow" role="button" tabindex="0" aria-expanded="${isExpanded}" data-toggle-patient="${escapeHtml(p.id)}">
            <span class="stt-cell"><i class="twist">▶</i><span class="stt-num">${pIdx + 1}</span></span>
            <span class="who copyable-cell" title="${escapeHtml(patientName)}">
              <span class="who-main">
                <b>${escapeHtml(patientName)}</b>
                ${(p.patientName || p.patientId) ? `
                  <button class="cell-copy-btn" type="button" data-action="copy-cell"
                    data-copy-text="${escapeHtml(p.patientName || p.patientId)}"
                    title="${escapeHtml(t("Sao chép tên bệnh nhân"))}">${icons.copy}</button>
                ` : ""}
              </span>
              ${demoLine ? `<small>${escapeHtml(demoLine)}</small>` : ""}
            </span>
            <span class="meta pid-col copyable-cell" title="${escapeHtml(patientId || "—")}">
              <b>${escapeHtml(patientId || "—")}</b>
              ${patientId ? `
                <button class="cell-copy-btn" type="button" data-action="copy-cell"
                  data-copy-text="${escapeHtml(patientId)}"
                  title="${escapeHtml(t("Sao chép mã BN"))}">${icons.copy}</button>
              ` : ""}
            </span>
            <span class="meta date-col copyable-cell" title="${escapeHtml(studyDate)}">
              <span>${escapeHtml(studyDate)}</span>
              ${studyDate && studyDate !== "—" ? `
                <button class="cell-copy-btn" type="button" data-action="copy-cell"
                  data-copy-text="${escapeHtml(studyDate)}"
                  title="${escapeHtml(t("Sao chép ngày chụp"))}">${icons.copy}</button>
              ` : ""}
            </span>
            <span class="meta format-col">${patientFormatBadges(p)}</span>
            <span class="meta status-col count">${escapeHtml(tf("{} đợt khám", studyCount))}</span>
            <span class="rowacts">
              <button class="soft-button" type="button" data-action="open-patient-record" data-patient-id="${escapeHtml(p.id)}">
                ${escapeHtml(t("Mở hồ sơ"))}
              </button>
              <button class="soft-button" type="button" data-action="export-patient-record"
                data-folder="${escapeHtml(p.folder || "")}"
                title="${escapeHtml(t("Xuất ảnh JPG kèm trang index.html để bệnh nhân mở bằng trình duyệt"))}">
                ${escapeHtml(t("Xuất hồ sơ"))}
              </button>
            </span>
          </div>

          <div class="studies${isExpanded ? " on" : ""}" data-studies="${escapeHtml(p.id)}">
            ${studies.map((s, sIdx) => {
              const studyHead = studyHeadingLine(s);
              const studyDt = s.studyDate || "—";
              return `
                <div class="srow${s.isRead ? " read" : " unread"}">
                  <span class="stt-cell"><span class="rail"></span><span class="stt-subnum">${pIdx + 1}.${sIdx + 1}</span></span>
                  <span class="who copyable-cell" title="${escapeHtml(studyHead)}">
                    <span class="who-main">
                      <b>${escapeHtml(studyHead)}</b>
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${escapeHtml(studyHead)}"
                        title="${escapeHtml(t("Sao chép tên ca chụp"))}">${icons.copy}</button>
                    </span>
                    <small>${escapeHtml(studyCountLine(s))}</small>
                  </span>
                  <span class="meta pid-col sub copyable-cell" title="${escapeHtml(p.patientId || "—")}">
                    <span>—</span>
                    ${p.patientId ? `
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${escapeHtml(p.patientId)}"
                        title="${escapeHtml(t("Sao chép mã BN"))}">${icons.copy}</button>
                    ` : ""}
                  </span>
                  <span class="meta date-col copyable-cell" title="${escapeHtml(studyDt)}">
                    <span>${escapeHtml(studyDt)}</span>
                    ${s.studyDate && s.studyDate !== "—" ? `
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${escapeHtml(s.studyDate)}"
                        title="${escapeHtml(t("Sao chép ngày chụp"))}">${icons.copy}</button>
                    ` : ""}
                  </span>
                  <span class="meta format-col">${studyFormatBadge(s)}</span>
                  <span class="badge status-col ${s.status || "done"}">${escapeHtml(t(s.statusLabel || "Đã tải"))}</span>
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
                    <button class="soft-button read-toggle${s.isRead ? " on" : ""}" type="button"
                      data-action="toggle-study-read"
                      data-folder="${escapeHtml(s.folder || "")}"
                      data-read="${s.isRead ? "1" : "0"}"
                      title="${escapeHtml(s.isRead ? t("Bỏ đánh dấu đã đọc") : t("Đánh dấu đã đọc"))}">
                      ${s.isRead ? "✓" : "○"}
                    </button>
                  </span>
                </div>
              `;
            }).join("")}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

/**
 * Actions the worklist tree wires up itself.
 *
 * `bindEvents` sweeps every `[data-action]` in the shell, and this binder runs
 * over the same nodes afterwards. Without this list both listeners fired for
 * one click, which made the first sort click after a full render toggle the
 * order twice and appear to do nothing.
 */
const WORKLIST_OWNED_ACTIONS = new Set([
  "sort-worklist",
  "copy-cell",
  "open-study-viewer",
  "open-patient-record",
  "reveal-study-folder",
  "open-worklist-item",
  "resume-study-download",
  "toggle-study-read",
  "clear-worklist-filters",
  "export-patient-record",
]);

/** Wire the study filter selects and the "Bỏ lọc" button inside `host`. */
function bindWorklistFilters(host) {
  if (!host) return;
  [
    ["worklist-modality", "worklistModality"],
    ["worklist-period", "worklistPeriod"],
    ["worklist-read", "worklistRead"],
  ].forEach(([field, key]) => {
    host.querySelector(`[data-field='${field}']`)?.addEventListener("change", (event) => {
      state[key] = event.target.value;
      refreshStudyListPanel();
    });
  });
  host.querySelector("[data-action='clear-worklist-filters']")?.addEventListener("click", () => {
    action("clear-worklist-filters", null);
  });
}

/** Attach tree accordion and button listeners to worklist markup. */
function bindWorklistOpenButtons(host) {
  if (!host) return;

  host.querySelectorAll("[data-action='sort-worklist']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action("sort-worklist", btn);
    });
  });

  host.querySelectorAll("[data-action='copy-cell']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action("copy-cell", btn);
    });
  });

  host.querySelectorAll(".copyable-cell").forEach((cell) => {
    cell.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      e.stopPropagation();
      const copyBtn = cell.querySelector(".cell-copy-btn");
      const text = copyBtn?.dataset?.copyText || cell.querySelector("b, span")?.textContent?.trim();
      if (text && text !== "—") {
        copyTextToClipboard(text, `${t("Đã sao chép")}: ${text.length > 25 ? text.slice(0, 22) + "..." : text}`);
      }
    });
  });

  host.querySelectorAll("[data-toggle-patient]").forEach((prow) => {
    prow.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, .cell-copy-btn")) return;
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;
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

  host.querySelectorAll("[data-action='export-patient-record']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action("export-patient-record", btn);
    });
  });

  host.querySelectorAll("[data-action='toggle-study-read']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action("toggle-study-read", btn);
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

/**
 * Modality labels present in the archive, so the filter offers only real ones.
 *
 * The scanner writes a DICOM code ("MR", "CT") when the tags carry one and a
 * Vietnamese label ("X-Quang", "Bệnh án") when it had only the folder to go on.
 * Both are shown as the scanner wrote them and matched case-insensitively.
 */
function worklistModalityOptions() {
  const byKey = new Map();
  getEffectiveWorklistPatients().forEach((patient) => {
    (patient.studies || []).forEach((study) => {
      const label = String(study.modality || "").trim();
      if (label && !byKey.has(label.toUpperCase())) byKey.set(label.toUpperCase(), label);
    });
  });
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "vi"));
}

/**
 * The study filter row: modality, how recent, and what is still unread.
 *
 * Built from what the archive actually contains rather than a fixed list of
 * modality codes, so the row never offers a filter that would empty the list.
 */
export function renderWorklistFilters() {
  const modalities = worklistModalityOptions();
  const unread = getEffectiveWorklistPatients()
    .reduce((total, patient) => total + (patient.studies || []).filter((s) => !s.isRead).length, 0);
  const periods = [
    ["all", t("Mọi thời điểm")],
    ["today", t("Hôm nay")],
    ["week", t("7 ngày")],
    ["month", t("30 ngày")],
  ];
  const readStates = [
    ["all", t("Tất cả")],
    ["unread", t("Chưa đọc")],
    ["read", t("Đã đọc")],
  ];
  const option = ([value, label], current) =>
    `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`;

  return `
    <div class="worklist-filter-bar secondary">
      <label class="worklist-filter">
        <span>${escapeHtml(t("Loại chụp"))}</span>
        <select data-field="worklist-modality">
          <option value=""${state.worklistModality ? "" : " selected"}>${escapeHtml(t("Tất cả"))}</option>
          ${modalities.map((code) => option([code, code], state.worklistModality)).join("")}
        </select>
      </label>
      <label class="worklist-filter">
        <span>${escapeHtml(t("Ngày chụp"))}</span>
        <select data-field="worklist-period">
          ${periods.map((item) => option(item, state.worklistPeriod)).join("")}
        </select>
      </label>
      <label class="worklist-filter">
        <span>${escapeHtml(t("Trạng thái đọc"))}</span>
        <select data-field="worklist-read">
          ${readStates.map((item) => option(item, state.worklistRead)).join("")}
        </select>
      </label>
      <span class="worklist-unread-count">${escapeHtml(tf("{} ca chưa đọc", unread))}</span>
      ${worklistFiltersActive() ? `<button class="soft-button" type="button" data-action="clear-worklist-filters">${escapeHtml(t("Bỏ lọc"))}</button>` : ""}
    </div>
  `;
}

function renderStudyListPanel() {
  return `
    <div class="worklist-filter-bar filters">
      <input type="search" data-field="worklist-search" placeholder="${escapeHtml(t("Tìm theo tên hoặc mã bệnh nhân, đợt khám…"))}" value="${escapeHtml(state.worklistSearch || "")}">
      <span class="worklist-sync-state${state.worklistError ? " error" : ""}" role="status">${escapeHtml(
    state.worklistLoading
      ? t("Đang tải danh sách bệnh nhân…")
      : state.worklistError
        ? t("Không đồng bộ được danh sách")
        : t("Danh sách đã cập nhật"),
  )}</span>
      <button class="soft-button" data-action="refresh-worklist" ${state.worklistLoading ? "disabled" : ""}>${escapeHtml(t("Quét lại"))}</button>
    </div>

    ${renderWorklistFilters()}

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
  "export": "Xuất hồ sơ cho bệnh nhân",
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
  const history = state.history || [];
  const sourceFolders = state.sourceFolders?.length
    ? state.sourceFolders
    : (state.bootstrap?.sourceFolders || (state.bootstrap?.outputRoot ? [{ folder: state.bootstrap.outputRoot, exists: true, isDefault: true }] : []));

  return `
    <div class="activity-head">${escapeHtml(t("Tổng quan kho & dữ liệu"))}</div>
    <div class="activity-summary">
      ${renderWorklistSummaryInner()}
    </div>

    <div class="activity-head-row">
      <div class="activity-head">${escapeHtml(t("Thư mục nguồn bệnh nhân"))}</div>
      <button class="mini-btn primary source-add-btn" type="button" data-action="add-source-folder" title="${escapeHtml(t("Thêm thư mục nguồn"))}">
        ➕ ${escapeHtml(t("Thêm thư mục"))}
      </button>
    </div>
    <div class="activity-source-folders">
      ${sourceFolders.length === 0 ? `
        <div class="activity-idle">${escapeHtml(t("Chưa có thư mục nguồn nào được cấu hình."))}</div>
      ` : sourceFolders.map((item) => `
        <div class="activity-folder-row ${item.exists ? "" : "missing"}">
          <span class="folder-icon">📁</span>
          <span class="folder-path" title="${escapeHtml(item.folder || "")}">
            ${escapeHtml(item.folder || "")}
            ${item.isDefault ? `<span class="folder-badge default">${escapeHtml(t("Mặc định"))}</span>` : ""}
            ${!item.exists ? `<span class="folder-badge missing">${escapeHtml(t("Không tồn tại"))}</span>` : ""}
          </span>
          <span class="folder-actions">
            <button class="mini-btn icon-btn" type="button" data-action="open-folder-explorer" data-folder="${escapeHtml(item.folder || "")}" title="${escapeHtml(t("Mở trong Explorer"))}">📂</button>
            ${item.isDefault ? "" : `
              <button class="mini-btn danger icon-btn" type="button" data-action="remove-source-folder" data-folder="${escapeHtml(item.folder || "")}" title="${escapeHtml(t("Xóa thư mục khỏi danh sách"))}">🗑️</button>
            `}
          </span>
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
  host.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => action(element.dataset.action, element));
  });
}

function renderWorklistView() {
  const tab = state.worklistTab === "activity" ? "activity" : "studies";
  const job = state.job || state.bootstrap?.job || {};
  const activityCount = job.status === "running" ? 1 : 0;

  return `
    <main class="worklist-view">
      <div class="worklist-tabs" role="tablist">
        <button class="worklist-tab${tab === "studies" ? " active" : ""}" role="tab"
          aria-selected="${tab === "studies"}"
          data-action="worklist-tab" data-worklist-tab="studies">
          ${escapeHtml(t("Danh sách bệnh nhân"))}
          <span class="worklist-tab-count">${filteredPatientList().length}</span>
        </button>
        <button class="worklist-tab${tab === "activity" ? " active" : ""}" role="tab"
          aria-selected="${tab === "activity"}"
          data-action="worklist-tab" data-worklist-tab="activity">
          ${escapeHtml(t("Hoạt động & hàng đợi"))}
          ${activityCount ? `<span class="worklist-tab-count running">${activityCount}</span>` : ""}
        </button>
      </div>

      ${tab === "studies"
      ? renderStudyListPanel()
      : `<div id="activity-panel" class="activity-panel">${renderActivityPanelInner()}</div>`}
    </main>
  `;
}

/* ── The title bar ─────────────────────────────────────────────────────────
   The window is frameless, so this strip of HTML *is* the title bar. Anything
   a real one would do for free — drag, snap, maximise, resize — has to be
   asked of the shell through NativeApi.window_* in dcom_web_app.py. In a plain
   browser preview there is no window to command, so every call here is a
   no-op rather than an error. */

function nativeWindowApi() {
  return typeof window !== "undefined" ? window.pywebview?.api : undefined;
}

/** True when the pointer went down on something that handles its own clicks. */
function isTitlebarControl(target) {
  return Boolean(target?.closest?.("button, select, input, textarea, a, [data-no-drag]"));
}

// Windows order and metrics: minimise, maximise/restore, close — close being
// the only one that turns red. Both maximise glyphs are drawn and CSS picks
// one, so syncing the state never means rewriting markup.
function renderWindowControls() {
  const minimize = escapeHtml(t("Thu nhỏ"));
  const maximize = escapeHtml(t("Phóng to / Khôi phục"));
  const close = escapeHtml(t("Đóng ứng dụng"));
  return `
    <div class="window-controls">
      <button class="win-btn win-min" type="button" data-action="window-minimize"
        title="${minimize}" aria-label="${minimize}">
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10"/></svg>
      </button>
      <button class="win-btn win-max" type="button" data-action="window-maximize"
        title="${maximize}" aria-label="${maximize}">
        <svg class="glyph-maximize" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" rx="1"/></svg>
        <svg class="glyph-restore" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/>
          <rect x="0.5" y="2.5" width="7" height="7" rx="1"/></svg>
      </button>
      <button class="win-btn win-close" type="button" data-action="window-close"
        title="${close}" aria-label="${close}">
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/></svg>
      </button>
    </div>`;
}

// How far the pointer travels before a press on the title bar counts as a
// drag rather than a click.
const TITLEBAR_DRAG_THRESHOLD_PX = 3;

function installTitlebarChrome() {
  const header = getDomRoot()?.querySelector(".app-header");
  if (!header) return;

  header.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || isTitlebarControl(event.target)) return;
    const api = nativeWindowApi();
    if (!api?.window_begin_drag) return;

    const origin = { x: event.screenX, y: event.screenY };

    const stop = () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", stop, true);
    };

    const onMove = (move) => {
      // Waiting for real travel keeps a plain click from nudging the window,
      // and means the button is still down by the time the shell is asked —
      // its drag loop only ends on the button coming up, so one started after
      // the release would leave the window glued to the cursor.
      if (!(move.buttons & 1)) return stop();
      if (Math.abs(move.screenX - origin.x) < TITLEBAR_DRAG_THRESHOLD_PX
        && Math.abs(move.screenY - origin.y) < TITLEBAR_DRAG_THRESHOLD_PX) return;
      stop();
      // One call for the whole gesture. pywebview's own drag region sends the
      // window a new position on every mousemove, which trails the cursor and
      // gives up Aero Snap; the shell's own loop does neither. It settles when
      // the reader lets go, and a drag to the top edge maximises, so the
      // glyphs are read back afterwards.
      Promise.resolve(api.window_begin_drag()).then(syncWindowState).catch(() => {});
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", stop, true);
  });

  header.addEventListener("dblclick", (event) => {
    if (isTitlebarControl(event.target)) return;
    action("window-maximize");
  });
}

let pendingWindowStateRead = null;

/** Re-read the window state; the shell changes it without telling the page. */
function syncWindowState() {
  const api = nativeWindowApi();
  if (!api?.window_state) return Promise.resolve();
  if (pendingWindowStateRead) return pendingWindowStateRead;
  pendingWindowStateRead = Promise.resolve(api.window_state())
    .then((info) => {
      state.windowMaximized = Boolean(info?.maximized);
      state.zenMode = Boolean(info?.fullscreen);
      applyWindowState();
    })
    // The bridge is already gone while the window is closing, and there is
    // nothing left to update by then.
    .catch(() => {})
    .finally(() => { pendingWindowStateRead = null; });
  return pendingWindowStateRead;
}

/** Mirror the window state onto the shell without a full re-render. */
function applyWindowState() {
  const shell = getDomRoot()?.querySelector(".app-shell");
  if (!shell) return;
  shell.classList.toggle("window-maximized", state.windowMaximized);
  shell.classList.toggle("zen-mode", state.zenMode);
}

function installWindowStateWatcher() {
  let queued = false;
  window.addEventListener("resize", () => {
    // Snap layouts and Win+Arrow resize the window many times per gesture; one
    // read per frame keeps the glyphs honest without flooding the bridge.
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncWindowState();
    });
  });
  syncWindowState();
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

  const seriesStrip = app.querySelector(".series-strip");
  const stripScrollTop = seriesStrip ? seriesStrip.scrollTop : null;
  const stripScrollLeft = seriesStrip ? seriesStrip.scrollLeft : null;

  const historyRail = app.querySelector(".patient-history-rail");
  const historyRailScrollTop = historyRail ? historyRail.scrollTop : null;

  const seriesPicker = app.querySelector("#series-picker");
  const seriesPickerScrollTop = seriesPicker ? seriesPicker.scrollTop : null;

  const studyList = app.querySelector(".study-list");
  const studyListScrollTop = studyList ? studyList.scrollTop : null;

  const worklistContainer = app.querySelector(".worklist-table-container, .worklist-view");
  const worklistScrollTop = worklistContainer ? worklistContainer.scrollTop : null;

  app.innerHTML = `
    <div class="app-shell ${downloadPanelVisible() ? "" : "download-collapsed"} ${state.activeTabId === "worklist" ? "worklist-active" : "viewer-active"}${state.windowMaximized ? " window-maximized" : ""}${state.zenMode ? " zen-mode" : ""}">
      <header class="app-header">
        <div class="header-left">
          <div class="brand">
            <span class="brand-mark">D</span>
            <div class="brand-text">
              <b>DICOM/JPG Downloader & Viewer</b>
              <small>OFFLINE · v1.1</small>
            </div>
          </div>
        </div>

        <div class="header-center">
          ${state.activeTabId !== "worklist" && state.archive?.series?.length ? `
          <div class="series-selects">
            <label>${escapeHtml(t("Series"))}
              <select data-field="series">${renderSeriesOptions(state.archive, state.selectedId)}</select>
            </label>
          </div>
          ` : `<div class="header-center-spacer"></div>`}
        </div>

        <div class="header-right">
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
          ${renderWindowControls()}
        </div>
      </header>

      ${renderWinbar()}

      ${downloadPanelVisible() ? `
      <aside class="download-panel">
        <div class="panel-title"><b>${escapeHtml(t("TẢI MRI / CT"))}</b>
          <button data-action="toggle-download" title="${escapeHtml(t("Thu gọn khu tải phim"))}">×</button></div>
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
        <small class="download-hint" hidden></small>
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
        <div class="job-log-wrap">
          <pre class="job-log" id="job-log-pre">${escapeHtml((state.bootstrap?.job?.logs || []).map(translateLog).join("\n"))}</pre>
          <div class="job-log-floating-actions">
            <button type="button" class="job-log-icon-btn btn-clear-log" data-action="clear-job-log" title="${escapeHtml(t("Xoá hiển thị"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <button type="button" class="job-log-icon-btn btn-copy-log" data-action="copy-job-log" title="${escapeHtml(t("Sao chép toàn bộ nhật ký"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
        </div>
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
      ${renderExportModal()}
    </div>
  `;
  bindEvents();
  hydrateSeriesThumbs();
  initMediaEvents();

  if (stripScrollTop !== null || stripScrollLeft !== null) {
    const newStrip = app.querySelector(".series-strip");
    if (newStrip) {
      if (stripScrollTop !== null) newStrip.scrollTop = stripScrollTop;
      if (stripScrollLeft !== null) newStrip.scrollLeft = stripScrollLeft;
    }
  }
  if (historyRailScrollTop !== null) {
    const newRail = app.querySelector(".patient-history-rail");
    if (newRail) newRail.scrollTop = historyRailScrollTop;
  }
  if (seriesPickerScrollTop !== null) {
    const newPicker = app.querySelector("#series-picker");
    if (newPicker) newPicker.scrollTop = seriesPickerScrollTop;
  }
  if (studyListScrollTop !== null) {
    const newStudyList = app.querySelector(".study-list");
    if (newStudyList) newStudyList.scrollTop = studyListScrollTop;
  }
  if (worklistScrollTop !== null) {
    const newWorklist = app.querySelector(".worklist-table-container, .worklist-view");
    if (newWorklist) newWorklist.scrollTop = worklistScrollTop;
  }
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

function renderExportModal() {
  if (!state.showExportModal) return "";
  const opts = state.exportModalOptions || { hasJpg: true, hasDicom: false, jpgCount: 0, dicomCount: 0, studyCount: 0 };
  const folder = state.exportModalFolder || "";
  const patientName = state.exportModalPatientName || t("Bệnh nhân");

  return `
    <div class="export-modal-overlay">
      <div class="export-modal-dialog">
        <header class="export-modal-header">
          <div class="export-modal-title-wrap">
            <h3 class="export-modal-title">📦 ${escapeHtml(t("Tùy chọn xuất hồ sơ"))}</h3>
            <span class="export-modal-subtitle">${escapeHtml(patientName)}</span>
          </div>
          <button class="file-info-close-btn" data-action="close-export-modal" title="${escapeHtml(t("Đóng"))}">✕</button>
        </header>
        <div class="export-modal-body">
          <p class="export-modal-desc">${escapeHtml(t("Hồ sơ này có cả ảnh JPG và file gốc DICOM. Vui lòng chọn định dạng muốn xuất ra USB / thư mục:"))}</p>

          <div class="export-options-grid">
            <!-- Option 1: Web Viewer (JPG) -->
            <div class="export-option-card" data-action="confirm-export-choice" data-mode="viewer" data-folder="${escapeHtml(folder)}">
              <div class="export-card-icon">🌐</div>
              <div class="export-card-content">
                <div class="export-card-title">
                  <b>${escapeHtml(t("Web PACS Viewer (Ảnh JPG)"))}</b>
                  <span class="export-card-badge recommended">${escapeHtml(t("Khuyên dùng"))}</span>
                </div>
                <div class="export-card-desc">
                  ${escapeHtml(t("Tạo trang web tự động chạy offline trên mọi trình duyệt. Có thanh cuộn lát cắt, đổi chuỗi xung, phóng to/thu nhỏ, tương phản W/L và so sánh 2 xung song song."))}
                </div>
                <div class="export-card-meta">
                  <span>🖼 ${opts.jpgCount || 0} ${escapeHtml(t("ảnh JPG"))}</span>
                  <span>⚡ ${escapeHtml(t("Nhẹ, mở tức thì trên mọi máy tính"))}</span>
                </div>
              </div>
            </div>

            <!-- Option 2: DICOM Originals -->
            <div class="export-option-card" data-action="confirm-export-choice" data-mode="dicom" data-folder="${escapeHtml(folder)}">
              <div class="export-card-icon">💾</div>
              <div class="export-card-content">
                <div class="export-card-title">
                  <b>${escapeHtml(t("File gốc DICOM"))}</b>
                  <span class="export-card-badge">${escapeHtml(t("Máy trạm PACS"))}</span>
                </div>
                <div class="export-card-desc">
                  ${escapeHtml(t("Xuất toàn bộ file chụp gốc DICOM tiêu chuẩn y khoa chất lượng cao nhất, kèm file hướng dẫn mở bằng RadiAnt, Weasis, MicroDicom, Horos..."))}
                </div>
                <div class="export-card-meta">
                  <span>📁 ${opts.dicomCount || 0} ${escapeHtml(t("file DICOM"))}</span>
                  <span>🔬 ${escapeHtml(t("Dành cho bác sĩ CĐHA chuyên sâu"))}</span>
                </div>
              </div>
            </div>

            <!-- Option 3: Both -->
            <div class="export-option-card" data-action="confirm-export-choice" data-mode="both" data-folder="${escapeHtml(folder)}">
              <div class="export-card-icon">📦</div>
              <div class="export-card-content">
                <div class="export-card-title">
                  <b>${escapeHtml(t("Xuất đầy đủ (Cả Web Viewer + DICOM)"))}</b>
                  <span class="export-card-badge">${escapeHtml(t("Tất cả"))}</span>
                </div>
                <div class="export-card-desc">
                  ${escapeHtml(t("Bao gồm cả Web PACS Viewer xem nhanh trên trình duyệt lẫn thư mục file gốc DICOM đầy đủ cho máy trạm."))}
                </div>
                <div class="export-card-meta">
                  <span>🌐 ${opts.jpgCount || 0} JPG + 📁 ${opts.dicomCount || 0} DICOM</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <footer class="export-modal-footer">
          <button class="tool-btn" data-action="close-export-modal">${escapeHtml(t("Hủy bỏ"))}</button>
        </footer>
      </div>
    </div>
  `;
}


function showCopyToast(message = t("Đã sao chép vào clipboard!")) {
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

async function copyTextToClipboard(text, customMessage) {
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
    showCopyToast(customMessage || t("Đã sao chép vào clipboard!"));
  } catch (_) {
    showCopyToast(t("Không thể sao chép"));
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
const resolvedThumbUrls = new Map();

function seriesThumbUrl(seriesId) {
  let pending = seriesThumbs.get(seriesId);
  if (!pending) {
    pending = apiBlob(thumbnailPath(seriesId)).then((blob) => {
      const url = URL.createObjectURL(blob);
      resolvedThumbUrls.set(seriesId, url);
      return url;
    });
    // Drop failures so a later render can retry instead of caching the error.
    pending.catch(() => {
      seriesThumbs.delete(seriesId);
      resolvedThumbUrls.delete(seriesId);
    });
    seriesThumbs.set(seriesId, pending);
  }
  return pending;
}

function hydrateSeriesThumbs() {
  const live = new Set(state.archive.series.map((item) => item.id));
  for (const [seriesId, pending] of seriesThumbs) {
    if (live.has(seriesId)) continue;
    seriesThumbs.delete(seriesId);
    const cachedUrl = resolvedThumbUrls.get(seriesId);
    if (cachedUrl) URL.revokeObjectURL(cachedUrl);
    resolvedThumbUrls.delete(seriesId);
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  for (const img of app.querySelectorAll(".series-card-thumb[data-thumb-id]")) {
    const seriesId = img.dataset.thumbId;
    const cached = resolvedThumbUrls.get(seriesId);
    if (cached) {
      if (img.getAttribute("src") !== cached) {
        img.src = cached;
      }
      continue;
    }
    seriesThumbUrl(seriesId)
      .then((url) => {
        if (img.isConnected && img.getAttribute("src") !== url) {
          img.src = url;
        }
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

// Documents the last scan found, read straight off the inventory so clearing the
// series list (new patient, new link) cannot leave another study's reports behind.
function discoveredAttachments() {
  return state.seriesInventory.flatMap((group) => group.attachments || []);
}

function renderAttachmentCard() {
  const attachments = discoveredAttachments();
  if (!attachments.length) return "";

  return `
    <div class="attachment-notification-card">
      <div class="attachment-header">
        <div class="attachment-title-wrap">
          <span class="attachment-icon">📎</span>
          <div>
            <strong>${escapeHtml(t("Phát hiện tài liệu & Báo cáo đính kèm"))} (${attachments.length})</strong>
            <small>${escapeHtml(t("Các tệp này sẽ được tải riêng vào thư mục DOCUMENTS"))}</small>
          </div>
        </div>
        <label class="attachment-toggle-label">
          <input type="checkbox" id="attachment-download-toggle" ${state.downloadAttachments ? "checked" : ""}>
          <span>${escapeHtml(t("Tải kèm"))}</span>
        </label>
      </div>
      <div class="attachment-file-list">
        ${attachments.map((att) => `
          <div class="attachment-item-chip" title="${escapeHtml(att.url || '')}">
            <span class="attachment-chip-icon">${att.type === "pdf" ? "📄" : (att.type === "text" ? "📝" : "📁")}</span>
            <span class="attachment-chip-name">${escapeHtml(att.name || t("Tài liệu"))}</span>
            <span class="attachment-chip-badge">${escapeHtml((att.type || "DOC").toUpperCase())}</span>
          </div>
        `).join("")}
      </div>
    </div>`;
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
  const attachmentCard = renderAttachmentCard();
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
  return `${attachmentCard}${actions}${state.seriesInventory.map((group, groupIndex) => `
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
    if (WORKLIST_OWNED_ACTIONS.has(element.dataset.action)) return;
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

  const exportOverlay = app.querySelector(".export-modal-overlay");
  exportOverlay?.addEventListener("click", (event) => {
    if (event.target === exportOverlay) {
      state.showExportModal = false;
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
  installTitlebarChrome();
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
  bindWorklistFilters(app);
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

      // If clicked from timeline rail: only scroll the series strip so that study's
      // group header sits at the top, and leave the current viewport image intact.
      if (element.classList.contains("tl-open") || element.closest(".tl-item")) {
        const targetCard = app.querySelector(`.series-card[data-series-id="${seriesId}"]`);
        if (targetCard) {
          const dateKey = targetCard.dataset.dateKey;
          const groupBadge = dateKey ? app.querySelector(`.series-group-badge[data-date-key="${dateKey}"]`) : null;
          const targetToScroll = groupBadge || targetCard;
          targetToScroll.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }

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

      // Non-compare modes:
      const prevSelected = selectedSeries();
      const prevMediaType = getSeriesMediaType(prevSelected);
      const newMediaType = getSeriesMediaType(newSeries);

      state.selectedId = seriesId;
      const selected = selectedSeries();
      let needsFullRender = false;
      if ((state.mode === "mpr" || state.mode === "volume3d") && !selected?.mprReady) {
        state.mode = "single";
        state.tool = "window";
        needsFullRender = true;
      } else if (prevMediaType !== newMediaType) {
        needsFullRender = true;
      }

      if (needsFullRender) {
        render();
        renderViewer();
      } else {
        updateSeriesCardHighlight();
        const seriesSelect = app.querySelector("[data-field='series']");
        if (seriesSelect) seriesSelect.value = seriesId;

        const presetSelect = app.querySelector("[data-field='window-preset']");
        if (presetSelect) {
          presetSelect.innerHTML = availableWindowPresets(selected)
            .map((preset) => `<option value="${preset.id}" ${state.windowPreset === preset.id ? "selected" : ""}>${escapeHtml(preset.detail ? `${t(preset.label)} · ${preset.detail}` : t(preset.label))}</option>`)
            .join("");
          presetSelect.setAttribute("title", escapeHtml(t(windowPresetHint(selected))));
        }

        const safety = seriesSafetyNotice(selected);
        const notice = app.querySelector(".safety-notice");
        if (notice) {
          notice.hidden = !safety;
          notice.className = `safety-notice ${safety?.level || ""}`;
          const span = notice.querySelector("span");
          if (span) span.textContent = safety ? t(safety.text) : "";
        }

        if (newMediaType !== "dicom") {
          const workspace = app.querySelector("#workspace");
          if (workspace) {
            workspace.innerHTML = renderWorkspacePane(selected);
            initMediaEvents();
          }
        } else {
          renderViewer();
        }
      }
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
      state.seriesGroupCache = {};
      renderSeriesPickerOnly();
      syncDownloadButton();
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
  app.querySelector("#attachment-download-toggle")?.addEventListener("change", (event) => {
    state.downloadAttachments = event.target.checked;
  });
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

/** Lookup key shared by the study list and the scanned series inventory. */
function studyKey(study) {
  return String(study?.study_uid || "").trim();
}

/** How a study is named in a message: "MR · 2026-06-04 18:10:54". */
function studyLabel(study) {
  return [study?.modality, study?.date].filter(Boolean).join(" · ") || studyKey(study);
}

/** Keep every scanned group, so a date can be unticked without losing its scan. */
function cacheSeriesGroups(groups) {
  (groups || []).forEach((group) => {
    const uid = String(group.studyUid || "").trim();
    if (uid && uid !== "direct") state.seriesGroupCache[uid] = group;
  });
}

/**
 * Show the scanned series of exactly the studies that are ticked right now.
 *
 * Unticking a date used to drop its group from the inventory for good. Ticking
 * it again left a chosen study with no series at all, which switched the
 * download button off for good with a full series list still on screen and
 * nothing saying why. The groups now live in the cache and are re-hydrated with
 * whatever the user had ticked inside them.
 */
function syncSeriesInventoryWithStudies() {
  state.rememberedSeriesSelections = rememberSeriesSelections(
    state.seriesInventory,
    state.rememberedSeriesSelections,
  );
  cacheSeriesGroups(state.seriesInventory);
  const direct = state.seriesInventory.filter((group) => group.studyUid === "direct");
  const chosen = chosenStudies(state.studies)
    .map((study) => state.seriesGroupCache[studyKey(study)])
    .filter(Boolean);
  state.seriesInventory = restoreSeriesSelections(
    [...direct, ...chosen],
    state.rememberedSeriesSelections,
  );
}

function updateStudySelection(element) {
  const study = state.studies[Number(element.dataset.studyIndex)];
  if (!study) return;
  study.selected = element.checked;
  syncSeriesInventoryWithStudies();
  renderSeriesPickerOnly();
  syncDownloadButton();
}

/**
 * Why the download button is off, in words the user can act on. Empty means
 * nothing is blocking it.
 */
function downloadBlockReason() {
  if (state.patient?.nameConflict) return t("Tên bệnh nhân không khớp; app đã chặn tự động gộp.");
  if (!state.studies.length) return t("Chưa tìm ca chụp.");
  if (!chosenStudies(state.studies).length) return t("Hãy tích ít nhất một ngày chụp để tải.");
  if (state.downloadAllFiles) return "";
  if (hasCompleteSeriesSelection(state.studies, state.seriesInventory)) return "";
  const blocked = studiesMissingSeries(state.studies, state.seriesInventory);
  // Naming six dates turns the line into a wall of text nobody reads.
  if (blocked.length > 2) return tf("Còn {} ca đang tích chưa chọn được series nào.", blocked.length);
  const names = blocked.map(studyLabel).join(", ");
  return blocked.every((study) => !state.seriesGroupCache[studyKey(study)])
    ? tf("Chưa quét series cho ca {}; hãy bấm Quét danh sách series.", names)
    : tf("Ca {} chưa tích series nào.", names);
}

function syncDownloadButton() {
  const reason = downloadBlockReason();
  const button = app.querySelector("[data-action='download-selected']");
  if (button) button.disabled = Boolean(reason);
  const hint = app.querySelector(".download-hint");
  if (hint) {
    // Before a search there is nothing to explain, so the line stays out of the
    // layout instead of nagging about a study list that does not exist yet.
    const visible = Boolean(reason) && state.studies.length > 0;
    hint.textContent = visible ? reason : "";
    hint.hidden = !visible;
  }
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
    const selects = app?.querySelectorAll("[data-field='history']") || [];
    selects.forEach((select) => {
      select.innerHTML = renderHistoryOptions();
      select.disabled = !state.history.length;
    });
  } catch (_) {
    // History is a convenience; a failed refresh must not disturb the session.
  }
}

/**
 * Mount the drawing surface over the photo on screen.
 *
 * What was here before let the reader drag exactly one rectangle, which every
 * tool then had to be told to consume by pressing a toolbar button: crop, hide,
 * arrow and box all acted on that same lone box, and the text tool ignored it
 * entirely and dropped the note in a fixed corner. Now the pointer draws the
 * thing itself, where it is pointing, in the colour and size on the properties
 * bar — and what is drawn stays an object that can be picked back up.
 */
function initPhotoAnnotator() {
  const root = getDomRoot();
  const wrap = root?.querySelector("#photo-editor-canvas");
  // One surface, two studios: the photo pane mounts an <img>, the surgical
  // player a <video>, and the drawing layer works the same over either.
  const img = root?.querySelector("#photo-editor-img, #surgery-video-player");
  const canvas = root?.querySelector("#photo-annotation-canvas");
  if (!wrap || !img || !canvas) {
    // Leaving the surface mounted over a pane that no longer exists keeps its
    // window listeners alive and repaints a detached canvas on every resize.
    destroyActiveSurface();
    return;
  }
  createAnnotatorSurface({
    wrap,
    img,
    canvas,
    // Only the photo stage scrolls; the player is always sized to its pane.
    scroller: root.querySelector("#photo-editor-stage"),
    onZoomAt: (factor, clientX, clientY) => zoomPhotoAt(factor, clientX, clientY),
    getLayer: () => photoLayer(selectedSeries()),
    getStyle: () => state.photoStyle,
    getTool: () => state.photoTool,
    onStatus: (message) => setStatus(message),
    onChange: () => syncPhotoStudioUI(),
    onToolDone: (toolId) => {
      // A shape drawn by dragging leaves the tool armed, so a reader marking
      // four findings does not walk back to the rail four times. The two
      // single-click tools hand the pointer back, which is what every editor
      // does once the click has been spent.
      if (toolId === "text" || toolId === "marker") setPhotoTool("select");
    },
  });
  applyPhotoZoom();
  syncPhotoStudioUI();
}

/** Arm a drawing tool. */
function setPhotoTool(toolId) {
  const tool = toolById(toolId);
  state.photoTool = tool.id;
  const surface = currentSurface();
  if (tool.id !== "crop") surface?.clearCrop();
  // Leaving a shape selected under a drawing tool shows handles the pointer can
  // no longer grab, which reads as the tool being stuck.
  if (tool.id !== "select") surface?.select(null);
  syncPhotoStudioUI();
  setStatus(t(tool.label));
}

/**
 * Fit the image to the stage, or show it at an explicit zoom.
 *
 * A 4000px intra-operative photo scaled into a 900px pane cannot be annotated
 * precisely — a 3px arrow tip covers 13 real pixels. Zoom is a plain CSS width
 * on the image; the surface reads the element's box for its scale, so shapes
 * follow without any coordinate rewriting.
 */
function applyPhotoZoom() {
  const img = getDomRoot()?.querySelector("#photo-editor-img");
  if (!img) return;
  const zoom = Number(state.photoZoom) || 0;
  if (zoom > 0 && img.naturalWidth) {
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = `${Math.round(img.naturalWidth * zoom)}px`;
    img.style.height = "auto";
  } else {
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.width = "";
    img.style.height = "";
  }
  const label = getDomRoot()?.querySelector("#photo-zoom-label");
  if (label) label.textContent = zoom ? `${Math.round(zoom * 100)}%` : t("Vừa khung");
  currentSurface()?.repaint();
}

/**
 * Zoom about a point on screen, keeping what is under it under it.
 *
 * Zooming to the centre of the pane and then hunting the detail down again with
 * the scrollbars is what makes a deep zoom useless. The anchor is recorded as a
 * fraction of the image, so it survives the relayout the new width causes.
 */
function zoomPhotoAt(factor, clientX, clientY) {
  const root = getDomRoot();
  const stage = root?.querySelector("#photo-editor-stage");
  const img = root?.querySelector("#photo-editor-img");
  if (!stage || !img?.naturalWidth) return;
  const before = img.getBoundingClientRect();
  if (!before.width) return;
  const anchorX = (clientX - before.left) / before.width;
  const anchorY = (clientY - before.top) / before.height;
  const current = state.photoZoom || before.width / img.naturalWidth;
  const next = Math.max(0.05, Math.min(8, current * factor));
  if (next === state.photoZoom) return;
  state.photoZoom = next;
  applyPhotoZoom();
  const after = img.getBoundingClientRect();
  stage.scrollLeft += after.left + anchorX * after.width - clientX;
  stage.scrollTop += after.top + anchorY * after.height - clientY;
  currentSurface()?.repaint();
}

/** The +/- buttons zoom about the middle of the stage. */
function stepPhotoZoom(factor) {
  const stage = getDomRoot()?.querySelector("#photo-editor-stage");
  if (!stage) return;
  const box = stage.getBoundingClientRect();
  zoomPhotoAt(factor, box.left + box.width / 2, box.top + box.height / 2);
}

/**
 * Push the layer's state into the controls without a full re-render.
 *
 * `render()` rebuilds the whole shell, which would tear the canvas down and
 * lose the gesture in flight; selecting a shape or drawing one only has to
 * refresh a handful of labels and disabled flags.
 */
function syncPhotoStudioUI() {
  const root = getDomRoot();
  if (!root) return;
  const series = selectedSeries();
  const layer = photoLayer(series);
  const surface = currentSurface();
  const selected = surface?.selectedShape() || null;
  const pending = pendingShapeCount(series);

  root.querySelectorAll("[data-action='photo-pick-tool']").forEach((button) => {
    const active = button.dataset.tool === state.photoTool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  // The properties bar shows the selected shape's own style when there is one,
  // so changing the colour of an arrow already on the photo is the same gesture
  // as choosing the colour of the next one.
  const style = selected || state.photoStyle;
  const swatchColor = String(style.color || "").toLowerCase();
  root.querySelectorAll("[data-action='photo-pick-color']").forEach((button) => {
    button.classList.toggle("active", button.dataset.color === swatchColor);
  });
  setControlValue(root, "[data-field='photo-color']", style.color);
  setControlValue(root, "[data-field='photo-stroke']", style.strokeWidth);
  setControlValue(root, "[data-field='photo-font']", style.fontSize ?? state.photoStyle.fontSize);
  setControlValue(root, "[data-field='photo-opacity']", Math.round((style.opacity ?? 1) * 100));
  const fill = root.querySelector("[data-field='photo-fill']");
  if (fill) fill.checked = Boolean(style.filled);
  setText(root, "#photo-stroke-value", style.strokeWidth);
  setText(root, "#photo-font-value", style.fontSize ?? state.photoStyle.fontSize);
  setText(root, "#photo-opacity-value", `${Math.round((style.opacity ?? 1) * 100)}%`);

  // Font size only means something for the two tools that draw glyphs.
  const textual = ["text", "marker"].includes(state.photoTool)
    || ["text", "marker"].includes(selected?.kind);
  const fontField = root.querySelector("#photo-font-field");
  if (fontField) fontField.classList.toggle("muted", !textual);

  const cropButton = root.querySelector("#photo-apply-crop");
  if (cropButton) {
    cropButton.hidden = state.photoTool !== "crop";
    cropButton.disabled = !surface?.cropRect();
  }
  const deleteButton = root.querySelector("#photo-delete-shape");
  if (deleteButton) deleteButton.disabled = !selected;
  const clearButton = root.querySelector("[data-action='photo-clear-shapes']");
  if (clearButton) clearButton.disabled = !pending;

  const apply = root.querySelector("#photo-apply-shapes");
  if (apply) {
    // One control, two studios: the button says what it will write to.
    const label = getSeriesMediaType(series) === "video"
      ? t("Áp dụng lên video")
      : t("Áp dụng lên ảnh");
    apply.disabled = !pending;
    apply.textContent = pending ? `${label} (${pending})` : label;
  }
  setText(root, "#photo-status-hint", selected
    ? tf("Đang chọn: {}", t(shapeKindLabel(selected.kind)))
    : t(toolById(state.photoTool).label));
  setText(root, "#photo-status-count", pending
    ? tf("{} nét chưa áp dụng", pending)
    : t("Chưa vẽ gì"));
  const img = root.querySelector("#photo-editor-img");
  if (img?.naturalWidth) {
    setText(root, "#photo-status-size", `${img.naturalWidth}×${img.naturalHeight} px`);
  }
  syncEditHistoryButtons(series);
  void layer;
}

function setControlValue(root, selector, value) {
  const element = root.querySelector(selector);
  if (element && value !== undefined && value !== null) element.value = String(value);
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value);
}

/** What a shape is called in the status line. */
function shapeKindLabel(kind) {
  const tool = ANNOTATOR_TOOLS.find((item) => item.shape === kind);
  return tool ? tool.label : kind;
}

/**
 * Restyle the selection, and make the same style the default for what comes next.
 *
 * Doing only the first would mean the reader restyles one arrow and the next
 * one comes out red again; doing only the second would make the properties bar
 * useless for fixing something already drawn.
 */
function applyPhotoStyle(patch) {
  Object.assign(state.photoStyle, patch);
  currentSurface()?.restyleSelected(patch);
  syncPhotoStudioUI();
}

/**
 * Burn the drawing layer into a new working file and return its path.
 *
 * This is the one place a photo is re-encoded. Every shape the reader drew goes
 * over in a single pass at full resolution, so a photo carrying a dozen
 * annotations has been through the JPEG encoder once rather than twelve times —
 * the old tools re-compressed the whole picture for every arrow.
 *
 * With nothing drawn it is a no-op that just reports the current file, which is
 * what lets crop, rotate and export call it unconditionally.
 */
async function flattenPhotoLayer(series, { silent = false } = {}) {
  const path = await getPhotoSourcePath(series);
  if (!path) throw new Error(t("Không tìm thấy đường dẫn ảnh gốc."));
  const layer = photoLayer(series);
  const shapes = layerPayload(layer?.shapes || []);
  if (!shapes.length) return path;
  if (!silent) setStatus(tf("Đang vẽ {} chi tiết lên ảnh...", shapes.length));
  const res = await api("/api/media/photo/shapes", {
    method: "POST",
    body: JSON.stringify({ path, shapes }),
  });
  state.photoWorkingPath = res.outputPath;
  pushMediaEdit(series, res);
  // The shapes are pixels now. Their vector history goes with them: stepping
  // back is the file chain's job from here, and keeping both would offer two
  // undo stacks that disagree about what the last action was.
  layer.shapes = [];
  layer.past = [];
  layer.future = [];
  currentSurface()?.select(null);
  setMediaElementSrc(getDomRoot()?.querySelector("#photo-editor-img"), res.url);
  syncPhotoStudioUI();
  return res.outputPath;
}

/**
 * Live-wire the properties bar.
 *
 * Sliders report on `input`, not on `change`, so a stroke width or a font size
 * is seen changing on the photo while the thumb is still under the finger —
 * choosing a size by watching the result is the whole reason the control exists.
 */
function initPhotoProperties() {
  const root = getDomRoot();
  const props = root?.querySelector("#photo-props");
  if (!props) return;
  const bind = (selector, handler) => {
    const element = props.querySelector(selector);
    if (element) element.oninput = () => handler(element);
  };
  bind("[data-field='photo-color']", (input) => applyPhotoStyle({ color: input.value }));
  bind("[data-field='photo-stroke']", (input) =>
    applyPhotoStyle({ strokeWidth: Number(input.value) || 1 }));
  bind("[data-field='photo-font']", (input) =>
    applyPhotoStyle({ fontSize: Number(input.value) || 28 }));
  bind("[data-field='photo-opacity']", (input) =>
    applyPhotoStyle({ opacity: Math.max(0.05, (Number(input.value) || 100) / 100) }));
  bind("[data-field='photo-fill']", (input) => applyPhotoStyle({ filled: input.checked }));
}

/** Turn the photo a quarter, keeping anything drawn on it aligned. */
async function rotateWorkingPhoto(degrees) {
  const series = selectedSeries();
  if (!series) return;
  // Rotation moves every pixel, so pending shapes are burned in first rather
  // than left holding coordinates for an orientation that no longer exists.
  const path = await flattenPhotoLayer(series, { silent: true });
  setStatus(t("Đang xoay ảnh 90°..."));
  const res = await api("/api/media/photo/rotate", {
    method: "POST",
    body: JSON.stringify({ path, degrees }),
  });
  state.photoWorkingPath = res.outputPath;
  pushMediaEdit(series, res);
  setMediaElementSrc(getDomRoot()?.querySelector("#photo-editor-img"), res.url);
  setStatus(t("Đã xoay ảnh 90° thành công."));
}

function initMediaEvents() {
  hydrateMediaSources();
  initPhotoAnnotator();
  initPhotoProperties();
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

    // The in/out band is positioned as a percentage of the clip, so it cannot
    // be drawn until the duration is known — which is after the metadata
    // arrives, not when the markup lands.
    video.onloadedmetadata = () => {
      state.videoDuration = Number(video.duration) || 0;
      syncVideoRangeUI();
      currentSurface()?.repaint();
    };
    if (video.readyState >= 1) video.onloadedmetadata();

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

async function executeExportJob(folder, mode = "viewer") {
  if (!folder) return;
  if (window.pywebview?.api?.choose_export_folder) {
    const job = await window.pywebview.api.choose_export_folder(folder, mode);
    if (job) {
      state.bootstrap.job = job;
      setStatus(t("Đang xuất hồ sơ sang thư mục đã chọn…"));
      startJobPolling();
    }
  } else {
    const destination = window.prompt(t("Nhập đường dẫn thư mục xuất:"));
    if (!destination || !destination.trim()) return;
    const job = await api("/api/worklist/export", {
      method: "POST",
      body: JSON.stringify({ folder, destination: destination.trim(), mode }),
    });
    if (job) {
      state.bootstrap.job = job;
      setStatus(t("Đang xuất hồ sơ sang thư mục đã chọn…"));
      startJobPolling();
    }
  }
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
    
    if (name === "window-minimize") {
      await nativeWindowApi()?.window_minimize?.();
      return;
    }
    if (name === "window-maximize") {
      const toggle = nativeWindowApi()?.window_toggle_maximize;
      if (!toggle) return;
      state.windowMaximized = Boolean(await toggle());
      applyWindowState();
      return;
    }
    if (name === "window-close") {
      const close = nativeWindowApi()?.window_close;
      if (close) await close(); else window.close();
      return;
    }
    if (name === "window-fullscreen") {
      const toggle = nativeWindowApi()?.window_toggle_fullscreen;
      if (!toggle) return;
      state.zenMode = Boolean(await toggle());
      applyWindowState();
      return;
    }

    if (name === "toggle-download") {
      // Swap the class, never re-render: render() rewrites the whole shell, so
      // collapsing the panel would drop the reader's place in the patient list
      // and restart the slide halfway through.
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
    if (name === "refresh-worklist") {
      await refreshWorklist();
      return;
    }
    if (name === "export-patient-record") {
      const folder = element?.dataset?.folder;
      if (!folder) throw new Error(t("Hồ sơ này chưa có thư mục trên đĩa."));

      const patientRow = (state.worklistPatients || []).find((p) => p.folder === folder);
      const patientName = patientRow?.patientName || state.archive?.patient?.patientName || "";

      // Probe available media options in this patient archive
      let options = null;
      try {
        if (window.pywebview?.api?.get_export_options) {
          options = await window.pywebview.api.get_export_options(folder);
        } else {
          options = await api("/api/worklist/export-options", {
            method: "POST",
            body: JSON.stringify({ folder }),
          });
        }
      } catch (_) {
        options = { hasJpg: true, hasDicom: false };
      }

      if (options?.hasJpg && options?.hasDicom) {
        // Both JPG & DICOM exist -> Show choices modal
        state.showExportModal = true;
        state.exportModalFolder = folder;
        state.exportModalOptions = options;
        state.exportModalPatientName = patientName;
        render();
        return;
      }

      // Only one type exists -> automatic export
      const autoMode = (options?.hasDicom && !options?.hasJpg) ? "dicom" : "viewer";
      await executeExportJob(folder, autoMode);
      return;
    }
    if (name === "close-export-modal") {
      state.showExportModal = false;
      state.exportModalFolder = "";
      state.exportModalOptions = null;
      render();
      return;
    }
    if (name === "confirm-export-choice") {
      const folder = element?.dataset?.folder || state.exportModalFolder;
      const mode = element?.dataset?.mode || "viewer";
      state.showExportModal = false;
      state.exportModalFolder = "";
      state.exportModalOptions = null;
      render();
      await executeExportJob(folder, mode);
      return;
    }
    if (name === "clear-worklist-filters") {
      state.worklistModality = "";
      state.worklistPeriod = "all";
      state.worklistRead = "all";
      refreshStudyListPanel();
      return;
    }
    if (name === "toggle-study-read") {
      const folder = element?.dataset?.folder;
      if (!folder) return;
      const read = element.dataset.read !== "1";
      const result = await api("/api/worklist/read", {
        method: "POST",
        body: JSON.stringify({ folder, read }),
      });
      // Patch the row in place: a full rescan would collapse the tree the
      // reader has just expanded.
      (state.worklistPatients || []).forEach((patient) => {
        (patient.studies || []).forEach((study) => {
          if (study.folder === folder) {
            study.isRead = Boolean(result?.isRead);
            study.readAt = String(result?.readAt || "");
          }
        });
      });
      refreshStudyListPanel();
      return;
    }
    if (name === "sort-worklist") {
      const col = element?.dataset?.sortCol;
      if (!col) return;
      if (state.worklistSortColumn === col) {
        state.worklistSortOrder = state.worklistSortOrder === "asc" ? "desc" : "asc";
      } else {
        state.worklistSortColumn = col;
        state.worklistSortOrder = col === "date" ? "desc" : "asc";
      }
      refreshStudyListPanel();
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
      const series = selectedSeries();
      const delta = name === "media-edit-redo" ? 1 : -1;
      // The unflattened drawing is always the newer of the two stacks.
      if (isDrawStudio(series) && undoPhotoStep(series, delta)) return;
      stepMediaEdit(series, delta);
      return;
    }
    if (name === "media-file-prev" || name === "media-file-next") {
      stepMediaFile(selectedSeries(), name === "media-file-next" ? 1 : -1);
      return;
    }
    if (name === "edit-patient-info") {
      state.editingPatientInfo = true;
      state.patientEditDraft = patientInfoDraft(state.archive?.patient || {});
      const currentTab = state.tabs.find((t) => t.id === state.activeTabId);
      if (currentTab) {
        currentTab.editingPatientInfo = true;
        currentTab.patientEditDraft = { ...state.patientEditDraft };
      }
      render();
      return;
    }
    if (name === "cancel-patient-info") {
      state.editingPatientInfo = false;
      state.patientEditDraft = null;
      const currentTab = state.tabs.find((t) => t.id === state.activeTabId);
      if (currentTab) {
        currentTab.editingPatientInfo = false;
        currentTab.patientEditDraft = null;
      }
      render();
      return;
    }
    if (name === "save-patient-info") {
      const form = app.querySelector("[data-field='patient-edit-form']");
      if (!form) return;
      const info = patientInfoFromForm(form);
      const requestTabId = state.activeTabId;
      const requestTab = state.tabs.find((tab) => tab.id === requestTabId);
      const requestArchive = requestTab?.archive || state.archive;
      const previousPatientId = requestArchive?.patient?.patientId || "";
      const requestRoot = requestArchive?.root || "";
      state.patientEditDraft = { ...info };
      if (requestTab) requestTab.patientEditDraft = { ...info };
      try {
        const result = await api("/api/patient/update", {
          method: "POST",
          body: JSON.stringify({
            info,
            archiveRoot: requestRoot,
            patientId: previousPatientId,
          }),
        });
        if (result?.patient) {
          requestArchive.patient = result.patient;
          if (requestTab) {
            requestTab.archive = requestArchive;
            requestTab.patientName = result.patient.patientName || "";
            requestTab.patientId = result.patient.patientId || "";
            requestTab.editingPatientInfo = false;
            requestTab.patientEditDraft = null;
          }
          const normalPath = (value) => String(value || "").replace(/[\\/]+$/, "").toLowerCase();
          let wp = state.worklistPatients.find((p) => (
            requestRoot && normalPath(p.folder) === normalPath(requestRoot)
          ));
          if (!wp && previousPatientId) {
            const sameId = state.worklistPatients.filter((p) => p.patientId === previousPatientId);
            if (sameId.length === 1) [wp] = sameId;
          }
          if (wp) {
            for (const key of ["patientName", "patientId", "gender", "birthYear", "hospital"]) {
              wp[key] = result.patient[key] || "";
            }
          }
        }
        if (state.activeTabId === requestTabId) {
          state.archive = requestArchive;
          state.editingPatientInfo = false;
          state.patientEditDraft = null;
          render();
          setStatus(t("Đã lưu thông tin bệnh nhân."));
        } else if (requestTab) {
          requestTab.status = t("Đã lưu thông tin bệnh nhân.");
        }
      } catch (err) {
        const message = `${t("Lỗi:")} ${err.message || err}`;
        if (state.activeTabId === requestTabId) setStatus(message, true);
        else if (requestTab) requestTab.status = message;
      }
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
    if (name === "copy-cell") {
      const text = element?.dataset?.copyText;
      if (text && text !== "—") {
        await copyTextToClipboard(text, `${t("Đã sao chép")}: ${text.length > 25 ? text.slice(0, 22) + "..." : text}`);
      }
      return;
    }
    if (name === "copy-download-url") {
      const url = element?.dataset?.url;
      if (url) await copyTextToClipboard(url, t("Đã sao chép link tải vào clipboard!"));
      return;
    }
    if (name === "open-download-url") {
      const url = element?.dataset?.url;
      if (url) window.open(url, "_blank");
      return;
    }
    if (name === "copy-job-log") {
      const logEl = app.querySelector(".job-log");
      const fullLogText = (state.bootstrap?.job?.logs || []).map(translateLog).join("\n") || logEl?.textContent || "";
      if (!fullLogText.trim()) {
        setStatus(t("Chưa có nội dung nhật ký để sao chép."));
        return;
      }
      await copyTextToClipboard(fullLogText);
      showCopyToast(t("Đã sao chép toàn bộ nhật ký (log)!"));
      const btn = app.querySelector(".btn-copy-log");
      if (btn) {
        btn.classList.add("copied");
        setTimeout(() => {
          btn.classList.remove("copied");
        }, 2000);
      }
      return;
    }
    if (name === "clear-job-log") {
      if (state.bootstrap?.job) state.bootstrap.job.logs = [];
      if (state.job) state.job.logs = [];
      const logEl = app.querySelector(".job-log");
      if (logEl) logEl.textContent = "";
      setStatus(t("Đã xoá hiển thị nhật ký."));
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
        if (result.sourceFolders) state.sourceFolders = result.sourceFolders;
        state.studies = [];
        state.patient = null;
        state.seriesInventory = [];
        state.rememberedSeriesSelections = {};
        state.seriesGroupCache = {};
        const field = app.querySelector("#output-root");
        if (field) field.value = result.outputRoot;
        renderStudyList();
        renderSeriesPickerOnly();
        refreshWorklist();
        setStatus(t("Đã đổi kho lưu; hãy tìm lại mã bệnh nhân để đối chiếu phim cũ/mới."));
      }
      return;
    }
    if (name === "add-source-folder") {
      if (window.pywebview?.api?.choose_source_folder) {
        const res = await window.pywebview.api.choose_source_folder();
        if (res?.sourceFolders) {
          state.sourceFolders = res.sourceFolders;
          render();
          refreshWorklist();
          setStatus(t("Đã thêm thư mục nguồn thành công."));
        }
        return;
      }
      const folderPath = window.prompt(t("Nhập đường dẫn thư mục nguồn:"));
      if (!folderPath || !folderPath.trim()) return;
      const res = await api("/api/source-folders/add", {
        method: "POST",
        body: JSON.stringify({ folder: folderPath.trim() }),
      });
      if (res?.sourceFolders) {
        state.sourceFolders = res.sourceFolders;
        render();
        refreshWorklist();
        setStatus(tf("Đã thêm thư mục nguồn: {}", folderPath.trim()));
      }
      return;
    }
    if (name === "remove-source-folder") {
      const folder = element?.dataset?.folder;
      if (!folder) return;
      const res = await api("/api/source-folders/remove", {
        method: "POST",
        body: JSON.stringify({ folder }),
      });
      if (res?.sourceFolders) {
        state.sourceFolders = res.sourceFolders;
        render();
        refreshWorklist();
        setStatus(tf("Đã xóa thư mục nguồn: {}", folder));
      }
      return;
    }
    if (name === "open-folder-explorer") {
      const folder = element?.dataset?.folder;
      if (!folder) return;
      await api("/api/worklist/reveal-folder", {
        method: "POST",
        body: JSON.stringify({ folder }),
      });
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
      state.seriesGroupCache = {};
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
      syncDownloadButton();
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
    if (name === "scale-overlay") {
      state.scaleOverlay = setScaleOverlay(!state.scaleOverlay);
      const button = app.querySelector("[data-action='scale-overlay']");
      if (button) {
        button.classList.toggle("active", state.scaleOverlay);
        button.setAttribute("aria-pressed", state.scaleOverlay ? "true" : "false");
      }
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
    if (name === "video-set-in" || name === "video-set-out") {
      const video = getDomRoot()?.querySelector("#surgery-video-player");
      const at = Number(video?.currentTime) || 0;
      if (name === "video-set-in") {
        state.videoIn = at;
        // A start past the end would leave an inverted range that no button
        // could act on; the reader is marking a new selection, so the old end
        // simply goes.
        if (state.videoOut !== null && state.videoOut <= at) state.videoOut = null;
      } else {
        if (state.videoIn === null || at <= state.videoIn) {
          throw new Error(t("Hãy đặt điểm đầu trước, ở vị trí sớm hơn điểm cuối."));
        }
        state.videoOut = at;
      }
      syncVideoRangeUI();
      setStatus(name === "video-set-in"
        ? tf("Đã đặt điểm đầu tại {}.", formatVideoTime(at))
        : tf("Đã chọn đoạn {} → {}.", formatVideoTime(state.videoIn), formatVideoTime(at)));
      return;
    }
    if (name === "video-clear-range") {
      state.videoIn = null;
      state.videoOut = null;
      syncVideoRangeUI();
      setStatus(t("Đã bỏ đoạn đã đánh dấu."));
      return;
    }
    if (name === "video-apply-shapes") {
      const series = selectedSeries();
      if (!series) return;
      const layer = photoLayer(series);
      const shapes = layerPayload(layer?.shapes || []);
      if (!shapes.length) throw new Error(t("Chưa vẽ gì trên video để áp dụng."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const range = videoRange();
      setStatus(range
        ? tf("Đang ghi {} nét vẽ vào video ({} → {})...", shapes.length,
          formatVideoTime(range.start), formatVideoTime(range.end))
        : tf("Đang ghi {} nét vẽ vào toàn bộ video...", shapes.length));
      const res = await api("/api/media/video/burn-overlay", {
        method: "POST",
        body: JSON.stringify({
          path,
          shapes,
          // No marked range means the drawing belongs to the whole clip, which
          // is what a permanent stamp or a blurred face usually is.
          startSeconds: range ? range.start : null,
          endSeconds: range ? range.end : null,
        }),
      });
      state.videoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      layer.shapes = [];
      layer.past = [];
      layer.future = [];
      currentSurface()?.select(null);
      setVideoElementSrc(getDomRoot()?.querySelector("#surgery-video-player"), res.url);
      syncPhotoStudioUI();
      setStatus(tf("Đã ghi {} nét vẽ vào video.", shapes.length));
      return;
    }
    if (name === "video-tool-trim") {
      const series = selectedSeries();
      if (!series) return;
      // The two `prompt()` boxes this used to open asked a surgeon to read the
      // clock, dismiss the player and type a decimal. The points are marked on
      // the timeline with one key each instead.
      const range = videoRange();
      if (!range) {
        throw new Error(t("Hãy đánh dấu điểm đầu (I) và điểm cuối (O) trên thanh tua trước."));
      }
      setStatus(t("Đang cắt video bằng FFmpeg..."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/trim", {
        method: "POST",
        body: JSON.stringify({
          path,
          startSeconds: range.start,
          endSeconds: range.end,
          reencode: false,
        }),
      });
      state.videoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      // The cut file starts at zero, so points into the old timeline no longer
      // name anything.
      state.videoIn = null;
      state.videoOut = null;
      setVideoElementSrc(getDomRoot()?.querySelector("#surgery-video-player"), res.url);
      syncVideoRangeUI();
      setStatus(tf("Đã cắt đoạn video ({:.1f}s - {:.1f}s) thành công.", range.start, range.end));
      return;
    }
    if (name === "video-tool-burn-text") {
      const series = selectedSeries();
      if (!series) return;
      const domRoot = (typeof app !== "undefined" && app) ? app : (typeof document !== "undefined" ? document : null);
      const video = domRoot?.querySelector("#surgery-video-player");
      // The stamp is the record's own identity, not free text: it is what the
      // clip has to carry to be filed. Asking for it in a prompt() only ever
      // offered this exact string as the default and gave the reader a text
      // box to accidentally mistype a patient's name into. Anything else they
      // want to write goes on with the text tool, where they can see it.
      const text = `${series.patientName || "BN"} - ${new Date().toLocaleDateString()}`;
      setStatus(t("Đang đóng dấu thông tin lên video..."));
      const path = await getVideoSourcePath(series);
      if (!path) throw new Error(t("Không tìm thấy đường dẫn video gốc."));
      const res = await api("/api/media/video/burn-text", {
        method: "POST",
        body: JSON.stringify({
          path,
          // The engine's dataclass field is `color`; sending `font_color` made
          // every stamp fail server-side with a TypeError.
          overlays: [{ text, x: 24, y: 24, fontSize: 24, color: "yellow", box: true }],
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
      await rotateWorkingPhoto(90);
      return;
    }
    if (name === "photo-rotate-ccw") {
      await rotateWorkingPhoto(-90);
      return;
    }
    if (name === "photo-pick-tool") {
      setPhotoTool(element?.dataset?.tool || "select");
      return;
    }
    if (name === "photo-pick-color") {
      applyPhotoStyle({ color: String(element?.dataset?.color || "#ff3b30") });
      return;
    }
    if (name === "photo-delete-shape") {
      currentSurface()?.deleteSelected();
      return;
    }
    if (name === "photo-clear-shapes") {
      currentSurface()?.clearShapes();
      setStatus(t("Đã xoá các nét vẽ chưa áp dụng."));
      return;
    }
    if (name === "photo-zoom-in") {
      stepPhotoZoom(1.25);
      return;
    }
    if (name === "photo-zoom-out") {
      stepPhotoZoom(0.8);
      return;
    }
    if (name === "photo-zoom-fit") {
      state.photoZoom = 0;
      applyPhotoZoom();
      return;
    }
    if (name === "photo-apply-shapes") {
      const series = selectedSeries();
      if (!series) return;
      const count = pendingShapeCount(series);
      if (!count) throw new Error(t("Chưa vẽ gì trên ảnh để áp dụng."));
      await flattenPhotoLayer(series);
      setStatus(tf("Đã vẽ {} chi tiết lên ảnh.", count));
      return;
    }
    if (name === "photo-apply-crop") {
      const series = selectedSeries();
      if (!series) return;
      const rect = currentSurface()?.cropRect();
      if (!rect) throw new Error(t("Hãy kéo chuột trên ảnh để chọn vùng cần cắt."));
      // Anything already drawn is burned in first: the crop rewrites the
      // coordinate space, so shapes carried across it would land somewhere the
      // reader never put them.
      const path = await flattenPhotoLayer(series, { silent: true });
      setStatus(t("Đang cắt ảnh..."));
      const res = await api("/api/media/photo/crop", {
        method: "POST",
        body: JSON.stringify({ path, rect }),
      });
      state.photoWorkingPath = res.outputPath;
      pushMediaEdit(series, res);
      currentSurface()?.clearCrop();
      setMediaElementSrc(getDomRoot()?.querySelector("#photo-editor-img"), res.url);
      setPhotoTool("select");
      setStatus(tf("Đã cắt ảnh còn {}×{} px.", rect.width, rect.height));
      return;
    }
    if (name === "photo-export-image") {
      const series = selectedSeries();
      if (!series) return;
      // Export means "what I am looking at", so the layer goes on first.
      await flattenPhotoLayer(series, { silent: true });
      const path = state.photoWorkingPath;
      if (!path) {
        throw new Error(t("Ảnh chưa có chỉnh sửa nào; hãy mở file gốc trong thư mục hồ sơ."));
      }
      const workName = workFileName(path);
      await downloadApiFile(
        `/api/media/work-file?name=${encodeURIComponent(workName)}`,
        `${series.patientName || "anh"}_${Date.now()}.jpg`,
      );
      setStatus(t("Đã tải ảnh đã chỉnh sửa về máy."));
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

// Documents the scan found, keyed by study so a patient folder only receives
// the reports that belong to that study.
function attachmentsByStudy() {
  const byStudy = {};
  state.seriesInventory.forEach((group) => {
    if (group.studyUid && group.studyUid !== "direct" && group.attachments?.length) {
      byStudy[group.studyUid] = group.attachments;
    }
  });
  return byStudy;
}

function downloadOptions() {
  const options = {
    outputRoot: state.bootstrap.outputRoot,
    quality: Number(app.querySelector("#quality").value || 100),
    showBrowser: app.querySelector("#show-browser").checked,
    downloadAllFiles: state.downloadAllFiles,
    downloadAttachments: Boolean(state.downloadAttachments),
    attachments: discoveredAttachments(),
    attachmentsByStudy: attachmentsByStudy(),
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
  // The unflattened drawing belongs to the record it was drawn on. Left in the
  // shared state it would follow the reader to the next patient's tab and put
  // one patient's annotations over another's photo.
  tab.photoLayers = state.photoLayers || {};
  tab.videoIn = state.videoIn;
  tab.videoOut = state.videoOut;
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
  state.photoLayers = tab?.photoLayers || {};
  state.videoIn = tab?.videoIn ?? null;
  state.videoOut = tab?.videoOut ?? null;
  state.videoDuration = 0;
  state.photoTool = "select";
  state.photoZoom = 0;
  destroyActiveSurface();
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
    currentTab.editingPatientInfo = Boolean(state.editingPatientInfo);
    if (state.editingPatientInfo) {
      currentTab.patientEditDraft = patientInfoFromForm(
        app?.querySelector("[data-field='patient-edit-form']"),
      ) || state.patientEditDraft;
    } else {
      currentTab.patientEditDraft = null;
    }
    saveMediaWorkspaceToTab(currentTab);
  }
  clearViewer();
  state.activeTabId = tabId;
  if (tabId === "worklist") {
    // The worklist scans the shared archive, not one patient's session.
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
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
    state.editingPatientInfo = Boolean(targetTab.editingPatientInfo);
    state.patientEditDraft = targetTab.patientEditDraft
      ? { ...targetTab.patientEditDraft }
      : null;
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

/**
 * Series names a study carries for the scanner's benefit, not the reader's.
 *
 * Every one of these is a real series in the archive and stays in the list —
 * this only decides which series is *open* when a record is first shown.
 */
const NON_DIAGNOSTIC_SERIES = /screen\s*save|dose\s*report|scout|localiz|survey|patient\s*protocol|summary/i;

/**
 * Which series to show when a record opens.
 *
 * Opening `series[0]` meant a study whose first series is a three-image
 * "Screen Save" — which is how several scanners order their output — opened on
 * a screenshot instead of on the images. The choice here is mechanical and
 * makes no clinical claim: the newest study, a real imaging series rather than
 * a video or a document, boilerplate last, then the longest stack. Which
 * sequence a reader wants first is protocol- and case-dependent, so it stays
 * their decision.
 */
export function pickInitialSeries(seriesList) {
  const list = (seriesList || []).filter(Boolean);
  if (list.length === 0) return "";

  const imaging = list.filter((item) => (item.mediaType || "dicom") === "dicom");
  const pool = imaging.length ? imaging : list;

  const newestDate = pool.reduce((latest, item) => {
    const date = String(item.studyDate || "");
    return date > latest ? date : latest;
  }, "");
  const sameStudy = newestDate
    ? pool.filter((item) => String(item.studyDate || "") === newestDate)
    : pool;

  const boilerplate = (item) =>
    NON_DIAGNOSTIC_SERIES.test(String(item.description || item.name || "")) ? 1 : 0;

  const ranked = [...sameStudy].sort((a, b) => {
    const rank = boilerplate(a) - boilerplate(b);
    if (rank !== 0) return rank;
    return (Number(b.sliceCount) || 0) - (Number(a.sliceCount) || 0);
  });
  return ranked[0]?.id || list[0].id;
}

function applyArchive(archive, sessionId = "", folder = "") {
  state.archive = archive;
  for (const series of archive.series) registerSeries(series);
  if (!archive.series.some((item) => item.id === state.selectedId)) {
    state.selectedId = pickInitialSeries(archive.series);
  }
  fillCompareSlots("compare3");
  state.mode = "single";
  state.tool = "window";
  state.windowPreset = defaultWindowPreset(selectedSeries());

  const tabName = archive.root ? archive.root.split(/[\\/]/).pop() : (archive.patient?.patientName || "Bệnh nhân");
  let currentTab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!currentTab || state.activeTabId === "worklist") {
    resetMediaWorkspace();
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
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
      editingPatientInfo: false,
      patientEditDraft: null,
      mediaIndex: state.mediaIndex,
      mediaEdits: state.mediaEdits,
      photoLayers: {},
      videoIn: null,
      videoOut: null,
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
      // The scale bar only survives on a series with real spacing, so the
      // button follows what the viewer actually turned on rather than what was
      // last asked for.
      const scaleBarOn = scaleOverlayState();
      if (scaleBarOn !== state.scaleOverlay) {
        state.scaleOverlay = scaleBarOn;
        const scaleButton = app.querySelector("[data-action='scale-overlay']");
        if (scaleButton) {
          scaleButton.classList.toggle("active", scaleBarOn);
          scaleButton.setAttribute("aria-pressed", scaleBarOn ? "true" : "false");
        }
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

/**
 * Keys the photo studio claims while it is the pane on screen.
 *
 * The reading-view shortcuts are single letters — r resets, c is the crosshair,
 * p captures — and every drawing application binds those same letters to tools.
 * Both sets can exist because only one pane is ever mounted: this runs first and
 * says whether it consumed the key, and the viewer's bindings are left untouched
 * for the reading canvas.
 *
 * Returns true when the key was handled.
 */
function handlePhotoStudioKey(event) {
  const series = selectedSeries();
  if (!isDrawStudio(series) || !currentSurface()) return false;

  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      action(event.shiftKey ? "media-edit-redo" : "media-edit-undo");
      return true;
    }
    if (key === "y") {
      event.preventDefault();
      action("media-edit-redo");
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      action("photo-apply-shapes");
      return true;
    }
    return false;
  }
  if (event.altKey) return false;

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    action("photo-delete-shape");
    return true;
  }
  if (event.key === "Escape") {
    currentSurface()?.clearCrop();
    currentSurface()?.select(null);
    syncPhotoStudioUI();
    return true;
  }
  if (event.key === "+" || event.key === "=") {
    action("photo-zoom-in");
    return true;
  }
  if (event.key === "-" || event.key === "_") {
    action("photo-zoom-out");
    return true;
  }
  if (event.key === "0") {
    action("photo-zoom-fit");
    return true;
  }
  if (event.key === " " && isPhotoStudio(series)) {
    // The surface reads the held key directly; this only stops the page from
    // scrolling and stops the reading view from starting a cine loop.
    event.preventDefault();
    return true;
  }
  // In and out points belong to the player, so they are only claimed there.
  if (getSeriesMediaType(series) === "video") {
    if (event.key.toLowerCase() === "i") {
      action("video-set-in");
      return true;
    }
    if (event.key.toLowerCase() === "o") {
      action("video-set-out");
      return true;
    }
    if (event.key === " ") {
      event.preventDefault();
      action("video-play-pause");
      return true;
    }
  }
  const tool = ANNOTATOR_TOOLS.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
  if (tool) {
    setPhotoTool(tool.id);
    return true;
  }
  return false;
}

function installKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    // F11 / Esc zen mode — works even in text fields
    if (event.key === "F11") {
      event.preventDefault();
      action("window-fullscreen");
      return;
    }
    if (event.key === "Escape" && document.querySelector(".app-shell.zen-mode")) {
      event.preventDefault();
      action("window-fullscreen");
      return;
    }
    if (isTypingTarget(event.target)) return;

    if (handlePhotoStudioKey(event)) return;

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
    cacheSeriesGroups(state.seriesInventory);
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
      const folder = job.result?.patientFolder || job.result?.output || archive.root || "";
      const sessionId = job.result?.sessionId || "";
      if (!sessionId) {
        setStatus(t("Không tạo được phiên riêng cho hồ sơ vừa tải."), true);
        refreshHistory();
        refreshWorklist();
        return;
      }
      setApiSession(sessionId);
      applyArchive(archive, sessionId, folder);
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
    const isAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) <= 35;
    const oldScrollTop = log.scrollTop;
    log.textContent = (job.logs || []).map(translateLog).join("\n");
    if (isAtBottom) {
      log.scrollTop = log.scrollHeight;
    } else {
      log.scrollTop = oldScrollTop;
    }
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

// The native bridge classifies the clipboard as a patient ID or viewer URL, so
// each field receives only its own shape. Clipboard refresh is tied to the app
// window regaining focus, never to input mouse events: the fields retain normal
// caret placement, drag selection, Ctrl+V and manual editing.
const CLIPBOARD_FIELDS = [
  { id: "patient-id", kind: "patientId" },
  { id: "direct-url", kind: "url" },
];

async function clipboardValueFor(kind) {
  if (!window.pywebview?.api?.read_clipboard) return "";
  try {
    return (await window.pywebview.api.read_clipboard())?.[kind] || "";
  } catch (_) {
    // Another process can briefly hold the clipboard open; this refresh simply
    // skips and the next app-focus event tries again.
    return "";
  }
}

function syncClearButton(field) {
  const button = app.querySelector(`[data-action="clear-${field.id}"]`);
  if (button) button.hidden = !field.value;
}

async function fillFromClipboard(field, kind) {
  const value = await clipboardValueFor(kind);
  if (!value || value === field.value.trim()) return false;
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
  syncClearButton(field);
  field.focus();
}

function installClipboardField(field, kind) {
  field.addEventListener("input", () => {
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
  state.sourceFolders = Array.isArray(state.bootstrap.sourceFolders) ? state.bootstrap.sourceFolders : [];
  const bootstrapWorklist = state.bootstrap.worklist || {};
  state.worklistPatients = Array.isArray(bootstrapWorklist.patients)
    ? bootstrapWorklist.patients
    : [];
  state.worklistLoaded = !bootstrapWorklist.deferred;
  state.worklistLoading = false;
  state.worklistError = "";
  state.lastDirectUrl = state.bootstrap.lastDirectUrl || "";
  state.showManualInfo = Boolean(state.lastDirectUrl.trim());
  state.status = "Đang khởi động...";
  state.archive = state.bootstrap.archive;
  const initialSessionId = state.bootstrap.archiveSessionId || "";
  if (initialSessionId) setApiSession(initialSessionId);
  state.selectedId = pickInitialSeries(state.archive.series);
  state.compareIds = [
    state.archive.series[1]?.id || state.selectedId,
    state.archive.series[2]?.id || state.archive.series[1]?.id || state.selectedId,
  ];
  if (state.archive.series && state.archive.series.length > 0) {
    const tabName = state.archive.root ? state.archive.root.split(/[\\/]/).pop() : (state.archive.patient?.patientName || "Bệnh nhân 1");
    const initialTab = {
      id: "tab-init",
      sessionId: initialSessionId,
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
      editingPatientInfo: false,
      patientEditDraft: null,
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
  installWindowStateWatcher();
  // Releasing the GPU contexts on close keeps a WebView2 restart from
  // inheriting a page that still holds them.
  window.addEventListener("pagehide", disposeViewer);
  window.addEventListener("focus", autoPasteFromClipboard);
  state.status = t("Sẵn sàng. Nhấn ⌨ trên thanh công cụ để xem phím tắt.");
  render();
  autoPasteFromClipboard();
  // The scan walks every study folder, so it is not awaited: the Worklist shows
  // its loading state and swaps to real rows only when the disk scan lands.
  refreshWorklist();
  await renderViewer();
}

const isRunningInTest = (typeof process !== "undefined" && Boolean(process.env?.VITEST)) || (typeof import.meta !== "undefined" && import.meta.env?.MODE === "test");

if (!isRunningInTest) {
  boot().catch((error) => {
    // A stored token the server rejects would come back on every reload, so
    // the Reload button could never recover. Drop it and let the next start
    // ask for a fresh one.
    if (/\b(401|403)\b/.test(String(error?.message || ""))) forgetSessionToken();
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
  renderWindowControls,
  applyWindowState,
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
  photoLayer,
  pendingShapeCount,
  selectedSeries,
  setPhotoTool,
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
  switchTab,
  applyArchive,
  bindEvents,
};
