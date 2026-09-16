// @vitest-environment jsdom

/**
 * The clinical record card, driven the way a doctor drives it.
 *
 * Every interaction below goes through a real DOM event on the real node — a
 * `click()` on the button that is on screen, an `input` event on the field
 * that was typed into. Calling `action("save-clinical")` directly would prove
 * the handler and nothing about whether the button the doctor presses ever
 * reaches it, and this card repaints itself with `outerHTML` on every
 * structural change, which is exactly the situation where a listener goes
 * missing and a test that skips the DOM does not notice.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import {
  state,
  refreshTimelinePhases,
  render,
  renderWorklistTreeInner,
  filteredPatientList,
} from "./main.js";
import {
  clinicalState,
  resetClinicalState,
  stageChip,
  studyPhase,
  phaseChip,
  intervalLabel,
  dateKeyToIso,
  eventPeriod,
  eventDetail,
  tumorHeading,
  emptyRecord,
  emptyStage,
} from "./clinical.js";

const originalFetch = global.fetch;

/**
 * Put the whole shell on screen, the way the app does.
 *
 * Not the rail alone any more: the form opens in the reading pane, so a test
 * that mounted only the rail would be driving a card whose pencil leads
 * somewhere that does not exist.
 */
function mountApp() {
  if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
  render();
  return document.querySelector("#app");
}

/** The summary in the patient rail. */
function card() {
  return document.querySelector("#app .dx-card");
}

/** The form, in the pane where the images otherwise are. */
function form() {
  return document.querySelector("#app #workspace .dx-workspace");
}

/** Let every repaint the press set off finish. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Press a button the way a person does, then let the repaint settle. */
async function press(selector) {
  const button = document.querySelector(selector);
  expect(button, `no button matched ${selector}`).not.toBeNull();
  button.click();
  await settle();
  return button;
}

/** Type into a field and fire the event the browser fires. */
function type(node, value) {
  expect(node, "field is missing").not.toBeNull();
  node.value = value;
  node.dispatchEvent(new window.Event("input", { bubbles: true }));
  node.dispatchEvent(new window.Event("change", { bubbles: true }));
}

const VOCABULARY = {
  compartments: ["Nội sọ", "Tuỷ sống"],
  locations: { "Nội sọ": ["Thuỳ chẩm", "Thuỳ trán"], "Tuỷ sống": ["Nón tuỷ"] },
  axes: { "Nội sọ": ["Trong trục", "Ngoài trục"], "Tuỷ sống": ["Nội tuỷ"] },
  sides: ["P", "T", "Giữa", "Hai bên"],
  histologies: ["U màng não", "U nguyên bào thần kinh đệm, IDH tự nhiên"],
  grades: ["1", "2", "3", "4"],
  molecularMarkers: ["IDH1/2", "MGMT"],
  diagnosisBases: ["Hình ảnh", "Mô bệnh học"],
  eventKinds: ["Mổ", "Xạ", "Hoá", "Theo dõi", "Tái phát/Tiến triển"],
  resectionExtents: ["Lấy toàn bộ", "Sinh thiết"],
  radiotherapyTechniques: ["IMRT", "VMAT"],
  chemoRegimens: ["Temozolomide đồng thời"],
};

