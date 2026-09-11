"""The one place a study's completeness is decided and named.

`patient-index.json` records how far a download actually got, in four words
that are not four ways of saying the same thing:

  complete    every image the study holds is on disk
  selected    only the series the reader picked — deliberately partial
  incomplete  a run that stopped early and has not grown since
  partial     a run whose image count has gone *down* since last time

The distinction between `selected` and the other two is clinical. A reader who
chose three of eleven series knows what they are missing; a study that lost
slices does not. Collapsing them into one "not complete" throws away the only
record of which of those two a folder is, and the reader finds out by scrolling
off the end of a stack.

These values are written into every patient folder on disk, so they are a
storage format, not an internal enum: they may be added to, never renamed.
"""

from __future__ import annotations

from typing import Optional

# Every value `patient-index.json` may carry, oldest first.
MANIFEST_STATUSES = ("complete", "selected", "incomplete", "partial")


def manifest_status(
    *,
    complete: bool,
    selection_complete: bool,
    current_count: int,
    previous: Optional[dict] = None,
) -> str:
    """What to write to `patient-index.json` after a download run.

    `current_count` of zero means this run wrote no images — a metadata-only
    update — which must not demote a study that was already complete.
    """
    record = previous if isinstance(previous, dict) else {}
    if complete:
        return "complete"
    if selection_complete:
        return "selected"
    previous_status = str(record.get("status") or "")
    previous_count = int(record.get("imageCount") or 0)
    if current_count == 0:
        # Nothing was written, so nothing was learned about completeness.
        return previous_status or "incomplete"
    if current_count < previous_count:
        # The study holds fewer images than it did. Something was removed or a
        # rewrite went wrong; either way it is not merely unfinished.
        return "partial"
    return "incomplete"


def status_without_manual_completion(record: Optional[dict]) -> str:
    """The status a study returns to when a manual "hoàn tất" mark is removed.

    Flattening every un-marked study to "incomplete" erased the reader's own
    decision: a record downloaded as a deliberate series selection came back as
    an unfinished download, and re-marking it then claimed the whole study was
    on disk when only three series ever were.
    """
    entry = record if isinstance(record, dict) else {}
    selected = [str(value) for value in (entry.get("selectedSeries") or []) if str(value)]
    if selected:
        return "selected"
    return "incomplete"


def is_downloaded(status: object) -> bool:
    """Whether a manifest status means every image is believed to be on disk."""
    return str(status or "").strip().lower() == "complete"
