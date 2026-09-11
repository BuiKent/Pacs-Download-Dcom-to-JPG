// @vitest-environment jsdom

/**
 * A badge states what the archive recorded, never what it probably is.
 *
 * These badges sit beside a patient's name and tell the reader whether they
 * are looking at original slices or at pictures converted from them — which
 * decides whether grey values mean anything. Every one of them had a fallback
 * that fired when nothing was known: the study list and the patient badges
 * printed "JPG", the timeline pill printed "DICOM" with a tooltip reading
 * "Dữ liệu gốc DICOM", and the tab strip printed a modality of "MR".
 *
 * The rule the rest of this app already follows is that an unknown field shows
 * "—". A guess that looks like a fact is the failure mode this archive has
 * been bitten by before, with a hardcoded `gender="Nam"` that showed a woman's
 * record as a man's.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  renderWorklistTreeInner,
  buildMediaTimeline,
  renderWinbar,
  newViewerTab,
  recordedIdentity,
} from "./main.js";

function patient(overrides = {}) {
  return {
    id: "p1",
    patientId: "BN-0001",
    patientName: "NGUYỄN VĂN A",
    gender: "",
    birthYear: "",
    hospital: "",
    folder: "D:\\PACS\\Kho\\BN-0001",
    totalSizeFormatted: "0 B",
    ...overrides,
  };
}

/** A study the archive knows nothing about the media of. */
function unknownStudy() {
  return {
    id: "s1",
    studyDate: "06/08/2026",
    studyDateSort: "20260806",
    studyName: "Ca chụp",
    modality: "",
    seriesCount: 0,
    sliceCount: 0,
    folder: "D:\\PACS\\Kho\\BN-0001\\2026-08-06",
    status: "done",
    statusLabel: "Đã tải",
  };
}

beforeEach(() => {
  setLanguage("vi");
  state.tabs = [];
  state.activeTabId = "worklist";
  state.worklistLoaded = true;
  state.worklistLoading = false;
  state.worklistSearch = "";
  state.worklistModality = "";
  state.worklistRead = "all";
  state.worklistPeriod = "all";
  state.worklistPatients = [];
});

describe("thẻ định dạng trong danh sách ca chụp", () => {
  it("không gán JPG cho ca chụp mà kho chưa biết gì về định dạng", () => {
    state.worklistPatients = [patient({ studies: [unknownStudy()] })];
    const html = renderWorklistTreeInner();
    document.body.innerHTML = `<div id="app">${html}</div>`;

    const badges = [...document.querySelectorAll(".fmt-badge")];
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.textContent.trim()).not.toBe("JPG");
      expect(badge.textContent.trim()).not.toBe("DICOM");
    }
    expect(document.querySelector(".fmt-badge.unknown")?.textContent.trim()).toBe("—");
  });

  it("vẫn gọi đúng tên khi kho có đếm được phim", () => {
    state.worklistPatients = [
      patient({
        mediaSummary: { dicom: 12, photo: 0, video: 0, doc: 0 },
        studies: [{
          ...unknownStudy(),
          seriesCount: 3,
          sliceCount: 120,
          mediaCounts: { dicom: 120, photo: 0, video: 0, doc: 0 },
          primaryMediaType: "dicom",
        }],
      }),
    ];
    document.body.innerHTML = `<div id="app">${renderWorklistTreeInner()}</div>`;
    const texts = [...document.querySelectorAll(".fmt-badge")].map((el) => el.textContent.trim());
    expect(texts).toContain("DICOM");
  });
});

