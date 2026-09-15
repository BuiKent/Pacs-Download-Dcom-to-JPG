"""The clinical record that sits beside a patient's images.

Neither DICOM nor `patient-index.json` can answer the two questions a
neuro-oncology list is actually read for: what this tumour is, and where the
patient is in their treatment right now. `StudyDescription` is the exam that
was ordered. The manifest is what the download pipeline read off the tags.
Both are machine-written, and neither knows that a glioblastoma was resected in
July and is being irradiated in September.

So the record lives in its own file, `clinical-index.json`, next to
`patient-index.json` in the patient folder, and it is written by people rather
than by the pipeline. Keeping the two apart is deliberate:

  * a pipeline bug can rewrite the manifest; it must not be able to erase a
    clinical record typed by hand,
  * the worklist reads the manifest on every scan, and an event log that grows
    for years has no business in a file on that path,
  * every clinical entry carries who wrote it and when, which the manifest has
    no concept of.

Three layers live here, and they are not interchangeable:

  tumours   what the disease is — location, histology, grade, molecular
            markers, and `basis`, which says whether that came from a report
            or from looking at the images
  events    what has been done about it — surgery, radiotherapy, chemotherapy
            — each with where it happened and when it started and ended
  note      the free text that catches whatever the two above cannot hold;
            this one still lives on `patient-index.json`, where it always has

The current treatment stage is *derived* from the events and never typed. A
stage typed as a snapshot — "đang xạ" — is true on the day it is written and
quietly wrong for months afterwards. Derived from an event with no end date, it
stays true until someone closes the event, and when a course has clearly run
past its expected length the record says it has gone stale rather than keep
asserting a treatment that may have finished.
"""

from __future__ import annotations

import datetime
import json
import math
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

CLINICAL_RECORD_NAME = "clinical-index.json"
CLINICAL_RECORD_FORMAT = "dcom-clinical-v1"

# ---------------------------------------------------------------------------
# Controlled vocabularies
#
# These are user-facing Vietnamese, because they are read off the screen by the
# doctor filling the form in. They are also served to the web UI over the API
# rather than copied into the JavaScript, so there is one list rather than two
# that drift apart.
#
# None of them is a closed set. Every field that uses one accepts typed text as
# well, because a list of thirty entities cannot cover a pathology report and a
# record that will not accept the real answer gets a wrong one instead.
# ---------------------------------------------------------------------------

COMPARTMENTS = ("Nội sọ", "Tuỷ sống")

# Which anatomy the location list offers depends on the compartment: a tumour
# of the cerebellopontine angle and one at T4-T6 do not belong in the same
# dropdown, and one flat list of both is how a spinal level ends up filed
# against a brain.
LOCATIONS = {
    "Nội sọ": (
        "Thuỳ trán", "Thuỳ đỉnh", "Thuỳ thái dương", "Thuỳ chẩm", "Thuỳ đảo",
        "Thể chai", "Đồi thị", "Hạch nền", "Não thất bên", "Não thất III",
        "Não thất IV", "Vùng tuyến tùng", "Vùng yên", "Vùng trên yên",
        "Góc cầu tiểu não", "Thân não", "Tiểu não", "Hố sau",
        "Nền sọ trước", "Nền sọ giữa", "Nền sọ sau", "Lỗ chẩm",
        "Xoang tĩnh mạch dọc trên", "Cạnh liềm não", "Lều tiểu não",
        "Màng não lan toả",
    ),
    "Tuỷ sống": (
        "Bản lề cổ-chẩm", "C1-C2", "Cột sống cổ", "Bản lề cổ-ngực",
        "Cột sống ngực", "Bản lề ngực-thắt lưng", "Cột sống thắt lưng",
        "Nón tuỷ", "Đuôi ngựa", "Cùng-cụt", "Đám rối cánh tay",
    ),
}

