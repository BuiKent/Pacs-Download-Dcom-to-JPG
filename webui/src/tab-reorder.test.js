// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  state,
  renderWinbar,
  moveTab,
  moveActiveTabRelatively,
  bindWinbarTabs,
  installKeyboardShortcuts,
} from "./main.js";

function makeMockTab(id, patientId, name) {
  return {
    id,
    patientId,
    patientName: name,
    loading: false,
    archive: { series: [] },
  };
}

function createDragEvent(type, options = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.clientX = options.clientX || 0;
  event.clientY = options.clientY || 0;
  event.dataTransfer = options.dataTransfer || {
    data: {},
    effectAllowed: "all",
    dropEffect: "none",
    setData(key, val) { this.data[key] = val; },
    getData(key) { return this.data[key] || ""; },
  };
  return event;
}

describe("Tab Reordering: moveTab and moveActiveTabRelatively logic", () => {
  beforeEach(() => {
    state.tabs = [
      makeMockTab("tab-a", "P1", "Patient A"),
      makeMockTab("tab-b", "P2", "Patient B"),
      makeMockTab("tab-c", "P3", "Patient C"),
      makeMockTab("tab-d", "P4", "Patient D"),
    ];
    state.activeTabId = "tab-b";
  });

  it("moves a tab forward in the order", () => {
    // Move tab-a (index 0) to after tab-c (targetIndex 3)
    const changed = moveTab("tab-a", 3);
    expect(changed).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-b", "tab-c", "tab-a", "tab-d"]);
  });

  it("moves a tab backward in the order", () => {
    // Move tab-d (index 3) to before tab-b (targetIndex 1)
    const changed = moveTab("tab-d", 1);
    expect(changed).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-a", "tab-d", "tab-b", "tab-c"]);
  });

  it("moves a tab to the first position (index 0)", () => {
    const changed = moveTab("tab-c", 0);
    expect(changed).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-c", "tab-a", "tab-b", "tab-d"]);
  });

  it("moves a tab to the last position", () => {
    const changed = moveTab("tab-a", state.tabs.length);
    expect(changed).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-b", "tab-c", "tab-d", "tab-a"]);
  });

  it("returns false and leaves array untouched when dropped at current position", () => {
    const originalIds = state.tabs.map((t) => t.id);
    expect(moveTab("tab-b", 1)).toBe(false);
    expect(moveTab("tab-b", 2)).toBe(false);
    expect(state.tabs.map((t) => t.id)).toEqual(originalIds);
  });

  it("ignores invalid or worklist tab ids", () => {
    expect(moveTab("worklist", 2)).toBe(false);
    expect(moveTab("non-existent", 2)).toBe(false);
  });

  it("clamps out-of-range target indices", () => {
    const changedNegative = moveTab("tab-d", -5);
    expect(changedNegative).toBe(true);
    expect(state.tabs[0].id).toBe("tab-d");

    const changedHuge = moveTab("tab-d", 999);
    expect(changedHuge).toBe(true);
    expect(state.tabs[state.tabs.length - 1].id).toBe("tab-d");
  });

  it("moves the active tab relatively using moveActiveTabRelatively", () => {
    state.activeTabId = "tab-b"; // index 1
    const movedLeft = moveActiveTabRelatively(-1);
    expect(movedLeft).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-b", "tab-a", "tab-c", "tab-d"]);

    // tab-b is now at index 0, moving left should fail
    expect(moveActiveTabRelatively(-1)).toBe(false);

    // move right once -> index 1
    expect(moveActiveTabRelatively(1)).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-a", "tab-b", "tab-c", "tab-d"]);

    // move right again -> index 2
    expect(moveActiveTabRelatively(1)).toBe(true);
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-a", "tab-c", "tab-b", "tab-d"]);
  });

  it("returns false for moveActiveTabRelatively when worklist is active", () => {
    state.activeTabId = "worklist";
    expect(moveActiveTabRelatively(-1)).toBe(false);
    expect(moveActiveTabRelatively(1)).toBe(false);
  });
});

