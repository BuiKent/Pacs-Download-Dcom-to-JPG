// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  action,
  renderWorklistView,
  renderActivityPanelInner,
  filteredHistoryEntries,
} from "./main.js";

const HISTORY = [
  { folder: "D:\\PACS\\Kho\\TEST-0001_NGUYEN VAN MAU", url: "http://viewer/a", time: "06/08 10:24" },
  { folder: "D:\\PACS\\Kho\\TEST-0002_TRAN THI MAU", url: "http://viewer/b", time: "05/08 16:03" },
];

describe("Worklist: Study List / Activity & Queue tabs", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.worklistTab = "studies";
    state.worklistSearch = "";
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
    // The active tab is the one flagged for assistive tech, not just styled.
    expect(html).toContain('aria-selected="true"\n          data-action="worklist-tab" data-worklist-tab="studies"');
    expect(html).toContain('aria-selected="false"\n          data-action="worklist-tab" data-worklist-tab="activity"');
    expect(html).toContain('class="worklist-tree"');
    expect(html).not.toContain('id="activity-panel"');
  });

  it("shows the match count on the Study List tab and follows the search box", () => {
    expect(renderWorklistView()).toContain('<span class="worklist-tab-count">2</span>');
    state.worklistSearch = "TEST-0002";
    expect(filteredHistoryEntries()).toHaveLength(1);
    expect(renderWorklistView()).toContain('<span class="worklist-tab-count">1</span>');
  });

  it("matches the search against the folder path, which carries name and code", () => {
    state.worklistSearch = "nguyen van mau";
    expect(filteredHistoryEntries()).toHaveLength(1);
    state.worklistSearch = "khong-co-ai";
    expect(filteredHistoryEntries()).toHaveLength(0);
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
    // No percentage is reported by the backend, so the bar must stay indeterminate.
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
    expect(html).toContain("<b>2</b>");   // two series
    expect(html).toContain("<b>200</b>"); // 120 + 80 slices
  });

  it("says so plainly when there is no history yet", () => {
    state.history = [];
    expect(renderActivityPanelInner()).toContain("Chưa có thư mục nào được mở hoặc tải.");
  });
});
