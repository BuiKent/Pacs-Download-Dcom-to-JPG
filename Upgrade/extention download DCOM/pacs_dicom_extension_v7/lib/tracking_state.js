export function isTerminalTracking(state) {
  return state === 'stopped' || state === 'completed';
}

export function shouldPreserveTerminalContext(current, {
  oldStudy = '',
  nextStudy = '',
  transitionType = '',
} = {}) {
  if (!isTerminalTracking(current)) return false;
  if (current === 'stopped') return true;
  if (transitionType === 'reload') return true;
  if (oldStudy && nextStudy && oldStudy !== nextStudy) return false;
  return true;
}

export function trackingAfterDocumentChange(current, {
  oldStudy = '',
  nextStudy = '',
  transitionType = '',
} = {}) {
  // A manual stop is an explicit per-tab choice and must never auto-rearm.
  if (current === 'stopped') return 'stopped';
  if (current !== 'completed') return current;

  return shouldPreserveTerminalContext(current, {
    oldStudy,
    nextStudy,
    transitionType,
  }) ? 'completed' : 'idle';
}

export function trackingAfterSameDocumentStudyChange(current) {
  if (current === 'completed') return 'idle';
  return current;
}
