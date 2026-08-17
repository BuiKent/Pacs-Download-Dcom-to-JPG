// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import { state, renderPatientRail, buildMediaTimeline } from "./main.js";

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
  { id: "s1", studyDate: "20260806", mediaType: "dicom", studyDescription: "MR sọ não có tiêm", sliceCount: 1412 },
  { id: "s2", studyDate: "20260806", mediaType: "photo", studyDescription: "Ảnh đối chiếu", sliceCount: 4 },
  { id: "s3", studyDate: "20260702", mediaType: "video", studyDescription: "Mổ nội soi ổ bụng", sliceCount: 2 },
  { id: "s4", studyDate: "", mediaType: "text", studyDescription: "Tường trình phẫu thuật", sliceCount: 1 },
];

describe("Viewer tab: patient rail", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.selectedId = "s1";
    state.archive = { root: "D:\\PACS\\BN", patient: { ...PATIENT }, series: SERIES.map((s) => ({ ...s })) };
  });

  it("groups the record into days, newest first, undated last", () => {
    const timeline = buildMediaTimeline(SERIES);

    expect(timeline.map((day) => day.label)).toEqual([
      "06/08/2026",
      "02/07/2026",
      "Chưa rõ ngày chụp",
    ]);
    expect(timeline[0].items).toHaveLength(2);
  });

  it("shows the identity the manifest recorded", () => {
    const html = renderPatientRail();

    expect(html).toContain("NGUYỄN HỮU SỰ");
    expect(html).toContain("2607063527");
    expect(html).toContain("Nam · 1962 · 63 tuổi");
    expect(html).toContain("BV Hà Tĩnh");
  });

  it("prints a dash for every field the manifest does not carry", () => {
    // A diagnosis has no source in a local archive: no RIS, no DICOM tag.
    expect(renderPatientRail()).toContain("<dd>—</dd>");

    state.archive.patient = {};
    const blank = renderPatientRail();
    expect(blank).toContain("Chưa có tên bệnh nhân");
    // Nothing is filled in from the folder path or from another patient.
    expect(blank).not.toContain("NGUYỄN HỮU SỰ");
    expect(blank).not.toContain("1962");
  });

  it("labels each timeline row with its own media kind and count", () => {
    const html = renderPatientRail();

    expect(html).toContain('class="tl-item dicom on"');
    expect(html).toContain("1412 lát");
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
    expect((html.match(/data-series-id=/g) || []).length).toBe(SERIES.length);
  });

  it("omits a count when nothing measured the series", () => {
    state.archive.series = [{ id: "x", studyDate: "20260806", mediaType: "dicom", studyDescription: "Ca chưa quét" }];
    const html = renderPatientRail();

    expect(html).toContain("Ca chưa quét");
    expect(html).not.toContain('class="ct"');
  });

  it("says so plainly when the record is empty", () => {
    state.archive.series = [];
    expect(renderPatientRail()).toContain("Chưa có dữ liệu nào trong hồ sơ này.");
  });
});
