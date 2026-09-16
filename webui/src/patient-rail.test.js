// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import { resetClinicalState } from "./clinical.js";
import {
  state,
  renderPatientRail,
  isValidTimelineDateKey,
  buildMediaTimeline,
  downloadPanelVisible,
  bindTextViewerButtons,
  action,
  switchTab,
  render,
  installKeyboardShortcuts,
} from "./main.js";

const PATIENT = {
  patientId: "2607063527",
  patientName: "NGUYỄN HỮU SỰ",
  birthYear: "1962",
  age: "63",
  gender: "Nam",
  hospital: "BV Hà Tĩnh",
  diagnosis: "",
};

const SERIES = [
  { id: "s1", timelineKey: "mr-study", studyDate: "20260806", mediaType: "dicom", modality: "MR", studyDescription: "MR sọ não có tiêm", sliceCount: 1412, mprReady: true },
  { id: "s1b", timelineKey: "mr-study", studyDate: "20260806", mediaType: "dicom", modality: "MR", studyDescription: "MR sọ não có tiêm", description: "Ax T2 FLAIR", sliceCount: 28 },
  { id: "s2", timelineKey: "photos", studyDate: "20260806", mediaType: "photo", studyDescription: "Ảnh đối chiếu", sliceCount: 4 },
  { id: "s3", timelineKey: "operation", studyDate: "20260702", mediaType: "video", studyDescription: "Mổ nội soi ổ bụng", sliceCount: 2 },
  { id: "s4", timelineKey: "report", studyDate: "", mediaType: "text", studyDescription: "Tường trình phẫu thuật", sliceCount: 1 },
];

const originalFetch = global.fetch;

/** Put the shell on screen the way the app does. */
function mountApp() {
  if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
  render();
}

