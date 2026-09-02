// @vitest-environment jsdom

// Clicking a series is how a reader moves through an examination, so the
// handler is covered end to end: a refactor that drops one of the variables it
// reads must fail here rather than in front of a doctor.

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import { state, bindEvents } from "./main.js";

const SERIES = [
  {
    id: "s1",
    timelineKey: "mr-study",
    studyDate: "20260806",
    mediaType: "dicom",
    modality: "MR",
    studyGroup: "2026-08-06 - MR - MR sọ não",
    studyDescription: "MR sọ não",
    description: "Ax T2 FLAIR",
    sliceCount: 28,
  },
  {
    id: "s2",
    timelineKey: "mr-study",
    studyDate: "20260806",
    mediaType: "dicom",
    modality: "MR",
    studyGroup: "2026-08-06 - MR - MR sọ não",
    studyDescription: "MR sọ não",
    description: "T1 SAG",
    sliceCount: 24,
  },
];

function mountStrip() {
  document.body.innerHTML = `
    <div id="app">
      <div class="series-group-badge" data-date-key="2026-08-06"></div>
      <button class="series-card" data-series-id="s1" data-date-key="2026-08-06"></button>
      <button class="series-card" data-series-id="s2" data-date-key="2026-08-06"></button>
      <div class="tl-item">
        <button class="tl-open" data-series-id="s2"></button>
      </div>
    </div>`;
  return document.querySelector("#app");
}

describe("Clicking a series card", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "tab-1";
    state.tabs = [];
    state.mode = "single";
    state.tool = "window";
    state.selectedId = "s1";
    state.compareIds = [];
    state.archive = {
      root: "D:\\PACS\\BN",
      patient: {},
      series: SERIES.map((item) => ({ ...item })),
    };
    mountStrip();
  });

  it("selects the clicked series instead of throwing", async () => {
    bindEvents();

    document.querySelector('.series-card[data-series-id="s2"]').click();
    await Promise.resolve();

    expect(state.selectedId).toBe("s2");
  });

  it("scrolls the strip from the timeline without changing the shown series", async () => {
    // A timeline click is a "take me there" gesture. Swapping the image under
    // the reader at the same time loses the slice they were looking at.
    bindEvents();
    const badge = document.querySelector(".series-group-badge");
    let scrolledTo = null;
    badge.scrollIntoView = () => {
      scrolledTo = "badge";
    };

    document.querySelector(".tl-open").click();
    await Promise.resolve();

    expect(scrolledTo).toBe("badge");
    expect(state.selectedId).toBe("s1");
  });

  it("ignores a click naming a series the archive does not have", async () => {
    bindEvents();
    const stale = document.createElement("button");
    stale.className = "series-card";
    stale.dataset.seriesId = "gone";
    document.querySelector("#app").append(stale);
    bindEvents();

    stale.click();
    await Promise.resolve();

    expect(state.selectedId).toBe("s1");
  });
});