describe("thẻ nguồn trên dòng thời gian ca chụp", () => {
  it("không khai là DICOM gốc khi không series nào nói vậy", () => {
    // A series whose media type the archive never recorded. `getSeriesMediaType`
    // routes it to the diagnostic canvas as a default, which is a routing
    // decision — not a statement about where the pixels came from.
    const rows = buildMediaTimeline([
      {
        id: "x1",
        name: "Không rõ",
        studyDate: "20260806",
        timelineKey: "k1",
        mediaType: "",
        sourceType: "",
        sourceFormat: "",
        sliceCount: 1,
      },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].sourceFormat).toBe("—");
    expect(rows[0].sourceTitle).not.toContain("Dữ liệu gốc DICOM");
  });

  it("vẫn khai DICOM khi series thật sự là DICOM", () => {
    const rows = buildMediaTimeline([
      {
        id: "x1",
        name: "MR sọ não",
        studyDate: "20260806",
        timelineKey: "k1",
        mediaType: "dicom",
        sourceType: "dicom",
        sliceCount: 120,
      },
    ]);
    expect(rows[0].sourceFormat).toBe("DICOM");
  });
});

describe("thẻ trên thanh tab", () => {
  it("không bịa modality khi hồ sơ không ghi", () => {
    const tab = newViewerTab({
      patientId: "BN-0001",
      patientName: "NGUYỄN VĂN A",
      archive: {
        root: "D:\\PACS\\Kho\\BN-0001",
        series: [{ id: "p1", name: "Ảnh chụp", mediaType: "photo", sourceType: "image" }],
      },
    });
    state.tabs = [tab];
    state.activeTabId = tab.id;

    const strip = renderWinbar();
    document.body.innerHTML = `<div id="app">${strip}</div>`;
    const badge = document.querySelector(".tab-fmt-badge");
    expect(badge).not.toBeNull();
    // "MR · JPG" was printed for every record that was not DICOM — photo and
    // document folders included — right beside the patient's name.
    expect(badge.textContent.trim()).not.toContain("MR");
    expect(badge.textContent.trim()).toBe("JPG");
  });

  it("không khai định dạng cho hồ sơ chưa có series nào", () => {
    const tab = newViewerTab({
      patientId: "BN-0002",
      patientName: "TRẦN THỊ B",
      archive: { root: "D:\\PACS\\Kho\\BN-0002", series: [] },
    });
    state.tabs = [tab];
    state.activeTabId = tab.id;
    document.body.innerHTML = `<div id="app">${renderWinbar()}</div>`;
    expect(document.querySelector(".tab-fmt-badge").textContent.trim()).toBe("—");
  });
});

describe("mã và tên bệnh nhân bị che", () => {
  it("không hiện chuỗi giữ chỗ của máy ra màn hình", () => {
    // The pipeline writes these when a DICOM carries no name, or one the
    // hospital redacted. They are real folder names on disk, and on screen
    // they are the same text for every anonymised record — so two different
    // patients read identically in the list a doctor checks before opening.
    expect(recordedIdentity("KHONG_RO_TEN")).toBe("");
    expect(recordedIdentity("KHONG_RO_ID")).toBe("");
    expect(recordedIdentity("ANONYMOUS")).toBe("");
    expect(recordedIdentity("XXXXX")).toBe("");
    expect(recordedIdentity("???")).toBe("");
    expect(recordedIdentity("")).toBe("");
    expect(recordedIdentity(null)).toBe("");
  });

  it("giữ nguyên mã và tên thật, kể cả tiếng Việt có dấu", () => {
    expect(recordedIdentity("BN-0001")).toBe("BN-0001");
    expect(recordedIdentity("NGUYỄN VĂN A")).toBe("NGUYỄN VĂN A");
    expect(recordedIdentity("  2607063527 ")).toBe("2607063527");
  });

  it("danh sách ca chụp hiện — thay vì chuỗi giữ chỗ", () => {
    state.worklistPatients = [
      patient({
        patientId: "KHONG_RO_ID",
        patientName: "KHONG_RO_TEN",
        studies: [unknownStudy()],
      }),
    ];
    document.body.innerHTML = `<div id="app">${renderWorklistTreeInner()}</div>`;
    const text = document.querySelector("#app").textContent;
    expect(text).not.toContain("KHONG_RO_ID");
    expect(text).not.toContain("KHONG_RO_TEN");
  });
});
