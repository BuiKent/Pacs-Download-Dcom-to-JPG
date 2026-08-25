// @vitest-environment jsdom

/**
 * Which series a record opens on.
 *
 * Several scanners write a three-image "Screen Save" as series 1, so opening
 * whatever came first showed a screenshot of somebody's console instead of the
 * study. The rule is mechanical on purpose: it never claims to know which
 * sequence a reader wants, only which ones are not images of the patient.
 */

import { describe, expect, it } from "vitest";
import { pickInitialSeries } from "./main.js";

const series = (id, extra = {}) => ({
  id,
  mediaType: "dicom",
  studyDate: "2026-07-29",
  sliceCount: 20,
  description: id,
  ...extra,
});

describe("pickInitialSeries", () => {
  it("skips a screen-save series in favour of real images", () => {
    const chosen = pickInitialSeries([
      series("screensave", { description: "Screen Save", sliceCount: 3 }),
      series("flair", { description: "Ax T2 FLAIR", sliceCount: 23 }),
    ]);
    expect(chosen).toBe("flair");
  });

  it("skips localizers, scouts and dose reports too", () => {
    for (const name of ["Localizer", "SCOUT", "Dose Report", "Patient Protocol"]) {
      const chosen = pickInitialSeries([
        series("boilerplate", { description: name, sliceCount: 400 }),
        series("real", { description: "Ax T1", sliceCount: 20 }),
      ]);
      expect(chosen, name).toBe("real");
    }
  });

  it("opens the newest study when a record holds several", () => {
    const chosen = pickInitialSeries([
      series("old", { studyDate: "2026-07-20", sliceCount: 500 }),
      series("new", { studyDate: "2026-07-29", sliceCount: 23 }),
    ]);
    expect(chosen).toBe("new");
  });

  it("prefers the longest stack among equals", () => {
    const chosen = pickInitialSeries([
      series("short", { sliceCount: 23 }),
      series("long", { sliceCount: 108 }),
    ]);
    expect(chosen).toBe("long");
  });

  it("prefers images over the video or report filed beside them", () => {
    const chosen = pickInitialSeries([
      series("video", { mediaType: "video", sliceCount: 900 }),
      series("scan", { mediaType: "dicom", sliceCount: 23 }),
    ]);
    expect(chosen).toBe("scan");
  });

  it("still opens a record that holds only a video", () => {
    const chosen = pickInitialSeries([series("video", { mediaType: "video" })]);
    expect(chosen).toBe("video");
  });

  it("falls back rather than opening nothing", () => {
    expect(pickInitialSeries([])).toBe("");
    expect(pickInitialSeries(null)).toBe("");
    expect(pickInitialSeries([series("only", { description: "Screen Save" })])).toBe("only");
  });
});
