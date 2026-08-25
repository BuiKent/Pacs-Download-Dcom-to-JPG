// @vitest-environment jsdom

/**
 * Acquisition parameters printed on the image.
 *
 * A reader confirms a sequence against these numbers when the series
 * description is wrong or ambiguous — "FILT_PHA: Ax T2* 3D SWAN" sitting next
 * to "Ax T2* 3D SWAN" is one wrong click away. So a parameter is either the
 * real value from the file or absent; nothing here may print a stand-in.
 */

import { describe, expect, it } from "vitest";
import { acquisitionOverlayLines, seriesHasPhysicalSpacing } from "./viewer.js";

describe("Overlay: acquisition parameters", () => {
  it("prints TR/TE for MR", () => {
    const lines = acquisitionOverlayLines(
      { modality: "MR", acquisition: { repetitionTime: 2000, echoTime: 95.6 } },
      {},
    );
    expect(lines).toContain("TR/TE: 2000 / 95.6 ms");
  });

  it("does not print TR/TE for CT, which has neither", () => {
    const lines = acquisitionOverlayLines(
      { modality: "CT", acquisition: { sliceThickness: 3 } },
      {},
    );
    expect(lines.join(" ")).not.toContain("TR/TE");
    expect(lines).toContain("ST: 3 mm");
  });

  it("prints kVp and mAs where the file records them", () => {
    const lines = acquisitionOverlayLines(
      { modality: "DX", acquisition: { kvp: 70, exposure: 4.5 } },
      {},
    );
    expect(lines).toContain("kVp: 70  mAs: 4.5");
  });

  it("says nothing when the file recorded nothing", () => {
    expect(acquisitionOverlayLines({ modality: "MR", acquisition: {} }, {})).toEqual([]);
    expect(acquisitionOverlayLines({ modality: "MR" }, {})).toEqual([]);
    expect(acquisitionOverlayLines(null, null)).toEqual([]);
  });

  it("never turns a missing value into a zero", () => {
    // A printed "TR: 0 ms" would be read as a measurement. Only the half that
    // exists is printed, and the missing half shows an em dash.
    const lines = acquisitionOverlayLines(
      { modality: "MR", acquisition: { echoTime: 95 } },
      {},
    );
    expect(lines[0]).toBe("TR/TE: — / 95 ms");
    expect(lines.join(" ")).not.toContain("0 ms");
  });

  it("reads the JPG manifest when the series carries no block of its own", () => {
    // JPG is the long-term store, so a converted study keeps these in
    // `mpr-volume.json` and the overlay must find them there.
    const lines = acquisitionOverlayLines(
      { modality: "MR" },
      { acquisition: { repetitionTime: 550, echoTime: 11 } },
    );
    expect(lines).toContain("TR/TE: 550 / 11 ms");
  });

  it("trims trailing zeros so 5.00 mm reads as 5 mm", () => {
    const lines = acquisitionOverlayLines(
      { modality: "CT", acquisition: { sliceThickness: 5 } },
      {},
    );
    expect(lines).toContain("ST: 5 mm");
  });
});

describe("Overlay: the scale bar needs real spacing", () => {
  it("accepts a series whose geometry records millimetres", () => {
    expect(seriesHasPhysicalSpacing({ geometry: { pixelSpacing: [0.45, 0.45] } })).toBe(true);
    expect(seriesHasPhysicalSpacing({ pixelData: { pixelSpacing: [1, 1] } })).toBe(true);
  });

  it("refuses a series with no spacing, so no fabricated ruler is drawn", () => {
    expect(seriesHasPhysicalSpacing({})).toBe(false);
    expect(seriesHasPhysicalSpacing({ geometry: {} })).toBe(false);
    expect(seriesHasPhysicalSpacing({ geometry: { pixelSpacing: [0, 0] } })).toBe(false);
    expect(seriesHasPhysicalSpacing({ geometry: { pixelSpacing: ["", null] } })).toBe(false);
    expect(seriesHasPhysicalSpacing(null)).toBe(false);
  });
});
