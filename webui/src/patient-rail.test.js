// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  renderPatientRail,
  buildMediaTimeline,
  downloadPanelVisible,
  bindTextViewerButtons,
  action,
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
  { id: "s1", timelineKey: "mr-study", studyDate: "20260806", mediaType: "dicom", studyDescription: "MR sọ não có tiêm", sliceCount: 1412, mprReady: true },
  { id: "s1b", timelineKey: "mr-study", studyDate: "20260806", mediaType: "dicom", studyDescription: "MR sọ não có tiêm", description: "Ax T2 FLAIR", sliceCount: 28 },
  { id: "s2", timelineKey: "photos", studyDate: "20260806", mediaType: "photo", studyDescription: "Ảnh đối chiếu", sliceCount: 4 },
  { id: "s3", timelineKey: "operation", studyDate: "20260702", mediaType: "video", studyDescription: "Mổ nội soi ổ bụng", sliceCount: 2 },
  { id: "s4", timelineKey: "report", studyDate: "", mediaType: "text", studyDescription: "Tường trình phẫu thuật", sliceCount: 1 },
];

const originalFetch = global.fetch;

describe("Viewer tab: patient rail", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.selectedId = "s1";
    state.archive = { root: "D:\\PACS\\BN", patient: { ...PATIENT }, series: SERIES.map((s) => ({ ...s })) };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("groups the record into days, newest first, undated last", () => {
    const timeline = buildMediaTimeline(SERIES);

    expect(timeline.map((day) => day.label)).toEqual([
      "06/08/2026",
      "02/07/2026",
      "Chưa rõ ngày chụp",
    ]);
    expect(timeline[0].items).toHaveLength(2);
    expect(timeline[0].items.find((item) => item.key === "mr-study").series).toHaveLength(2);
  });

  it("prefixes a diagnostic study with its modality when the source description omits it", () => {
    const [day] = buildMediaTimeline([{
      id: "ct-1",
      timelineKey: "ct-study",
      studyDate: "20260807",
      mediaType: "dicom",
      modality: "CT",
      studyDescription: "sọ não không tiêm",
      sliceCount: 100,
    }]);

    expect(day.items[0].title).toBe("CT sọ não không tiêm");
  });

  it("shows the identity the manifest recorded", () => {
    const html = renderPatientRail();

    expect(html).toContain("NGUYỄN HỮU SỰ");
    expect(html).toContain("2607063527");
    expect(html).toContain("Nam · 1962 · 63 tuổi");
    expect(html).toContain("BV Hà Tĩnh");
  });

  it("prints a dash for every field the manifest does not carry", () => {
    // A diagnosis has no source in a local archive — no RIS, no DICOM tag —
    // so it stays a dash until a clinician types one.
    const html = renderPatientRail();
    expect(html).toMatch(/data-action="edit-diagnosis"[^>]*>—</);

    state.archive.patient = {};
    const blank = renderPatientRail();
    expect(blank).toContain("Chưa có tên bệnh nhân");
    // Nothing is filled in from the folder path or from another patient.
    expect(blank).not.toContain("NGUYỄN HỮU SỰ");
    expect(blank).not.toContain("1962");
  });

  it("shows one simple row per study/media group, not every MRI sequence", () => {
    const html = renderPatientRail();

    expect(html).toContain('class="tl-item dicom on"');
    expect(html).toContain("2 phim");
    expect((html.match(/data-timeline-key="mr-study"/g) || [])).toHaveLength(1);
    expect(html).not.toContain("Ax T2 FLAIR");
    expect(html).not.toContain("1412 lát");
    expect(html).toContain('class="tl-item photo"');
    expect(html).toContain("4 ảnh");
    expect(html).toContain('class="tl-item video"');
    expect(html).toContain("2 video");
    expect(html).toContain('class="tl-item text"');
    expect(html).toContain("1 file");
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

  it("counts the study once without inventing a slice count", () => {
    state.archive.series = [{ id: "x", studyDate: "20260806", mediaType: "dicom", studyDescription: "Ca chưa quét" }];
    const html = renderPatientRail();

    expect(html).toContain("Ca chưa quét");
    expect(html).toContain("1 phim");
    expect(html).not.toContain("lát");
  });

  it("says so plainly when the record is empty", () => {
    state.archive.series = [];
    expect(renderPatientRail()).toContain("Chưa có dữ liệu nào trong hồ sơ này.");
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
