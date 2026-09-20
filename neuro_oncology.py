"""The knowledge a neuro-oncology record is read against.

`clinical_record.py` stores what somebody typed. This module holds what that
typing *means*, and the two are kept apart on purpose: storage has to accept
whatever the pathology report actually said, while knowledge has to be allowed
to disagree with it out loud.

Three bodies of content live here.

  markers    what a molecular test can come back as. Free text made the record
             unreadable by anything but a human: "IDH1/2: (-)", "IDH: am",
             "idh1 wildtype" and "không đột biến" are one result written four
             ways, and no rule can be written against that. Each marker now
             carries the answers it can give, and the field still accepts typed
             text for the report that says something else.

  assessment the layered reading WHO CNS5 asks for. Histology and molecular
             results are not two facts filed side by side — together they are
             one integrated diagnosis, and the classification is explicit that
             a molecular result can override the grade read down a microscope.
             `assess()` works out that reading, and says where it disagrees
             with what was recorded.

  protocols  what is given for the entity, with the dose, the fractionation and
             the paper it comes from. A dropdown offering the word
             "Temozolomide" is not a protocol; 75 mg/m2/day alongside 60 Gy in
             30 fractions, then 150-200 mg/m2 on days 1-5 of 28 for six cycles,
             is.

Nothing here writes to the record. The assessment is derived on every read, so
that a marker entered next week re-reads a diagnosis entered today, and so that
a rule corrected in this file corrects every record at once rather than only
the ones saved after it.

Two rules govern the content, and both are load-bearing:

  It never invents. A marker nobody ran is reported as not run, never as
  normal. An entity this file has no rule for gets no protocol rather than a
  plausible one — a wrong regimen is worse than a blank.

  It never silently overwrites. Where the molecular result implies a grade
  other than the one recorded, both are shown and the rule is named. The record
  keeps saying what the doctor typed; the assessment says what it reads.

Sources are cited inline against the rule they support rather than collected in
a bibliography, because the citation is only useful at the point where somebody
doubts the rule.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# ---------------------------------------------------------------------------
# Molecular markers
# ---------------------------------------------------------------------------
#
# Vietnamese, because these are read off the screen by the doctor choosing
# them, and served to the web UI rather than copied into the JavaScript.
#
# `results` is offered as a list and accepted as free text, like every other
# vocabulary in this app. The difference from a plain list is that these
# particular strings are also what the rules below match on, so choosing from
# the list is what makes a record machine-readable. Typing something else is
# still allowed and still stored — it simply cannot drive a rule, and the
# assessment says so rather than guessing.

# The answer that means the test was not done. Recorded explicitly rather than
# left blank, because "chưa làm" written down is a decision and a blank field
# is an unanswered question, and a work-up list needs to tell them apart.
NOT_DONE = "Chưa làm"

MARKERS = {
    "IDH1/2": {
        "group": "U thần kinh đệm",
        "results": (
            "Đột biến",
            "Không đột biến (đã giải trình tự)",
            "IHC R132H âm tính (chưa giải trình tự)",
            NOT_DONE,
        ),
        # The distinction the two negative answers carry is the whole reason
        # this marker has four results instead of three. IHC detects IDH1
        # R132H and nothing else; roughly one IDH-mutant glioma in ten carries
        # a different IDH1 codon 132 or an IDH2 codon 172 substitution that the
        # antibody cannot see. Reporting an IHC-negative case as IDH-wildtype
        # therefore turns a grade 2 astrocytoma with a good prognosis into a
        # glioblastoma. cIMPACT-NOW update 1 permits stopping at negative IHC
        # only for a CNS WHO grade 4 tumour in a patient of 55 or over
        # (Louis DN et al., Acta Neuropathol 2018;135:481-484,
        # DOI 10.1007/s00401-018-1808-0).
        "note": (
            "IHC chỉ bắt được IDH1 R132H. IHC âm tính chưa phải IDH tự nhiên, "
            "trừ u độ 4 ở bệnh nhân từ 55 tuổi trở lên."
        ),
    },
    "1p/19q": {
        "group": "U thần kinh đệm",
        "results": ("Đồng mất", "Không đồng mất", NOT_DONE),
        "note": (
            "Đồng mất toàn nhánh là tiêu chuẩn bắt buộc của u thần kinh đệm ít "
            "nhánh. Mất một phần nhánh không tính."
        ),
    },
    "ATRX": {
        "group": "U thần kinh đệm",
        "results": ("Mất biểu hiện", "Còn biểu hiện", NOT_DONE),
        "note": (
            "Mất biểu hiện ATRX hướng về u sao bào và thực tế loại trừ đồng mất "
            "1p/19q."
        ),
    },
    "CDKN2A/B": {
        "group": "U thần kinh đệm",
        "results": ("Mất đồng hợp tử", "Không mất đồng hợp tử", NOT_DONE),
        "note": (
            "Mất đồng hợp tử CDKN2A/B đưa u sao bào IDH đột biến lên độ 4 dù mô "
            "học chưa đủ tiêu chuẩn."
        ),
    },
    "TERT promoter": {
        "group": "U thần kinh đệm",
        "results": ("Đột biến", "Không đột biến", NOT_DONE),
    },
    "EGFR": {
        "group": "U thần kinh đệm",
        "results": ("Khuếch đại", "Không khuếch đại", NOT_DONE),
    },
    "Nhiễm sắc thể 7/10": {
        "group": "U thần kinh đệm",
        "results": ("Thêm 7 mất 10 (+7/-10)", "Không", NOT_DONE),
    },
    "MGMT": {
        "group": "U thần kinh đệm",
        "results": ("Methyl hoá", "Không methyl hoá", NOT_DONE),
        "note": (
            "MGMT không tham gia định danh u. Đây là yếu tố tiên lượng và dự báo "
            "đáp ứng temozolomide."
        ),
    },
    "TP53": {
        "group": "U thần kinh đệm",
        "results": ("Đột biến", "Không đột biến", "Dương tính lan toả (IHC)", NOT_DONE),
    },
    "H3 K27": {
        "group": "U thần kinh đệm",
        "results": (
            "K27M đột biến",
            "Mất biểu hiện H3K27me3",
            "Không thay đổi",
            NOT_DONE,
        ),
    },
    "H3 G34": {
        "group": "U thần kinh đệm",
        "results": ("G34R/V đột biến", "Không đột biến", NOT_DONE),
    },
    "BRAF": {
        "group": "U thần kinh đệm",
        "results": (
            "V600E đột biến",
            "Hợp nhất KIAA1549-BRAF",
            "Không đột biến",
            NOT_DONE,
        ),
    },
    "Ki-67": {
        "group": "Chung",
        "results": (),
        "unit": "%",
        "note": "Ghi tỉ lệ phần trăm, ví dụ 25%.",
    },
    "Hồ sơ methyl hoá": {
        "group": "Chung",
        "results": (),
        "note": "Ghi nhóm methyl hoá và điểm tin cậy nếu phiếu có.",
    },
    "SMARCB1/INI1": {
        "group": "U phôi",
        "results": ("Mất biểu hiện", "Còn biểu hiện", NOT_DONE),
    },
    "MYC/MYCN": {
        "group": "U phôi",
        "results": ("Khuếch đại", "Không khuếch đại", NOT_DONE),
    },
    "Nhóm u nguyên bào tuỷ": {
        "group": "U phôi",
        "results": ("WNT", "SHH TP53 tự nhiên", "SHH TP53 đột biến", "Nhóm 3", "Nhóm 4", NOT_DONE),
    },
    "ZFTA (RELA)": {
        "group": "U màng não thất",
        "results": ("Hợp nhất", "Không hợp nhất", NOT_DONE),
    },
    "SSTR2": {
        "group": "U màng não",
        "results": ("Dương tính", "Âm tính", NOT_DONE),
    },
    "Chỉ số nhân chia": {
        "group": "U màng não",
        "results": (),
        "unit": "/10 vi trường",
        "note": "U màng não: từ 4 nhân chia trở lên là độ 2, từ 20 trở lên là độ 3.",
    },
}

MOLECULAR_MARKERS = tuple(MARKERS)

def _group_markers() -> dict:
    """The markers grouped the way the picker shows them.

    Derived from `MARKERS` rather than written out beside it, so a marker
    cannot end up in the table and out of the picker. Built inside a function
    so the loop variables do not become module attributes.
    """
    groups: dict[str, tuple[str, ...]] = {}
    for name, spec in MARKERS.items():
        groups[spec["group"]] = groups.get(spec["group"], ()) + (name,)
    return groups


# Grouped so a glioma work-up is not read by scrolling past the
# medulloblastoma subgroups.
MARKER_GROUPS = _group_markers()


# ---------------------------------------------------------------------------
# What each entity has to have tested
# ---------------------------------------------------------------------------
#
# `essential` is the WHO CNS5 sense of the word: without it there is no
# integrated diagnosis, only a histological impression. `useful` changes
# management or prognosis without changing the name of the disease.
#
# Keyed by the entity as the vocabulary in `clinical_record.py` spells it. An
# entity absent from this table asks for nothing, which is the right answer for
# a metastasis or a colloid cyst and the honest one for an entity nobody has
# written a rule for yet.

WORKUP = {
    "U sao bào, IDH đột biến": {
        # ATRX and 1p/19q are alternatives, not two separate requirements.
        # What the diagnosis needs is that codeletion has been ruled out, and
        # WHO CNS5 accepts loss of ATRX as doing that — which is why a
        # department that stains for ATRX does not go on to send 1p/19q.
        # Demanding both would leave a finished work-up permanently short of
        # one test, on every astrocytoma either department ever records.
        "essential": ("IDH1/2", ("ATRX", "1p/19q"), "CDKN2A/B"),
        "useful": ("MGMT", "TP53"),
    },
    "U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q": {
        "essential": ("IDH1/2", "1p/19q"),
        "useful": ("MGMT", "TERT promoter"),
    },
    "U nguyên bào thần kinh đệm, IDH tự nhiên": {
        "essential": ("IDH1/2",),
        "useful": ("MGMT", "TERT promoter", "EGFR", "Nhiễm sắc thể 7/10"),
    },
    "U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi": {
        "essential": ("H3 K27",),
        "useful": ("IDH1/2", "MGMT"),
    },
    "U thần kinh đệm lan toả bán cầu, H3 G34 đột biến": {
        "essential": ("H3 G34",),
        "useful": ("IDH1/2", "ATRX", "TP53", "MGMT"),
    },
    "U sao bào lông": {"essential": (), "useful": ("BRAF",)},
    "U sao bào vàng đa hình": {"essential": (), "useful": ("BRAF", "CDKN2A/B")},
    "U màng não": {"essential": (), "useful": ("Chỉ số nhân chia", "CDKN2A/B", "TERT promoter", "SSTR2")},
    "U màng não thất": {"essential": (), "useful": ("ZFTA (RELA)", "H3 K27", "Hồ sơ methyl hoá")},
    "U nguyên bào tuỷ": {
        "essential": ("Nhóm u nguyên bào tuỷ",),
        "useful": ("MYC/MYCN", "TP53"),
    },
    "U quái không điển hình/dạng cơ vân": {"essential": ("SMARCB1/INI1",), "useful": ()},
}


# ---------------------------------------------------------------------------
# Treatment protocols
# ---------------------------------------------------------------------------
#
# `detail` carries the dose and the schedule because that is the part a
# regimen name leaves out and the part a reader needs. `reference` names the
# trial or the guideline the regimen rests on, so the recommendation can be
# argued with rather than only obeyed.
#
# `tier` is how strongly it is offered:
#   preferred    the standard of care for this entity
#   conditional  standard for a subgroup, and `when` says which
#   option       reasonable, and chosen for reasons this record does not hold

PROTOCOLS = {
    "stupp": {
        "name": "Phác đồ Stupp",
        "kind": "Xạ + Hoá",
        "detail": (
            "Xạ 60 Gy chia 30 phân liều, temozolomide 75 mg/m²/ngày đồng thời; "
            "sau đó temozolomide 150-200 mg/m² ngày 1-5 mỗi 28 ngày"
        ),
        "cycles": "6 chu kỳ bổ trợ",
        "reference": "Stupp R. và cs., N Engl J Med 2005;352:987-996",
    },
    "hypo_rt_tmz": {
        "name": "Xạ giảm phân liều ± temozolomide",
        "kind": "Xạ + Hoá",
        "detail": "Xạ 40 Gy chia 15 phân liều, kèm temozolomide đồng thời và bổ trợ",
        "cycles": "12 chu kỳ bổ trợ hoặc đến khi tiến triển",
        "when": "Bệnh nhân từ 65-70 tuổi trở lên hoặc thể trạng kém",
        "reference": "Perry JR. và cs., N Engl J Med 2017;376:1027-1037",
    },
    "tmz_alone": {
        "name": "Temozolomide đơn thuần",
        "kind": "Hoá",
        "detail": "Temozolomide 150-200 mg/m² ngày 1-5 mỗi 28 ngày",
        "cycles": "6 chu kỳ",
        "when": "MGMT methyl hoá, ở bệnh nhân cao tuổi không xạ được",
        "reference": "Malmström A. và cs., Lancet Oncol 2012;13:916-926",
    },
    "rt_pcv": {
        "name": "Xạ khu trú + PCV",
        "kind": "Xạ + Hoá",
        "detail": (
            "Xạ 54 Gy chia 30 phân liều; PCV: lomustine 110 mg/m² ngày 1, "
            "procarbazine 60 mg/m² ngày 8-21, vincristine 1,4 mg/m² ngày 8 và 29"
        ),
        "cycles": "6 chu kỳ PCV",
        "reference": "Buckner JC. và cs., N Engl J Med 2016;374:1344-1355 (RTOG 9802); van den Bent MJ. và cs., J Clin Oncol 2013;31:344-350 (EORTC 26951)",
    },
    "rt_tmz_astro": {
        "name": "Xạ khu trú + temozolomide bổ trợ",
        "kind": "Xạ + Hoá",
        "detail": "Xạ 54-60 Gy chia 30-33 phân liều, sau đó temozolomide 150-200 mg/m² ngày 1-5 mỗi 28 ngày",
        "cycles": "6-12 chu kỳ",
        "reference": "EANO hướng dẫn u thần kinh đệm lan toả, Nat Rev Clin Oncol 2021;18:170-186",
    },
    "watch": {
        "name": "Theo dõi bằng hình ảnh",
        "kind": "Theo dõi",
        "detail": "Cộng hưởng từ định kỳ, thường mỗi 3-6 tháng trong 5 năm đầu",
        "cycles": "",
        "reference": "EANO / NCCN hệ thần kinh trung ương",
    },
    "rt_focal": {
        "name": "Xạ khu trú",
        "kind": "Xạ",
        "detail": "Xạ 54-60 Gy chia 30-33 phân liều vào giường u và rìa",
        "cycles": "",
        "reference": "EANO / NCCN hệ thần kinh trung ương",
    },
    "hd_mtx": {
        "name": "Hoá chất nền methotrexate liều cao",
        "kind": "Hoá",
        "detail": (
            "Methotrexate 3,5 g/m² trở lên, phối hợp trong phác đồ nhiều thuốc "
            "(MATRix hoặc R-MPV), có giải cứu bằng folinate"
        ),
        "cycles": "4-6 chu kỳ, sau đó điều trị củng cố",
        "reference": "Ferreri AJM. và cs., Lancet Haematol 2016;3:e217-e227 (IELSG32)",
    },
    "csi_chemo": {
        "name": "Xạ trục não tuỷ + hoá chất",
        "kind": "Xạ + Hoá",
        "detail": (
            "Xạ trục não tuỷ 23,4-36 Gy kèm tăng liều hố sau lên 54-55,8 Gy; "
            "hoá chất nền platinum sau xạ"
        ),
        "cycles": "Theo phác đồ nhi khoa",
        "when": "Liều xạ trục hạ thấp ở nhóm nguy cơ chuẩn",
        "reference": "Packer RJ. và cs., J Clin Oncol 2006;24:4202-4208",
    },
    "gct_platinum": {
        "name": "Hoá chất nền platinum + xạ",
        "kind": "Xạ + Hoá",
        "detail": "Carboplatin hoặc cisplatin phối hợp etoposide, sau đó xạ theo nhóm mô học",
        "cycles": "4 chu kỳ",
        "reference": "Hướng dẫn u tế bào mầm nội sọ SIOP CNS GCT II",
    },
    "srs": {
        "name": "Xạ phẫu định vị",
        "kind": "Xạ",
        "detail": "Liều đơn 15-24 Gy tuỳ đường kính tổn thương",
        "cycles": "",
        "when": "Số lượng tổn thương hạn chế, bệnh ngoài sọ đang kiểm soát",
        "reference": "Brown PD. và cs., JAMA 2016;316:401-409",
    },
    "wbrt_ha": {
        "name": "Xạ toàn não bảo tồn hồi hải mã + memantine",
        "kind": "Xạ",
        "detail": "Xạ toàn não 30 Gy chia 10 phân liều, tránh hồi hải mã, kèm memantine",
        "cycles": "",
        "when": "Di căn lan toả nhiều ổ",
        "reference": "Brown PD. và cs., J Clin Oncol 2020;38:1019-1029 (NRG CC001)",
    },
    "surgery_only": {
        "name": "Phẫu thuật rồi theo dõi",
        "kind": "Theo dõi",
        "detail": "Lấy u tối đa an toàn, sau đó theo dõi bằng hình ảnh",
        "cycles": "",
        "reference": "EANO hướng dẫn u màng não, Lancet Oncol 2021;22:e383-e393",
    },
}

# Which protocols an entity is offered, and in what order.
#
# Fails closed. An entity absent from this table gets no protocol at all,
# because the cost of a blank is that somebody looks it up, and the cost of a
# guess is that somebody does not.
_ROUTES = {
    "gbm": {
        "preferred": ("stupp",),
        "conditional": ("hypo_rt_tmz", "tmz_alone"),
    },
    "astro_idh_g4": {
        "preferred": ("rt_tmz_astro",),
        "conditional": ("stupp",),
    },
    "astro_idh_low": {
        "preferred": ("rt_pcv",),
        "conditional": ("rt_tmz_astro", "watch"),
    },
    "oligo": {
        "preferred": ("rt_pcv",),
        "conditional": ("watch",),
    },
    "h3_altered": {
        "preferred": ("rt_focal",),
        "conditional": ("stupp",),
    },
    "pilocytic": {
        "preferred": ("surgery_only",),
        "conditional": ("rt_focal",),
    },
    "meningioma_1": {"preferred": ("surgery_only",), "conditional": ("rt_focal",)},
    "meningioma_2": {"preferred": ("surgery_only",), "conditional": ("rt_focal",)},
    "meningioma_3": {"preferred": ("rt_focal",), "conditional": ()},
    "pcnsl": {"preferred": ("hd_mtx",), "conditional": ()},
    "medulloblastoma": {"preferred": ("csi_chemo",), "conditional": ()},
    "germinoma": {"preferred": ("gct_platinum",), "conditional": ()},
    "metastasis": {"preferred": ("srs",), "conditional": ("wbrt_ha",)},
    "schwannoma": {"preferred": ("surgery_only",), "conditional": ("srs",)},
}


# ---------------------------------------------------------------------------
# Reading what was recorded
# ---------------------------------------------------------------------------


def _fold(value: Any) -> str:
    """Lower case, no diacritics, single spaces — for matching typed text only.

    Used to recognise an entity somebody typed rather than chose. Never used on
    anything that gets stored or displayed: the record keeps the words it was
    given.
    """
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d")
    return re.sub(r"\s+", " ", text).strip()


def marker(tumor: Any, name: str) -> str:
    """One marker's recorded result, or "" if it was never entered.

    A marker recorded as `NOT_DONE` returns that string rather than "": the
    difference between "somebody said the test was not done" and "nobody has
    said anything" is the difference between a closed question and an open one.
    """
    molecular = (tumor or {}).get("molecular")
    if not isinstance(molecular, dict):
        return ""
    return str(molecular.get(name) or "").strip()


def _is(tumor: Any, name: str, *results: str) -> bool:
    """Whether a marker holds one of the listed results, exactly as listed.

    Deliberately an exact comparison. Rules only fire on answers chosen from
    the marker's own list, so typed text can never be read as a result it
    merely resembles — "không đột biến 1p/19q" must not satisfy a test for
    "Không đồng mất".
    """
    return marker(tumor, name) in results


def _entity(tumor: Any) -> str:
    return str((tumor or {}).get("histology") or "").strip()


def _states(tumor: Any, *phrases: str) -> bool:
    """Whether the recorded entity name itself asserts something.

    The WHO CNS5 entity names carry their own molecular claims — "IDH đột
    biến", "đồng mất 1p/19q" — so the name is a second source for the same
    fact, and the two can disagree. That disagreement is worth surfacing, which
    is what this is for.
    """
    folded = _fold(_entity(tumor))
    return any(_fold(phrase) in folded for phrase in phrases)


# How a typed diagnosis is recognised: a folded phrase, the route it implies,
# and the phrases that veto it.
#
# The veto column exists because one Vietnamese entity name can be the opening
# of another. "U màng não thất" — an ependymoma, and no relation — begins with
# every character of "U màng não", so a plain substring match offered a
# meningioma's surgery-and-surveillance route to an ependymoma. Lengthening the
# needle does not help: the collision is a prefix, and only naming the longer
# term keeps the shorter one from swallowing it.
#
# This is matching on free text and nothing else. An entity chosen from the
# list is settled above by exact lookup, and one the list holds but this file
# has no rule for gets nothing rather than the nearest-looking answer.
_LOOSE = (
    ("glioblastoma", "gbm", ()),
    ("u nguyen bao than kinh dem", "gbm", ()),
    ("oligodendroglioma", "oligo", ()),
    ("u than kinh dem it nhanh", "oligo", ()),
    ("u lympho", "pcnsl", ()),
    ("lymphoma", "pcnsl", ()),
    ("di can", "metastasis", ()),
    ("metasta", "metastasis", ()),
    ("u mang nao", "meningioma_1", ("mang nao that", "ependymoma")),
    ("meningioma", "meningioma_1", ()),
)


# The entities whose route is settled by the name alone, whatever else is on
# the record. Every one of these is a WHO CNS5 name carrying its own molecular
# claims, so there is nothing left for a rule to decide.
_EXACT_ROUTES = {
    "U nguyên bào thần kinh đệm, IDH tự nhiên": "gbm",
    "U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q": "oligo",
    "U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi": "h3_altered",
    "U thần kinh đệm lan toả bán cầu, H3 G34 đột biến": "h3_altered",
    "U sao bào lông": "pilocytic",
    "U nguyên bào tuỷ": "medulloblastoma",
    "U lympho thần kinh trung ương nguyên phát": "pcnsl",
    "U di căn": "metastasis",
    "U tế bào mầm nội sọ": "germinoma",
    "U bao sợi thần kinh": "schwannoma",
}


def _meningioma_route(tumor: Any) -> str:
    """Which meningioma route, read off the grade the molecular results imply.

    `effective_grade` rather than the recorded grade, so a grade 1 meningioma
    with a TERT promoter mutation is treated as the grade 3 WHO CNS5 says it
    is. A grade nobody has assigned falls back to the grade 1 route, which is
    surgery and surveillance — the one answer that is safe to offer before the
    grading is in.
    """
    grade = effective_grade(tumor)["grade"]
    return f"meningioma_{grade}" if grade in ("1", "2", "3") else "meningioma_1"


def route_key(tumor: Any) -> str:
    """Which treatment route the entity belongs to, or "" if this file has none.

    Matched against the controlled vocabulary first and against folded free
    text second, so a diagnosis chosen from the list always routes and a typed
    one routes when it is recognisable. Anything else returns "", and the
    caller offers nothing.
    """
    entity = _entity(tumor)
    if not entity:
        return ""
    if entity in _EXACT_ROUTES:
        return _EXACT_ROUTES[entity]

    # The two entities whose route depends on the grade as well as the name.
    if entity == "U sao bào, IDH đột biến":
        return "astro_idh_g4" if effective_grade(tumor)["grade"] == "4" else "astro_idh_low"
    if entity == "U màng não":
        return _meningioma_route(tumor)

    folded = _fold(entity)
    for needle, key, veto in _LOOSE:
        if needle not in folded:
            continue
        if any(blocked in folded for blocked in veto):
            continue
        return _meningioma_route(tumor) if key == "meningioma_1" else key
    return ""


# ---------------------------------------------------------------------------
# What the rules say when they fire
# ---------------------------------------------------------------------------
#
# Named rather than written inline at the point of use, for two reasons. A
# sentence that appears on screen has to be translatable, and `display_terms`
# below cannot enumerate a string literal buried in a branch — so an inline one
# would reach an English screen in Vietnamese with nothing to catch it. And a
# rule quoted in the interface is a claim about the classification, which is
# easier to check against the source when all of them are in one place.

RULE_CDKN2A_GRADE_4 = (
    "Mất đồng hợp tử CDKN2A/B trong u sao bào IDH đột biến là tiêu chuẩn độ 4 "
    "của WHO CNS5, không phụ thuộc mô học."
)

RULE_MENINGIOMA_GRADE_3 = (
    "U màng não có đột biến TERT promoter hoặc mất đồng hợp tử CDKN2A/B được "
    "xếp độ 3 theo WHO CNS5."
)

CONFLICT_CODELETED_ASTROCYTOMA = (
    "Đồng mất 1p/19q loại trừ u sao bào. Đối chiếu lại: đây nhiều khả năng là "
    "u thần kinh đệm ít nhánh."
)


# ---------------------------------------------------------------------------
# Grade, after the molecular results have had their say
# ---------------------------------------------------------------------------


def effective_grade(tumor: Any) -> dict:
    """The grade the molecular results imply, and where it came from.

    Returns `grade`, `recorded`, `source` (`molecular` when a rule moved it,
    `recorded` otherwise) and `rule`, the sentence naming what moved it.

    The recorded grade is never changed by this — it is returned alongside. A
    record that says grade 2 keeps saying grade 2; the reading beside it says
    the CDKN2A/B result makes it a grade 4, and names the rule so the reader
    can check.
    """
    recorded = str((tumor or {}).get("grade") or "").strip()
    blank = {"grade": recorded, "recorded": recorded, "source": "recorded", "rule": ""}
    if not tumor:
        return blank

    # WHO CNS5: homozygous deletion of CDKN2A/B in an IDH-mutant astrocytoma is
    # a CNS WHO grade 4 criterion in its own right, regardless of whether
    # necrosis or microvascular proliferation is present
    # (Louis DN et al., Neuro-Oncology 2021;23:1231-1251,
    # DOI 10.1093/neuonc/noab106).
    if _states(tumor, "U sao bào, IDH đột biến") and _is(tumor, "CDKN2A/B", "Mất đồng hợp tử"):
        return {
            "grade": "4",
            "recorded": recorded,
            "source": "molecular",
            "rule": RULE_CDKN2A_GRADE_4,
        }

    # WHO CNS5 meningioma: TERT promoter mutation or homozygous CDKN2A/B
    # deletion defines CNS WHO grade 3 whatever the mitotic count
    # (ibid., meningioma section).
    if _states(tumor, "U màng não", "meningioma") and (
        _is(tumor, "TERT promoter", "Đột biến")
        or _is(tumor, "CDKN2A/B", "Mất đồng hợp tử")
    ):
        return {
            "grade": "3",
            "recorded": recorded,
            "source": "molecular",
            "rule": RULE_MENINGIOMA_GRADE_3,
        }

    return blank


# ---------------------------------------------------------------------------
# Where the record disagrees with itself
# ---------------------------------------------------------------------------

# Each entry: the entity phrase that makes the check apply, the marker, the
# results that contradict it, and what to say. Kept as data because the shape
# of every one of these is identical, and a table of six is read in one go
# while six near-identical `if` blocks are read one at a time.
_CONTRADICTIONS = (
    (
        ("IDH đột biến",),
        "IDH1/2",
        ("Không đột biến (đã giải trình tự)",),
        "Tên chẩn đoán ghi IDH đột biến nhưng kết quả giải trình tự là không đột biến.",
    ),
    (
        ("IDH tự nhiên",),
        "IDH1/2",
        ("Đột biến",),
        "Tên chẩn đoán ghi IDH tự nhiên nhưng kết quả xét nghiệm là đột biến.",
    ),
    (
        ("đồng mất 1p/19q",),
        "1p/19q",
        ("Không đồng mất",),
        "Tên chẩn đoán ghi đồng mất 1p/19q nhưng kết quả là không đồng mất.",
    ),
    (
        ("H3 K27 thay đổi",),
        "H3 K27",
        ("Không thay đổi",),
        "Tên chẩn đoán ghi H3 K27 thay đổi nhưng kết quả là không thay đổi.",
    ),
    (
        ("H3 G34 đột biến",),
        "H3 G34",
        ("Không đột biến",),
        "Tên chẩn đoán ghi H3 G34 đột biến nhưng kết quả là không đột biến.",
    ),
)


def contradictions(tumor: Any) -> list[dict]:
    """Every place the entity name and the molecular results cannot both be true.

    These are not warnings about missing work — they are two recorded facts
    that contradict each other, which means one of them is a typing error, and
    a reader who does not know which should not be left to average them.
    """
    found = []
    for phrases, name, bad, text in _CONTRADICTIONS:
        if _states(tumor, *phrases) and _is(tumor, name, *bad):
            found.append({"marker": name, "result": marker(tumor, name), "text": text})

    # An astrocytoma cannot be codeleted, and an ATRX-retained, codeleted
    # tumour is an oligodendroglioma however it was filed. WHO CNS5 makes the
    # two lines mutually exclusive, so this is a misfiling rather than an
    # unusual result.
    if _states(tumor, "U sao bào") and _is(tumor, "1p/19q", "Đồng mất"):
        found.append({
            "marker": "1p/19q",
            "result": marker(tumor, "1p/19q"),
            "text": CONFLICT_CODELETED_ASTROCYTOMA,
        })
    return found


# ---------------------------------------------------------------------------
# What is still missing
# ---------------------------------------------------------------------------


def _answered(tumor: Any, name: str) -> bool:
    """Whether a marker has an answer that settles anything.

    Two answers look filled in and settle nothing.

    `NOT_DONE` is one: somebody has answered the question of whether the test
    would be run, not the question it would have answered.

    Free text is the other, and it is the one that used to slip through. The
    rules match the listed results exactly, so "chờ kết quả giải trình tự" in
    the IDH field drives nothing — yet counting it as answered was enough to
    report a glioblastoma as an integrated diagnosis on the strength of a note
    saying the sequencing had not come back. The text is still stored and still
    shown, because it is what the report said; it just cannot close a
    requirement.

    Markers that carry a measurement rather than a verdict — Ki-67, the mitotic
    count, a methylation class — have no list to match against, so for those any
    text at all is the answer.
    """
    value = marker(tumor, name)
    if not value or value == NOT_DONE:
        return False
    results = MARKERS.get(name, {}).get("results", ())
    return value in results if results else True


def _unreadable(tumor: Any, name: str) -> bool:
    """Whether a marker holds text that no rule can read.

    Distinct from empty, and reported distinctly: "chưa có" sends somebody to
    order a test, while "đã có nhưng máy không đọc được" sends them to tidy up
    a field that already holds the answer.
    """
    value = marker(tumor, name)
    if not value or value == NOT_DONE:
        return False
    return not _answered(tumor, name)


def _pending(tumor: Any, entries: tuple, essential: bool) -> list[dict]:
    """The listed requirements that have no usable answer yet.

    An entry is either a marker name or a tuple of names meaning *any one of
    these*. The alternative form exists because some requirements are about a
    question rather than a test: an IDH-mutant glioma has to have codeletion
    ruled out, and either ATRX or 1p/19q rules it out, so a record carrying one
    of them is not missing the other.

    A declined test is still pending, but reported as `declined` so the reader
    is not sent to ask a question somebody already considered. A group counts
    as declined only when every alternative in it was declined — one blank
    alternative means the question is still open rather than closed.

    `unreadable` marks a requirement whose field holds text the rules cannot
    match. That is a different errand from an untested marker — the answer is
    on the record and needs transcribing into a listed result, not ordering —
    and it is why such a field no longer closes a requirement.
    """
    pending = []
    for entry in entries:
        names = entry if isinstance(entry, tuple) else (entry,)
        if any(_answered(tumor, name) for name in names):
            continue
        pending.append({
            # A list rather than a joined string: the interface says "ATRX
            # hoặc 1p/19q" or "ATRX or 1p/19q" depending on the language on
            # screen, and a word joined in here would be Vietnamese in both.
            "markers": list(names),
            "essential": essential,
            "declined": all(marker(tumor, name) == NOT_DONE for name in names),
            "unreadable": any(_unreadable(tumor, name) for name in names),
            "note": next(
                (MARKERS[name]["note"] for name in names
                 if MARKERS.get(name, {}).get("note")),
                "",
            ),
        })
    return pending


def missing(tumor: Any) -> list[dict]:
    """Everything the entity's work-up asks for and the record does not have."""
    spec = WORKUP.get(_entity(tumor))
    if not spec:
        return []
    return _pending(tumor, spec["essential"], True) + _pending(tumor, spec["useful"], False)


