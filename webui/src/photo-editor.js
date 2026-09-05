/**
 * photo-editor.js — the pointer surface of the photo studio.
 *
 * Everything a reader does with the mouse on a clinical photo lives here: pick
 * a tool, draw where the cursor is, grab what was drawn, move it, resize it,
 * type into it, delete it. The shape model and the painting live next door in
 * `photo-annotator.js`; this file owns only the DOM and the gestures.
 *
 * The surface is rebuilt on every app re-render — `render()` replaces the whole
 * shell's innerHTML — so it keeps no state of its own beyond the gesture in
 * flight. What survives is the layer, which is held in the app state and keyed
 * by file, exactly like the edit history it sits beside.
 */

import { t, tf } from "./i18n.js";
import {
  applyHandleDrag,
  clampShape,
  createShape,
  extendShape,
  handlesFor,
  hitTestShapes,
  isShapeUsable,
  markOrigin,
  measureTextShape,
  nextMarkerLabel,
  pushHistory,
  renderLayer,
  textFont,
  toolById,
  translateShape,
} from "./photo-annotator.js";

/** How close to a handle the pointer must be, in display pixels. */
const HANDLE_GRAB_PX = 9;

let activeSurface = null;

/** The surface currently mounted, or null between renders. */
export function currentSurface() {
  return activeSurface;
}

export function destroyActiveSurface() {
  if (activeSurface) {
    activeSurface.destroy();
    activeSurface = null;
  }
}

/**
 * Mount the drawing surface over a photo.
 *
 * `getLayer`, `getStyle` and `getTool` are read on every gesture rather than
 * captured, so the toolbar can change the active tool or colour without the
 * surface being torn down and rebuilt.
 */