# Where the tumour sits relative to the neural tissue and its coverings. This
# is the axis a surgeon plans around, and it is asked separately from location
# because the same level can hold any of them.
AXES = {
    "Nội sọ": ("Trong trục", "Ngoài trục"),
    "Tuỷ sống": ("Nội tuỷ", "Ngoài tuỷ - trong màng cứng", "Ngoài màng cứng"),
}

SIDES = ("P", "T", "Giữa", "Hai bên")

# The thirty-odd entities a neuro-oncology list is mostly made of, in the order
# a brain list then a spine list runs. Anything outside them is typed.
HISTOLOGIES = (
    "U tế bào hình sao lan toả, IDH đột biến",
    "U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q",
    "U nguyên bào thần kinh đệm, IDH tự nhiên",
    "U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi",
    "U tế bào hình sao lông",
    "U tế bào hình sao vàng đa hình",
    "U tế bào hình sao dưới màng não thất tế bào khổng lồ",
    "U màng não thất",
    "U nguyên bào tuỷ",
    "U hạch thần kinh đệm",
    "U biểu mô thần kinh loạn sản phôi",
    "U màng não",
    "U bao sợi thần kinh",
    "U sợi thần kinh",
    "U tế bào quanh mạch",
    "U tuyến yên",
    "U sọ hầu",
    "U tế bào mầm nội sọ",
    "U nguyên bào mạch máu",
    "U đám rối mạch mạc",
    "U lympho thần kinh trung ương nguyên phát",
    "U di căn",
    "U dây sống",
    "U mỡ",
    "U bì",
    "U thượng bì",
    "Nang keo",
    "Nang màng nhện",
    "U mạch thể hang",
    "Dị dạng thông động tĩnh mạch",
)

# WHO grades are 1 to 4. An empty grade is a grade nobody has assigned yet, and
# it stays empty.
GRADES = ("1", "2", "3", "4")

# The markers a neuro-oncology report actually turns on. Values are typed
# because a report says "methyl hoá 42%", not "có".
MOLECULAR_MARKERS = (
    "IDH1/2", "1p/19q", "MGMT", "ATRX", "TERT", "TP53",
    "H3 K27", "H3 G34", "BRAF", "EGFR", "Ki-67",
)

# What the diagnosis rests on. This is the field that keeps an impression from
# being read as a result: a tumour whose basis is "Hình ảnh" has not been under
# a microscope, and the record must not let that be forgotten.
DIAGNOSIS_BASES = ("Hình ảnh", "Mô bệnh học")

EVENT_KINDS = (
    "Mổ", "Xạ", "Hoá", "Đích/Miễn dịch", "Theo dõi",
    "Tái phát/Tiến triển", "Biến chứng",
)

# The treatments that put a patient "in the middle of something" while they are
# open. A follow-up visit or a recorded relapse is an event, not a course.
ONGOING_KINDS = ("Xạ", "Hoá", "Đích/Miễn dịch")

# How much of a tumour came out, in the words an operation note uses.
RESECTION_EXTENTS = (
    "Lấy toàn bộ", "Lấy gần toàn bộ", "Lấy một phần", "Sinh thiết",
    "Chỉ mở sọ giải áp", "Dẫn lưu não thất",
)

RADIOTHERAPY_TECHNIQUES = (
    "3D-CRT", "IMRT", "VMAT", "Proton", "Xạ phẫu Gamma Knife",
    "Xạ phẫu CyberKnife", "Xạ toàn não", "Xạ trục não tuỷ",
)

CHEMO_REGIMENS = (
    "Temozolomide đồng thời", "Temozolomide bổ trợ", "PCV",
    "Bevacizumab", "Carboplatin - Vincristine", "Cisplatin - Etoposide",
    "Lomustine",
)

# A radiotherapy course runs five fractions a week, so a course of `n`
# fractions is expected to take `ceil(n / 5)` weeks. Two weeks of slack absorb
# a public holiday or a machine breakdown before the record starts saying that
# nobody has updated it.
RADIOTHERAPY_FRACTIONS_PER_WEEK = 5
STALE_COURSE_GRACE_DAYS = 14
# A resection is worth flagging as a fresh post-operative state for about a
# month; after that the patient is being followed, not recovering.
POST_OP_WINDOW_DAYS = 30


