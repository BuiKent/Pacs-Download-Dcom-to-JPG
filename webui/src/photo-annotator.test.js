// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  ANNOTATOR_TOOLS,
  applyHandleDrag,
  clampShape,
  createLayer,
  createShape,
  defaultStyle,
  extendShape,
  handlesFor,
  hexToRgb,
  hitTestShape,
  hitTestShapes,
  isShapeUsable,
  layerPayload,
  markOrigin,
  nextMarkerLabel,
  pickReadableInk,
  pushHistory,
  redoLayer,
  shapeBounds,
  shapePayload,
  translateShape,
  undoLayer,
} from "./photo-annotator.js";

/** A shape drawn from a to b, the way a pointer gesture builds one. */
function drag(kind, from, to, style = defaultStyle()) {
  const shape = createShape(kind, from, style);
  markOrigin(shape, from);
  extendShape(shape, to);
  return shape;
}

describe("Drawing where the pointer is", () => {
  it("puts a shape at the cursor rather than at a fixed corner", () => {
    // The old text tool ignored the pointer entirely and dropped every note at
    // 10% / 90% of the image, so a reader annotating the top-left of a wound
    // got their words in the bottom-left corner.
    const text = createShape("text", { x: 640, y: 210 }, defaultStyle());
    expect(text).toMatchObject({ kind: "text", x: 640, y: 210 });

    const arrow = drag("arrow", { x: 100, y: 500 }, { x: 400, y: 200 });
    expect(arrow).toMatchObject({ x1: 100, y1: 500, x2: 400, y2: 200 });
  });

  it("builds a positive rectangle however the drag runs", () => {
    // Dragging up-and-left is as natural as down-and-right, and a negative
    // width reaches Pillow as a box whose corners are the wrong way round.
    const shape = drag("rect", { x: 400, y: 300 }, { x: 120, y: 90 });
    expect(shape).toMatchObject({ x: 120, y: 90, width: 280, height: 210 });
  });

  it("constrains to a square while shift is held", () => {
    const shape = createShape("ellipse", { x: 50, y: 50 }, defaultStyle());
    markOrigin(shape, { x: 50, y: 50 });
    extendShape(shape, { x: 250, y: 130 }, { square: true });
    expect(shape.width).toBe(shape.height);
    expect(shape.width).toBe(200);
  });

  it("thins a freehand stroke to one point per source pixel", () => {
    // A pointer reports hundreds of moves a second; kept whole, one scribble
    // is a payload of thousands of points that draws no differently.
    const pen = createShape("pen", { x: 10, y: 10 }, defaultStyle());
    for (let i = 1; i <= 50; i += 1) extendShape(pen, { x: 10 + i * 0.2, y: 10 });
    expect(pen.points).toHaveLength(11);
    expect(pen.points.at(-1)).toEqual({ x: 20, y: 10 });
  });

  it("throws away a click that never became a drag", () => {
    // Keeping it would leave an invisible object on a clinical photo that still
    // answers hit tests and still gets burned in.
    expect(isShapeUsable(drag("rect", { x: 5, y: 5 }, { x: 6, y: 6 }))).toBe(false);
    expect(isShapeUsable(drag("arrow", { x: 5, y: 5 }, { x: 7, y: 6 }))).toBe(false);
    expect(isShapeUsable(createShape("text", { x: 5, y: 5 }, defaultStyle()))).toBe(false);
    expect(isShapeUsable(drag("rect", { x: 5, y: 5 }, { x: 60, y: 40 }))).toBe(true);
    // A numbered marker is a single click by design; it is always usable.
    expect(isShapeUsable(createShape("marker", { x: 5, y: 5 }, defaultStyle()))).toBe(true);
  });

  it("numbers markers in the order they are placed", () => {
    const layer = createLayer();
    expect(nextMarkerLabel(layer)).toBe(1);
    layer.shapes.push(createShape("marker", { x: 1, y: 1 }, defaultStyle(), { label: 1 }));
    layer.shapes.push(createShape("marker", { x: 2, y: 2 }, defaultStyle(), { label: 2 }));
    expect(nextMarkerLabel(layer)).toBe(3);
  });

  it("carries the reader's chosen colour and width onto every new shape", () => {
    const style = { ...defaultStyle(), color: "#0a84ff", strokeWidth: 9, opacity: 0.5 };
    const shape = drag("line", { x: 0, y: 0 }, { x: 90, y: 90 }, style);
    expect(shape).toMatchObject({ color: "#0a84ff", strokeWidth: 9, opacity: 0.5 });
  });
});

