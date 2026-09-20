// @vitest-environment jsdom

/**
 * The reading the classification makes of a clinical record, on screen.
 *
 * `neuro_oncology` on the Python side decides what a record means and has its
 * own tests for the rules. What is defended here is the half that a rule test
 * cannot reach: that the reading arrives at the card, that it is drawn so the
 * derived part cannot be mistaken for the typed part, and that the form offers
 * the vocabulary the rules are written against.
 *
 * Three things in particular, each with an obvious wrong answer that would look
 * right:
 *
 *   A grade the molecular result outranks is shown twice, next to the rule
 *   that moved it. Drawing only the derived grade would erase what the
 *   pathologist wrote; drawing only the recorded one would leave a grade 4
 *   tumour on a grade 2 pathway.
 *
 *   A contradiction between two recorded facts is drawn as a contradiction,
 *   and the contradicted marker stays out of the diagnosis line, so a reader
 *   skimming the card cannot take it for a finding.
 *
 *   A protocol carries its dose and its citation. The name alone is the part
 *   the reader already knew.
 *
 * Every interaction below goes through a real DOM event on the real node. The
 * card repaints itself with `outerHTML` on every structural change, which is
 * exactly where a listener goes missing and a test that called the handler
 * directly would not notice.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import { state, render } from "./main.js";
import { clinicalState, resetClinicalState } from "./clinical.js";

const originalFetch = global.fetch;

function mountApp() {
  if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
  render();
  return document.querySelector("#app");
}

function card() {
  return document.querySelector("#app .dx-card");
}

function form() {
  return document.querySelector("#app #workspace .dx-workspace");
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function press(selector) {
  const button = document.querySelector(selector);
  expect(button, `no button matched ${selector}`).not.toBeNull();
  button.click();
  await settle();
  return button;
}

function type(node, value) {
  expect(node, "field is missing").not.toBeNull();
  node.value = value;
  node.dispatchEvent(new window.Event("input", { bubbles: true }));
  node.dispatchEvent(new window.Event("change", { bubbles: true }));
}

const ASTRO = "U sao bào, IDH đột biến";
const GBM = "U nguyên bào thần kinh đệm, IDH tự nhiên";

/**
 * The vocabulary as the Python side serves it.
 *
 * Trimmed to what these tests drive, and deliberately spelled exactly as
 * `neuro_oncology.MARKERS` spells it — the rules compare the stored result
 * exactly, so a form offering different wording is a field that can be filled
 * in correctly and still mean nothing.
 */
const VOCABULARY = {
  compartments: ["Nội sọ", "Tuỷ sống"],
  locations: { "Nội sọ": ["Thuỳ trán"], "Tuỷ sống": ["Nón tuỷ"] },
  axes: { "Nội sọ": ["Trong trục"], "Tuỷ sống": ["Nội tuỷ"] },
  sides: ["P", "T", "Giữa", "Hai bên"],
  histologies: [ASTRO, GBM],
  grades: ["1", "2", "3", "4"],
  gradesByHistology: { [ASTRO]: ["2", "3", "4"], [GBM]: ["4"] },
  histologyGroups: { [ASTRO]: "U thần kinh đệm", [GBM]: "U thần kinh đệm" },
  molecularMarkers: ["IDH1/2", "1p/19q", "CDKN2A/B", "ATRX", "MGMT"],
  markerGroups: { "U thần kinh đệm": ["IDH1/2", "1p/19q", "CDKN2A/B", "ATRX", "MGMT"] },
  markerResults: {
    "1p/19q": ["Đồng mất", "Không đồng mất", "Chưa làm"],
    "IDH1/2": [
      "Đột biến",
      "Không đột biến (đã giải trình tự)",
      "IHC R132H âm tính (chưa giải trình tự)",
      "Chưa làm",
    ],
    "CDKN2A/B": ["Mất đồng hợp tử", "Không mất đồng hợp tử", "Chưa làm"],
    "ATRX": ["Mất biểu hiện", "Còn biểu hiện", "Chưa làm"],
    "MGMT": ["Methyl hoá", "Không methyl hoá", "Chưa làm"],
  },
  markerNotes: {
    "IDH1/2": "IHC chỉ bắt được IDH1 R132H. IHC âm tính chưa phải IDH tự nhiên, trừ u độ 4 ở bệnh nhân từ 55 tuổi trở lên.",
  },
  markerUnits: {},
  workup: {
    // The nested pair is "any one of these": ATRX and 1p/19q each rule out
    // codeletion, so a record carrying one is not missing the other.
    [ASTRO]: { essential: ["IDH1/2", ["ATRX", "1p/19q"], "CDKN2A/B"], useful: ["MGMT"] },
  },
  diagnosisBases: ["Hình ảnh", "Mô bệnh học"],
  eventKinds: ["Mổ", "Xạ", "Hoá", "Theo dõi", "Tái phát/Tiến triển"],
  resectionExtents: ["Lấy toàn bộ"],
  radiotherapyTechniques: ["IMRT"],
  chemoRegimens: ["Temozolomide đồng thời"],
};