def vocabulary() -> dict:
    """Every list the clinical form offers, as one payload for the web UI.

    Served rather than duplicated in JavaScript: two copies of a controlled
    vocabulary are two vocabularies as soon as one of them is edited.
    """
    return {
        "compartments": list(COMPARTMENTS),
        "locations": {key: list(value) for key, value in LOCATIONS.items()},
        "axes": {key: list(value) for key, value in AXES.items()},
        "sides": list(SIDES),
        "histologies": list(HISTOLOGIES),
        "grades": list(GRADES),
        "molecularMarkers": list(MOLECULAR_MARKERS),
        "diagnosisBases": list(DIAGNOSIS_BASES),
        "eventKinds": list(EVENT_KINDS),
        "ongoingKinds": list(ONGOING_KINDS),
        "resectionExtents": list(RESECTION_EXTENTS),
        "radiotherapyTechniques": list(RADIOTHERAPY_TECHNIQUES),
        "chemoRegimens": list(CHEMO_REGIMENS),
    }


# ---------------------------------------------------------------------------
# Reading and writing
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def _text(value: Any, limit: int = 400) -> str:
    return str(value or "").strip()[:limit]


def _date(value: Any) -> str:
    """A date, or nothing at all.

    Anything that is not a calendar date is dropped rather than stored as
    typed: a half-entered date that sorts as text would put an event in the
    wrong place on a timeline the stage is derived from.
    """
    text = str(value or "").strip()
    if not _DATE_RE.match(text):
        return ""
    try:
        datetime.date.fromisoformat(text)
    except ValueError:
        return ""
    return text


def _int(value: Any) -> Optional[int]:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _identifier(value: Any) -> str:
    text = re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:40]
    return text or uuid.uuid4().hex[:12]


