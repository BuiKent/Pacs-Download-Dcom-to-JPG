// @vitest-environment jsdom

// How media reaches the screen, as opposed to what the editor does to it.
// Every /api route wants the `X-DCom-Token` header, and an element that owns
// its own `src` cannot send one — that gap silently broke the photo pane, both
// export buttons and the video player in different ways.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { configureApi, mediaAuthUrl, setApiSession } from "./api.js";
import { setLanguage } from "./i18n.js";
import { state, action, renderSurgeryVideoStudio } from "./main.js";

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
    const html = renderSurgeryVideoStudio(series);
    expect(html).toContain(`token=${TOKEN}`);
    expect(html).not.toContain("data-media-src");
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
