// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  action,
  getSeriesMediaType,
  getPhotoSourcePath,
  getVideoSourcePath,
  renderSurgeryVideoStudio,
  renderPhotoEditorStudio,
  renderTextViewer,
  renderWorkspacePane,
  loadTextContent,
  renderViewer,
  photoLayer,
  selectedSeries,
} from "./main.js";
import { createShape, defaultStyle } from "./photo-annotator.js";

describe("Media Studio Detection & Layouts", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.mediaIndex = {};
    state.mediaEdits = {};
    state.photoWorkingPath = null;
    state.photoRotation = 0;
    state.videoWorkingPath = null;
    state.videoFilmstrip = [];
    state.videoBookmarks = [];
    state._videoInfoLoaded = false;
  });

  it("routes on the media type the backend read off the files", () => {
    expect(getSeriesMediaType({ mediaType: "video" })).toBe("video");
    expect(getSeriesMediaType({ mediaType: "photo" })).toBe("photo");
    expect(getSeriesMediaType({ mediaType: "doc" })).toBe("doc");
    expect(getSeriesMediaType({ mediaType: "text" })).toBe("text");
    expect(getSeriesMediaType({ mediaType: "dicom" })).toBe("dicom");
  });

  it("never sends a post-operative study to the video editor", () => {
    // These descriptions used to match a "mổ"/"phẫu thuật" substring search
    // and open a follow-up MRI in a video trimmer. The description is prose
    // about the patient, never a statement about the file format.
    const postOp = [
      "MR khớp gối sau mổ",
      "CT bụng sau mổ ruột thừa",
      "MRI cột sống hậu phẫu thuật",
      "CT sọ não theo dõi sau mổ u",
    ];
    for (const description of postOp) {
      expect(getSeriesMediaType({ mediaType: "dicom", description })).toBe("dicom");
    }
  });

  it("keeps a genuine surgical video in the video studio whatever it is named", () => {
    // The old heuristic only caught Vietnamese wording, so an English-named
    // operative recording fell through to the diagnostic canvas.
    expect(getSeriesMediaType({ mediaType: "video", description: "Laparoscopic cholecystectomy" }))
      .toBe("video");
    expect(getSeriesMediaType({ mediaType: "video", description: "Case 12" })).toBe("video");
  });

  it("falls back to the reading canvas when the type is missing or unknown", () => {
    expect(getSeriesMediaType({ description: "T1 SAG 5mm", sliceCount: 24 })).toBe("dicom");
    expect(getSeriesMediaType({ mediaType: "spreadsheet" })).toBe("dicom");
    expect(getSeriesMediaType(null)).toBe("dicom");
  });

  it("renders surgery video studio layout with toolbar and bookmarks", () => {
    const series = { id: "vid_01", patientName: "Nguyen Van A", mediaType: "video" };
    state.videoBookmarks = [{ time: 12.5, text: "Bắt đầu rạch da" }];
    state.videoFilmstrip = ["/work/frame_0.jpg", "/work/frame_1.jpg"];

    const html = renderSurgeryVideoStudio(series);
    expect(html).toContain("surgery-video-studio");
    expect(html).toContain("video-tool-trim");
    expect(html).toContain("video-tool-burn-text");
    expect(html).toContain("video-tool-filmstrip");
    expect(html).toContain("video-tool-transcode");
    expect(html).toContain("Bắt đầu rạch da");
    expect(html).toContain("frame_0.jpg");
    expect(html).toContain("frame_1.jpg");
  });

  it("renders the photo studio with a tool rail, a properties bar and a canvas", () => {
    const series = { id: "photo_01", patientName: "Tran Van B", mediaType: "photo" };
    const html = renderPhotoEditorStudio(series);
    expect(html).toContain("photo-editor-studio");
    expect(html).toContain("photo-rotate-cw");
    expect(html).toContain("photo-export-pdf");
    // The drawing layer needs its own canvas over the image; without it every
    // tool is back to acting on one dragged rectangle.
    expect(html).toContain("photo-annotation-canvas");
    expect(html).toContain("photo-tool-rail");
    for (const tool of ["arrow", "text", "marker", "pen", "crop", "redact"]) {
      expect(html).toContain(`data-tool="${tool}"`);
    }
    // Colour and size were compiled into the old tools, so two findings on one
    // photo could not be told apart.
    expect(html).toContain("data-field=\"photo-color\"");
    expect(html).toContain("data-field=\"photo-stroke\"");
    expect(html).toContain("data-field=\"photo-font\"");
    expect(html).toContain("photo-pick-color");
  });
});

