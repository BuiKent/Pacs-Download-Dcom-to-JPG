// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  action,
  renderWorklistView,
  renderActivityPanelInner,
  renderWorklistTreeInner,
  renderWorklistSummaryInner,
  refreshWorklist,
  getEffectiveWorklistPatients,
  studyHeadingLine,
  studyCountLine,
  filteredPatientList,
  filteredHistoryEntries,
  syncToolHighlight,
} from "./main.js";

const PATIENTS = [
  {
    id: "p1",
    patientId: "TEST-0001",
    patientName: "NGUYỄN VĂN MẪU",
    gender: "Nam",
    birthYear: "1974",
    hospital: "BV A",
    folder: "D:\\PACS\\Kho\\TEST-0001_NGUYEN VAN MAU",
    totalSizeFormatted: "3,8 GB",
    mediaSummary: { dicom: 22, photo: 4, video: 0, doc: 0 },
    studies: [
      {
        id: "s1",
        studyDate: "06/08/2026",
        studyName: "MR sọ não có tiêm",
        modality: "MR",
        seriesCount: 12,
        sliceCount: 1412,
        folder: "D:\\PACS\\Kho\\TEST-0001_NGUYEN VAN MAU\\2026-08-06 - MR - SO NAO",
        status: "done",
        statusLabel: "Đã tải",
        mediaCounts: { dicom: 12, photo: 4, video: 0, doc: 0 },
        primaryMediaType: "dicom",
      },
      {
        id: "s2",
        studyDate: "02/07/2026",
        studyName: "MR cột sống thắt lưng",
        modality: "MR",
        seriesCount: 6,
        sliceCount: 328,
        folder: "D:\\PACS\\Kho\\TEST-0001_NGUYEN VAN MAU\\2026-07-02 - MR - COT SONG",
        status: "busy",
        statusLabel: "Đang tải 62%",
        mediaCounts: { dicom: 6, photo: 0, video: 0, doc: 0 },
        primaryMediaType: "dicom",
      },
    ],
  },
  {
    id: "p2",
    patientId: "TEST-0002",
    patientName: "TRẦN THỊ MẪU",
    gender: "Nữ",
    birthYear: "1988",
    hospital: "BV A",
    folder: "D:\\PACS\\Kho\\TEST-0002_TRAN THI MAU",
    totalSizeFormatted: "8,1 GB",
    mediaSummary: { dicom: 0, photo: 16, video: 2, doc: 24 },
    studies: [
      {
        id: "s3",
        studyDate: "05/08/2026",
        studyName: "Mổ nội soi ổ bụng",
        modality: "Video",
        seriesCount: 2,
        sliceCount: 2,
        folder: "D:\\PACS\\Kho\\TEST-0002_TRAN THI MAU\\2026-08-05 - VIDEO MO",
        status: "done",
        statusLabel: "Đã tải",
        mediaCounts: { dicom: 0, photo: 16, video: 2, doc: 0 },
        primaryMediaType: "video",
      },
    ],
  },
];

const HISTORY = [
  { folder: "D:\\PACS\\Kho\\TEST-0001_NGUYEN VAN MAU", url: "http://viewer/a", time: "06/08 10:24" },
  { folder: "D:\\PACS\\Kho\\TEST-0002_TRAN THI MAU", url: "http://viewer/b", time: "05/08 16:03" },
];

