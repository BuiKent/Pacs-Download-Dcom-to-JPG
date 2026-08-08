import {
  Enums as CoreEnums,
  RenderingEngine,
  cache,
  imageLoader,
  init as initCore,
  metaData,
  setVolumesForViewports,
  utilities,
  volumeLoader,
} from "@cornerstonejs/core";
import {
  AngleTool,
  ArrowAnnotateTool,
  CrosshairsTool,
  EllipticalROITool,
  Enums as ToolEnums,
  LengthTool,
  PanTool,
  PlanarFreehandROITool,
  ReferenceCursors,
  ReferenceLinesTool,
  StackScrollTool,
  ToolGroupManager,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
  addTool,
  annotation,
  init as initTools,
  utilities as toolUtilities,
} from "@cornerstonejs/tools";
import { api, apiBlob, apiPixelData, imagePath } from "./api.js";

// Cornerstone allocates a pool of WebGL contexts per RenderingEngine
// (webGlContextCount: 7 by default) and the browser caps how many contexts a
// page may keep alive. destroy() does not reliably free them, so the viewer
// keeps exactly one engine for the whole session and only swaps its viewports.
const ENGINE_ID = "dcom-rendering-engine";
const TOOL_GROUP_ID = "dcom-tools";
const IMAGE_SCHEME = "dcomjpg";
const VOLUME_SCHEME = "cornerstoneStreamingImageVolume";

export const STACK_PREFETCH_CONFIG = Object.freeze({
  // Keep the working set small: enough for smooth wheel scrolling without
  // decoding the whole 100-300 slice series in the background.
  maxImagesToPrefetch: 8,
  minBefore: 2,
  maxAfter: 6,
  directionExtraImages: 0,
  preserveExistingPool: true,
});

const toolClasses = [
  PanTool,
  ZoomTool,
  WindowLevelTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  PlanarFreehandROITool,
  ArrowAnnotateTool,
  CrosshairsTool,
  TrackballRotateTool,
  ReferenceLinesTool,
  ReferenceCursors,
];

const toolByMode = {
  window: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  ellipse: EllipticalROITool.toolName,
  freehand: PlanarFreehandROITool.toolName,
  text: ArrowAnnotateTool.toolName,
  crosshair: CrosshairsTool.toolName,
  orbit3d: TrackballRotateTool.toolName,
};

// What the "clear" button removes and what counts as user-made mark-up. Text
// notes belong here: they are drawn on the same annotation layer and would
// otherwise be impossible to remove from the toolbar.
const measurementToolNames = new Set([
  LengthTool.toolName,
  AngleTool.toolName,
  EllipticalROITool.toolName,
  PlanarFreehandROITool.toolName,
  ArrowAnnotateTool.toolName,
]);

let initialized = false;
let renderingEngine = null;
let engineUsable = false;
let toolGroup = null;
let resizeObserver = null;
let activeElements = [];
let activeViewportId = "";
let maximizedViewportId = null;
let activeSeries = null;
let activeSeriesList = [];
let activeMode = "single";
let currentTool = "window";
let mprPrimaryPlane = "axial";
// Which toolClassesForLayout() set the live tool group was built from. A tool
// missing from that set can never be activated, so toolFallback must know it.
let toolGroupLayout = "stack";
let referenceLinesEnabled = true;
let referenceCursorEnabled = true;
let cineTimer = null;
let loadGeneration = 0;
let onStatus = () => {};
let onSlice = () => {};
const seriesRegistry = new Map();
const manifestRegistry = new Map();
const decodeRequests = new Map();
let decodeWorker = null;
let decodeWorkerDisabled = false;
let decodeRequestId = 0;
let decodePath = "main";
let lastDecodeStats = null;

export const WINDOW_PRESETS = Object.freeze({
  full: { lower: 0, upper: 255 },
  soft: { lower: 28, upper: 205 },
  contrast: { lower: 62, upper: 168 },
});

/**
 * Standard head-CT windows, in Hounsfield units.
 *
 * These are absolute because CT is absolute: water is 0 HU and air is -1000 HU
 * by definition, so the same width/centre means the same tissue contrast on
 * every scanner. Only valid once the modality LUT has been applied — see
 * seriesSupportsHounsfield.
 *
 * Scoped to the brain studies this app is used for. Body windows (lung,
 * mediastinum, liver, abdomen) are deliberately absent rather than forgotten.
 */
export const CT_WINDOW_PRESETS = Object.freeze([
  { id: "ct-brain", label: "Não", width: 80, center: 40 },
  { id: "ct-stroke", label: "Đột quỵ / hố sau", width: 40, center: 40 },
  { id: "ct-subdural", label: "Máu tụ dưới màng cứng", width: 215, center: 75 },
  { id: "ct-bone", label: "Xương", width: 1800, center: 400 },
  { id: "ct-temporal", label: "Xương thái dương", width: 4000, center: 700 },
]);

const CT_PRESETS_BY_ID = new Map(CT_WINDOW_PRESETS.map((item) => [item.id, item]));

/**
 * Relative presets, the only kind MR can have.
 *
 * MR signal intensity carries no absolute scale — the same T1 sequence yields
 * different raw numbers on a different scanner, or on the same scanner on a
 * different day. So an MR preset can only be expressed against the window the
 * modality itself recorded, never as a fixed pair of numbers.
 */
export const RELATIVE_WINDOW_PRESETS = Object.freeze({
  full: 1,
  soft: 1.5,
  contrast: 0.6,
});

/** True when pixel values can be read as Hounsfield units. */
export function seriesSupportsHounsfield(series) {
  if (series?.sourceType !== "dicom") return false;
  if (series?.modality !== "CT") return false;
  const pixel = series.pixelData || {};
  // The backend defaults a missing rescale to slope 1 / intercept 0, which is
  // what DICOM implies anyway; this only rejects a rescale that cannot define
  // a scale at all.
  return Number.isFinite(pixel.rescaleSlope)
    && pixel.rescaleSlope !== 0
    && Number.isFinite(pixel.rescaleIntercept);
}

/** Presets offered for a series, most useful first. */
export function availableWindowPresets(series) {
  const relative = [
    { id: "full", label: series?.sourceType === "dicom" ? "DICOM mặc định" : "Toàn dải" },
    { id: "soft", label: series?.sourceType === "dicom" ? "Cửa sổ rộng" : "Mô mềm JPG" },
    { id: "contrast", label: series?.sourceType === "dicom" ? "Cửa sổ hẹp" : "Tương phản cao" },
  ];
  if (!seriesSupportsHounsfield(series)) return relative;
  // Named tissue windows lead: on a calibrated CT they are the ones actually
  // used to read the study, and the file's own window is the fallback.
  return [
    // `detail` stays out of the translated label so W/L reads the same in
    // every language.
    ...CT_WINDOW_PRESETS.map((item) => ({
      id: item.id,
      label: item.label,
      detail: `W${item.width}/L${item.center}`,
    })),
    ...relative,
  ];
}

/** Preset a series opens with. */
export function defaultWindowPreset(series) {
  return seriesSupportsHounsfield(series) ? "ct-brain" : "full";
}

function storedDicomRange(series) {
  const pixel = series?.pixelData || {};
  const bits = Math.max(1, Math.min(Number(pixel.bitsStored) || 16, 32));
  const signed = Number(pixel.pixelRepresentation) === 1;
  const storedLower = signed ? -(2 ** (bits - 1)) : 0;
  const storedUpper = signed ? (2 ** (bits - 1)) - 1 : (2 ** bits) - 1;
  const slope = Number.isFinite(pixel.rescaleSlope) && pixel.rescaleSlope !== 0
    ? pixel.rescaleSlope
    : 1;
  const intercept = Number.isFinite(pixel.rescaleIntercept) ? pixel.rescaleIntercept : 0;
  return {
    lower: storedLower * slope + intercept,
    upper: storedUpper * slope + intercept,
  };
}

/**
 * Display range for a preset, in modality-LUT output space (HU on CT).
 *
 * Fixed Hounsfield presets are honoured only for calibrated CT; everything else
 * — MR, and CT without a rescale — falls back to scaling the window the file
 * itself carries.
 */
export function windowPresetRange(name, series = null) {
  if (series?.sourceType !== "dicom") return WINDOW_PRESETS[name] || null;

  const preset = CT_PRESETS_BY_ID.get(name);
  if (preset) {
    if (!seriesSupportsHounsfield(series)) return null;
    return {
      lower: preset.center - preset.width / 2,
      upper: preset.center + preset.width / 2,
    };
  }

  const pixel = series.pixelData || {};
  const fallback = storedDicomRange(series);
  const center = Number.isFinite(pixel.windowCenter)
    ? pixel.windowCenter
    : (fallback.lower + fallback.upper) / 2;
  const defaultWidth = Number.isFinite(pixel.windowWidth) && pixel.windowWidth > 0
    ? pixel.windowWidth
    : Math.max(1, fallback.upper - fallback.lower);
  const scale = RELATIVE_WINDOW_PRESETS[name];
  if (!Number.isFinite(scale)) return null;
  const width = defaultWidth * scale;
  if (!Number.isFinite(width) || width <= 0) return null;
  return { lower: center - width / 2, upper: center + width / 2 };
}

export function seriesSafetyNotice(series) {
  if (!series) return null;
  const numberOfFrames = Number(series.pixelData?.numberOfFrames || 1);
  // Frames of an enhanced file are served as ordinary slices, so the only
  // thing left to warn about is a multi-frame file that carries no per-frame
  // position: it is viewable but has no 3D space to measure or crosslink in.
  if (series.sourceType === "dicom" && numberOfFrames > 1 && !series.geometry) {
    return {
      level: "warning",
      text: "DICOM multi-frame thiếu vị trí 3D theo khung: xem được từng khung, "
        + "nhưng không có MPR/3D và không đồng bộ theo vị trí với series khác.",
    };
  }
  if (series.sourceType === "dicom") return null;
  if (series.modality === "CT") {
    return {
      level: "danger",
      text: "CT đã chuyển sang JPG 8-bit: chỉ dùng xem hình thái và đo hình học; không dùng mức xám để suy luận HU hay cửa sổ CT chẩn đoán.",
    };
  }
  if (!["MR", "CT"].includes(series.modality)) {
    return {
      level: "warning",
      text: "Chưa xác định được modality của series JPG 8-bit; không dùng mức xám để định lượng tín hiệu hoặc đậm độ.",
    };
  }
  return null;
}

function parseImageId(imageId) {
  const match = new RegExp(`^${IMAGE_SCHEME}:([a-f0-9]{20}):(\\d+)$`).exec(imageId);
  if (!match) return null;
  return { seriesId: match[1], index: Number(match[2]) };
}

function metadataProvider(type, imageId) {
  const parsed = parseImageId(imageId);
  if (!parsed) return undefined;
  const series = seriesRegistry.get(parsed.seriesId);
  const manifest = manifestRegistry.get(parsed.seriesId);
  if (!series) return undefined;
  const geometry = series.geometry;
  if (type === "generalSeriesModule") {
    const modality = series.modality === "CT" ? "CT" : series.modality === "MR" ? "MR" : "OT";
    return { modality, seriesInstanceUID: parsed.seriesId };
  }
  if (type === "generalImageModule") {
    return { instanceNumber: parsed.index + 1 };
  }
  if (type === "imagePixelModule") {
    const pixel = series.pixelData || {};
    return {
      samplesPerPixel: pixel.samplesPerPixel || 1,
      photometricInterpretation: pixel.photometricInterpretation || "MONOCHROME2",
      rows: geometry?.rows || pixel.rows || 1,
      columns: geometry?.columns || pixel.columns || 1,
      bitsAllocated: pixel.bitsAllocated || 8,
      bitsStored: pixel.bitsStored || 8,
      highBit: pixel.highBit ?? 7,
      pixelRepresentation: pixel.pixelRepresentation || 0,
    };
  }
  if (type === "modalityLutModule") {
    // decodeDicomImage already rescales, so the LUT here must be the identity:
    // reporting the file's slope/intercept again would apply them twice.
    return {
      rescaleIntercept: 0,
      rescaleSlope: 1,
      rescaleType: series.modality === "CT" ? "HU" : "US",
    };
  }
  if (type === "voiLutModule") {
    const center = series.pixelData?.windowCenter;
    const width = series.pixelData?.windowWidth;
    return {
      windowCenter: [Number.isFinite(center) ? center : 127.5],
      windowWidth: [Number.isFinite(width) && width > 0 ? width : 255],
    };
  }
  if (type === "imagePlaneModule" && geometry && manifest) {
    const item = manifest.ordered_slices?.[parsed.index];
    if (!item) return undefined;
    return {
      frameOfReferenceUID: geometry.frameOfReferenceUID || parsed.seriesId,
      rows: geometry.rows,
      columns: geometry.columns,
      imageOrientationPatient: geometry.orientation,
      rowCosines: geometry.orientation.slice(0, 3),
      columnCosines: geometry.orientation.slice(3, 6),
      imagePositionPatient: item.position,
      pixelSpacing: [...geometry.pixelSpacing],
      rowPixelSpacing: geometry.pixelSpacing[0],
      columnPixelSpacing: geometry.pixelSpacing[1],
      sliceThickness: geometry.sliceSpacing,
      spacingBetweenSlices: geometry.sliceSpacing,
      sliceLocation: item.distance,
    };
  }
  return undefined;
}

