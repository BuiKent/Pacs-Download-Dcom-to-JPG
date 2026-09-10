# 7.2.2

The study claim becomes a real lock, and the state that survives a worker
restart carries everything a download needs to resume.

- One shared `.dcom-busy.json` could not implement a claim. Both writers read
  it empty, both wrote, and both believed they had won — the exclusion existed
  on paper only. Each job now writes its own contender file,
  `.dcom-busy.<claimId>.json`, and every reader elects the same winner from all
  of them: earliest `createdAt`, ties broken by claim id. A contender that
  loses removes its own file. Measured across repeated simultaneous starts:
  exactly one winner, one file left behind.
- The claim is taken before the first worker may write, not after the first
  image lands — one file too late is still two writers in one folder.
  `static_checks.py` fails if the acquire moves back below that line.
- A claim id can no longer become a path: `studyLockFilename('../escape')`
  returns nothing rather than a filename that escapes the study folder.
- A claim written by the previous version is still honoured, in both
  directions, so a reader who has not yet reloaded the extension is not left
  writing over a study the app is filling.
- Session storage keeps the request bodies it was dropping. `pacsRequests` kept
  only `form` bodies and discarded `raw` ones; `learnCandidates` kept none at
  all. A PACS that serves DICOM over POST could not be replayed after a worker
  restart, and manual learning of a POST manifest was lost.
- `genericDirectMeta` is trimmed with the urls it describes instead of growing
  without bound against the quota the cap ladder exists to respect.
- A state that shed anything is marked `truncated`, not just the minimal
  fallback. A discovery result quietly missing five thousand urls used to look
  complete.
- A corrupt file with a `.dcm` suffix is no longer counted as a slice; the
  suffix was trusted without reading the header.
- Slices arriving in `DICOM/<SeriesUID>/` move the worklist revision token, and
  bootstrap answers from the cached revision instead of walking the archive.
- The watcher no longer swallows a revision when a scan fails, and will not
  stack overlapping checks when one is slow.
- Thread priority is restored to the caller's exact previous value rather than
  assumed to have been normal.
- Export leaves every internal sidecar behind, including the coordination
  files, wherever in the study they sit.

# 7.2.1

Fixes found reviewing 7.2.0, in what it stores and what it promises.

- Restoring a tab after a service worker restart no longer shrinks the study.
  `genericEntries` was capped twelve times lower than `genericDirectUrls` and
  the adapters read entries alone, so a 6000 image study came back as 500 with
  nothing on screen to say so. Entries are now capped with the urls, parsed
  headers are thinned instead of whole records, `requestBody` survives (a PACS
  serving DICOM over POST cannot be replayed without it), and enumeration reads
  both lists so neither can silently shrink the download again.
- A download that failed, or that the reader cancelled, no longer records
  itself as complete. The sidecar carries `plannedTotal` beside `imageCount`
  and the job's real outcome; the app compared files on disk against how many
  had been saved, which cannot fail and reported every failed download as a
  finished study.
- The study claim is enforced rather than displayed. It carries a `claimId` so
  one job cannot release another's, is acquired before writing, and never
  creates the folder it claims — a direct download starts against a `LINK_*`
  placeholder and the real destination is decided from the first DICOM's tags,
  so writing the claim up front left an empty folder in the archive for the
  worklist to list as an empty study.
- Metadata writes are queued. The opening "downloading" write could land after
  the closing one and leave a finished study marked unfinished for good.
- The engine refuses a folder the desktop app is writing, as the app already
  refuses one this extension holds.
- Series detection reads the whole document again. Capping it at 100k
  characters lost series further down a long viewer page; the bounded lazy
  quantifier is what makes scanning it all safe.
- Activity logs are redacted. Patient folder names and share tokens were
  written verbatim and kept for 1500 entries, which is the record again with
  none of its protections. Study UIDs stay — they identify the scan, not the
  person.
- The boot log reads its version from the manifest, and `static_checks.py` now
  fails on a hard-coded version in any script rather than one file.

# 7.2.0

- The extension now claims a study folder while it fills it, as
  `.dcom-busy.json`. The desktop app can be pointed at the same study and
  cannot see this process, so without the claim it read a study still arriving
  as one that had failed halfway — "Thiếu 40/120 ảnh" — which reads as a
  failure and invites a second download over the top of the first. The app
  shows "Extension đang tải" instead and leaves it alone.
- The claim carries `renewedAt` in unix SECONDS to match
  `dcom_pipeline.read_study_lock`, is renewed as the job runs so a long study
  does not lapse, and is removed when the job ends. A browser killed mid
  download simply stops renewing and the claim expires on its own after five
  minutes, so a study is never locked out of the app for good.
- Filesystem save mode only: the Downloads mode cannot overwrite a file in
  place without a Save As prompt per renewal.
- Covered by `tests/test_study_lock.mjs` on this side and
  `tests/test_study_lock.py` on the app's, including that both agree the
  timestamp is seconds.

# 7.1.3

- `dcom-source.json` is written from the first image saved, marked
  `"status": "downloading"`, and rewritten with the final count when the job
  ends. A browser closed mid-download used to leave images with no link beside
  them, so the app could not offer "Tải tiếp" on exactly the studies that
  needed it. The app reads a study still carrying the mark as unfinished.
- The sidecar refuses a `sourceUrl` that is not an http(s) link. `sanitizeViewerUrl`
  hands back whatever it cannot parse, and a sidecar carrying that would have
  the app offer to resume a study it cannot reopen.
- Sidecar construction moved into `lib/pacs.js` (`buildStudySidecar`,
  `sidecarStudyPath`) so it can be tested without a browser; covered by
  `tests/test_study_sidecar.mjs`, including that a share token survives when it
  is the only thing identifying the study and is stripped when it is not.

# 7.1.2

Follow-up to the 7.1.1 performance pass: the four risks that review left open.

- Tracked-tab set survives a service worker restart. MV3 tears the worker down
  after ~30s idle and revives it with the set empty, so the webRequest gate
  dropped generic-discovery traffic on a tab that was still being tracked —
  silently, with no sign on screen. The ids are now mirrored into session
  storage under their own small key, and the gate fails OPEN until they are
  read back. A decision made while that read is in flight — the reader
  pressing "Stop tracking" as the worker wakes — wins over the value
  storage returns. Covered by `tests/test_tracked_tabs.mjs`.
- A session-storage write that does not fit now sheds discovered URLs down a
  cap ladder and, failing that, keeps a minimal state carrying the tab's
  identity and tracking flag. It used to delete the key on any error, turning
  "this tab is slightly over quota" into "this tab is not tracked any more".
  Covered by `tests/test_tab_state_store.mjs`.
- Removed the study scan cache keyed on the study folder's `mtime`. A folder's
  mtime tracks its immediate children, and slices land in `<study>/DICOM/`, so
  a study that just gained 500 images would keep serving the old count. It was
  harmless only because `get_worklist` builds a fresh scanner per call.
  Covered by `tests/test_worklist_dicom_counting.py`.
- CPU yielding is now per-thread, not per-process. Lowering the whole process
  demoted the reader's own window, which shares it, and was never restored.
  Jobs run on their own short-lived thread, so the calling thread is the right
  scope and needs no restore. The previous process-level call also never took
  effect: ctypes truncated the pseudo-handle, `SetPriorityClass` returned 0 and
  the failure was swallowed. Covered by `tests/test_background_priority.py`.

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