# ---------------------------------------------------------------------------
# The reading, assembled
# ---------------------------------------------------------------------------


def _molecular_line(tumor: Any, skip: tuple = ()) -> str:
    """The molecular clause of the integrated diagnosis line.

    Only results that define or grade the entity go in. MGMT and Ki-67 are
    deliberately left out: they belong to the treatment discussion, and a
    diagnosis line that carries them reads as though they named the disease.

    `skip` drops named markers. The diagnosis line uses it for markers that
    contradict the entity, because a line reading "IDH tự nhiên — IDH đột
    biến" asserts both halves of a disagreement as though they were one
    finding. The disagreement is reported as a disagreement instead.
    """
    parts = []
    defining = (
        ("IDH1/2", {"Đột biến": "IDH đột biến", "Không đột biến (đã giải trình tự)": "IDH tự nhiên"}),
        ("1p/19q", {"Đồng mất": "đồng mất 1p/19q"}),
        ("ATRX", {"Mất biểu hiện": "mất ATRX"}),
        ("CDKN2A/B", {"Mất đồng hợp tử": "mất đồng hợp tử CDKN2A/B"}),
        ("H3 K27", {"K27M đột biến": "H3 K27M đột biến"}),
        ("H3 G34", {"G34R/V đột biến": "H3 G34R/V đột biến"}),
        ("TERT promoter", {"Đột biến": "đột biến TERT promoter"}),
        ("EGFR", {"Khuếch đại": "khuếch đại EGFR"}),
        ("Nhiễm sắc thể 7/10", {"Thêm 7 mất 10 (+7/-10)": "thêm 7 mất 10"}),
    )
    for name, mapping in defining:
        if name in skip:
            continue
        phrase = mapping.get(marker(tumor, name))
        if phrase:
            parts.append(phrase)
    return ", ".join(parts)


