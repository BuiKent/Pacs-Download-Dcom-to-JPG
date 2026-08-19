import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hasCompleteSeriesSelection,
  initialiseStudySelections,
  rememberSeriesSelections,
  restoreSeriesSelections,
  selectedStudies,
  seriesSelections,
} from "./download-selection.js";

const studies = [
  { study_uid: "study-old", date: "2026-01-01", local_status: "downloaded" },
  { study_uid: "study-a", date: "2026-07-01", local_status: "new" },
  { study_uid: "study-b", date: "2026-08-01", local_status: "incomplete" },
];

const mainSource = readFileSync(resolve(process.cwd(), "src/main.js"), "utf8");
const cssSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("download-all UI contract", () => {
  it("keeps the default-on checkbox wired to discovery and both download paths", () => {
    expect(mainSource).toContain('downloadAllFiles: true');
    expect(mainSource).toContain('id="download-all-files"');
    expect(mainSource).toContain('data-action="discover-series"');
    expect(mainSource).toContain('downloadAllFiles: state.downloadAllFiles');
    expect(mainSource).toContain('selectedSeriesIds: state.downloadAllFiles');
    expect(mainSource).toContain('seriesSelections: state.downloadAllFiles');
  });
});

describe("editable patient code and viewer link", () => {
  it("auto-classifies clipboard values without hijacking input mouse behavior", () => {
    expect(mainSource).not.toContain('data-action="paste-patient-id"');
    expect(mainSource).not.toContain('data-action="paste-direct-url"');
    expect(cssSource).not.toContain(".paste-field");
    expect(mainSource).toContain("async function fillFromClipboard");
    expect(mainSource).toContain('window.addEventListener("focus", autoPasteFromClipboard)');
    expect(mainSource).toContain("autoPasteFromClipboard();");
    expect(mainSource).not.toContain('field.addEventListener("mousedown"');
    expect(mainSource).not.toContain('field.addEventListener("mouseup"');
  });
});

describe("patient study selection", () => {
  it("defaults new/incomplete studies once and then preserves user edits", () => {
    const initial = initialiseStudySelections(studies);
    expect(selectedStudies(initial).map((study) => study.study_uid)).toEqual(["study-a", "study-b"]);

    initial[1].selected = false;
    const rerendered = initialiseStudySelections(initial);
    expect(selectedStudies(rerendered).map((study) => study.study_uid)).toEqual(["study-b"]);
  });

  it("requires a non-empty series mapping for every selected study", () => {
    const chosen = initialiseStudySelections(studies);
    const onlyFirstGroup = [{
      studyUid: "study-a",
      series: [{ id: "a-t1", selected: true }],
    }];
    expect(hasCompleteSeriesSelection(chosen, onlyFirstGroup)).toBe(false);

    const bothGroups = [...onlyFirstGroup, {
      studyUid: "study-b",
      series: [{ id: "b-t2", selected: true }],
    }];
    expect(hasCompleteSeriesSelection(chosen, bothGroups)).toBe(true);
    bothGroups[1].series[0].selected = false;
    expect(hasCompleteSeriesSelection(chosen, bothGroups)).toBe(false);
  });

  it("restores per-study series edits after a fresh inventory scan", () => {
    const groups = [{
      studyUid: "study-a",
      series: [{ id: "a-t1" }, { id: "a-t2" }],
    }];
    const selected = restoreSeriesSelections(groups, { "study-a": ["a-t2"] });
    expect(seriesSelections(selected)).toEqual({ "study-a": ["a-t2"] });
    expect(rememberSeriesSelections(selected)).toEqual({ "study-a": ["a-t2"] });
  });
});

describe("manual patient info UI contract", () => {
  it("keeps manual info state and inputs wired to downloadOptions and events", () => {
    // State properties
    expect(mainSource).toContain("showManualInfo: false");
    expect(mainSource).toContain('manualPatientName: ""');
    expect(mainSource).toContain('manualPatientId: ""');
    expect(mainSource).toContain('manualPatientDob: ""');

    // Markup & Form controls
    expect(mainSource).toContain('id="manual-info-toggle"');
    expect(mainSource).toContain('class="manual-info-panel"');
    expect(mainSource).toContain('id="manual-patient-name"');
    expect(mainSource).toContain('id="manual-patient-id"');
    expect(mainSource).toContain('id="manual-patient-dob"');

    // downloadOptions serialization
    expect(mainSource).toContain("if (state.showManualInfo)");
    expect(mainSource).toContain("options.manualInfo = {");
    expect(mainSource).toContain("patientName: state.manualPatientName");
    expect(mainSource).toContain("patientId: state.manualPatientId");
    expect(mainSource).toContain("patientDob: state.manualPatientDob");

    // Event listener bindings
    expect(mainSource).toContain('querySelector("#manual-info-toggle")?.addEventListener("change"');
    expect(mainSource).toContain('querySelector("#manual-patient-name")?.addEventListener("input"');
    expect(mainSource).toContain('querySelector("#manual-patient-id")?.addEventListener("input"');
    expect(mainSource).toContain('querySelector("#manual-patient-dob")?.addEventListener("input"');
  });

  it("ensures manual info CSS panel displays correctly with scoped design tokens", () => {
    const panelCss = cssSource.match(/\.manual-info-panel\s*\{[^}]*\}/)?.[0] ?? "";
    const inputCss = cssSource.match(/\.manual-info-panel input\s*\{[^}]*\}/)?.[0] ?? "";

    // Panel styling & display
    expect(panelCss).toContain("display: flex;");
    expect(panelCss).toContain("var(--panel-bg)");
    expect(panelCss).toContain("var(--field-border)");
    expect(cssSource).not.toContain(".manual-info-panel.open");

    // Input styling
    expect(inputCss).toContain("var(--field-bg)");
    expect(inputCss).toContain("var(--field-fg)");
    expect(inputCss).toContain("var(--field-border)");

    // No dead --color-* variables anywhere in the stylesheet
    expect(cssSource).not.toContain("var(--color-");
  });
});