def _clean_tumor(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    compartment = _text(raw.get("compartment"), 40)
    if compartment not in COMPARTMENTS:
        compartment = ""
    side = _text(raw.get("side"), 20)
    basis = _text(raw.get("basis"), 40)
    if basis not in DIAGNOSIS_BASES:
        basis = ""
    grade = _text(raw.get("grade"), 4)
    if grade not in GRADES:
        grade = ""
    markers = raw.get("molecular")
    molecular = {
        _text(key, 40): _text(value, 80)
        for key, value in (markers.items() if isinstance(markers, dict) else [])
        if _text(key, 40) and _text(value, 80)
    }
    tumor = {
        "id": _identifier(raw.get("id")),
        "compartment": compartment,
        "location": _text(raw.get("location"), 120),
        "side": side,
        "axis": _text(raw.get("axis"), 80),
        "histology": _text(raw.get("histology"), 200),
        "grade": grade,
        "molecular": molecular,
        "basis": basis,
        "confirmedAt": _date(raw.get("confirmedAt")),
        "source": _text(raw.get("source"), 300),
        "note": _text(raw.get("note")),
        "updatedAt": _text(raw.get("updatedAt"), 40) or _now(),
    }
    # A tumour with nothing said about it is not a tumour, it is an empty row
    # somebody opened and abandoned.
    if not any(tumor[key] for key in ("compartment", "location", "histology", "note")):
        return None
    return tumor


def _clean_event(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    kind = _text(raw.get("kind"), 40)
    if kind not in EVENT_KINDS:
        return None
    fractions = _int(raw.get("fractions"))
    cycles = _int(raw.get("cycles"))
    cycles_done = _int(raw.get("cyclesDone"))
    dose = _int(raw.get("doseGy"))
    return {
        "id": _identifier(raw.get("id")),
        "kind": kind,
        "start": _date(raw.get("start")),
        "end": _date(raw.get("end")),
        "where": _text(raw.get("where"), 160),
        "extent": _text(raw.get("extent"), 80),
        "technique": _text(raw.get("technique"), 80),
        "regimen": _text(raw.get("regimen"), 120),
        "doseGy": dose,
        "fractions": fractions,
        "cycles": cycles,
        "cyclesDone": cycles_done,
        "note": _text(raw.get("note")),
        "updatedAt": _text(raw.get("updatedAt"), 40) or _now(),
    }


def empty_record(patient_id: str = "") -> dict:
    return {
        "format": CLINICAL_RECORD_FORMAT,
        "patientId": _text(patient_id, 80),
        "tumors": [],
        "events": [],
        "createdAt": _now(),
        "updatedAt": _now(),
    }


def normalise(raw: Any, patient_id: str = "") -> dict:
    """Bring anything read off disk or posted by the UI into shape.

    Unknown keys are dropped rather than carried: this file is edited by hand
    often enough that a typo should not become part of the format.
    """
    data = raw if isinstance(raw, dict) else {}
    tumors = [t for t in (_clean_tumor(item) for item in _as_list(data.get("tumors"))) if t]
    events = [e for e in (_clean_event(item) for item in _as_list(data.get("events"))) if e]
    # Newest first is how the rail reads them, and how the stage below is
    # decided. Events with no start date sort last: they are undated, not old.
    events.sort(key=lambda item: item.get("start") or "", reverse=True)
    return {
        "format": CLINICAL_RECORD_FORMAT,
        "patientId": _text(data.get("patientId") or patient_id, 80),
        "tumors": tumors,
        "events": events,
        "createdAt": _text(data.get("createdAt"), 40) or _now(),
        "updatedAt": _now(),
    }


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def record_path(patient_folder: Path | str) -> Path:
    return Path(patient_folder) / CLINICAL_RECORD_NAME


def read_record(patient_folder: Path | str) -> Optional[dict]:
    """The record on disk, or None when the patient has none yet.

    Never raises. A record that cannot be read is reported as absent, which
    shows a blank form rather than an error on top of a patient's images; the
    file itself is left alone so it can be looked at rather than overwritten.
    """
    path = record_path(patient_folder)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or raw.get("format") != CLINICAL_RECORD_FORMAT:
        return None
    return normalise(raw)


def write_record(patient_folder: Path | str, record: dict) -> dict:
    """Replace the record, writing through a temporary file.

    A half-written clinical record is worse than none: the next read would
    reject it as malformed and the form would come up blank, which reads as
    "nothing was ever entered" rather than "the last save was interrupted".
    """
    folder = Path(patient_folder)
    folder.mkdir(parents=True, exist_ok=True)
    cleaned = normalise(record)
    path = record_path(folder)
    temporary = folder / f"{CLINICAL_RECORD_NAME}.{uuid.uuid4().hex}.tmp"
    payload = json.dumps(cleaned, ensure_ascii=False, indent=2)
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass
    return cleaned


# ---------------------------------------------------------------------------
# What the record means
# ---------------------------------------------------------------------------


def diagnosis_label(record: Optional[dict]) -> str:
    """The one line a worklist row has room for.

    Histology leads, then grade, then where it is — the order a case is spoken
    aloud. Every part is dropped when it is unknown, so a record that only
    knows the location reads as the location and not as a row of dashes.
    """
    if not record:
        return ""
    labels = []
    for tumor in record.get("tumors") or []:
        head = tumor.get("histology") or ""
        grade = tumor.get("grade") or ""
        if head and grade:
            head = f"{head} (độ {grade})"
        elif grade and not head:
            head = f"Độ {grade}"
        site = " ".join(part for part in (tumor.get("location"), tumor.get("side")) if part)
        part = " · ".join(piece for piece in (head, site) if piece)
        if part:
            labels.append(part)
    return " # ".join(labels)


def _expected_end(event: dict) -> str:
    """When a course that gave its length should have finished.

    Only radiotherapy states its own length precisely enough to compute this,
    in fractions. A chemotherapy regimen counted in cycles is left alone: cycle
    length varies by regimen, and guessing one would produce a "stale" warning
    that is itself wrong.
    """
    start = event.get("start") or ""
    fractions = event.get("fractions")
    if event.get("kind") != "Xạ" or not start or not fractions:
        return ""
    weeks = math.ceil(int(fractions) / RADIOTHERAPY_FRACTIONS_PER_WEEK)
    try:
        begins = datetime.date.fromisoformat(start)
    except ValueError:
        return ""
    return (begins + datetime.timedelta(weeks=weeks)).isoformat()


def treatment_stage(record: Optional[dict], today: Optional[datetime.date] = None) -> dict:
    """Where the patient is right now, worked out from the events.

    Returned as parts rather than as a sentence, so the interface can put them
    together in whichever language it is showing.

    `state` is one of:
      relapse   the most recent thing recorded is a relapse or progression
      active    a treatment course is open — `kinds` says which, and more than
                one is normal: concurrent chemoradiotherapy is two
      post-op   an operation inside the last month with nothing since
      followup  events exist, none of them open
      unknown   nothing has been recorded, and nothing is assumed from that

    `stale` marks an open course that has run past the length it gave for
    itself. The patient is not still being irradiated eight months later; the
    record simply was not closed, and saying so is the honest reading.
    """
    today = today or datetime.date.today()
    blank = {
        "state": "unknown", "kinds": [], "where": "", "since": "",
        "stale": False, "expectedEnd": "",
    }
    if not record:
        return blank
    events = [e for e in (record.get("events") or []) if isinstance(e, dict)]
    if not events:
        return blank

    dated = [e for e in events if e.get("start")]
    latest = max(dated, key=lambda e: e["start"], default=None)
    if latest and latest.get("kind") == "Tái phát/Tiến triển":
        return {
            "state": "relapse", "kinds": ["Tái phát/Tiến triển"],
            "where": latest.get("where") or "", "since": latest.get("start") or "",
            "stale": False, "expectedEnd": "",
        }

    today_iso = today.isoformat()
    open_courses = [
        e for e in events
        if e.get("kind") in ONGOING_KINDS
        and not e.get("end")
        and (not e.get("start") or e["start"] <= today_iso)
    ]
    if open_courses:
        # Report them in the order the vocabulary lists them, so concurrent
        # chemoradiotherapy always reads "Xạ + Hoá" and never the other way
        # round depending on which row was typed first.
        kinds = [kind for kind in ONGOING_KINDS if any(e.get("kind") == kind for e in open_courses)]
        starts = [e.get("start") for e in open_courses if e.get("start")]
        expected = [_expected_end(e) for e in open_courses]
        expected = [value for value in expected if value]
        deadline = min(expected) if expected else ""
        stale = bool(
            deadline
            and today > datetime.date.fromisoformat(deadline) + datetime.timedelta(
                days=STALE_COURSE_GRACE_DAYS)
        )
        return {
            "state": "active",
            "kinds": kinds,
            "where": next((e.get("where") for e in open_courses if e.get("where")), ""),
            "since": min(starts) if starts else "",
            "stale": stale,
            "expectedEnd": deadline,
        }

    surgeries = [e for e in dated if e.get("kind") == "Mổ"]
    last_surgery = max(surgeries, key=lambda e: e["start"], default=None)
    if last_surgery and latest is last_surgery:
        operated = datetime.date.fromisoformat(last_surgery["start"])
        if (today - operated).days <= POST_OP_WINDOW_DAYS:
            return {
                "state": "post-op", "kinds": ["Mổ"],
                "where": last_surgery.get("where") or "",
                "since": last_surgery["start"], "stale": False, "expectedEnd": "",
            }

    return {
        "state": "followup", "kinds": [], "where": "",
        "since": latest.get("start") if latest else "", "stale": False, "expectedEnd": "",
    }