def integrated_line(tumor: Any) -> str:
    """The diagnosis as a layered report writes it, on one line.

    Entity, then the molecular findings that were not already in the entity's
    own name, then the grade. Returns "" when there is no entity, because a
    grade and a marker without a diagnosis is not a diagnosis line.
    """
    entity = _entity(tumor)
    if not entity:
        return ""
    line = entity
    disputed = tuple(conflict["marker"] for conflict in contradictions(tumor))
    molecular = _molecular_line(tumor, skip=disputed)
    # Drop the clauses the entity name already makes, so "U sao bào, IDH đột
    # biến" does not come back as "U sao bào, IDH đột biến — IDH đột biến".
    fresh = [part for part in molecular.split(", ") if part and not _states(tumor, part)]
    if fresh:
        line = f"{line} — {', '.join(fresh)}"
    grade = effective_grade(tumor)["grade"]
    if grade:
        line = f"{line}, CNS WHO độ {grade}"
    return line


def protocols_for(tumor: Any) -> dict:
    """What is given for this tumour, as `preferred` and `conditional` lists.

    Both lists can be empty, and that is a real answer rather than a failure:
    it means this file has no rule for the entity, and a reader who is told
    nothing goes and looks it up.
    """
    key = route_key(tumor)
    route = _ROUTES.get(key)
    if not route:
        return {"route": key, "preferred": [], "conditional": []}

    def expand(ids: tuple) -> list[dict]:
        return [{"id": pid, **PROTOCOLS[pid]} for pid in ids if pid in PROTOCOLS]

    return {
        "route": key,
        "preferred": expand(route["preferred"]),
        "conditional": expand(route["conditional"]),
    }


