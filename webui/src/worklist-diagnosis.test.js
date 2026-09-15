// @vitest-environment jsdom

/**
 * What the case is, on the worklist row.
 *
 * A neuro-oncology list is not scanned by name — it is scanned by what the
 * patient has. The diagnosis is written in one of two places, and the row says
 * which one it is showing: a note typed into the chart was written for this
 * patient, while a note left in a folder name can outlive what it describes.
 *
 * Nothing is invented to fill the line. A record that carries no diagnosis
 * anywhere renders no second line at all, rather than a plausible-looking one.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  bindEvents,
  renderWorklistView,
  renderWorklistTreeInner,
  patientDiagnosisLabel,
  filteredPatientList,
} from "./main.js";

/** Put the worklist on screen and wire it the way the app does. */
function mountAndBind(html) {
  document.body.innerHTML = `<div id="app">${html}</div>`;
  bindEvents();
  return document.querySelector("#app");
}

function patient(overrides) {
  return {
    id: "p1",
    patientId: "2607009886",
    patientName: "NGUYEN VAN A",
    gender: "Nam",
    birthYear: "1968",
    folder: "D:\\Kho\\2607009886-NGUYEN VAN A-58T-GBM cham phai",
    mediaSummary: { dicom: 41, photo: 0, video: 0, doc: 0 },
    studies: [
      {
        id: "s1",
        studyDate: "06/08/2026",
        studyName: "MR sọ não có tiêm",
        modality: "MR",
        folder: "D:\\Kho\\2607009886\\2026-08-06 - MR - SO NAO",
        status: "done",
        statusLabel: "Đã tải",
        isRead: false,
        mediaCounts: { dicom: 41, photo: 0, video: 0, doc: 0 },
      },
    ],
    ...overrides,
  };
}

describe("Diagnosis on the worklist row", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "worklist";
    state.worklistTab = "studies";
    state.worklistPatients = [];
    state.worklistLoaded = true;
    state.worklistLoading = false;
    state.worklistError = "";
    state.worklistSearch = "";
    state.worklistModality = "";
    state.worklistPeriod = "all";
    state.worklistRead = "all";
    state.expandedPatients = {};
  });

  it("shows a diagnosis recorded in the chart", () => {
    state.worklistPatients = [patient({
      diagnosis: "GBM IDH-wildtype, tái phát",
      diagnosisSource: "manifest",
    })];
    const app = mountAndBind(renderWorklistTreeInner());

    const line = app.querySelector(".prow .dx-line");
    expect(line).not.toBeNull();
    expect(line.textContent.trim()).toBe("GBM IDH-wildtype, tái phát");
    expect(line.classList.contains("from-folder")).toBe(false);
    expect(line.getAttribute("title")).toContain("ghi trong hồ sơ");
  });

  it("marks a diagnosis that was only read off the folder name", () => {
    state.worklistPatients = [patient({
      diagnosis: "GBM chẩm phải",
      diagnosisSource: "folder",
    })];
    const app = mountAndBind(renderWorklistTreeInner());

    const line = app.querySelector(".prow .dx-line");
    expect(line.textContent.trim()).toBe("GBM chẩm phải");
    expect(line.classList.contains("from-folder")).toBe(true);
    expect(line.getAttribute("title")).toContain("tên thư mục");
  });

  it("leaves the line out entirely when no diagnosis was written", () => {
    state.worklistPatients = [patient({ diagnosis: "", diagnosisSource: "" })];
    const app = mountAndBind(renderWorklistTreeInner());

    expect(app.querySelector(".prow .dx-line")).toBeNull();
    // Not a dash, not an empty element: a reader must not be able to mistake a
    // record with no diagnosis for one whose diagnosis is unremarkable.
    expect(app.querySelector(".prow .who").textContent).not.toContain("—");
  });

  it("keeps showing the demographics that confirm the right chart", () => {
    state.worklistPatients = [patient({
      diagnosis: "U màng não trên yên",
      diagnosisSource: "manifest",
    })];
    const app = mountAndBind(renderWorklistTreeInner());

    const lines = [...app.querySelectorAll(".prow .who small")].map((el) => el.textContent.trim());
    expect(lines).toContain("U màng não trên yên");
    expect(lines.some((line) => line.includes("Nam") && line.includes("1968"))).toBe(true);
  });

  it("finds a patient by diagnosis when the reader types in the search box", () => {
    state.worklistPatients = [
      patient({ id: "p1", diagnosis: "GBM chẩm phải", diagnosisSource: "folder" }),
      patient({
        id: "p2",
        patientId: "2606032982",
        patientName: "TRAN THI B",
        diagnosis: "U màng não bán cầu",
        diagnosisSource: "manifest",
      }),
    ];
    const app = mountAndBind(renderWorklistView());
    expect(app.querySelectorAll(".prow")).toHaveLength(2);

    const box = app.querySelector("[data-field='worklist-search']");
    box.value = "màng não";
    box.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(state.worklistSearch).toBe("màng não");
    expect(filteredPatientList().map((p) => p.id)).toEqual(["p2"]);
    const rows = [...app.querySelectorAll(".prow .dx-line")].map((el) => el.textContent.trim());
    expect(rows).toEqual(["U màng não bán cầu"]);
  });

  it("reads a missing diagnosis as absent rather than as a blank string to show", () => {
    expect(patientDiagnosisLabel({}).text).toBe("");
    expect(patientDiagnosisLabel({ diagnosis: "   " }).text).toBe("");
    expect(patientDiagnosisLabel(undefined).text).toBe("");
  });
});