describe("Photo & Video Path Resolvers", () => {
  beforeEach(() => {
    state.photoWorkingPath = null;
    state.videoWorkingPath = null;
    state.mediaIndex = {};
    global.fetch = vi.fn();
  });

  it("getPhotoSourcePath returns working path when set", async () => {
    state.photoWorkingPath = "C:/tmp/working_photo.jpg";
    const path = await getPhotoSourcePath({ id: "s1" });
    expect(path).toBe("C:/tmp/working_photo.jpg");
  });

  it("getVideoSourcePath returns working path when set", async () => {
    state.videoWorkingPath = "C:/tmp/working_video.mp4";
    const path = await getVideoSourcePath({ id: "s1" });
    expect(path).toBe("C:/tmp/working_video.mp4");
  });

  it("resolves the file currently selected in a multi-file series", async () => {
    state.mediaIndex = { s1: 1 };
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({ images: ["D:/case/page_1.jpg", "D:/case/page_2.jpg"] })
    );

    await expect(getPhotoSourcePath({ id: "s1", sliceCount: 2 }))
      .resolves.toBe("D:/case/page_2.jpg");
    expect(state.photoWorkingPath).toBe(null);

    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({ images: ["D:/case/part_1.mp4", "D:/case/part_2.mp4"] })
    );
    await expect(getVideoSourcePath({ id: "s1", sliceCount: 2 }))
      .resolves.toBe("D:/case/part_2.mp4");
    expect(state.videoWorkingPath).toBe(null);
  });
});

function mockJsonResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe("Photo Studio Action Handlers", () => {
  beforeEach(() => {
    state.archive = {
      series: [{ id: "series_photo_1", name: "gpb.jpg", mediaType: "photo", patientName: "BN 01" }],
    };
    state.selectedId = "series_photo_1";
    state.photoWorkingPath = "D:/storage/photo_01.jpg";
    state.mediaIndex = {};
    state.mediaEdits = {};
    state.photoLayers = {};
    state.photoTool = "select";
    state.photoStyle = defaultStyle();
    document.body.innerHTML = `
      <div id="app">
        <div id="workspace"></div>
        <img id="photo-editor-img" src="/placeholder.jpg" />
      </div>
    `;
  });

  it("photo-rotate-cw rotates and re-fetches the result through the token", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/api/media/work-file")) {
        return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob([1]) };
      }
      return mockJsonResponse({ outputPath: "D:/storage/rotated_01.jpg", url: "/api/media/work-file?name=rotated_01.jpg" });
    });
    global.fetch = fetchMock;
    global.URL.createObjectURL = vi.fn(() => "blob:rotated");

    await action("photo-rotate-cw");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/photo/rotate"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/photo_01.jpg", degrees: 90 }),
      })
    );
    expect(state.photoWorkingPath).toBe("D:/storage/rotated_01.jpg");
    // `<img src>` cannot send X-DCom-Token, so the result is fetched as a blob
    // and the element gets an object URL. Assigning the API URL gave a 401.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/work-file?name=rotated_01.jpg"),
      expect.objectContaining({ headers: expect.objectContaining({ "X-DCom-Token": expect.anything() }) })
    );
  });

  it("sends the whole drawing layer in one call instead of one call per shape", async () => {
    // Every shape used to be its own POST and its own JPEG re-encode: three
    // arrows meant three generations of lossy re-compression of the patient's
    // photo. The layer is flattened once.
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/drawn_01.jpg", url: "/api/media/work-file?name=drawn_01.jpg" })
    );
    global.fetch = fetchMock;
    const layer = photoLayer(selectedSeries());
    layer.shapes = [
      createShape("arrow", { x: 200, y: 160 }, defaultStyle()),
      createShape("text", { x: 40, y: 40 }, defaultStyle()),
    ];
    Object.assign(layer.shapes[0], { x2: 500, y2: 400 });
    layer.shapes[1].text = "Tổn thương";

    await action("photo-apply-shapes");

    const shapeCalls = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/api/media/photo/shapes"));
    expect(shapeCalls).toHaveLength(1);
    const body = JSON.parse(shapeCalls[0][1].body);
    expect(body.path).toBe("D:/storage/photo_01.jpg");
    expect(body.shapes).toHaveLength(2);
    // The engine is a set of snake_case dataclasses. Sending camelCase is what
    // made the old text tool raise TypeError on the server every single time.
    expect(body.shapes[0]).toMatchObject({ kind: "arrow", x1: 200, y1: 160, x2: 500, y2: 400 });
    expect(body.shapes[1]).toMatchObject({ kind: "text", text: "Tổn thương", font_size: 28 });
    expect(body.shapes[1].color).toEqual([255, 59, 48]);
    expect(state.photoWorkingPath).toBe("D:/storage/drawn_01.jpg");
    // The shapes are pixels now, so the layer must not still be holding them.
    expect(photoLayer(selectedSeries()).shapes).toHaveLength(0);
  });

  it("does not call the server when nothing has been drawn", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    photoLayer(selectedSeries()).shapes = [];

    await action("photo-apply-shapes");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops shapes too small to be deliberate rather than flattening them", async () => {
    // A click that never became a drag leaves a zero-size object; burning it in
    // would put an invisible mark on a clinical photo.
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const layer = photoLayer(selectedSeries());
    layer.shapes = [createShape("rect", { x: 10, y: 10 }, defaultStyle())];

    await action("photo-apply-shapes");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("burns the pending drawing in before rotating, so nothing lands askew", async () => {
    // Rotation moves every pixel. A shape held as coordinates across it would
    // point at whatever ended up in that corner afterwards.
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/api/media/work-file")) {
        return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob([1]) };
      }
      if (String(url).includes("/shapes")) {
        return mockJsonResponse({ outputPath: "D:/storage/drawn_01.jpg", url: "/api/media/work-file?name=drawn_01.jpg" });
      }
      return mockJsonResponse({ outputPath: "D:/storage/rotated_01.jpg", url: "/api/media/work-file?name=rotated_01.jpg" });
    });
    global.fetch = fetchMock;
    global.URL.createObjectURL = vi.fn(() => "blob:rotated");
    const layer = photoLayer(selectedSeries());
    const arrow = createShape("arrow", { x: 10, y: 10 }, defaultStyle());
    Object.assign(arrow, { x2: 200, y2: 200 });
    layer.shapes = [arrow];

    await action("photo-rotate-cw");

    const apiCalls = fetchMock.mock.calls.map(([url]) => String(url));
    const flattenAt = apiCalls.findIndex((url) => url.includes("/api/media/photo/shapes"));
    const rotateAt = apiCalls.findIndex((url) => url.includes("/api/media/photo/rotate"));
    expect(flattenAt).toBeGreaterThanOrEqual(0);
    expect(rotateAt).toBeGreaterThan(flattenAt);
    // Rotation works on the flattened file, not on the one under it.
    expect(JSON.parse(fetchMock.mock.calls[rotateAt][1].body))
      .toEqual({ path: "D:/storage/drawn_01.jpg", degrees: 90 });
  });

  it("keeps a drawing layer per file, so paging away does not lose it", async () => {
    state.archive.series[0].sliceCount = 3;
    const first = photoLayer(selectedSeries());
    first.shapes = [createShape("marker", { x: 5, y: 5 }, defaultStyle(), { label: 1 })];
    state.mediaIndex = { series_photo_1: 1 };
    expect(photoLayer(selectedSeries()).shapes).toHaveLength(0);
    state.mediaIndex = { series_photo_1: 0 };
    expect(photoLayer(selectedSeries()).shapes).toHaveLength(1);
  });
});

