import { describe, expect, it } from "vitest";
import {
  CT_WINDOW_PRESETS,
  STACK_PREFETCH_CONFIG,
  WINDOW_PRESETS,
  annotationBelongsToSeries,
  annotationTargetViewportId,
  availableWindowPresets,
  defaultWindowPreset,
  isMeasurementAnnotation,
  montageIndices,
  mprPlaneLayout,
  nextViewportRotation,
  rescaledDicomPixels,
  seriesSafetyNotice,
  seriesSupportsHounsfield,
  syncedCompareIndices,
  toolFallback,
  volumeTransferRange,
  windowPresetRange,
} from "./viewer.js";

describe("viewer shell", () => {
  it("keeps the test environment available", () => {
    expect(typeof URLSearchParams).toBe("function");
  });

  it("prefetches only a bounded neighborhood around the current slice", () => {
    expect(STACK_PREFETCH_CONFIG.minBefore).toBe(2);
    expect(STACK_PREFETCH_CONFIG.maxAfter).toBe(6);
    expect(STACK_PREFETCH_CONFIG.directionExtraImages).toBe(0);
    expect(
      STACK_PREFETCH_CONFIG.minBefore + STACK_PREFETCH_CONFIG.maxAfter,
    ).toBeLessThanOrEqual(STACK_PREFETCH_CONFIG.maxImagesToPrefetch);
  });

  it("keeps one selected MPR plane large and stacks the other two", () => {
    expect(mprPlaneLayout("axial")).toEqual({
      axial: "mpr-primary",
      coronal: "mpr-secondary-top",
      sagittal: "mpr-secondary-bottom",
    });
    expect(mprPlaneLayout("sagittal")).toEqual({
      sagittal: "mpr-primary",
      axial: "mpr-secondary-top",
      coronal: "mpr-secondary-bottom",
    });
    expect(mprPlaneLayout("invalid")).toBeNull();
  });

  it("rotates the selected viewport clockwise in exact 90 degree steps", () => {
    expect(nextViewportRotation()).toBe(90);
    expect(nextViewportRotation(90)).toBe(180);
    expect(nextViewportRotation(270)).toBe(0);
    expect(nextViewportRotation(-90)).toBe(0);
  });

  it("limits the red clear action to measurements and ROIs", () => {
    expect(isMeasurementAnnotation({ metadata: { toolName: "Length" } })).toBe(true);
    expect(isMeasurementAnnotation({ metadata: { toolName: "Angle" } })).toBe(true);
    expect(isMeasurementAnnotation({ metadata: { toolName: "EllipticalROI" } })).toBe(true);
    expect(isMeasurementAnnotation({ metadata: { toolName: "PlanarFreehandROI" } })).toBe(true);
    expect(isMeasurementAnnotation({ metadata: { toolName: "Crosshairs" } })).toBe(false);
  });

  it("keeps montage panes consecutive when any pane is scrolled", () => {
    expect(montageIndices(100, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(montageIndices(100, 6, 2, 12)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(montageIndices(100, 8, 7, 99)).toEqual([92, 93, 94, 95, 96, 97, 98, 99]);
    expect(montageIndices(4, 6, 0, 3)).toEqual([0, 1, 2, 3, 3, 3]);
  });

  it("never keeps a tool the layout cannot honour", () => {
    // Crosshairs need two linked viewports; a single stack pane must fall back.
    expect(toolFallback("crosshair", 1, false)).toBe("window");
    expect(toolFallback("crosshair", 3, false)).toBe("crosshair");
    // The 3D orbit needs a 3D viewport.
    expect(toolFallback("orbit3d", 4, false)).toBe("window");
    expect(toolFallback("orbit3d", 4, true)).toBe("orbit3d");
    expect(toolFallback("length", 1, false)).toBe("length");
    // Text notes are plain annotations and work in any 2D layout.
    expect(toolFallback("text", 1, false)).toBe("text");
    expect(toolFallback("nonsense", 3, true)).toBe("window");
  });

  it("keeps compared panes in lockstep when they start aligned", () => {
    // Freshly opened: all panes on the same slice, so they run 1-1-1, 2-2-2.
    const counts = [121, 121, 121];
    expect(syncedCompareIndices([0, 0, 0], 0, 1, counts)).toEqual([1, 1, 1]);
    expect(syncedCompareIndices([0, 0, 0], 0, 5, counts)).toEqual([5, 5, 5]);
    // Any pane may drive the others.
    expect(syncedCompareIndices([0, 0, 0], 2, 3, counts)).toEqual([3, 3, 3]);
  });

  it("preserves the offset captured when the lock was switched on", () => {
    // The user unlocked, scrolled the middle pane to n = 40, and re-locked at
    // [10, 40, 10]. From then on the panes must move together *keeping* the gap.
    const counts = [121, 121, 121];
    const anchor = [10, 40, 10];
    expect(syncedCompareIndices(anchor, 1, 40, counts)).toEqual([10, 40, 10]);
    expect(syncedCompareIndices(anchor, 1, 41, counts)).toEqual([11, 41, 11]);
    expect(syncedCompareIndices(anchor, 1, 45, counts)).toEqual([15, 45, 15]);
    // Driving from a different pane keeps the same relationship.
    expect(syncedCompareIndices(anchor, 0, 12, counts)).toEqual([12, 42, 12]);
    // Scrolling backwards past the anchor works too.
    expect(syncedCompareIndices(anchor, 1, 35, counts)).toEqual([5, 35, 5]);
  });

  it("clamps a shorter series without losing the anchor", () => {
    // Pane C only has 20 slices; it stops at its end while the others continue.
    const counts = [121, 121, 20];
    const anchor = [10, 10, 10];
    expect(syncedCompareIndices(anchor, 0, 25, counts)).toEqual([25, 25, 19]);
    // Coming back, pane C resumes from the anchor rather than from its clamp.
    expect(syncedCompareIndices(anchor, 0, 12, counts)).toEqual([12, 12, 12]);
    expect(syncedCompareIndices(anchor, 0, 0, counts)).toEqual([0, 0, 0]);
    // Never below the first slice.
    expect(syncedCompareIndices([5, 0, 5], 0, 0, counts)).toEqual([0, 0, 0]);
  });

  it("supports two panes as well as three", () => {
    expect(syncedCompareIndices([3, 8], 0, 4, [50, 50])).toEqual([4, 9]);
    expect(syncedCompareIndices([3, 8], 1, 7, [50, 50])).toEqual([2, 7]);
  });

  it("attributes each measurement to the series it was drawn on", () => {
    const seriesA = "aaaaaaaaaaaaaaaaaaaa";
    const seriesB = "bbbbbbbbbbbbbbbbbbbb";
    const stackRoi = { metadata: { referencedImageId: `dcomjpg:${seriesA}:12` } };
    const volumeRoi = {
      metadata: {},
      data: { cachedStats: { [`volumeId:cornerstoneStreamingImageVolume:${seriesB}`]: { area: 4 } } },
    };
    expect(annotationBelongsToSeries(stackRoi, seriesA)).toBe(true);
    expect(annotationBelongsToSeries(stackRoi, seriesB)).toBe(false);
    expect(annotationBelongsToSeries(volumeRoi, seriesB)).toBe(true);
    expect(annotationBelongsToSeries(volumeRoi, seriesA)).toBe(false);
    expect(annotationBelongsToSeries(null, seriesA)).toBe(false);
    expect(annotationBelongsToSeries(stackRoi, "")).toBe(false);
  });

  it("restores annotations only to a proven series and plane", () => {
    const seriesA = "aaaaaaaaaaaaaaaaaaaa";
    const seriesB = "bbbbbbbbbbbbbbbbbbbb";
    const viewports = [
      {
        id: "axial-a",
        seriesId: seriesA,
        imageIds: [`dcomjpg:${seriesA}:12`],
        viewPlaneNormal: [0, 0, 1],
      },
      {
        id: "coronal-a",
        seriesId: seriesA,
        imageIds: [`dcomjpg:${seriesA}:12`],
        viewPlaneNormal: [0, 1, 0],
      },
      {
        id: "stack-b",
        seriesId: seriesB,
        imageIds: [`dcomjpg:${seriesB}:7`],
        viewPlaneNormal: [0, 0, 1],
      },
    ];
    expect(annotationTargetViewportId({
      metadata: {
        referencedImageId: `dcomjpg:${seriesA}:12`,
        viewPlaneNormal: [0, -1, 0],
      },
    }, viewports)).toBe("coronal-a");
    expect(annotationTargetViewportId({
      metadata: { referencedImageId: `dcomjpg:${seriesB}:7` },
    }, viewports)).toBe("stack-b");
    expect(annotationTargetViewportId({ metadata: {} }, viewports)).toBe("");
  });

  it("warns about CT or unknown 8-bit intensity without claiming HU presets", () => {
    expect(seriesSafetyNotice({ modality: "MR" })).toBeNull();
    expect(seriesSafetyNotice({ modality: "CT" }).text).toContain("HU");
    expect(seriesSafetyNotice({ modality: "UNKNOWN" }).level).toBe("warning");
    expect(WINDOW_PRESETS.full).toEqual({ lower: 0, upper: 255 });
    expect(Object.keys(WINDOW_PRESETS)).not.toContain("bone");
  });

  it("derives display and 3D transfer ranges from original DICOM intensity", () => {
    const dicom = {
      sourceType: "dicom",
      pixelData: {
        bitsStored: 12,
        pixelRepresentation: 0,
        rescaleSlope: 1,
        rescaleIntercept: 0,
        windowCenter: 1200,
        windowWidth: 1800,
      },
    };
    expect(windowPresetRange("full", dicom)).toEqual({ lower: 300, upper: 2100 });
    expect(windowPresetRange("soft", dicom)).toEqual({ lower: -150, upper: 2550 });
    expect(windowPresetRange("contrast", dicom)).toEqual({ lower: 660, upper: 1740 });
    expect(volumeTransferRange(dicom, [0, 4095])).toEqual([300, 2100]);

    const ct = {
      sourceType: "dicom",
      pixelData: {
        bitsStored: 12,
        pixelRepresentation: 0,
        rescaleSlope: 1,
        rescaleIntercept: -1024,
        windowCenter: 40,
        windowWidth: 400,
      },
    };
    // decodeDicomImage now delivers Hounsfield values, so a volume normally
    // reports a rescaled range. This is the fallback for a loader that did not
    // rescale: a 0..4095 spread means the -160..240 window has to be mapped
    // back to stored values 864..1264 before building transfer points.
    expect(volumeTransferRange(ct, [0, 4095])).toEqual([864, 1264]);
    // The same window against a Hounsfield volume is used as-is.
    expect(volumeTransferRange(ct, [-1024, 3071])).toEqual([-160, 240]);
  });

  const calibratedCt = {
    sourceType: "dicom",
    modality: "CT",
    pixelData: {
      bitsStored: 12,
      pixelRepresentation: 0,
      rescaleSlope: 1,
      rescaleIntercept: -1024,
      windowCenter: 400,
      windowWidth: 1800,
    },
  };
  const mr = {
    sourceType: "dicom",
    modality: "MR",
    pixelData: {
      bitsStored: 12,
      pixelRepresentation: 0,
      rescaleSlope: 1,
      rescaleIntercept: 0,
      windowCenter: 508,
      windowWidth: 1067,
    },
  };

  it("offers fixed Hounsfield windows only where pixels are calibrated CT", () => {
    expect(seriesSupportsHounsfield(calibratedCt)).toBe(true);
    expect(seriesSupportsHounsfield(mr)).toBe(false);
    expect(seriesSupportsHounsfield({ sourceType: "jpg", modality: "CT" })).toBe(false);

    // Brain reading comes first; the file's own window stays available after it.
    const ctIds = availableWindowPresets(calibratedCt).map((item) => item.id);
    expect(ctIds[0]).toBe("ct-brain");
    expect(ctIds).toContain("full");
    expect(defaultWindowPreset(calibratedCt)).toBe("ct-brain");
    expect(defaultWindowPreset(mr)).toBe("full");

    // Body windows are out of scope for this app and must not reappear.
    expect(ctIds).not.toContain("ct-lung");
    expect(ctIds).not.toContain("ct-liver");

    // MR intensity has no absolute scale, so a fixed window would be meaningless.
    expect(availableWindowPresets(mr).map((item) => item.id))
      .toEqual(["full", "soft", "contrast"]);
  });

  it("resolves CT presets to their published Hounsfield bounds", () => {
    expect(windowPresetRange("ct-brain", calibratedCt)).toEqual({ lower: 0, upper: 80 });
    expect(windowPresetRange("ct-stroke", calibratedCt)).toEqual({ lower: 20, upper: 60 });
    expect(windowPresetRange("ct-bone", calibratedCt)).toEqual({ lower: -500, upper: 1300 });

    // The CT window must not be derived from the file's own WC/WW.
    expect(windowPresetRange("full", calibratedCt)).toEqual({ lower: -500, upper: 1300 });

    // A Hounsfield preset asked of MR must refuse rather than guess.
    expect(windowPresetRange("ct-brain", mr)).toBeNull();
    expect(windowPresetRange("nonsense", mr)).toBeNull();
  });

  it("hands the viewport Hounsfield values, not raw stored pixels", () => {
    // StackViewport applies no modality LUT: it windows getPixelData directly.
    // Raw pixels plus an HU window offset the display by the whole intercept,
    // which drives every tissue above the ceiling to pure white.
    const stored = new Uint16Array([24, 1024, 1054, 1064, 2224]);
    const result = rescaledDicomPixels(stored, 1, -1024, 24, 2224);

    expect(Array.from(result.pixels)).toEqual([-1000, 0, 30, 40, 1200]);
    expect(result.min).toBe(-1000);
    expect(result.max).toBe(1200);

    // An integer type is required: StackViewport re-quantises a Float32Array
    // whose rescale is non-integral, which would undo the scaling.
    expect(result.pixels).toBeInstanceOf(Int16Array);

    const brain = windowPresetRange("ct-brain", calibratedCt);
    const inWindow = Array.from(result.pixels)
      .filter((value) => value >= brain.lower && value <= brain.upper);
    expect(inWindow).toEqual([0, 30, 40]);
  });

  it("leaves pixels untouched when there is nothing to rescale", () => {
    const stored = new Uint16Array([0, 100, 4095]);
    const result = rescaledDicomPixels(stored, 1, 0, 0, 4095);
    expect(result.pixels).toBe(stored);
    expect([result.min, result.max]).toEqual([0, 4095]);
  });

  it("widens the output type when Hounsfield values overflow int16", () => {
    const stored = new Uint16Array([0, 65535]);
    const wide = rescaledDicomPixels(stored, 1, -1024, 0, 65535);
    expect(wide.pixels).toBeInstanceOf(Int32Array);
    expect([wide.min, wide.max]).toEqual([-1024, 64511]);

    const fractional = rescaledDicomPixels(new Uint16Array([0, 100]), 0.5, 0, 0, 100);
    expect(fractional.pixels).toBeInstanceOf(Float32Array);
    expect([fractional.min, fractional.max]).toEqual([0, 50]);
  });

  it("keeps every CT preset a plausible clinical window", () => {
    for (const preset of CT_WINDOW_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.center - preset.width / 2).toBeGreaterThanOrEqual(-2000);
      expect(preset.center + preset.width / 2).toBeLessThanOrEqual(4000);
    }
    expect(new Set(CT_WINDOW_PRESETS.map((item) => item.id)).size)
      .toBe(CT_WINDOW_PRESETS.length);
  });
});