describe("Picking a shape back up", () => {
  it("grabs the topmost shape under the pointer", () => {
    const under = drag("rect", { x: 0, y: 0 }, { x: 200, y: 200 });
    under.filled = true;
    const over = drag("rect", { x: 50, y: 50 }, { x: 150, y: 150 });
    over.filled = true;
    const hit = hitTestShapes([under, over], { x: 100, y: 100 });
    expect(hit).toBe(over);
  });

  it("grabs a hollow rectangle by its edge, not through its middle", () => {
    const box = drag("rect", { x: 100, y: 100 }, { x: 400, y: 300 });
    expect(hitTestShape(box, { x: 100, y: 200 })).toBe(true);
    expect(hitTestShape(box, { x: 250, y: 200 })).toBe(false);
  });

  it("grabs a thin line within a tolerance a hand can actually hit", () => {
    const line = drag("line", { x: 0, y: 0 }, { x: 300, y: 300 });
    expect(hitTestShape(line, { x: 150, y: 153 })).toBe(true);
    expect(hitTestShape(line, { x: 150, y: 220 })).toBe(false);
  });

  it("moves a shape without changing its size", () => {
    const arrow = drag("arrow", { x: 10, y: 10 }, { x: 110, y: 60 });
    translateShape(arrow, 40, -5);
    expect(arrow).toMatchObject({ x1: 50, y1: 5, x2: 150, y2: 55 });
  });

  it("keeps a dragged shape inside the image", () => {
    const box = drag("rect", { x: 700, y: 500 }, { x: 900, y: 600 });
    translateShape(box, 400, 400);
    clampShape(box, 1000, 800);
    const bounds = shapeBounds(box);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1000);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
  });

  it("resizes from a corner with the opposite corner pinned", () => {
    const box = drag("rect", { x: 100, y: 100 }, { x: 300, y: 200 });
    applyHandleDrag(box, "nw", { x: 60, y: 40 });
    expect(box).toMatchObject({ x: 60, y: 40, width: 240, height: 160 });
  });

  it("offers endpoint handles on a segment and corners on a rectangle", () => {
    expect(handlesFor(drag("arrow", { x: 0, y: 0 }, { x: 10, y: 10 })).map((h) => h.id))
      .toEqual(["p1", "p2"]);
    expect(handlesFor(drag("rect", { x: 0, y: 0 }, { x: 10, y: 10 })).map((h) => h.id))
      .toEqual(["nw", "ne", "se", "sw"]);
  });
});

describe("Undo on the drawing layer", () => {
  it("steps back and forward through whole-layer snapshots", () => {
    const layer = createLayer();
    pushHistory(layer);
    layer.shapes.push(drag("rect", { x: 0, y: 0 }, { x: 50, y: 50 }));
    pushHistory(layer);
    layer.shapes.push(drag("arrow", { x: 0, y: 0 }, { x: 50, y: 50 }));
    expect(layer.shapes).toHaveLength(2);

    expect(undoLayer(layer)).toBe(true);
    expect(layer.shapes).toHaveLength(1);
    expect(undoLayer(layer)).toBe(true);
    expect(layer.shapes).toHaveLength(0);
    expect(undoLayer(layer)).toBe(false);

    expect(redoLayer(layer)).toBe(true);
    expect(layer.shapes).toHaveLength(1);
  });

  it("drops the redo branch once something new is drawn", () => {
    const layer = createLayer();
    pushHistory(layer);
    layer.shapes.push(drag("rect", { x: 0, y: 0 }, { x: 50, y: 50 }));
    undoLayer(layer);
    pushHistory(layer);
    layer.shapes.push(drag("line", { x: 0, y: 0 }, { x: 50, y: 50 }));
    expect(redoLayer(layer)).toBe(false);
  });

  it("snapshots deeply, so undo does not hand back a shape still being mutated", () => {
    const layer = createLayer();
    const pen = createShape("pen", { x: 1, y: 1 }, defaultStyle());
    extendShape(pen, { x: 30, y: 30 });
    layer.shapes.push(pen);
    pushHistory(layer);
    pen.points.push({ x: 90, y: 90 });
    undoLayer(layer);
    expect(layer.shapes[0].points).toHaveLength(2);
  });
});

describe("What reaches the engine", () => {
  it("speaks the engine's snake_case and RGB triples", () => {
    // photo_engine is a set of dataclasses; camelCase keys expand into a
    // TypeError, which is exactly how the old text tool failed on every use.
    const text = createShape("text", { x: 12.6, y: 40.2 }, defaultStyle());
    text.text = "Ổ loét";
    const payload = shapePayload(text);
    expect(payload).toMatchObject({
      kind: "text", x: 13, y: 40, text: "Ổ loét", font_size: 28, background: true,
    });
    expect(payload.color).toEqual([255, 59, 48]);
    expect(payload.stroke_width).toBe(4);
    expect(payload).not.toHaveProperty("fontSize");
    expect(payload).not.toHaveProperty("strokeWidth");
  });

  it("rounds geometry to whole source pixels", () => {
    const box = drag("rect", { x: 10.4, y: 20.6 }, { x: 110.5, y: 90.4 });
    expect(shapePayload(box)).toMatchObject({ x: 10, y: 21, width: 100, height: 70 });
  });

  it("sends a freehand stroke as point pairs", () => {
    const pen = createShape("pen", { x: 1, y: 2 }, defaultStyle());
    extendShape(pen, { x: 30, y: 40 });
    expect(shapePayload(pen).points).toEqual([[1, 2], [30, 40]]);
  });

  it("leaves shapes too small to be deliberate out of the payload", () => {
    const shapes = [
      drag("rect", { x: 0, y: 0 }, { x: 100, y: 100 }),
      drag("rect", { x: 0, y: 0 }, { x: 2, y: 2 }),
    ];
    expect(layerPayload(shapes)).toHaveLength(1);
  });

  it("parses every swatch into a valid RGB triple", () => {
    expect(hexToRgb("#ff3b30")).toEqual([255, 59, 48]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("000000")).toEqual([0, 0, 0]);
  });
});

describe("Legibility rules", () => {
  it("inks a marker in whatever survives on its own fill", () => {
    // A yellow marker with white digits is unreadable, and the number is the
    // entire point of a marker.
    expect(pickReadableInk("#ffcc00")).toBe("#111111");
    expect(pickReadableInk("#ffffff")).toBe("#111111");
    expect(pickReadableInk("#0a84ff")).toBe("#ffffff");
    expect(pickReadableInk("#000000")).toBe("#ffffff");
  });

  it("gives every tool a distinct single-key shortcut", () => {
    const keys = ANNOTATOR_TOOLS.map((tool) => tool.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
