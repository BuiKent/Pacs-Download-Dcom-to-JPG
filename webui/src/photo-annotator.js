/**
 * photo-annotator.js — the vector drawing layer of the photo and video studios.
 *
 * What the studios had before was not a drawing tool: every shape was placed by
 * dragging one rectangle and then pressing a toolbar button, text always landed
 * at a fixed 10%/90% corner whatever the reader had pointed at, colour and size
 * were compiled in, and each shape cost a full server round-trip that re-encoded
 * the whole JPEG. Ten arrows meant ten generational re-compressions of the
 * patient's photo.
 *
 * Here a shape is an object the reader draws under the cursor, keeps selectable,
 * moves, resizes, restyles and deletes. Nothing touches the file until they
 * flatten the layer, so the image is encoded exactly once no matter how much was
 * drawn on it.
 *
 * Coordinates are stored in SOURCE-IMAGE pixels, the same space `photo_engine`
 * draws in, so what is flattened server-side at full resolution is what was on
 * screen. The `view` object carries the display scale and is applied at paint
 * time only — zooming never rewrites a shape.
 */

/** Tools in toolbar order. `shape` is the kind each one produces. */
export const ANNOTATOR_TOOLS = [
  { id: "select", shape: null, key: "V", icon: "cursor", label: "Chọn / di chuyển" },
  { id: "arrow", shape: "arrow", key: "A", icon: "arrow", label: "Mũi tên chỉ điểm" },
  { id: "line", shape: "line", key: "L", icon: "line", label: "Đường thẳng" },
  { id: "rect", shape: "rect", key: "R", icon: "rect", label: "Khung chữ nhật" },
  // E, not O: I and O are the in/out points on the surgical player, and one
  // rail serves both studios.
  { id: "ellipse", shape: "ellipse", key: "E", icon: "ellipse", label: "Khung bầu dục" },
  { id: "pen", shape: "pen", key: "P", icon: "pen", label: "Bút vẽ tay" },
  { id: "text", shape: "text", key: "T", icon: "text", label: "Chèn chữ" },
  { id: "marker", shape: "marker", key: "N", icon: "marker", label: "Đánh số thứ tự" },
  { id: "highlight", shape: "highlight", key: "H", icon: "highlight", label: "Tô sáng vùng" },
  { id: "pixelate", shape: "pixelate", key: "B", icon: "pixelate", label: "Làm mờ vùng" },
  { id: "redact", shape: "redact", key: "X", icon: "redact", label: "Che kín danh tính" },
  { id: "crop", shape: null, key: "C", icon: "crop", label: "Cắt ảnh theo vùng chọn" },
];

const TOOL_BY_ID = new Map(ANNOTATOR_TOOLS.map((tool) => [tool.id, tool]));

export function toolById(id) {
  return TOOL_BY_ID.get(id) || TOOL_BY_ID.get("select");
}

/**
 * The swatches.
 *
 * Reds and yellows read against tissue and against the blue-green of drapes;
 * white and black are what a scanned document needs. These are the defaults
 * offered, not a limit — the picker accepts any colour.
 */
export const ANNOTATOR_COLORS = [
  "#ff3b30", "#ff9500", "#ffcc00", "#34c759",
  "#00c7be", "#0a84ff", "#ffffff", "#000000",
];

/** Shapes whose geometry is a rectangle. */
const RECT_KINDS = new Set(["rect", "ellipse", "highlight", "pixelate", "redact"]);
/** Shapes whose geometry is two endpoints. */
const SEGMENT_KINDS = new Set(["arrow", "line"]);

/**
 * Whether a shape is on screen at `time` seconds into a clip.
 *
 * A shape with no span belongs to the whole recording — an identity stamp, a
 * blurred face — and one with a span belongs to a moment: the arrow that points
 * at the duct as it is clipped has no business sitting there for the closing.
 * `time` of null means "not playing a video", where everything is visible.
 */
export function shapeVisibleAt(shape, time) {
  if (time === null || time === undefined) return true;
  const start = shape?.startS;
  const end = shape?.endS;
  if (start === null || start === undefined || end === null || end === undefined) return true;
  return time >= start && time <= end;
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `sh_${idCounter}`;
}

/** The style a new shape inherits, and what the properties bar edits. */
export function defaultStyle() {
  return {
    color: "#ff3b30",
    strokeWidth: 4,
    fontSize: 28,
    opacity: 1,
    filled: false,
    textBackground: true,
  };
}

