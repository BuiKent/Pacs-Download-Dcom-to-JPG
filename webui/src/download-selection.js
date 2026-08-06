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

export function hasCompleteSeriesSelection(studies, groups) {
  const chosenStudies = selectedStudies(studies);
  if (!chosenStudies.length) return false;
  const selections = seriesSelections(groups);
  return chosenStudies.every((study) => {
    const uid = String(study.study_uid || "");
    return uid && Array.isArray(selections[uid]) && selections[uid].length > 0;
  });
}