describe("Worklist: Study List / Activity & Queue tabs", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.worklistTab = "studies";
    state.worklistSearch = "";
    state.worklistPatients = PATIENTS.map((p) => ({ ...p }));
    state.worklistLoaded = true;
    state.worklistLoading = false;
    state.worklistError = "";
    state.expandedPatients = {};
    state.history = HISTORY.map((entry) => ({ ...entry }));
    state.tabs = [];
    state.job = null;
    state.bootstrap = { job: {} };
    state.archive = { root: "D:\\PACS\\Kho", series: [] };
  });

  it("renders both tabs, with Study List active by default", () => {
    const html = renderWorklistView();
    expect(html).toContain('data-worklist-tab="studies"');
    expect(html).toContain('data-worklist-tab="activity"');
    expect(html).toContain('aria-selected="true"\n          data-action="worklist-tab" data-worklist-tab="studies"');
    expect(html).toContain('aria-selected="false"\n          data-action="worklist-tab" data-worklist-tab="activity"');
    expect(html).toContain('class="worklist-tree"');
    expect(html).not.toContain('id="activity-panel"');
  });

  it("renders multi-level Patient -> Study hierarchy with clinical table header and status badges", () => {
    const html = renderWorklistTreeInner();
    expect(html).toContain('class="plist-header"');
    expect(html).toContain('class="plist"');
    expect(html).toContain('class="prow"');
    expect(html).toContain("TEST-0001");
    expect(html).toContain("NGUYỄN VĂN MẪU");
    expect(html).toContain("Nam · 1974 · BV A");
    expect(html).toContain('data-action="open-patient-record"');

    // Studies inside patient 1
    expect(html).toContain('class="srow"');
    expect(html).toContain("06/08/2026 · MR sọ não có tiêm");
    expect(html).toContain("12 series · 1412 lát");
    expect(html).toContain("06/08/2026");
    expect(html).toContain("class=\"badge status-col done\"");
    expect(html).toContain('data-action="open-study-viewer"');
    expect(html).toContain('data-action="reveal-study-folder"');

    // Patient 2
    expect(html).toContain("TEST-0002");
    expect(html).toContain("TRẦN THỊ MẪU");
    expect(html).toContain("Nữ · 1988");
  });

  it("shows the match count on the Study List tab and follows the search box", () => {
    expect(renderWorklistView()).toContain('<span class="worklist-tab-count">2</span>');
    state.worklistSearch = "TEST-0002";
    expect(filteredPatientList()).toHaveLength(1);
    expect(renderWorklistView()).toContain('<span class="worklist-tab-count">1</span>');
  });

  it("matches search across patient name, code, hospital, and study descriptions", () => {
    state.worklistSearch = "sọ não";
    expect(filteredPatientList()).toHaveLength(1);
    expect(filteredPatientList()[0].patientId).toBe("TEST-0001");

    state.worklistSearch = "mổ nội soi";
    expect(filteredPatientList()).toHaveLength(1);
    expect(filteredPatientList()[0].patientId).toBe("TEST-0002");

    state.worklistSearch = "khong-co-ai";
    expect(filteredPatientList()).toHaveLength(0);
  });

  it("switches to the Activity panel through the worklist-tab action", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    await action("worklist-tab", { dataset: { worklistTab: "activity" } });
    expect(state.worklistTab).toBe("activity");
    const html = renderWorklistView();
    expect(html).toContain('id="activity-panel"');
    expect(html).not.toContain('class="worklist-tree"');
  });

  it("ignores a click on the tab that is already open", async () => {
    // A full render rebuilds the shell and tears down the viewer canvas, so
    // re-selecting the current tab has to be a no-op rather than a repaint.
    document.body.innerHTML = `<div id="app"></div>`;
    state.worklistTab = "studies";
    global.fetch = vi.fn();

    await action("worklist-tab", { dataset: { worklistTab: "studies" } });

    expect(state.worklistTab).toBe("studies");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports an idle queue when no job is running", () => {
    const html = renderActivityPanelInner();
    expect(html).toContain("Không có tác vụ nào đang chạy.");
    expect(html).not.toContain("data-action=\"stop-job\"");
  });

  it("shows the running job with a stop button and its translated kind", () => {
    state.job = { status: "running", kind: "download", message: "Đang tải series 4/6" };
    const html = renderActivityPanelInner();
    expect(html).toContain("Tải ca theo mã bệnh nhân");
    expect(html).toContain("Đang tải series 4/6");
    expect(html).toContain('data-action="stop-job"');
    expect(html).toContain("activity-bar indeterminate");
  });

  it("marks the Activity tab with a running badge only while a job runs", () => {
    expect(renderWorklistView()).not.toContain("worklist-tab-count running");
    state.job = { status: "running", kind: "archive" };
    expect(renderWorklistView()).toContain("worklist-tab-count running");
  });

  it("lists history rows with time, path and an open button", () => {
    const html = renderActivityPanelInner();
    expect(html).toContain("06/08 10:24");
    expect(html).toContain("TEST-0001_NGUYEN VAN MAU");
    expect(html).toContain('data-action="open-worklist-item"');
    expect((html.match(/class="activity-hrow"/g) || []).length).toBe(2);
  });

  it("counts real archive contents in the summary tiles in the Activity panel", () => {
    state.worklistPatients = PATIENTS.map((p) => ({ ...p }));
    const html = renderActivityPanelInner();
    expect(html).toContain("bệnh nhân");
    expect(html).toContain("hồ sơ");
    expect(html).toContain("ảnh &amp; lát");
    expect(html).toContain("<b>2</b>");
    expect(html).toContain("<b>3</b>");
    expect(html).toContain("<b>1.742</b>");
  });

  it("says so plainly when there is no history yet", () => {
    state.history = [];
    state.worklistPatients = [];
    state.worklistLoaded = false;
    state.worklistLoading = false;
    state.worklistError = "";
    expect(renderActivityPanelInner()).toContain("Chưa có thư mục nào được mở hoặc tải.");
    expect(renderWorklistTreeInner()).toContain("Chưa có hồ sơ nào trong danh sách");
  });
});

