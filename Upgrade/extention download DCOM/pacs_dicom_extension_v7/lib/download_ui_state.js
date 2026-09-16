// The engine announces its own outcome before the study sidecar is written and
// before the background may retry the study with another adapter, so a job is
// "finishing" between those two points: no longer fetching images, not yet
// allowed to report a result.
export const FINISHING_STATUS = 'finishing';
const ACTIVE_DOWNLOAD_STATUSES = new Set(['preparing', 'downloading', 'cancelling', FINISHING_STATUS]);
const TERMINAL_DOWNLOAD_STATUSES = new Set(['done', 'partial', 'done_with_errors', 'error', 'cancelled']);

export function isActiveDownload(job) {
  return ACTIVE_DOWNLOAD_STATUSES.has(String(job?.status || ''));
}

export function isTerminalDownload(job) {
  return TERMINAL_DOWNLOAD_STATUSES.has(String(job?.status || ''));
}

/**
 * Status a progress message may write onto a stored job. Only the finalizer,
 * which runs once the engine has handed back its result, may end a job: letting
 * progress do it drops the panel out of download mode and an adapter fallback
 * attempt immediately drags it back in.
 */
export function progressStatus(storedStatus, reportedStatus) {
  const reported = String(reportedStatus || '');
  if (!reported) return String(storedStatus || '');
  if (!TERMINAL_DOWNLOAD_STATUSES.has(reported)) return reported;
  if (String(storedStatus || '') === 'cancelling') return 'cancelling';
  return FINISHING_STATUS;
}

export function panelPhase({job = null, hasInventory = false, tracking = '', confidence = 0} = {}) {
  if (isActiveDownload(job)) return 'downloading';
  if (hasInventory) return 'ready';
  if (tracking === 'watching') return 'tracking';
  if (tracking === 'candidate' || Number(confidence) >= 55) return 'candidate';
  if (tracking === 'stopped') return 'stopped';
  return 'idle';
}

export function reconcileInventory(currentInventory, incomingInventory, currentJob) {
  if (isActiveDownload(currentJob) && !incomingInventory) return currentInventory;
  return incomingInventory ?? null;
}

export function shouldShowInventoryEditor(job) {
  return !isActiveDownload(job);
}
