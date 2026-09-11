// @vitest-environment jsdom

/**
 * Two records opened in a row each get their own tab, and keep it.
 *
 * Scanning a large study takes seconds. No tab appeared during that time, so a
 * reader who grew tired of waiting clicked the next record — and whichever
 * scan finished first landed in whatever tab happened to be active when it
 * arrived. Opening a 1400-slice study and then a small one meant the small one
 * opened first and was then silently overwritten by the big one: the record in
 * front of the reader was replaced by a different patient, and the slices it
 * was still loading started 404ing, because the one shared API session had
 * moved to the other catalog.
 *
 * The tab is now created by the click, not by the response, and each response
 * fills its own tab by id.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { getApiSession } from "./api.js";
import { setLanguage } from "./i18n.js";
import {
  state,
  bindWorklistOpenButtons,
  renderWorklistTreeInner,
  renderWinbar,
  fillTabWithArchive,
  newViewerTab,
} from "./main.js";

function jsonResponse(payload) {
  return {
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => payload,
  };
}

const BIG_FOLDER = "D:\\PACS\\Kho\\BN-0001_CA LON";
const SMALL_FOLDER = "D:\\PACS\\Kho\\BN-0002_CA NHO";

function patient(id, patientId, name, folder) {
  return {
    id,
    patientId,
    patientName: name,
    gender: "",
    birthYear: "",
    hospital: "",
    folder,
    totalSizeFormatted: "1,0 GB",
    mediaSummary: { dicom: 1, photo: 0, video: 0, doc: 0 },
    studies: [
      {
        id: `${id}-s1`,
        studyDate: "06/08/2026",
        studyDateSort: "20260806",
        studyName: "MR sọ não",
        modality: "MR",
        seriesCount: 1,
        sliceCount: 10,
        folder,
        status: "done",
        statusLabel: "Đã tải",
        mediaCounts: { dicom: 1, photo: 0, video: 0, doc: 0 },
        primaryMediaType: "dicom",
      },
    ],
  };
}

/** An archive shaped the way `/api/sessions/create` returns one. */
function archiveFor(root, patientId, patientName, seriesId) {
  return {
    root,
    patient: { patientId, patientName },
    series: [
      {
        id: seriesId,
        name: "MR sọ não",
        description: "MR sọ não",
        modality: "MR",
        mediaType: "dicom",
        sourceType: "dicom",
        sliceCount: 10,
        studyDate: "20260806",
      },
    ],
  };
}

/**
 * Hold every `/api/sessions/create` open so the test decides which scan
 * finishes first. Everything else answers straight away.
 */
function deferredBackend() {
  const opens = [];
  const seen = [];
  global.fetch = vi.fn((url, options = {}) => {
    const path = String(url);
    const headers = options.headers || {};
    seen.push({ path, session: headers["X-Viewer-Session"] ?? "" });
    if (path.includes("/api/sessions/create")) {
      const body = JSON.parse(options.body || "{}");
      let settle;
      const promise = new Promise((resolve) => { settle = resolve; });
      opens.push({
        folder: body.path,
        finish: (payload) => settle(jsonResponse(payload)),
      });
      return promise;
    }
    if (path.includes("/api/history")) return Promise.resolve(jsonResponse({ history: [] }));
    return Promise.resolve(jsonResponse({}));
  });
  return { opens, seen };
}

/** Put the real worklist tree on screen and wire the buttons the app wires. */
function mountWorklist() {
  document.body.innerHTML = `<div id="app"><div class="worklist-tree">${renderWorklistTreeInner()}</div></div>`;
  const host = document.querySelector("#app");
  bindWorklistOpenButtons(host);
  return host;
}

