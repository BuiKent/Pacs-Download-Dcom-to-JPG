// @vitest-environment jsdom

/**
 * What the clinical form does to itself when a dropdown is changed.
 *
 * Three fields redraw the form, because each decides what the fields under it
 * ask about: the compartment picks the location list, the diagnosis picks the
 * grades, and the treatment kind picks between fractions and cycles. The
 * redraw is a wholesale `outerHTML` swap of the pane, which is fine as long as
 * it happens once and the person does not lose their place in it.
 *
 * It was doing neither. A `<select>` fires `input` and then `change` for a
 * single choice, and both were redrawing, so one selection repainted the pane
 * twice. The second pass was handed the node the first pass had already
 * detached: it could not tell whether the caret had been in it, so it restored
 * nothing and focus fell back to the body. On top of that nothing carried the
 * scroll offset across, so choosing a treatment kind halfway down the form
 * threw the person back to the top of it. Together that is what read as the
 * pane flashing on every edit.
 *
 * jsdom does not lay anything out, so scroll is asserted in the browser smoke
 * test where the pane has a real height. What is asserted here is the part
 * jsdom can see honestly: how many times the pane is replaced, and where the
 * focus lands afterwards.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setLanguage } from "./i18n.js";
import { state, render } from "./main.js";
import { clinicalState, resetClinicalState, applyFieldEdit } from "./clinical.js";

const originalFetch = global.fetch;

function mountApp() {
  if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
  render();
  return document.querySelector("#app");
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

/**
 * Count how many times the pane is replaced wholesale.
 *
 * A `MutationObserver` rather than a spy, because what matters is what the
 * document actually did — a spy would still report one call while the DOM was
 * rebuilt twice underneath it.
 */
function countPaneRepaints() {
  const counter = { count: 0 };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1 && node.classList?.contains("dx-workspace")) {
          counter.count += 1;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  counter.stop = () => observer.disconnect();
  return counter;
}

/** Choose from a `<select>` the way a browser reports it: `input`, then `change`. */
function choose(node, value) {
  expect(node, "field is missing").not.toBeNull();
  node.focus();
  node.value = value;
  node.dispatchEvent(new window.Event("input", { bubbles: true }));
  node.dispatchEvent(new window.Event("change", { bubbles: true }));
}

const VOCABULARY = {
  compartments: ["Nội sọ", "Tuỷ sống"],
  locations: { "Nội sọ": ["Thuỳ chẩm"], "Tuỷ sống": ["Nón tuỷ", "C1-C2"] },
  axes: { "Nội sọ": ["Trong trục"], "Tuỷ sống": ["Nội tuỷ"] },
  sides: ["P", "T", "Giữa", "Hai bên"],
  histologies: ["U màng não"],
  grades: ["1", "2", "3", "4"],
  gradesByHistology: { "U màng não": ["1", "2", "3"] },
  histologyGroups: { "U màng não": "U màng não và u trung mô" },
  molecularMarkers: ["IDH1/2"],
  markerGroups: {}, markerResults: {}, markerNotes: {}, markerUnits: {}, workup: {},
  diagnosisBases: ["Hình ảnh", "Mô bệnh học"],
  eventKinds: ["Mổ", "Xạ", "Hoá", "Theo dõi"],
  resectionExtents: ["Lấy toàn bộ"],
  radiotherapyTechniques: ["IMRT"],
  chemoRegimens: ["Temozolomide đồng thời"],
};

describe("Choosing from a dropdown in the clinical form", () => {
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
    clinicalState.record = {
      tumors: [{ id: "t1", histology: "U màng não", grade: "1", compartment: "Nội sọ", molecular: {} }],
      events: [{ id: "e1", kind: "Mổ", start: "2026-07-10", end: "2026-07-10" }],
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("repaints the pane once for one choice of treatment kind, not twice", async () => {
    mountApp();
    await press("[data-action='edit-record']");

    const paints = countPaneRepaints();
    choose(form().querySelector("[data-clinical-field='kind']"), "Xạ");
    await settle();
    paints.stop();

    expect(paints.count).toBe(1);
    // And the redraw still did its job: radiotherapy asks about fractions.
    expect(form().querySelector("[data-clinical-field='fractions']")).not.toBeNull();
  });

  it("leaves the caret in the dropdown that was just changed", async () => {
    // The second repaint was handed a detached node, could not tell where the
    // caret had been, and dropped focus to the body. Keyboard users lost their
    // place in the form on every choice.
    mountApp();
    await press("[data-action='edit-record']");

    choose(form().querySelector("[data-clinical-field='kind']"), "Xạ");
    await settle();

    expect(document.activeElement?.dataset?.clinicalField).toBe("kind");
  });

  it("repaints once for the compartment too, and keeps the caret", async () => {
    mountApp();
    await press("[data-action='edit-record']");

    const paints = countPaneRepaints();
    choose(form().querySelector("[data-clinical-field='compartment']"), "Tuỷ sống");
    await settle();
    paints.stop();

    expect(paints.count).toBe(1);
    expect(document.activeElement?.dataset?.clinicalField).toBe("compartment");
    // The list under it belongs to the new compartment.
    const location = form().querySelector("[data-clinical-field='location']");
    const list = form().querySelector(`#${location.getAttribute("list")}`);
    expect([...list.querySelectorAll("option")].map((o) => o.value)).toContain("C1-C2");
  });

  it("does not repaint at all for a field that decides nothing below it", async () => {
    // Typing a hospital name or a dose changes no other field's list, so the
    // pane has no reason to be rebuilt under the person typing.
    mountApp();
    await press("[data-action='edit-record']");
    choose(form().querySelector("[data-clinical-field='kind']"), "Xạ");
    await settle();

    const paints = countPaneRepaints();
    const where = form().querySelector("[data-clinical-field='where']");
    where.value = "BV K Tân Triều";
    where.dispatchEvent(new window.Event("input", { bubbles: true }));
    const dose = form().querySelector("[data-clinical-field='doseGy']");
    dose.value = "60";
    dose.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle();
    paints.stop();

    expect(paints.count).toBe(0);
    expect(clinicalState.draft.events[0].where).toBe("BV K Tân Triều");
    expect(clinicalState.draft.events[0].doseGy).toBe(60);
  });

  it("writes the chosen value on the first event and redraws on the second", async () => {
    // The two events a browser sends for one choice have different jobs:
    // `input` records what was picked, `change` is when the form may be
    // rebuilt around it. Both must write, or a value picked with the mouse
    // would depend on which event happened to arrive.
    const draft = { tumors: [], events: [{ id: "e1", kind: "Mổ" }] };
    clinicalState.draft = draft;
    const node = document.createElement("select");
    node.dataset.clinicalField = "kind";
    const wrapper = document.createElement("div");
    wrapper.dataset.eventIndex = "0";
    wrapper.append(node);
    node.innerHTML = '<option value="Xạ"></option>';
    node.value = "Xạ";

    expect(applyFieldEdit(node, "input")).toBe(false);
    expect(draft.events[0].kind).toBe("Xạ");
    expect(applyFieldEdit(node, "change")).toBe(true);
    expect(draft.events[0].kind).toBe("Xạ");
  });
});
