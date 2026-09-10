// @vitest-environment jsdom

/**
 * Opening the app puts a usable study list on screen straight away.
 *
 * The scan walks every study folder in the archive, which on a full one takes
 * seconds. It used to run in front of the reader: an empty tree with "Đang tải
 * danh sách bệnh nhân…" until the disk was done. Now the last completed scan is
 * served from cache and the fresh one runs behind it, saying nothing — and a
 * study filed while the app is open, by a download here or by the extension,
 * arrives on its own.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  refreshWorklist,
  renderWorklistTreeInner,
  worklistSyncLabel,
} from "./main.js";

function jsonResponse(payload) {
  return {
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => payload,
  };
}

/** Answer `/api/worklist` and `/api/worklist/revision` the way the app does. */
function mockBackend({ patients = [], scannedAt = "", revision = "rev-1" } = {}) {
  const seenLoadingStates = [];
  const fetchMock = vi.fn(async (url) => {
    seenLoadingStates.push({ url, loading: state.worklistLoading });
    if (String(url).includes("/revision")) return jsonResponse({ revision });
    // The scan reports the token it started from, alongside the rows.
    return jsonResponse({ patients, scannedAt, revision });
  });
  global.fetch = fetchMock;
  return { fetchMock, seenLoadingStates };
}

const CACHED_PATIENT = {
  id: "p1",
  patientId: "TEST-0001",
  patientName: "NGUYỄN VĂN MẪU",
  gender: "Nam",
  birthYear: "1974",
  hospital: "BV A",
  folder: "D:\\PACS\\Kho\\TEST-0001",
  totalSizeFormatted: "1,2 GB",
  mediaSummary: { dicom: 12, photo: 0, video: 0, doc: 0 },
  studies: [
    {
      id: "s1",
      studyDate: "06/08/2026",
      studyDateSort: "20260806",
      studyName: "MR sọ não",
      modality: "MR",
      seriesCount: 3,
      sliceCount: 120,
      folder: "D:\\PACS\\Kho\\TEST-0001\\06-08-2026 - MR - MR so nao",
      status: "done",
      statusLabel: "Đã tải",
      mediaCounts: { dicom: 120, photo: 0, video: 0, doc: 0 },
      primaryMediaType: "dicom",
      sizeBytes: 1024,
    },
  ],
};

beforeEach(() => {
  setLanguage("vi");
  state.activeTabId = "worklist";
  state.worklistTab = "studies";
  state.worklistSearch = "";
  state.worklistPatients = [];
  state.worklistLoaded = false;
  state.worklistLoading = false;
  state.worklistError = "";
  state.worklistScannedAt = "";
  state.worklistRevision = "";
  state.worklistModality = "";
  state.worklistPeriod = "all";
  state.worklistRead = "all";
  state.history = [];
});

describe("the study list is usable before the disk is read", () => {
  it("shows cached rows instead of a loading placeholder", () => {
    // What bootstrap hands over when a previous session left a cache.
    state.worklistPatients = [CACHED_PATIENT];
    state.worklistLoaded = true;
    state.worklistLoading = false;

    const html = renderWorklistTreeInner();

    expect(html).not.toContain("Đang tải danh sách bệnh nhân");
    expect(html).toContain("NGUYỄN VĂN MẪU");
  });

  it("still shows the loading state on a first run with nothing cached", () => {
    state.worklistPatients = [];
    state.worklistLoaded = false;
    state.worklistLoading = true;

    expect(renderWorklistTreeInner()).toContain("Đang tải danh sách bệnh nhân");
  });

  it("a silent refresh never raises the loading state", async () => {
    // The reader is reading the list. Blanking it out to announce a refresh is
    // worse than a few seconds of slightly stale rows.
    state.worklistPatients = [CACHED_PATIENT];
    state.worklistLoaded = true;
    const { seenLoadingStates } = mockBackend({ patients: [CACHED_PATIENT] });

    await refreshWorklist({ repaint: false, silent: true });

    expect(seenLoadingStates.every((call) => call.loading === false)).toBe(true);
    expect(state.worklistLoading).toBe(false);
  });

  it("an explicit rescan does raise it, so the button and the line respond", async () => {
    const { seenLoadingStates } = mockBackend({ patients: [CACHED_PATIENT] });

    await refreshWorklist({ repaint: false });

    const scanCall = seenLoadingStates.find((call) => !String(call.url).includes("/revision"));
    expect(scanCall.loading).toBe(true);
    expect(state.worklistLoading).toBe(false);
  });

  it("two refreshes at once do not both walk the disk", async () => {
    // The watch timer and a finished download can land together.
    const { fetchMock } = mockBackend({ patients: [CACHED_PATIENT] });

    await Promise.all([
      refreshWorklist({ repaint: false, silent: true }),
      refreshWorklist({ repaint: false, silent: true }),
    ]);

    const scans = fetchMock.mock.calls.filter(([url]) => !String(url).includes("/revision"));
    expect(scans).toHaveLength(1);
  });
});

describe("the sync line says what the rows actually are", () => {
  it("reports the time a cached list was read rather than claiming it is current", () => {
    // The reader checks this line to decide whether a study they just
    // downloaded should already be here. A stale list claiming to be up to date
    // sends them hunting a bug that is not there.
    state.worklistScannedAt = "2026-09-10T08:35:00+07:00";

    expect(worklistSyncLabel()).toBe("Danh sách lúc 08:35");
  });

  it("says it is loading only while an explicit rescan runs", () => {
    state.worklistLoading = true;
    expect(worklistSyncLabel()).toBe("Đang tải danh sách bệnh nhân…");
  });

  it("reports a failed scan", () => {
    state.worklistError = "ổ đĩa không đọc được";
    expect(worklistSyncLabel()).toBe("Không đồng bộ được danh sách");
  });

  it("falls back to the plain label when there is no timestamp", () => {
    state.worklistScannedAt = "";
    expect(worklistSyncLabel()).toBe("Danh sách đã cập nhật");
  });

  it("ignores a timestamp it cannot read", () => {
    state.worklistScannedAt = "không phải ngày";
    expect(worklistSyncLabel()).toBe("Danh sách đã cập nhật");
  });
});

describe("a scan records what it read and when", () => {
  it("keeps the timestamp and revision the backend reported", async () => {
    mockBackend({
      patients: [CACHED_PATIENT],
      scannedAt: "2026-09-10T09:00:00+07:00",
      revision: "rev-9",
    });

    await refreshWorklist({ repaint: false, silent: true });

    expect(state.worklistScannedAt).toBe("2026-09-10T09:00:00+07:00");
    // Taken from the scan's own response, not a follow-up request: a change
    // made while the disk was being walked must still look new next time.
    expect(state.worklistRevision).toBe("rev-9");
  });

  it("keeps the rows already on screen when the scan fails", async () => {
    state.worklistPatients = [CACHED_PATIENT];
    global.fetch = vi.fn().mockRejectedValue(new Error("ổ đĩa rút giữa chừng"));

    await refreshWorklist({ repaint: false, silent: true });

    expect(state.worklistPatients).toHaveLength(1);
    expect(state.worklistError).toBeTruthy();
  });
});