/** Press a button the way a person does, then let the repaint settle. */
async function press(selector) {
  const button = document.querySelector(selector);
  expect(button, `no button matched ${selector}`).not.toBeNull();
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Viewer tab: patient rail", () => {
  beforeEach(() => {
    setLanguage("vi");
    if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
    state.activeTabId = "tab-1";
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
    // The record card shares one state object with the whole window, and the
    // pencil hides while the form is open — a test that left it open would
    // take the pencil away from the next one.
    resetClinicalState();
    state.tabs = [];
    state.worklistPatients = [];
    state.selectedId = "s1";
    state.archive = { root: "D:\\PACS\\BN", patient: { ...PATIENT }, series: SERIES.map((s) => ({ ...s })) };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists one row per examination, newest first, undated last", () => {
    const timeline = buildMediaTimeline(SERIES);

    // The row reads the way the reader's hospital PACS writes it: what kind of
    // examination, and when. Nothing else.
    expect(timeline.map((row) => row.title)).toEqual([
      "MR - 06/08/2026",
      "Ảnh - 06/08/2026",
      "Video - 02/07/2026",
      // Paperwork with no date is named by the folder it sits in; a row
      // reading "Văn bản - Chưa rõ ngày chụp" tells the reader nothing.
      "Văn bản - Tường trình phẫu thuật",
    ]);
    expect(timeline[0].series).toHaveLength(2);
    expect(timeline[0].sourceFormat).toBe("DICOM");
    expect(timeline[1].sourceFormat).toBe("JPG");
    expect(timeline[2].sourceFormat).toBe("MP4");
    expect(timeline[3].sourceFormat).toBe("TXT");
  });

  it("names the exam only when two of one kind share a day", () => {
    const rows = buildMediaTimeline([
      { id: "a", timelineKey: "us-1", studyDate: "20260817", mediaType: "dicom", modality: "US", studyDescription: "Ổ bụng" },
      { id: "b", timelineKey: "us-2", studyDate: "20260817", mediaType: "dicom", modality: "US", studyDescription: "Tuyến giáp" },
      { id: "c", timelineKey: "dx-1", studyDate: "20260817", mediaType: "dicom", modality: "DX", studyDescription: "Ngực thẳng" },
    ]);

    expect(rows.map((row) => row.title)).toEqual([
      "US - 17/08/2026 · Ổ bụng",
      "US - 17/08/2026 · Tuyến giáp",
      "DX - 17/08/2026",
    ]);
  });

  it("rejects non-date numeric identifiers such as patient IDs from becoming dates", () => {
    expect(isValidTimelineDateKey("24100283")).toBe(false); // day 83 is impossible
    expect(isValidTimelineDateKey("20260817")).toBe(true);
    const rows = buildMediaTimeline([
      {
        id: "pdf-1",
        studyDate: "",
        studyGroup: "2410028324-PHAM BINH NGUYEN-15T-U sao bào vàng, tái phát",
        mediaType: "pdf",
        description: "Bệnh án PDF",
      },
    ]);
    expect(rows[0].dateKey).toBe("");
    expect(rows[0].title).toBe("Bệnh án PDF - Bệnh án PDF");
  });

  it("shows the identity the manifest recorded", () => {
    const html = renderPatientRail();

    expect(html).toContain("NGUYỄN HỮU SỰ");
    expect(html).toContain("2607063527");
    expect(html).toContain("Nam · 1962 · 63 tuổi");
    expect(html).toContain("BV Hà Tĩnh");
  });

  it("prints a dash for every field the manifest does not carry", () => {
    // Phone and address have no source in a local archive — no RIS, no DICOM
    // tag — so they stay dashes until a clinician types one.
    const html = renderPatientRail();
    expect(html).toMatch(/<dd>—<\/dd>/);
    // And the note line is absent rather than empty: nothing was written.
    expect(html).not.toContain('class="dx-note"');

    state.archive.patient = {};
    const blank = renderPatientRail();
    expect(blank).toContain("Chưa có tên bệnh nhân");
    // Nothing is filled in from the folder path or from another patient.
    expect(blank).not.toContain("NGUYỄN HỮU SỰ");
    expect(blank).not.toContain("1962");
  });

  it("shows one row per examination, with no counts and no sequence names", () => {
    const html = renderPatientRail();

    expect(html).toContain('class="tl-item dicom on"');
    expect((html.match(/data-timeline-key="mr-study"/g) || [])).toHaveLength(1);
    // A count of series or photos beside the row is exactly what the reader
    // does not want there, and a sequence name belongs in the series strip.
    expect(html).not.toContain("Ax T2 FLAIR");
    expect(html).not.toMatch(/\d+ (phim|series|ảnh|photos|lát|slices|video)/);
    expect(html).toContain('class="tl-item photo"');
    expect(html).toContain('class="tl-item video"');
    expect(html).toContain('class="tl-item text"');
    expect(html).toContain('class="tl-source-pill dicom"');
    expect(html).toContain('class="tl-source-pill jpg"');
  });

  it("keeps technical sequences out of the exam history", () => {
    const html = renderPatientRail();

    expect(html).not.toContain("Ax T2 FLAIR");
    expect(html).not.toContain('data-action="toggle-timeline-row"');
    expect(html).not.toContain('class="tl-sub"');
  });

  it("drives selection through the same handler as the thumbnail strip", () => {
    // Sharing `data-series-id` is what keeps the rail and the strip on one
    // selection instead of two that can disagree.
    const html = renderPatientRail();
    expect(html).toContain('data-series-id="s1"');
    expect((html.match(/class="tl-open"/g) || []).length).toBe(4);
  });

  it("uses the local custom study name and exposes an inline editor", () => {
    state.archive.patient.timelineLabels = { "mr-study": "MRI sọ não theo dõi" };
    const html = renderPatientRail();

    expect(html).toContain("MRI sọ não theo dõi");
    expect(html).toContain('data-action="edit-timeline-label"');
    expect(html).toContain('class="tl-name-input"');
  });

  it("saves an edited study name to the patient timeline endpoint", async () => {
    document.body.innerHTML = `<div id="app">${renderPatientRail()}</div>`;
    const row = document.querySelector('[data-timeline-key="mr-study"]');
    await action("edit-timeline-label", row.querySelector('[data-action="edit-timeline-label"]'));
    expect(row.classList.contains("editing")).toBe(true);
    row.querySelector(".tl-name-input").value = "MR sọ não sau mổ";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        patient: { ...PATIENT, timelineLabels: { "mr-study": "MR sọ não sau mổ" } },
        timelineKey: "mr-study",
        label: "MR sọ não sau mổ",
      }),
    });

    await action("save-timeline-label", row.querySelector('[data-action="save-timeline-label"]'));

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(global.fetch.mock.calls[0][0]).toBe("/api/patient/timeline-label");
    expect(payload).toMatchObject({ timelineKey: "mr-study", label: "MR sọ não sau mổ" });
    expect(state.archive.patient.timelineLabels["mr-study"]).toBe("MR sọ não sau mổ");
    expect(row.querySelector(".nm").textContent).toBe("MR sọ não sau mổ");
    expect(row.classList.contains("editing")).toBe(false);
  });

  it("falls back to the media kind when the modality was never recorded", () => {
    state.archive.series = [{ id: "x", studyDate: "20260806", mediaType: "dicom", studyDescription: "Ca chưa quét" }];
    const html = renderPatientRail();

    expect(html).toContain("Phim chụp - 06/08/2026");
    expect(html).not.toContain("lát");
  });

  it("says so plainly when the record is empty", () => {
    state.archive.series = [];
    expect(renderPatientRail()).toContain("Chưa có dữ liệu nào trong hồ sơ này.");
  });

  it("does not render the history card on the patient rail", () => {
    state.history = [{ folder: "D:\\PACS\\BN_01", time: "10/08 14:00", exists: true }];
    const html = renderPatientRail();
    expect(html).not.toContain("rec-history-card");
  });

  it("renders patient info card with phone, address, and edit button aligned with patient name", () => {
    state.archive.patient.phone = "0912345678";
    state.archive.patient.address = "Hà Nội";
    const html = renderPatientRail();
    expect(html).toContain("rec-info-card");
    expect(html).toContain("rec-name-row");
    expect(html).toContain("0912345678");
    expect(html).toContain("Hà Nội");
    expect(html).toContain('data-action="edit-record"');
    // Button should only contain the icon glyph '✎', not trailing text
    expect(html).toContain('>✎</button>');
    // Header title 'Thông tin bệnh nhân' is removed
    expect(html).not.toContain("Thông tin bệnh nhân");
  });

  it("opens one form in the reading pane rather than unfolding the rail", async () => {
    // Who the patient is and what has been recorded about them are one record
    // to the doctor, and the rail is 246px wide.
    mountApp();
    await press('[data-action="edit-record"]');

    expect(state.editingPatientInfo).toBe(true);
    expect(document.querySelector('.rec-rail [data-field="patient-edit-form"]')).toBeNull();
    expect(document.querySelector('#workspace [data-field="patient-edit-form"]')).not.toBeNull();
    expect(document.querySelector('#workspace [data-action="save-record"]')).not.toBeNull();
    expect(document.querySelector('#workspace [data-action="cancel-record"]')).not.toBeNull();
    // The rail says where the form went instead of showing a stale copy.
    expect(document.querySelector(".rec-rail").textContent)
      .toContain("Đang sửa ở khung bên phải");
  });

  it("allows entering edit mode and saving updated patient information", async () => {
    mountApp();
    await press('[data-action="edit-record"]');
    expect(state.editingPatientInfo).toBe(true);

    const form = document.querySelector('[data-field="patient-edit-form"]');
    expect(form).not.toBeNull();
    form.querySelector('input[name="patientName"]').value = "NGUYỄN THỊ MỚI";
    form.querySelector('input[name="phone"]').value = "0988112233";
    form.querySelector('input[name="address"]').value = "TP. Hồ Chí Minh";

    // One press writes both halves, so the mock answers by route.
    global.fetch = vi.fn(async (url) => ({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => (String(url).includes("/api/patient/update")
        ? {
          patient: {
            ...PATIENT,
            patientName: "NGUYỄN THỊ MỚI",
            phone: "0988112233",
            address: "TP. Hồ Chí Minh",
          },
        }
        : {}),
    }));

    await press('[data-action="save-record"]');

    expect(global.fetch).toHaveBeenCalled();
    const [endpoint, req] = global.fetch.mock.calls[0];
    expect(endpoint).toBe("/api/patient/update");
    const payload = JSON.parse(req.body);
    expect(payload.info.patientName).toBe("NGUYỄN THỊ MỚI");
    expect(payload.info.phone).toBe("0988112233");
    expect(payload.info.address).toBe("TP. Hồ Chí Minh");
    expect(state.editingPatientInfo).toBe(false);
    expect(state.archive.patient.patientName).toBe("NGUYỄN THỊ MỚI");
    expect(state.archive.patient.phone).toBe("0988112233");
  });

  it("isolates patient edit state across multiple tabs", async () => {
    const tab1 = {
      id: "tab-1",
      patientId: "BN01",
      patientName: "Bệnh nhân 1",
      archive: { root: "D:\\PACS\\BN01", patient: { patientId: "BN01", patientName: "Bệnh nhân 1" }, series: [] },
      selectedId: "",
      compareIds: [],
      mode: "single",
      tool: "window",
      windowPreset: null,
      mprPrimary: "axial",
      status: "Sẵn sàng.",
      editingPatientInfo: false,
    };
    const tab2 = {
      id: "tab-2",
      patientId: "BN02",
      patientName: "Bệnh nhân 2",
      archive: { root: "D:\\PACS\\BN02", patient: { patientId: "BN02", patientName: "Bệnh nhân 2" }, series: [] },
      selectedId: "",
      compareIds: [],
      mode: "single",
      tool: "window",
      windowPreset: null,
      mprPrimary: "axial",
      status: "Sẵn sàng.",
      editingPatientInfo: false,
    };
    state.tabs = [tab1, tab2];
    state.activeTabId = "tab-1";
    state.archive = tab1.archive;

    // Enable edit mode on tab-1
    mountApp();
    await press('[data-action="edit-record"]');
    expect(state.editingPatientInfo).toBe(true);
    expect(tab1.editingPatientInfo).toBe(true);
    document.querySelector('input[name="patientName"]').value = "Bản nháp tab 1";

    // Switch to tab-2: tab-2 should NOT be carrying tab-1's draft
    await switchTab("tab-2");
    expect(state.activeTabId).toBe("tab-2");
    expect(state.editingPatientInfo).toBe(false);
    expect(tab2.editingPatientInfo).toBe(false);
    expect(document.querySelector('input[name="patientName"]')).toBeNull();

    // Switch back to tab-1: the draft it was holding is still there, and the
    // pencil opens it again rather than starting over from the manifest.
    await switchTab("tab-1");
    expect(state.activeTabId).toBe("tab-1");
    expect(state.editingPatientInfo).toBe(true);
    await press('[data-action="edit-record"]');
    expect(document.querySelector('input[name="patientName"]').value).toBe("Bản nháp tab 1");

    // Cancel edit mode on tab-1
    await press('[data-action="cancel-record"]');
    expect(state.editingPatientInfo).toBe(false);
    expect(tab1.editingPatientInfo).toBe(false);
  });

  it("applies a slow save response only to the tab that submitted it", async () => {
    const tab1 = {
      id: "tab-1",
      patientId: "BN01",
      patientName: "Bệnh nhân 1",
      folder: "D:\\PACS\\BN01",
      archive: { root: "D:\\PACS\\BN01", patient: { patientId: "BN01", patientName: "Bệnh nhân 1" }, series: [] },
      selectedId: "", compareIds: [], mode: "single", tool: "window",
      windowPreset: null, mprPrimary: "axial", status: "Sẵn sàng.",
      editingPatientInfo: false, patientEditDraft: null,
    };
    const tab2 = {
      id: "tab-2",
      patientId: "BN02",
      patientName: "Bệnh nhân 2",
      folder: "D:\\PACS\\BN02",
      archive: { root: "D:\\PACS\\BN02", patient: { patientId: "BN02", patientName: "Bệnh nhân 2" }, series: [] },
      selectedId: "", compareIds: [], mode: "single", tool: "window",
      windowPreset: null, mprPrimary: "axial", status: "Sẵn sàng.",
      editingPatientInfo: false, patientEditDraft: null,
    };
    state.tabs = [tab1, tab2];
    state.activeTabId = tab1.id;
    state.archive = tab1.archive;
    state.worklistPatients = [{
      patientId: "BN01", patientName: "Bệnh nhân 1", folder: tab1.folder,
    }];

    mountApp();
    await press('[data-action="edit-record"]');
    document.querySelector('input[name="patientId"]').value = "BN01-NEW";
    document.querySelector('input[name="patientName"]').value = "Bệnh nhân đã sửa";

    let resolveFetch;
    // Only the save is held open. Switching tabs also fetches that tab's
    // clinical record, and a mock that deferred every call would hand the
    // resolver below to whichever request went out last.
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/patient/update")) {
        return new Promise((resolve) => { resolveFetch = resolve; });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      });
    });
    const save = action(
      "save-record",
      document.querySelector('[data-action="save-record"]'),
    );
    await Promise.resolve();
    await switchTab(tab2.id);

    resolveFetch({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        patient: {
          patientId: "BN01-NEW",
          patientName: "Bệnh nhân đã sửa",
          gender: "",
          birthYear: "",
          hospital: "",
        },
      }),
    });
    await save;

    expect(state.activeTabId).toBe(tab2.id);
    expect(state.archive.patient.patientId).toBe("BN02");
    expect(tab2.archive.patient.patientName).toBe("Bệnh nhân 2");
    expect(tab1.archive.patient.patientId).toBe("BN01-NEW");
    expect(tab1.patientName).toBe("Bệnh nhân đã sửa");
    expect(state.worklistPatients[0].patientId).toBe("BN01-NEW");
    // And the clinical half never went out. `clinicalState` is one object for
    // the window, so by now it holds tab 2's record — writing it would put
    // tab 2's diagnosis into tab 1's folder.
    const written = global.fetch.mock.calls
      .filter(([url, options]) => String(url).includes("/api/patient/clinical")
        && options?.method === "POST");
    expect(written).toEqual([]);
  });
});

