// @vitest-environment jsdom

/**
 * The background watch must not become the load it exists to avoid.
 *
 * Every slice a download writes moves the revision token, so the twenty-second
 * watch saw a change on every tick and started a full walk of the archive each
 * time — tens of seconds of disk on a real archive, repeated continuously,
 * against the same disk the download is writing to.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  worklistScanWouldFightADownload,
  WORKLIST_MIN_SCAN_GAP_MS,
} from "./main.js";

beforeEach(() => {
  setLanguage("vi");
  state.job = {};
});

describe("the watch stands aside while this app is downloading", () => {
  it("reports a running job as a reason not to walk the archive", () => {
    // The reader is watching the job panel; `pollJob` refreshes the list the
    // moment the job ends, so nothing is lost by waiting.
    state.job = { status: "running", kind: "download" };
    expect(worklistScanWouldFightADownload()).toBe(true);
  });

  it("does not stand aside once the job has finished", () => {
    state.job = { status: "complete", kind: "download" };
    expect(worklistScanWouldFightADownload()).toBe(false);
  });

  it("does not stand aside when nothing is running", () => {
    state.job = { status: "idle" };
    expect(worklistScanWouldFightADownload()).toBe(false);
  });

  it("treats a missing job as nothing running", () => {
    state.job = undefined;
    expect(worklistScanWouldFightADownload()).toBe(false);
  });
});

describe("a floor between full scans", () => {
  it("is long enough that constant disk churn cannot drive the watch", () => {
    // The browser extension filling a folder moves the token as often as this
    // app would; the floor is what bounds the cost whatever the source.
    expect(WORKLIST_MIN_SCAN_GAP_MS).toBeGreaterThanOrEqual(60000);
  });

  it("still lets the list catch up within a couple of minutes", () => {
    // A study filed while the reader is looking elsewhere should not take so
    // long to appear that they reach for "Quét lại".
    expect(WORKLIST_MIN_SCAN_GAP_MS).toBeLessThanOrEqual(180000);
  });
});
