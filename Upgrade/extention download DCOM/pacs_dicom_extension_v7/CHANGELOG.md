# 7.1.1

- Clinical safety fix (Zero slice loss): `pruneStateForStorage` now preserves all 6,000 direct DICOM URLs and up to 500 manifest entries. Fixed `key.startsWith(TAB_PREFIX)` session storage prefix bug that previously bypassed in-memory session caching.
- Whole-browser webRequest tax eliminated: synchronous fast-return on non-tracked tabs and removal of heavy `'extraHeaders'` flag. Chrome no longer lags on unrelated tabs.
- IPC storm & spinner freeze fixed: normal slice downloads respect 120ms throttle (`emit(job, false)`), `setBadge` UI thread calls cached, and sidepanel button `innerHTML` avoided if unchanged to preserve smooth CSS spinner animations.
- O(N^2) data structures eliminated: `genericDirectUrls` deduplication optimized to O(1) via in-memory Set; `mergeGenericEntry` uses in-place array updating.
- Memory leak plugged: `tabMemory`, `invMemory`, `perfScanCache`, `trackedTabIds`, `badgeCache`, and `activeAnalysis` are completely pruned on tab close (`onRemoved`).
- Fast resume: `existingValid` now checks DICOM Part-10 headers using only the first 8 KB (`f.slice(0, 8192)`), reducing disk read I/O by >95% during resume.
- Single-flight `analyzeTab`: concurrent analysis requests are collapsed into a single inflight promise to avoid redundant adapter manifest fetches.
- Worklist scan: `patient-index.json` is parsed once per patient instead of twice. A per-scan study cache was also added, but note it keys on the study folder's `mtime`, which does not change when slices are written into `<study>/DICOM/`; it is only safe because `get_worklist` builds a fresh scanner per call.
- Fixed DICOM slice counting: a file counts as a slice when any folder between the study and the file is a DICOM folder. The old substring rule turned every JPG of a study named "… - DICOM CT" into a slice; matching only the immediate parent reported `DICOM/<SeriesUID>/IM00001` disc exports as empty. Covered by `tests/test_worklist_dicom_counting.py`.
- Fixed viewer series parsing: the bounded quantifier introduced to stop regex backtracking was greedy, so one series swallowed the next one's image count and that series vanished from the list. Now lazy (`{0,5}?`), restoring the original match.
- Fixed patient banner extraction: the shared body-text window silently collapsed to 18k characters, putting the patient banner of a long viewer page out of reach. Restored to the original 100k — the cost is in `textContent` walking the tree, which a shorter slice does not avoid. Both are covered by `tests/test_content_extraction.mjs`.
- Side panel log and folder buttons are wired to handlers; `static_checks.py` now fails on any side panel button without one.
- The save-folder button names the chosen folder instead of revealing Chrome's default downloads folder, which bulk DICOM has deliberately avoided since 7.0.3.
- Windows process priority: lowered pipeline background processing priority to `BELOW_NORMAL_PRIORITY_CLASS` to prevent system freezes.

# 7.1.0

- Activity logging & export: added background activity logging (`lib/logger.js`) with persistent circular buffer. Added log export (`.log` file download) and a dedicated Activity Log Viewer tab (`log_viewer.html`) with level/category filtering, real-time search, and full copy support.
- History folder quick access: added a "📁 Thư mục" button to the History card header that names the configured save folder. The File System Access API exposes no path the extension may hand to the shell, so the folder is reported rather than opened.
- Documented single-time folder selection architecture: explained why initial folder authorization is required by browser security to prevent Save As loops, and verified device-local IndexedDB persistence across multiple machines.

# 7.0.4

- High-performance DOM text extraction: replaced synchronous layout-thrashing `innerText` with `textContent` across PACS overlays and viewports, eliminating browser freezes during slice scrubbing.
- Throttled MutationObserver: removed `class` attribute watching on the root document to avoid triggering observer loops on viewer CSS state changes.
- Performance and resource probing cache: cached `scanPerformance` results per tab (2.5s TTL) to prevent repeated script injections into all frames during rapid network bursts.
- Storage and IPC debouncing: debounced session storage writes and throttled `PACS_SIGNAL` notifications to alleviate CPU and message bus pressure during rapid DICOM downloads.
- Sidepanel refresh throttle: increased signal refresh debounce to avoid UI re-render storms while reading or streaming image series.

# 7.0.3

- Bulk DICOM downloads now require a writable folder even when an older profile still stores the legacy `downloads` preference.
- Removed the unsafe reset-to-Downloads path that could trigger one Chrome Save As prompt per image.
- The side panel now states clearly when a save folder must be selected.

# 7.0.0

- Upgraded directly from 6.2 → 6.3.x codebase; preserved `pacs6_*` storage keys to maintain history, recipes, and user preferences.
- Added `lib/generic_discovery.js`: content-based generic manifest discovery.
- Removed keyword requirements (`dicom`, `image`, `wado`, `instance`, `.dcm`) from generic manifest URL detection.
- Recursive JSON candidate extraction preserves ancestor metadata (Study/Series/SOP/Patient).
- Clusters URLs by shape; probes sample bytes and materializes full winning collections.
- Manifest recipe schema v3: stores manifest shape, DICOM shape, JSON path/key, and HTTP method.
- Generic capability profiling: direct DICOM / manifest / HTTP method / MAIN-world JSON.
- Generic direct DICOM supports GET, POST, PUT, and body replay.
- Tracks `requestId` + body fingerprints so repeated POST endpoints are not collapsed into a single instance.
- `fetchStreamWithTimeout()` transmits request body for non-GET/HEAD methods.
- `offscreen.js` adds inspect prefix metadata and `INSPECT_DICOM_URLS`.
- Generic inventory groups by Series UID / Series metadata when available.
- Added `generic-hook.js`: MAIN-world observer cloning compact JSON only (no binary DICOM/pixels).
- Content bridge forwards JSON candidates to background during active tracking.
- Vendor adapters (VietMy, VRAD, VRPACS, ZFP) retained as compatibility fallbacks.
- DICOM implementation version updated to `PACSDLCM_700`.
- Added test suites for generic discovery, generic adapter, and POST/body network transport.

# 6.3.x Baseline

- GE Centricity Universal Viewer ZFP WebSocket hook and DICOM reconstruction.
- Adapter outcome learning, route preferences, and fallback across matching StudyUIDs.
- Request replay Content-Type fixes, VietMy ASMX manifest, VRPACS synthetic share requests.
- File System Access engine, DICOM validation, per-tab state/jobs, optional host permissions, history/status UI.
