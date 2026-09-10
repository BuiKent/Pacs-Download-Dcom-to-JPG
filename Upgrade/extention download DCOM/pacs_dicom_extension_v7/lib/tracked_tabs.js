'use strict';

/**
 * Which tabs the webRequest listeners are allowed to skip.
 *
 * The listeners are registered on `<all_urls>`, so they see every request the
 * browser makes. Skipping the ones that cannot concern us is what keeps
 * unrelated browsing fast — but the set of tracked tabs lives only in the
 * service worker's memory, and MV3 tears that worker down after about thirty
 * seconds of idle. It is revived by the very events these listeners handle,
 * with the set empty.
 *
 * So the gate has to fail OPEN until the set has been read back from session
 * storage. Failing closed loses exactly the traffic the generic discovery
 * engine exists for: a PACS whose URLs `classifyPacsUrl` does not recognise,
 * on a tab that was being tracked before the worker died. That loss is silent
 * — the reader sees a study that never becomes ready, with nothing to explain
 * why.
 */
export const TRACKED_TABS_KEY = 'pacs6_tracked_tabs';

/** Tracking states whose tab still needs its requests inspected. */
const LIVE_TRACKING = new Set(['watching', 'candidate']);

export function stateIsTracked(state) {
  if (!state || typeof state !== 'object') return false;
  return LIVE_TRACKING.has(state.tracking) || Boolean(state.learning?.active);
}

/**
 * `true` when a request must be inspected.
 *
 * `recognised` is for a URL that already looks like PACS traffic or a learned
 * endpoint: those are always inspected, whatever tab they came from, which is
 * what keeps downloads working even in the window before `restored` flips.
 */
export function shouldInspectRequest({restored, tracked, tabId, recognised}) {
  if (recognised) return true;
  if (!restored) return true;
  return Boolean(tracked && tracked.has(tabId));
}

/** Session-storage payload, normalised: ids only, no duplicates, no junk. */
export function serializeTrackedTabs(tracked) {
  return [...(tracked || [])]
    .map(Number)
    .filter(id => Number.isInteger(id) && id >= 0);
}

/**
 * Fold ids read back from storage into the live set.
 *
 * `decided` holds every tab this worker has already ruled on since it started.
 * Restoring is a storage read, so an event can land first — the user pressing
 * "Stop tracking" the moment the worker wakes — and a plain union would put
 * that tab straight back, from a value written before they pressed it. What
 * this worker has been told beats what storage remembers.
 */
export function mergeRestoredTabs(tracked, restored, decided) {
  for (const id of restored || []) {
    if (decided && decided.has(id)) continue;
    tracked.add(id);
  }
  return tracked;
}

export function deserializeTrackedTabs(raw) {
  const out = new Set();
  for (const id of Array.isArray(raw) ? raw : []) {
    const n = Number(id);
    if (Number.isInteger(n) && n >= 0) out.add(n);
  }
  return out;
}
