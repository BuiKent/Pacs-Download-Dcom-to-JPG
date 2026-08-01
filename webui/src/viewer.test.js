import { describe, expect, it } from "vitest";
import {
  STACK_PREFETCH_CONFIG,
  WINDOW_PRESETS,
  annotationBelongsToSeries,
  annotationTargetViewportId,
  isMeasurementAnnotation,
  montageIndices,
  mprPlaneLayout,
  nextViewportRotation,
  seriesSafetyNotice,
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
    // TrackballRotate needs a 3D viewport.
    expect(toolFallback("rotate3d", 4, false)).toBe("window");
    expect(toolFallback("rotate3d", 4, true)).toBe("rotate3d");
    expect(toolFallback("length", 1, false)).toBe("length");
    expect(toolFallback("nonsense", 3, true)).toBe("window");
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
    // A raw CT volume spans 0..4095, so the physical -160..240 window must be
    // mapped back to stored values 864..1264 before building transfer points.
    expect(volumeTransferRange(ct, [0, 4095])).toEqual([864, 1264]);
  });
});
