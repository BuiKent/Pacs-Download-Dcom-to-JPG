// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import { groupSeriesHierarchically, renderSeriesOptions } from "./main.js";

describe("Series grouping by study date and study", () => {
  beforeEach(() => {
    setLanguage("vi");
  });

  it("keeps one group when every series belongs to the same study", () => {
    const series = [
      { id: "s1", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
      { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T2 AX", sliceCount: 24 },
    ];

    const groups = groupSeriesHierarchically(series);
    expect(groups.length).toBe(1);
    expect(groups[0].displayDate).toBe("11/08/2026");
    expect(groups[0].studyTitle).toBe("MR - SO NAO");
    expect(groups[0].items.map((item) => item.description)).toEqual(["T1 SAG", "T2 AX"]);
  });

  it("never repeats the modality in a study header", () => {
    // The backend reports the exam's own name in studyDescription. Reading the
    // grouping key instead, which already carries "<ngày> - <modality> - <mô
    // tả>", showed a radiologist "MR - MR sọ não có tiêm".
    const series = [
      {
        id: "s1",
        studyDate: "2026-07-10",
        modality: "MR",
        studyGroup: "2026-07-10 - MR - MR sọ não có tiêm",
        studyDescription: "MR sọ não có tiêm",
        description: "T1 SAG",
        sliceCount: 24,
      },
    ];

    expect(groupSeriesHierarchically(series)[0].studyTitle).toBe("MR sọ não có tiêm");
  });

  it("still names the modality when the exam name does not carry it", () => {
    const series = [
      {
        id: "s1",
        studyDate: "2026-07-10",
        modality: "CT",
        studyGroup: "2026-07-10 - CT - Bụng có cản quang",
        studyDescription: "Bụng có cản quang",
        description: "Axial",
        sliceCount: 120,
      },
    ];

    expect(groupSeriesHierarchically(series)[0].studyTitle).toBe("CT · Bụng có cản quang");
  });

  it("orders groups newest date first, studies within a date in arrival order", () => {
    const series = [
      { id: "s1", studyDate: "2026-08-10", studyGroup: "2026-08-10 - MR - COT SONG", description: "T2 SAG", sliceCount: 20 },
      { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
      { id: "s3", studyDate: "2026-08-11", studyGroup: "2026-08-11 - CT - CHEST", description: "Chest 5mm", sliceCount: 60 },
    ];

    const groups = groupSeriesHierarchically(series);

    expect(groups.map((group) => [group.displayDate, group.studyTitle])).toEqual([
      ["11/08/2026", "MR - SO NAO"],
      ["11/08/2026", "CT - CHEST"],
      ["10/08/2026", "MR - COT SONG"],
    ]);
  });

  it("merges a study whose header carries a timestamp with one that does not", () => {
    // A series missing StudyTime used to land in a group of its own, which
    // showed the same study twice in the strip.
    const series = [
      { id: "s1", studyDate: "2026-06-16 15:19:47", studyGroup: "2026-06-16 15:19:47 - CT - SO NAO", description: "Axial", sliceCount: 200 },
      { id: "s2", studyDate: "2026-06-16", studyGroup: "2026-06-16 - CT - SO NAO", description: "KEY IMAGE", sliceCount: 2 },
    ];

    const groups = groupSeriesHierarchically(series);
    expect(groups.length).toBe(1);
    expect(groups[0].displayDate).toBe("16/06/2026");
    expect(groups[0].items.length).toBe(2);
  });

  it("collects series with no usable date under one undated group, listed last", () => {
    const series = [
      { id: "s1", description: "Scan roi", sliceCount: 3 },
      { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
    ];

    const groups = groupSeriesHierarchically(series);
    expect(groups.length).toBe(2);
    expect(groups[0].displayDate).toBe("11/08/2026");
    expect(groups[1].displayDate).toBe("Chưa rõ ngày chụp");
  });

  it("renders one optgroup per study, labelled by date and study", () => {
    const archive = {
      series: [
        { id: "s1", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
        { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T2 AX", sliceCount: 24 },
      ],
    };

    const html = renderSeriesOptions(archive, "s1");
    expect(html).toContain('<optgroup label="📁 Ngày 11/08/2026 (MR - SO NAO)">');
    expect(html).toContain('value="s1" selected');
    expect(html).toContain("T1 SAG · 24 lát");
    expect(html).toContain("T2 AX · 24 lát");
  });
});