/**
 * One file's drawing layer, with its own history.
 *
 * History is a stack of whole-layer snapshots rather than a list of inverse
 * operations: a layer is a handful of small objects, and snapshots cannot drift
 * out of step with the model the way hand-written inverses do.
 */
export function createLayer() {
  return { shapes: [], past: [], future: [] };
}

function cloneShapes(shapes) {
  return shapes.map((shape) => ({
    ...shape,
    points: shape.points ? shape.points.map((point) => ({ ...point })) : undefined,
  }));
}

/** Snapshot the layer. Call BEFORE the mutation that should be undoable. */
export function pushHistory(layer) {
  if (!layer) return;
  layer.past.push(cloneShapes(layer.shapes));
  if (layer.past.length > 100) layer.past.shift();
  layer.future.length = 0;
}

export function canUndoLayer(layer) {
  return Boolean(layer?.past?.length);
}

export function canRedoLayer(layer) {
  return Boolean(layer?.future?.length);
}

export function undoLayer(layer) {
  if (!canUndoLayer(layer)) return false;
  layer.future.push(cloneShapes(layer.shapes));
  layer.shapes = layer.past.pop();
  return true;
}

export function redoLayer(layer) {
  if (!canRedoLayer(layer)) return false;
  layer.past.push(cloneShapes(layer.shapes));
  layer.shapes = layer.future.pop();
  return true;
}

