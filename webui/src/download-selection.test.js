import { describe, expect, it } from "vitest";
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