/** Let the microtasks a resolved fetch queues actually run. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  setLanguage("vi");
  state.tabs = [];
  state.activeTabId = "worklist";
  state.archive = { root: "", series: [] };
  state.selectedId = "";
  state.worklistLoaded = true;
  state.worklistLoading = false;
  state.worklistPatients = [
    patient("p1", "BN-0001", "NGUYỄN VĂN A", BIG_FOLDER),
    patient("p2", "BN-0002", "TRẦN THỊ B", SMALL_FOLDER),
  ];
  state.worklistSearch = "";
  state.worklistModality = "";
  state.worklistRead = "all";
  state.worklistPeriod = "all";
});

describe("mở hai ca liên tiếp", () => {
  it("mỗi lần bấm mở một tab riêng ngay, không phải chờ quét xong", async () => {
    const { opens } = deferredBackend();
    const host = mountWorklist();
    const buttons = host.querySelectorAll("[data-action='open-patient-record']");
    expect(buttons.length).toBe(2);

    buttons[0].click();
    await settle();
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].loading).toBe(true);

    buttons[1].click();
    await settle();

    // Both records are open and being scanned at once. Neither is waiting for
    // the other: two sessions are in flight.
    expect(state.tabs.length).toBe(2);
    expect(opens.map((item) => item.folder)).toEqual([BIG_FOLDER, SMALL_FOLDER]);
    expect(state.tabs.every((tab) => tab.loading)).toBe(true);

    // A tab that has not loaded still says so on the strip rather than
    // claiming a format or a modality it cannot know yet.
    const strip = renderWinbar();
    expect(strip).toContain("Đang mở…");
    expect(strip).not.toContain("MR · JPG");
  });

  it("ca quét xong sau không ghi đè lên tab của ca mở sau", async () => {
    const { opens } = deferredBackend();
    const host = mountWorklist();
    const buttons = host.querySelectorAll("[data-action='open-patient-record']");

    buttons[0].click();
    await settle();
    buttons[1].click();
    await settle();
    const [bigTabId, smallTabId] = state.tabs.map((tab) => tab.id);
    expect(state.activeTabId).toBe(smallTabId);

    // The small record wins the race, as it does on a real archive.
    opens[1].finish({
      sessionId: "sid-small",
      archive: archiveFor(SMALL_FOLDER, "BN-0002", "TRẦN THỊ B", "small-1"),
    });
    await settle();

    // The big one lands seconds later, while the reader is in the small one.
    opens[0].finish({
      sessionId: "sid-big",
      archive: archiveFor(BIG_FOLDER, "BN-0001", "NGUYỄN VĂN A", "big-1"),
    });
    await settle();

    expect(state.tabs.length).toBe(2);
    const bigTab = state.tabs.find((tab) => tab.id === bigTabId);
    const smallTab = state.tabs.find((tab) => tab.id === smallTabId);

    // Each record is in its own tab, holding its own catalog and session.
    expect(bigTab.patientId).toBe("BN-0001");
    expect(bigTab.sessionId).toBe("sid-big");
    expect(bigTab.archive.series[0].id).toBe("big-1");
    expect(smallTab.patientId).toBe("BN-0002");
    expect(smallTab.sessionId).toBe("sid-small");
    expect(smallTab.archive.series[0].id).toBe("small-1");

    // The reader never left the record they were looking at.
    expect(state.activeTabId).toBe(smallTabId);
    expect(state.archive.series[0].id).toBe("small-1");
  });

  it("phiên gửi kèm mỗi request vẫn là phiên của tab đang xem", async () => {
    const { opens, seen } = deferredBackend();
    const host = mountWorklist();
    const buttons = host.querySelectorAll("[data-action='open-patient-record']");

    buttons[0].click();
    await settle();
    buttons[1].click();
    await settle();

    opens[1].finish({
      sessionId: "sid-small",
      archive: archiveFor(SMALL_FOLDER, "BN-0002", "TRẦN THỊ B", "small-1"),
    });
    await settle();
    expect(getApiSession()).toBe("sid-small");

    seen.length = 0;
    opens[0].finish({
      sessionId: "sid-big",
      archive: archiveFor(BIG_FOLDER, "BN-0001", "NGUYỄN VĂN A", "big-1"),
    });
    await settle();

    // The late record must not move the session out from under the slices the
    // open record is still fetching. That swap is what returned 404 and
    // "Không tìm thấy series" mid-read.
    expect(getApiSession()).toBe("sid-small");
    expect(seen.every((call) => call.session === "" || call.session === "sid-small")).toBe(true);
  });

  it("bấm hai lần vào cùng một ca chỉ mở một tab và một phiên", async () => {
    const { opens } = deferredBackend();
    const host = mountWorklist();
    const button = host.querySelectorAll("[data-action='open-patient-record']")[0];

    button.click();
    await settle();
    button.click();
    await settle();

    // The tab exists from the first click, so the second click finds it and
    // focuses it instead of opening a second catalog on the same folder.
    expect(state.tabs.length).toBe(1);
    expect(opens.length).toBe(1);
  });
});

describe("hồ sơ tải xong ở nền", () => {
  it("không cướp tab bác sĩ đang đọc", async () => {
    deferredBackend();
    // The reader is in one record.
    const reading = newViewerTab({
      folder: SMALL_FOLDER,
      patientId: "BN-0002",
      patientName: "TRẦN THỊ B",
      sessionId: "sid-small",
    });
    state.tabs = [reading];
    state.activeTabId = reading.id;
    fillTabWithArchive(
      reading.id,
      archiveFor(SMALL_FOLDER, "BN-0002", "TRẦN THỊ B", "small-1"),
      "sid-small",
      SMALL_FOLDER,
    );
    await settle();
    expect(getApiSession()).toBe("sid-small");

    // A download finishes for a different patient and takes a tab of its own.
    const landed = newViewerTab({ folder: BIG_FOLDER });
    state.tabs.push(landed);
    fillTabWithArchive(
      landed.id,
      archiveFor(BIG_FOLDER, "BN-0001", "NGUYỄN VĂN A", "big-1"),
      "sid-big",
      BIG_FOLDER,
    );
    await settle();

    expect(state.activeTabId).toBe(reading.id);
    expect(state.archive.series[0].id).toBe("small-1");
    expect(getApiSession()).toBe("sid-small");
    expect(state.tabs.find((tab) => tab.id === landed.id).patientId).toBe("BN-0001");
  });
});