describe("Surgery Video Studio Action Handlers", () => {
  beforeEach(() => {
    state.archive = {
      series: [{ id: "series_video_1", name: "phau_thuat.mp4", mediaType: "video", patientName: "BN 02" }],
    };
    state.selectedId = "series_video_1";
    state.activeTabId = "tab_1";
    state.tabs = [{ id: "tab_1", title: "BN 02" }];
    state.videoWorkingPath = "D:/storage/surgery_01.mp4";
    state.mediaIndex = {};
    state.mediaEdits = {};
    state.isError = false;
    state.videoBookmarks = [];
    state.photoLayers = {};
    state.videoIn = null;
    state.videoOut = null;
    state.photoStyle = defaultStyle();
    document.body.innerHTML = `
      <div id="app">
        <div id="workspace"></div>
        <video id="surgery-video-player" src="/placeholder.mp4"></video>
      </div>
    `;
  });

  it("cuts the span marked on the timeline, not one typed into a prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/trimmed_01.mp4", url: "/api/media/work-file?name=trimmed_01.mp4" })
    );
    global.fetch = fetchMock;
    state.videoIn = 2.0;
    state.videoOut = 10.0;

    await action("video-tool-trim");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/trim"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/surgery_01.mp4", startSeconds: 2.0, endSeconds: 10.0, reencode: false }),
      })
    );
    expect(state.videoWorkingPath).toBe("D:/storage/trimmed_01.mp4");
    // The cut file starts at zero, so the old points name nothing any more.
    expect(state.videoIn).toBe(null);
    expect(state.videoOut).toBe(null);
  });

  it("refuses to cut before a span has been marked", async () => {
    // It used to open two prompt() boxes and ask a surgeon to read the clock
    // and type a decimal; with nothing marked there is simply nothing to cut.
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    state.videoIn = null;
    state.videoOut = null;

    await action("video-tool-trim");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks in and out points from the playhead and keeps them ordered", async () => {
    const player = document.querySelector("#surgery-video-player");
    Object.defineProperty(player, "currentTime", { value: 12.5, writable: true });
    state.videoIn = null;
    state.videoOut = null;

    await action("video-set-in");
    expect(state.videoIn).toBe(12.5);

    // An out point at or before the in point would leave an inverted range no
    // button could act on.
    player.currentTime = 4;
    await action("video-set-out");
    expect(state.videoOut).toBe(null);

    player.currentTime = 30;
    await action("video-set-out");
    expect(state.videoOut).toBe(30);

    await action("video-clear-range");
    expect(state.videoIn).toBe(null);
    expect(state.videoOut).toBe(null);
  });

  it("burns the drawn layer into the clip in one pass, gated to the marked span", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/drawn_01.mp4", url: "/api/media/work-file?name=drawn_01.mp4" })
    );
    global.fetch = fetchMock;
    state.videoIn = 3;
    state.videoOut = 8;
    const layer = photoLayer(selectedSeries());
    const arrow = createShape("arrow", { x: 40, y: 60 }, defaultStyle());
    Object.assign(arrow, { x2: 300, y2: 220 });
    layer.shapes = [arrow];

    await action("video-apply-shapes");

    const [, options] = fetchMock.mock.calls
      .find(([url]) => String(url).includes("/api/media/video/burn-overlay"));
    const body = JSON.parse(options.body);
    expect(body.shapes).toHaveLength(1);
    expect(body.shapes[0]).toMatchObject({ kind: "arrow", x1: 40, y1: 60, x2: 300, y2: 220 });
    expect(body).toMatchObject({ startSeconds: 3, endSeconds: 8 });
    expect(state.videoWorkingPath).toBe("D:/storage/drawn_01.mp4");
    expect(photoLayer(selectedSeries()).shapes).toHaveLength(0);
  });

  it("stamps the record's own identity, in the field names the engine has", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/burned_01.mp4", url: "/api/media/work-file?name=burned_01.mp4" })
    );
    global.fetch = fetchMock;

    await action("video-tool-burn-text");

    const [url, options] = fetchMock.mock.calls
      .find(([called]) => String(called).includes("/api/media/video/burn-text"));
    expect(url).toContain("/api/media/video/burn-text");
    const overlay = JSON.parse(options.body).overlays[0];
    // The patient's name comes from the record, never from something typed
    // into a prompt box that nothing validates.
    expect(overlay.text).toContain("BN 02");
    // video_engine.TextOverlay has `color`, not `font_color`. Sending the wrong
    // spelling made every stamp fail with a TypeError server-side.
    expect(overlay).toHaveProperty("color");
    expect(overlay).not.toHaveProperty("font_color");
    expect(state.videoWorkingPath).toBe("D:/storage/burned_01.mp4");
  });

  it("video-tool-filmstrip calls filmstrip API and populates videoFilmstrip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ frames: ["/work/f1.jpg", "/work/f2.jpg", "/work/f3.jpg"] })
    );
    global.fetch = fetchMock;

    await action("video-tool-filmstrip");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/filmstrip"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/surgery_01.mp4", count: 6, maxWidth: 160 }),
      })
    );
    expect(state.videoFilmstrip).toEqual(["/work/f1.jpg", "/work/f2.jpg", "/work/f3.jpg"]);
  });

  it("video-tool-transcode calls transcode API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/transcoded_01.mp4", url: "/api/media/work-file?name=transcoded_01.mp4" })
    );
    global.fetch = fetchMock;

    await action("video-tool-transcode");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/transcode"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/surgery_01.mp4", crf: 23, use_hw: true }),
      })
    );
    expect(state.videoWorkingPath).toBe("D:/storage/transcoded_01.mp4");
  });

  it("add-video-bookmark appends bookmark to state.videoBookmarks", async () => {
    window.prompt = vi.fn().mockReturnValue("Rạch da bộc lộ tổn thương");
    const video = document.querySelector("#surgery-video-player");
    Object.defineProperty(video, "currentTime", { value: 15.5, writable: true });

    await action("add-video-bookmark");

    expect(state.videoBookmarks.length).toBe(1);
    expect(state.videoBookmarks[0]).toEqual({ time: 15.5, text: "Rạch da bộc lộ tổn thương" });
  });

  it("video-tool-concat opens modal, allows reordering and selection, and start-concat-video calls concat API", async () => {
    state.archive.series.push({
      id: "series_video_2",
      name: "phau_thuat_part2.mp4",
      mediaType: "video",
      patientName: "BN 02",
      durationSeconds: 120,
    });
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/series_video_1/file-paths")) {
        return mockJsonResponse({ images: ["D:/storage/surgery_01.mp4"] });
      }
      if (String(url).includes("/series_video_2/file-paths")) {
        return mockJsonResponse({ images: ["D:/storage/surgery_02.mp4"] });
      }
      return mockJsonResponse({
        outputPath: "D:/storage/concatenated.mp4",
        url: "/api/media/work-file?name=concatenated.mp4",
      });
    });
    global.fetch = fetchMock;

    // 1. Open modal
    await action("video-tool-concat");
    expect(state.showConcatModal).toBe(true);
    expect(state.concatClips.length).toBe(2);
    expect(state.concatClips[0].path).toBe("D:/storage/surgery_01.mp4");
    expect(state.concatClips[1].path).toBe("D:/storage/surgery_02.mp4");

    // 2. Reorder clips (move clip 1 down -> swap with clip 2)
    await action("move-concat-clip-down", { dataset: { clipIdx: "0" } });
    expect(state.concatClips[0].seriesId).toBe("series_video_2");
    expect(state.concatClips[1].seriesId).toBe("series_video_1");

    // 3. Toggle clip selection
    await action("toggle-concat-clip", { dataset: { clipIdx: "1" } });
    expect(state.concatClips[1].selected).toBe(false);
    await action("toggle-concat-clip", { dataset: { clipIdx: "1" } });
    expect(state.concatClips[1].selected).toBe(true);

    // 4. Start concat with reordered clips
    await action("start-concat-video");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/concat"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sources: ["D:/storage/surgery_02.mp4", "D:/storage/surgery_01.mp4"],
          targetHeight: 1080,
          targetFps: 30,
        }),
      })
    );
    expect(state.showConcatModal).toBe(false);
    expect(state.videoWorkingPath).toBe("D:/storage/concatenated.mp4");
    expect(state.isError).toBe(false);
  });

  it("offers every clip in a folder, not one line for the whole folder", async () => {
    // Three recordings of one operation live in one folder, which the catalog
    // reports as a single series. Listing series gave the reader one line to
    // tick and handed FFmpeg only the first file.
    state.archive.series = [{
      id: "series_video_1",
      name: "video_mo",
      mediaType: "video",
      sliceCount: 3,
    }];
    global.fetch = vi.fn().mockImplementation(async (url) =>
      mockJsonResponse(String(url).includes("/file-paths")
        ? { images: ["D:/mo/part1.mp4", "D:/mo/part2.mp4", "D:/mo/part3.mp4"] }
        : { outputPath: "D:/mo/joined.mp4", url: "/api/media/work-file?name=joined.mp4" }));

    await action("video-tool-concat");

    expect(state.concatClips.length).toBe(3);
    expect(state.concatClips.map((clip) => clip.name))
      .toEqual(["part1.mp4", "part2.mp4", "part3.mp4"]);
    // No per-file duration exists, so none is invented for a multi-clip folder.
    expect(state.concatClips.every((clip) => clip.duration === 0)).toBe(true);

    await action("start-concat-video");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/concat"),
      expect.objectContaining({
        body: expect.stringContaining("part3.mp4"),
      })
    );
  });

  it("video-tool-thumb calls thumbnail API at current timestamp", async () => {
    const video = document.querySelector("#surgery-video-player");
    Object.defineProperty(video, "currentTime", { value: 25.0, writable: true });

    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/thumb_25s.jpg", url: "/api/media/work-file?name=thumb_25s.jpg" })
    );
    global.fetch = fetchMock;

    await action("video-tool-thumb");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/thumbnail"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/surgery_01.mp4", atSeconds: 25.0, maxWidth: 480 }),
      })
    );
  });

  it("seek-video and seek-filmstrip-idx set video currentTime", async () => {
    const video = document.querySelector("#surgery-video-player");
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    Object.defineProperty(video, "duration", { value: 100, writable: true });

    await action("seek-video", { dataset: { time: "42.5" } });
    expect(video.currentTime).toBe(42.5);

    await action("seek-filmstrip-idx", { dataset: { idx: "2", total: "4" } });
    expect(video.currentTime).toBe(50);
  });
});

