/**
 * The clinical record: what the tumour is, and what has been done about it.
 *
 * Three layers, and they are not interchangeable:
 *
 *   tumours  entered field by field, so the list can be filtered by histology
 *            or grade rather than searched as prose
 *   events   surgery, radiotherapy, chemotherapy — each with where it happened
 *            and when it started and ended
 *   note     free text, which still lives on `patient-index.json` where it
 *            always has, and is edited by the card above this one
 *
 * The current treatment stage is never typed and never stored. `treatment_stage`
 * on the Python side works it out from the events every time a row is drawn,
 * so a course stops being reported as running the moment somebody closes it,
 * and an open course that has run well past its own stated length is reported
 * as out of date rather than as still going.
 *
 * Every dropdown here accepts typed text as well as a listed value. A
 * controlled vocabulary of thirty entities cannot cover a pathology report, and
 * a form that will not take the real answer gets a wrong one instead.
 */

import { t, tf, tc, tcPicker, CLINICAL_EN } from "./i18n.js";
import { escapeHtml } from "./html.js";

/** Blank stage, for a patient nothing has been recorded about yet. */
export function emptyStage() {
  return { state: "unknown", kinds: [], where: "", since: "", stale: false, expectedEnd: "" };
}

export function emptyRecord() {
  return { tumors: [], events: [] };
}

export const clinicalState = {
  loading: false,
  saving: false,
  error: "",
  /** The archive root the record on screen belongs to, so a tab switch reloads. */
  loadedFor: "",
  record: emptyRecord(),
  stage: emptyStage(),
  /**
   * What the record *means*, one entry per tumour, in the same order.
   *
   * Derived by `neuro_oncology` on the Python side and never stored, so the
   * reading is recomputed from the markers on every load rather than frozen at
   * the moment somebody pressed save. Held apart from `record` for the same
   * reason it is not stored: the record is what a doctor typed, and this is
   * what the classification makes of it, and the two are allowed to disagree.
   */
  assessment: [],
  /**
   * The same reading, taken of the draft being typed rather than of the record
   * on disk.
   *
   * A recommendation that only appears after save is a recommendation nobody
   * sees: the moment it is worth reading is the moment the marker goes in.
   * Kept apart from `assessment` so the card beside the form keeps showing
   * what is actually saved while the form shows what is being typed.
   */
  draftAssessment: [],
  label: "",
  vocabulary: null,
  editing: false,
  draft: null,
  /**
   * Fields being typed into instead of chosen from, as `m:0:IDH1/2`, `h:0`.
   *
   * A listed answer is what the rules read, so the list is the default. But a
   * pathology report that says something the list cannot say still has to be
   * recordable, and this is which fields have been switched over to a text
   * box for it. Emptied when the record is, so one patient's exceptions do
   * not follow the next patient into the form.
   */
  freeFields: new Set(),
  /**
   * Whether this folder can hold a clinical record at all.
   *
   * A folder with no `patient-index.json` has nowhere to keep one. Opening
   * such a folder is ordinary, so the card says so quietly and leaves the
   * pencil off, rather than offering an edit the save would refuse.
   */
  canWrite: true,
  reason: "",
};

export function resetClinicalState() {
  clinicalState.loading = false;
  clinicalState.saving = false;
  clinicalState.error = "";
  clinicalState.loadedFor = "";
  clinicalState.record = emptyRecord();
  clinicalState.stage = emptyStage();
  clinicalState.assessment = [];
  clinicalState.draftAssessment = [];
  clinicalState.label = "";
  clinicalState.editing = false;
  clinicalState.draft = null;
  clinicalState.freeFields = new Set();
  clinicalState.canWrite = true;
  clinicalState.reason = "";
}

// ---------------------------------------------------------------------------
// The stage, as a chip
// ---------------------------------------------------------------------------

// Read as a whole phrase for the first treatment and as a bare word for the
// ones running alongside it, so concurrent chemoradiotherapy reads "Đang xạ +
// hoá" rather than "Đang xạ + Đang hoá".
const ONGOING_PHRASE = {
  "Xạ": "Đang xạ",
  "Hoá": "Đang hoá",
  "Đích/Miễn dịch": "Đang điều trị đích",
};
const ONGOING_SHORT = {
  "Xạ": "xạ",
  "Hoá": "hoá",
  "Đích/Miễn dịch": "đích",
};

/**
 * What to put on the row, or nothing at all.
 *
 * `unknown` returns null on purpose. A patient with no events recorded is not
 * "chờ mổ" and not "theo dõi" — nobody has said, and a chip that guesses would
 * be read as a plan that exists.
 */
export function stageChip(stage) {
  const value = stage && typeof stage === "object" ? stage : emptyStage();
  const kinds = Array.isArray(value.kinds) ? value.kinds : [];
  const where = String(value.where || "").trim();
  let text = "";
  let tone = "";

  if (value.state === "relapse") {
    text = t("Tái phát");
    tone = "relapse";
  } else if (value.state === "active" && kinds.length) {
    const [first, ...rest] = kinds;
    const head = t(ONGOING_PHRASE[first] || first);
    const tail = rest.map((kind) => t(ONGOING_SHORT[kind] || kind));
    text = [head, ...tail].join(" + ");
    tone = "active";
  } else if (value.state === "post-op") {
    text = t("Hậu phẫu");
    tone = "postop";
  } else if (value.state === "followup") {
    text = t("Theo dõi");
    tone = "followup";
  } else {
    return null;
  }

  // An open course that has outrun its own stated length says so rather than
  // going on asserting a treatment that may well have finished in between.
  if (value.stale) {
    tone = "stale";
    text = `${text} · ${t("chưa cập nhật")}`;
  }

  const parts = [text];
  if (where) parts.push(where);
  if (value.since) parts.push(tf("từ {}", formatDate(value.since)));
  return { text, tone, where, title: parts.join(" · ") };
}

/** `YYYY-MM-DD` as the date a Vietnamese chart is written in. */
export function formatDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

/** "10/07/2026 – 14/07/2026", or "từ 20/08/2026" while a course is open. */
export function eventPeriod(event) {
  const start = formatDate(event?.start);
  const end = formatDate(event?.end);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  if (start) return tf("từ {}", start);
  if (end) return tf("đến {}", end);
  return t("Chưa rõ ngày");
}

/** The detail line of an event, built only out of what was actually entered. */
export function eventDetail(event) {
  const item = event || {};
  const parts = [];
  if (item.extent) parts.push(tc(item.extent));
  if (item.technique) parts.push(tc(item.technique));
  if (item.regimen) parts.push(tc(item.regimen));
  if (Number.isFinite(item.doseGy) && item.doseGy > 0) parts.push(`${item.doseGy} Gy`);
  if (Number.isFinite(item.fractions) && item.fractions > 0) {
    parts.push(tf("{} buổi", item.fractions));
  }
  if (Number.isFinite(item.cycles) && item.cycles > 0) {
    const done = Number.isFinite(item.cyclesDone) ? item.cyclesDone : null;
    parts.push(done === null ? tf("{} chu kỳ", item.cycles) : `${done}/${item.cycles}`);
  }
  if (item.note) parts.push(item.note);
  return parts.join(" · ");
}

/** "Thuỳ chẩm P · Trong trục" — the site of one tumour, minus what is unknown. */
export function tumorSite(tumor) {
  const item = tumor || {};
  const place = [item.location, item.side].map((v) => tc(v)).filter(Boolean).join(" ");
  return [place, tc(item.axis)].filter(Boolean).join(" · ");
}

/** "U nguyên bào thần kinh đệm (độ 4)", or as much of it as is known. */
export function tumorHeading(tumor) {
  const item = tumor || {};
  const histology = tc(item.histology);
  const grade = String(item.grade || "").trim();
  if (histology && grade) return tf("{} (độ {})", histology, grade);
  if (histology) return histology;
  if (grade) return tf("Độ {}", grade);
  return tumorSite(item) || t("Khối u chưa mô tả");
}

