// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  action,
  renderWorklistView,
  renderActivityPanelInner,
  renderWorklistTreeInner,
  filteredPatientList,
  filteredHistoryEntries,
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

  it("renders multi-level Patient -> Study hierarchy with clinical media tags and status badges", () => {
    const html = renderWorklistTreeInner();
    expect(html).toContain('class="plist"');
    expect(html).toContain('class="prow"');
    expect(html).toContain("TEST-0001");
    expect(html).toContain("NGUYỄN VĂN MẪU · Nam · 1974");
    expect(html).toContain("BV A");
    expect(html).toContain("22 series");
    expect(html).toContain("4 ảnh");
    expect(html).toContain("3,8 GB");
    expect(html).toContain('data-action="open-patient-record"');

    // Studies inside patient 1
    expect(html).toContain('class="srow"');
    expect(html).toContain("06/08/2026 · MR sọ não có tiêm");
    expect(html).toContain("12 series · 1412 lát");
    expect(html).toContain("class=\"badge done\"");
    expect(html).toContain('data-action="open-study-viewer"');
    expect(html).toContain('data-action="reveal-study-folder"');

    // Patient 2 with video and photo media tags
    expect(html).toContain("TEST-0002");
    expect(html).toContain("TRẦN THỊ MẪU · Nữ · 1988");
    expect(html).toContain("2 video");
    expect(html).toContain("16 ảnh");
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

  it("counts real archive contents in the summary tiles", () => {
    state.archive = { root: "D:\\Kho", series: [{ sliceCount: 120 }, { sliceCount: 80 }] };
    state.tabs = [{ id: "p1" }];
    const html = renderActivityPanelInner();
    expect(html).toContain("Series trong kho");
    expect(html).toContain("<b>2</b>");
    expect(html).toContain("<b>200</b>");
  });

  it("says so plainly when there is no history yet", () => {
    state.history = [];
    state.worklistPatients = [];
    expect(renderActivityPanelInner()).toContain("Chưa có thư mục nào được mở hoặc tải.");
    expect(renderWorklistTreeInner()).toContain("Chưa có hồ sơ nào trong danh sách");
  });
});