function makeImageId(seriesId, index) {
  return `${IMAGE_SCHEME}:${seriesId}:${index}`;
}

function greyscaleCanvas(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const frame = context.createImageData(width, height);
  for (let source = 0, target = 0; source < pixels.length; source += 1, target += 4) {
    frame.data[target] = pixels[source];
    frame.data[target + 1] = pixels[source];
    frame.data[target + 2] = pixels[source];
    frame.data[target + 3] = 255;
  }
  context.putImageData(frame, 0, 0);
  return canvas;
}

async function decodeBlobOnMain(blob) {
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const scratch = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Không tạo được bộ giải mã ảnh.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height);
  for (let source = 0, target = 0; target < pixels.length; source += 4, target += 1) {
    pixels[target] = Math.round(
      rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114,
    );
  }
  decodePath = "main";
  return { pixels, width, height };
}

function rejectDecodeRequests(error) {
  for (const pending of decodeRequests.values()) pending.reject(error);
  decodeRequests.clear();
}

function getDecodeWorker() {
  if (decodeWorkerDisabled || typeof Worker !== "function") return null;
  if (decodeWorker) return decodeWorker;
  try {
    decodeWorker = new Worker(new URL("./image-worker.js", import.meta.url), { type: "module" });
    decodeWorker.addEventListener("message", (event) => {
      const { id, width, height, pixels, error } = event.data || {};
      const pending = decodeRequests.get(id);
      if (!pending) return;
      decodeRequests.delete(id);
      if (error) {
        pending.reject(new Error(error));
        return;
      }
      decodePath = "worker";
      // WebView2/Cornerstone can read a transferred worker buffer in JS but its
      // WebGL uploader may paint it black. A main-realm copy keeps decode and
      // grayscale conversion off-thread while giving vtk.js a normal local
      // ArrayBuffer it can upload reliably.
      const transferred = new Uint8Array(pixels);
      pending.resolve({ pixels: transferred.slice(), width, height });
    });
    decodeWorker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Bộ giải mã ảnh nền gặp sự cố.");
      rejectDecodeRequests(error);
      decodeWorker?.terminate();
      decodeWorker = null;
      decodeWorkerDisabled = true;
    });
    return decodeWorker;
  } catch (_) {
    decodeWorkerDisabled = true;
    return null;
  }
}

async function decodeBlob(blob) {
  const worker = getDecodeWorker();
  if (worker) {
    try {
      const id = ++decodeRequestId;
      return await new Promise((resolve, reject) => {
        decodeRequests.set(id, { resolve, reject });
        worker.postMessage({ id, blob });
      });
    } catch (error) {
      if (/OffscreenCanvas|createImageBitmap|giải mã ảnh nền/i.test(error?.message || "")) {
        decodeWorkerDisabled = true;
        decodeWorker?.terminate();
        decodeWorker = null;
      }
    }
  }
  return decodeBlobOnMain(blob);
}

function typedDicomPixels(buffer, pixelType) {
  const constructors = {
    uint8: Uint8Array,
    int8: Int8Array,
    uint16: Uint16Array,
    int16: Int16Array,
    uint32: Uint32Array,
    int32: Int32Array,
  };
  const Type = constructors[pixelType];
  if (!Type) throw new Error(`Kiểu pixel DICOM chưa được hỗ trợ: ${pixelType}`);
  return new Type(buffer);
}

/**
 * Convert stored pixels to modality-LUT output (Hounsfield units on CT).
 *
 * StackViewport applies no modality LUT of its own — it windows whatever values
 * getPixelData returns. Handing it raw stored values while asking for a window
 * in HU offsets the display by the whole rescale intercept, which on CT paints
 * every tissue above the window ceiling pure white.
 *
 * An integer output type is deliberate: StackViewport re-quantises a
 * Float32Array whose rescale is non-integral, undoing the scaling we just did.
 */
export function rescaledDicomPixels(pixels, slope, intercept, min, max) {
  if (slope === 1 && intercept === 0) return { pixels, min, max };
  const lower = Math.min(min * slope + intercept, max * slope + intercept);
  const upper = Math.max(min * slope + intercept, max * slope + intercept);
  const integral = Number.isInteger(slope) && Number.isInteger(intercept);
  let Type = Float32Array;
  if (integral) {
    if (lower >= -32768 && upper <= 32767) Type = Int16Array;
    else if (lower >= -2147483648 && upper <= 2147483647) Type = Int32Array;
  }
  const scaled = new Type(pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    scaled[index] = pixels[index] * slope + intercept;
  }
  return { pixels: scaled, min: lower, max: upper };
}

/**
 * Build the Cornerstone image descriptor for a colour DICOM frame.
 *
 * The backend already resolved palette LUTs and YBR into interleaved 8-bit
 * RGB, so there is nothing to window here: the samples are display values.
 * Cornerstone wants RGBA in the canvas but reads RGB triplets from
 * getPixelData, hence the two different layouts below.
 */
export function colorDicomImage({ rgb, rows, columns }) {
  const expected = rows * columns * 3;
  if (!rgb || rgb.length !== expected) {
    throw new Error(`Pixel màu DICOM không đầy đủ: ${rgb?.length ?? 0}/${expected}.`);
  }
  return {
    minPixelValue: 0,
    maxPixelValue: 255,
    slope: 1,
    intercept: 0,
    windowCenter: 127.5,
    windowWidth: 255,
    getPixelData: () => rgb,
    rows,
    columns,
    height: rows,
    width: columns,
    color: true,
    rgba: false,
    numberOfComponents: 3,
    invert: false,
    photometricInterpretation: "RGB",
    sizeInBytes: rgb.byteLength,
    dataType: "Uint8Array",
  };
}

function colorCanvas(rgb, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const frame = context.createImageData(width, height);
  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    frame.data[target] = rgb[source];
    frame.data[target + 1] = rgb[source + 1];
    frame.data[target + 2] = rgb[source + 2];
    frame.data[target + 3] = 255;
  }
  context.putImageData(frame, 0, 0);
  return canvas;
}

function dicomCanvas(pixels, width, height, min, max, invert) {
  const display = new Uint8Array(pixels.length);
  const span = Math.max(1, max - min);
  for (let index = 0; index < pixels.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(((pixels[index] - min) / span) * 255)));
    display[index] = invert ? 255 - value : value;
  }
  return greyscaleCanvas(display, width, height);
}

async function decodeDicomImage(imageId, parsed, series) {
  const decoded = await apiPixelData(imagePath(parsed.seriesId, parsed.index));
  const spacingForColor = series?.geometry?.pixelSpacing || series?.pixelData?.pixelSpacing;
  if (decoded.samples === 3) {
    const rgb = new Uint8Array(decoded.buffer);
    decodePath = "dicom-color";
    return {
      imageId,
      ...colorDicomImage({ rgb, rows: decoded.rows, columns: decoded.columns }),
      getCanvas: () => colorCanvas(rgb, decoded.columns, decoded.rows),
      columnPixelSpacing: spacingForColor?.[1],
      rowPixelSpacing: spacingForColor?.[0],
      imageQualityStatus: CoreEnums.ImageQualityStatus.FULL_RESOLUTION,
    };
  }
  const stored = typedDicomPixels(decoded.buffer, decoded.pixelType);
  if (stored.length !== decoded.rows * decoded.columns) {
    throw new Error(`Pixel DICOM không đầy đủ: ${stored.length}/${decoded.rows * decoded.columns}.`);
  }
  const { pixels, min, max } = rescaledDicomPixels(
    stored, decoded.slope, decoded.intercept, decoded.min, decoded.max,
  );
  const spacing = series?.geometry?.pixelSpacing || series?.pixelData?.pixelSpacing;
  const invert = decoded.photometric === "MONOCHROME1";
  decodePath = "dicom-direct";
  return {
    imageId,
    minPixelValue: min,
    maxPixelValue: max,
    // The pixels below are already in modality units, so the rescale must be
    // declared as applied — otherwise anything downstream applies it twice.
    slope: 1,
    intercept: 0,
    preScale: {
      enabled: true,
      scaled: true,
      scalingParameters: {
        modality: series?.modality,
        rescaleSlope: decoded.slope,
        rescaleIntercept: decoded.intercept,
      },
    },
    windowCenter: decoded.windowCenter,
    windowWidth: decoded.windowWidth,
    getPixelData: () => pixels,
    getCanvas: () => dicomCanvas(
      pixels, decoded.columns, decoded.rows, min, max, invert,
    ),
    rows: decoded.rows,
    columns: decoded.columns,
    height: decoded.rows,
    width: decoded.columns,
    color: false,
    rgba: false,
    numberOfComponents: 1,
    columnPixelSpacing: spacing?.[1],
    rowPixelSpacing: spacing?.[0],
    invert,
    photometricInterpretation: decoded.photometric,
    sizeInBytes: pixels.byteLength,
    dataType: pixels.constructor.name,
    imageQualityStatus: CoreEnums.ImageQualityStatus.FULL_RESOLUTION,
  };
}

function decodeImage(imageId) {
  const parsed = parseImageId(imageId);
  const promise = (async () => {
    if (!parsed) throw new Error("ImageId không hợp lệ.");
    const series = seriesRegistry.get(parsed.seriesId);
    if (series?.sourceType === "dicom") {
      return decodeDicomImage(imageId, parsed, series);
    }
    const blob = await apiBlob(imagePath(parsed.seriesId, parsed.index));
    const { pixels, width, height } = await decodeBlob(blob);
    if (!lastDecodeStats) {
      let min = 255;
      let max = 0;
      let nonZero = 0;
      for (const value of pixels) {
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (value) nonZero += 1;
      }
      lastDecodeStats = { width, height, min, max, nonZero };
    }
    const spacing = series?.geometry?.pixelSpacing || series?.pixelData?.pixelSpacing;
    return {
      imageId,
      minPixelValue: 0,
      maxPixelValue: 255,
      slope: 1,
      intercept: 0,
      windowCenter: 127.5,
      windowWidth: 255,
      getPixelData: () => pixels,
      // Only the CPU fallback for colour images asks for a canvas. Rebuilding it
      // on demand keeps a 4x RGBA copy of every cached slice out of memory —
      // Cornerstone bills the cache by sizeInBytes and cannot see such a copy.
      getCanvas: () => greyscaleCanvas(pixels, width, height),
      rows: height,
      columns: width,
      height,
      width,
      color: false,
      rgba: false,
      numberOfComponents: 1,
      columnPixelSpacing: spacing?.[1],
      rowPixelSpacing: spacing?.[0],
      invert: false,
      photometricInterpretation: "MONOCHROME2",
      sizeInBytes: pixels.byteLength,
      dataType: "Uint8Array",
      imageQualityStatus: CoreEnums.ImageQualityStatus.FULL_RESOLUTION,
    };
  })();
  return { promise };
}

export async function initViewer(callbacks = {}) {
  onStatus = callbacks.onStatus || onStatus;
  onSlice = callbacks.onSlice || onSlice;
  if (initialized) return;
  await initCore();
  await initTools();
  toolUtilities.stackContextPrefetch.setConfiguration(STACK_PREFETCH_CONFIG);
  imageLoader.registerImageLoader(IMAGE_SCHEME, decodeImage);
  metaData.addProvider(metadataProvider, 10000);
  for (const ToolClass of toolClasses) {
    try {
      addTool(ToolClass);
    } catch (_) {
      // Tool registration is global and may already exist during hot reload.
    }
  }
  initialized = true;
}

/** Ask for the text of a note, using an in-page prompt.
 *
 * ArrowAnnotateTool defaults to `window.prompt`, which WebView2 can suppress
 * outright and which cannot be localised. This dialog is plain DOM so it works
 * under the local API's strict CSP (no inline handlers, no external assets).
 */
function askForText(initial = "") {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "text-prompt-backdrop";
    const box = document.createElement("form");
    box.className = "text-prompt";
    const label = document.createElement("label");
    label.textContent = TEXT_PROMPT_LABEL;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.value = initial;
    const actions = document.createElement("div");
    actions.className = "text-prompt-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = TEXT_PROMPT_CANCEL;
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "primary";
    confirm.textContent = TEXT_PROMPT_CONFIRM;

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      resolve(value);
    };
    box.addEventListener("submit", (event) => {
      event.preventDefault();
      close(input.value.trim() || null);
    });
    cancel.addEventListener("click", () => close(null));
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close(null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(null);
      // The viewer binds single letters to tools; typing a note must not fire them.
      event.stopPropagation();
    });

    label.append(input);
    actions.append(cancel, confirm);
    box.append(label, actions);
    backdrop.append(box);
    document.body.append(backdrop);
    input.focus();
    input.select();
  });
}

// Set from the UI so the dialog follows the selected language.
let TEXT_PROMPT_LABEL = "Nội dung ghi chú";
let TEXT_PROMPT_CONFIRM = "Thêm";
let TEXT_PROMPT_CANCEL = "Bỏ";