describe("Clinical record card", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "tab-1";
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
    state.tabs = [];
    state.worklistPatients = [];
    state.selectedId = "";
    state.archive = {
      root: "D:\\Kho\\2607009886",
      patient: { patientId: "2607009886", patientName: "NGUYEN VAN A" },
      series: [],
    };
    resetClinicalState();
    clinicalState.vocabulary = VOCABULARY;
    // `render()` is what normally fetches the record; the rail is mounted on
    // its own here, so the state it would have left behind is set directly.
    clinicalState.loadedFor = "D:\\Kho\\2607009886::2607009886";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("says nothing has been recorded rather than showing an empty form", () => {
    mountApp();
    expect(card()).not.toBeNull();
    expect(card().textContent).toContain("Chưa ghi hồ sơ lâm sàng cho bệnh nhân này");
    // No stage chip at all: a patient nobody has recorded anything about is not
    // "theo dõi", and a chip that guesses reads as a plan that exists.
    expect(card().querySelector(".dx-stage-chip")).toBeNull();
  });

  it("opens the form in the reading pane, not inside the rail card", async () => {
    // The rail column is 246px wide and `.rec-card` hides its overflow, so a
    // form unfolded in there was squashed by the flex column with nothing left
    // to scroll — the fields below the fold could not be reached at all.
    mountApp();
    await press("[data-action='edit-clinical']");

    expect(clinicalState.editing).toBe(true);
    expect(form()).not.toBeNull();
    expect(form().querySelector("[data-action='clinical-add-tumor']")).not.toBeNull();
    expect(form().querySelector("[data-action='save-clinical']")).not.toBeNull();
    // Nothing to type into in the rail: the card is the summary.
    expect(card().querySelector("[data-clinical-field]")).toBeNull();
    expect(card().textContent).toContain("Đang sửa ở khung bên phải");
  });

  it("gives the reading pane back when the form is closed", async () => {
    mountApp();
    await press("[data-action='edit-clinical']");
    expect(form()).not.toBeNull();

    await press("[data-action='cancel-clinical']");

    expect(clinicalState.editing).toBe(false);
    expect(form()).toBeNull();
    expect(card().querySelector("[data-action='edit-clinical']")).not.toBeNull();
  });

  it("keeps its buttons alive after the card repaints itself", async () => {
    // The card replaces its own markup with `outerHTML` on every structural
    // change. A binder that runs once would leave the second press dead.
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");
    await press("[data-action='clinical-add-tumor']");

    expect(clinicalState.draft.tumors).toHaveLength(2);
    // Scoped to the blocks: the "Xoá" and "Thêm dấu ấn" buttons inside each
    // one carry the same index attribute.
    expect(form().querySelectorAll(".dxf-block[data-tumor-index]")).toHaveLength(2);
  });

  it("presses a button once per click and not twice", async () => {
    // `bindEvents` sweeps every [data-action] in the shell and the form binds
    // its own; without the shared WeakSet one press added two tumours.
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");

    expect(clinicalState.draft.tumors).toHaveLength(1);
  });

  it("offers a list and still takes a diagnosis typed in full", async () => {
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");

    const histology = form().querySelector("[data-clinical-field='histology']");
    // A combobox, not a select: the list is on the element, and the value is
    // whatever the person leaves in it.
    expect(histology.tagName).toBe("INPUT");
    expect(document.getElementById(histology.getAttribute("list"))).not.toBeNull();

    type(histology, "U tế bào hình sao kiểu hiếm, chưa phân loại");
    expect(clinicalState.draft.tumors[0].histology)
      .toBe("U tế bào hình sao kiểu hiếm, chưa phân loại");
  });

  it("swaps the location list when the compartment changes", async () => {
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");

    type(form().querySelector("[data-clinical-field='compartment']"), "Tuỷ sống");

    const listId = form().querySelector("[data-clinical-field='location']").getAttribute("list");
    const options = [...document.getElementById(listId).querySelectorAll("option")]
      .map((option) => option.value);
    expect(options).toContain("Nón tuỷ");
    expect(options).not.toContain("Thuỳ chẩm");
  });

  it("asks about fractions for radiotherapy and about cycles for chemotherapy", async () => {
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-event']");

    type(form().querySelector("[data-clinical-field='kind']"), "Xạ");
    expect(form().querySelector("[data-clinical-field='fractions']")).not.toBeNull();
    expect(form().querySelector("[data-clinical-field='cycles']")).toBeNull();

    type(form().querySelector("[data-clinical-field='kind']"), "Hoá");
    expect(form().querySelector("[data-clinical-field='cycles']")).not.toBeNull();
    expect(form().querySelector("[data-clinical-field='fractions']")).toBeNull();
  });

  it("sends what was typed, and shows what came back", async () => {
    const saved = {
      record: {
        tumors: [{
          id: "t1", compartment: "Nội sọ", location: "Thuỳ chẩm", side: "P",
          axis: "Trong trục", histology: "U nguyên bào thần kinh đệm, IDH tự nhiên",
          grade: "4", molecular: {}, basis: "Mô bệnh học", confirmedAt: "2026-07-14",
          note: "",
        }],
        events: [{
          id: "e1", kind: "Xạ", start: "2026-08-20", end: "", where: "BV K Tân Triều",
          technique: "IMRT", fractions: 30, doseGy: 60, note: "",
        }],
      },
      stage: {
        state: "active", kinds: ["Xạ"], where: "BV K Tân Triều",
        since: "2026-08-20", stale: false, expectedEnd: "2026-10-01",
      },
      label: "U nguyên bào thần kinh đệm, IDH tự nhiên (độ 4) · Thuỳ chẩm P",
    };
    let sent = null;
    global.fetch = vi.fn(async (_url, options) => {
      sent = JSON.parse(options.body);
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => saved,
      };
    });

    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");
    type(form().querySelector("[data-clinical-field='histology']"),
      "U nguyên bào thần kinh đệm, IDH tự nhiên");
    type(form().querySelector("[data-clinical-field='grade']"), "4");
    await press("[data-action='save-clinical']");
    await Promise.resolve();
    await Promise.resolve();

    // The write names the record on screen, so the backend can refuse it if the
    // folder turns out to belong to somebody else.
    expect(sent.patientId).toBe("2607009886");
    expect(sent.archiveRoot).toBe("D:\\Kho\\2607009886");
    expect(sent.record.tumors[0].histology).toBe("U nguyên bào thần kinh đệm, IDH tự nhiên");

    expect(clinicalState.editing).toBe(false);
    expect(card().textContent).toContain("U nguyên bào thần kinh đệm, IDH tự nhiên (độ 4)");
    expect(card().querySelector(".dx-stage-chip").textContent.trim()).toBe("Đang xạ");
  });

  it("throws the draft away when the edit is cancelled", async () => {
    clinicalState.record = {
      tumors: [{ id: "t1", histology: "U màng não", grade: "1", molecular: {} }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-clinical']");
    type(form().querySelector("[data-clinical-field='histology']"), "Nhập nhầm rồi");
    await press("[data-action='cancel-clinical']");

    expect(clinicalState.draft).toBeNull();
    expect(clinicalState.record.tumors[0].histology).toBe("U màng não");
    expect(card().textContent).toContain("U màng não");
    expect(card().textContent).not.toContain("Nhập nhầm rồi");
  });

  it("drops a marker nobody put a result against", async () => {
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");
    type(form().querySelector("[data-clinical-field='histology']"), "U màng não");
    await press("[data-action='clinical-add-marker']");

    type(form().querySelector("[data-clinical-field='molecularName']"), "MGMT");
    // The result field is left empty on purpose: naming a test is not the same
    // as having its answer, and the record must not imply the second.
    let sent = null;
    global.fetch = vi.fn(async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, headers: { get: () => "application/json" }, json: async () => ({}) };
    });
    await press("[data-action='save-clinical']");
    await Promise.resolve();

    expect(sent.record.tumors[0].molecular).toEqual({});
  });

  it("offers no pencil where the record would have nowhere to live", () => {
    // A folder with no patient-index.json cannot hold a clinical record.
    // Opening one is ordinary — operative photos, an old import — so the card
    // says so and leaves the edit off, instead of offering a save that the
    // backend would refuse.
    clinicalState.canWrite = false;
    clinicalState.reason = "Hồ sơ này chưa có patient-index.json nên chưa xem hồ sơ lâm sàng được.";
    mountApp();

    expect(card().querySelector("[data-action='edit-clinical']")).toBeNull();
    expect(card().textContent).toContain("patient-index.json");
  });

  it("keeps what was typed when a study is opened mid-entry", async () => {
    // Glancing at a film should not cost the doctor the half-filled form. The
    // pane goes back to the images and the draft waits behind the pencil.
    state.archive.series = [{
      id: "s1", timelineKey: "mr", studyDate: "20260806", mediaType: "dicom",
      modality: "MR", studyDescription: "MR sọ não", sliceCount: 20,
    }];
    state.selectedId = "s1";
    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='clinical-add-tumor']");
    type(form().querySelector("[data-clinical-field='histology']"), "U màng não");

    const strip = document.querySelector("#app .series-card[data-series-id='s1']");
    expect(strip, "no series card to click").not.toBeNull();
    strip.click();
    await settle();

    expect(clinicalState.editing).toBe(false);
    expect(form()).toBeNull();
    expect(clinicalState.draft.tumors[0].histology).toBe("U màng não");
    expect(card().textContent).toContain("Còn bản sửa chưa lưu");

    // Reopening resumes the draft rather than starting again from the record.
    await press("[data-action='edit-clinical']");
    expect(form().querySelector("[data-clinical-field='histology']").value)
      .toBe("U màng não");
  });

  it("says a save failed in the form rather than over the images", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Từ chối ghi: hồ sơ trên màn hình là X" }),
    }));

    mountApp();
    await press("[data-action='edit-clinical']");
    await press("[data-action='save-clinical']");
    await Promise.resolve();
    await Promise.resolve();

    expect(form().querySelector(".dxf-error").textContent).toContain("Từ chối ghi");
    // Still in the form, so nothing typed is lost to a failed write.
    expect(clinicalState.editing).toBe(true);
  });
});

