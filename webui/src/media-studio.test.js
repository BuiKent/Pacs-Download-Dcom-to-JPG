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
} from "./main.js";

describe("Media Studio Detection & Layouts", () => {
  beforeEach(() => {
    setLanguage("vi");
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

  it("renders photo editor studio layout with all tools", () => {
    const series = { id: "photo_01", patientName: "Tran Van B", mediaType: "photo" };
    const html = renderPhotoEditorStudio(series);
    expect(html).toContain("photo-editor-studio");
    expect(html).toContain("photo-rotate-cw");
    expect(html).toContain("photo-tool-crop");
    expect(html).toContain("photo-tool-redact");
    expect(html).toContain("photo-tool-arrow");
    expect(html).toContain("photo-tool-box");
    expect(html).toContain("photo-tool-text");
    expect(html).toContain("photo-export-pdf");
  });
});

describe("Photo & Video Path Resolvers", () => {
  beforeEach(() => {
    state.photoWorkingPath = null;
    state.videoWorkingPath = null;
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
    state.photoSelection = null;
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

  it("photo-tool-crop crops the region the reader dragged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/cropped_01.jpg", url: "/api/media/work-file?name=cropped_01.jpg" })
    );
    global.fetch = fetchMock;
    state.photoSelection = { x: 120, y: 90, width: 300, height: 240 };

    await action("photo-tool-crop");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/photo/crop"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/photo_01.jpg", rect: state.photoSelection }),
      })
    );
    expect(state.photoWorkingPath).toBe("D:/storage/cropped_01.jpg");
  });

  it("refuses to act on a made-up region when nothing is selected", async () => {
    // The old code cropped a fixed 5% off each edge and always redacted the
    // top-left corner, so the result had no relation to what was meant.
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    state.photoSelection = null;

    for (const tool of ["photo-tool-crop", "photo-tool-redact", "photo-tool-box", "photo-tool-arrow"]) {
      await action(tool);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("photo-tool-redact covers exactly the selected region", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/redacted_01.jpg", url: "/api/media/work-file?name=redacted_01.jpg" })
    );
    global.fetch = fetchMock;
    state.photoSelection = { x: 8, y: 12, width: 260, height: 44 };

    await action("photo-tool-redact");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/photo/redact"),
      expect.objectContaining({
        body: JSON.stringify({
          path: "D:/storage/photo_01.jpg",
          regions: [state.photoSelection],
          fill: [0, 0, 0],
        }),
      })
    );
    expect(state.photoWorkingPath).toBe("D:/storage/redacted_01.jpg");
  });

  it("photo-tool-arrow, photo-tool-box, photo-tool-text call annotate API", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/info")) {
        return mockJsonResponse({ info: { width: 1000, height: 800 } });
      }
      return mockJsonResponse({ outputPath: "D:/storage/annotated_01.jpg", url: "/api/media/work-file?name=annotated_01.jpg" });
    });
    global.fetch = fetchMock;
    state.photoSelection = { x: 200, y: 160, width: 300, height: 240 };

    window.prompt = vi.fn().mockReturnValue("Ghi chú thử nghiệm");

    await action("photo-tool-arrow");
    // The arrow spans the drag: it points from where the reader started to
    // where they released.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/photo/annotate"),
      expect.objectContaining({
        body: JSON.stringify({
          path: "D:/storage/photo_01.jpg",
          arrows: [{ x1: 200, y1: 160, x2: 500, y2: 400, color: [255, 70, 70] }],
          texts: [],
          boxes: [],
        }),
      })
    );

    await action("photo-tool-box");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/photo/annotate"),
      expect.objectContaining({ method: "POST" })
    );

    await action("photo-tool-text");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/photo/annotate"),
      expect.objectContaining({ method: "POST" })
    );
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
    state.videoBookmarks = [];
    document.body.innerHTML = `
      <div id="app">
        <div id="workspace"></div>
        <video id="surgery-video-player" src="/placeholder.mp4"></video>
      </div>
    `;
  });

  it("video-tool-trim calls trim API and updates video player src", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/trimmed_01.mp4", url: "/api/media/work-file?name=trimmed_01.mp4" })
    );
    global.fetch = fetchMock;

    window.prompt = vi.fn()
      .mockReturnValueOnce("2.0")  // start
      .mockReturnValueOnce("10.0"); // end

    await action("video-tool-trim");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/trim"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "D:/storage/surgery_01.mp4", startSeconds: 2.0, endSeconds: 10.0, reencode: false }),
      })
    );
    expect(state.videoWorkingPath).toBe("D:/storage/trimmed_01.mp4");
  });

  it("video-tool-burn-text calls burn-text API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ outputPath: "D:/storage/burned_01.mp4", url: "/api/media/work-file?name=burned_01.mp4" })
    );
    global.fetch = fetchMock;

    window.prompt = vi.fn().mockReturnValue("Bệnh nhân: BN 02 - Mô tả phẫu thuật");

    await action("video-tool-burn-text");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/video/burn-text"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Bệnh nhân: BN 02 - Mô tả phẫu thuật"),
      })
    );
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

    // 1. Open modal
    await action("video-tool-concat");
    expect(state.showConcatModal).toBe(true);
    expect(state.concatClips.length).toBe(2);
    expect(state.concatClips[0].seriesId).toBe("series_video_1");
    expect(state.concatClips[1].seriesId).toBe("series_video_2");

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
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/series_video_2/file-paths") || String(url).includes("/file-paths")) {
        return mockJsonResponse({ images: ["D:/storage/surgery_02.mp4"] });
      }
      return mockJsonResponse({ outputPath: "D:/storage/concatenated.mp4", url: "/api/media/work-file?name=concatenated.mp4" });
    });
    global.fetch = fetchMock;

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