export function configureTextPrompt({ label, confirm, cancel }) {
  TEXT_PROMPT_LABEL = label || TEXT_PROMPT_LABEL;
  TEXT_PROMPT_CONFIRM = confirm || TEXT_PROMPT_CONFIRM;
  TEXT_PROMPT_CANCEL = cancel || TEXT_PROMPT_CANCEL;
}

function configureTextAnnotations(group) {
  // A note with no text is invisible mark-up the user cannot select or delete,
  // so an empty answer discards the annotation instead of creating one.
  group.setToolConfiguration(ArrowAnnotateTool.toolName, {
    getTextCallback: (done) => { askForText("").then(done); },
    changeTextCallback: (data, event, done) => {
      askForText(data?.data?.text || "").then(done);
    },
  });
}

export function registerSeries(series) {
  seriesRegistry.set(series.id, series);
}

async function ensureManifest(series) {
  // The manifest provides ordered_slices (per-slice 3D positions) required
  // for both MPR/3D volume rendering AND simple 2D spatial crosslinking.
  // Any series with valid geometry has a manifest the backend can serve,
  // even when it doesn't meet the stricter MPR/3D readiness threshold.
  if (!series.mprReady && !series.geometry) return null;
  if (!manifestRegistry.has(series.id)) {
    try {
      manifestRegistry.set(series.id, await api(`/api/series/${series.id}/manifest`));
    } catch (_) {
      // Series without spatial data — crosslink will fall back to index sync.
      return null;
    }
  }
  return manifestRegistry.get(series.id);
}

function engineIsLive() {
  return Boolean(renderingEngine) && engineUsable;
}

function destroyCurrent() {
  // The listeners die with the elements; clearing the anchor stops a stale
  // layout's pane list from being consulted by the next one.
  compareSync = emptyCompareSync();
  stopCine();
  loadGeneration += 1;
  resizeObserver?.disconnect();
  resizeObserver = null;
  for (const element of activeElements) {
    try {
      toolUtilities.stackContextPrefetch.disable(element);
    } catch (_) {
      // The viewport may already have been removed during a rapid mode change.
    }
  }
  annotation.state.removeAllAnnotations();
  if (toolGroup) {
    ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
    toolGroup = null;
  }
  // The layout key must die with the group it describes, otherwise the next
  // toolFallback() call answers for a layout that no longer exists.
  toolGroupLayout = "stack";
  // Release each viewport explicitly: this is what returns its slot in the
  // engine's WebGL context pool. setViewports() alone leaves the slot bound.
  if (engineIsLive()) {
    for (const viewport of renderingEngine.getViewports() || []) {
      try {
        renderingEngine.disableElement(viewport.id);
      } catch (_) {
        // Already released by a previous layout change.
      }
    }
  }
  activeElements = [];
  activeViewportId = "";
  maximizedViewportId = null;
}

function createRenderingEngine() {
  if (engineIsLive()) return renderingEngine;
  renderingEngine = new RenderingEngine(ENGINE_ID);
  engineUsable = true;
  return renderingEngine;
}

/** Release every GPU resource. Only for window teardown, never per layout. */
export function disposeViewer() {
  destroyCurrent();
  if (engineIsLive()) {
    try {
      renderingEngine.destroy();
    } catch (_) {
      // Nothing else can be done while the window is closing.
    }
  }
  renderingEngine = null;
  engineUsable = false;
  activeSeries = null;
  activeSeriesList = [];
  rejectDecodeRequests(new Error("Cửa sổ viewer đã đóng."));
  decodeWorker?.terminate();
  decodeWorker = null;
}

function createToolGroup(viewportIds, mode = "stack") {
  const threeDimensional = mode === "volume3d";
  // A stale group survives a failed teardown and would block creation.
  ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
  toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) throw new Error("Không tạo được nhóm công cụ.");
  toolGroupLayout = mode;
  const allowed = toolClassesForLayout(mode);
  for (const ToolClass of allowed) {
    toolGroup.addTool(ToolClass.toolName);
  }
  if (allowed.includes(ArrowAnnotateTool)) configureTextAnnotations(toolGroup);
  for (const viewportId of viewportIds) {
    toolGroup.addViewport(viewportId, ENGINE_ID);
  }
  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
  });
  if (!threeDimensional) {
    toolGroup.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
    });
  }
  if (allowed.includes(WindowLevelTool)) {
    toolGroup.setToolActive(WindowLevelTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary, modifierKey: 17 }],
    });
  }
  // Reference lines render passively (Enabled state) — they show where one
  // viewport's current slice intersects another viewport's plane. Only useful
  // in compare layouts where multiple viewports coexist.
  if (allowed.includes(ReferenceLinesTool) && referenceLinesEnabled) {
    toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
    updateReferenceLineSource();
  }
  updateReferenceCursor();
}

function installResizeObserver(container) {
  resizeObserver = new ResizeObserver(() => {
    try {
      renderingEngine?.resize(true, true);
    } catch (_) {
      // Ignore a resize racing with layout replacement.
    }
  });
  resizeObserver.observe(container);
}

async function settleVolumeRendering() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!engineIsLive()) return;
  renderingEngine.resize(true, true);
  renderingEngine.render();
}

function getOrientationStringLPS(vector) {
  if (!vector || vector.length !== 3) return "";
  const absX = Math.abs(vector[0]), absY = Math.abs(vector[1]), absZ = Math.abs(vector[2]);
  const max = Math.max(absX, absY, absZ);
  if (max === absX) return vector[0] < 0 ? "R" : "L";
  if (max === absY) return vector[1] < 0 ? "A" : "P";
  if (max === absZ) return vector[2] < 0 ? "I" : "S";
  return "";
}

function updateViewportOverlays(viewportId, tl, tr, bl, br, ot, ob, ol, or) {
  const viewport = renderingEngine?.getViewport(viewportId);
  if (!viewport) return;
  const series = seriesRegistry.get(viewport.element?.dataset?.seriesId);
  if (!series) return;
  const manifest = manifestRegistry.get(series.id) || {};
  
  const patientName = manifest.patientName || manifest.patient_name || "";
  const patientId = manifest.patientId || manifest.patient_id || "";
  const dob = manifest.patientBirthDate ? `DOB: ${manifest.patientBirthDate}` : "";
  tl.innerText = [patientName, patientId, dob].filter(Boolean).join("\n");
  
  const modality = series.modality || manifest.modality || "";
  const studyDate = manifest.studyDate || manifest.study_date || "";
  const inst = manifest.institutionName || manifest.institution_name || "";
  tr.innerText = [studyDate, modality, inst].filter(Boolean).join("\n");
  
  const zoom = Math.round((viewport.getZoom?.() || 1) * 100);
  const props = typeof viewport.getProperties === "function" ? viewport.getProperties() : {};
  const range = props.voiRange;
  const wwText = range && Number.isFinite(range.lower) && Number.isFinite(range.upper)
    ? `WW/WL: ${Math.round(range.upper - range.lower)} / ${Math.round((range.upper + range.lower) / 2)}`
    : "";
  bl.innerText = `Zoom: ${zoom}%\n${wwText}`.trim();
  
  let sliceInfo = "";
  if (typeof viewport.getCurrentImageIdIndex === "function") {
    const idx = viewport.getCurrentImageIdIndex();
    const count = viewport.getImageIds?.().length || series.sliceCount || 1;
    sliceInfo = `Im: ${idx + 1}/${count}`;
  }
  
  let orientation = "";
  if (viewport.getCamera) {
    const camera = viewport.getCamera();
    if (camera.viewPlaneNormal && camera.viewUp) {
      const vpn = camera.viewPlaneNormal;
      const vUp = camera.viewUp;
      ot.innerText = getOrientationStringLPS(vUp);
      ob.innerText = getOrientationStringLPS([-vUp[0], -vUp[1], -vUp[2]]);
      
      const rightVec = [
        vUp[1] * vpn[2] - vUp[2] * vpn[1],
        vUp[2] * vpn[0] - vUp[0] * vpn[2],
        vUp[0] * vpn[1] - vUp[1] * vpn[0]
      ];
      or.innerText = getOrientationStringLPS(rightVec);
      ol.innerText = getOrientationStringLPS([-rightVec[0], -rightVec[1], -rightVec[2]]);
      
      const normalStr = getOrientationStringLPS(vpn);
      if (normalStr) {
        orientation = normalStr === "S" || normalStr === "I" ? "Axial" 
                    : normalStr === "L" || normalStr === "R" ? "Sagittal" 
                    : "Coronal";
      }
    }
  }
  
  br.innerText = [sliceInfo, orientation].filter(Boolean).join("\n");
}

function viewportElement(container, id, label, shellClass = "", seriesId = "") {
  const shell = document.createElement("section");
  shell.className = `viewport-shell ${shellClass}`.trim();
  shell.dataset.viewportId = id;
  shell.dataset.seriesId = seriesId;
  const tag = document.createElement("div");
  tag.className = "viewport-label";
  tag.textContent = label;
  const element = document.createElement("div");
  element.id = id;
  element.className = "viewport";
  element.dataset.seriesId = seriesId;
  element.oncontextmenu = (event) => event.preventDefault();
  let rightPressStart = null;
  element.addEventListener("pointerdown", (event) => {
    markActiveViewport(id);
    if (event.button === 2) {
      rightPressStart = { x: event.clientX, y: event.clientY, time: Date.now() };
    }
  });
  element.addEventListener("pointerup", (event) => {
    if (event.button !== 2 || !rightPressStart) return;
    const dx = event.clientX - rightPressStart.x;
    const dy = event.clientY - rightPressStart.y;
    const moved = Math.hypot(dx, dy);
    const elapsed = Date.now() - rightPressStart.time;
    rightPressStart = null;
    if (moved > 4 || elapsed > 400) return;
    recenterAtClientPoint(id, event.clientX, event.clientY);
  });
  element.addEventListener("dblclick", () => {
    if (maximizedViewportId && maximizedViewportId !== id) {
      document.getElementById(maximizedViewportId)?.closest(".viewport-shell")?.classList.remove("viewport-maximized");
    }
    const nowMaximized = shell.classList.toggle("viewport-maximized");
    maximizedViewportId = nowMaximized ? id : null;
    setTimeout(() => renderingEngine?.resize(true, false), 0);
  });

  const ot = document.createElement("div"); ot.className = "orientation-marker orientation-t";
  const ob = document.createElement("div"); ob.className = "orientation-marker orientation-b";
  const ol = document.createElement("div"); ol.className = "orientation-marker orientation-l";
  const or = document.createElement("div"); or.className = "orientation-marker orientation-r";
  const tl = document.createElement("div"); tl.className = "viewport-overlay overlay-tl";
  const tr = document.createElement("div"); tr.className = "viewport-overlay overlay-tr";
  const bl = document.createElement("div"); bl.className = "viewport-overlay overlay-bl";
  const br = document.createElement("div"); br.className = "viewport-overlay overlay-br";

  const refreshOverlays = () => updateViewportOverlays(id, tl, tr, bl, br, ot, ob, ol, or);
  element.addEventListener(CoreEnums.Events.IMAGE_RENDERED, refreshOverlays);
  element.addEventListener(CoreEnums.Events.CAMERA_MODIFIED, refreshOverlays);

  shell.append(tag, element, ot, ob, ol, or, tl, tr, bl, br);
  container.append(shell);
  activeElements.push(element);
  if (!activeViewportId) markActiveViewport(id);
  return element;
}

function installMprSwapButton(shell, plane) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mpr-swap-button";
  button.textContent = "⇄";
  button.title = `Đưa ${plane} vào khung lớn`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("pointerdown", (event) => {
    markActiveViewport(shell.dataset.viewportId);
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!setMprPrimaryPlane(plane)) return;
    shell.dispatchEvent(new CustomEvent("mprprimarychange", {
      bubbles: true,
      detail: { plane },
    }));
  });
  shell.append(button);
}

function installSliceControl({
  element,
  viewport,
  label,
  count,
  initialIndex,
  eventName,
  eventIndex,
  eventCount,
}) {
  if (!Number.isFinite(count) || count < 2) return;
  const shell = element.closest(".viewport-shell");
  const labelElement = shell?.querySelector(".viewport-label");
  if (!shell) return;
  const control = document.createElement("label");
  control.className = "slice-control";
  control.innerHTML = `<input type="range" min="0" max="${count - 1}" step="1"
    aria-label="Lát ảnh ${label}"><output></output>`;
  const input = control.querySelector("input");
  const output = control.querySelector("output");
  const update = (index, total = count) => {
    const safeTotal = Math.max(1, Number(total) || count);
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, safeTotal - 1));
    input.max = String(safeTotal - 1);
    input.value = String(safeIndex);
    output.textContent = `${safeIndex + 1}/${safeTotal}`;
    if (labelElement) labelElement.textContent = `${label} · ${safeIndex + 1}/${safeTotal}`;
    if (activeViewportId === element.id) {
      onSlice({ viewportId: element.id, label, index: safeIndex, count: safeTotal });
    }
  };
  control.addEventListener("pointerdown", (event) => {
    markActiveViewport(element.id);
    event.stopPropagation();
  });
  input.addEventListener("input", () => {
    const target = Number(input.value);
    const current = viewport.getCurrentImageIdIndex?.() ?? viewport.getSliceIndex?.() ?? 0;
    const delta = target - current;
    if (delta) viewport.scroll(delta);
    viewport.render();
  });
  element.addEventListener(eventName, (event) => {
    update(eventIndex(event.detail), eventCount?.(event.detail) || count);
  });
  shell.append(control);
  update(initialIndex, count);
}