describe("Tab Reordering: Real DOM and Drag & Drop behavioral tests", () => {
  let container;

  beforeEach(() => {
    state.tabs = [
      makeMockTab("tab-1", "BN1", "Patient 1"),
      makeMockTab("tab-2", "BN2", "Patient 2"),
      makeMockTab("tab-3", "BN3", "Patient 3"),
    ];
    state.activeTabId = "tab-1";

    container = document.createElement("div");
    container.id = "app";
    document.body.innerHTML = "";
    document.body.appendChild(container);
    container.innerHTML = renderWinbar();
    bindWinbarTabs(container);
  });

  it("renders draggable tabs with close buttons that are not draggable", () => {
    const tabs = container.querySelectorAll(".winbar-tab");
    expect(tabs.length).toBe(4); // Worklist + 3 viewer tabs

    const worklistTab = container.querySelector(".winbar-tab[data-tab-id='worklist']");
    expect(worklistTab.getAttribute("draggable")).toBeNull();

    const viewerTabs = container.querySelectorAll(".winbar-tab:not([data-tab-id='worklist'])");
    expect(viewerTabs.length).toBe(3);
    viewerTabs.forEach((tabEl) => {
      expect(tabEl.getAttribute("draggable")).toBe("true");
      const closeBtn = tabEl.querySelector(".winbar-tab-close");
      expect(closeBtn.getAttribute("draggable")).toBe("false");
    });
  });

  it("sets dataTransfer and .tab-dragging on dragstart", () => {
    vi.useFakeTimers();
    const tab2 = container.querySelector(".winbar-tab[data-tab-id='tab-2']");
    const dragEvent = createDragEvent("dragstart");
    tab2.dispatchEvent(dragEvent);

    expect(dragEvent.dataTransfer.getData("text/plain")).toBe("tab-2");
    expect(dragEvent.dataTransfer.effectAllowed).toBe("move");

    vi.runAllTimers();
    expect(tab2.classList.contains("tab-dragging")).toBe(true);
    vi.useRealTimers();
  });

  it("prevents dragstart if initiated on the close button", () => {
    const tab2 = container.querySelector(".winbar-tab[data-tab-id='tab-2']");
    const closeBtn = tab2.querySelector(".winbar-tab-close");
    const dragEvent = createDragEvent("dragstart");
    closeBtn.dispatchEvent(dragEvent);

    expect(dragEvent.defaultPrevented).toBe(true);
  });

  it("displays drop indicator on left or right half during dragover", () => {
    const tab1 = container.querySelector(".winbar-tab[data-tab-id='tab-1']");
    const tab2 = container.querySelector(".winbar-tab[data-tab-id='tab-2']");

    // Start drag on tab 1
    tab1.dispatchEvent(createDragEvent("dragstart"));

    // Mock bounding rect for tab 2: width 100, left 100 -> mid 150
    vi.spyOn(tab2, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 100,
      right: 200,
      top: 0,
      bottom: 26,
      height: 26,
    });

    // Dragover on left half (clientX 120 < 150)
    const dragOverLeft = createDragEvent("dragover", { clientX: 120 });
    tab2.dispatchEvent(dragOverLeft);
    expect(dragOverLeft.defaultPrevented).toBe(true);
    expect(tab2.classList.contains("drag-over-left")).toBe(true);
    expect(tab2.classList.contains("drag-over-right")).toBe(false);

    // Dragover on right half (clientX 180 >= 150)
    const dragOverRight = createDragEvent("dragover", { clientX: 180 });
    tab2.dispatchEvent(dragOverRight);
    expect(tab2.classList.contains("drag-over-right")).toBe(true);
    expect(tab2.classList.contains("drag-over-left")).toBe(false);

    // Dragleave removes indicator
    tab2.dispatchEvent(createDragEvent("dragleave"));
    expect(tab2.classList.contains("drag-over-left")).toBe(false);
    expect(tab2.classList.contains("drag-over-right")).toBe(false);
  });

  it("reorders tabs when dropped onto another tab", () => {
    const tab3 = container.querySelector(".winbar-tab[data-tab-id='tab-3']");
    const tab1 = container.querySelector(".winbar-tab[data-tab-id='tab-1']");

    // Start dragging tab 3
    const startEvent = createDragEvent("dragstart");
    tab3.dispatchEvent(startEvent);

    // Mock bounding rect for tab 1: left half drop
    vi.spyOn(tab1, "getBoundingClientRect").mockReturnValue({
      left: 50,
      width: 100,
      right: 150,
      top: 0,
      bottom: 26,
      height: 26,
    });

    const dropEvent = createDragEvent("drop", {
      clientX: 70, // left half -> insert before tab 1
      dataTransfer: startEvent.dataTransfer,
    });
    tab1.dispatchEvent(dropEvent);
    expect(dropEvent.defaultPrevented).toBe(true);

    // State tabs should now be [tab-3, tab-1, tab-2]
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-3", "tab-1", "tab-2"]);

    // DOM should be refreshed with new tab order
    const renderedTabs = Array.from(container.querySelectorAll(".winbar-tab:not([data-tab-id='worklist'])"))
      .map((el) => el.dataset.tabId);
    expect(renderedTabs).toEqual(["tab-3", "tab-1", "tab-2"]);
  });

  it("reorders tab to index 0 when dropped onto Worklist", () => {
    const tab3 = container.querySelector(".winbar-tab[data-tab-id='tab-3']");
    const worklistTab = container.querySelector(".winbar-tab[data-tab-id='worklist']");

    const startEvent = createDragEvent("dragstart");
    tab3.dispatchEvent(startEvent);

    const dropEvent = createDragEvent("drop", {
      clientX: 20,
      dataTransfer: startEvent.dataTransfer,
    });
    worklistTab.dispatchEvent(dropEvent);

    expect(state.tabs[0].id).toBe("tab-3");
  });

  it("reorders tab to the end when dropped onto the add button", () => {
    const tab1 = container.querySelector(".winbar-tab[data-tab-id='tab-1']");
    const addBtn = container.querySelector(".winbar-add-btn");

    const startEvent = createDragEvent("dragstart");
    tab1.dispatchEvent(startEvent);

    const dropEvent = createDragEvent("drop", {
      clientX: 500,
      dataTransfer: startEvent.dataTransfer,
    });
    addBtn.dispatchEvent(dropEvent);

    expect(state.tabs[state.tabs.length - 1].id).toBe("tab-1");
  });

  it("cleans up indicators on dragend", () => {
    const tab2 = container.querySelector(".winbar-tab[data-tab-id='tab-2']");
    tab2.classList.add("tab-dragging", "drag-over-left");
    tab2.dispatchEvent(createDragEvent("dragend"));

    expect(tab2.classList.contains("tab-dragging")).toBe(false);
    expect(tab2.classList.contains("drag-over-left")).toBe(false);
  });
});

describe("Tab Reordering: Keyboard shortcuts", () => {
  beforeEach(() => {
    state.tabs = [
      makeMockTab("tab-1", "BN1", "Patient 1"),
      makeMockTab("tab-2", "BN2", "Patient 2"),
      makeMockTab("tab-3", "BN3", "Patient 3"),
    ];
    state.activeTabId = "tab-2";
    installKeyboardShortcuts();
  });

  it("moves active tab left on Ctrl+Shift+PageUp and Ctrl+Shift+ArrowLeft", () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageUp", ctrlKey: true, shiftKey: true })
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-2", "tab-1", "tab-3"]);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, shiftKey: true })
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2", "tab-3"]);
  });
});
