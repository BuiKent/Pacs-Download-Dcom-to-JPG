'use strict';

/**
 * Trimming a tab's tracking state down to what session storage will hold.
 *
 * The discovery arrays are the point of the whole state: `genericDirectUrls`
 * is the list of DICOM images found on a PACS the URL patterns do not
 * recognise, so a slice dropped here is a slice the download never asks for.
 * That is why the caps are high.
 *
 * High caps make the storage quota reachable, though, and the quota is shared
 * across every tracked tab. The old failure path deleted the key on any write
 * error, turning "this tab's state is 200 KB too big" into "this tab has no
 * state at all" — the worst possible response to running out of room. The
 * ladder below gives back the least valuable data first and keeps the rest.
 */

/** Progressively smaller caps for `genericDirectUrls`, largest first. */
export const URL_CAP_LADDER = [6000, 3000, 1000, 300];

/** Entries carry parsed DICOM metadata, so they cost far more per row. */
const ENTRY_CAP_RATIO = 12;

export function pruneStateForStorage(state, urlCap = URL_CAP_LADDER[0]) {
  if (!state || typeof state !== 'object') return state;
  const entryCap = Math.max(20, Math.round(urlCap / ENTRY_CAP_RATIO));
  return {
    ...state,
    // Rebuilt from `genericDirectUrls` on the far side; a Set does not survive
    // the trip anyway.
    _directUrlSet: undefined,
    pacsRequests: (state.pacsRequests || []).slice(-50).map(r => ({
      type: r.type, url: r.url, method: r.method, requestId: r.requestId,
      score: r.score, contentType: r.contentType, time: r.time, _id: r._id,
      requestBody: r.requestBody?.kind === 'form' ? r.requestBody : null,
    })),
    learnCandidates: (state.learnCandidates || []).slice(-20).map(r => ({
      url: r.url, display: r.display, method: r.method, requestId: r.requestId,
      type: r.type, contentType: r.contentType, status: r.status,
      contentLength: r.contentLength, time: r.time,
    })),
    binaryCandidates: (state.binaryCandidates || []).slice(-20),
    genericDirectUrls: (state.genericDirectUrls || []).slice(-urlCap),
    genericEntries: (state.genericEntries || []).slice(-entryCap).map(e => ({
      url: e.url, method: e.method, contentType: e.contentType, shape: e.shape,
      source: e.source, declared: e.declared, meta: e.meta, requestKey: e.requestKey,
    })),
  };
}

/**
 * The last thing worth keeping when even the smallest cap will not fit: what
 * the tab IS, so tracking survives and discovery can refill. Losing this is
 * what makes a tracked tab go quiet after a worker restart.
 */
export function minimalTabState(state) {
  if (!state || typeof state !== 'object') return state;
  const {
    tabId, currentUrl, mainDocumentId, studyHint, tracking, confidence,
    manual, learning, zfpViewer, zfpReloadDone, genericHookActive, updatedAt,
  } = state;
  return {
    tabId, currentUrl, mainDocumentId, studyHint, tracking, confidence,
    manual, learning, zfpViewer, zfpReloadDone, genericHookActive, updatedAt,
    navUrls: (state.navUrls || []).slice(-10),
    headersByOrigin: state.headersByOrigin || {},
    genericDirectMeta: {},
    genericDirectUrls: [],
    genericEntries: [],
    pacsRequests: [],
    learnCandidates: [],
    binaryCandidates: [],
    binaryProbed: [],
    truncated: true,
  };
}

/**
 * Write `state` under `key`, shedding discovery data until it fits.
 *
 * `write` is `chrome.storage.session.set`; it is injected so this is testable
 * without a browser. Returns the cap that succeeded, `0` for the minimal
 * fallback, or `-1` when even that failed.
 */
export async function persistTabState(write, key, state, ladder = URL_CAP_LADDER) {
  for (const cap of ladder) {
    try {
      await write({[key]: pruneStateForStorage(state, cap)});
      return cap;
    } catch {
      // Out of room, or the value is otherwise unwritable: try a smaller one.
    }
  }
  try {
    await write({[key]: minimalTabState(state)});
    return 0;
  } catch {
    return -1;
  }
}