// ---------------------------------------------------------------------------
// Where one study sits in the treatment it belongs to
// ---------------------------------------------------------------------------

// Read as whole phrases rather than assembled from a preposition and a kind,
// so each one can be translated as the phrase a clinician actually says.
const PHASE_BEFORE = {
  "Mổ": "Trước mổ",
  "Xạ": "Trước xạ",
  "Hoá": "Trước hoá",
  "Đích/Miễn dịch": "Trước điều trị đích",
};
const PHASE_DURING = {
  "Xạ": "Trong đợt xạ",
  "Hoá": "Trong đợt hoá",
  "Đích/Miễn dịch": "Trong đợt điều trị đích",
};
const PHASE_AFTER = {
  "Mổ": "Sau mổ",
  "Xạ": "Sau xạ",
  "Hoá": "Sau hoá",
  "Đích/Miễn dịch": "Sau điều trị đích",
  "Tái phát/Tiến triển": "Sau khi ghi tái phát",
  "Biến chứng": "Sau biến chứng",
  "Theo dõi": "Sau lần khám",
};

/**
 * How long after radiotherapy an enlarging enhancement may still be treatment
 * effect rather than tumour.
 *
 * Twelve weeks is the window the response criteria draw around the end of
 * chemoradiation. The flag is a reminder of where the scan sits in time — it
 * is not a reading of the scan, and the card says so.
 */
export const PSEUDOPROGRESSION_WINDOW_DAYS = 84;

