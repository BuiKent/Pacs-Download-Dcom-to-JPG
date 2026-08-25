// @vitest-environment jsdom

/**
 * Study filters and the read/unread mark.
 *
 * A reader works a list down: this modality, these dates, what is left unread.
 * The filters narrow the studies *inside* each patient row, so a patient with
 * four exams and one CT shows only the CT rather than the whole record.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  filteredPatientList,
  renderWorklistFilters,
  renderWorklistTreeInner,
  studyMatchesWorklistFilters,
} from "./main.js";

/** A date `days` ago, formatted the way the scanner reports it. */
function daysAgo(days) {
  const when = new Date();
  when.setDate(when.getDate() - days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(when.getDate())}/${pad(when.getMonth() + 1)}/${when.getFullYear()}`;
}

const PATIENT = {
  id: "p1",
  patientId: "R0152082B",
  patientName: "HOÀNG MINH THIỆP",
  folder: "D:\\Kho\\R0152082B",
  studies: [
    {
      id: "s-mr-new",
      studyDate: daysAgo(1),
      studyName: "MRI Brain",
      modality: "MR",
      folder: "D:\\Kho\\R0152082B\\2026-07-29 - MR - MRI Brain",
      status: "done",
      statusLabel: "Đã tải",
      isRead: false,
      mediaCounts: { dicom: 566, photo: 0, video: 0, doc: 0 },
    },
    {
      id: "s-ct",
      studyDate: daysAgo(2),
      studyName: "CT Brain",
      modality: "CT",
      folder: "D:\\Kho\\R0152082B\\2026-07-28 - CT - CT Brain",
      status: "done",
      statusLabel: "Đã tải",
      isRead: true,
      mediaCounts: { dicom: 197, photo: 0, video: 0, doc: 0 },
    },
    {
      id: "s-mr-old",
      studyDate: daysAgo(90),
      studyName: "MRI Brain",
      modality: "MR",
      folder: "D:\\Kho\\R0152082B\\2026-04-29 - MR - MRI Brain",
      status: "done",
      statusLabel: "Đã tải",
      isRead: false,
      mediaCounts: { dicom: 564, photo: 0, video: 0, doc: 0 },
    },
  ],
};

describe("Study List filters", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.worklistPatients = [structuredClone(PATIENT)];
    state.worklistLoaded = true;
    state.worklistLoading = false;
    state.worklistError = "";
    state.worklistSearch = "";
    state.worklistModality = "";
    state.worklistPeriod = "all";
    state.worklistRead = "all";
    state.expandedPatients = {};
  });

  it("shows every study when no filter is set", () => {
    expect(filteredPatientList()[0].studies).toHaveLength(3);
  });

  it("narrows to one modality without dropping the patient", () => {
    state.worklistModality = "CT";
    const [patient] = filteredPatientList();
    expect(patient.studies.map((s) => s.id)).toEqual(["s-ct"]);
  });

  it("hides a patient whose studies are all filtered out", () => {
    state.worklistModality = "US";
    expect(filteredPatientList()).toHaveLength(0);
  });

  it("limits the list to a period", () => {
    state.worklistPeriod = "week";
    const [patient] = filteredPatientList();
    expect(patient.studies.map((s) => s.id)).toEqual(["s-mr-new", "s-ct"]);
  });

  it("keeps a study whose date the scan never established", () => {
    // "Chưa rõ ngày" is not the same as "outside the range": hiding it would
    // quietly drop a record the reader still has to work through.
    state.worklistPeriod = "today";
    state.worklistPatients[0].studies.push({
      id: "s-undated",
      studyDate: "",
      modality: "MR",
      folder: "D:\\Kho\\R0152082B\\khong-ro-ngay",
      status: "done",
      isRead: false,
      mediaCounts: { dicom: 1, photo: 0, video: 0, doc: 0 },
    });
    expect(filteredPatientList()[0].studies.map((s) => s.id)).toContain("s-undated");
  });

  it("filters by read state in both directions", () => {
    state.worklistRead = "unread";
    expect(filteredPatientList()[0].studies.map((s) => s.id)).toEqual(["s-mr-new", "s-mr-old"]);
    state.worklistRead = "read";
    expect(filteredPatientList()[0].studies.map((s) => s.id)).toEqual(["s-ct"]);
  });

  it("combines filters", () => {
    state.worklistModality = "MR";
    state.worklistPeriod = "week";
    state.worklistRead = "unread";
    expect(filteredPatientList()[0].studies.map((s) => s.id)).toEqual(["s-mr-new"]);
  });

  it("judges one study on its own", () => {
    state.worklistModality = "CT";
    expect(studyMatchesWorklistFilters(PATIENT.studies[1])).toBe(true);
    expect(studyMatchesWorklistFilters(PATIENT.studies[0])).toBe(false);
  });
});

describe("Study List filter bar", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.worklistPatients = [structuredClone(PATIENT)];
    state.worklistModality = "";
    state.worklistPeriod = "all";
    state.worklistRead = "all";
  });

  it("offers only the modalities the archive actually holds", () => {
    const html = renderWorklistFilters();
    expect(html).toContain('value="MR"');
    expect(html).toContain('value="CT"');
    expect(html).not.toContain('value="US"');
  });

  it("counts what is still unread", () => {
    expect(renderWorklistFilters()).toContain("2 ca chưa đọc");
  });

  it("only offers to clear filters while one is set", () => {
    expect(renderWorklistFilters()).not.toContain("clear-worklist-filters");
    state.worklistRead = "unread";
    expect(renderWorklistFilters()).toContain("clear-worklist-filters");
  });
});

describe("Study rows carry their read state", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.worklistPatients = [structuredClone(PATIENT)];
    state.worklistModality = "";
    state.worklistPeriod = "all";
    state.worklistRead = "all";
    state.expandedPatients = {};
  });

  it("marks unread and read rows differently", () => {
    const html = renderWorklistTreeInner();
    expect(html).toContain('class="srow unread"');
    expect(html).toContain('class="srow read"');
  });

  it("offers a toggle that names what it will do", () => {
    const html = renderWorklistTreeInner();
    expect(html).toContain('data-action="toggle-study-read"');
    expect(html).toContain("Đánh dấu đã đọc");
    expect(html).toContain("Bỏ đánh dấu đã đọc");
  });
});