function markActiveViewport(viewportId) {
  if (activeViewportId === viewportId) return;
  activeViewportId = viewportId;
  for (const shell of document.querySelectorAll("#workspace .viewport-shell")) {
    shell.classList.toggle("is-active", shell.dataset.viewportId === viewportId);
  }
  // When focus moves, the reference-line source must follow.
  updateReferenceLineSource();
}

function recenterAtClientPoint(viewportId, clientX, clientY) {
  const viewport = renderingEngine?.getViewport(viewportId);
  if (!viewport) return;
  const rect = viewport.element.getBoundingClientRect();
  const canvasPos = [clientX - rect.left, clientY - rect.top];
  let worldPos;
  try {
    worldPos = viewport.canvasToWorld(canvasPos);
  } catch (_) {
    return; // Camera chưa sẵn sàng (đang chuyển layout).
  }
  // MPR/3D: có crosshair dùng chung giữa các mặt phẳng — nhảy điểm này ở cả 3.
  const crosshairs = toolGroup?.getToolInstance?.(CrosshairsTool.toolName);
  if (crosshairs?.setToolCenter) {
    crosshairs.setToolCenter(worldPos, true);
    renderingEngine?.render();
  }
  // single/compare/montage: không có crosshair nên không làm gì thêm ở đây;
  // markActiveViewport() đã chạy ở pointerdown rồi nên vẫn "chọn xung" đúng.
}

export function activeViewport() {
  if (!engineIsLive() || !activeViewportId) return null;
  try {
    return renderingEngine.getViewport(activeViewportId) || null;
  } catch (_) {
    return null;
  }
}

export function mprPlaneLayout(plane) {
  const planes = ["axial", "coronal", "sagittal"];
  if (!planes.includes(plane)) return null;
  const secondary = planes.filter((item) => item !== plane);
  return {
    [plane]: "mpr-primary",
    [secondary[0]]: "mpr-secondary-top",
    [secondary[1]]: "mpr-secondary-bottom",
  };
}

export function setMprPrimaryPlane(plane, resize = true) {
  const layout = mprPlaneLayout(plane);
  if (!layout) return false;
  mprPrimaryPlane = plane;
  for (const shell of document.querySelectorAll(".mode-mpr .mpr-plane")) {
    shell.classList.remove("mpr-primary", "mpr-secondary-top", "mpr-secondary-bottom");
    const positionClass = layout[shell.dataset.plane];
    if (positionClass) shell.classList.add(positionClass);
  }
  if (resize) {
    requestAnimationFrame(() => {
      try {
        renderingEngine?.resize(true, true);
        renderingEngine?.render();
      } catch (_) {
        // Ignore a resize that races with a mode change.
      }
    });
  }
  return true;
}

export function nextViewportRotation(rotation = 0, delta = 90) {
  const current = Number.isFinite(Number(rotation)) ? Number(rotation) : 0;
  const change = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  return ((current + change) % 360 + 360) % 360;
}

function transformActiveViewport(update) {
  const viewport = activeViewport();
  if (!viewport || typeof viewport.getViewPresentation !== "function"
    || typeof viewport.setViewPresentation !== "function") {
    return null;
  }
  const current = viewport.getViewPresentation();
  const next = update(current || {});
  viewport.setViewPresentation(next);
  viewport.render();
  return next;
}

/** Rotates only the pane selected by the pointer, including MPR and 3D panes. */
export function rotateActiveViewportClockwise() {
  return transformActiveViewport((current) => ({
    ...current,
    rotation: nextViewportRotation(current.rotation, 90),
  }));
}

/** Mirrors only the pane selected by the pointer around its vertical axis. */
function flipActiveViewport(axis) {
  const viewport = activeViewport();
  if (!viewport || typeof viewport.getCamera !== "function"
    || typeof viewport.setCamera !== "function") {
    return null;
  }
  const camera = viewport.getCamera() || {};
  // Cornerstone's camera setter handles both directions of the toggle for
  // stack, orthographic volume and 3D volume viewports.
  const next = { [axis]: !Boolean(camera[axis]) };
  viewport.setCamera(next);
  viewport.render();
  return next;
}

export function flipActiveViewportHorizontal() {
  return flipActiveViewport("flipHorizontal");
}

export function flipActiveViewportVertical() {
  return flipActiveViewport("flipVertical");
}

function imageIds(series) {
  return Array.from({ length: series.sliceCount }, (_, index) => makeImageId(series.id, index));
}

export function montageIndices(sliceCount, paneCount, sourcePane = 0, sourceIndex = 0) {
  if (!Number.isInteger(sliceCount) || sliceCount < 1) return [];
  if (!Number.isInteger(paneCount) || paneCount < 1) return [];
  const safePane = Math.max(0, Math.min(sourcePane, paneCount - 1));
  const safeIndex = Math.max(0, Math.min(sourceIndex, sliceCount - 1));
  const maxBase = Math.max(0, sliceCount - paneCount);
  const base = Math.max(0, Math.min(safeIndex - safePane, maxBase));
  return Array.from(
    { length: paneCount },
    (_, index) => Math.min(base + index, sliceCount - 1),
  );
}

function setWorkspaceMode(container, mode) {
  const wasBusy = container.classList.contains("busy");
  container.className = `workspace-grid mode-${mode}`;
  if (wasBusy) container.classList.add("busy");
}

async function setupStackViewport(viewportId, series, index = 0, prefetch = true) {
  const viewport = renderingEngine.getStackViewport(viewportId);
  await viewport.setStack(imageIds(series), Math.max(0, Math.min(index, series.sliceCount - 1)));
  viewport.resetCamera();
  viewport.render();
  const element = document.getElementById(viewportId);
  element.dataset.seriesId = series.id;
  element.closest(".viewport-shell").dataset.seriesId = series.id;
  installSliceControl({
    element,
    viewport,
    label: series.name,
    count: series.sliceCount,
    initialIndex: index,
    eventName: CoreEnums.Events.STACK_NEW_IMAGE,
    eventIndex: (detail) => detail.imageIdIndex,
  });
  if (prefetch) {
    toolUtilities.stackContextPrefetch.enable(element);
  }
}

/**
 * Resolve ordered_slices for a series: first from any explicit property
 * (used by unit tests), then from the manifestRegistry (populated at
 * runtime by ensureManifest).
 */
function resolveOrderedSlices(series) {
  // Unit-test path: geometry.ordered_slices is set directly.
  if (series?.geometry?.ordered_slices) return series.geometry.ordered_slices;
  // Runtime path: the full manifest lives in manifestRegistry.
  const manifest = manifestRegistry.get(series?.id);
  return manifest?.ordered_slices || null;
}

/** Resolve orientation for a series. */
function resolveOrientation(series) {
  if (series?.geometry?.orientation) return series.geometry.orientation;
  const manifest = manifestRegistry.get(series?.id);
  return manifest?.image_orientation_patient || null;
}

/**
 * Compute the slice-plane normal from a 6-element ImageOrientationPatient.
 * Returns a unit-length [nx, ny, nz] or null when orientation is missing/degenerate.
 */
export function computeSliceNormal(orientation) {
  if (!Array.isArray(orientation) || orientation.length !== 6) return null;
  const row = orientation.slice(0, 3);
  const col = orientation.slice(3, 6);
  const nx = row[1] * col[2] - row[2] * col[1];
  const ny = row[2] * col[0] - row[0] * col[2];
  const nz = row[0] * col[1] - row[1] * col[0];
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) return null;
  return [nx / len, ny / len, nz / len];
}

/**
 * Calculates the slice index in targetSeries that best matches the 3D physical
 * location of sourceIndex in sourceSeries based on DICOM geometry.
 *
 * Guards:
 * 1. Different FrameOfReferenceUIDs → incompatible coordinate spaces → null.
 *    When the original DICOM tag is missing, the backend fills in the study UID
 *    so that series from the same study share one synthetic FoR.
 * 2. Cross-plane: if |dot(sourceNormal, targetNormal)| < 0.9 (~25°), there is no
 *    meaningful 1-to-1 slice correspondence → null.
 * 3. Distance threshold (Non-overlapping anatomy): Projects slices onto the target normal.
 *    If the source slice is outside the target's physical coverage range, it clamps to the
 *    nearest boundary slice (PACS edge-of-stack behavior). However, if the overshoot distance
 *    exceeds the entire extent of the target series itself (or 50mm fallback), it is deemed
 *    completely different anatomy (e.g. brain vs neck) → null.
 *
 * Uses the cross product of the target series' orientation to compute the slice
 * normal, then projects the source position onto that normal to find the closest
 * target slice by signed distance along the scan axis.
 */
export function findSpatialSliceIndex(sourceSeries, sourceIndex, targetSeries) {
  // Guard 1: FrameOfReferenceUID — block when FoR UIDs exist and differ.
  // Synthetic FoR UIDs are derived from the study UID, so same-study series
  // already share one FoR and pass naturally; cross-study pairs are blocked.
  const sourceFor = sourceSeries?.geometry?.frameOfReferenceUID;
  const targetFor = targetSeries?.geometry?.frameOfReferenceUID;
  if (sourceFor && targetFor && sourceFor !== targetFor) {
    return null;
  }

  // Guard 2: cross-plane check — normals must be near-parallel
  const sourceNormal = computeSliceNormal(resolveOrientation(sourceSeries));
  const targetNormal = computeSliceNormal(resolveOrientation(targetSeries));
  if (sourceNormal && targetNormal) {
    const dot = Math.abs(
      sourceNormal[0] * targetNormal[0] +
      sourceNormal[1] * targetNormal[1] +
      sourceNormal[2] * targetNormal[2],
    );
    if (dot < 0.9) return null; // planes differ by >~25°
  }

  return projectSliceIndex(sourceSeries, sourceIndex, targetSeries, sourceNormal, targetNormal);
}

export function toolClassesForLayout(mode = "stack") {
  if (mode === "volume3d") return [TrackballRotateTool, PanTool, ZoomTool];
  if (mode === "hybrid") return toolClasses;
  if (mode === "mpr") return toolClasses.filter((tool) => tool !== TrackballRotateTool);
  // CrosshairsTool is a volume-reslice tool. In a multi-stack compare layout
  // Cornerstone 4.22 calls getSlabThickness() on StackViewport, which throws
  // before ReferenceLinesTool can render. Stack compare uses Reference Lines;
  // point crosshair remains available in real MPR/3D layouts.
  return toolClasses.filter((tool) => (
    tool !== TrackballRotateTool && tool !== CrosshairsTool
  ));
}

/**
 * Decide how two compared series may follow each other.
 *
 * - spatial: co-planar DICOM geometry in the same frame of reference
 * - reference: different planes in the same frame; keep slices independent and
 *   let ReferenceLinesTool show their physical intersection
 * - blocked: different frames of reference; never infer a correspondence
 * - index: at least one side has no usable spatial geometry (for example JPG)
 */
export function comparePairMode(sourceSeries, targetSeries) {
  const sourceGeometry = sourceSeries?.geometry;
  const targetGeometry = targetSeries?.geometry;
  const sourceSlices = resolveOrderedSlices(sourceSeries);
  const targetSlices = resolveOrderedSlices(targetSeries);
  // resolveOrientation, not geometry.orientation: findSpatialSliceIndex reads
  // the same value through the manifest fallback, and the two must never
  // disagree about whether a pair is co-planar.
  const sourceNormal = computeSliceNormal(resolveOrientation(sourceSeries));
  const targetNormal = computeSliceNormal(resolveOrientation(targetSeries));

  if (!sourceGeometry || !targetGeometry) return "index";
  // Geometry was advertised but could not be resolved. Falling back to slice
  // numbers would turn corrupt/incomplete spatial metadata into a false match.
  if (!sourceNormal || !targetNormal || !sourceSlices?.length || !targetSlices?.length) {
    return "blocked";
  }

  const sourceFor = sourceGeometry.frameOfReferenceUID;
  const targetFor = targetGeometry.frameOfReferenceUID;
  if (sourceFor && targetFor && sourceFor !== targetFor) return "blocked";

  const dot = Math.abs(
    sourceNormal[0] * targetNormal[0]
    + sourceNormal[1] * targetNormal[1]
    + sourceNormal[2] * targetNormal[2],
  );
  return dot < 0.9 ? "reference" : "spatial";
}



/**
 * Core projection logic used by findSpatialSliceIndex.  Projects the source
 * slice position onto the target normal to find the closest target slice.
 */
