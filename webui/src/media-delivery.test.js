// @vitest-environment jsdom

// How media reaches the screen, as opposed to what the editor does to it.
// Every /api route wants the `X-DCom-Token` header, and an element that owns
// its own `src` cannot send one — that gap silently broke the photo pane, both
// export buttons and the video player in different ways.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { configureApi, mediaAuthUrl, setApiSession } from "./api.js";
import { setLanguage } from "./i18n.js";
import {
  state,
  action,
  canRedoMediaEdit,
  canUndoMediaEdit,
  editHistoryFor,
  renderPhotoEditorStudio,
  renderSurgeryVideoStudio,
  restoreMediaWorkspaceFromTab,
  saveMediaWorkspaceToTab,
} from "./main.js";

const TOKEN = "test-token-123";

function jsonResponse(data) {
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

function blobResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "image/jpeg" },
    blob: async () => new Blob(["x"], { type: "image/jpeg" }),
  };
}

describe("Authenticated media delivery", () => {
  beforeEach(() => {
    setLanguage("vi");
    configureApi(TOKEN);
    setApiSession("session-abc");
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
    state.mediaIndex = {};
    state.mediaEdits = {};
  });

  it("moves the token into the query for elements that fetch their own source", () => {
    const url = mediaAuthUrl("/api/series/abc/image/0");
    expect(url).toContain(`token=${TOKEN}`);
    expect(url).toContain("session=session-abc");
    // A path that already carries a parameter keeps it.
    expect(mediaAuthUrl("/api/media/work-file?name=clip.mp4"))
      .toMatch(/name=clip\.mp4&token=/);
  });

  it("lets the video element stream rather than buffering the clip as a blob", () => {
    // A recording of a whole operation held in memory delays the first frame
    // until the last byte and makes seeking impossible.
    const series = { id: "series_video_1", name: "phau_thuat.mp4", mediaType: "video" };
    state.videoWorkingPath = null;
    state.videoFilmstrip = ["D:/tmp/frame_01.jpg"];
    const html = renderSurgeryVideoStudio(series);
    expect(html).toContain(`token=${TOKEN}`);
    expect(html).not.toContain("data-media-src");
    expect(html).toMatch(/work-file\?name=frame_01\.jpg&amp;token=/);
  });

  it("fetches an exported PDF with the token instead of navigating to it", async () => {
    // `<a download href="/api/...">` sends no header, so the export answered
    // 401 and saved nothing. jsdom never performs the navigation, which is
    // why this went unnoticed.
    state.archive = {
      root: "D:/kho",
      series: [{ id: "series_photo_1", name: "gpb.jpg", mediaType: "photo" }],
    };
    state.selectedId = "series_photo_1";
    state.photoWorkingPath = "D:/storage/photo_01.jpg";
    document.body.innerHTML = `<div id="app"><div id="workspace"></div></div>`;

    const fetchMock = vi.fn().mockImplementation(async (url, options) => {
      if (String(url).includes("/api/media/work-file")) {
        expect(options.headers["X-DCom-Token"]).toBe(TOKEN);
        return blobResponse();
      }
      return jsonResponse({
        outputPath: "D:/storage/ho_so.pdf",
        url: "/api/media/work-file?name=ho_so.pdf",
      });
    });
    global.fetch = fetchMock;

    await action("photo-export-pdf");

    const fetched = fetchMock.mock.calls.map(([url]) => String(url));
    expect(fetched.some((url) => url.includes("/api/media/work-file"))).toBe(true);
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  it("fetches an exported video thumbnail with the token", async () => {
    state.archive = {
      root: "D:/kho",
      series: [{ id: "series_video_1", name: "phau_thuat.mp4", mediaType: "video" }],
    };
    state.selectedId = "series_video_1";
    state.videoWorkingPath = "D:/storage/surgery_01.mp4";
    document.body.innerHTML = `
      <div id="app">
        <div id="workspace"></div>
        <video id="surgery-video-player"></video>
      </div>`;

    const fetchMock = vi.fn().mockImplementation(async (url, options) => {
      if (String(url).includes("/api/media/work-file")) {
        expect(options.headers["X-DCom-Token"]).toBe(TOKEN);
        return blobResponse();
      }
      return jsonResponse({
        outputPath: "D:/storage/thumb.jpg",
        url: "/api/media/work-file?name=thumb.jpg",
      });
    });
    global.fetch = fetchMock;

    await action("video-tool-thumb");

    const fetched = fetchMock.mock.calls.map(([url]) => String(url));
    expect(fetched.some((url) => url.includes("/api/media/work-file"))).toBe(true);
  });

  it("steps back through the edits made to a record and forward again", async () => {
    // Every tool writes a new scratch file and leaves the previous one, so a
    // reader who crops too tightly can walk back instead of reopening the
    // record. Cursor -1 is the untouched file in the archive.
    const series = { id: "series_photo_1", name: "gpb.jpg", mediaType: "photo", sliceCount: 2 };
    state.archive = { root: "D:/kho", series: [series] };
    state.selectedId = "series_photo_1";
    state.photoWorkingPath = null;
    state.mediaEdits = {};
    state.photoLayers = {};
    document.body.innerHTML = `<div id="app"><div id="workspace"></div></div>`;

    let step = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/file-paths")) {
        return jsonResponse({ images: ["D:/kho/gpb.jpg"] });
      }
      step += 1;
      return jsonResponse({
        outputPath: `D:/tmp/edit_${step}.jpg`,
        url: `/api/media/work-file?name=edit_${step}.jpg`,
      });
    });

    await action("photo-rotate-cw");
    await action("photo-rotate-ccw");
    expect(state.photoWorkingPath).toBe("D:/tmp/edit_2.jpg");
    expect(canUndoMediaEdit(series)).toBe(true);
    expect(canRedoMediaEdit(series)).toBe(false);

    await action("media-edit-undo");
    expect(state.photoWorkingPath).toBe("D:/tmp/edit_1.jpg");
    expect(canRedoMediaEdit(series)).toBe(true);

    await action("media-edit-undo");
    expect(state.photoWorkingPath).toBe(null);
    expect(canUndoMediaEdit(series)).toBe(false);

    // Nothing further back than the original exists.
    await action("media-edit-undo");
    expect(state.photoWorkingPath).toBe(null);

    await action("media-edit-redo");
    expect(state.photoWorkingPath).toBe("D:/tmp/edit_1.jpg");

    // Editing after stepping back drops the branch that was undone.
    await action("photo-rotate-cw");
    expect(state.photoWorkingPath).toBe("D:/tmp/edit_3.jpg");
    expect(editHistoryFor(series.id).steps.length).toBe(2);
    expect(canRedoMediaEdit(series)).toBe(false);

    // Page 2 has an independent history; returning to page 1 restores its
    // derivative instead of editing or saving the wrong source file.
    await action("media-file-next");
    expect(state.photoWorkingPath).toBe(null);
    expect(canUndoMediaEdit(series)).toBe(false);
    await action("media-file-prev");
    expect(state.photoWorkingPath).toBe("D:/tmp/edit_3.jpg");
    expect(canUndoMediaEdit(series)).toBe(true);
  });

  it("asks for the edit it is showing, so a re-render does not drop it", () => {
    // The pane used to be repainted only by assigning src after each tool, so
    // any later render quietly put the untouched file back on screen while the
    // toolbar still claimed there was an edit to save.
    const series = { id: "series_photo_1", name: "gpb.jpg", mediaType: "photo" };
    state.archive = { root: "D:/kho", series: [series] };
    state.selectedId = "series_photo_1";

    state.photoWorkingPath = null;
    expect(renderPhotoEditorStudio(series)).toContain('data-media-src="series_photo_1:0"');

    state.photoWorkingPath = "C:\\Temp\\concord_media_work\\edit_7.jpg";
    expect(renderPhotoEditorStudio(series)).toContain('data-media-src="work:edit_7.jpg"');
  });

  it("keeps media editing state isolated when switching patient tabs", () => {
    state.mediaIndex = { series_a: 2 };
    state.mediaEdits = { "series_a:2": { steps: [{ path: "D:/tmp/a.jpg" }], cursor: 0 } };
    state.photoWorkingPath = "D:/tmp/a.jpg";
    state.videoWorkingPath = null;
    const tabA = {};
    saveMediaWorkspaceToTab(tabA);

    state.mediaIndex = { series_b: 0 };
    state.mediaEdits = {};
    state.photoWorkingPath = null;
    state.videoWorkingPath = "D:/tmp/b.mp4";
    const tabB = {};
    saveMediaWorkspaceToTab(tabB);

    restoreMediaWorkspaceFromTab(tabA);
    expect(state.mediaIndex).toEqual({ series_a: 2 });
    expect(state.photoWorkingPath).toBe("D:/tmp/a.jpg");
    expect(state.videoWorkingPath).toBe(null);

    restoreMediaWorkspaceFromTab(tabB);
    expect(state.mediaIndex).toEqual({ series_b: 0 });
    expect(state.photoWorkingPath).toBe(null);
    expect(state.videoWorkingPath).toBe("D:/tmp/b.mp4");
  });

  it("names a saved edit after the page that was on screen", async () => {
    // The editor works on one page of a multi-file record; the backend needs
    // to be told which, or every edit is filed under the first file's name.
    state.archive = {
      root: "D:/kho",
      series: [{ id: "series_photo_1", name: "anh_trong_mo", mediaType: "photo", sliceCount: 4 }],
    };
    state.selectedId = "series_photo_1";
    state.photoWorkingPath = "D:/tmp/edit.jpg";
    state.mediaIndex = { series_photo_1: 2 };

    const fetchMock = vi.fn().mockImplementation(async (url) =>
      jsonResponse(String(url).includes("/api/media/save")
        ? { name: "mo_03_edit_20260818-120000.jpg" }
        : { root: "D:/kho", series: [] }));
    global.fetch = fetchMock;

    await action("photo-save-edit");

    const save = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/media/save"));
    expect(JSON.parse(save[1].body).mediaIndex).toBe(2);
  });
});