/** An assessment shaped as `neuro_oncology.assess` returns it. */
function reading(parts = {}) {
  return {
    line: "",
    grade: { grade: "", recorded: "", source: "recorded", rule: "" },
    conflicts: [],
    missing: [],
    integrated: false,
    protocols: { route: "", preferred: [], conditional: [] },
    ...parts,
  };
}

const STUPP = {
  id: "stupp",
  name: "Phác đồ Stupp",
  kind: "Xạ + Hoá",
  detail: "Xạ 60 Gy chia 30 phân liều, temozolomide 75 mg/m²/ngày đồng thời; sau đó temozolomide 150-200 mg/m² ngày 1-5 mỗi 28 ngày",
  cycles: "6 chu kỳ bổ trợ",
  reference: "Stupp R. và cs., N Engl J Med 2005;352:987-996",
};

describe("The reading beside a tumour", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "tab-1";
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
    state.tabs = [];
    state.worklistPatients = [];
    state.selectedId = "";
    state.archive = {
      root: "D:/Kho/2607009886",
      patient: { patientId: "2607009886", patientName: "NGUYEN VAN A" },
      series: [],
    };
    resetClinicalState();
    clinicalState.vocabulary = VOCABULARY;
    clinicalState.loadedFor = "D:/Kho/2607009886::2607009886";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("draws nothing at all while nothing has been assessed", () => {
    // A tumour with no reading is the ordinary case for an archive recorded
    // before any of this existed, and it must not sprout an empty panel.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: "U màng não", grade: "1", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [];
    mountApp();

    expect(card().querySelector(".dx-reading")).toBeNull();
    expect(card().textContent).toContain("U màng não");
  });

  it("puts the integrated line and its badge on the card", () => {
    clinicalState.record = {
      tumors: [{ id: "t1", histology: ASTRO, grade: "3", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến — mất ATRX, CNS WHO độ 3",
      grade: { grade: "3", recorded: "3", source: "recorded", rule: "" },
      integrated: true,
    })];
    mountApp();

    const block = card().querySelector(".dx-reading");
    expect(block).not.toBeNull();
    expect(block.querySelector(".dx-integrated-line").textContent)
      .toContain("mất ATRX, CNS WHO độ 3");
    const flag = block.querySelector(".dx-integrated-flag");
    expect(flag.classList.contains("done")).toBe(true);
    expect(flag.textContent.trim()).toBe("Chẩn đoán tích hợp");
  });

  it("says a diagnosis is not integrated rather than leaving the question open", () => {
    clinicalState.record = {
      tumors: [{ id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến, CNS WHO độ 2",
      grade: { grade: "2", recorded: "2", source: "recorded", rule: "" },
      missing: [{ markers: ["CDKN2A/B"], essential: true, declined: false, unreadable: false, note: "" }],
    })];
    mountApp();

    const flag = card().querySelector(".dx-integrated-flag");
    expect(flag.classList.contains("pending")).toBe(true);
    expect(flag.textContent.trim()).toBe("Chưa tích hợp");
  });

  it("shows both grades when a molecular result outranks the one recorded", () => {
    // The whole point of the block. Overwriting the recorded grade would erase
    // the pathology report; dropping the derived one would leave a grade 4
    // tumour on a grade 2 pathway. Both are drawn, and the rule that moved it
    // is named so the disagreement can be checked.
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử" },
      }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến — mất đồng hợp tử CDKN2A/B, CNS WHO độ 4",
      grade: {
        grade: "4", recorded: "2", source: "molecular",
        rule: "Mất đồng hợp tử CDKN2A/B trong u sao bào IDH đột biến là tiêu chuẩn độ 4 của WHO CNS5, không phụ thuộc mô học.",
      },
    })];
    mountApp();

    const escalated = card().querySelector(".dx-escalated");
    expect(escalated).not.toBeNull();
    expect(escalated.textContent).toContain("Độ đã ghi 2");
    expect(escalated.textContent).toContain("theo phân tử là độ 4");
    expect(escalated.textContent).toContain("CDKN2A/B");
    // The record itself keeps saying what was typed into it.
    expect(card().textContent).toContain("U sao bào, IDH đột biến (độ 2)");
  });

  it("leaves the escalation panel off when the two grades agree", () => {
    clinicalState.record = {
      tumors: [{ id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào thần kinh đệm, IDH tự nhiên, CNS WHO độ 4",
      grade: { grade: "4", recorded: "4", source: "recorded", rule: "" },
      integrated: true,
    })];
    mountApp();

    expect(card().querySelector(".dx-escalated")).toBeNull();
  });

  it("draws a contradiction as a contradiction", () => {
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "Đột biến" },
      }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào thần kinh đệm, IDH tự nhiên, CNS WHO độ 4",
      conflicts: [{
        marker: "IDH1/2",
        result: "Đột biến",
        text: "Tên chẩn đoán ghi IDH tự nhiên nhưng kết quả xét nghiệm là đột biến.",
      }],
    })];
    mountApp();

    const conflicts = card().querySelector(".dx-conflicts");
    expect(conflicts).not.toBeNull();
    expect(conflicts.textContent).toContain("IDH1/2");
    expect(conflicts.textContent).toContain("kết quả xét nghiệm là đột biến");
    // The contradicted marker is kept out of the diagnosis line, so a reader
    // skimming the card cannot take it for a finding.
    expect(card().querySelector(".dx-integrated-line").textContent)
      .not.toContain("— IDH đột biến");
  });

  it("keeps the essential gaps apart from the merely useful ones", () => {
    // Without an essential test there is no integrated diagnosis at all; a
    // useful one changes management without changing what the tumour is. A
    // list that ran them together would send somebody chasing MGMT with the
    // same urgency as IDH.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến, CNS WHO độ 2",
      missing: [
        { markers: ["CDKN2A/B"], essential: true, declined: false, unreadable: false, note: "" },
        { markers: ["MGMT"], essential: false, declined: false, unreadable: false, note: "" },
      ],
    })];
    mountApp();

    const need = card().querySelector(".dx-gap.need");
    const extra = card().querySelector(".dx-gap.extra");
    expect(need.textContent).toContain("Bắt buộc còn thiếu");
    expect(need.textContent).toContain("CDKN2A/B");
    expect(need.textContent).not.toContain("MGMT");
    expect(extra.textContent).toContain("Nên có");
    expect(extra.textContent).toContain("MGMT");
  });

  it("marks a declined test as declined and still counts it as missing", () => {
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "CDKN2A/B": "Chưa làm" },
      }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến, CNS WHO độ 2",
      missing: [{ markers: ["CDKN2A/B"], essential: true, declined: true, unreadable: false, note: "" }],
    })];
    mountApp();

    const item = card().querySelector(".dx-gap.need .dx-gap-item");
    expect(item.classList.contains("declined")).toBe(true);
    expect(item.textContent).toContain("chưa làm");
    expect(card().querySelector(".dx-integrated-flag").classList.contains("pending")).toBe(true);
  });

  it("tells a field that needs tidying apart from a test that needs ordering", () => {
    // Three outstanding states, three different errands. An unreadable field
    // already holds the answer and is the one a reader can finish on the spot,
    // so it must not be drawn as though nobody had run the test.
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "chờ kết quả giải trình tự" },
      }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến, CNS WHO độ 2",
      missing: [
        { markers: ["IDH1/2"], essential: true, declined: false, unreadable: true, note: "" },
        { markers: ["CDKN2A/B"], essential: true, declined: false, unreadable: false, note: "" },
      ],
    })];
    mountApp();

    const items = [...card().querySelectorAll(".dx-gap.need .dx-gap-item")];
    const unreadable = items.find((node) => node.textContent.includes("IDH1/2"));
    const absent = items.find((node) => node.textContent.includes("CDKN2A/B"));

    expect(unreadable.classList.contains("unreadable")).toBe(true);
    expect(unreadable.classList.contains("declined")).toBe(false);
    expect(unreadable.textContent).toContain("chưa đọc được");
    expect(unreadable.getAttribute("title")).toContain("không khớp đáp án nào");

    // A marker nobody has recorded carries no qualifier at all.
    expect(absent.classList.contains("unreadable")).toBe(false);
    expect(absent.textContent.trim()).toBe("CDKN2A/B");
  });

  it("gives a protocol its dose, its schedule and its paper", () => {
    // A regimen name on its own is the part the reader already knew.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào thần kinh đệm, IDH tự nhiên, CNS WHO độ 4",
      integrated: true,
      protocols: { route: "gbm", preferred: [STUPP], conditional: [] },
    })];
    mountApp();

    const rx = card().querySelector(".dx-rx.preferred .dx-rx-item");
    expect(rx).not.toBeNull();
    expect(rx.querySelector("b").textContent).toContain("Stupp");
    expect(rx.querySelector(".dx-rx-detail").textContent).toContain("60 Gy");
    expect(rx.querySelector(".dx-rx-detail").textContent).toContain("75 mg/m²");
    expect(rx.querySelector(".dx-rx-cycles").textContent).toContain("6 chu kỳ");
    expect(rx.querySelector(".dx-rx-ref").textContent).toContain("N Engl J Med 2005");
  });

  it("keeps a conditional regimen apart from the standard one", () => {
    clinicalState.record = {
      tumors: [{ id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào thần kinh đệm, IDH tự nhiên, CNS WHO độ 4",
      integrated: true,
      protocols: {
        route: "gbm",
        preferred: [STUPP],
        conditional: [{
          id: "hypo_rt_tmz",
          name: "Xạ giảm phân liều ± temozolomide",
          kind: "Xạ + Hoá",
          detail: "Xạ 40 Gy chia 15 phân liều, kèm temozolomide đồng thời và bổ trợ",
          cycles: "",
          when: "Bệnh nhân từ 65-70 tuổi trở lên hoặc thể trạng kém",
          reference: "Perry JR. và cs., N Engl J Med 2017;376:1027-1037",
        }],
      },
    })];
    mountApp();

    expect(card().querySelector(".dx-rx.preferred")).not.toBeNull();
    const conditional = card().querySelector(".dx-rx.conditional");
    expect(conditional.textContent).toContain("Cân nhắc theo bối cảnh");
    // The condition is stated, not left for the reader to infer.
    expect(conditional.querySelector(".dx-rx-when").textContent).toContain("65-70 tuổi");
  });

  it("offers nothing rather than a guess for an entity with no rule", () => {
    // Somebody handed no protocol looks it up. Somebody handed a plausible one
    // for an entity the app never recognised may not.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: "U nguyên bào mạch máu", grade: "1", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào mạch máu, CNS WHO độ 1",
      integrated: true,
    })];
    mountApp();

    expect(card().querySelector(".dx-rx")).toBeNull();
    expect(card().querySelector(".dx-reading")).not.toBeNull();
  });

  it("reads each tumour against its own assessment, in order", () => {
    clinicalState.record = {
      tumors: [
        { id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học", molecular: {} },
        { id: "t2", histology: "U màng não", grade: "1", basis: "Mô bệnh học", molecular: {} },
      ],
      events: [],
    };
    clinicalState.assessment = [
      reading({ line: "Dòng của khối u thứ nhất", integrated: true }),
      reading({ line: "Dòng của khối u thứ hai" }),
    ];
    mountApp();

    const lines = [...card().querySelectorAll(".dx-integrated-line")].map((n) => n.textContent.trim());
    expect(lines).toEqual(["Dòng của khối u thứ nhất", "Dòng của khối u thứ hai"]);
    const flags = [...card().querySelectorAll(".dx-integrated-flag")];
    expect(flags[0].classList.contains("done")).toBe(true);
    expect(flags[1].classList.contains("pending")).toBe(true);
  });

  it("names a pair of alternatives in the reader's language", () => {
    setLanguage("en");
    clinicalState.record = {
      tumors: [{ id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến, CNS WHO độ 2",
      missing: [{ markers: ["ATRX", "1p/19q"], essential: true, declined: false, unreadable: false, note: "" }],
    })];
    mountApp();

    expect(card().querySelector(".dx-gap.need .dx-gap-item").textContent.trim())
      .toBe("ATRX or 1p/19q");
  });

  it("reads the reading out in English when the interface is English", () => {
    // The line itself is Vietnamese clinical text and stays as recorded; the
    // labels around it are interface, and they follow the language on screen.
    setLanguage("en");
    clinicalState.record = {
      tumors: [{ id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào thần kinh đệm, IDH tự nhiên, CNS WHO độ 4",
      integrated: true,
      protocols: { route: "gbm", preferred: [STUPP], conditional: [] },
    })];
    mountApp();

    expect(card().querySelector(".dx-integrated-flag").textContent.trim())
      .toBe("Integrated diagnosis");
    expect(card().querySelector(".dx-rx-label").textContent.trim()).toBe("Standard protocol");
    expect(card().querySelector(".dx-rx-item b").textContent.trim()).toBe("Stupp protocol");
    // The dose is not translated: it is written the same way in both languages,
    // and a translated dose is a dose somebody has retyped.
    expect(card().querySelector(".dx-rx-detail").textContent).toContain("60 Gy");
  });

  it("reads the rule that outranked a grade out in English too", () => {
    // A reader told that a grade moved has to be able to read why. The rule
    // travels inside the assessment rather than in the form vocabulary, so it
    // reaches the screen through the same translator by a different route.
    setLanguage("en");
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử" },
      }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U sao bào, IDH đột biến — mất đồng hợp tử CDKN2A/B, CNS WHO độ 4",
      grade: {
        grade: "4", recorded: "2", source: "molecular",
        rule: "Mất đồng hợp tử CDKN2A/B trong u sao bào IDH đột biến là tiêu chuẩn độ 4 của WHO CNS5, không phụ thuộc mô học.",
      },
    })];
    mountApp();

    const escalated = card().querySelector(".dx-escalated");
    expect(escalated.textContent).toContain("Recorded grade 2");
    expect(escalated.textContent).toContain("Homozygous CDKN2A/B deletion");
    expect(escalated.textContent).not.toContain("tiêu chuẩn độ 4");
  });

  it("reads a contradiction out in English too", () => {
    setLanguage("en");
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: GBM, grade: "4", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "Đột biến" },
      }],
      events: [],
    };
    clinicalState.assessment = [reading({
      line: "U nguyên bào thần kinh đệm, IDH tự nhiên, CNS WHO độ 4",
      conflicts: [{
        marker: "IDH1/2",
        result: "Đột biến",
        text: "Tên chẩn đoán ghi IDH tự nhiên nhưng kết quả xét nghiệm là đột biến.",
      }],
    })];
    mountApp();

    expect(card().querySelector(".dx-conflicts").textContent)
      .toContain("named IDH-wildtype but the test result is mutant");
  });
});

