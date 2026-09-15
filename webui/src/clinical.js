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

import { t, tf } from "./i18n.js";
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
  if (item.extent) parts.push(item.extent);
  if (item.technique) parts.push(item.technique);
  if (item.regimen) parts.push(item.regimen);
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
  const place = [item.location, item.side].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  return [place, String(item.axis || "").trim()].filter(Boolean).join(" · ");
}

/** "U nguyên bào thần kinh đệm (độ 4)", or as much of it as is known. */
export function tumorHeading(tumor) {
  const item = tumor || {};
  const histology = String(item.histology || "").trim();
  const grade = String(item.grade || "").trim();
  if (histology && grade) return tf("{} (độ {})", histology, grade);
  if (histology) return histology;
  if (grade) return tf("Độ {}", grade);
  return tumorSite(item) || t("Khối u chưa mô tả");
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
    grades: value?.grades || [],
    molecularMarkers: value?.molecularMarkers || [],
    diagnosisBases: value?.diagnosisBases || [],
    eventKinds: value?.eventKinds || [],
    resectionExtents: value?.resectionExtents || [],
    radiotherapyTechniques: value?.radiotherapyTechniques || [],
    chemoRegimens: value?.chemoRegimens || [],
  };
}

function datalist(id, options) {
  return `<datalist id="${escapeHtml(id)}">${
    (options || []).map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")
  }</datalist>`;
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
      <option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>
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
      ${datalist(`dx-loc-${index}`, locations)}
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${escapeHtml(t("Bên"))}</span>
          ${select("side", tumor.side, lists.sides, "—")}
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Trục"))}</span>
          ${combo("axis", tumor.axis, `dx-axis-${index}`, t("Chọn hoặc gõ"))}
        </label>
        ${datalist(`dx-axis-${index}`, axes)}
      </div>
      <label class="dxf-field">
        <span>${escapeHtml(t("Mô bệnh học"))}</span>
        ${combo("histology", tumor.histology, "dx-histologies", t("Chọn hoặc gõ chẩn đoán"))}
      </label>
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${escapeHtml(t("Độ WHO"))}</span>
          ${select("grade", tumor.grade, lists.grades, "—")}
        </label>
        <label class="dxf-field">
          <span>${escapeHtml(t("Căn cứ"))}</span>
          ${select("basis", tumor.basis, lists.diagnosisBases, t("Chưa rõ"))}
        </label>
      </div>
      <label class="dxf-field">
        <span>${escapeHtml(t("Ngày có kết quả"))}</span>
        ${dateField("confirmedAt", tumor.confirmedAt)}
      </label>
      ${renderMolecular(tumor, index)}
      <label class="dxf-field">
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
      <label class="dxf-field">
        <span>${escapeHtml(t("Ghi chú"))}</span>
        <textarea class="dxf-input" rows="2" data-clinical-field="note"
          placeholder="${escapeHtml(t("Tuỳ chọn"))}">${escapeHtml(event.note || "")}</textarea>
      </label>
    </div>
  `;
}

function renderEditor() {
  const lists = vocab();
  const draft = clinicalState.draft || emptyRecord();
  return `
    ${datalist("dx-histologies", lists.histologies)}
    ${datalist("dx-markers", lists.molecularMarkers)}
    ${datalist("dx-extents", lists.resectionExtents)}
    ${datalist("dx-techniques", lists.radiotherapyTechniques)}
    ${datalist("dx-regimens", lists.chemoRegimens)}
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
                  title="${escapeHtml(tf("Chẩn đoán dựa trên: {}", tumor.basis))}"
                  >${escapeHtml(tumor.basis)}${tumor.confirmedAt ? ` · ${escapeHtml(formatDate(tumor.confirmedAt))}` : ""}</span>
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
              <span class="dx-event-kind">${escapeHtml(event.kind)}</span>
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

/** The whole card, in whichever of its two modes is showing. */
export function renderClinicalCard() {
  const chip = stageChip(clinicalState.stage);
  const editing = clinicalState.editing;
  return `
    <div class="rec-card dx-card${editing ? " editing" : ""}">
      <div class="rec-card-header">
        <b>${escapeHtml(t("Hồ sơ lâm sàng"))}</b>
        <div class="rec-card-actions">
          ${editing ? `
            <button class="mini-btn primary" type="button" data-action="save-clinical"
              ${clinicalState.saving ? "disabled" : ""}
              title="${escapeHtml(t("Lưu hồ sơ lâm sàng"))}">✓</button>
            <button class="mini-btn" type="button" data-action="cancel-clinical"
              title="${escapeHtml(t("Hủy"))}">✕</button>
          ` : clinicalState.canWrite ? `
            <button class="mini-btn" type="button" data-action="edit-clinical"
              title="${escapeHtml(t("Sửa hồ sơ lâm sàng"))}">✎</button>
          ` : ""}
        </div>
      </div>
      ${chip && !editing ? `
        <div class="dx-stage">
          <span class="dx-stage-chip ${escapeHtml(chip.tone)}" title="${escapeHtml(chip.title)}"
            >${escapeHtml(chip.text)}</span>
          ${chip.where ? `<span class="dx-stage-where">${escapeHtml(chip.where)}</span>` : ""}
        </div>
      ` : ""}
      ${clinicalState.error ? `
        <p class="dxf-error" role="alert">${escapeHtml(clinicalState.error)}</p>
      ` : ""}
      ${clinicalState.loading
        ? `<p class="dxf-empty">${escapeHtml(t("Đang tải hồ sơ lâm sàng…"))}</p>`
        : !clinicalState.canWrite
          ? `<p class="dxf-empty">${escapeHtml(
              clinicalState.reason
              || t("Thư mục này chưa có patient-index.json nên chưa ghi được hồ sơ lâm sàng."))}</p>`
          : editing ? renderEditor() : renderReader()}
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
