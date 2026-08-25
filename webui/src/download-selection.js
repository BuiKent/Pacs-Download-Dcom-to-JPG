export function initialiseStudySelections(studies, nameConflict = false) {
  return (studies || []).map((study) => ({
    ...study,
    selected: !nameConflict && study.selected !== undefined
      ? Boolean(study.selected)
      : !nameConflict && study.local_status !== "downloaded",
  }));
}

export function selectedStudies(studies) {
  return (studies || []).filter((study) => study.selected === true);
}

export function seriesSelections(groups) {
  return Object.fromEntries((groups || []).map((group) => [
    group.studyUid,
    (group.series || [])
      .filter((series) => series.selected !== false)
      .map((series) => series.id),
  ]));
}

export function rememberSeriesSelections(groups, previous = {}) {
  return { ...previous, ...seriesSelections(groups) };
}

export function restoreSeriesSelections(groups, remembered = {}) {
  return (groups || []).map((group) => {
    const hasRemembered = Object.prototype.hasOwnProperty.call(remembered, group.studyUid);
    const selectedIds = new Set(remembered[group.studyUid] || []);
    return {
      ...group,
      series: (group.series || []).map((series) => ({
        ...series,
        selected: hasRemembered ? selectedIds.has(series.id) : true,
      })),
    };
  });
}

/**
 * Chosen studies that have no series ticked yet.
 *
 * The download button reads this to name the date that is holding it back: a
 * button that switches off without a word is what sent a user hunting through
 * a full series list for a study that was never scanned.
 */
export function studiesMissingSeries(studies, groups) {
  const selections = seriesSelections(groups);
  return selectedStudies(studies).filter((study) => {
    const uid = String(study.study_uid || "").trim();
    const chosen = selections[uid];
    return !(Array.isArray(chosen) && chosen.length > 0);
  });
}

export function hasCompleteSeriesSelection(studies, groups) {
  if (!selectedStudies(studies).length) return false;
  return studiesMissingSeries(studies, groups).length === 0;
}