describe("Treatment stage, as a chip", () => {
  beforeEach(() => setLanguage("vi"));

  it("shows nothing when nothing has been recorded", () => {
    expect(stageChip(emptyStage())).toBeNull();
    expect(stageChip(null)).toBeNull();
  });

  it("names concurrent chemoradiotherapy as one line", () => {
    const chip = stageChip({ state: "active", kinds: ["Xạ", "Hoá"], where: "BV K Tân Triều" });
    expect(chip.text).toBe("Đang xạ + hoá");
    expect(chip.tone).toBe("active");
    expect(chip.title).toContain("BV K Tân Triều");
  });

  it("marks a course that has outrun its own length", () => {
    const chip = stageChip({ state: "active", kinds: ["Xạ"], stale: true });
    expect(chip.text).toContain("chưa cập nhật");
    expect(chip.tone).toBe("stale");
  });

  it("names the other stages", () => {
    expect(stageChip({ state: "post-op", kinds: ["Mổ"] }).text).toBe("Hậu phẫu");
    expect(stageChip({ state: "followup", kinds: [] }).text).toBe("Theo dõi");
    expect(stageChip({ state: "relapse", kinds: [] }).text).toBe("Tái phát");
  });
});

describe("Reading one event", () => {
  beforeEach(() => setLanguage("vi"));

  it("reads an open course as running from its start date", () => {
    expect(eventPeriod({ start: "2026-08-20", end: "" })).toBe("từ 20/08/2026");
    expect(eventPeriod({ start: "2026-07-10", end: "2026-07-10" })).toBe("10/07/2026");
    expect(eventPeriod({ start: "2026-07-10", end: "2026-07-14" })).toBe("10/07/2026 – 14/07/2026");
    expect(eventPeriod({})).toBe("Chưa rõ ngày");
  });

  it("builds the detail line only out of what was entered", () => {
    expect(eventDetail({ technique: "IMRT", doseGy: 60, fractions: 30 }))
      .toBe("IMRT · 60 Gy · 30 buổi");
    expect(eventDetail({ regimen: "Temozolomide bổ trợ", cycles: 6, cyclesDone: 3 }))
      .toBe("Temozolomide bổ trợ · 3/6");
    expect(eventDetail({})).toBe("");
  });

  it("never fills a heading with a placeholder", () => {
    expect(tumorHeading({ histology: "U màng não", grade: "1" })).toBe("U màng não (độ 1)");
    expect(tumorHeading({ histology: "U màng não" })).toBe("U màng não");
    expect(tumorHeading({ location: "Thuỳ trán", side: "T" })).toBe("Thuỳ trán T");
    expect(tumorHeading({})).toBe("Khối u chưa mô tả");
  });
});