describe("The molecular section of the form", () => {
  beforeEach(() => {
    setLanguage("vi");
    state.activeTabId = "tab-1";
    state.editingPatientInfo = false;
    state.patientEditDraft = null;
    state.tabs = [];
    state.worklistPatients = [];
    state.selectedId = "";
    state.archive = {
      root: "D:/Kho/2607009886",
      patient: { patientId: "2607009886", patientName: "NGUYEN VAN A" },
      series: [],
    };
    resetClinicalState();
    clinicalState.vocabulary = VOCABULARY;
    clinicalState.loadedFor = "D:/Kho/2607009886::2607009886";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("offers the marker's own answers, not an empty box", async () => {
    // Free text made this section unreadable by anything but a human: "(-)",
    // "am tinh", "wildtype" and "không đột biến" are one answer written four
    // ways, and no rule can be written against that.
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "" },
      }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    const result = form().querySelector("[data-clinical-field='molecularValue']");
    const list = form().querySelector(`#${result.getAttribute("list")}`);
    expect(list, "the result field offers no list").not.toBeNull();
    const offered = [...list.querySelectorAll("option")].map((o) => o.value);
    expect(offered).toContain("Đột biến");
    expect(offered).toContain("Không đột biến (đã giải trình tự)");
    // The two negatives stay apart: IHC sees IDH1 R132H alone, so a negative
    // stain has not excluded the substitutions that decide the diagnosis.
    expect(offered).toContain("IHC R132H âm tính (chưa giải trình tự)");
    expect(offered).toContain("Chưa làm");
  });

  it("still takes an answer the list does not have", async () => {
    // A pathology report that says something else is the reason every
    // vocabulary in this form is open, and this one is no different.
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "" },
      }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    const result = form().querySelector("[data-clinical-field='molecularValue']");
    expect(result.tagName).toBe("INPUT");
    type(result, "nghi ngờ đột biến, chờ giải trình tự lại");

    expect(clinicalState.draft.tumors[0].molecular["IDH1/2"])
      .toBe("nghi ngờ đột biến, chờ giải trình tự lại");
  });

  it("says under the row what a negative antibody has and has not excluded", async () => {
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "IHC R132H âm tính (chưa giải trình tự)" },
      }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    expect(form().querySelector(".dxf-marker-note").textContent)
      .toContain("IHC âm tính chưa phải IDH tự nhiên");
  });

  it("names the tests this diagnosis still needs, where they can be added", async () => {
    // Shown inside the form as well as on the card, because this is the one
    // moment somebody can act on it: the marker rows are right there.
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "Đột biến" },
      }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    const hint = form().querySelector(".dxf-workup");
    expect(hint).not.toBeNull();
    const need = hint.querySelector(".dxf-workup-need").textContent;
    // One requirement, not two: either test rules out codeletion.
    expect(need).toContain("ATRX hoặc 1p/19q");
    expect(need).toContain("CDKN2A/B");
    // Already recorded, so it is not asked for again.
    expect(need).not.toContain("IDH1/2");
    expect(hint.querySelector(".dxf-workup-extra").textContent).toContain("MGMT");
  });

  it("stops asking for the pair once either of them is recorded", async () => {
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: { "IDH1/2": "Đột biến", "1p/19q": "Không đồng mất" },
      }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    const need = form().querySelector(".dxf-workup-need").textContent;
    expect(need).not.toContain("ATRX");
    expect(need).toContain("CDKN2A/B");
  });

  it("stops asking once the work-up is complete", async () => {
    clinicalState.record = {
      tumors: [{
        id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học",
        molecular: {
          "IDH1/2": "Đột biến",
          "ATRX": "Mất biểu hiện",
          "CDKN2A/B": "Không mất đồng hợp tử",
          "MGMT": "Methyl hoá",
        },
      }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    expect(form().querySelector(".dxf-workup")).toBeNull();
  });

  it("asks for nothing at all when the entity has no work-up rule", async () => {
    // Fails closed rather than inventing a panel. A colloid cyst has no
    // molecular work-up, and asking for one would put a permanent unmet
    // warning on a finished diagnosis.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: "Nang keo", grade: "", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");

    expect(form().querySelector(".dxf-workup")).toBeNull();
  });

  it("follows the diagnosis when the diagnosis is retyped", async () => {
    // The work-up belongs to the entity, so changing the entity has to change
    // what is being asked for. A hint left over from the previous diagnosis is
    // a list of tests for a tumour this patient does not have.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: "Nang keo", grade: "", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");
    expect(form().querySelector(".dxf-workup")).toBeNull();

    type(form().querySelector("[data-clinical-field='histology']"), ASTRO);
    await settle();

    const hint = form().querySelector(".dxf-workup");
    expect(hint, "the work-up did not follow the new diagnosis").not.toBeNull();
    expect(hint.textContent).toContain("CDKN2A/B");
  });

  it("keeps the marker buttons alive after the section repaints", async () => {
    // The form replaces its own markup on every structural change, and this
    // section now renders a datalist and a note per row. A binder that ran
    // once would leave the second press dead.
    clinicalState.record = {
      tumors: [{ id: "t1", histology: ASTRO, grade: "2", basis: "Mô bệnh học", molecular: {} }],
      events: [],
    };
    mountApp();
    await press("[data-action='edit-record']");
    await press("[data-action='clinical-add-marker']");
    await press("[data-action='clinical-add-marker']");

    expect(Object.keys(clinicalState.draft.tumors[0].molecular)).toHaveLength(2);
    expect(form().querySelectorAll(".dxf-molecular-row")).toHaveLength(2);

    await press(".dxf-molecular-row[data-molecular-index='1'] [data-action='clinical-remove-marker']");
    expect(Object.keys(clinicalState.draft.tumors[0].molecular)).toHaveLength(1);
  });
});