function projectSliceIndex(sourceSeries, sourceIndex, targetSeries, sourceNormal, targetNormal) {
  const sourceSlices = resolveOrderedSlices(sourceSeries);
  const targetSlices = resolveOrderedSlices(targetSeries);
  if (!sourceSlices?.[sourceIndex] || !targetSlices?.length) {
    return null;
  }
  const sourcePos = sourceSlices[sourceIndex]?.position;
  if (!Array.isArray(sourcePos) || sourcePos.length !== 3) {
    return null;
  }

  let bestIndex = 0;
  let minDistance = Infinity;

  if (targetNormal) {
    // --- Normal-projection path (preferred) ---
    // Project source and all target positions onto the target normal.
    // This gives us both the best-match index AND the target coverage range
    // so we can distinguish "edge of stack" from "different anatomy."
    const sourceProj = sourcePos[0] * targetNormal[0] +
                       sourcePos[1] * targetNormal[1] +
                       sourcePos[2] * targetNormal[2];
    let projMin = Infinity;
    let projMax = -Infinity;

    for (let i = 0; i < targetSlices.length; i += 1) {
      const targetPos = targetSlices[i]?.position;
      if (!Array.isArray(targetPos) || targetPos.length !== 3) continue;

      const targetProj = targetPos[0] * targetNormal[0] +
                         targetPos[1] * targetNormal[1] +
                         targetPos[2] * targetNormal[2];
      if (targetProj < projMin) projMin = targetProj;
      if (targetProj > projMax) projMax = targetProj;

      const dist = Math.abs(sourceProj - targetProj);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = i;
      }
    }

    // Guard 3: non-overlapping anatomy.
    // Source beyond the target coverage is fine (clamps to boundary slice)
    // as long as it isn't farther away than the series extent itself —
    // that signals completely different anatomy (brain vs cervical spine).
    const extent = projMax - projMin;
    const overshoot = Math.max(0, projMin - sourceProj, sourceProj - projMax);
    if (overshoot > Math.max(extent, 50)) {
      return null;
    }
  } else {
    // --- Euclidean fallback (no orientation) ---
    for (let i = 0; i < targetSlices.length; i += 1) {
      const targetPos = targetSlices[i]?.position;
      if (!Array.isArray(targetPos) || targetPos.length !== 3) continue;

      const dist = Math.hypot(
        sourcePos[0] - targetPos[0],
        sourcePos[1] - targetPos[1],
        sourcePos[2] - targetPos[2],
      );
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = i;
      }
    }

    if (minDistance > 50) {
      return null;
    }
  }

  return bestIndex;
}

/**
 * Where every compared pane should sit when one of them is scrolled.
 *
 * The anchor is the set of indices captured when synchronisation was switched
 * on, not slice 0: panes deliberately scrolled apart must keep that gap. With
 * an anchor of [x, n, y], moving the middle pane to n+1 gives [x+1, n+1, y+1].
 * When 3D geometry is available for both co-planar series, it computes physical
 * 3D spatial slice alignment. Series without geometry fall back to relative
 * slice index. Cross-plane or different-FoR series stay at their current slice:
 * reference lines handle same-FoR cross-plane indication instead.
 */
export function syncedCompareIndices(anchor, sourcePane, sourceIndex, sliceCounts, seriesList = []) {
  const sourceSeries = seriesList[sourcePane];
  const delta = sourceIndex - (anchor[sourcePane] ?? 0);

  return anchor.map((base, pane) => {
    if (pane === sourcePane) return sourceIndex;
    const targetSeries = seriesList[pane];

    const pairMode = comparePairMode(sourceSeries, targetSeries);
    if (pairMode === "spatial") {
      const spatialIndex = findSpatialSliceIndex(sourceSeries, sourceIndex, targetSeries);
      if (typeof spatialIndex === "number" && Number.isInteger(spatialIndex)) {
        return spatialIndex;
      }
      // Both series claim valid co-planar geometry, but this source position is
      // outside the target coverage. Preserve the target rather than inventing
      // an index match.
      return base;
    }
    if (pairMode === "reference" || pairMode === "blocked") {
      return base;
    }

    const limit = Math.max(0, (sliceCounts[pane] || 1) - 1);
    return Math.max(0, Math.min(base + delta, limit));
  });
}

// Anchor and wiring for the comparison layouts. Rebuilt on every layout change.
function emptyCompareSync() {
  return { enabled: false, anchor: null, viewportIds: [], seriesList: [], sliceCounts: [], spatialMode: null };
}
let compareSync = emptyCompareSync();

function readCompareIndices() {
  return compareSync.viewportIds.map((viewportId) => (
    renderingEngine?.getStackViewport(viewportId)?.getCurrentImageIdIndex() ?? 0
  ));
}

/**
 * Summarise the pair modes for the toolbar status. "mixed" means a three-pane
 * layout contains more than one relationship type.
 */
function detectSpatialMode(seriesList) {
  const modes = new Set();
  for (let i = 0; i < seriesList.length; i += 1) {
    for (let j = i + 1; j < seriesList.length; j += 1) {
      const si = seriesList[i];
      const sj = seriesList[j];
      modes.add(comparePairMode(si, sj));
    }
  }
  return modes.size === 1 ? [...modes][0] : "mixed";
}

/** Turn position-locked scrolling on or off; returns the state actually in force. */
export function setCompareScrollSync(enabled) {
  if (!enabled || compareSync.viewportIds.length < 2) {
    compareSync.enabled = false;
    compareSync.anchor = null;
    compareSync.spatialMode = null;
    return false;
  }
  const spatialMode = detectSpatialMode(compareSync.seriesList);
  const hasSyncablePair = compareSync.seriesList.some((source, sourceIndex) => (
    compareSync.seriesList.some((target, targetIndex) => (
      targetIndex > sourceIndex
      && ["spatial", "index"].includes(comparePairMode(source, target))
    ))
  ));
  // A two-pane cross-plane/different-FoR comparison intentionally has no slice
  // lock. Reference lines remain available for a same-FoR cross-plane pair.
  if (!hasSyncablePair) {
    compareSync.enabled = false;
    compareSync.anchor = null;
    compareSync.spatialMode = spatialMode;
    return false;
  }
  // Capture where the panes are *now*: that offset is what the user is asking
  // to preserve by pressing the button.
  compareSync.anchor = readCompareIndices();
  compareSync.enabled = true;
  compareSync.spatialMode = spatialMode;
  return true;
}

export function compareScrollSyncState() {
  return {
    enabled: compareSync.enabled,
    anchor: compareSync.anchor?.slice() || null,
    spatialMode: compareSync.spatialMode || null,
  };
}

/**
 * Toggle reference lines on/off.  Reference lines show where one viewport's
 * current slice plane intersects the image displayed in another viewport —
 * the standard PACS cross-reference feature for orthogonal series.
 * Returns the state actually in force.
 */
export function setReferenceLines(enabled) {
  referenceLinesEnabled = Boolean(enabled);
  if (!toolGroup || !toolGroup.hasTool(ReferenceLinesTool.toolName)) {
    return referenceLinesEnabled;
  }
  if (referenceLinesEnabled) {
    toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
    updateReferenceLineSource();
  } else {
    toolGroup.setToolDisabled(ReferenceLinesTool.toolName);
  }
  // Force re-render so reference lines appear or disappear immediately.
  renderingEngine?.render();
  return referenceLinesEnabled;
}

/**
 * Point ReferenceLinesTool at the currently focused viewport so the tool
 * knows which slice to project.  Must be called whenever:
 *   - reference lines are turned on
 *   - the active viewport changes (pane click)
 *   - the layout is rebuilt
 *
 * enforceSameFrameOfReference stays true.  Synthetic FoR UIDs are derived
 * from the study UID (shared across series in the same study) so the guard
 * correctly passes for same-study pairs and blocks cross-study comparisons.
 *
 * If the active viewport's series has no geometry (pure JPG without spatial
 * metadata), we disable the tool rather than let Cornerstone render lines
 * from meaningless default coordinates.
 */
function updateReferenceLineSource() {
  if (!toolGroup || !toolGroup.hasTool(ReferenceLinesTool.toolName)) return;
  if (!referenceLinesEnabled || !activeViewportId) return;

  // Check if the source viewport's series has geometry.  Without it,
  // imagePlaneModule returns undefined → Cornerstone falls back to world
  // coordinates that have no spatial meaning.
  const paneIndex = compareSync.viewportIds.indexOf(activeViewportId);
  const sourceSeries = paneIndex >= 0 ? compareSync.seriesList[paneIndex] : null;
  if (!sourceSeries?.geometry) {
    toolGroup.setToolDisabled(ReferenceLinesTool.toolName);
    return;
  }

  toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
  toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
    sourceViewportId: activeViewportId,
    enforceSameFrameOfReference: true,
  });
}

export function referenceLinesState() {
  return referenceLinesEnabled;
}

/**
 * Point crosslink: show where the cursor in one pane lands in the others.
 *
 * ReferenceCursors tracks the mouse in patient space and draws a marker on
 * every other viewport whose plane passes within displayThreshold millimetres
 * of that point. Annotations are keyed by FrameOfReferenceUID, so panes from a
 * different frame are excluded without an extra guard.
 *
 * positionSync stays off on purpose: cross-plane panes are meant to keep their
 * own slice, and scrolling them to follow the mouse would undo that.
 *
 * Passive rather than Active — mouseMove reaches both modes, so the cursor
 * costs no mouse binding and leaves the chosen tool on the primary button.
 */
function updateReferenceCursor() {
  if (!toolGroup || !toolGroup.hasTool(ReferenceCursors.toolName)) return;
  // Only meaningful when there is another pane to project the point onto.
  if (!referenceCursorEnabled || compareSync.viewportIds.length < 2) {
    toolGroup.setToolDisabled(ReferenceCursors.toolName);
    return;
  }
  toolGroup.setToolConfiguration(ReferenceCursors.toolName, {
    positionSync: false,
    disableCursor: false,
    displayThreshold: 5,
  });
  toolGroup.setToolPassive(ReferenceCursors.toolName);
}

/** Turn the point crosslink on or off; returns the state actually in force. */
export function setReferenceCursor(enabled) {
  referenceCursorEnabled = Boolean(enabled);
  updateReferenceCursor();
  renderingEngine?.render();
  return referenceCursorEnabled;
}

export function referenceCursorState() {
  return referenceCursorEnabled;
}

/** Returns info about the currently focused compare pane, or null. */
export function getActiveCompareInfo() {
  if (!COMPARE_MODES[activeMode] || !activeViewportId) return null;
  const paneIndex = compareSync.viewportIds.indexOf(activeViewportId);
  if (paneIndex < 0) return null;
  const series = compareSync.seriesList[paneIndex];
  return { paneIndex, viewportId: activeViewportId, seriesId: series?.id || "" };
}

export async function cycleMaximizedSeries() {
  if (!maximizedViewportId || !COMPARE_MODES[activeMode]) return;
  const viewport = renderingEngine?.getViewport(maximizedViewportId);
  if (!viewport || !activeSeriesList.length) return;
  
  const currentSeriesId = viewport.element?.dataset?.seriesId;
  const currentIndex = activeSeriesList.findIndex((s) => s.id === currentSeriesId);
  if (currentIndex < 0) return;
  
  const nextSeries = activeSeriesList[(currentIndex + 1) % activeSeriesList.length];
  if (nextSeries && nextSeries.id !== currentSeriesId) {
    const oldActive = activeViewportId;
    activeViewportId = maximizedViewportId;
    await swapComparePane(nextSeries);
    activeViewportId = oldActive;
  }
}

/**
 * Hot-swap the series in the currently focused compare pane without
 * tearing down the layout.  Returns { paneIndex, viewportId } or null.
 *
 * This is the PACS-style workflow: click a viewport to focus it, then
 * click a series card to load that series into the focused pane.
 */