export function createAnnotatorSurface(options) {
  const { wrap, img, canvas, getLayer, getStyle, getTool, scroller } = options;
  if (!wrap || !img || !canvas) return null;
  destroyActiveSurface();

  const onChange = options.onChange || (() => {});
  const onStatus = options.onStatus || (() => {});
  const onToolDone = options.onToolDone || (() => {});
  const buffer = typeof document !== "undefined" ? document.createElement("canvas") : null;

  const surface = {
    selectedId: null,
    crop: null,
    zoom: 0, // 0 = fit to stage
    editor: null,
    destroyed: false,
  };

  let gesture = null;
  let textEditor = null;
  // Held space turns any tool into the hand, the way every editor does it, so
  // the reader can shove a zoomed photo aside without disarming what they are
  // drawing with.
  let spaceHeld = false;

  // -- geometry ------------------------------------------------------------

  /** The on-screen box of the image, whatever the zoom or the letterboxing. */
  function imageBox() {
    return img.getBoundingClientRect();
  }

  /**
   * The media's own pixel size.
   *
   * The same surface drives the photo studio and the video studio, and the two
   * elements spell this differently — `naturalWidth` on an image, `videoWidth`
   * on a video. Reading both is what lets one drawing layer serve both.
   */
  function naturalSize() {
    const box = imageBox();
    return {
      width: img.naturalWidth || img.videoWidth || box.width || 1,
      height: img.naturalHeight || img.videoHeight || box.height || 1,
    };
  }
  surface.naturalSize = naturalSize;

  function displayScale() {
    const box = imageBox();
    return box.width ? box.width / naturalSize().width : 1;
  }

  /** Client coordinates -> source-image pixels. */
  function toSource(event) {
    const box = imageBox();
    const scale = displayScale() || 1;
    return {
      x: (event.clientX - box.left) / scale,
      y: (event.clientY - box.top) / scale,
    };
  }

  function clampPoint(point) {
    const size = naturalSize();
    return {
      x: Math.max(0, Math.min(point.x, size.width)),
      y: Math.max(0, Math.min(point.y, size.height)),
    };
  }

  function view() {
    return {
      scale: displayScale(),
      dpr: (typeof window !== "undefined" && window.devicePixelRatio) || 1,
      image: img,
      buffer,
    };
  }

  // -- painting ------------------------------------------------------------

  /**
   * Match the canvas to the image's on-screen box.
   *
   * The image is `object-fit: contain` inside a flexible stage, so its box
   * changes with the window, the zoom and the sidebar; a canvas that is not
   * resynchronised puts every shape a few pixels off the thing it points at.
   */
  function syncSize() {
    const box = imageBox();
    const wrapBox = wrap.getBoundingClientRect();
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    canvas.style.left = `${box.left - wrapBox.left}px`;
    canvas.style.top = `${box.top - wrapBox.top}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
  }

  function repaint() {
    if (surface.destroyed) return;
    syncSize();
    const layer = getLayer();
    const shapes = layer ? layer.shapes : [];
    const drafted = gesture?.draft ? [...shapes, gesture.draft] : shapes;
    renderLayer(canvas, drafted, view(), surface.selectedId, {
      handles: toolById(getTool()).id === "select",
    });
    if (surface.crop) drawCropOverlay();
    syncTextEditorPosition();
  }
  surface.repaint = repaint;
  surface.syncSize = syncSize;

  /** The crop rectangle: everything outside it dimmed, marching-ants border. */
  function drawCropOverlay() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = displayScale();
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const rect = surface.crop;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    ctx.setLineDash([]);
    // Rule-of-thirds guides, the same aid every crop tool gives.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    for (let i = 1; i < 3; i += 1) {
      const gx = (rect.x + (rect.width * i) / 3) * scale;
      const gy = (rect.y + (rect.height * i) / 3) * scale;
      ctx.beginPath();
      ctx.moveTo(gx, rect.y * scale);
      ctx.lineTo(gx, (rect.y + rect.height) * scale);
      ctx.moveTo(rect.x * scale, gy);
      ctx.lineTo((rect.x + rect.width) * scale, gy);
      ctx.stroke();
    }
    ctx.restore();
  }

  // -- selection -----------------------------------------------------------

  function shapesOf() {
    return getLayer()?.shapes || [];
  }

  function selectedShape() {
    return shapesOf().find((shape) => shape.id === surface.selectedId) || null;
  }
  surface.selectedShape = selectedShape;

  function select(id) {
    if (surface.selectedId === id) return;
    surface.selectedId = id;
    onChange({ reason: "select" });
    repaint();
  }
  surface.select = select;

  /** The handle under the pointer on the selected shape, if any. */
  function handleAt(point) {
    const shape = selectedShape();
    if (!shape) return null;
    const scale = displayScale() || 1;
    const tolerance = HANDLE_GRAB_PX / scale;
    return handlesFor(shape)
      .find((handle) => Math.hypot(handle.x - point.x, handle.y - point.y) <= tolerance) || null;
  }

  function measure(shape) {
    const ctx = canvas.getContext("2d");
    return ctx ? measureTextShape(ctx, shape) : { width: 0, height: 0 };
  }

  // -- text editing --------------------------------------------------------

  /**
   * Open an inline editor over the photo at the shape's own position.
   *
   * The old tool asked for the note in a `prompt()` box and then dropped it in
   * a fixed corner: the reader typed blind and the words landed somewhere they
   * had not chosen. Here the caret is where they clicked, at the size and
   * colour that will be burned in.
   */
  function openTextEditor(shape) {
    closeTextEditor({ keep: true });
    shape.editing = true;
    const element = document.createElement("textarea");
    element.className = "photo-text-input";
    element.value = shape.text || "";
    element.spellcheck = false;
    element.setAttribute("aria-label", t("Nội dung ghi chú trên ảnh"));
    wrap.appendChild(element);
    textEditor = { element, shape };
    syncTextEditorPosition();
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);

    element.addEventListener("input", () => {
      shape.text = element.value;
      autoGrow();
      repaint();
    });
    element.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeTextEditor();
      }
      // Enter commits, Shift+Enter starts a second line — the convention every
      // annotation tool uses, and clinical notes are usually one line.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        closeTextEditor();
      }
    });
    element.addEventListener("blur", () => closeTextEditor());
    autoGrow();
    repaint();

    function autoGrow() {
      const scale = displayScale() || 1;
      const size = measure(shape);
      element.style.width = `${Math.max(40, (size.width + shape.fontSize) * scale)}px`;
      element.style.height = `${Math.max(20, size.height * scale + 4)}px`;
    }
  }
  surface.openTextEditor = openTextEditor;

  function syncTextEditorPosition() {
    if (!textEditor) return;
    const { element, shape } = textEditor;
    const scale = displayScale() || 1;
    const box = imageBox();
    const wrapBox = wrap.getBoundingClientRect();
    element.style.left = `${box.left - wrapBox.left + shape.x * scale}px`;
    element.style.top = `${box.top - wrapBox.top + shape.y * scale}px`;
    element.style.font = textFont(shape, scale);
    element.style.color = shape.color;
    element.style.background = shape.background ? "rgba(0, 0, 0, 0.6)" : "transparent";
  }

  /**
   * Close the editor, keeping the note only if something was typed.
   *
   * An empty text shape would be an invisible object that still answers hit
   * tests — a reader clicking to place a note, changing their mind and clicking
   * away would leave a trap behind on the image.
   */
  function closeTextEditor({ keep = false } = {}) {
    if (!textEditor) return;
    const { element, shape } = textEditor;
    textEditor = null;
    shape.editing = false;
    shape.text = element.value;
    element.remove();
    if (keep) return;
    const layer = getLayer();
    if (!isShapeUsable(shape)) {
      if (layer) layer.shapes = layer.shapes.filter((item) => item.id !== shape.id);
      if (surface.selectedId === shape.id) surface.selectedId = null;
    }
    onChange({ reason: "text" });
    repaint();
  }
  surface.closeTextEditor = closeTextEditor;

  // -- gestures ------------------------------------------------------------

  function onPointerDown(event) {
    // Middle-drag and space-drag pan; both are checked before the tool gets a
    // look, or a pan across a photo would draw a stroke the length of the drag.
    if (scroller && (event.button === 1 || (spaceHeld && event.button === 0))) {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      gesture = {
        mode: "pan",
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      canvas.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0) return;
    const tool = toolById(getTool());
    const point = clampPoint(toSource(event));
    closeTextEditor();
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);

    if (tool.id === "crop") {
      surface.crop = { x: point.x, y: point.y, width: 0, height: 0, originX: point.x, originY: point.y };
      gesture = { mode: "crop" };
      repaint();
      return;
    }

    if (tool.id === "select") {
      const handle = handleAt(point);
      if (handle) {
        pushHistory(getLayer());
        gesture = { mode: "handle", handleId: handle.id, shape: selectedShape() };
        return;
      }
      const hit = hitTestShapes(shapesOf(), point, HANDLE_GRAB_PX / (displayScale() || 1), measure);
      select(hit ? hit.id : null);
      if (hit) {
        pushHistory(getLayer());
        gesture = { mode: "move", shape: hit, last: point, moved: false };
      }
      return;
    }

    const style = getStyle();
    const layer = getLayer();
    if (!layer) return;

    if (tool.shape === "text") {
      pushHistory(layer);
      const shape = createShape("text", point, style);
      layer.shapes.push(shape);
      surface.selectedId = shape.id;
      openTextEditor(shape);
      onToolDone(tool.id);
      return;
    }

    if (tool.shape === "marker") {
      pushHistory(layer);
      const shape = createShape("marker", point, style, { label: nextMarkerLabel(layer) });
      layer.shapes.push(shape);
      surface.selectedId = shape.id;
      onChange({ reason: "draw" });
      onToolDone(tool.id);
      repaint();
      return;
    }

    if (!tool.shape) return;
    const draft = createShape(tool.shape, point, style);
    markOrigin(draft, point);
    gesture = { mode: "draw", draft };
    repaint();
  }

  function onPointerMove(event) {
    if (!gesture) {
      updateCursor(event);
      return;
    }
    if (gesture.mode === "pan") {
      scroller.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.startX);
      scroller.scrollTop = gesture.scrollTop - (event.clientY - gesture.startY);
      return;
    }
    const point = clampPoint(toSource(event));

    if (gesture.mode === "crop") {
      const rect = surface.crop;
      const width = point.x - rect.originX;
      const height = point.y - rect.originY;
      rect.x = Math.min(rect.originX, rect.originX + width);
      rect.y = Math.min(rect.originY, rect.originY + height);
      rect.width = Math.abs(width);
      rect.height = Math.abs(height);
      repaint();
      return;
    }
    if (gesture.mode === "draw") {
      extendShape(gesture.draft, point, { square: event.shiftKey });
      repaint();
      return;
    }
    if (gesture.mode === "move" && gesture.shape) {
      translateShape(gesture.shape, point.x - gesture.last.x, point.y - gesture.last.y);
      clampShape(gesture.shape, naturalSize().width, naturalSize().height);
      gesture.last = point;
      gesture.moved = true;
      repaint();
      return;
    }
    if (gesture.mode === "handle" && gesture.shape) {
      applyHandleDrag(gesture.shape, gesture.handleId, point);
      repaint();
    }
  }

  function onPointerUp(event) {
    if (!gesture) return;
    const mode = gesture.mode;
    const draft = gesture.draft;
    const moved = gesture.moved;
    gesture = null;
    canvas.releasePointerCapture?.(event.pointerId);

    if (mode === "pan") {
      canvas.style.cursor = spaceHeld ? "grab" : "";
      return;
    }
    if (mode === "crop") {
      if (!surface.crop || surface.crop.width < 4 || surface.crop.height < 4) {
        surface.crop = null;
        onStatus(t("Hãy kéo chuột để chọn vùng cần cắt."));
      } else {
        onStatus(tf("Đã chọn vùng cắt {}×{} px. Bấm “Cắt ảnh” để áp dụng.",
          Math.round(surface.crop.width), Math.round(surface.crop.height)));
      }
      onChange({ reason: "crop" });
      repaint();
      return;
    }
    if (mode === "draw" && draft) {
      if (isShapeUsable(draft)) {
        const layer = getLayer();
        pushHistory(layer);
        delete draft.originX;
        delete draft.originY;
        layer.shapes.push(draft);
        surface.selectedId = draft.id;
        onChange({ reason: "draw" });
        onToolDone(toolById(getTool()).id);
      }
      repaint();
      return;
    }
    if ((mode === "move" && moved) || mode === "handle") {
      onChange({ reason: "edit" });
      repaint();
      return;
    }
    if (mode === "move") {
      // A click that selected without moving must not leave an undo step
      // behind, or Ctrl+Z would appear to do nothing.
      const layer = getLayer();
      if (layer?.past.length) layer.past.pop();
    }
  }

  function onDoubleClick(event) {
    const point = clampPoint(toSource(event));
    const hit = hitTestShapes(shapesOf(), point, HANDLE_GRAB_PX / (displayScale() || 1), measure);
    if (hit?.kind === "text") {
      surface.selectedId = hit.id;
      openTextEditor(hit);
    }
  }

  /** Cursor feedback: what the pointer is over decides what it looks like. */
  function updateCursor(event) {
    if (spaceHeld) {
      canvas.style.cursor = "grab";
      return;
    }
    const tool = toolById(getTool());
    if (tool.id !== "select") {
      canvas.style.cursor = tool.id === "crop" ? "crosshair" : "crosshair";
      return;
    }
    const point = clampPoint(toSource(event));
    if (handleAt(point)) {
      canvas.style.cursor = "nwse-resize";
      return;
    }
    const hit = hitTestShapes(shapesOf(), point, HANDLE_GRAB_PX / (displayScale() || 1), measure);
    canvas.style.cursor = hit ? "move" : "default";
  }

  // -- deletion and clearing ----------------------------------------------

  function deleteSelected() {
    const layer = getLayer();
    const shape = selectedShape();
    if (!layer || !shape) return false;
    pushHistory(layer);
    layer.shapes = layer.shapes.filter((item) => item.id !== shape.id);
    surface.selectedId = null;
    onChange({ reason: "delete" });
    repaint();
    return true;
  }
  surface.deleteSelected = deleteSelected;

  function clearShapes() {
    const layer = getLayer();
    if (!layer || !layer.shapes.length) return false;
    pushHistory(layer);
    layer.shapes = [];
    surface.selectedId = null;
    onChange({ reason: "clear" });
    repaint();
    return true;
  }
  surface.clearShapes = clearShapes;

  /** Restyle the selected shape, so colour and width are editable after the fact. */
  function restyleSelected(patch) {
    const shape = selectedShape();
    if (!shape) return false;
    pushHistory(getLayer());
    Object.assign(shape, patch);
    onChange({ reason: "restyle" });
    if (textEditor?.shape === shape) syncTextEditorPosition();
    repaint();
    return true;
  }
  surface.restyleSelected = restyleSelected;

  function clearCrop() {
    surface.crop = null;
    repaint();
  }
  surface.clearCrop = clearCrop;

  /** The crop rectangle in whole source pixels, or null. */
  function cropRect() {
    if (!surface.crop) return null;
    const rect = {
      x: Math.max(0, Math.round(surface.crop.x)),
      y: Math.max(0, Math.round(surface.crop.y)),
      width: Math.round(surface.crop.width),
      height: Math.round(surface.crop.height),
    };
    // Pillow refuses a box that runs past the edge, and rounding a rectangle
    // dragged to the border is exactly what pushes it over by one pixel.
    const size = naturalSize();
    rect.width = Math.min(rect.width, size.width - rect.x);
    rect.height = Math.min(rect.height, size.height - rect.y);
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }
  surface.cropRect = cropRect;

  // -- lifecycle -----------------------------------------------------------

  /**
   * Zoom under the cursor, the way a map does.
   *
   * Zooming to the centre of the pane and then hunting for the detail again
   * with the scrollbars is what makes a deep zoom unusable; the point under the
   * pointer has to stay under the pointer.
   */
  function onWheel(event) {
    if (!options.onZoomAt) return;
    event.preventDefault();
    options.onZoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
  }

  function onKeyDown(event) {
    if (event.code !== "Space" || spaceHeld) return;
    // Not while a note is being typed: space is a space there.
    if (textEditor || event.target?.closest?.("input, textarea, select")) return;
    spaceHeld = true;
    canvas.style.cursor = "grab";
  }

  function onKeyUp(event) {
    if (event.code !== "Space") return;
    spaceHeld = false;
    if (!gesture) canvas.style.cursor = "";
  }

  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("dblclick", onDoubleClick);

  // The media decodes after the markup lands, and its box is zero until it
  // does; without this the first paint of a restored layer is blank. A video
  // announces its size with `loadedmetadata` rather than `load`.
  const onImageReady = () => {
    repaint();
    onChange({ reason: "ready" });
  };
  img.addEventListener("load", onImageReady);
  img.addEventListener("loadedmetadata", onImageReady);

  let observer = null;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => repaint());
    observer.observe(wrap);
    observer.observe(img);
  }
  const onWindowResize = () => repaint();
  window.addEventListener("resize", onWindowResize);

  surface.destroy = () => {
    surface.destroyed = true;
    closeTextEditor({ keep: true });
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("dblclick", onDoubleClick);
    img.removeEventListener("load", onImageReady);
    img.removeEventListener("loadedmetadata", onImageReady);
    window.removeEventListener("resize", onWindowResize);
    observer?.disconnect();
  };

  activeSurface = surface;
  repaint();
  return surface;
}
