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