describe("viewer toolbar state", () => {
  it("updates only tool buttons after the toolbar redesign", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <nav class="toolbar">
        <button class="icon-button active" data-action="mode-mpr" aria-pressed="true"></button>
        <button class="icon-button active" data-action="tool-window" aria-pressed="true"></button>
        <button class="icon-button" data-action="tool-crosshair" aria-pressed="false"></button>
      </nav>`;
    state.tool = "crosshair";

    syncToolHighlight(root);

    expect(root.querySelector('[data-action="mode-mpr"]').classList.contains("active")).toBe(true);
    expect(root.querySelector('[data-action="tool-window"]').getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector('[data-action="tool-crosshair"]').getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-action="tool-crosshair"]').classList.contains("active")).toBe(true);
  });
});

function jsonResponse(data) {
  return {
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => data,
  };
}

describe("Worklist: scanned data replaces the history fallback", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.worklistTab = "studies";
    state.worklistSearch = "";
    state.worklistPatients = [];
    state.worklistLoaded = false;
    state.worklistLoading = false;
    state.worklistError = "";
    state.expandedPatients = {};
    state.history = HISTORY.map((entry) => ({ ...entry }));
    state.activeTabId = "worklist";
    state.job = null;
    state.bootstrap = { job: {} };
  });

  it("loads the scanned patient tree from /api/worklist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ patients: PATIENTS }));
    global.fetch = fetchMock;

    await refreshWorklist({ repaint: false });

    expect(fetchMock).toHaveBeenCalledWith("/api/worklist", expect.anything());
    expect(state.worklistPatients).toHaveLength(2);
    expect(filteredPatientList()[0].patientId).toBe("TEST-0001");
  });

  it("keeps an authoritative empty scan empty instead of showing history as patients", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ patients: [] }));

    await refreshWorklist({ repaint: false });

    expect(state.worklistLoaded).toBe(true);
    expect(getEffectiveWorklistPatients()).toEqual([]);
  });

  it("keeps the list it already had when the scan fails", async () => {
    state.worklistPatients = PATIENTS.map((p) => ({ ...p }));
    global.fetch = vi.fn().mockRejectedValue(new Error("scan exploded"));

    await refreshWorklist({ repaint: false });

    expect(state.worklistPatients).toHaveLength(2);
  });

  it("never presents history folders as patients before the scan completes", () => {
    expect(state.history).toHaveLength(2);
    expect(getEffectiveWorklistPatients()).toEqual([]);
  });

  it("shows a loading state rather than fabricated history-derived counts", () => {
    state.worklistLoading = true;
    const html = renderWorklistTreeInner();
    expect(html).toContain("Đang tải danh sách bệnh nhân");
    expect(html).not.toContain("1 series · 1 lát");
    expect(html).not.toContain('class="mtag');
  });

  it("shows only the halves of a study line that were actually measured", () => {
    expect(studyCountLine({ seriesCount: 12, sliceCount: 1412 })).toBe("12 series · 1412 lát");
    expect(studyCountLine({ seriesCount: 4, sliceCount: null })).toBe("4 series");
    expect(studyCountLine({ seriesCount: null, sliceCount: null })).toBe("Chưa đếm");

    expect(studyHeadingLine({ studyDate: "06/08/2026", studyName: "MR sọ não" }))
      .toBe("06/08/2026 · MR sọ não");
    // A study with no recorded date must not render a dangling separator.
    expect(studyHeadingLine({ studyDate: "", studyName: "MR sọ não" })).toBe("MR sọ não");
  });

  it("sums the summary tiles from the scanned rows on screen", () => {
    state.worklistPatients = [
      { ...PATIENTS[0], totalSizeBytes: 4_000_000_000 },
      { ...PATIENTS[1], totalSizeBytes: 100_000_000 },
    ];
    const html = renderWorklistSummaryInner();

    expect(html).toContain("<b>2</b>");            // patients
    expect(html).toContain("<b>3</b>");            // studies across both
    expect(html).toContain("1.742");               // 1412 + 328 + 2 slices, vi-VN grouping
    expect(html).toContain("3.8 GB");
    expect(html).toContain("bệnh nhân");
    // Nothing here recorded a video duration, so that tile is dropped.
    expect(html).not.toContain("phút video");
  });

  it("flags studies that need a human, and stays silent when none do", () => {
    state.worklistPatients = [{
      ...PATIENTS[0],
      studies: [
        { ...PATIENTS[0].studies[0], status: "part", statusLabel: "Chưa hoàn tất" },
        { ...PATIENTS[0].studies[1], status: "miss", statusLabel: "Thiếu folder" },
      ],
    }];
    expect(renderWorklistSummaryInner()).toContain("cần xử lý");
    expect(renderWorklistSummaryInner()).toContain("activity-stat alert");

    state.worklistPatients = [PATIENTS[1]];
    expect(renderWorklistSummaryInner()).not.toContain("cần xử lý");
  });

  it("offers Tải tiếp only on an unfinished study that kept its viewer link", () => {
    state.worklistPatients = [{
      ...PATIENTS[0],
      studies: [
        {
          ...PATIENTS[0].studies[0],
          status: "part",
          statusLabel: "Chưa hoàn tất",
          viewerUrl: "http://viewer/resume-me",
        },
        { ...PATIENTS[0].studies[1], status: "part", statusLabel: "Chưa hoàn tất", viewerUrl: "" },
      ],
    }];
    const html = renderWorklistTreeInner();

    expect((html.match(/data-action="resume-study-download"/g) || []).length).toBe(1);
    expect(html).toContain('data-url="http://viewer/resume-me"');
    expect(html).toContain("Tải tiếp");
  });

  it("disables both row buttons when the study folder is gone", () => {
    state.worklistPatients = [{
      ...PATIENTS[0],
      studies: [{ ...PATIENTS[0].studies[0], status: "miss", statusLabel: "Thiếu folder" }],
    }];
    const html = renderWorklistTreeInner();
    const row = html.slice(html.indexOf('class="srow"'));

    expect(row).toContain('data-action="open-study-viewer"');
    expect((row.match(/disabled/g) || []).length).toBe(2);
  });

  it("sorts patients by date (newest/oldest), name (A-Z/Z-A), and patient ID", () => {
    state.worklistPatients = [PATIENTS[0], PATIENTS[1]];

    // Sort by Date Descending (Default) -> TEST-0001 (06/08) then TEST-0002 (05/08)
    state.worklistSortColumn = "date";
    state.worklistSortOrder = "desc";
    let list = filteredPatientList();
    expect(list[0].patientId).toBe("TEST-0001");
    expect(list[1].patientId).toBe("TEST-0002");

    // Sort by Date Ascending -> TEST-0002 (05/08) then TEST-0001 (06/08)
    state.worklistSortOrder = "asc";
    list = filteredPatientList();
    expect(list[0].patientId).toBe("TEST-0002");
    expect(list[1].patientId).toBe("TEST-0001");

    // Sort by Name Ascending -> NGUYỄN then TRẦN
    state.worklistSortColumn = "name";
    state.worklistSortOrder = "asc";
    list = filteredPatientList();
    expect(list[0].patientName).toBe("NGUYỄN VĂN MẪU");
    expect(list[1].patientName).toBe("TRẦN THỊ MẪU");

    // Sort by Name Descending -> TRẦN then NGUYỄN
    state.worklistSortOrder = "desc";
    list = filteredPatientList();
    expect(list[0].patientName).toBe("TRẦN THỊ MẪU");
    expect(list[1].patientName).toBe("NGUYỄN VĂN MẪU");

    // Sort by ID Descending -> TEST-0002 then TEST-0001
    state.worklistSortColumn = "id";
    state.worklistSortOrder = "desc";
    list = filteredPatientList();
    expect(list[0].patientId).toBe("TEST-0002");
    expect(list[1].patientId).toBe("TEST-0001");
  });

  it("toggles sorting order and updates active column via sort-worklist action", async () => {
    document.body.innerHTML = `<div id="app"><div class="worklist-tree"></div></div>`;
    state.worklistPatients = [PATIENTS[0], PATIENTS[1]];
    state.worklistSortColumn = "name";
    state.worklistSortOrder = "asc";

    // Toggle same column -> flips to desc
    await action("sort-worklist", { dataset: { sortCol: "name" } });
    expect(state.worklistSortColumn).toBe("name");
    expect(state.worklistSortOrder).toBe("desc");

    // Click new column (id) -> sets id with asc
    await action("sort-worklist", { dataset: { sortCol: "id" } });
    expect(state.worklistSortColumn).toBe("id");
    expect(state.worklistSortOrder).toBe("asc");

    // Click date column -> sets date with default desc
    await action("sort-worklist", { dataset: { sortCol: "date" } });
    expect(state.worklistSortColumn).toBe("date");
    expect(state.worklistSortOrder).toBe("desc");
  });

  it("renders patient source folders with badges, add button, and action icons in Activity panel", () => {
    state.sourceFolders = [
      { folder: "D:\\PACS\\Kho", exists: true, isDefault: true },
      { folder: "E:\\External_PACS", exists: false, isDefault: false },
      { folder: "D:\\Custom_Source", exists: true, isDefault: false },
    ];

    const html = renderActivityPanelInner();
    expect(html).toContain("Thư mục nguồn bệnh nhân");
    expect(html).toContain("data-action=\"add-source-folder\"");
    expect(html).toContain("➕");
    expect(html).toContain("D:\\PACS\\Kho");
    expect(html).toContain("Mặc định");
    expect(html).toContain("E:\\External_PACS");
    expect(html).toContain("Không tồn tại");
    expect(html).toContain("D:\\Custom_Source");
    expect(html).toContain("data-action=\"open-folder-explorer\"");
    expect(html).toContain("data-action=\"remove-source-folder\"");
    expect(html).toContain("📂");
    expect(html).toContain("🗑️");
  });
});