describe("Download column belongs to the worklist tab", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.downloadOpen = true;
    state.archive = { root: "", patient: {}, series: [] };
  });

  it("shows the download column on the worklist and hides it in a viewer tab", () => {
    state.activeTabId = "worklist";
    expect(downloadPanelVisible()).toBe(true);

    // A viewer tab gives that same column to the patient rail, so the two
    // never compete for the left edge.
    state.activeTabId = "tab-1";
    expect(downloadPanelVisible()).toBe(false);
  });

  it("still respects the collapse toggle while on the worklist", () => {
    state.activeTabId = "worklist";
    state.downloadOpen = false;
    expect(downloadPanelVisible()).toBe(false);
  });
});

describe("Boot with an empty archive", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "worklist";
    state.textDoc = null;
    state.selectedId = "";
    state.archive = { root: "", patient: {}, series: [] };
  });

  it("wires the text pane without a loaded document or a selected series", () => {
    // `state.textDoc?.seriesId === series?.id` compares undefined to undefined
    // and passes, so the old code dereferenced a null document here and the
    // app died on startup with "Cannot read properties of null".
    document.body.innerHTML = `<div id="app"></div>`;
    expect(() => bindTextViewerButtons(document.querySelector("#app"))).not.toThrow();
  });

  it("renders the rail and an empty timeline instead of throwing", () => {
    expect(() => renderPatientRail()).not.toThrow();
    expect(renderPatientRail()).toContain("Chưa có dữ liệu nào trong hồ sơ này.");
  });
});