describe("Text & JSON reading pane", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.textDoc = null;
    state.archive = { root: "D:\PACS", series: [] };
  });

  it("renders a reading frame with no editing tools on it", () => {
    const series = { id: "txt_01", name: "tuong_trinh.txt", sliceCount: 1, mediaType: "text" };
    const html = renderTextViewer(series);

    expect(html).toContain("text-viewer");
    expect(html).toContain("text-viewer-body");
    expect(html).toContain("tuong_trinh.txt");
    // A report is read, not edited: none of the studio tools belong here.
    expect(html).not.toContain("photo-tool");
    expect(html).not.toContain("video-tool");
  });

  it("hides file navigation for a single file and shows it for several", () => {
    const one = renderTextViewer({ id: "t1", name: "a.txt", sliceCount: 1, mediaType: "text" });
    expect(one).not.toContain("text-viewer-nav");

    state.textDoc = { seriesId: "t2", index: 0, name: "a.txt", language: "text", text: "x" };
    const many = renderTextViewer({ id: "t2", name: "a.txt", sliceCount: 3, mediaType: "text" });
    expect(many).toContain("text-viewer-nav");
    expect(many).toContain("1/3");
    // At the first file there is nothing before it.
    expect(many).toMatch(/data-action="text-prev"[^>]*disabled/);
  });

  it("marks a JSON document and escapes the content it shows", () => {
    state.textDoc = {
      seriesId: "t3",
      index: 0,
      name: "index.json",
      language: "json",
      text: '{"note": "<script>alert(1)</script>"}',
    };
    const html = renderTextViewer({ id: "t3", name: "index.json", sliceCount: 1, mediaType: "text" });

    expect(html).toContain("text-viewer-badge");
    expect(html).toContain("JSON");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows the failure in the pane when the file cannot be read", async () => {
    const series = { id: "t4", name: "hong.txt", sliceCount: 1, mediaType: "text" };
    global.fetch = vi.fn().mockRejectedValue(new Error("File nặng quá giới hạn"));

    await loadTextContent(series, 0);

    expect(state.textDoc.seriesId).toBe("t4");
    expect(state.textDoc.text).toContain("File nặng quá giới hạn");
  });

  it("sends each media type to its own pane", () => {
    expect(renderWorkspacePane({ id: "a", mediaType: "text", name: "a.txt", sliceCount: 1 }))
      .toContain("text-viewer");
    expect(renderWorkspacePane({ id: "b", mediaType: "video" })).toContain("surgery-video-studio");
    expect(renderWorkspacePane({ id: "c", mediaType: "photo" })).toContain("photo-editor-studio");
    expect(renderWorkspacePane({ id: "d", mediaType: "doc" })).toContain("photo-editor-studio");
  });

  it("offers exactly one open button when nothing is loaded", () => {
    const html = renderWorkspacePane(null);
    expect((html.match(/data-action="choose-archive"/g) || []).length).toBe(1);
    expect(html).not.toContain("choose-file");
  });
});
