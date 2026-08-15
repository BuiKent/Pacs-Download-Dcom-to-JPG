'use strict';

function studyUid(inv) {
  return String(inv?.studyUid || '').trim();
}

export function isSameKnownStudy(primary, candidate) {
  const expected = studyUid(primary);
  const actual = studyUid(candidate);
  return Boolean(expected && actual && expected === actual);
}

export function compatibleAdapterIds(primary, inventories, rankedIds) {
  const out = [];
  for (const id of rankedIds || []) {
    const candidate = inventories?.[id];
    if (!candidate) continue;
    if (id === primary?.adapter || isSameKnownStudy(primary, candidate)) out.push(id);
  }
  return out;
}

export function mapSeriesSelection(primary, candidate, selectedIds) {
  const selected = new Set((selectedIds || []).map(String));
  const primarySeries = Array.isArray(primary?.series) ? primary.series : [];
  const candidateSeries = Array.isArray(candidate?.series) ? candidate.series : [];
  const selectedPrimary = primarySeries.filter(row => selected.has(String(row?.id || '')));
  if (!selectedPrimary.length) return [];

  const selectedAll = primarySeries.length > 0 && selectedPrimary.length === primarySeries.length;
  if (selectedAll) return candidateSeries.map(row => String(row?.id || '')).filter(Boolean);

  const wantedUids = selectedPrimary.map(row => String(row?.seriesUid || '').trim());
  if (wantedUids.some(uid => !uid)) return [];
  const wanted = new Set(wantedUids);
  return candidateSeries
    .filter(row => wanted.has(String(row?.seriesUid || '').trim()))
    .map(row => String(row?.id || ''))
    .filter(Boolean);
}

export function tasksBelongToStudy(tasks, expectedStudyUid) {
  const expected = String(expectedStudyUid || '').trim();
  if (!expected) return true;
  return (tasks || []).every(task => String(task?.studyUid || '').trim() === expected);
}

export function dicomTaskIdentityError(task, meta) {
  const actualStudy = String(meta?.studyUid || '').trim();
  const actualSeries = String(meta?.seriesUid || '').trim();
  const actualSop = String(meta?.sopInstanceUid || '').trim();
  const expectedStudy = String(task?.studyUid || '').trim();
  const expectedSeries = String(task?.seriesUid || '').trim();
  const expectedSop = String(task?.sopInstanceUid || '').trim();

  if (!actualStudy) return 'DICOM thiếu StudyInstanceUID.';
  if (!actualSop) return 'DICOM thiếu SOPInstanceUID.';
  if (expectedStudy && actualStudy !== expectedStudy) return 'StudyInstanceUID thực nhận không khớp task.';
  if (expectedSeries && (!actualSeries || actualSeries !== expectedSeries)) return 'SeriesInstanceUID thực nhận không khớp task.';
  if (expectedSop && actualSop !== expectedSop) return 'SOPInstanceUID thực nhận không khớp task.';
  return '';
}

export function cumulativeAttemptCounters(stored, progress) {
  return {
    original: (Number(stored?.attemptBaseOriginal) || 0) + (Number(progress?.original) || 0),
    reconstructed: (Number(stored?.attemptBaseReconstructed) || 0) + (Number(progress?.reconstructed) || 0),
    bytesWritten: (Number(stored?.attemptBaseBytes) || 0) + (Number(progress?.bytesWritten) || 0),
  };
}

export function inventoryIsCovered(job, completedSopUids) {
  const completed = new Set((completedSopUids || []).map(String));
  const expected = (job?.expectedSopUids || []).map(String).filter(Boolean);
  const logicalTotal = Number(job?.logicalTotal) || Number(job?.total) || 0;
  return expected.every(uid => completed.has(uid)) && completed.size >= logicalTotal;
}

/**
 * Xếp lại thứ tự các route lấy ảnh theo cái đã học được ở lần tải trước.
 *
 * Route nào không có trong danh sách đã học thì giữ nguyên vị trí tương đối phía
 * sau — chưa từng thắng không có nghĩa là hỏng, chỉ là chưa cần tới.
 */
export function orderRoutes(candidates, preferred) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!Array.isArray(preferred) || !preferred.length) return list;
  const rank = new Map(preferred.map((route, i) => [String(route), i]));
  const at = c => rank.has(c?.route) ? rank.get(c.route) : Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => at(a) - at(b));
}

export function dedupeTasksBySop(tasks) {
  const seen = new Set();
  const out = [];
  for (const task of tasks || []) {
    const sop = String(task?.sopInstanceUid || '').trim();
    if (sop && seen.has(sop)) continue;
    if (sop) seen.add(sop);
    out.push(task);
  }
  return out;
}