describe("Collapsible Patient Rail and Download Panel", () => {
  beforeEach(() => {
    setLanguage("vi");
    if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
    state.activeTabId = "tab-1";
    state.patientRailCollapsed = false;
    state.downloadOpen = true;
    state.archive = { root: "D:\\PACS\\BN", patient: { ...PATIENT }, series: SERIES.map((s) => ({ ...s })) };
    state.selectedId = "s1";
    state.tabs = [{ id: "tab-1", title: "BN01", patientName: "BN01" }];
  });

  it("renders the patient rail header with title and collapse button", () => {
    const markup = renderPatientRail();
    expect(markup).toContain('class="rec-rail-header"');
    expect(markup).toContain('class="rec-rail-title"');
    expect(markup).toContain("Thông tin ca");
    expect(markup).toContain('data-action="toggle-patient-rail"');
  });

  it("toggles patient rail collapsed state via real DOM click on toggle button", () => {
    render();
    const appEl = document.querySelector("#app");
    const toggleBtn = appEl.querySelector(".rail-toggle-btn");
    expect(toggleBtn).not.toBeNull();
    expect(state.patientRailCollapsed).toBe(false);

    // Real DOM click event
    toggleBtn.click();
    expect(state.patientRailCollapsed).toBe(true);
    expect(appEl.querySelector(".viewer-main")?.classList.contains("rail-collapsed")).toBe(true);

    // Expand trigger should now be visible and clickable
    const expandBtn = appEl.querySelector(".rail-expand-trigger");
    expect(expandBtn).not.toBeNull();
    expect(expandBtn.hidden).toBe(false);

    // Real DOM click to re-expand
    expandBtn.click();
    expect(state.patientRailCollapsed).toBe(false);
    expect(appEl.querySelector(".viewer-main")?.classList.contains("rail-collapsed")).toBe(false);
    expect(expandBtn.hidden).toBe(true);
  });

  it("supports keyboard shortcut [ to toggle patient rail in viewer", () => {
    installKeyboardShortcuts();
    render();
    expect(state.patientRailCollapsed).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    expect(state.patientRailCollapsed).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    expect(state.patientRailCollapsed).toBe(false);
  });

  it("toggles download panel in worklist and shows expand trigger when collapsed", () => {
    state.activeTabId = "worklist";
    state.downloadOpen = true;
    render();
    const appEl = document.querySelector("#app");

    const collapseBtn = appEl.querySelector(".panel-toggle-btn");
    expect(collapseBtn).not.toBeNull();

    // Click collapse button
    collapseBtn.click();
    expect(state.downloadOpen).toBe(false);
    expect(appEl.querySelector(".app-shell")?.classList.contains("download-collapsed")).toBe(true);

    // Expand trigger should be visible
    const expandTrigger = appEl.querySelector(".download-expand-trigger");
    expect(expandTrigger).not.toBeNull();
    expect(expandTrigger.hidden).toBe(false);

    // Click expand trigger to re-open
    expandTrigger.click();
    expect(state.downloadOpen).toBe(true);
    expect(appEl.querySelector(".app-shell")?.classList.contains("download-collapsed")).toBe(false);
    expect(expandTrigger.hidden).toBe(true);
  });

  it("renders vertical rail strip with title and allows clicking strip itself to re-expand", () => {
    // 1. Viewer rail
    state.activeTabId = "tab-test";
    state.patientRailCollapsed = true;
    render();
    const appEl = document.querySelector("#app");
    const viewerStrip = appEl.querySelector(".viewer-main .rail-collapsed-strip");
    expect(viewerStrip).not.toBeNull();
    const viewerTitle = viewerStrip.querySelector(".rail-vertical-title");
    expect(viewerTitle?.textContent).toContain("Thông tin ca");

    // Click strip itself
    viewerStrip.click();
    expect(state.patientRailCollapsed).toBe(false);
    expect(appEl.querySelector(".viewer-main")?.classList.contains("rail-collapsed")).toBe(false);

    // 2. Worklist download panel
    state.activeTabId = "worklist";
    state.downloadOpen = false;
    render();
    const downloadStrip = appEl.querySelector(".download-panel .rail-collapsed-strip");
    expect(downloadStrip).not.toBeNull();
    const downloadTitle = downloadStrip.querySelector(".rail-vertical-title");
    expect(downloadTitle?.textContent).toContain("Tải ca chụp");

    // Click strip itself
    downloadStrip.click();
    expect(state.downloadOpen).toBe(true);
    expect(appEl.querySelector(".app-shell")?.classList.contains("download-collapsed")).toBe(false);
  });
});