describe("Treatment stage on the worklist", () => {
  const patient = (overrides) => ({
    id: "p1",
    patientId: "2607009886",
    patientName: "NGUYEN VAN A",
    folder: "D:\\Kho\\2607009886",
    studies: [{
      id: "s1", studyDate: "06/08/2026", studyName: "MR sọ não", modality: "MR",
      folder: "D:\\Kho\\2607009886\\mr", status: "done", statusLabel: "Đã tải",
      isRead: false, mediaCounts: { dicom: 41, photo: 0, video: 0, doc: 0 },
    }],
    ...overrides,
  });

  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "worklist";
    state.worklistTab = "studies";
    state.worklistSearch = "";
    state.worklistModality = "";
    state.worklistPeriod = "all";
    state.worklistRead = "all";
    state.worklistStage = "";
    state.expandedPatients = {};
    state.worklistPatients = [
      patient({
        id: "p1",
        treatmentStage: { state: "active", kinds: ["Xạ"], where: "BV K Tân Triều", stale: false },
      }),
      patient({ id: "p2", treatmentStage: { state: "followup", kinds: [] } }),
      patient({ id: "p3" }),
    ];
  });

  it("badges the row with where the patient is now", () => {
    document.body.innerHTML = `<div id="app">${renderWorklistTreeInner()}</div>`;
    const badges = [...document.querySelectorAll(".prow .badge-stage")]
      .map((el) => el.textContent.trim());
    expect(badges).toEqual(["Đang xạ", "Theo dõi"]);
    expect(document.querySelector(".prow .badge-stage").classList.contains("active")).toBe(true);
  });

  it("narrows the list to one stage", () => {
    state.worklistStage = "active";
    expect(filteredPatientList().map((p) => p.id)).toEqual(["p1"]);
  });

  it("can list the patients nobody has recorded anything about", () => {
    // Worth its own filter: that list is exactly the work still to be done.
    state.worklistStage = "unknown";
    expect(filteredPatientList().map((p) => p.id)).toEqual(["p3"]);
  });

  it("shows every stage when the filter is cleared", () => {
    state.worklistStage = "";
    expect(filteredPatientList()).toHaveLength(3);
  });
});

