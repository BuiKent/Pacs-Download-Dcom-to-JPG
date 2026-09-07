// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  renderWorklistTreeInner,
  bindEvents,
  getSavedWorklistColumnWidths,
  saveWorklistColumnWidths,
  WORKLIST_COL_STORAGE_KEY,
  DEFAULT_WORKLIST_COL_WIDTHS,
  WORKLIST_COL_MIN_WIDTHS,
  WORKLIST_COL_MAX_WIDTHS,
} from "./main.js";

// Polyfill PointerEvent for jsdom test runner
class MockPointerEvent extends MouseEvent {
  constructor(type, props = {}) {
    super(type, { bubbles: true, cancelable: true, clientX: props.clientX || 0, ...props });
    this.pointerId = props.pointerId || 1;
  }
}
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  window.PointerEvent = MockPointerEvent;
  global.PointerEvent = MockPointerEvent;
}

function mountWorklist(patients) {
  state.worklistPatients = patients;
  state.worklistLoading = false;
  state.worklistLoaded = true;
  state.worklistError = "";
  state.activeTabId = "worklist";
  state.worklistTab = "studies";

  document.body.innerHTML = `
    <div id="app">
      <div class="worklist-view">
        <div class="worklist-tree">
          ${renderWorklistTreeInner()}
        </div>
      </div>
    </div>
  `;
  bindEvents();
  return document.querySelector("#app");
}

const SAMPLE_PATIENTS = [
  {
    id: "p_ly",
    patientId: "2607053993",
    patientName: "PHAN THI YEN LY",
    gender: "Nữ",
    birthYear: "1999",
    hospital: "BV Đại học Y Hà Nội",
    studies: [
      {
        id: "s1",
        studyDate: "01/08/2026",
        studyName: "MR so nao + Gadovist",
        modality: "MR",
        seriesCount: 14,
        sliceCount: 992,
        folder: "D:\\Kho\\2607053993 - PHAN THI YEN LY\\2026-08-01 - MR - SO NAO",
        status: "done",
        statusLabel: "Đã tải",
      },
      {
        id: "s2",
        studyDate: "30/07/2026",
        studyName: "MR so nao + Gadovist",
        modality: "MR",
        seriesCount: 30,
        sliceCount: 8716,
        folder: "D:\\Kho\\2607053993 - PHAN THI YEN LY\\2026-07-30 - MR - SO NAO",
        status: "part",
        statusLabel: "Chưa hoàn tất",
        viewerUrl: "https://pacs.example.com/viewer?session=test1234",
      },
    ],
  },
];

