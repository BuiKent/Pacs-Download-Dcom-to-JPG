"""The one place a modality code becomes the app's own vocabulary.

A Vietnamese RIS writes "CLVT" (cắt lớp vi tính) and "CHT" (cộng hưởng từ)
where DICOM writes "CT" and "MR", scanners write "MRI", and a reader's folder
name may carry any of them. Every one of those names the same examination.

That mapping used to be typed out by hand in six places. Commit 81c28bf fixed
three of them and missed `WorklistScanner._scan_study`, which is the value the
Worklist renders *and filters on*: a CT study downloaded from RIS showed as
"CLVT" in the study list and "CT" in the viewer, the modality filter offered
both as separate options, and a reader who picked "CT" silently stopped seeing
their CLVT studies. A record a doctor cannot find is the same as a record that
is not there.

Normalising is deliberately conservative. An alias is rewritten to its DICOM
code; anything else is passed through untouched, so a modality this module has
never heard of ("US", "XA", a code a new hospital sends) reaches the screen as
itself rather than being dropped or guessed at.
"""

from __future__ import annotations

import re

# Names that mean a modality DICOM already has one code for.
_ALIASES = {
    "CLVT": "CT",
    "CAT": "CT",
    "MSCT": "CT",
    "CTA": "CT",
    "CTV": "CT",
    "MRI": "MR",
    "CHT": "MR",
}

# Words that name a modality inside a folder name without being a code.
# "XUONG" is a bone CT — the reader's own word for it, and the only one of
# these carried over from the folder-name reader.
_FOLDER_WORDS = {
    "XUONG": "CT",
}

# Everything worth recognising as a modality in a folder name.
MODALITY_WORDS = frozenset(_ALIASES) | frozenset(_FOLDER_WORDS) | {"CT", "MR"}

# The codes a study folder name is allowed to lead with, as in
# "2026-08-06 - CLVT - so nao". Deliberately narrower than MODALITY_WORDS: the
# leading token also decides where the description starts, so widening it would
# silently move text out of study descriptions that already read correctly.
FOLDER_LEAD_CODES = frozenset({"CT", "MR", "MRI", "CLVT", "CHT"})


def normalize_modality(value: object) -> str:
    """The canonical code for a modality written any of the ways it is written.

    Returns "" for an empty value, and passes an unrecognised code through
    unchanged rather than guessing — a modality nobody recorded must not be
    invented, and one this module has not heard of is still real.
    """
    code = str(value or "").strip().upper()
    if not code:
        return ""
    return _ALIASES.get(code, code)


def modality_from_tokens(tokens) -> str:
    """The modality a set of folder-name words names, or "" if none do.

    CT wins a tie: a folder holding both words is far more often a CT study
    described with an MR comparison than the reverse.
    """
    seen = {str(token).strip().upper() for token in tokens if str(token).strip()}
    for word in sorted(seen):
        if word in _FOLDER_WORDS:
            return _FOLDER_WORDS[word]
    resolved = {_ALIASES.get(word, word) for word in seen if word in MODALITY_WORDS}
    if "CT" in resolved:
        return "CT"
    if "MR" in resolved:
        return "MR"
    return ""


def modality_from_text(text: str) -> str:
    """The modality named anywhere in a piece of free text, or "" if none is.

    Splits on everything that is not a letter or a digit, so the words are
    matched whole: a folder called "CTOT" or a patient named "MRAZ" is not a
    scan, and substring matching used to say it was.
    """
    tokens = {token for token in re.split(r"[^A-Z0-9]+", str(text or "").upper()) if token}
    return modality_from_tokens(tokens)


def ris_modality_flags(code: object, description: object = "") -> tuple[bool, bool]:
    """(is_mr, is_ct) as a RIS study-list entry reads.

    A Vietnamese RIS names the examination in either field and not reliably in
    both: the code may be "CLVT", "CT", "MR", or absent altogether, while the
    description carries "CT sọ não" or "Cộng hưởng từ cột sống". The study
    filter has to recognise all of it, so both fields are read.
    """
    m_dicom = str(code or "").strip().upper()
    desc = str(description or "").strip().upper()
    is_mr = (
        (m_dicom in ("MR", "MRI"))
        or ("MR" in m_dicom)
        or desc.startswith("MR")
        or ("CONG HUONG TU" in desc)
        or ("CỘNG HƯỞNG TỪ" in desc)
    )
    is_ct = (
        (m_dicom in ("CT", "CLVT", "CAT"))
        or ("CT" in m_dicom)
        or desc.startswith("CT")
        or desc.startswith("CLVT")
        or ("CAT LOP" in desc)
        or ("CẮT LỚP" in desc)
    )
    return is_mr, is_ct


def modality_from_ris(code: object, description: object = "") -> str:
    """The modality a RIS study entry names, or "" when it names none.

    The code is trusted first, then the description. When neither says
    anything, the answer is nothing.

    This used to fall back to "MR" for every study that did not look like a CT,
    so a radiograph or an ultrasound pulled from a RIS that sends no modality
    code was filed — and displayed beside the patient's name — as an MR study.
    An examination nobody recorded is not an MR.
    """
    normalized = normalize_modality(code)
    if normalized:
        return normalized
    is_mr, is_ct = ris_modality_flags(code, description)
    if is_ct:
        return "CT"
    if is_mr:
        return "MR"
    return ""