describe("Where a study sits in the treatment around it", () => {
  beforeEach(() => setLanguage("vi"));

  const SURGERY = { kind: "Mổ", start: "2026-07-10", end: "2026-07-10" };
  const RT_CLOSED = { kind: "Xạ", start: "2026-08-01", end: "2026-09-10", expectedEnd: "" };
  const RT_OPEN = { kind: "Xạ", start: "2026-08-01", end: "", expectedEnd: "2026-09-12" };
  const TODAY = { today: "2026-12-01" };

  it("says nothing when there is nothing to measure against", () => {
    // An interval from no known event is not an interval.
    expect(studyPhase([], "2026-08-01", TODAY)).toBeNull();
    expect(studyPhase([SURGERY], "", TODAY)).toBeNull();
    expect(studyPhase([SURGERY], "khong-ro", TODAY)).toBeNull();
  });

  it("places a study before everything that was done", () => {
    const phase = studyPhase([SURGERY, RT_CLOSED], "2026-07-01", TODAY);
    expect(phase.phase).toBe("before");
    expect(phase.kind).toBe("Mổ");
    expect(phaseChip(phase).text).toBe("Trước mổ");
  });

  it("places a study inside a course that was still running", () => {
    const phase = studyPhase([SURGERY, RT_CLOSED], "2026-08-20", TODAY);
    expect(phase.phase).toBe("during");
    expect(phase.kind).toBe("Xạ");
    expect(phaseChip(phase).text).toBe("Trong đợt xạ");
    expect(phaseChip(phase).tone).toBe("during");
  });

  it("measures from the most recent thing that had finished", () => {
    const phase = studyPhase([SURGERY], "2026-07-22", TODAY);
    expect(phase.phase).toBe("after");
    expect(phase.kind).toBe("Mổ");
    expect(phase.days).toBe(12);
    expect(phaseChip(phase).text).toBe("Sau mổ 12 ngày");
  });

  it("flags a scan inside the twelve weeks after radiotherapy", () => {
    // Not a reading of the scan — a statement of where it sits in time, so an
    // enlarging enhancement is weighed against treatment effect first.
    const phase = studyPhase([SURGERY, RT_CLOSED], "2026-10-15", TODAY);
    expect(phase.pseudoprogression).toBe(true);
    const chip = phaseChip(phase);
    expect(chip.tone).toBe("pseudo");
    expect(chip.text).toBe("Sau xạ 5 tuần");
    expect(chip.title).toContain("giả tiến triển");
  });

  it("stops flagging once the window has passed", () => {
    const phase = studyPhase([SURGERY, RT_CLOSED], "2027-02-01", TODAY);
    expect(phase.pseudoprogression).toBe(false);
    expect(phaseChip(phase).tone).toBe("after");
  });

  it("never flags a scan after an operation alone", () => {
    expect(studyPhase([SURGERY], "2026-07-22", TODAY).pseudoprogression).toBe(false);
  });

  it("marks an interval counted from an end date nobody confirmed", () => {
    // The course is still open; its end was worked out from the fraction
    // count. A reader is entitled to know which of the two they are reading.
    const phase = studyPhase([RT_OPEN], "2026-10-15", TODAY);
    expect(phase.phase).toBe("after");
    expect(phase.estimated).toBe(true);
    expect(phaseChip(phase).title).toContain("ước tính");
  });

  it("reads an interval in the unit a person would say it in", () => {
    expect(intervalLabel(0)).toBe("cùng ngày");
    expect(intervalLabel(9)).toBe("9 ngày");
    expect(intervalLabel(35)).toBe("5 tuần");
    expect(intervalLabel(180)).toBe("6 tháng");
    expect(intervalLabel(-1)).toBe("");
  });

  it("converts the key the timeline uses into the one the record uses", () => {
    expect(dateKeyToIso("20260806")).toBe("2026-08-06");
    expect(dateKeyToIso("")).toBe("");
    expect(dateKeyToIso("2026-08-06")).toBe("");
  });
});