describe("Worklist Column Resizing & Four Action Buttons", () => {
  beforeEach(() => {
    localStorage.clear();
    setLanguage("vi");
  });

  it("renders an accessible resize handle for every Worklist column", () => {
    const app = mountWorklist(SAMPLE_PATIENTS);
    const header = app.querySelector(".plist-header");
    expect(header).not.toBeNull();

    const handles = header.querySelectorAll(".col-resizer");
    expect(handles.length).toBe(8);

    const cols = Array.from(handles).map((h) => h.dataset.col);
    expect(cols).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    handles.forEach((handle) => {
      expect(handle.getAttribute("role")).toBe("separator");
      expect(handle.getAttribute("aria-orientation")).toBe("vertical");
      expect(handle.tabIndex).toBe(0);
      expect(handle.getAttribute("aria-label")).toBeTruthy();
      expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
      expect(handle.closest("button")).toBeNull();
    });
  });

  it("sanitizes persisted widths before they can reach the inline grid style", () => {
    localStorage.setItem(WORKLIST_COL_STORAGE_KEY, JSON.stringify({
      c0: '\" onpointerdown=\"alert(1)',
      c1: -500,
      c2: 999999,
      c3: 120.6,
      c4: null,
      c5: 118,
      c6: 360,
      c7: 400,
      unexpected: 123,
    }));

    const widths = getSavedWorklistColumnWidths();

    expect(Object.keys(widths)).toEqual(Object.keys(DEFAULT_WORKLIST_COL_WIDTHS));
    expect(widths.c0).toBe(DEFAULT_WORKLIST_COL_WIDTHS.c0);
    expect(widths.c1).toBe(WORKLIST_COL_MIN_WIDTHS.c1);
    expect(widths.c2).toBeLessThan(999999);
    expect(widths.c3).toBe(121);
    expect(widths.c4).toBe(DEFAULT_WORKLIST_COL_WIDTHS.c4);
    Object.values(widths).forEach((width) => {
      expect(Number.isFinite(width)).toBe(true);
      expect(Number.isInteger(width)).toBe(true);
    });
  });

  it("updates CSS variables on worklist-tree when resizer is dragged via pointer events", () => {
    const app = mountWorklist(SAMPLE_PATIENTS);
    const tree = app.querySelector(".worklist-tree");
    const nameResizer = app.querySelector(".col-resizer[data-col='c1']");
    expect(nameResizer).not.toBeNull();

    // Initial state: default widths applied
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c1}px`);

    // Simulate pointer drag by +60px
    const downEv = new PointerEvent("pointerdown", { clientX: 200, bubbles: true });
    nameResizer.dispatchEvent(downEv);

    const moveEv = new PointerEvent("pointermove", { clientX: 260, bubbles: true });
    window.dispatchEvent(moveEv);

    // Should update CSS variable to (210 + 60 = 270px)
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c1 + 60}px`);

    const upEv = new PointerEvent("pointerup", { clientX: 260, bubbles: true });
    window.dispatchEvent(upEv);

    // Confirms persisted to localStorage
    const saved = JSON.parse(localStorage.getItem(WORKLIST_COL_STORAGE_KEY));
    expect(saved.c1).toBe(DEFAULT_WORKLIST_COL_WIDTHS.c1 + 60);
  });

  it("applies saved column widths from localStorage on re-render", () => {
    saveWorklistColumnWidths({
      ...DEFAULT_WORKLIST_COL_WIDTHS,
      c1: 310,
      c2: 150,
    });

    const app = mountWorklist(SAMPLE_PATIENTS);
    const tree = app.querySelector(".worklist-tree");

    expect(tree.style.getPropertyValue("--wl-c1")).toBe("310px");
    expect(tree.style.getPropertyValue("--wl-c2")).toBe("150px");
  });

  it("supports standard separator keyboard controls and default reset", () => {
    const app = mountWorklist(SAMPLE_PATIENTS);
    const tree = app.querySelector(".worklist-tree");
    const nameResizer = app.querySelector(".col-resizer[data-col='c1']");

    nameResizer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c1 + 10}px`);
    expect(nameResizer.getAttribute("aria-valuenow")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c1 + 10}`);

    nameResizer.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      bubbles: true,
    }));
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c1 + 60}px`);

    nameResizer.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${WORKLIST_COL_MIN_WIDTHS.c1}px`);

    nameResizer.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${WORKLIST_COL_MAX_WIDTHS.c1}px`);

    nameResizer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c1}px`);
    expect(JSON.parse(localStorage.getItem(WORKLIST_COL_STORAGE_KEY)).c1).toBe(DEFAULT_WORKLIST_COL_WIDTHS.c1);
  });

  it("lets the Action column resize directly and clamps pointer drags to a safe minimum", () => {
    const app = mountWorklist(SAMPLE_PATIENTS);
    const tree = app.querySelector(".worklist-tree");
    const actionResizer = app.querySelector(".col-resizer[data-col='c7']");
    const nameResizer = app.querySelector(".col-resizer[data-col='c1']");

    actionResizer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c7")).toBe(`${DEFAULT_WORKLIST_COL_WIDTHS.c7 + 10}px`);

    nameResizer.dispatchEvent(new PointerEvent("pointerdown", { clientX: 200, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: -2000, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: -2000, bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c1")).toBe(`${WORKLIST_COL_MIN_WIDTHS.c1}px`);
  });

  it("shrinks the flexible Action track immediately by balancing the name column", () => {
    const app = mountWorklist(SAMPLE_PATIENTS);
    const tree = app.querySelector(".worklist-tree");
    const actionResizer = app.querySelector(".col-resizer[data-col='c7']");
    const nameResizer = app.querySelector(".col-resizer[data-col='c1']");
    actionResizer.closest(".plist-header > *").getBoundingClientRect = () => ({ width: 400 });
    nameResizer.closest(".plist-header > *").getBoundingClientRect = () => ({ width: 300 });

    actionResizer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(tree.style.getPropertyValue("--wl-c7")).toBe("390px");
    expect(tree.style.getPropertyValue("--wl-c1")).toBe("310px");

    actionResizer.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(tree.style.getPropertyValue("--wl-c7")).toBe(`${WORKLIST_COL_MAX_WIDTHS.c7}px`);
    expect(tree.style.getPropertyValue("--wl-c1")).toBe("310px");
  });

  it("renders the Ngày thêm (folder creation date) column and supports sorting by date added", () => {
    const patientsWithDates = [
      {
        ...SAMPLE_PATIENTS[0],
        id: "p1",
        patientName: "Bệnh nhân A",
        folderCreatedAt: "01/09/2026",
        folderCreatedAtSort: "20260901000000",
      },
      {
        ...SAMPLE_PATIENTS[0],
        id: "p2",
        patientName: "Bệnh nhân B",
        folderCreatedAt: "05/09/2026",
        folderCreatedAtSort: "20260905000000",
      },
    ];

    const app = mountWorklist(patientsWithDates);
    const header = app.querySelector(".plist-header");
    const createdHeaderBtn = header.querySelector(".col-sort-btn.col-created");
    expect(createdHeaderBtn).not.toBeNull();
    expect(createdHeaderBtn.textContent).toContain("Ngày thêm");

    const createdCells = app.querySelectorAll(".prow .created-col");
    expect(createdCells.length).toBe(2);
    expect(createdCells[0].textContent).toContain("01/09/2026");

    // Click sort by created column
    createdHeaderBtn.click();
    expect(state.worklistSortColumn).toBe("created");
  });

  it("renders all four action buttons on 'Chưa hoàn tất' row without omission", () => {
    const app = mountWorklist(SAMPLE_PATIENTS);
    const srows = app.querySelectorAll(".srow");
    expect(srows.length).toBe(2);

    // Second study is 'Chưa hoàn tất' and carries viewerUrl
    const incompleteRow = srows[1];
    const resumeBtn = incompleteRow.querySelector("[data-action='resume-study-download']");
    const viewerBtn = incompleteRow.querySelector("[data-action='open-study-viewer']");
    const folderBtn = incompleteRow.querySelector("[data-action='reveal-study-folder']");
    const readBtn = incompleteRow.querySelector("[data-action='toggle-study-read']");

    expect(resumeBtn).not.toBeNull();
    expect(resumeBtn.textContent.trim()).toBe("Tải tiếp");
    expect(viewerBtn).not.toBeNull();
    expect(viewerBtn.textContent.trim()).toBe("Mở viewer");
    expect(folderBtn).not.toBeNull();
    expect(folderBtn.textContent.trim()).toBe("Thư mục");
    expect(readBtn).not.toBeNull();
  });
});