export async function swapComparePane(newSeries) {
  if (!COMPARE_MODES[activeMode] || !activeViewportId || !newSeries) return null;
  const paneIndex = compareSync.viewportIds.indexOf(activeViewportId);
  if (paneIndex < 0) return null;

  registerSeries(newSeries);
  await ensureManifest(newSeries);

  // Update internal state
  compareSync.seriesList[paneIndex] = newSeries;
  compareSync.sliceCounts[paneIndex] = newSeries.sliceCount || 1;
  activeSeriesList = [...new Map(
    compareSync.seriesList.map((item) => [item.id, item]),
  ).values()];

  // Calculate spatially-aligned start index from the first other pane
  let startIndex = Math.floor((newSeries.sliceCount || 1) / 2);
  for (let i = 0; i < compareSync.viewportIds.length; i += 1) {
    if (i === paneIndex) continue;
    const otherSeries = compareSync.seriesList[i];
    const otherViewport = renderingEngine?.getStackViewport(compareSync.viewportIds[i]);
    const otherIndex = otherViewport?.getCurrentImageIdIndex() ?? 0;
    const spatial = findSpatialSliceIndex(otherSeries, otherIndex, newSeries);
    if (typeof spatial === "number" && Number.isInteger(spatial)) {
      startIndex = spatial;
      break;
    }
  }

  // Clear old slice control and label
  const viewportId = activeViewportId;
  const element = document.getElementById(viewportId);
  const shell = element?.closest(".viewport-shell");
  shell?.querySelector(".slice-control")?.remove();
  const labelElement = shell?.querySelector(".viewport-label");
  if (labelElement) labelElement.textContent = newSeries.name;

  // Swap the image stack in-place
  const viewport = renderingEngine?.getStackViewport(viewportId);
  await viewport.setStack(
    imageIds(newSeries),
    Math.max(0, Math.min(startIndex, newSeries.sliceCount - 1)),
  );
  viewport.resetCamera();
  viewport.render();

  // Update data attributes
  if (element) element.dataset.seriesId = newSeries.id;
  if (shell) shell.dataset.seriesId = newSeries.id;

  // Install a fresh slice control
  installSliceControl({
    element,
    viewport,
    label: newSeries.name,
    count: newSeries.sliceCount,
    initialIndex: startIndex,
    eventName: CoreEnums.Events.STACK_NEW_IMAGE,
    eventIndex: (detail) => detail.imageIdIndex,
  });

  // Re-capture anchor so scroll-sync uses the new positions
  if (compareSync.enabled) {
    compareSync.anchor = readCompareIndices();
    compareSync.spatialMode = detectSpatialMode(compareSync.seriesList);
  }

  // The swapped pane is a different plane and a different image stack, so both
  // cross-viewport aids have to be re-pointed. Without this the reference line
  // silently disappears until the user toggles the button off and on again.
  updateReferenceLineSource();
  updateReferenceCursor();
  renderingEngine?.render();

  return { paneIndex, viewportId };
}

function installCompareSynchronization(seriesList, viewportIds) {
  compareSync = {
    enabled: false,
    anchor: null,
    viewportIds,
    seriesList: seriesList || [],
    sliceCounts: seriesList.map((item) => item?.sliceCount || 1),
    spatialMode: null,
  };
  let synchronizing = false;
  viewportIds.forEach((viewportId, sourcePane) => {
    const element = document.getElementById(viewportId);
    if (!element) return;
    element.addEventListener(CoreEnums.Events.STACK_NEW_IMAGE, async (event) => {
      if (!compareSync.enabled || !compareSync.anchor || synchronizing) return;
      const indices = syncedCompareIndices(
        compareSync.anchor,
        sourcePane,
        event.detail.imageIdIndex,
        compareSync.sliceCounts,
        compareSync.seriesList,
      );
      synchronizing = true;
      try {
        // Cornerstone emits STACK_NEW_IMAGE just before committing the index;
        // yielding lets the source pane settle before the others follow.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await Promise.all(viewportIds.map(async (targetId, targetPane) => {
          if (targetPane === sourcePane) return;
          const viewport = renderingEngine?.getStackViewport(targetId);
          if (!viewport || viewport.getCurrentImageIdIndex() === indices[targetPane]) return;
          await viewport.setImageIdIndex(indices[targetPane]);
        }));
        renderingEngine?.renderViewports(viewportIds);
      } finally {
        synchronizing = false;
      }
    });
  });
}

function installMontageSynchronization(series, viewportIds) {
  let synchronizing = false;
  viewportIds.forEach((viewportId, paneIndex) => {
    const element = document.getElementById(viewportId);
    element.addEventListener(CoreEnums.Events.STACK_NEW_IMAGE, async (event) => {
      if (synchronizing) return;
      const indices = montageIndices(
        series.sliceCount,
        viewportIds.length,
        paneIndex,
        event.detail.imageIdIndex,
      );
      synchronizing = true;
      try {
        // Cornerstone emits STACK_NEW_IMAGE just before it commits
        // currentImageIdIndex. Yield once so the source pane can also be
        // corrected when the requested page would cross the first/last slice.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await Promise.all(viewportIds.map(async (targetId, targetPane) => {
          const viewport = renderingEngine?.getStackViewport(targetId);
          if (!viewport || viewport.getCurrentImageIdIndex() === indices[targetPane]) return;
          await viewport.setImageIdIndex(indices[targetPane]);
        }));
        renderingEngine?.renderViewports(viewportIds);
      } finally {
        synchronizing = false;
      }
    });
  });
}

export const COMPARE_MODES = Object.freeze({ compare: 2, compare3: 3 });

export async function showStacks(container, series, mode, comparison = null, tool = currentTool) {
  destroyCurrent();
  activeSeries = series;
  const paneCount = COMPARE_MODES[mode] || 0;
  // Every pane shows a series; a slot the user has not chosen yet repeats the
  // primary rather than leaving a dead viewport.
  const compared = paneCount
    ? [series, ...(Array.isArray(comparison) ? comparison : [comparison])]
      .slice(0, paneCount)
      .map((item) => item || series)
    : [series];
  while (paneCount && compared.length < paneCount) compared.push(series);
  activeSeriesList = [...new Map(compared.map((item) => [item.id, item])).values()];
  activeMode = mode;
  for (const item of activeSeriesList) registerSeries(item);
  // Stack measurements need real DICOM spacing, otherwise Cornerstone falls
  // back to pixel units while the status bar promises millimetres.
  for (const item of activeSeriesList) await ensureManifest(item);
  container.innerHTML = "";
  setWorkspaceMode(container, mode);
  createRenderingEngine();

  const viewports = [];
  if (paneCount) {
    compared.forEach((item, index) => {
      const id = `stack-${String.fromCharCode(97 + index)}`;
      viewports.push({
        viewportId: id,
        type: CoreEnums.ViewportType.STACK,
        element: viewportElement(container, id, item.name, "", item.id),
      });
    });
  } else {
    const count = mode === "montage6" ? 6 : mode === "montage8" ? 8 : 1;
    for (let index = 0; index < count; index += 1) {
      const id = `stack-${index}`;
      viewports.push({
        viewportId: id,
        type: CoreEnums.ViewportType.STACK,
        element: viewportElement(container, id, `${series.name} · ${index + 1}`, "", series.id),
      });
    }
  }
  renderingEngine.setViewports(viewports);
  createToolGroup(viewports.map((item) => item.viewportId));
  if (paneCount) {
    // Open the primary pane at its midpoint, then spatially align each other
    // pane to the same physical location. Falls back to same-index when
    // geometry is unavailable.
    const primaryStart = Math.floor((compared[0].sliceCount || 1) / 2);
    const startIndices = compared.map((item, index) => {
      if (index === 0) return primaryStart;
      const pairMode = comparePairMode(compared[0], item);
      if (pairMode === "spatial") {
        const spatial = findSpatialSliceIndex(compared[0], primaryStart, item);
        if (typeof spatial === "number" && Number.isInteger(spatial)) return spatial;
      }
      if (pairMode === "index") {
        return Math.min(primaryStart, (item.sliceCount || 1) - 1);
      }
      return Math.floor((item.sliceCount || 1) / 2);
    });
    await Promise.all(compared.map((item, index) => (
      setupStackViewport(viewports[index].viewportId, item, startIndices[index])
    )));
    installCompareSynchronization(compared, viewports.map((item) => item.viewportId));
    // Locked scrolling is the useful default; the button exists to break the
    // lock, scroll one pane, and re-lock on the new offset.
    setCompareScrollSync(true);
    // compareSync is now populated — re-run both cross-viewport helpers so
    // they activate immediately instead of waiting for pointerenter.
    updateReferenceLineSource();
    updateReferenceCursor();
  } else {
    const count = viewports.length;
    const shouldPrefetch = mode === "single";
    const indices = count > 1
      ? montageIndices(series.sliceCount, count)
      : [Math.floor(series.sliceCount / 2)];
    await Promise.all(
      viewports.map((item, index) => (
        setupStackViewport(item.viewportId, series, indices[index], shouldPrefetch)
      )),
    );
    if (count > 1) {
      installMontageSynchronization(series, viewports.map((item) => item.viewportId));
    }
  }
  installResizeObserver(container);
  const applied = setTool(tool);
  for (const item of activeSeriesList) await restoreAnnotations(item);
  onStatus(series.geometry
    ? "Đo chiều dài/ROI theo mm. Chuột giữa: pan · chuột phải: zoom · lăn: đổi lát."
    : "Series JPG không có hình học: chỉ xem/zoom/pan; không dùng kết quả đo vật lý.");
  return applied;
}

/** Thrown when a newer layout request supersedes a volume build in progress. */
class SupersededError extends Error {
  constructor() {
    super("Yêu cầu dựng volume đã bị thay thế.");
    this.name = "SupersededError";
    this.superseded = true;
  }
}

async function preloadVolumeImages(series, generation, concurrency = 4) {
  const ids = imageIds(series);
  const missing = ids.filter((imageId) => !cache.getImage(imageId));
  let loaded = ids.length - missing.length;
  const updateProgress = () => {
    window.__volumeLoadState = {
      volumeId: `${VOLUME_SCHEME}:${series.id}`,
      loaded,
      processed: loaded,
      total: ids.length,
      complete: loaded === ids.length,
    };
    onStatus(`Đang nạp volume: ${loaded}/${ids.length} lát…`, {
      loaded,
      total: ids.length,
    });
  };
  updateProgress();
  let cursor = 0;
  const failures = [];
  const worker = async () => {
    while (cursor < missing.length) {
      if (generation !== loadGeneration) return;
      const imageId = missing[cursor];
      cursor += 1;
      try {
        await imageLoader.loadAndCacheImage(imageId);
        loaded += 1;
        if (loaded === ids.length || loaded % 10 === 0) updateProgress();
      } catch (error) {
        failures.push({ imageId, error });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), Math.max(1, missing.length)) },
      () => worker(),
    ),
  );
  // Abandoning a superseded load keeps a fast mode switch from waiting for
  // hundreds of slices it will never display.
  if (generation !== loadGeneration) throw new SupersededError();
  const uncached = ids.filter((imageId) => !cache.getImage(imageId));
  if (failures.length || uncached.length) {
    window.__volumeLoadState = {
      volumeId: `${VOLUME_SCHEME}:${series.id}`,
      loaded: ids.length - uncached.length,
      processed: ids.length,
      total: ids.length,
      complete: false,
    };
    throw new Error(
      `Không thể nạp đủ volume: thiếu ${uncached.length || failures.length}/${ids.length} lát.`,
    );
  }
  loaded = ids.length;
  updateProgress();
  return ids;
}

async function ensureVolume(series) {
  const generation = loadGeneration;
  await ensureManifest(series);
  const id = `${VOLUME_SCHEME}:${series.id}`;
  // A full study holds several 100-300 slice series. Without this the image and
  // volume caches only grow, until Cornerstone throws cachedSizeExceeded.
  releaseOtherSeries(series.id);
  const ids = await preloadVolumeImages(series, generation);
  let volume = cache.getVolume(id);
  if (volume?.loadStatus && !volume.loadStatus.loaded) {
    cache.removeVolumeLoadObject(id);
    volume = null;
  }
  if (!volume) {
    onStatus(`Đang dựng volume từ đủ ${series.sliceCount} lát…`);
    volume = await volumeLoader.createAndCacheVolumeFromImages(id, ids);
  }
  if (generation !== loadGeneration) throw new SupersededError();
  if (volume.imageIds?.length !== series.sliceCount) {
    throw new Error(
      `Volume không đầy đủ: ${volume.imageIds?.length || 0}/${series.sliceCount} lát.`,
    );
  }
  return { id, volume };
}

export async function showMpr(container, series, primaryPlane = "axial", tool = "crosshair") {
  if (!series.mprReady) throw new Error(series.mprReason);
  destroyCurrent();
  activeSeries = series;
  activeSeriesList = [series];
  activeMode = "mpr";
  registerSeries(series);
  container.innerHTML = "";
  setWorkspaceMode(container, "mpr");
  const definitions = [
    ["mpr-axial", "AXIAL", "axial", CoreEnums.OrientationAxis.AXIAL],
    ["mpr-coronal", "CORONAL", "coronal", CoreEnums.OrientationAxis.CORONAL],
    ["mpr-sagittal", "SAGITTAL", "sagittal", CoreEnums.OrientationAxis.SAGITTAL],
  ];
  createRenderingEngine();
  const inputs = definitions.map(([id, label, plane, orientation]) => {
    const element = viewportElement(container, id, label, "mpr-plane", series.id);
    element.parentElement.dataset.plane = plane;
    installMprSwapButton(element.parentElement, plane);
    return {
    viewportId: id,
    type: CoreEnums.ViewportType.ORTHOGRAPHIC,
    element,
    defaultOptions: {
      orientation,
      background: [0.01, 0.015, 0.025],
    },
    };
  });
  setMprPrimaryPlane(primaryPlane, false);
  renderingEngine.setViewports(inputs);
  const { id: volumeId } = await ensureVolume(series);
  await setVolumesForViewports(renderingEngine, [{ volumeId }], definitions.map((item) => item[0]));
  for (const [viewportId] of definitions) {
    const viewport = renderingEngine.getViewport(viewportId);
    viewport.resetCamera();
    viewport.render();
  }
  for (const [viewportId, label] of definitions) {
    const viewport = renderingEngine.getViewport(viewportId);
    const count = viewport.getNumberOfSlices?.() || series.sliceCount;
    installSliceControl({
      element: document.getElementById(viewportId),
      viewport,
      label,
      count,
      initialIndex: viewport.getSliceIndex?.() || 0,
      eventName: CoreEnums.Events.VOLUME_NEW_IMAGE,
      eventIndex: (detail) => detail.imageIndex,
      eventCount: (detail) => detail.numberOfSlices,
    });
  }
  createToolGroup(definitions.map((item) => item[0]), "mpr");
  const applied = setTool(tool);
  installResizeObserver(container);
  await settleVolumeRendering();
  await restoreAnnotations(series);
  onStatus("MPR dùng hình học DICOM thật · R/L, A/P, S/I do Cornerstone suy ra từ tọa độ bệnh nhân.");
  return applied;
}

