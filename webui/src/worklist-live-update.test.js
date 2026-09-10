// @vitest-environment jsdom

/**
 * The study list now repaints on its own — every twenty seconds, and after any
 * download finishes. Two things that were merely untidy while repainting only
 * happened on an explicit "Quét lại" become real problems once it happens
 * behind the reader's back.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  refreshStudyListPanel,
  renderWorklistTreeInner,
} from "./main.js";

function patientWith(status, extra = {}) {
  return {
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
        folder: "D:\\PACS\\Kho\\TEST-0001\\06-08-2026 - MR",
        status,
        statusLabel: status,
        mediaCounts: { dicom: 120, photo: 0, video: 0, doc: 0 },
        primaryMediaType: "dicom",
        sizeBytes: 1024,
        ...extra,
      },
    ],
  };
}

beforeEach(() => {
  setLanguage("vi");
  state.activeTabId = "worklist";
  state.worklistTab = "studies";
  state.worklistSearch = "";
  state.worklistLoaded = true;
  state.worklistLoading = false;
  state.worklistError = "";
  state.worklistModality = "";
  state.worklistPeriod = "all";
  state.worklistRead = "all";
  state.history = [];
});

describe("a background repaint leaves the reader where they were", () => {
  it("keeps the scroll position when the tree is rebuilt", () => {
    // `.worklist-tree` is the scrolling element, so replacing its contents
    // resets scrollTop to 0. A reader partway down a long list would be thrown
    // back to the top every twenty seconds.
    state.worklistPatients = Array.from({ length: 40 }, (_, i) => ({
      ...patientWith("done"),
      id: `p${i}`,
      patientId: `TEST-${i}`,
    }));
    document.body.innerHTML = `<div id="app"><div class="worklist-tree"></div></div>`;
    const tree = document.querySelector(".worklist-tree");
    tree.innerHTML = renderWorklistTreeInner();

    // jsdom reports no layout, so scrollTop only holds a value we can read back
    // if the element is scrollable; assign and confirm the repaint restores it.
    Object.defineProperty(tree, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(tree, "scrollLeft", { value: 0, writable: true });
    tree.scrollTop = 640;
    tree.scrollLeft = 120;

    refreshStudyListPanel();

    expect(tree.scrollTop).toBe(640);
    expect(tree.scrollLeft).toBe(120);
  });
});

describe("a study still being written is not offered for reading", () => {
  it("disables Mở viewer while a download holds the folder", () => {
    // "busy" now also means the browser extension is filling this folder.
    // Opening it mid write shows a study with slices missing and no sign of it.
    state.worklistPatients = [patientWith("busy", { statusLabel: "Extension đang tải" })];

    const html = renderWorklistTreeInner();
    document.body.innerHTML = `<div id="app">${html}</div>`;
    const open = document.querySelector('[data-action="open-study-viewer"]');

    expect(open).not.toBeNull();
    expect(open.hasAttribute("disabled")).toBe(true);
    expect(open.getAttribute("title")).toContain("đang được tải");
  });

  it("still disables it for a folder that is gone", () => {
    state.worklistPatients = [patientWith("miss")];
    document.body.innerHTML = `<div id="app">${renderWorklistTreeInner()}</div>`;

    expect(
      document.querySelector('[data-action="open-study-viewer"]').hasAttribute("disabled"),
    ).toBe(true);
  });

  it("leaves it enabled for a study that finished", () => {
    state.worklistPatients = [patientWith("done")];
    document.body.innerHTML = `<div id="app">${renderWorklistTreeInner()}</div>`;

    expect(
      document.querySelector('[data-action="open-study-viewer"]').hasAttribute("disabled"),
    ).toBe(false);
  });

  it("leaves it enabled for a study that is merely incomplete", () => {
    // "Tải tiếp" territory: the images that arrived are readable, and the
    // reader may well want to look at them before finishing the download.
    state.worklistPatients = [patientWith("part", { statusLabel: "Tải thiếu — thiếu 2/5 ảnh" })];
    document.body.innerHTML = `<div id="app">${renderWorklistTreeInner()}</div>`;

    expect(
      document.querySelector('[data-action="open-study-viewer"]').hasAttribute("disabled"),
    ).toBe(false);
  });
});