def assess(tumor: Any) -> dict:
    """Everything this module can say about one tumour, in one payload.

    Derived on every read and never stored. A marker entered next week re-reads
    a diagnosis entered today, and a rule corrected in this file corrects every
    record in the archive rather than only the ones saved after the fix.

    `integrated` is true only when the entity is known, nothing contradicts,
    and every essential test has a real answer. It is what the interface uses
    to decide between "chẩn đoán tích hợp" and "chưa đủ căn cứ", so it fails
    closed: an entity with no work-up rule and no histological confirmation is
    not reported as integrated.
    """
    tumor = tumor if isinstance(tumor, dict) else {}
    grade = effective_grade(tumor)
    conflicts = contradictions(tumor)
    gaps = missing(tumor)
    unmet = [gap for gap in gaps if gap["essential"]]
    return {
        "line": integrated_line(tumor),
        "grade": grade,
        "conflicts": conflicts,
        "missing": gaps,
        # Histology is what makes a diagnosis integrated; an imaging impression
        # with a full molecular panel is still an impression.
        "integrated": bool(
            _entity(tumor)
            and tumor.get("basis") == "Mô bệnh học"
            and not conflicts
            and not unmet
        ),
        "protocols": protocols_for(tumor),
    }


def assess_record(record: Any) -> list[dict]:
    """`assess` for every tumour on a record, in the order they are stored."""
    tumors = (record or {}).get("tumors")
    return [assess(tumor) for tumor in (tumors if isinstance(tumors, list) else [])]


