// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  groupSeriesHierarchically,
  renderSeriesOptions,
  toAlpha,
  toRoman,
} from "./main.js";

describe("Series Grouping Hierarchy (I, 1, a...)", () => {
  beforeEach(() => {
    setLanguage("vi");
  });
  it("converts numbers to Roman numerals", () => {
    expect(toRoman(1)).toBe("I");
    expect(toRoman(2)).toBe("II");
    expect(toRoman(3)).toBe("III");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(5)).toBe("V");
    expect(toRoman(10)).toBe("X");
  });

  it("converts indices to lowercase letters", () => {
    expect(toAlpha(0)).toBe("a");
    expect(toAlpha(1)).toBe("b");
    expect(toAlpha(2)).toBe("c");
    expect(toAlpha(25)).toBe("z");
    expect(toAlpha(26)).toBe("aa");
  });

  it("groups single date and study correctly", () => {
    const series = [
      { id: "s1", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
      { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T2 AX", sliceCount: 24 },
    ];

    const groups = groupSeriesHierarchically(series);
    expect(groups.length).toBe(1);
    expect(groups[0].romanNumeral).toBe("I");
    expect(groups[0].displayDate).toBe("11/08/2026");
    expect(groups[0].studyIdx).toBe(1);
    expect(groups[0].studyTitle).toBe("MR - SO NAO");
    expect(groups[0].items.length).toBe(2);
    expect(groups[0].items[0].letterIndex).toBe("a");
    expect(groups[0].items[0].displayLabel).toBe("a. T1 SAG");
    expect(groups[0].items[1].letterIndex).toBe("b");
    expect(groups[0].items[1].displayLabel).toBe("b. T2 AX");
  });

  it("groups multi-date and multi-study series in proper descending order and numbering", () => {
    const series = [
      { id: "s1", studyDate: "2026-08-10", studyGroup: "2026-08-10 - MR - COT SONG", description: "T2 SAG", sliceCount: 20 },
      { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
      { id: "s3", studyDate: "2026-08-11", studyGroup: "2026-08-11 - CT - CHEST", description: "Chest 5mm", sliceCount: 60 },
    ];

    const groups = groupSeriesHierarchically(series);
    expect(groups.length).toBe(3);

    // Latest date first: 2026-08-11 (Roman I)
    expect(groups[0].romanNumeral).toBe("I");
    expect(groups[0].displayDate).toBe("11/08/2026");
    expect(groups[0].studyIdx).toBe(1);
    expect(groups[0].studyTitle).toBe("MR - SO NAO");
    expect(groups[0].items[0].displayLabel).toBe("a. T1 SAG");

    expect(groups[1].romanNumeral).toBe("I");
    expect(groups[1].displayDate).toBe("11/08/2026");
    expect(groups[1].studyIdx).toBe(2);
    expect(groups[1].studyTitle).toBe("CT - CHEST");
    expect(groups[1].items[0].displayLabel).toBe("a. Chest 5mm");

    // Older date second: 2026-08-10 (Roman II)
    expect(groups[2].romanNumeral).toBe("II");
    expect(groups[2].displayDate).toBe("10/08/2026");
    expect(groups[2].studyIdx).toBe(1);
    expect(groups[2].studyTitle).toBe("MR - COT SONG");
    expect(groups[2].items[0].displayLabel).toBe("a. T2 SAG");
  });

  it("renders series options dropdown HTML with optgroups and option labels", () => {
    const archive = {
      series: [
        { id: "s1", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T1 SAG", sliceCount: 24 },
        { id: "s2", studyDate: "2026-08-11", studyGroup: "2026-08-11 - MR - SO NAO", description: "T2 AX", sliceCount: 24 },
      ],
    };

    const html = renderSeriesOptions(archive, "s1");
    expect(html).toContain('<optgroup label="📁 Ngày 11/08/2026 (MR - SO NAO)">');
    expect(html).toContain('value="s1" selected');
    expect(html).toContain('a. T1 SAG · 24 lát');
    expect(html).toContain('b. T2 AX · 24 lát');
  });
});
