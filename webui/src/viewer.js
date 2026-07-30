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
  CrosshairsTool,
  EllipticalROITool,
  Enums as ToolEnums,
  LengthTool,
  PanTool,
  PlanarFreehandROITool,
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
import { api, apiBlob, imagePath } from "./api.js";

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
  CrosshairsTool,
  TrackballRotateTool,
];

const toolByMode = {
  window: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  ellipse: EllipticalROITool.toolName,
  freehand: PlanarFreehandROITool.toolName,
  crosshair: CrosshairsTool.toolName,
  rotate3d: TrackballRotateTool.toolName,
};

let initialized = false;
let renderingEngine = null;
let toolGroup = null;
let resizeObserver = null;
let activeElements = [];
let activeSeries = null;
let activeMode = "single";
let currentTool = "window";
let mprPrimaryPlane = "axial";
let cineTimer = null;
let onStatus = () => {};
let onSlice = () => {};
const seriesRegistry = new Map();
const manifestRegistry = new Map();

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
    return { modality: "MR", seriesInstanceUID: parsed.seriesId };
  }
  if (type === "generalImageModule") {
    return { instanceNumber: parsed.index + 1 };
  }
  if (type === "imagePixelModule") {
    return {
      samplesPerPixel: 1,
      photometricInterpretation: "MONOCHROME2",
      rows: geometry?.rows || 1,
      columns: geometry?.columns || 1,
      bitsAllocated: 8,
      bitsStored: 8,
      highBit: 7,
      pixelRepresentation: 0,
    };
  }
  if (type === "modalityLutModule") {
    return { rescaleIntercept: 0, rescaleSlope: 1, rescaleType: "US" };
  }
  if (type === "voiLutModule") {
    return { windowCenter: [127.5], windowWidth: [255] };
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

function decodeImage(imageId) {
  const parsed = parseImageId(imageId);
  const promise = (async () => {
    if (!parsed) throw new Error("ImageId không hợp lệ.");
    const blob = await apiBlob(imagePath(parsed.seriesId, parsed.index));
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = new Uint8Array(canvas.width * canvas.height);
    for (let source = 0, target = 0; target < pixels.length; source += 4, target += 1) {
      pixels[target] = Math.round(
        rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114,
      );
    }
    const series = seriesRegistry.get(parsed.seriesId);
    const spacing = series?.geometry?.pixelSpacing;
    return {
      imageId,
      minPixelValue: 0,
      maxPixelValue: 255,
      slope: 1,
      intercept: 0,
      windowCenter: 127.5,
      windowWidth: 255,
      getPixelData: () => pixels,
      getCanvas: () => canvas,
      rows: canvas.height,
      columns: canvas.width,
      height: canvas.height,
      width: canvas.width,
      color: false,
      rgba: false,
      numberOfComponents: 1,
      columnPixelSpacing: spacing?.[1],
      rowPixelSpacing: spacing?.[0],
      invert: false,
      photometricInterpretation: "MONOCHROME2",
      sizeInBytes: pixels.byteLength,
      dataType: "Uint8Array",
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

export function registerSeries(series) {
  seriesRegistry.set(series.id, series);
}

async function ensureManifest(series) {
  if (!series.mprReady) return null;
  if (!manifestRegistry.has(series.id)) {
    manifestRegistry.set(series.id, await api(`/api/series/${series.id}/manifest`));
  }
  return manifestRegistry.get(series.id);
}

function destroyCurrent() {
  stopCine();
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
  if (renderingEngine && !renderingEngine.hasBeenDestroyed) {
    renderingEngine.destroy();
  }
  renderingEngine = null;
  activeElements = [];
}

function createToolGroup(viewportIds, threeDimensional = false) {
  toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) throw new Error("Không tạo được nhóm công cụ.");
  const allowed = threeDimensional
    ? [TrackballRotateTool, PanTool, ZoomTool]
    : toolClasses.filter((tool) => tool !== TrackballRotateTool);
  for (const ToolClass of allowed) {
    toolGroup.addTool(ToolClass.toolName);
  }
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
  setTool(threeDimensional ? "rotate3d" : currentTool);
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

function viewportElement(container, id, label, shellClass = "") {
  const shell = document.createElement("section");
  shell.className = `viewport-shell ${shellClass}`.trim();
  shell.dataset.viewportId = id;
  const tag = document.createElement("div");
  tag.className = "viewport-label";
  tag.textContent = label;
  const element = document.createElement("div");
  element.id = id;
  element.className = "viewport";
  element.oncontextmenu = (event) => event.preventDefault();
  shell.append(tag, element);
  container.append(shell);
  activeElements.push(element);
  return element;
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

function imageIds(series) {
  return Array.from({ length: series.sliceCount }, (_, index) => makeImageId(series.id, index));
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
  element.addEventListener(CoreEnums.Events.STACK_NEW_IMAGE, (event) => {
    onSlice({
      viewportId,
      index: event.detail.imageIdIndex,
      count: series.sliceCount,
    });
  });
  if (prefetch) {
    toolUtilities.stackContextPrefetch.enable(element);
  }
}

export async function showStacks(container, series, mode, secondarySeries = null) {
  destroyCurrent();
  activeSeries = series;
  activeMode = mode;
  registerSeries(series);
  if (secondarySeries) registerSeries(secondarySeries);
  container.innerHTML = "";
  setWorkspaceMode(container, mode);
  renderingEngine = new RenderingEngine(ENGINE_ID);

  const viewports = [];
  if (mode === "compare") {
    const left = viewportElement(container, "stack-a", series.name);
    const right = viewportElement(container, "stack-b", secondarySeries?.name || "Chọn series B");
    viewports.push(
      { viewportId: "stack-a", type: CoreEnums.ViewportType.STACK, element: left },
      { viewportId: "stack-b", type: CoreEnums.ViewportType.STACK, element: right },
    );
  } else {
    const count = mode === "montage6" ? 6 : mode === "montage8" ? 8 : 1;
    for (let index = 0; index < count; index += 1) {
      const id = `stack-${index}`;
      viewports.push({
        viewportId: id,
        type: CoreEnums.ViewportType.STACK,
        element: viewportElement(container, id, `${series.name} · ${index + 1}`),
      });
    }
  }
  renderingEngine.setViewports(viewports);
  createToolGroup(viewports.map((item) => item.viewportId));
  if (mode === "compare") {
    await Promise.all([
      setupStackViewport("stack-a", series, Math.floor(series.sliceCount / 2)),
      secondarySeries
        ? setupStackViewport("stack-b", secondarySeries, Math.floor(secondarySeries.sliceCount / 2))
        : Promise.resolve(),
    ]);
  } else {
    const count = viewports.length;
    const step = Math.max(1, Math.floor(series.sliceCount / count));
    const shouldPrefetch = mode === "single";
    await Promise.all(
      viewports.map((item, index) => (
        setupStackViewport(item.viewportId, series, index * step, shouldPrefetch)
      )),
    );
  }
  installResizeObserver(container);
  await restoreAnnotations(series);
  onStatus(series.geometry
    ? "Đo chiều dài/ROI theo mm. Chuột giữa: pan · chuột phải: zoom · lăn: đổi lát."
    : "Series JPG không có hình học: chỉ xem/zoom/pan; không dùng kết quả đo vật lý.");
}

async function ensureVolume(series) {
  await ensureManifest(series);
  const id = `${VOLUME_SCHEME}:${series.id}`;
  let volume = cache.getVolume(id);
  if (!volume) {
    onStatus(`Đang nạp ${series.sliceCount} lát để dựng volume...`);
    volume = await volumeLoader.createAndCacheVolumeFromImages(id, imageIds(series));
  }
  if (typeof volume.load === "function") {
    await volume.load();
  }
  return { id, volume };
}

export async function showMpr(container, series, primaryPlane = "axial") {
  if (!series.mprReady) throw new Error(series.mprReason);
  destroyCurrent();
  activeSeries = series;
  activeMode = "mpr";
  registerSeries(series);
  container.innerHTML = "";
  setWorkspaceMode(container, "mpr");
  const definitions = [
    ["mpr-axial", "AXIAL", "axial", CoreEnums.OrientationAxis.AXIAL],
    ["mpr-coronal", "CORONAL", "coronal", CoreEnums.OrientationAxis.CORONAL],
    ["mpr-sagittal", "SAGITTAL", "sagittal", CoreEnums.OrientationAxis.SAGITTAL],
  ];
  renderingEngine = new RenderingEngine(ENGINE_ID);
  const inputs = definitions.map(([id, label, plane, orientation]) => {
    const element = viewportElement(container, id, label, "mpr-plane");
    element.parentElement.dataset.plane = plane;
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
  createToolGroup(definitions.map((item) => item[0]));
  setTool("crosshair");
  installResizeObserver(container);
  await restoreAnnotations(series);
  onStatus("MPR dùng hình học DICOM thật · R/L, A/P, S/I do Cornerstone suy ra từ tọa độ bệnh nhân.");
}

function applyBrainPreset(viewport) {
  const actorEntry = viewport.getDefaultActor?.();
  const actor = actorEntry?.actor;
  const property = actor?.getProperty?.();
  if (!property) return;
  const color = property.getRGBTransferFunction(0);
  color.removeAllPoints();
  color.addRGBPoint(0, 0, 0, 0);
  color.addRGBPoint(45, 0.04, 0.025, 0.02);
  color.addRGBPoint(95, 0.35, 0.22, 0.18);
  color.addRGBPoint(150, 0.72, 0.58, 0.50);
  color.addRGBPoint(225, 1, 0.94, 0.86);
  const opacity = property.getScalarOpacity(0);
  opacity.removeAllPoints();
  opacity.addPoint(0, 0);
  opacity.addPoint(55, 0);
  opacity.addPoint(95, 0.03);
  opacity.addPoint(145, 0.16);
  opacity.addPoint(220, 0.46);
  opacity.addPoint(255, 0.72);
  property.setInterpolationTypeToLinear();
}

export async function show3d(container, series) {
  if (!series.mprReady) throw new Error(series.mprReason);
  destroyCurrent();
  activeSeries = series;
  activeMode = "volume3d";
  registerSeries(series);
  container.innerHTML = "";
  setWorkspaceMode(container, "volume3d");
  renderingEngine = new RenderingEngine(ENGINE_ID);
  const element = viewportElement(container, "volume-3d", `3D · ${series.description}`);
  renderingEngine.enableElement({
    viewportId: "volume-3d",
    type: CoreEnums.ViewportType.VOLUME_3D,
    element,
    defaultOptions: { background: [0.01, 0.015, 0.025] },
  });
  const { id: volumeId } = await ensureVolume(series);
  await setVolumesForViewports(renderingEngine, [{ volumeId }], ["volume-3d"]);
  const viewport = renderingEngine.getViewport("volume-3d");
  applyBrainPreset(viewport);
  viewport.resetCamera();
  viewport.render();
  createToolGroup(["volume-3d"], true);
  installResizeObserver(container);
  onStatus("3D volume rendering toàn bộ chuỗi T1 · kéo trái để xoay, chuột giữa pan, chuột phải zoom.");
}

export function setTool(mode) {
  currentTool = mode;
  if (!toolGroup) return;
  const toolName = toolByMode[mode];
  if (!toolName || !toolGroup.hasTool(toolName)) return;
  for (const candidate of Object.values(toolByMode)) {
    if (candidate !== toolName && toolGroup.hasTool(candidate)) {
      try {
        toolGroup.setToolPassive(candidate);
      } catch (_) {
        // Some navigation tools retain their secondary binding.
      }
    }
  }
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
  });
}

export function resetView() {
  for (const viewport of renderingEngine?.getViewports() || []) {
    viewport.resetCamera();
    if (typeof viewport.resetProperties === "function") viewport.resetProperties();
    viewport.render();
  }
}

export function invertView() {
  for (const viewport of renderingEngine?.getStackViewports() || []) {
    const properties = viewport.getProperties();
    viewport.setProperties({ invert: !properties.invert });
    viewport.render();
  }
}

export function toggleCine(series, onChange) {
  if (cineTimer) {
    stopCine();
    return false;
  }
  if (activeMode !== "single") return false;
  const viewport = renderingEngine?.getStackViewport("stack-0");
  if (!viewport) return false;
  cineTimer = window.setInterval(() => {
    const next = (viewport.getCurrentImageIdIndex() + 1) % series.sliceCount;
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
  const canvas = activeElements[0]?.querySelector("canvas");
  if (!canvas) throw new Error("Chưa có ảnh để lưu.");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `DCom_${Date.now()}.png`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function serializableAnnotations() {
  return annotation.state.getAllAnnotations().map((item) => JSON.parse(JSON.stringify(item)));
}

export async function saveAnnotations(series = activeSeries) {
  if (!series) return;
  const annotations = serializableAnnotations();
  await api(`/api/series/${series.id}/annotations`, {
    method: "POST",
    body: JSON.stringify({ annotations }),
  });
  return annotations.length;
}

async function restoreAnnotations(series) {
  const stored = await api(`/api/series/${series.id}/annotations`);
  if (!Array.isArray(stored.annotations) || !stored.annotations.length) return;
  const target = activeElements[0];
  for (const item of stored.annotations) {
    try {
      annotation.state.addAnnotation(item, target);
    } catch (_) {
      // A measurement referencing a missing image is ignored, not guessed.
    }
  }
  renderingEngine?.render();
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
    .filter((item) => eligible.has(item.metadata?.toolName) && isAxialRoi(item))
    .map((item) => findArea(item.data?.cachedStats))
    .filter((value) => value != null && value >= 0);
  if (!areas.length) {
    throw new Error("Chưa có ROI ellipse/freehand đủ dữ liệu trên các lát.");
  }
  return areas.reduce((sum, area) => sum + area, 0) * series.geometry.sliceSpacing / 1000;
}

export function purgeSeriesCache(seriesId) {
  const volumeId = `${VOLUME_SCHEME}:${seriesId}`;
  if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId);
  for (const image of cache.getCachedImageBasedOnImageURI?.(seriesId) || []) {
    cache.removeImageLoadObject(image.imageId);
  }
}
