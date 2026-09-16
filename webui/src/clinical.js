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
  label: "",
  vocabulary: null,
  editing: false,
  draft: null,
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
  clinicalState.label = "";
  clinicalState.editing = false;
  clinicalState.draft = null;
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
    molecularMarkers: value?.molecularMarkers || [],
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

/** The standard English name of a term, or nothing when it is already one. */
function englishHint(term) {
  return CLINICAL_EN[term] || "";
}

/**
 * The family and the WHO name, for one entry of the diagnosis list.
 *
 * This is where the list is "grouped": a datalist cannot hold headings, so the
 * family rides along on every entry instead. Ordering does the rest — the list
 * arrives from Python family by family.
 */
function histologyHint(name) {
  const group = (vocab().histologyGroups || {})[name];
  return [group ? tc(group) : "", englishHint(name)].filter(Boolean).join(" · ");
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

function renderMolecular(tumor, index) {
  const entries = Object.entries(tumor.molecular || {});
  return `
    <div class="dxf-molecular">
      <span class="dxf-sub-label">${escapeHtml(t("Dấu ấn phân tử"))}</span>
      ${entries.map(([marker, value], mIdx) => `
        <div class="dxf-molecular-row" data-molecular-index="${mIdx}">
          <input class="dxf-input dxf-marker" type="text" list="dx-markers"
            data-clinical-field="molecularName" value="${escapeHtml(marker)}"
            placeholder="${escapeHtml(t("Tên dấu ấn"))}" autocomplete="off">
          <input class="dxf-input" type="text" data-clinical-field="molecularValue"
            value="${escapeHtml(value)}" placeholder="${escapeHtml(t("Kết quả"))}">
          <button class="dxf-mini danger" type="button" data-action="clinical-remove-marker"
            data-tumor-index="${index}" data-molecular-index="${mIdx}"
            title="${escapeHtml(t("Xoá dấu ấn"))}">×</button>
        </div>
      `).join("")}
      <button class="dxf-mini" type="button" data-action="clinical-add-marker" data-tumor-index="${index}">
        + ${escapeHtml(t("Thêm dấu ấn"))}
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
      <label class="dxf-field dxf-wide">
        <span>${escapeHtml(t("Mô bệnh học"))}</span>
        ${combo("histology", tumor.histology, "dx-histologies", t("Chọn hoặc gõ chẩn đoán"))}
      </label>
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${escapeHtml(t("Độ WHO"))}</span>
          ${select("grade", tumor.grade, lists.grades, "—")}
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
    ${datalist("dx-histologies", lists.histologies, histologyHint)}
    ${datalist("dx-markers", lists.molecularMarkers)}
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
        ${tumors.map((tumor) => {
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
 */
export function applyFieldEdit(input) {
  const draft = clinicalState.draft;
  if (!draft || !input) return false;
  const field = input.dataset.clinicalField;
  if (!field) return false;

  const tumorBlock = input.closest("[data-tumor-index]");
  const markerRow = input.closest("[data-molecular-index]");
  const eventBlock = input.closest("[data-event-index]");

  if (markerRow && tumorBlock) {
    const tumor = draft.tumors[Number(tumorBlock.dataset.tumorIndex)];
    if (!tumor) return false;
    const entries = Object.entries(tumor.molecular || {});
    const index = Number(markerRow.dataset.molecularIndex);
    if (!entries[index]) return false;
    const [name, value] = entries[index];
    entries[index] = field === "molecularName"
      ? [input.value.trim(), value]
      : [name, input.value.trim()];
    // Rebuilt rather than mutated so a renamed marker keeps its position, which
    // is where the person's cursor is.
    tumor.molecular = Object.fromEntries(entries.filter(([key]) => key));
    return false;
  }

  if (tumorBlock) {
    const tumor = draft.tumors[Number(tumorBlock.dataset.tumorIndex)];
    if (!tumor) return false;
    tumor[field] = input.value;
    if (field === "compartment") {
      // The location and axis lists belong to a compartment. Anything typed
      // under the old one is kept — it may still be right, and silently
      // clearing a field somebody typed is worse than offering a new list.
      return true;
    }
    return false;
  }

  if (eventBlock) {
    const event = draft.events[Number(eventBlock.dataset.eventIndex)];
    if (!event) return false;
    event[field] = NUMBER_FIELDS.has(field) ? readNumber(input.value) : input.value;
    return field === "kind";
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

export function removeMarker(tumorIndex, markerIndex) {
  const tumor = clinicalState.draft?.tumors?.[tumorIndex];
  if (!tumor) return;
  const entries = Object.entries(tumor.molecular || {});
  entries.splice(markerIndex, 1);
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