function overlapLength(left, right) {
  return Math.max(0, Math.min(left[1], right[1]) - Math.max(left[0], right[0]));
}

/**
 * Re-express a modality-space window in whatever space a volume's scalars live.
 *
 * Volumes are built from the raw stored pixels this module decodes, so their
 * scalars may or may not have been rescaled depending on the loader. Comparing
 * both candidate ranges against the scalar range the volume actually reports
 * tells us which one it is — guessing wrong shifts a CT window by the whole
 * rescale intercept (typically 1024 HU) and blanks the image.
 */
function matchRangeToScalars(series, physical, scalarRange) {
  const actual = Array.isArray(scalarRange) && scalarRange.length === 2
    ? scalarRange.map(Number)
    : null;
  const physicalPair = [physical.lower, physical.upper].sort((a, b) => a - b);
  if (!actual || !actual.every(Number.isFinite)) return physicalPair;
  const slope = Number.isFinite(series?.pixelData?.rescaleSlope)
    && series.pixelData.rescaleSlope !== 0
    ? series.pixelData.rescaleSlope
    : 1;
  const intercept = Number.isFinite(series?.pixelData?.rescaleIntercept)
    ? series.pixelData.rescaleIntercept
    : 0;
  const raw = [
    (physical.lower - intercept) / slope,
    (physical.upper - intercept) / slope,
  ].sort((a, b) => a - b);
  return overlapLength(raw, actual) > overlapLength(physicalPair, actual) ? raw : physicalPair;
}

function viewportScalarRange(viewport) {
  const actor = viewport?.getDefaultActor?.()?.actor;
  const scalars = actor?.getMapper?.()?.getInputData?.()?.getPointData?.()?.getScalars?.();
  const range = scalars?.getRange?.();
  return Array.isArray(range) && range.length === 2 ? range : null;
}

export function volumeTransferRange(series, scalarRange) {
  const actual = Array.isArray(scalarRange) && scalarRange.length === 2
    ? scalarRange.map(Number)
    : [0, 255];
  if (series?.sourceType !== "dicom") return [0, 255];
  const physical = windowPresetRange("full", series);
  if (!physical) return actual;
  const desired = matchRangeToScalars(series, physical, actual);
  const lower = Math.max(actual[0], desired[0]);
  const upper = Math.min(actual[1], desired[1]);
  return upper > lower ? [lower, upper] : actual;
}

function applyBrainPreset(viewport, series) {
  const actorEntry = viewport.getDefaultActor?.();
  const actor = actorEntry?.actor;
  const property = actor?.getProperty?.();
  if (!property) return;
  const scalars = actor.getMapper?.().getInputData?.().getPointData?.().getScalars?.();
  const [low, high] = volumeTransferRange(series, scalars?.getRange?.());
  const span = Math.max(1, high - low);
  const at = (fraction) => low + span * fraction;
  const color = property.getRGBTransferFunction(0);
  color.removeAllPoints();
  color.addRGBPoint(at(0), 0, 0, 0);
  color.addRGBPoint(at(0.2), 0.04, 0.025, 0.02);
  color.addRGBPoint(at(0.42), 0.35, 0.22, 0.18);
  color.addRGBPoint(at(0.67), 0.72, 0.58, 0.50);
  color.addRGBPoint(at(1), 1, 0.94, 0.86);
  const opacity = property.getScalarOpacity(0);
  opacity.removeAllPoints();
  opacity.addPoint(at(0), 0);
  opacity.addPoint(at(0.24), 0);
  opacity.addPoint(at(0.42), 0.03);
  opacity.addPoint(at(0.64), 0.16);
  opacity.addPoint(at(0.98), 0.46);
  opacity.addPoint(at(1), 0.72);
  property.setInterpolationTypeToLinear();
}

export async function show3d(container, series, tool = "orbit3d") {
  if (!series.mprReady) throw new Error(series.mprReason);
  destroyCurrent();
  activeSeries = series;
  activeSeriesList = [series];
  activeMode = "volume3d";
  registerSeries(series);
  container.innerHTML = "";
  setWorkspaceMode(container, "volume3d");
  createRenderingEngine();
  const definitions = [
    ["volume-axial", "AXIAL", CoreEnums.ViewportType.ORTHOGRAPHIC, CoreEnums.OrientationAxis.AXIAL],
    ["volume-coronal", "CORONAL", CoreEnums.ViewportType.ORTHOGRAPHIC, CoreEnums.OrientationAxis.CORONAL],
    ["volume-sagittal", "SAGITTAL", CoreEnums.ViewportType.ORTHOGRAPHIC, CoreEnums.OrientationAxis.SAGITTAL],
    ["volume-3d", `3D · ${series.description}`, CoreEnums.ViewportType.VOLUME_3D, null],
  ];
  renderingEngine.setViewports(definitions.map(([id, label, type, orientation]) => ({
    viewportId: id,
    type,
    element: viewportElement(
      container,
      id,
      label,
      id === "volume-3d" ? "volume-render-pane" : "volume-mpr-pane",
      series.id,
    ),
    defaultOptions: {
      ...(orientation ? { orientation } : {}),
      background: [0.01, 0.015, 0.025],
    },
  })));
  const { id: volumeId } = await ensureVolume(series);
  const viewportIds = definitions.map((item) => item[0]);
  await setVolumesForViewports(renderingEngine, [{ volumeId }], viewportIds);
  applyBrainPreset(renderingEngine.getViewport("volume-3d"), series);
  for (const viewportId of viewportIds) {
    const viewport = renderingEngine.getViewport(viewportId);
    viewport.resetCamera();
    viewport.render();
  }
  for (const [viewportId, label, type] of definitions) {
    if (type === CoreEnums.ViewportType.VOLUME_3D) continue;
    const viewport = renderingEngine.getViewport(viewportId);
    const count = viewport.getNumberOfSlices?.() || series.sliceCount;
    installSliceControl({
      element: document.getElementById(viewportId),
      viewport,
      label,
      count,
      initialIndex: viewport.getSliceIndex?.() || 0,
      eventName: CoreEnums.Events.VOLUME_NEW_IMAGE,
      eventIndex: (detail) => detail.imageIndex,
      eventCount: (detail) => detail.numberOfSlices,
    });
  }
  createToolGroup(viewportIds, "hybrid");
  const applied = setTool(tool);
  installResizeObserver(container);
  await settleVolumeRendering();
  await restoreAnnotations(series);
  onStatus("Ba mặt phẳng MPR và mô hình 3D dùng chung một volume đã nạp đầy đủ.");
  return applied;
}

export function viewerDiagnostics() {
  const referenceTool = toolGroup?.getToolInstance?.(ReferenceLinesTool.toolName);
  return {
    mode: activeMode,
    sourceType: activeSeries?.sourceType || "",
    engineId: engineIsLive() ? ENGINE_ID : "",
    destroyed: !engineIsLive(),
    activeViewportId,
    tool: currentTool,
    decodePath,
    lastDecodeStats,
    referenceLines: {
      requested: referenceLinesEnabled,
      toolMode: referenceTool?.mode || "",
      toolOptions: toolGroup?.toolOptions?.[ReferenceLinesTool.toolName] || null,
      sourceViewportId: referenceTool?.configuration?.sourceViewportId || "",
      initialized: Boolean(referenceTool?.editData?.annotation),
      pairModes: compareSync.seriesList.map((source, sourceIndex) => (
        compareSync.seriesList.slice(sourceIndex + 1).map((target) => (
          comparePairMode(source, target)
        ))
      )).flat(),
    },
    referenceCursor: (() => {
      const cursorTool = toolGroup?.getToolInstance?.(ReferenceCursors.toolName);
      return {
        requested: referenceCursorEnabled,
        // "Passive" is the only mode that both receives mouseMove and renders;
        // anything else means the point crosslink is wired up but inert.
        toolMode: cursorTool?.mode || "",
        positionSync: cursorTool?.configuration?.positionSync ?? null,
        displayThreshold: cursorTool?.configuration?.displayThreshold ?? null,
      };
    })(),
    viewports: (engineIsLive() ? renderingEngine.getViewports() || [] : []).map((viewport) => {
      const properties = viewport.getProperties?.() || {};
      return {
        id: viewport.id,
        actors: viewport.getActors?.().length || 0,
        imageIndex: viewport.getCurrentImageIdIndex?.() ?? null,
        voiRange: properties.voiRange || null,
        // Exposed so a gate can prove invert actually reached every 2D pane
        // rather than only that the button raised no error.
        invert: Boolean(properties.invert),
        supportsInvert: "invert" in properties,
      };
    }),
  };
}

/**
 * Tools a layout cannot honour must never be reported as active: Crosshairs
 * needs at least two linked viewports and TrackballRotate needs a 3D viewport.
 *
 * `layout` is the toolClassesForLayout() key the live tool group was built
 * from; setTool passes the live one. A stack compare layout deliberately omits
 * CrosshairsTool (it calls getSlabThickness() on StackViewport and throws), so
 * asking for it there must report the fallback rather than a tool the group
 * cannot activate.  The default stays the most restrictive layout so the answer
 * never depends on hidden module state.
 */
export function toolFallback(
  mode,
  viewportCount = activeElements.length,
  hasVolume3d = false,
  layout = "stack",
) {
  if (!toolByMode[mode]) return "window";
  if (mode === "crosshair" && viewportCount < 2) return "window";
  if (mode === "orbit3d" && !hasVolume3d) return "window";
  const toolName = toolByMode[mode];
  if (!toolClassesForLayout(layout).some((ToolClass) => ToolClass.toolName === toolName)) {
    return "window";
  }
  return mode;
}

/** Activates `mode` on the primary mouse button and returns the tool in force. */
export function setTool(mode) {
  const hasVolume3d = activeElements.some((element) => element.id === "volume-3d");
  const requested = toolFallback(mode, activeElements.length, hasVolume3d, toolGroupLayout);
  const toolName = toolByMode[requested];
  if (!toolGroup) {
    currentTool = requested;
    return currentTool;
  }
  if (!toolName || !toolGroup.hasTool(toolName)) {
    currentTool = "window";
    return currentTool;
  }
  for (const candidate of Object.values(toolByMode)) {
    if (candidate !== toolName && toolGroup.hasTool(candidate)) {
      try {
        if (candidate === WindowLevelTool.toolName) {
          toolGroup.setToolActive(candidate, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary, modifierKey: 17 }],
          });
        } else {
          toolGroup.setToolPassive(candidate);
        }
      } catch (_) {
        // Some navigation tools retain their secondary binding.
      }
    }
  }
  
  const bindings = [{ mouseButton: ToolEnums.MouseBindings.Primary }];
  if (toolName === WindowLevelTool.toolName) {
    bindings.push({ mouseButton: ToolEnums.MouseBindings.Primary, modifierKey: 17 });
  }
  
  toolGroup.setToolActive(toolName, { bindings });
  currentTool = requested;
  return currentTool;
}

export function resetView() {
  if (!engineIsLive() || !activeViewportId) return;
  const viewport = renderingEngine.getViewport(activeViewportId);
  if (!viewport) return;
  viewport.resetCamera();
  if (typeof viewport.resetProperties === "function") viewport.resetProperties();
  viewport.render();
  
  if ((activeMode === "mpr" || activeMode === "volume3d") && viewport.id !== "volume-3d") {
    const center = viewport.getCamera?.().focalPoint;
    const crosshairs = toolGroup?.getToolInstance?.(CrosshairsTool.toolName);
    if (center && crosshairs?.setToolCenter) {
      crosshairs.setToolCenter([...center], true);
      renderingEngine.render();
    }
  }
}

export function resetAllViews() {
  if (!engineIsLive()) return;
  for (const viewport of renderingEngine.getViewports() || []) {
    viewport.resetCamera();
    if (typeof viewport.resetProperties === "function") viewport.resetProperties();
    viewport.render();
  }
  if (activeMode === "mpr" || activeMode === "volume3d") {
    const reference = (renderingEngine.getViewports() || []).find(
      (viewport) => viewport.id !== "volume-3d" && viewport.getCamera?.().focalPoint,
    );
    const center = reference?.getCamera?.().focalPoint;
    const crosshairs = toolGroup?.getToolInstance?.(CrosshairsTool.toolName);
    if (center && crosshairs?.setToolCenter) {
      crosshairs.setToolCenter([...center], true);
      renderingEngine.render();
    }
  }
}