def display_terms() -> set:
    """Every Vietnamese string this module can put on a screen.

    The form's vocabulary is served through `vocabulary()` and is checked for
    English against `CLINICAL_EN` by the clinical-record tests. The rest of what
    this module says — the protocol names, the rule quoted when a grade is
    outranked, the sentence naming a contradiction — travels inside `assess`
    instead, and so was invisible to that check.

    Collected here so it is not. A sentence with no English is a sentence that
    reaches an English screen in Vietnamese, and the point of the check is that
    this is caught in a test run rather than by whoever switched languages.

    Doses, schedules and citations are deliberately left out: a dose is written
    the same way in both languages, and a translated one is a dose somebody has
    retyped.
    """
    terms = {RULE_CDKN2A_GRADE_4, RULE_MENINGIOMA_GRADE_3, CONFLICT_CODELETED_ASTROCYTOMA}
    terms.update(text for _phrases, _name, _bad, text in _CONTRADICTIONS)
    for protocol in PROTOCOLS.values():
        terms.add(protocol["name"])
        terms.add(protocol["kind"])
        if protocol.get("when"):
            terms.add(protocol["when"])
    return terms


def vocabulary() -> dict:
    """The marker knowledge the web UI needs, as one payload.

    Served rather than duplicated in JavaScript, for the same reason the rest
    of the vocabulary is: two copies of a controlled vocabulary are two
    vocabularies as soon as one of them is edited.
    """
    return {
        "molecularMarkers": list(MOLECULAR_MARKERS),
        "markerGroups": {group: list(names) for group, names in MARKER_GROUPS.items()},
        "markerResults": {
            name: list(spec.get("results", ())) for name, spec in MARKERS.items()
        },
        "markerNotes": {
            name: spec["note"] for name, spec in MARKERS.items() if spec.get("note")
        },
        "markerUnits": {
            name: spec["unit"] for name, spec in MARKERS.items() if spec.get("unit")
        },
        "workup": {
            entity: {"essential": list(spec["essential"]), "useful": list(spec["useful"])}
            for entity, spec in WORKUP.items()
        },
    }