describe("The phase on a timeline row", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "tab-1";
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
    state.tabs = [];
    state.worklistPatients = [];
    state.selectedId = "s1";
    state.archive = {
      root: "D:/Kho/2607009886",
      patient: { patientId: "2607009886" },
      series: [
        { id: "s1", timelineKey: "mr-pre", studyDate: "20260701", mediaType: "dicom",
          modality: "MR", studyDescription: "MR sọ não trước mổ", sliceCount: 100 },
        { id: "s2", timelineKey: "mr-post", studyDate: "20261015", mediaType: "dicom",
          modality: "MR", studyDescription: "MR sọ não theo dõi", sliceCount: 100 },
      ],
    };
    resetClinicalState();
    clinicalState.vocabulary = VOCABULARY;
    clinicalState.loadedFor = "D:/Kho/2607009886::2607009886";
  });

  it("fills the chip on each row once the record is in hand", () => {
    clinicalState.record = {
      tumors: [],
      events: [
        { id: "e1", kind: "Xạ", start: "2026-08-01", end: "2026-09-10", expectedEnd: "" },
        { id: "e2", kind: "Mổ", start: "2026-07-10", end: "2026-07-10" },
      ],
    };
    mountApp();
    refreshTimelinePhases();

    const chips = [...document.querySelectorAll(".tl-phase")]
      .filter((node) => !node.hidden)
      .map((node) => node.textContent.trim());
    expect(chips).toContain("Trước mổ");
    expect(chips).toContain("Sau xạ 5 tuần");
    expect(document.querySelector(".tl-phase.pseudo")).not.toBeNull();
  });

  it("leaves every chip hidden while nothing has been recorded", () => {
    mountApp();
    refreshTimelinePhases();

    const shown = [...document.querySelectorAll(".tl-phase")].filter((node) => !node.hidden);
    expect(shown).toHaveLength(0);
  });

  it("leaves the button that opens the study working", () => {
    // The chip is filled in place for this reason: rewriting the row would
    // take the open button and the rename field with it.
    clinicalState.record = {
      tumors: [],
      events: [{ id: "e1", kind: "Mổ", start: "2026-07-10", end: "2026-07-10" }],
    };
    mountApp();
    refreshTimelinePhases();

    expect(document.querySelectorAll(".tl-item .tl-open[data-series-id]").length).toBe(2);
    expect(document.querySelectorAll(".tl-item .tl-name-input").length).toBe(2);
  });
});

describe("An empty record", () => {
  it("is a shape, not a null", () => {
    expect(emptyRecord()).toEqual({ tumors: [], events: [] });
    expect(emptyStage().state).toBe("unknown");
  });
});