export async function applyWindowPreset(name) {
  const range = windowPresetRange(name, activeSeries);
  if (!range || !engineIsLive()) return false;
  const stackIds = new Set((renderingEngine.getStackViewports() || []).map((item) => item.id));
  for (const viewport of renderingEngine.getViewports() || []) {
    if (viewport.id === "volume-3d" || typeof viewport.setProperties !== "function") continue;
    // Stack viewports run the modality LUT themselves, so voiRange is already
    // in HU there. Volume viewports read the scalars as loaded, which may still
    // be raw stored values.
    let applied = range;
    if (!stackIds.has(viewport.id)) {
      const [lower, upper] = matchRangeToScalars(
        activeSeries, range, viewportScalarRange(viewport),
      );
      applied = { lower, upper };
    }
    viewport.setProperties({ voiRange: { ...applied } });
    viewport.render();
  }
  // RenderingEngine.render() schedules composition. Do not let the caller mark
  // a new layout ready while the previous frame is still on the canvas.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
}

export function invertView() {
  if (!engineIsLive()) return 0;
  // Every 2D pane, not just stacks: MPR and the orthographic panes of the 3D
  // layout are volume viewports and were silently skipped before. The 3D
  // volume-rendered pane has no VOI to invert, so it reports no properties.
  let inverted = 0;
  for (const viewport of renderingEngine.getViewports() || []) {
    if (typeof viewport.getProperties !== "function"
      || typeof viewport.setProperties !== "function") {
      continue;
    }
    const properties = viewport.getProperties();
    if (!properties || !("invert" in properties)) continue;
    try {
      viewport.setProperties({ invert: !properties.invert });
      viewport.render();
      inverted += 1;
    } catch (_) {
      // A pane that refuses an inverted VOI is skipped, not fatal.
    }
  }
  return inverted;
}

/**
 * Moves the pane under the pointer by `delta` slices (keyboard navigation).
 * Both StackViewport and the volume viewports clamp `scroll` to their own
 * bounds, so Home/End can pass the whole slice count.
 */
export function stepSlice(delta) {
  const viewport = activeViewport() || (engineIsLive() ? renderingEngine.getViewports()?.[0] : null);
  if (!viewport || typeof viewport.scroll !== "function") return false;
  viewport.scroll(delta);
  return true;
}

export function toggleCine(series, onChange) {
  if (cineTimer) {
    stopCine();
    return false;
  }
  if (!engineIsLive()) return false;
  const viewportId = maximizedViewportId || activeViewportId || "stack-0";
  const viewport = renderingEngine.getStackViewport(viewportId);
  if (!viewport || !viewport.getCurrentImageIdIndex || typeof viewport.setImageIdIndex !== "function") return false;
  const totalSlices = viewport.getImageIds?.().length || series?.sliceCount || 1;
  cineTimer = window.setInterval(() => {
    const next = (viewport.getCurrentImageIdIndex() + 1) % totalSlices;
    viewport.setImageIdIndex(next);
    viewport.render();
    onChange?.(next);
  }, 90);
  return true;
}

export function stopCine() {
  if (cineTimer) {
    window.clearInterval(cineTimer);
    cineTimer = null;
  }
}

export async function captureActiveViewport() {
  const element = document.getElementById(activeViewportId) || activeElements[0];
  const canvas = element?.querySelector("canvas");
  if (!canvas) throw new Error("Chưa có ảnh để lưu.");
  const label = element.closest(".viewport-shell")?.querySelector(".viewport-label")?.textContent;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Không đọc được ảnh từ khung xem.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `DCom_${Date.now()}.png`;
  link.click();
  // Revoking in the same tick can cancel the download before Chromium reads it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return label || activeViewportId;
}

/**
 * True when the annotation was drawn on `seriesId`. Cornerstone keys stack
 * annotations by referenced imageId and volume annotations by target volumeId;
 * both embed our opaque series id, while FrameOfReferenceUID is shared by every
 * series of the same study and therefore cannot tell them apart.
 */
export function annotationBelongsToSeries(item, seriesId) {
  if (!item || !seriesId) return false;
  if (String(item.metadata?.referencedImageId || "").includes(seriesId)) return true;
  if (String(item.metadata?.volumeId || "").includes(seriesId)) return true;
  return Object.keys(item.data?.cachedStats || {}).some((key) => key.includes(seriesId));
}

export function isMeasurementAnnotation(item) {
  return measurementToolNames.has(item?.metadata?.toolName);
}

/**
 * Removes all length, angle and ROI annotations in the active layout, then
 * persists the empty/current state so deleted measurements stay deleted.
 */
export async function clearActiveMeasurements() {
  const targets = new Set(activeSeriesList.map((series) => series.id));
  if (!targets.size && activeSeries?.id) targets.add(activeSeries.id);
  const removable = annotation.state
    .getAllAnnotations()
    .filter((item) => (
      isMeasurementAnnotation(item)
      && (!targets.size || [...targets].some((seriesId) => annotationBelongsToSeries(item, seriesId)))
    ));
  for (const item of removable) {
    if (item.annotationUID) annotation.state.removeAnnotation(item.annotationUID);
  }
  if (engineIsLive()) renderingEngine.render();
  await saveAnnotations();
  return removable.length;
}

export async function undoLastAnnotation() {
  const targets = new Set(activeSeriesList.map((series) => series.id));
  if (!targets.size && activeSeries?.id) targets.add(activeSeries.id);
  const removable = annotation.state
    .getAllAnnotations()
    .filter((item) => (
      isMeasurementAnnotation(item)
      && (!targets.size || [...targets].some((seriesId) => annotationBelongsToSeries(item, seriesId)))
    ));
  if (removable.length > 0) {
    const lastItem = removable[removable.length - 1];
    if (lastItem.annotationUID) annotation.state.removeAnnotation(lastItem.annotationUID);
    if (engineIsLive()) renderingEngine.render();
    await saveAnnotations();
    return 1;
  }
  return 0;
}

function serializableAnnotations(seriesId) {
  return annotation.state
    .getAllAnnotations()
    .filter((item) => !seriesId || annotationBelongsToSeries(item, seriesId))
    .map((item) => JSON.parse(JSON.stringify(item)));
}

async function saveSeriesAnnotations(series) {
  const annotations = serializableAnnotations(series.id);
  await api(`/api/series/${series.id}/annotations`, {
    method: "POST",
    body: JSON.stringify({ annotations }),
  });
  return annotations.length;
}

export async function saveAnnotations(series = null) {
  const targets = series
    ? [series]
    : activeSeriesList.length
      ? activeSeriesList
      : activeSeries
        ? [activeSeries]
        : [];
  let saved = 0;
  for (const target of targets) saved += await saveSeriesAnnotations(target);
  return saved;
}

/**
 * Persists the current measurements before a layout change wipes them.
 * Returns the number saved, or -1 when saving failed, so the caller can warn
 * instead of destroying work silently.
 */
export async function persistActiveAnnotations() {
  const targets = activeSeriesList.filter(
    (series) => serializableAnnotations(series.id).length,
  );
  if (!targets.length) return 0;
  try {
    let saved = 0;
    for (const series of targets) saved += await saveSeriesAnnotations(series);
    return saved;
  } catch (_) {
    return -1;
  }
}

function vectorMatches(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 3 || right.length !== 3) {
    return false;
  }
  const leftNorm = Math.hypot(...left);
  const rightNorm = Math.hypot(...right);
  if (!leftNorm || !rightNorm) return false;
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  return Math.abs(dot / leftNorm / rightNorm) >= 0.999;
}

/**
 * Selects a viewport only from persisted identifiers or DICOM plane geometry.
 * Multi-pane restores deliberately return an empty id when the target cannot be
 * proven; placing a measurement on a plausible-looking wrong plane is unsafe.
 */
export function annotationTargetViewportId(item, viewports) {
  if (!item || !Array.isArray(viewports) || !viewports.length) return "";
  const viewPlaneNormal = item.metadata?.viewPlaneNormal;
  const referencedImageId = String(item.metadata?.referencedImageId || "");
  if (referencedImageId) {
    const exact = viewports.filter((viewport) => viewport.imageIds?.includes(referencedImageId));
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1 && Array.isArray(viewPlaneNormal)) {
      const plane = exact.find(
        (viewport) => vectorMatches(viewPlaneNormal, viewport.viewPlaneNormal),
      );
      if (plane) return plane.id;
    }
    if (exact.length) return exact[0].id;
    const matchingSeries = viewports.filter(
      (viewport) => viewport.seriesId && referencedImageId.includes(viewport.seriesId),
    );
    if (matchingSeries.length) return matchingSeries[0].id;
  }
  const targetText = [
    item.metadata?.volumeId,
    ...Object.keys(item.data?.cachedStats || {}),
  ].join(" ");
  const candidates = targetText
    ? viewports.filter((viewport) => !viewport.seriesId || targetText.includes(viewport.seriesId))
    : [...viewports];
  if (Array.isArray(viewPlaneNormal)) {
    const plane = candidates.find(
      (viewport) => vectorMatches(viewPlaneNormal, viewport.viewPlaneNormal),
    );
    if (plane) return plane.id;
  }
  return candidates.length === 1 ? candidates[0].id : "";
}

function activeViewportDescriptors() {
  if (!engineIsLive()) return [];
  return activeElements.map((element) => {
    let viewport = null;
    try {
      viewport = renderingEngine.getViewport(element.id);
    } catch (_) {
      // The element may belong to a layout being replaced.
    }
    return {
      id: element.id,
      seriesId: element.dataset.seriesId || "",
      imageIds: viewport?.getImageIds?.() || [],
      viewPlaneNormal: viewport?.getCamera?.().viewPlaneNormal || null,
    };
  });
}

async function restoreAnnotations(series) {
  const stored = await api(`/api/series/${series.id}/annotations`);
  if (!Array.isArray(stored.annotations) || !stored.annotations.length) return;
  const descriptors = activeViewportDescriptors();
  for (const item of stored.annotations) {
    const viewportId = annotationTargetViewportId(item, descriptors);
    const target = viewportId ? document.getElementById(viewportId) : null;
    if (!target) continue;
    try {
      annotation.state.addAnnotation(item, target);
    } catch (_) {
      // A measurement referencing a missing image is ignored, not guessed.
    }
  }
  if (engineIsLive()) renderingEngine.render();
}

function findArea(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value.area === "number" && Number.isFinite(value.area)) return value.area;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findArea(item, depth + 1);
      if (result != null) return result;
    }
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const result = findArea(item, depth + 1);
      if (result != null) return result;
    }
  }
  return null;
}

export function roiVolumeMl(series = activeSeries) {
  if (!series?.mprReady) {
    throw new Error("Chỉ tính thể tích khi series có hình học DICOM hợp lệ.");
  }
  const eligible = new Set([EllipticalROITool.toolName, PlanarFreehandROITool.toolName]);
  const orientation = series.geometry.orientation;
  const row = orientation.slice(0, 3);
  const column = orientation.slice(3, 6);
  const acquisitionNormal = [
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ];
  const isAxialRoi = (item) => {
    const normal = item.metadata?.viewPlaneNormal;
    if (!Array.isArray(normal) || normal.length !== 3) {
      // Stack annotations reference the acquired axial source image directly.
      return Boolean(item.metadata?.referencedImageId);
    }
    const dot = Math.abs(normal.reduce(
      (sum, value, index) => sum + value * acquisitionNormal[index],
      0,
    ));
    return dot >= 0.999;
  };
  const areas = annotation.state
    .getAllAnnotations()
    .filter((item) => (
      annotationBelongsToSeries(item, series.id)
      && eligible.has(item.metadata?.toolName)
      && isAxialRoi(item)
    ))
    .map((item) => findArea(item.data?.cachedStats))
    .filter((value) => value != null && value >= 0);
  if (!areas.length) {
    throw new Error("Chưa có ROI ellipse/freehand đủ dữ liệu trên các lát.");
  }
  return areas.reduce((sum, area) => sum + area, 0) * series.geometry.sliceSpacing / 1000;
}

/**
 * Frees the volume and the decoded slices of one series. The slice ids are
 * derived from the registry instead of scanning the cache, because Cornerstone
 * exposes no public iterator over cached image ids.
 */
export function purgeSeriesCache(seriesId) {
  const series = seriesRegistry.get(seriesId);
  if (!seriesId || !series) return 0;
  const volumeId = `${VOLUME_SCHEME}:${seriesId}`;
  try {
    if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId);
  } catch (_) {
    // A volume still bound to a live viewport stays until the layout changes.
  }
  let removed = 0;
  for (const imageId of imageIds(series)) {
    if (!cache.getImage(imageId)) continue;
    try {
      cache.removeImageLoadObject(imageId);
      removed += 1;
    } catch (_) {
      // Slices shared with a live volume cannot be evicted individually.
    }
  }
  return removed;
}

/** Frees the volume and decoded slices of every series except `keepSeriesId`. */
function releaseOtherSeries(keepSeriesId) {
  for (const seriesId of seriesRegistry.keys()) {
    if (seriesId !== keepSeriesId) purgeSeriesCache(seriesId);
  }
}