/** The number the next marker gets: one past the highest already placed. */
export function nextMarkerLabel(layer) {
  const used = (layer?.shapes || [])
    .filter((shape) => shape.kind === "marker")
    .map((shape) => Number(shape.label) || 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

/**
 * Start a shape at the point the pointer went down on.
 *
 * A shape is born already carrying the reader's current colour and width, so
 * choosing red before drawing and choosing it after both work.
 */
export function createShape(kind, point, style, extra = {}) {
  const base = {
    id: nextId(),
    kind,
    color: style.color,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
    ...extra,
  };
  if (SEGMENT_KINDS.has(kind)) {
    return { ...base, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
  }
  if (RECT_KINDS.has(kind)) {
    return { ...base, x: point.x, y: point.y, width: 0, height: 0, filled: style.filled };
  }
  if (kind === "pen") {
    return { ...base, points: [{ x: point.x, y: point.y }] };
  }
  if (kind === "text") {
    return {
      ...base,
      x: point.x,
      y: point.y,
      text: "",
      fontSize: style.fontSize,
      background: style.textBackground,
    };
  }
  if (kind === "marker") {
    return { ...base, x: point.x, y: point.y, fontSize: style.fontSize, label: extra.label || 1 };
  }
  return base;
}

/** Extend the shape being drawn to the pointer's current position. */
export function extendShape(shape, point, options = {}) {
  if (!shape) return;
  if (SEGMENT_KINDS.has(shape.kind)) {
    shape.x2 = point.x;
    shape.y2 = point.y;
    return;
  }
  if (RECT_KINDS.has(shape.kind)) {
    // The origin is the corner the drag started from; it is kept beside the
    // rectangle so a drag back past it still produces a positive-size shape.
    const originX = shape.originX ?? shape.x;
    const originY = shape.originY ?? shape.y;
    let width = point.x - originX;
    let height = point.y - originY;
    if (options.square) {
      const size = Math.max(Math.abs(width), Math.abs(height));
      width = Math.sign(width || 1) * size;
      height = Math.sign(height || 1) * size;
    }
    shape.x = Math.min(originX, originX + width);
    shape.y = Math.min(originY, originY + height);
    shape.width = Math.abs(width);
    shape.height = Math.abs(height);
    return;
  }
  if (shape.kind === "pen") {
    const last = shape.points[shape.points.length - 1];
    // Freehand at screen resolution produces hundreds of points a second; one
    // point per source pixel of movement keeps the stroke smooth and the
    // payload small.
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1) {
      shape.points.push({ x: point.x, y: point.y });
    }
  }
}

/** Remember where a rectangle drag began, so it can be dragged in any direction. */
export function markOrigin(shape, point) {
  if (RECT_KINDS.has(shape?.kind)) {
    shape.originX = point.x;
    shape.originY = point.y;
  }
}

/**
 * Whether a shape is worth keeping once the pointer is released.
 *
 * A click that never became a drag leaves a zero-size rectangle or a
 * zero-length arrow; keeping those litters the layer with invisible objects
 * that still answer hit tests.
 */
export function isShapeUsable(shape) {
  if (!shape) return false;
  if (SEGMENT_KINDS.has(shape.kind)) {
    return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) >= 4;
  }
  if (RECT_KINDS.has(shape.kind)) {
    return shape.width >= 4 && shape.height >= 4;
  }
  if (shape.kind === "pen") return shape.points.length >= 2;
  if (shape.kind === "text") return String(shape.text || "").trim().length > 0;
  if (shape.kind === "marker") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The axis-aligned box a shape occupies, in source pixels. */
export function shapeBounds(shape, measure = null) {
  if (!shape) return null;
  if (SEGMENT_KINDS.has(shape.kind)) {
    return {
      x: Math.min(shape.x1, shape.x2),
      y: Math.min(shape.y1, shape.y2),
      width: Math.abs(shape.x2 - shape.x1),
      height: Math.abs(shape.y2 - shape.y1),
    };
  }
  if (RECT_KINDS.has(shape.kind)) {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  if (shape.kind === "pen") {
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  if (shape.kind === "text") {
    const size = measure ? measure(shape) : { width: shape.fontSize * 6, height: shape.fontSize };
    return { x: shape.x, y: shape.y, width: size.width, height: size.height };
  }
  if (shape.kind === "marker") {
    const radius = markerRadius(shape);
    return { x: shape.x - radius, y: shape.y - radius, width: radius * 2, height: radius * 2 };
  }
  return null;
}

export function markerRadius(shape) {
  return Math.max(12, (shape.fontSize || 28) * 0.75);
}

export function translateShape(shape, dx, dy) {
  if (!shape) return;
  if (SEGMENT_KINDS.has(shape.kind)) {
    shape.x1 += dx; shape.y1 += dy; shape.x2 += dx; shape.y2 += dy;
    return;
  }
  if (shape.kind === "pen") {
    shape.points.forEach((point) => { point.x += dx; point.y += dy; });
    return;
  }
  shape.x += dx;
  shape.y += dy;
}

/** Keep every shape inside the image after a move or resize. */
export function clampShape(shape, width, height) {
  const bounds = shapeBounds(shape);
  if (!bounds) return;
  const dx = Math.min(0, width - (bounds.x + bounds.width)) - Math.min(0, bounds.x);
  const dy = Math.min(0, height - (bounds.y + bounds.height)) - Math.min(0, bounds.y);
  if (dx || dy) translateShape(shape, dx, dy);
}

/**
 * The drag handles for a selected shape.
 *
 * Rectangles get four corners, segments get their two endpoints, and everything
 * else is move-only — resizing a freehand stroke or a text run by dragging a
 * corner is a scaling operation, and a scaled annotation on a clinical photo
 * reads as a measurement it is not.
 */
export function handlesFor(shape) {
  if (!shape) return [];
  if (SEGMENT_KINDS.has(shape.kind)) {
    return [
      { id: "p1", x: shape.x1, y: shape.y1 },
      { id: "p2", x: shape.x2, y: shape.y2 },
    ];
  }
  if (RECT_KINDS.has(shape.kind)) {
    const { x, y, width, height } = shape;
    return [
      { id: "nw", x, y },
      { id: "ne", x: x + width, y },
      { id: "se", x: x + width, y: y + height },
      { id: "sw", x, y: y + height },
    ];
  }
  return [];
}

/** Move one handle to the pointer, keeping the opposite corner pinned. */
export function applyHandleDrag(shape, handleId, point) {
  if (!shape) return;
  if (handleId === "p1") { shape.x1 = point.x; shape.y1 = point.y; return; }
  if (handleId === "p2") { shape.x2 = point.x; shape.y2 = point.y; return; }
  if (!RECT_KINDS.has(shape.kind)) return;
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const anchorX = handleId === "nw" || handleId === "sw" ? right : shape.x;
  const anchorY = handleId === "nw" || handleId === "ne" ? bottom : shape.y;
  shape.x = Math.min(anchorX, point.x);
  shape.y = Math.min(anchorY, point.y);
  shape.width = Math.abs(point.x - anchorX);
  shape.height = Math.abs(point.y - anchorY);
}

function distanceToSegment(point, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - x1, point.y - y1);
  let ratio = ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSq;
  ratio = Math.max(0, Math.min(1, ratio));
  return Math.hypot(point.x - (x1 + ratio * dx), point.y - (y1 + ratio * dy));
}

/**
 * The topmost shape under the pointer.
 *
 * Later shapes are drawn over earlier ones, so the list is searched backwards:
 * what the reader sees on top is what they grab.
 */
export function hitTestShapes(shapes, point, tolerance = 6, measure = null) {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    if (hitTestShape(shapes[index], point, tolerance, measure)) return shapes[index];
  }
  return null;
}

export function hitTestShape(shape, point, tolerance = 6, measure = null) {
  if (!shape) return false;
  const slack = Math.max(tolerance, (shape.strokeWidth || 1) / 2 + tolerance);
  if (SEGMENT_KINDS.has(shape.kind)) {
    return distanceToSegment(point, shape.x1, shape.y1, shape.x2, shape.y2) <= slack;
  }
  if (shape.kind === "pen") {
    for (let i = 1; i < shape.points.length; i += 1) {
      const a = shape.points[i - 1];
      const b = shape.points[i];
      if (distanceToSegment(point, a.x, a.y, b.x, b.y) <= slack) return true;
    }
    return false;
  }
  const bounds = shapeBounds(shape, measure);
  if (!bounds) return false;
  const inside = point.x >= bounds.x - slack && point.x <= bounds.x + bounds.width + slack
    && point.y >= bounds.y - slack && point.y <= bounds.y + bounds.height + slack;
  if (!inside) return false;
  // A hollow rectangle is grabbed by its edge; its interior belongs to whatever
  // is underneath, which is how every drawing tool behaves.
  if (shape.kind === "rect" && !shape.filled) {
    const innerX = point.x >= bounds.x + slack && point.x <= bounds.x + bounds.width - slack;
    const innerY = point.y >= bounds.y + slack && point.y <= bounds.y + bounds.height - slack;
    return !(innerX && innerY);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  const full = value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const number = parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The font string a text shape paints with, at display scale. */
export function textFont(shape, scale = 1) {
  return `600 ${Math.max(8, (shape.fontSize || 28) * scale)}px "Segoe UI", Arial, sans-serif`;
}

/** The lines of a text shape. Multi-line notes are common on operative photos. */
function textLines(shape) {
  return String(shape.text || "").split("\n");
}

/** Measure a text shape in source pixels, using a canvas context for metrics. */
export function measureTextShape(ctx, shape) {
  ctx.save();
  ctx.font = textFont(shape, 1);
  const lines = textLines(shape);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  ctx.restore();
  const lineHeight = (shape.fontSize || 28) * 1.25;
  return { width, height: lineHeight * lines.length };
}

/**
 * Paint one shape onto a context already scaled to display pixels.
 *
 * `view.scale` is applied to the coordinates rather than to the context, so
 * stroke widths stay in source pixels and a line drawn 4px thick is 4px thick
 * in the flattened file whatever zoom it was drawn at.
 */
export function drawShape(ctx, shape, view) {
  const scale = view.scale || 1;
  const stroke = Math.max(1, (shape.strokeWidth || 1) * scale);
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const sx = (value) => value * scale;

  switch (shape.kind) {
    case "line":
      ctx.beginPath();
      ctx.moveTo(sx(shape.x1), sx(shape.y1));
      ctx.lineTo(sx(shape.x2), sx(shape.y2));
      ctx.stroke();
      break;
    case "arrow":
      drawArrow(ctx, shape, scale);
      break;
    case "rect":
      if (shape.filled) {
        ctx.fillRect(sx(shape.x), sx(shape.y), sx(shape.width), sx(shape.height));
      } else {
        ctx.strokeRect(sx(shape.x), sx(shape.y), sx(shape.width), sx(shape.height));
      }
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        sx(shape.x + shape.width / 2), sx(shape.y + shape.height / 2),
        Math.max(1, sx(shape.width / 2)), Math.max(1, sx(shape.height / 2)),
        0, 0, Math.PI * 2,
      );
      if (shape.filled) ctx.fill(); else ctx.stroke();
      break;
    case "highlight":
      ctx.globalAlpha = (shape.opacity ?? 1) * 0.35;
      ctx.fillRect(sx(shape.x), sx(shape.y), sx(shape.width), sx(shape.height));
      break;
    case "redact":
      ctx.fillStyle = "#000000";
      ctx.globalAlpha = 1;
      ctx.fillRect(sx(shape.x), sx(shape.y), sx(shape.width), sx(shape.height));
      break;
    case "pixelate":
      drawPixelatePreview(ctx, shape, view);
      break;
    case "pen":
      ctx.beginPath();
      shape.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(sx(point.x), sx(point.y));
        else ctx.lineTo(sx(point.x), sx(point.y));
      });
      ctx.stroke();
      break;
    case "text":
      drawText(ctx, shape, scale);
      break;
    case "marker":
      drawMarker(ctx, shape, scale);
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawArrow(ctx, shape, scale) {
  const sx = (value) => value * scale;
  const stroke = Math.max(1, (shape.strokeWidth || 1) * scale);
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  // The head grows with the shaft: a 2px arrow with a 30px head looks like a
  // pin, a 12px arrow with a 14px head looks like a blunt line.
  const head = Math.max(stroke * 3.2, 10);
  const tipX = sx(shape.x2);
  const tipY = sx(shape.y2);
  // Stop the shaft short of the tip so the round cap does not bulge past the
  // head and blunt the point.
  const shaftX = tipX - Math.cos(angle) * head * 0.72;
  const shaftY = tipY - Math.sin(angle) * head * 0.72;
  ctx.beginPath();
  ctx.moveTo(sx(shape.x1), sx(shape.y1));
  ctx.lineTo(shaftX, shaftY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - head * Math.cos(angle - Math.PI / 7), tipY - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(tipX - head * Math.cos(angle + Math.PI / 7), tipY - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function drawText(ctx, shape, scale) {
  const lines = textLines(shape);
  const fontSize = (shape.fontSize || 28) * scale;
  const lineHeight = fontSize * 1.25;
  ctx.font = textFont(shape, scale);
  ctx.textBaseline = "top";
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  const x = shape.x * scale;
  const y = shape.y * scale;
  if (shape.background) {
    const pad = fontSize * 0.22;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(x - pad, y - pad, width + pad * 2, lineHeight * lines.length + pad * 2);
  }
  ctx.fillStyle = shape.color;
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function drawMarker(ctx, shape, scale) {
  const radius = markerRadius(shape) * scale;
  ctx.beginPath();
  ctx.arc(shape.x * scale, shape.y * scale, radius, 0, Math.PI * 2);
  ctx.fillStyle = shape.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.stroke();
  ctx.fillStyle = pickReadableInk(shape.color);
  ctx.font = `700 ${radius * 1.15}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(shape.label ?? 1), shape.x * scale, shape.y * scale + radius * 0.05);
  ctx.textAlign = "start";
}

/**
 * Black or white digits, whichever survives on the marker's fill.
 *
 * A yellow marker with white digits is unreadable, and the number on a marker
 * is the whole point of the marker.
 */
export function pickReadableInk(hex) {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

/**
 * The edge of one mosaic block, in source pixels.
 *
 * Shared with `photo_engine._pixelate_block`; the two must agree or the reader
 * approves a coarseness on screen and gets a different one in the file.
 */
export function pixelateBlock(shape) {
  return Math.max(4, Math.round((shape.strokeWidth || 4) * 2.5));
}

/**
 * Preview a pixelate region by resampling the image element itself.
 *
 * The real blur happens server-side on the full-resolution file — this only has
 * to show the reader what will be destroyed, and showing the actual pixels
 * coarsened is far more honest than a grey placeholder box.
 */
function drawPixelatePreview(ctx, shape, view) {
  const scale = view.scale || 1;
  const dx = shape.x * scale;
  const dy = shape.y * scale;
  const dw = shape.width * scale;
  const dh = shape.height * scale;
  const source = view.image;
  if (!source || !dw || !dh) {
    ctx.fillStyle = "rgba(20, 20, 20, 0.85)";
    ctx.fillRect(dx, dy, dw, dh);
    return;
  }
  // The block size is computed in SOURCE pixels, the same way the engine does
  // it, so the preview does not change coarseness as the reader zooms.
  const block = pixelateBlock(shape);
  const smallW = Math.max(1, Math.round(shape.width / block));
  const smallH = Math.max(1, Math.round(shape.height / block));
  const buffer = view.buffer;
  if (!buffer) return;
  buffer.width = smallW;
  buffer.height = smallH;
  const bufferCtx = buffer.getContext("2d");
  bufferCtx.imageSmoothingEnabled = true;
  try {
    bufferCtx.drawImage(source, shape.x, shape.y, shape.width, shape.height, 0, 0, smallW, smallH);
  } catch (_) {
    // A source that has not decoded yet throws; the region is simply not
    // previewed this frame and the next repaint picks it up.
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, smallW, smallH, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = true;
}

/**
 * The dashed box and grab handles around the selected shape.
 *
 * `withHandles` is false while a drawing tool is armed: the pointer draws a new
 * shape then, so corner handles would be an affordance that does not work. The
 * dashed outline stays either way — it is what tells the reader which shape the
 * properties bar is about to restyle.
 */
export function drawSelection(ctx, shape, view, measure, withHandles = true) {
  const scale = view.scale || 1;
  const bounds = shapeBounds(shape, measure);
  if (!bounds) return;
  const pad = 4;
  ctx.save();
  ctx.strokeStyle = "#4da3ff";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(
    bounds.x * scale - pad, bounds.y * scale - pad,
    bounds.width * scale + pad * 2, bounds.height * scale + pad * 2,
  );
  ctx.setLineDash([]);
  for (const handle of withHandles ? handlesFor(shape) : []) {
    ctx.beginPath();
    ctx.rect(handle.x * scale - 4, handle.y * scale - 4, 8, 8);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#1a73e8";
    ctx.stroke();
  }
  ctx.restore();
}

/** Repaint the whole layer. Called on every pointer move, so it stays cheap. */
export function renderLayer(canvas, shapes, view, selectedId = null, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = view.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  const measure = (shape) => measureTextShape(ctx, shape);
  for (const shape of shapes) {
    // The text being typed is shown by the live editor element sitting on top;
    // painting it here too would double-strike every glyph.
    if (shape.editing) continue;
    // A shape whose moment has not come is drawn faint rather than hidden: the
    // reader still has to be able to find it, select it and change its timing
    // while the playhead is somewhere else entirely.
    const dimmed = !shapeVisibleAt(shape, options.time ?? null);
    if (dimmed) ctx.globalAlpha = 0.22;
    drawShape(ctx, shape, view);
    ctx.globalAlpha = 1;
  }
  const selected = shapes.find((shape) => shape.id === selectedId);
  if (selected && !selected.editing) {
    drawSelection(ctx, selected, view, measure, options.handles !== false);
  }
}

// ---------------------------------------------------------------------------
// Server payload
// ---------------------------------------------------------------------------

/**
 * One shape as `photo_engine.draw_shapes` expects it.
 *
 * snake_case, colours as RGB triples, geometry rounded to whole source pixels —
 * the engine's own vocabulary. The client's camelCase leaking into a Pillow
 * dataclass is exactly what made the old text tool raise a TypeError on every
 * use.
 */
export function shapePayload(shape) {
  const common = {
    kind: shape.kind,
    color: hexToRgb(shape.color),
    stroke_width: Math.max(1, Math.round(shape.strokeWidth || 1)),
    opacity: Number(shape.opacity ?? 1),
  };
  // Only a shape drawn on a clip carries a span; on a photo the keys are absent
  // rather than null, so the engine's `Shape` never has to know about time.
  if (Number.isFinite(shape.startS) && Number.isFinite(shape.endS)) {
    common.start_s = Number(shape.startS);
    common.end_s = Number(shape.endS);
  }
  const round = (value) => Math.round(Number(value) || 0);
  if (SEGMENT_KINDS.has(shape.kind)) {
    return { ...common, x1: round(shape.x1), y1: round(shape.y1), x2: round(shape.x2), y2: round(shape.y2) };
  }
  if (RECT_KINDS.has(shape.kind)) {
    return {
      ...common,
      x: round(shape.x), y: round(shape.y),
      width: round(shape.width), height: round(shape.height),
      filled: Boolean(shape.filled),
    };
  }
  if (shape.kind === "pen") {
    return { ...common, points: shape.points.map((point) => [round(point.x), round(point.y)]) };
  }
  if (shape.kind === "text") {
    return {
      ...common,
      x: round(shape.x), y: round(shape.y),
      text: String(shape.text || ""),
      font_size: Math.max(6, round(shape.fontSize)),
      background: Boolean(shape.background),
    };
  }
  if (shape.kind === "marker") {
    return {
      ...common,
      x: round(shape.x), y: round(shape.y),
      label: String(shape.label ?? 1),
      font_size: Math.max(6, round(shape.fontSize)),
    };
  }
  return common;
}

export function layerPayload(shapes) {
  return shapes.filter(isShapeUsable).map(shapePayload);
}