/** `YYYYMMDD` as the timeline keys it, to `YYYY-MM-DD` as the record dates it. */
export function dateKeyToIso(dateKey) {
  const text = String(dateKey || "").trim();
  if (!/^\d{8}$/.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * When a course stopped, as far as the record can say.
 *
 * A closed course gives its end date. An open one gives the end its own
 * fraction count implies, and `estimated` marks that difference: a scan dated
 * "five weeks after radiotherapy" reads very differently when the five weeks
 * were counted from a date nobody confirmed.
 */
function courseEnd(event) {
  if (event.end) return { date: event.end, estimated: false };
  if (event.expectedEnd) return { date: event.expectedEnd, estimated: true };
  return { date: "", estimated: false };
}

/**
 * Where a study sits among the things done to the patient.
 *
 * Worked out from the dates every time, never stored on the study. A scan
 * tagged "sau mổ" by hand stays tagged that way after a second operation, and
 * a reader who trusts the tag is reading the wrong interval.
 *
 * Returns null when nothing has been recorded to measure against, because an
 * interval from no known event is not an interval.
 */
export function studyPhase(events, studyDateIso, { today = "" } = {}) {
  const date = String(studyDateIso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const list = (Array.isArray(events) ? events : []).filter(
    (event) => event && typeof event === "object" && event.start,
  );
  if (!list.length) return null;

  // A course the study fell inside. Still-open courses count: the record says
  // they had not stopped by today, and the study is not in the future.
  const now = today || new Date().toISOString().slice(0, 10);
  const inside = list.find((event) => {
    if (!PHASE_DURING[event.kind]) return false;
    if (event.start > date) return false;
    const finished = event.end || (event.expectedEnd && event.expectedEnd < now ? event.expectedEnd : "");
    return !finished || finished >= date;
  });
  if (inside) {
    return {
      phase: "during",
      kind: inside.kind,
      anchorDate: inside.start,
      days: daysBetween(inside.start, date),
      estimated: false,
      pseudoprogression: false,
    };
  }

  // Otherwise the most recent thing that had finished by then.
  let latest = null;
  for (const event of list) {
    const { date: ended, estimated } = courseEnd(event);
    const when = ended || event.start;
    if (when > date) continue;
    if (!latest || when > latest.when) latest = { event, when, estimated };
  }
  if (latest) {
    const days = daysBetween(latest.when, date);
    return {
      phase: "after",
      kind: latest.event.kind,
      anchorDate: latest.when,
      days,
      estimated: latest.estimated,
      // Only after radiotherapy, and only for the window the response criteria
      // draw. Everything else is an interval, stated plainly.
      pseudoprogression: latest.event.kind === "Xạ"
        && days !== null
        && days >= 0
        && days <= PSEUDOPROGRESSION_WINDOW_DAYS,
    };
  }

  // Nothing had happened yet: the study is earlier than every recorded event.
  const earliest = list.reduce((a, b) => (a.start <= b.start ? a : b));
  return {
    phase: "before",
    kind: earliest.kind,
    anchorDate: earliest.start,
    days: daysBetween(date, earliest.start),
    estimated: false,
    pseudoprogression: false,
  };
}

/** An interval in the unit a person would say it in. */
export function intervalLabel(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value === 0) return t("cùng ngày");
  if (value < 14) return tf("{} ngày", value);
  if (value < 70) return tf("{} tuần", Math.round(value / 7));
  return tf("{} tháng", Math.round(value / 30));
}

/** The chip a timeline row carries, or nothing when there is nothing to say. */
export function phaseChip(phase) {
  if (!phase || typeof phase !== "object") return null;
  const interval = intervalLabel(phase.days);
  let text = "";
  let tone = "";

  if (phase.phase === "during") {
    text = t(PHASE_DURING[phase.kind] || phase.kind);
    tone = "during";
  } else if (phase.phase === "before") {
    text = t(PHASE_BEFORE[phase.kind] || phase.kind);
    tone = "before";
  } else {
    const head = t(PHASE_AFTER[phase.kind] || phase.kind);
    text = interval ? `${head} ${interval}` : head;
    tone = "after";
  }

  const notes = [];
  if (phase.estimated) {
    // The interval was measured from a date the record worked out rather than
    // one anybody confirmed, and a reader is entitled to know which.
    notes.push(t("Ngày kết thúc là ước tính từ số buổi xạ, chưa ai xác nhận."));
  }
  if (phase.pseudoprogression) {
    tone = "pseudo";
    notes.push(t("Nằm trong 12 tuần sau xạ — cân nhắc giả tiến triển trước khi kết luận tiến triển."));
  }
  return { text, tone, title: [text, ...notes].join(" · "), estimated: Boolean(phase.estimated) };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

let localIdCounter = 0;
function localId(prefix) {
  localIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${localIdCounter}`;
}

export function blankTumor() {
  return {
    id: localId("t"),
    compartment: "",
    location: "",
    side: "",
    axis: "",
    histology: "",
    grade: "",
    molecular: {},
    basis: "",
    confirmedAt: "",
    source: "",
    note: "",
  };
}

export function blankEvent(kind = "") {
  return {
    id: localId("e"),
    kind,
    start: "",
    end: "",
    where: "",
    extent: "",
    technique: "",
    regimen: "",
    doseGy: null,
    fractions: null,
    cycles: null,
    cyclesDone: null,
    note: "",
  };
}

/** A working copy, so cancelling an edit really does leave nothing behind. */
export function draftFrom(record) {
  const source = record && typeof record === "object" ? record : emptyRecord();
  return {
    tumors: (source.tumors || []).map((tumor) => ({
      ...blankTumor(),
      ...tumor,
      molecular: { ...(tumor.molecular || {}) },
    })),
    events: (source.events || []).map((event) => ({ ...blankEvent(), ...event })),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The lists the form offers, or empty ones until the API answers. */
function vocab() {
  const value = clinicalState.vocabulary;
  return {
    compartments: value?.compartments || [],
    locations: value?.locations || {},
    axes: value?.axes || {},
    sides: value?.sides || [],
    histologies: value?.histologies || [],
    histologyGroups: value?.histologyGroups || {},
    grades: value?.grades || [],
    gradesByHistology: value?.gradesByHistology || {},
    molecularMarkers: value?.molecularMarkers || [],
    markerGroups: value?.markerGroups || {},
    markerResults: value?.markerResults || {},
    markerNotes: value?.markerNotes || {},
    markerUnits: value?.markerUnits || {},
    workup: value?.workup || {},
    diagnosisBases: value?.diagnosisBases || [],
    eventKinds: value?.eventKinds || [],
    resectionExtents: value?.resectionExtents || [],
    radiotherapyTechniques: value?.radiotherapyTechniques || [],
    chemoRegimens: value?.chemoRegimens || [],
  };
}

/**
 * The list a combo box offers.
 *
 * `hintFor` fills each entry's `label`, which the browser draws greyed beside
 * the value. That is where the standard English name goes: the list itself
 * stays Vietnamese, because the Vietnamese is what gets stored, while the line
 * a reader scans also carries the name their pathology report was written in.
 */
function datalist(id, options, hintFor = null) {
  return `<datalist id="${escapeHtml(id)}">${
    (options || []).map((option) => {
      const hint = hintFor ? hintFor(option) : "";
      return `<option value="${escapeHtml(option)}"${
        hint ? ` label="${escapeHtml(hint)}"` : ""}></option>`;
    }).join("")
  }</datalist>`;
}

/**
 * The grades one diagnosis can carry, and the already-recorded one besides.
 *
 * A glioblastoma is grade 4 and an oligodendroglioma is 2 or 3, so offering
 * all four against either of them is offering a combination that does not
 * exist. A diagnosis the table says nothing about — a metastasis, a colloid
 * cyst, anything typed off a report — keeps the whole range.
 *
 * `current` is always kept, even when it falls outside the range. Somebody
 * wrote it down, and a grade that quietly disappears because the diagnosis
 * beside it was edited is worse than one that looks wrong and can be seen.
 */
function gradesFor(histology, current) {
  const lists = vocab();
  const allowed = lists.gradesByHistology[String(histology || "").trim()];
  if (!allowed) return lists.grades;
  const kept = String(current || "").trim();
  return kept && !allowed.includes(kept) ? [...allowed, kept] : allowed;
}

/** "độ 4", or "độ 2-4" — the grades a listed diagnosis can carry. */
function gradeRangeHint(histology) {
  const allowed = vocab().gradesByHistology[histology];
  if (!allowed || !allowed.length) return "";
  const span = allowed.length > 1
    ? `${allowed[0]}-${allowed[allowed.length - 1]}`
    : allowed[0];
  return tf("độ {}", span);
}

/** The standard English name of a term, or nothing when it is already one. */
function englishHint(term) {
  return CLINICAL_EN[term] || "";
}

/**
 * A field that offers a list and still accepts anything typed into it.
 *
 * `<input list>` rather than `<select>`: the dropdown is there for the thirty
 * cases that make up most of a list, and the thirty-first can be typed in full
 * without leaving the form or picking "Khác" and explaining afterwards.
 */
function combo(field, value, listId, placeholder = "") {
  return `<input class="dxf-input" type="text" data-clinical-field="${escapeHtml(field)}"
    list="${escapeHtml(listId)}" value="${escapeHtml(value || "")}"
    placeholder="${escapeHtml(placeholder)}" autocomplete="off">`;
}

function select(field, value, options, blankLabel) {
  return `<select class="dxf-input" data-clinical-field="${escapeHtml(field)}">
    <option value=""${value ? "" : " selected"}>${escapeHtml(blankLabel)}</option>
    ${(options || []).map((option) => `
      <option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(tcPicker(option))}</option>
    `).join("")}
  </select>`;
}

function dateField(field, value) {
  return `<input class="dxf-input" type="date" data-clinical-field="${escapeHtml(field)}"
    value="${escapeHtml(value || "")}">`;
}

function numberField(field, value, placeholder) {
  const shown = Number.isFinite(value) ? String(value) : "";
  return `<input class="dxf-input" type="number" min="0" data-clinical-field="${escapeHtml(field)}"
    value="${escapeHtml(shown)}" placeholder="${escapeHtml(placeholder)}">`;
}

/** The family a marker belongs to, for the greyed hint beside its name. */
function markerHint(name) {
  const lists = vocab();
  const group = Object.keys(lists.markerGroups || {}).find(
    (key) => (lists.markerGroups[key] || []).includes(name));
  return group ? tc(group) : "";
}

/**
 * The tests this diagnosis needs and the record does not have.
 *
 * Shown inside the form rather than only in the reading pane, because this is
 * the one moment somebody can do something about it: the marker rows are right
 * there, and adding the missing one is a click rather than a return trip.
 *
 * Essential and useful are kept apart, and only in that order. Without an
 * essential test there is no integrated diagnosis at all; a useful one changes
 * management without changing what the tumour is, and a list that ran them
 * together would send somebody chasing MGMT with the same urgency as IDH.
 */
/**
 * One work-up requirement, named the way the reader reads it.
 *
 * Several markers means *any one of these* rather than all of them: an
 * IDH-mutant glioma needs codeletion ruled out, and either ATRX or 1p/19q
 * rules it out. Joined here rather than on the Python side so the word between
 * them follows the language on screen.
 */
function requirementName(markers) {
  const names = Array.isArray(markers) ? markers : [markers].filter(Boolean);
  return names.join(` ${t("hoặc")} `);
}

function workupHint(tumor) {
  const spec = vocab().workup[String(tumor.histology || "").trim()];
  if (!spec) return "";
  // A row with no answer in it is a test that has not been done. The panel
  // now puts every required marker on screen before anything is entered, so
  // counting the row rather than the answer would report the whole work-up
  // as complete the moment the form opened.
  const recorded = Object.entries(tumor.molecular || {})
    .filter(([, value]) => String(value || "").trim())
    .map(([name]) => name);
  // An entry is a marker name or a list of alternatives, and a list is
  // satisfied by any one of them.
  const absent = (entries) => (entries || [])
    .map((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((names) => !names.some((name) => recorded.includes(name)))
    .map(requirementName);
  const essential = absent(spec.essential);
  const useful = absent(spec.useful);
  if (!essential.length && !useful.length) return "";
  return `
    <p class="dxf-workup">
      ${essential.length ? `
        <span class="dxf-workup-need">${escapeHtml(t("Bắt buộc còn thiếu"))}:
          ${escapeHtml(essential.join(", "))}</span>
      ` : ""}
      ${useful.length ? `
        <span class="dxf-workup-extra">${escapeHtml(t("Nên có"))}:
          ${escapeHtml(useful.join(", "))}</span>
      ` : ""}
    </p>
  `;
}

/**
 * The value a result dropdown carries for "none of these, let me type it".
 *
 * A sentinel rather than an empty string, because blank already means
 * something else here: nothing has been recorded yet.
 */
const TYPE_IT = "__other__";

/** How a marker row is addressed in `freeFields`. */
function markerKey(tumorIndex, name) {
  return `m:${tumorIndex}:${name}`;
}

/** How a tumour's diagnosis field is addressed in `freeFields`. */
function histologyKey(tumorIndex) {
  return `h:${tumorIndex}`;
}

/**
 * The diagnosis, as the classification lists it.
 *
 * A `<select>` with the families as `<optgroup>`s, which is closer to how the
 * classification is actually written than the flat list a datalist could
 * manage — and it opens on whatever is already chosen, which an `<input list>`
 * would not: a datalist filters itself against the value in the box, so
 * picking a diagnosis was a one-way door until the field was emptied again.
 *
 * The grade range rides on each entry, because the grade field below reads
 * off this one. A diagnosis the table does not list keeps the whole range,
 * and "Khác…" is how it gets typed: the vocabulary cannot cover a pathology
 * report, and a form that will not take the real answer gets a wrong one.
 */
function histologyField(tumor, index) {
  const lists = vocab();
  const options = lists.histologies || [];
  const current = String(tumor.histology || "").trim();
  const key = histologyKey(index);
  if (clinicalState.freeFields.has(key) || (current && !options.includes(current))) {
    return `
      <input class="dxf-input" type="text" data-clinical-field="histology"
        value="${escapeHtml(current)}"
        placeholder="${escapeHtml(t("Gõ chẩn đoán theo phiếu giải phẫu bệnh"))}" autocomplete="off">
      <button class="dxf-mini" type="button" data-action="clinical-histology-list"
        data-tumor-index="${escapeHtml(String(index))}"
        title="${escapeHtml(t("Quay lại danh sách đáp án, xoá nội dung đang gõ"))}"
        >${escapeHtml(t("Danh sách"))}</button>
    `;
  }
  // Grouped in the order Python serves them, family by family, so the list
  // reads down the classification rather than alphabetically across it.
  const families = [];
  const byFamily = new Map();
  for (const name of options) {
    const family = (lists.histologyGroups || {})[name] || "";
    if (!byFamily.has(family)) {
      byFamily.set(family, []);
      families.push(family);
    }
    byFamily.get(family).push(name);
  }
  const entry = (name) => {
    const range = gradeRangeHint(name);
    return `<option value="${escapeHtml(name)}"${name === current ? " selected" : ""}
      >${escapeHtml(tcPicker(name))}${range ? ` · ${escapeHtml(range)}` : ""}</option>`;
  };
  return `<select class="dxf-input" data-clinical-field="histology">
    <option value=""${current ? "" : " selected"}>${escapeHtml(t("Chưa chọn"))}</option>
    ${families.map((family) => (family
      ? `<optgroup label="${escapeHtml(tc(family))}">${byFamily.get(family).map(entry).join("")}</optgroup>`
      : byFamily.get(family).map(entry).join("")
    )).join("")}
    <option value="${TYPE_IT}">${escapeHtml(t("Khác…"))}</option>
  </select>`;
}

/**
 * The markers one tumour's panel asks about, in the order a reader works down
 * them.
 *
 * Driven by the work-up table rather than by what somebody has already typed.
 * The diagnosis is what decides that IDH is the question, so the IDH row is on
 * screen before the first keystroke — nobody should have to already know the
 * name of a test in order to be asked for it. That was the old behaviour: an
 * empty section with a "+" on it, and a name to be typed from memory before
 * any answer could be given.
 *
 * A requirement made of several markers is spread into a row each. Either of
 * ATRX and 1p/19q rules out codeletion, which one gets sent depends on the
 * department, so both are offered and answering one is enough.
 *
 * Anything the record already holds that the table does not ask for stays at
 * the bottom, still editable and still removable. A marker entered against an
 * older diagnosis must not disappear because the diagnosis was corrected.
 */
function markerRows(tumor) {
  const spec = vocab().workup[String(tumor.histology || "").trim()] || {};
  const rows = [];
  const seen = new Set();
  const push = (name, role) => {
    const key = String(name || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push({ name: key, role });
  };
  const spread = (entries) => (entries || [])
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
  spread(spec.essential).forEach((name) => push(name, "essential"));
  spread(spec.useful).forEach((name) => push(name, "useful"));
  Object.keys(tumor.molecular || {}).forEach((name) => push(name, "extra"));
  return rows;
}

/**
 * The answer half of a marker row.
 *
 * A real `<select>` wherever the marker has a fixed set of answers. An
 * `<input list>` filters its own list down to what is already in the box, so
 * once "Đột biến" had been chosen the list would not open again until the
 * field was emptied — which is not a way to correct an answer, and is what
 * made this section feel broken.
 *
 * The listed strings are also what the Python rules match on. "(-)", "am
 * tinh", "wildtype" and "không đột biến" are one answer written four ways, and
 * no rule can be written against that; choosing from the list is what makes a
 * record readable by anything other than a person.
 *
 * Two ways out of the list, because a pathology report is allowed to say
 * something the list cannot. A recorded answer that is not on the list is
 * shown in a text box rather than silently reset to blank, and "Khác…" opens
 * that same box on purpose. Either way the reading pane reports the answer as
 * unrecognised instead of guessing at it.
 *
 * Ki-67, the mitotic count and the methylation profile have no fixed answers —
 * they are numbers and free text — and never get a dropdown at all.
 */
function markerResultField(name, value, tumorIndex) {
  const key = markerKey(tumorIndex, name);
  const lists = vocab();
  const results = lists.markerResults[name] || [];
  const unit = tc(lists.markerUnits[name] || "");
  const note = tc(lists.markerNotes[name] || "");
  const title = note ? ` title="${escapeHtml(note)}"` : "";
  const current = String(value || "");
  const typed = results.length
    ? clinicalState.freeFields.has(key) || (current && !results.includes(current))
    : true;
  if (typed) {
    return `
      <input class="dxf-input" type="text" data-clinical-field="molecularValue"
        value="${escapeHtml(current)}"
        placeholder="${escapeHtml(unit ? tf("Kết quả ({})", unit) : t("Kết quả"))}"${title}
        autocomplete="off">
      ${results.length ? `
        <button class="dxf-mini" type="button" data-action="clinical-marker-list"
          data-tumor-index="${escapeHtml(String(tumorIndex))}"
          data-marker-name="${escapeHtml(name)}"
          title="${escapeHtml(t("Quay lại danh sách đáp án, xoá nội dung đang gõ"))}"
          >${escapeHtml(t("Danh sách"))}</button>
      ` : ""}
    `;
  }
  return `<select class="dxf-input" data-clinical-field="molecularValue"${title}>
    <option value=""${current ? "" : " selected"}>${escapeHtml(t("Chưa ghi"))}</option>
    ${results.map((result) => `
      <option value="${escapeHtml(result)}"${result === current ? " selected" : ""}
        >${escapeHtml(tc(result))}</option>
    `).join("")}
    <option value="${TYPE_IT}">${escapeHtml(t("Khác…"))}</option>
  </select>`;
}

/**
 * One tumour's molecular results.
 *
 * The rows come from the diagnosis, so the panel is already filled in with the
 * right questions and the work is answering them. Rows the work-up asks for
 * carry their name as a label and cannot be renamed or deleted — the entity
 * needs that test whether or not anybody wants the row. Rows added by hand
 * keep an editable name and a "×".
 */
function renderMolecular(tumor, index) {
  const recorded = tumor.molecular || {};
  const rows = markerRows(tumor);
  const roleLabel = { essential: t("Bắt buộc"), useful: t("Nên có") };
  return `
    <div class="dxf-molecular">
      <span class="dxf-sub-label">${escapeHtml(t("Dấu ấn phân tử"))}</span>
      ${workupHint(tumor)}
      ${rows.length ? "" : `
        <p class="dxf-hint">${escapeHtml(
          t("Chọn chẩn đoán mô bệnh học để app hỏi đúng bộ dấu ấn."))}</p>
      `}
      ${rows.map((row) => {
        // The note reads out in the language on screen: the one under IDH
        // carries the difference between a negative antibody and a sequenced
        // wildtype, which is the distinction a reader most needs either way.
        const note = tc(vocab().markerNotes[row.name] || "");
        const asked = row.role !== "extra";
        return `
        <div class="dxf-molecular-row ${escapeHtml(row.role)}"
          data-marker-name="${escapeHtml(row.name)}">
          ${asked ? `
            <span class="dxf-marker-name" title="${escapeHtml(markerHint(row.name))}"
              >${escapeHtml(row.name)}<small class="dxf-marker-role ${escapeHtml(row.role)}"
                >${escapeHtml(roleLabel[row.role])}</small></span>
          ` : `
            <input class="dxf-input dxf-marker" type="text" list="dx-markers"
              data-clinical-field="molecularName" value="${escapeHtml(row.name)}"
              placeholder="${escapeHtml(t("Tên dấu ấn"))}" autocomplete="off">
          `}
          ${markerResultField(row.name, recorded[row.name] ?? "", index)}
          ${asked ? "" : `
            <button class="dxf-mini danger" type="button" data-action="clinical-remove-marker"
              data-tumor-index="${index}" data-marker-name="${escapeHtml(row.name)}"
              title="${escapeHtml(t("Xoá dấu ấn"))}">×</button>
          `}
        </div>
        ${note ? `<small class="dxf-marker-note">${escapeHtml(note)}</small>` : ""}
      `;
      }).join("")}
      <button class="dxf-mini" type="button" data-action="clinical-add-marker" data-tumor-index="${index}">
        + ${escapeHtml(t("Thêm dấu ấn khác"))}
      </button>
    </div>
  `;
}

function renderTumorForm(tumor, index) {
  const lists = vocab();
  const compartment = tumor.compartment || "";
  const locations = lists.locations[compartment] || [];
  const axes = lists.axes[compartment] || [];
  return `
    <div class="dxf-block" data-tumor-index="${index}">
      <div class="dxf-block-head">
        <b>${escapeHtml(tf("Khối u {}", index + 1))}</b>
        <button class="dxf-mini danger" type="button" data-action="clinical-remove-tumor"
          data-tumor-index="${index}">${escapeHtml(t("Xoá"))}</button>
      </div>
      <label class="dxf-field">
        <span>${escapeHtml(t("Khoang"))}</span>
        ${select("compartment", compartment, lists.compartments, t("Chưa chọn"))}
      </label>
      <label class="dxf-field">
        <span>${escapeHtml(t("Vị trí"))}</span>
        ${combo("location", tumor.location, `dx-loc-${index}`, t("Chọn hoặc gõ vị trí"))}
      </label>
      ${datalist(`dx-loc-${index}`, locations, englishHint)}
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${escapeHtml(t("Bên"))}</span>
          ${select("side", tumor.side, lists.sides, "—")}
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Trục"))}</span>
          ${combo("axis", tumor.axis, `dx-axis-${index}`, t("Chọn hoặc gõ"))}
        </label>
        ${datalist(`dx-axis-${index}`, axes, englishHint)}
      </div>
      <label class="dxf-field dxf-wide dxf-picker">
        <span>${escapeHtml(t("Mô bệnh học"))}</span>
        ${histologyField(tumor, index)}
      </label>
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${escapeHtml(t("Độ WHO"))}</span>
          ${select("grade", tumor.grade, gradesFor(tumor.histology, tumor.grade), "—")}
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Ngày có kết quả"))}</span>
          ${dateField("confirmedAt", tumor.confirmedAt)}
        </label>
      </div>
      <label class="dxf-field dxf-wide">
        <span>${escapeHtml(t("Căn cứ"))}</span>
        ${select("basis", tumor.basis, lists.diagnosisBases, t("Chưa rõ"))}
      </label>
      ${renderMolecular(tumor, index)}
      <label class="dxf-field dxf-wide">
        <span>${escapeHtml(t("Ghi chú khối u"))}</span>
        <textarea class="dxf-input" rows="2" data-clinical-field="note"
          placeholder="${escapeHtml(t("Tuỳ chọn"))}">${escapeHtml(tumor.note || "")}</textarea>
      </label>
      ${renderAssessment(index, clinicalState.draftAssessment)}
    </div>
  `;
}

function renderEventForm(event, index) {
  const lists = vocab();
  const kind = event.kind || "";
  return `
    <div class="dxf-block" data-event-index="${index}">
      <div class="dxf-block-head">
        <b>${escapeHtml(tf("Sự kiện {}", index + 1))}</b>
        <button class="dxf-mini danger" type="button" data-action="clinical-remove-event"
          data-event-index="${index}">${escapeHtml(t("Xoá"))}</button>
      </div>
      <label class="dxf-field">
        <span>${escapeHtml(t("Loại"))}</span>
        ${select("kind", kind, lists.eventKinds, t("Chưa chọn"))}
      </label>
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${escapeHtml(t("Bắt đầu"))}</span>
          ${dateField("start", event.start)}
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Kết thúc"))}</span>
          ${dateField("end", event.end)}
        </label>
      </div>
      <p class="dxf-hint">${escapeHtml(t("Để trống ngày kết thúc nghĩa là đang diễn ra."))}</p>
      <label class="dxf-field">
        <span>${escapeHtml(t("Nơi thực hiện"))}</span>
        <input class="dxf-input" type="text" data-clinical-field="where"
          value="${escapeHtml(event.where || "")}"
          placeholder="${escapeHtml(t("Bệnh viện, trung tâm"))}">
      </label>
      ${kind === "Mổ" ? `
        <label class="dxf-field">
          <span>${escapeHtml(t("Mức độ lấy u"))}</span>
          ${combo("extent", event.extent, "dx-extents", t("Chọn hoặc gõ"))}
        </label>
      ` : ""}
      ${kind === "Xạ" ? `
        <label class="dxf-field">
          <span>${escapeHtml(t("Kỹ thuật"))}</span>
          ${combo("technique", event.technique, "dx-techniques", t("Chọn hoặc gõ"))}
        </label>
        <div class="dxf-row">
          <label class="dxf-field">
            <span>${escapeHtml(t("Liều (Gy)"))}</span>
            ${numberField("doseGy", event.doseGy, "60")}
          </label>
          <label class="dxf-field">
            <span>${escapeHtml(t("Số buổi"))}</span>
            ${numberField("fractions", event.fractions, "30")}
          </label>
        </div>
        <p class="dxf-hint">${escapeHtml(t("Có số buổi thì app tự biết đợt xạ quá hạn cập nhật."))}</p>
      ` : ""}
      ${kind === "Hoá" || kind === "Đích/Miễn dịch" ? `
        <label class="dxf-field">
          <span>${escapeHtml(t("Phác đồ"))}</span>
          ${combo("regimen", event.regimen, "dx-regimens", t("Chọn hoặc gõ"))}
        </label>
        <div class="dxf-row">
          <label class="dxf-field">
            <span>${escapeHtml(t("Đã xong"))}</span>
            ${numberField("cyclesDone", event.cyclesDone, "3")}
          </label>
          <label class="dxf-field">
            <span>${escapeHtml(t("Tổng chu kỳ"))}</span>
            ${numberField("cycles", event.cycles, "6")}
          </label>
        </div>
      ` : ""}
      <label class="dxf-field dxf-wide">
        <span>${escapeHtml(t("Ghi chú"))}</span>
        <textarea class="dxf-input" rows="2" data-clinical-field="note"
          placeholder="${escapeHtml(t("Tuỳ chọn"))}">${escapeHtml(event.note || "")}</textarea>
      </label>
    </div>
  `;
}

/** The lists every combo box in the form reads from. */
function formDatalists() {
  const lists = vocab();
  return `
    ${datalist("dx-markers", lists.molecularMarkers, markerHint)}
    ${datalist("dx-extents", lists.resectionExtents, englishHint)}
    ${datalist("dx-techniques", lists.radiotherapyTechniques, englishHint)}
    ${datalist("dx-regimens", lists.chemoRegimens, englishHint)}
  `;
}

/**
 * Who the patient is.
 *
 * The same eight fields the rail card used to unfold on its own, in the same
 * `patient-edit-form` the save reads with `FormData` — moved here so that one
 * press of the pencil opens everything about this patient at once instead of
 * two forms in two places.
 */
function renderPatientSection(patient) {
  const year = new Date().getFullYear();
  const other = patient.gender && patient.gender !== "Nam" && patient.gender !== "Nữ";
  return `
    <form class="dxf-section" data-field="patient-edit-form" onsubmit="event.preventDefault();">
      <div class="dxf-section-head">
        <b>${escapeHtml(t("Thông tin bệnh nhân"))}</b>
      </div>
      <div class="dxf-block">
        <label class="dxf-field dxf-wide">
          <span>${escapeHtml(t("Họ và tên"))}</span>
          <input class="dxf-input" name="patientName" maxlength="128"
            value="${escapeHtml(patient.patientName || "")}"
            placeholder="${escapeHtml(t("Nhập họ tên"))}">
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Mã bệnh nhân"))}</span>
          <input class="dxf-input" name="patientId" maxlength="128" required
            value="${escapeHtml(patient.patientId || "")}"
            placeholder="${escapeHtml(t("Nhập mã BN"))}">
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Giới tính"))}</span>
          <select class="dxf-input" name="gender">
            <option value=""${patient.gender ? "" : " selected"}>—</option>
            <option value="Nam"${patient.gender === "Nam" ? " selected" : ""}>${escapeHtml(t("Nam"))}</option>
            <option value="Nữ"${patient.gender === "Nữ" ? " selected" : ""}>${escapeHtml(t("Nữ"))}</option>
            <option value="Khác"${other ? " selected" : ""}>${escapeHtml(t("Khác"))}</option>
          </select>
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Năm sinh"))}</span>
          <input class="dxf-input" name="birthYear" type="number" min="1900" max="${year}"
            value="${escapeHtml(patient.birthYear || "")}" placeholder="YYYY">
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Số điện thoại"))}</span>
          <input class="dxf-input" name="phone" type="tel"
            value="${escapeHtml(patient.phone || "")}"
            placeholder="${escapeHtml(t("Nhập SĐT"))}">
        </label>
        <label class="dxf-field dxf-wide">
          <span>${escapeHtml(t("Địa chỉ"))}</span>
          <input class="dxf-input" name="address" value="${escapeHtml(patient.address || "")}"
            placeholder="${escapeHtml(t("Nhập địa chỉ"))}">
        </label>
        <label class="dxf-field dxf-wide">
          <span>${escapeHtml(t("Bệnh viện"))}</span>
          <input class="dxf-input" name="hospital" value="${escapeHtml(patient.hospital || "")}"
            placeholder="${escapeHtml(t("Tên bệnh viện"))}">
        </label>
        <label class="dxf-field dxf-wide">
          <span>${escapeHtml(t("Chẩn đoán / Ghi chú"))}</span>
          <textarea class="dxf-input" name="diagnosis" rows="3"
            placeholder="${escapeHtml(t("Ghi tự do: lưu ý khi đọc phim, hẹn khám…"))}"
            >${escapeHtml(patient.diagnosis || "")}</textarea>
        </label>
      </div>
    </form>
  `;
}

/** What the tumour is: one block per tumour described. */
function renderDiagnosisSection(draft) {
  return `
    <div class="dxf-section">
      <div class="dxf-section-head">
        <b>${escapeHtml(t("Chẩn đoán"))}</b>
        <button class="dxf-mini" type="button" data-action="clinical-add-tumor">
          + ${escapeHtml(t("Thêm khối u"))}
        </button>
      </div>
      ${draft.tumors.length
        ? draft.tumors.map(renderTumorForm).join("")
        : `<p class="dxf-empty">${escapeHtml(t("Chưa có khối u nào được mô tả."))}</p>`}
    </div>
  `;
}

/** Where treatment has got to: one block per course or operation. */
function renderTreatmentSection(draft) {
  return `
    <div class="dxf-section">
      <div class="dxf-section-head">
        <b>${escapeHtml(t("Điều trị"))}</b>
        <button class="dxf-mini" type="button" data-action="clinical-add-event">
          + ${escapeHtml(t("Thêm sự kiện"))}
        </button>
      </div>
      ${draft.events.length
        ? draft.events.map(renderEventForm).join("")
        : `<p class="dxf-empty">${escapeHtml(t("Chưa có mốc điều trị nào."))}</p>`}
    </div>
  `;
}

/**
 * The form, filling the reading pane beside the images.
 *
 * It used to live inside the rail card, and it did not fit: one tumour and one
 * course of treatment came to roughly 870px of form in a 246px-wide card that
 * the rail squashed to 390px. `.rec-card` hides its overflow, so the fields
 * below that line were not merely off-screen, they were unreachable — the rail
 * had nothing left to scroll. Out here the fields get the width of the pane
 * and the form scrolls on its own, while the rail keeps the summary.
 */
export function renderClinicalWorkspace(patient = {}, editPatient = null) {
  const draft = clinicalState.draft || emptyRecord();
  const identity = [patient.patientName, patient.patientId]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
  return `
    <div class="dx-workspace">
      ${formDatalists()}
      <header class="dxw-bar">
        <div class="dxw-title">
          <b>${escapeHtml(t("Hồ sơ bệnh nhân"))}</b>
          ${identity ? `<span class="dxw-patient">${escapeHtml(identity)}</span>` : ""}
        </div>
        <div class="dxw-actions">
          <button class="dxw-btn primary" type="button" data-action="save-record"
            ${clinicalState.saving ? "disabled" : ""}>${escapeHtml(
              clinicalState.saving ? t("Đang lưu…") : t("Lưu"))}</button>
          <button class="dxw-btn" type="button" data-action="cancel-record"
            >${escapeHtml(t("Đóng"))}</button>
        </div>
      </header>
      ${clinicalState.error ? `
        <p class="dxf-error" role="alert">${escapeHtml(clinicalState.error)}</p>
      ` : ""}
      <div class="dxw-body">
        <section class="dxw-col">${renderPatientSection(editPatient || patient)}</section>
        <section class="dxw-col">${renderDiagnosisSection(draft)}</section>
        <section class="dxw-col">${renderTreatmentSection(draft)}</section>
      </div>
    </div>
  `;
}

/**
 * What the classification makes of one tumour, under what was recorded about it.
 *
 * Four things, in the order a reader needs them, and each is left out entirely
 * when there is nothing to say rather than rendered as an empty heading:
 *
 *   the integrated line   entity, the molecular findings its own name does not
 *                         already carry, and the grade
 *   disagreements         two recorded facts that cannot both be true. First,
 *                         because everything below it is being read off a
 *                         record that contradicts itself
 *   what is missing       the tests the entity needs. Essential ones are the
 *                         reason a diagnosis is not integrated; useful ones
 *                         change treatment without changing the diagnosis
 *   protocols             with the dose and the paper, because a regimen name
 *                         on its own is the part a reader already knew
 *
 * The grade appears twice on purpose when the two disagree. The recorded one
 * is what the pathologist wrote and the derived one is what the classification
 * makes of the molecular result, and a reader who is shown only one of them
 * cannot tell which they are looking at. The rule that moved it is named, so
 * the disagreement can be checked rather than merely noticed.
 */
function renderAssessment(index, readings = clinicalState.assessment) {
  const reading = (readings || [])[index];
  if (!reading || !reading.line) return "";
  const grade = reading.grade || {};
  const escalated = grade.source === "molecular" && grade.recorded && grade.recorded !== grade.grade;
  const conflicts = reading.conflicts || [];
  const essential = (reading.missing || []).filter((gap) => gap.essential);
  const useful = (reading.missing || []).filter((gap) => !gap.essential);
  const protocols = reading.protocols || {};
  const preferred = protocols.preferred || [];
  const conditional = protocols.conditional || [];

  const gaps = (items, label, tone) => items.length ? `
    <p class="dx-gap ${tone}">
      <span class="dx-gap-label">${escapeHtml(label)}</span>
      ${items.map((gap) => {
        // Three ways a requirement can be outstanding, and they send the
        // reader to three different places: order the test, accept that it was
        // declined, or tidy a field that already holds the answer in words no
        // rule can match.
        const state = gap.unreadable
          ? { cls: " unreadable", suffix: t("chưa đọc được"),
              hint: t("Ô này có chữ nhưng không khớp đáp án nào trong danh sách, nên không luật nào đọc được.") }
          : gap.declined
            ? { cls: " declined", suffix: t("chưa làm"), hint: "" }
            : { cls: "", suffix: "", hint: "" };
        const title = state.hint || tc(gap.note || "");
        return `<span class="dx-gap-item${state.cls}"
          ${title ? `title="${escapeHtml(title)}"` : ""}
          >${escapeHtml(requirementName(gap.markers))}${
            state.suffix ? ` (${escapeHtml(state.suffix)})` : ""}</span>`;
      }).join("")}
    </p>
  ` : "";

  const regimens = (items, label, tone) => items.length ? `
    <div class="dx-rx ${tone}">
      <span class="dx-rx-label">${escapeHtml(label)}</span>
      ${items.map((protocol) => `
        <div class="dx-rx-item">
          <b>${escapeHtml(tc(protocol.name))}</b>
          <span class="dx-rx-kind">${escapeHtml(tc(protocol.kind))}</span>
          <small class="dx-rx-detail">${escapeHtml(protocol.detail)}</small>
          ${protocol.cycles ? `<small class="dx-rx-cycles">${escapeHtml(protocol.cycles)}</small>` : ""}
          ${protocol.when ? `<small class="dx-rx-when">${escapeHtml(tf("Khi: {}", tc(protocol.when)))}</small>` : ""}
          <small class="dx-rx-ref">${escapeHtml(protocol.reference)}</small>
        </div>
      `).join("")}
    </div>
  ` : "";

  return `
    <div class="dx-reading">
      <p class="dx-integrated">
        <span class="dx-integrated-line">${escapeHtml(reading.line)}</span>
        <span class="dx-integrated-flag ${reading.integrated ? "done" : "pending"}"
          title="${escapeHtml(reading.integrated
            ? t("Mô bệnh học và phân tử đã đủ để kết luận chẩn đoán tích hợp")
            : t("Chưa đủ căn cứ cho chẩn đoán tích hợp theo WHO CNS5"))}"
          >${escapeHtml(reading.integrated ? t("Chẩn đoán tích hợp") : t("Chưa tích hợp"))}</span>
      </p>
      ${escalated ? `
        <p class="dx-escalated" title="${escapeHtml(tc(grade.rule))}">
          ${escapeHtml(tf("Độ đã ghi {} · theo phân tử là độ {}", grade.recorded, grade.grade))}
          <small>${escapeHtml(tc(grade.rule))}</small>
        </p>
      ` : ""}
      ${conflicts.length ? `
        <ul class="dx-conflicts">
          ${conflicts.map((conflict) => `
            <li><b>${escapeHtml(conflict.marker)}</b> ${escapeHtml(tc(conflict.text))}</li>
          `).join("")}
        </ul>
      ` : ""}
      ${gaps(essential, t("Bắt buộc còn thiếu"), "need")}
      ${gaps(useful, t("Nên có"), "extra")}
      ${regimens(preferred, t("Phác đồ chuẩn"), "preferred")}
      ${regimens(conditional, t("Cân nhắc theo bối cảnh"), "conditional")}
    </div>
  `;
}

/**
 * The reading for one tumour of the draft, on its own.
 *
 * Exported so the answer arriving from Python can be dropped into the block
 * it belongs to instead of redrawing the form around it. The reading is the
 * one part of the form that changes without anybody touching it, and a
 * wholesale repaint at that moment takes away whatever the person was about
 * to press: the browser smoke test caught the Lưu button being replaced
 * between the press and the release.
 *
 * Safe to swap in place because nothing inside it is interactive — no field,
 * no `data-action` — so nothing needs rebinding afterwards.
 */
export function renderDraftReading(index) {
  return renderAssessment(index, clinicalState.draftAssessment);
}

function renderReader() {
  const record = clinicalState.record || emptyRecord();
  const tumors = record.tumors || [];
  const events = record.events || [];
  if (!tumors.length && !events.length) {
    return `<p class="dxf-empty">${escapeHtml(t("Chưa ghi hồ sơ lâm sàng cho bệnh nhân này."))}</p>`;
  }
  return `
    ${tumors.length ? `
      <ul class="dx-tumors">
        ${tumors.map((tumor, index) => {
          const site = tumorSite(tumor);
          const markers = Object.entries(tumor.molecular || {});
          return `
            <li class="dx-tumor">
              <b>${escapeHtml(tumorHeading(tumor))}</b>
              ${site ? `<small>${escapeHtml(site)}</small>` : ""}
              ${markers.length ? `
                <span class="dx-markers">
                  ${markers.map(([marker, value]) => `
                    <span class="dx-marker">${escapeHtml(marker)}: ${escapeHtml(value)}</span>
                  `).join("")}
                </span>
              ` : ""}
              ${tumor.basis ? `
                <span class="dx-basis ${tumor.basis === "Mô bệnh học" ? "confirmed" : "imaging"}"
                  title="${escapeHtml(tf("Chẩn đoán dựa trên: {}", tc(tumor.basis)))}"
                  >${escapeHtml(tc(tumor.basis))}${tumor.confirmedAt ? ` · ${escapeHtml(formatDate(tumor.confirmedAt))}` : ""}</span>
              ` : `
                <span class="dx-basis unknown" title="${escapeHtml(t("Chưa ghi chẩn đoán này dựa trên gì"))}"
                  >${escapeHtml(t("Chưa rõ căn cứ"))}</span>
              `}
              ${tumor.note ? `<small class="dx-note">${escapeHtml(tumor.note)}</small>` : ""}
              ${renderAssessment(index)}
            </li>
          `;
        }).join("")}
      </ul>
    ` : ""}
    ${events.length ? `
      <ul class="dx-events">
        ${events.map((event) => {
          const detail = eventDetail(event);
          const open = !event.end;
          return `
            <li class="dx-event${open ? " open" : ""}">
              <span class="dx-event-kind">${escapeHtml(tc(event.kind))}</span>
              <span class="dx-event-body">
                <b>${escapeHtml(eventPeriod(event))}</b>
                ${event.where ? `<small>${escapeHtml(event.where)}</small>` : ""}
                ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
              </span>
            </li>
          `;
        }).join("")}
      </ul>
    ` : ""}
  `;
}

/**
 * What has been recorded about the tumour and the treatment, inside the
 * patient card.
 *
 * Reading only, and no pencil of its own: who the patient is and what they
 * have is one record, so the card carries one edit button and it opens
 * everything in the reading pane. What is on screen here is always the record
 * on disk, so a draft being typed next door cannot be mistaken for something
 * already saved.
 */
export function renderClinicalCard() {
  const chip = stageChip(clinicalState.stage);
  const editing = clinicalState.editing;
  // A draft with the form closed: the doctor opened a study part-way through.
  // Nothing typed is lost, and the card says so rather than showing the old
  // record as though the edit had been abandoned.
  const pendingDraft = Boolean(clinicalState.draft) && !editing;
  return `
    <div class="dx-card">
      ${editing ? `
        <p class="dx-hint">${escapeHtml(t("Đang sửa ở khung bên phải."))}</p>
      ` : ""}
      ${pendingDraft ? `
        <p class="dx-hint pending">${escapeHtml(t("Còn bản sửa chưa lưu."))}</p>
      ` : ""}
      ${chip ? `
        <div class="dx-stage">
          <span class="dx-stage-chip ${escapeHtml(chip.tone)}" title="${escapeHtml(chip.title)}"
            >${escapeHtml(chip.text)}</span>
          ${chip.where ? `<span class="dx-stage-where">${escapeHtml(chip.where)}</span>` : ""}
        </div>
      ` : ""}
      ${clinicalState.error && !editing ? `
        <p class="dxf-error" role="alert">${escapeHtml(clinicalState.error)}</p>
      ` : ""}
      ${clinicalState.loading
        ? `<p class="dxf-empty">${escapeHtml(t("Đang tải hồ sơ lâm sàng…"))}</p>`
        : !clinicalState.canWrite
          ? `<p class="dxf-empty">${escapeHtml(
              clinicalState.reason
              || t("Thư mục này chưa có patient-index.json nên chưa ghi được hồ sơ lâm sàng."))}</p>`
          : renderReader()}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Editing the draft
// ---------------------------------------------------------------------------

const NUMBER_FIELDS = new Set(["doseGy", "fractions", "cycles", "cyclesDone"]);

function readNumber(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Take one edited control into the draft.
 *
 * Returns true when the change alters which fields the form should be showing —
 * a compartment decides which locations are offered, an event kind decides
 * whether the form asks about fractions or cycles — so the caller knows it has
 * to redraw rather than leave a stale list behind.
 *
 * `eventType` is the browser event this came from, because one of those fields
 * is a text box: the diagnosis decides which WHO grades are offered, and
 * redrawing it on every `input` would rebuild the box under the person typing
 * in it. `change` is the moment they pick from the list or leave the field.
 */
export function applyFieldEdit(input, eventType = "change") {
  const draft = clinicalState.draft;
  if (!draft || !input) return false;
  const field = input.dataset.clinicalField;
  if (!field) return false;

  const tumorBlock = input.closest("[data-tumor-index]");
  const markerRow = input.closest("[data-marker-name]");
  const eventBlock = input.closest("[data-event-index]");

  if (markerRow && tumorBlock) {
    const tumorIndex = Number(tumorBlock.dataset.tumorIndex);
    const tumor = draft.tumors[tumorIndex];
    if (!tumor) return false;
    // Addressed by name rather than by position, because most of these rows
    // come from the work-up table and have no entry in the record until they
    // are answered.
    const name = markerRow.dataset.markerName || "";
    const entries = Object.entries(tumor.molecular || {});
    const at = entries.findIndex(([key]) => key === name);

    if (field === "molecularName") {
      if (at < 0) return false;
      const renamed = input.value.trim();
      entries[at] = [renamed, entries[at][1]];
      // Rebuilt rather than mutated so a renamed marker keeps its position,
      // which is where the person's cursor is. The row is told its own new
      // name at once, or the next keystroke would look for a key that the
      // rename has already replaced and append a second row instead.
      markerRow.dataset.markerName = renamed;
      tumor.molecular = Object.fromEntries(entries.filter(([key]) => key));
      // On `change`: naming a row MGMT is what gives it MGMT's answers, and
      // that list cannot appear without a redraw.
      return eventType === "change";
    }

    const chosen = input.value;
    if (chosen === TYPE_IT) {
      // "Khác…" is not an answer, it is a request for somewhere to write one.
      clinicalState.freeFields.add(markerKey(tumorIndex, name));
      if (at >= 0) entries[at] = [name, ""];
      tumor.molecular = Object.fromEntries(entries.filter(([key]) => key));
      return true;
    }
    const value = chosen.trim();
    // A row the work-up put on screen and nobody answered leaves no trace: it
    // will be drawn again from the diagnosis next time, and a key with an
    // empty value would follow the record around as a leftover row after the
    // diagnosis that asked for it had been corrected.
    if (!value && at >= 0 && !markerRow.classList.contains("extra")) {
      entries.splice(at, 1);
    } else if (at >= 0) {
      entries[at] = [name, value];
    } else if (value) {
      entries.push([name, value]);
    }
    tumor.molecular = Object.fromEntries(entries.filter(([key]) => key));
    // A choice from a list is one event and redrawing on it is what refreshes
    // the reading under the form. Typing is not: a redraw per keystroke would
    // take the cursor out from under the person writing a Ki-67 percentage.
    return input.tagName === "SELECT" && eventType === "change";
  }

  if (tumorBlock) {
    const at = Number(tumorBlock.dataset.tumorIndex);
    const tumor = draft.tumors[at];
    if (!tumor) return false;
    if (field === "histology" && input.value === TYPE_IT) {
      // "Khác…" is a request for somewhere to write, not a diagnosis.
      clinicalState.freeFields.add(histologyKey(at));
      tumor.histology = "";
      return true;
    }
    tumor[field] = input.value;
    // Only on `change`. Typed in a box, the diagnosis would otherwise redraw
    // on every keystroke and take the cursor out from under the person
    // writing it; `change` arrives when they pick from the list or leave the
    // field, which is when the grade and the marker panel below need to be
    // rebuilt around a different entity.
    if (field === "histology") return eventType === "change";
    if (field === "compartment") {
      // The location and axis lists belong to a compartment. Anything typed
      // under the old one is kept — it may still be right, and silently
      // clearing a field somebody typed is worse than offering a new list.
      //
      // On `change` alone, like the diagnosis above. A `<select>` fires
      // `input` and then `change` for one choice, and redrawing on both ran
      // the repaint twice: the second pass was handed the node the first pass
      // had already detached, so it could not tell where the caret had been
      // and dropped focus altogether.
      return eventType === "change";
    }
    return false;
  }

  if (eventBlock) {
    const event = draft.events[Number(eventBlock.dataset.eventIndex)];
    if (!event) return false;
    event[field] = NUMBER_FIELDS.has(field) ? readNumber(input.value) : input.value;
    // The kind decides which fields the event asks about, so it redraws — but
    // on `change` only, for the reason given against `compartment` above.
    return field === "kind" && eventType === "change";
  }
  return false;
}

export function addTumor() {
  if (!clinicalState.draft) return;
  clinicalState.draft.tumors.push(blankTumor());
}

export function removeTumor(index) {
  if (!clinicalState.draft) return;
  clinicalState.draft.tumors.splice(index, 1);
}

export function addEvent() {
  if (!clinicalState.draft) return;
  clinicalState.draft.events.push(blankEvent());
}

export function removeEvent(index) {
  if (!clinicalState.draft) return;
  clinicalState.draft.events.splice(index, 1);
}

export function addMarker(tumorIndex) {
  const tumor = clinicalState.draft?.tumors?.[tumorIndex];
  if (!tumor) return;
  // An empty key cannot live in an object, so a blank row is held open by a
  // placeholder the save step drops if nobody types over it.
  const markers = { ...(tumor.molecular || {}) };
  let name = t("Dấu ấn mới");
  let suffix = 2;
  while (markers[name] !== undefined) {
    name = `${t("Dấu ấn mới")} ${suffix}`;
    suffix += 1;
  }
  markers[name] = "";
  tumor.molecular = markers;
}

export function removeMarker(tumorIndex, name) {
  const tumor = clinicalState.draft?.tumors?.[tumorIndex];
  if (!tumor) return;
  const entries = Object.entries(tumor.molecular || {}).filter(([key]) => key !== name);
  tumor.molecular = Object.fromEntries(entries);
  clinicalState.freeFields.delete(markerKey(tumorIndex, name));
}

/**
 * Put a marker row back on its list of answers.
 *
 * The answer being typed goes with it. Leaving it would put the row straight
 * back into the text box on the next redraw — an off-list answer is exactly
 * what keeps it there — and the row would look stuck.
 */
/**
 * Put the diagnosis field back on the classification list.
 *
 * What was typed goes with it, for the same reason it does on a marker row: a
 * diagnosis the list does not hold is exactly what keeps the box open, so
 * leaving it there would make the button look broken.
 */
export function useHistologyList(tumorIndex) {
  clinicalState.freeFields.delete(histologyKey(tumorIndex));
  const tumor = clinicalState.draft?.tumors?.[tumorIndex];
  if (tumor) tumor.histology = "";
}

export function useMarkerList(tumorIndex, name) {
  const tumor = clinicalState.draft?.tumors?.[tumorIndex];
  clinicalState.freeFields.delete(markerKey(tumorIndex, name));
  if (!tumor || !tumor.molecular) return;
  const entries = Object.entries(tumor.molecular)
    .map(([key, value]) => (key === name ? [key, ""] : [key, value]));
  tumor.molecular = Object.fromEntries(entries);
}

/**
 * The draft as it should be sent.
 *
 * Markers with no result are dropped: a marker name on its own says a test was
 * named, not that it came back, and the record must not imply the second.
 */
export function draftForSave() {
  const draft = clinicalState.draft || emptyRecord();
  return {
    tumors: draft.tumors.map((tumor) => ({
      ...tumor,
      molecular: Object.fromEntries(
        Object.entries(tumor.molecular || {}).filter(([key, value]) => key.trim() && String(value).trim()),
      ),
    })),
    events: draft.events,
  };
}
