import { describe, expect, it } from "vitest";
import {
  CT_WINDOW_PRESETS,
  STACK_PREFETCH_CONFIG,
  WINDOW_PRESETS,
  annotationBelongsToSeries,
  annotationTargetViewportId,
  availableWindowPresets,
  defaultWindowPreset,
  computeSliceNormal,
  findSpatialSliceIndex,
  comparePairMode,
  isMeasurementAnnotation,
  montageIndices,
  mprPlaneLayout,
  nextViewportRotation,
  rescaledDicomPixels,
  seriesSafetyNotice,
  seriesSupportsHounsfield,
  syncedCompareIndices,
  toolFallback,
  toolClassesForLayout,
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

  it("keeps volume crosshairs out of stack compare so Reference Lines can render", () => {
    const stackTools = toolClassesForLayout("stack").map((tool) => tool.toolName);
    const mprTools = toolClassesForLayout("mpr").map((tool) => tool.toolName);
    expect(stackTools).toContain("ReferenceLines");
    expect(stackTools).not.toContain("Crosshairs");
    expect(mprTools).toContain("Crosshairs");
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

  it("aligns slices based on 3D DICOM physical position when geometry is available", () => {
    const seriesA = {
      id: "seriesA",
      geometry: {
        orientation: [1, 0, 0, 0, 1, 0],
        ordered_slices: [
          { position: [0, 0, 0] },
          { position: [0, 0, 10] },
          { position: [0, 0, 20] },
          { position: [0, 0, 30] },
        ],
      },
    };
    const seriesB = {
      id: "seriesB",
      geometry: {
        orientation: [1, 0, 0, 0, 1, 0],
        ordered_slices: [
          { position: [0, 0, 2] },
          { position: [0, 0, 12] },
          { position: [0, 0, 22] },
          { position: [0, 0, 32] },
        ],
      },
    };

    expect(findSpatialSliceIndex(seriesA, 2, seriesB)).toBe(2);
    expect(findSpatialSliceIndex(seriesA, 1, seriesB)).toBe(1);
    expect(syncedCompareIndices([0, 0], 0, 2, [4, 4], [seriesA, seriesB])).toEqual([2, 2]);
  });

  it("maps T1 slice 13 to T2 slice ~20 when spacings differ (real PACS crosslink)", () => {
    // T1: 26 slices at 5mm spacing, starting at z=0
    const t1Slices = Array.from({ length: 26 }, (_, i) => ({
      position: [0, 0, i * 5],
    }));
    // T2: 40 slices at 3mm spacing, starting at z=-5 (slight offset)
    const t2Slices = Array.from({ length: 40 }, (_, i) => ({
      position: [0, 0, -5 + i * 3],
    }));
    const t1 = {
      id: "t1series",
      geometry: {
        orientation: [1, 0, 0, 0, 1, 0],
        sliceSpacing: 5,
        ordered_slices: t1Slices,
      },
    };
    const t2 = {
      id: "t2series",
      geometry: {
        orientation: [1, 0, 0, 0, 1, 0],
        sliceSpacing: 3,
        ordered_slices: t2Slices,
      },
    };

    // T1 slice 13 is at z = 13*5 = 65mm
    // T2 slices: z = -5 + i*3. Closest to 65: i=23 → z=64mm (dist 1),
    //   i=24 → z=67mm (dist 2). So best = 23.
    expect(findSpatialSliceIndex(t1, 13, t2)).toBe(23);

    // T1 slice 0 is at z=0. T2 closest: i=1 → z=-2 (dist 2), i=2 → z=1 (dist 1). Best = 2.
    expect(findSpatialSliceIndex(t1, 0, t2)).toBe(2);

    // T1 slice 25 (last) is at z=125. T2 closest: i=39 → z=112 (dist 13).
    expect(findSpatialSliceIndex(t1, 25, t2)).toBe(39);

    // syncedCompareIndices should use spatial, not index-based offset
    const result = syncedCompareIndices([0, 0], 0, 13, [26, 40], [t1, t2]);
    expect(result).toEqual([13, 23]); // NOT [13, 13]
  });

  describe("spatial slice matching edge cases", () => {
    it("returns null when FrameOfReferenceUIDs differ", () => {
      const s1 = { geometry: { frameOfReferenceUID: "1.2.3", orientation: [1,0,0,0,1,0], ordered_slices: [{ position: [0, 0, 0] }] } };
      const s2 = { geometry: { frameOfReferenceUID: "1.2.4", orientation: [1,0,0,0,1,0], ordered_slices: [{ position: [0, 0, 0] }] } };
      expect(findSpatialSliceIndex(s1, 0, s2)).toBeNull();
    });

    it("returns null when synthetic FoR UIDs differ (cross-study)", () => {
      // Two series from different studies, both missing the DICOM FoR tag.
      // Backend gives each a synthetic FoR derived from its own study UID.
      const s1 = { geometry: { frameOfReferenceUID: "study-A", orientation: [1,0,0,0,1,0], sliceSpacing: 5, ordered_slices: [{ position: [0, 0, 0] }] } };
      const s2 = { geometry: { frameOfReferenceUID: "study-B", orientation: [1,0,0,0,1,0], sliceSpacing: 5, ordered_slices: [{ position: [0, 0, 0] }] } };
      expect(findSpatialSliceIndex(s1, 0, s2)).toBeNull();
    });

    it("allows crosslink when synthetic FoR UIDs match (same study)", () => {
      // Two series from the same study, both missing the DICOM FoR tag.
      // Backend gives both the same synthetic FoR derived from study UID.
      const s1 = { geometry: { frameOfReferenceUID: "study-X", orientation: [1,0,0,0,1,0], sliceSpacing: 5, ordered_slices: [{ position: [0, 0, 0] }] } };
      const s2 = { geometry: { frameOfReferenceUID: "study-X", orientation: [1,0,0,0,1,0], sliceSpacing: 5, ordered_slices: [{ position: [0, 0, 0] }] } };
      expect(findSpatialSliceIndex(s1, 0, s2)).toBe(0);
    });

    it("returns null for cross-plane (axial vs sagittal)", () => {
      // Axial: normal = (0, 0, 1)
      const axial = {
        geometry: {
          orientation: [1, 0, 0, 0, 1, 0],
          sliceSpacing: 5,
          ordered_slices: [{ position: [0, 0, 10] }],
        },
      };
      // Sagittal: row=[0,1,0] col=[0,0,-1] → normal=(-1,0,0)
      // Slices span the head width, so some slice will be close in |Δx|
      // but |dot(axialNormal, sagittalNormal)| = 0 < 0.9 → must return null
      const sagittal = {
        geometry: {
          orientation: [0, 1, 0, 0, 0, -1],
          sliceSpacing: 2,
          ordered_slices: [
            { position: [-4, 0, 0] },
            { position: [-2, 0, 0] },
            { position: [0, 0, 0] },
            { position: [2, 0, 0] },
          ],
        },
      };
      expect(findSpatialSliceIndex(axial, 0, sagittal)).toBeNull();
    });

    describe("why cross-plane sync by slice index does not work", () => {
      it("findSpatialSliceIndex returns null for orthogonal series, proving no slice-based sync is possible", () => {
        // Real axial: 10 slices, only Z varies. X and Y are constant.
        const axial = {
          geometry: {
            orientation: [1, 0, 0, 0, 1, 0],
            sliceSpacing: 5,
            ordered_slices: Array.from({ length: 10 }, (_, i) => ({
              position: [0, 0, i * 5],
            })),
          },
        };
        // Sagittal: orthogonal to axial.
        const sagittal = {
          geometry: {
            orientation: [0, 1, 0, 0, 0, -1],
            sliceSpacing: 2,
            ordered_slices: [
              { position: [-4, 0, 0] },
              { position: [-2, 0, 0] },
              { position: [0, 0, 0] },
              { position: [2, 0, 0] },
            ],
          },
        };
        // Co-planar guard blocks cross-plane → null for every source slice.
        // This is correct: projection onto the target normal drops the
        // axis along which the source varies (Z for axial, X for sagittal),
        // so any "cross-plane slice index" would be constant and useless.
        // Reference lines solve this visually instead.
        for (let i = 0; i < 10; i++) {
          expect(findSpatialSliceIndex(axial, i, sagittal)).toBeNull();
        }
      });

      it("keeps cross-plane slices independent so reference lines remain meaningful", () => {
        const axial = {
          sliceCount: 10,
          geometry: {
            orientation: [1, 0, 0, 0, 1, 0],
            sliceSpacing: 5,
            ordered_slices: Array.from({ length: 10 }, (_, i) => ({
              position: [0, 0, i * 5],
            })),
          },
        };
        const sagittal = {
          sliceCount: 8,
          geometry: {
            orientation: [0, 1, 0, 0, 0, -1],
            sliceSpacing: 3,
            ordered_slices: Array.from({ length: 8 }, (_, i) => ({
              position: [i * 3, 0, 0],
            })),
          },
        };
        expect(comparePairMode(axial, sagittal)).toBe("reference");
        // Anchor [0, 2], scroll axial to 5 → sagittal stays on slice 2.
        const result = syncedCompareIndices([0, 2], 0, 5, [10, 8], [axial, sagittal]);
        expect(result).toEqual([5, 2]);
        const result2 = syncedCompareIndices([0, 2], 0, 9, [10, 8], [axial, sagittal]);
        expect(result2).toEqual([9, 2]);
      });

      it("never falls back to index sync across Frames of Reference", () => {
        const geometry = {
          orientation: [1, 0, 0, 0, 1, 0],
          ordered_slices: [{ position: [0, 0, 0] }, { position: [0, 0, 5] }],
        };
        const left = { geometry: { ...geometry, frameOfReferenceUID: "for-a" } };
        const right = { geometry: { ...geometry, frameOfReferenceUID: "for-b" } };
        expect(comparePairMode(left, right)).toBe("blocked");
        expect(syncedCompareIndices([0, 1], 0, 1, [2, 2], [left, right])).toEqual([1, 1]);
      });
    });

    it("syncs two parallel oblique series correctly (same non-axis normal)", () => {
      // Both tilted 45° around x: row=[1,0,0] col=[0,0.7071,0.7071]
      // normal = cross(row,col) = (0, -0.7071, 0.7071)
      // Positions must vary along the normal direction.
      // Moving 10mm along normal (0, -0.7071, 0.7071) means Δy ≈ -7.071, Δz ≈ +7.071.
      const obliqueOri = [1, 0, 0, 0, 0.7071, 0.7071];
      const s1 = {
        geometry: {
          orientation: obliqueOri,
          sliceSpacing: 10,
          ordered_slices: [{ position: [0, -7.071, 7.071] }],
        },
      };
      const s2 = {
        geometry: {
          orientation: obliqueOri,
          sliceSpacing: 10,
          ordered_slices: [
            { position: [0, 0, 0] },
            { position: [0, -7.071, 7.071] },
            { position: [0, -14.142, 14.142] },
          ],
        },
      };
      // Source at distance 10mm along normal matches target index 1 exactly
      expect(findSpatialSliceIndex(s1, 0, s2)).toBe(1);
    });

    it("clamps to boundary when source is outside target coverage but within extent", () => {
      const s1 = { geometry: { orientation: [1,0,0,0,1,0], sliceSpacing: 5, ordered_slices: [{ position: [0, 0, -20] }] } };
      // Target spans z=0 to z=50 (extent 50). Source at -20 is outside, but overshoot (20) <= max(extent 50, 50).
      // So it should clamp to the nearest boundary slice (z=0 -> index 0).
      const s2 = {
        geometry: {
          orientation: [1,0,0,0,1,0],
          sliceSpacing: 5,
          ordered_slices: [
            { position: [0, 0, 0] },
            { position: [0, 0, 25] },
            { position: [0, 0, 50] },
          ]
        }
      };
      expect(findSpatialSliceIndex(s1, 0, s2)).toBe(0);
    });

    it("returns null when overshoot exceeds the target extent (different anatomy)", () => {
      const s1 = { geometry: { orientation: [1,0,0,0,1,0], sliceSpacing: 5, ordered_slices: [{ position: [0, 0, -60] }] } };
      // Target spans z=0 to z=50 (extent 50). Source at -60 overshoots by 60.
      // 60 > max(50, 50) -> null.
      const s2 = {
        geometry: {
          orientation: [1,0,0,0,1,0],
          sliceSpacing: 5,
          ordered_slices: [
            { position: [0, 0, 0] },
            { position: [0, 0, 25] },
            { position: [0, 0, 50] },
          ]
        }
      };
      expect(findSpatialSliceIndex(s1, 0, s2)).toBeNull();
    });

    it("works correctly when ordered_slices are inverted", () => {
      const s1 = { geometry: { orientation: [1,0,0,0,1,0], ordered_slices: [{ position: [0, 0, 18] }] } };
      const s2 = {
        geometry: {
          orientation: [1, 0, 0, 0, 1, 0],
          sliceSpacing: 10,
          ordered_slices: [
            { position: [0, 0, 30] },
            { position: [0, 0, 20] },
            { position: [0, 0, 10] },
            { position: [0, 0, 0] },
          ],
        },
      };
      // Closest to z=18 is z=20 (index 1).
      expect(findSpatialSliceIndex(s1, 0, s2)).toBe(1);
    });
  });

  it("shows a visible safety warning for first-frame-only multi-frame DICOM", () => {
    expect(seriesSafetyNotice({
      sourceType: "dicom",
      pixelData: { numberOfFrames: 12 },
    })).toEqual({
      level: "warning",
      text: "DICOM multi-frame: viewer hiện chỉ hiển thị khung đầu tiên; không dùng MPR/3D cho series này.",
    });
  });

  describe("computeSliceNormal", () => {
    it("returns (0,0,1) for standard axial orientation", () => {
      const n = computeSliceNormal([1, 0, 0, 0, 1, 0]);
      expect(n[0]).toBeCloseTo(0);
      expect(n[1]).toBeCloseTo(0);
      expect(n[2]).toBeCloseTo(1);
    });

    it("returns (-1,0,0) for sagittal orientation", () => {
      const n = computeSliceNormal([0, 1, 0, 0, 0, -1]);
      expect(n[0]).toBeCloseTo(-1);
      expect(n[1]).toBeCloseTo(0);
      expect(n[2]).toBeCloseTo(0);
    });

    it("returns null for missing or degenerate orientation", () => {
      expect(computeSliceNormal(null)).toBeNull();
      expect(computeSliceNormal([1, 0, 0])).toBeNull();
      expect(computeSliceNormal([0, 0, 0, 0, 0, 0])).toBeNull();
    });
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
