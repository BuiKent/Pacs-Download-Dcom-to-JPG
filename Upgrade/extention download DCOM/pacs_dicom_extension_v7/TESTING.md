# PACS DICOM Downloader 7.0 — Test Matrix

## Automated Checks

```bash
node --check <all js/mjs>
node tests/test_pacs_urls.mjs
node tests/test_adapters.mjs
node tests/test_generic_discovery.mjs
node tests/test_generic_adapter.mjs
node tests/test_network_transport.mjs
node tests/test_dicom_writer.mjs
node tests/test_download_ui_state.mjs
node --test tests/test_sidepanel_runtime.mjs
node --test tests/test_background_download_lifecycle.mjs
node --test tests/test_offscreen_lifecycle.mjs
python tests/static_checks.py
python tests/smoke_sidepanel.py
python tests/smoke_extension_lifecycle.py
python tests/validate_dicom_minimal.py tests/writer_raw.dcm
python tests/validate_dicom_minimal.py tests/writer_jpeg.dcm
```

## Page Scan Cost

`test_content_extraction.mjs` also holds a budget. `document.body.textContent`
inserts no line breaks, so a viewer that builds its DOM in JavaScript hands the
scan one line of a million characters; an unbounded line skip inside the series
regex turned that into a quadratic rescan and froze the tab for tens of seconds
while the study was opening. The SPA fixture at the end of that file scans in
about 15 ms today and fails the budget long before a reader would feel it.

Anything added to `content.js` that reads the page runs on the reader's main
thread, in the busiest seconds of the load. Bound every quantifier that walks
body text, and never assume that text contains newlines.

## Side Panel Download State

`test_download_ui_state.mjs` covers the shared state module: which statuses count
as an active download, why a progress message may not end a job, and what a
delayed or empty overview may do to the visible study.

`test_sidepanel_runtime.mjs` runs the real `sidepanel.js` handlers against an
in-memory DOM: an active job owns the status header, progress never rebuilds the
series editor, a late overview cannot overwrite newer progress, and Resume
repeats the job's own selection.

`smoke_sidepanel.py` is the browser gate. It serves the extension over HTTP and
drives the shipped `sidepanel.html` in headless Chromium, stubbing only the
`chrome.*` APIs:

```bash
python tests/smoke_sidepanel.py          # add --headed to watch it
```

It fails on any console error, and on the two regressions a DOM stub cannot see:
the progress card moving when an inventory update lands mid-download, and the
previous patient staying on screen while another tab is being bound.

`test_background_download_lifecycle.mjs` exercises the shipped worker with
deferred adapter/history calls and deterministic clocks: active-job scan
suppression, stale analysis rejection, same-study ZFP reloads, navigation during
preparation/finalization, persisted engine checks and slow sidecar writes.
`test_offscreen_lifecycle.mjs` keeps cleanup pending and checks the real
`PING_ENGINE` handler reports the job running until that cleanup settles.

`smoke_extension_lifecycle.py` loads the unpacked extension into a temporary
Chromium profile with real `chrome.*` APIs. An active overview with no inventory
must perform zero script injections, and an idle offscreen engine must respond
to the existing job-status probe. It does not access a live PACS or start a real
download. Use Playwright's `chromium` channel: the default headless shell does
not load extensions ([Playwright extension guide](https://playwright.dev/python/docs/chrome-extensions)).

The worker must not use loss of its globals as proof that the downloader died:
[Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
and [offscreen lifetime](https://developer.chrome.com/docs/extensions/reference/api/offscreen#reasons)
are independent. Likewise, a finalization timeout is not evidence of a successful
disk write.

### Measured regression checks

- Earlier 7.2.7 browser reproduction: 7 terminal `GET_OVERVIEW` requests in 1.8 s;
  one-shot fix: 1 final synchronization in that interval. The current runtime
  test also changes terminal timestamps and requires no extra refresh.
- Current Chromium panel smoke: progress-card position unchanged after late
  inventory and progress messages; no console/page errors; newer progress
  survives a delayed overview.
- Current unpacked-extension smoke: 0 `executeScript` calls for an active-job
  overview without cached inventory.

These are synthetic correctness/work-count checks, not an estimate of CPU/RAM
savings or download speed on the user's live PACS.

## Generic Discovery Regression

`test_generic_discovery.mjs` validates:

- URL fields with arbitrary names (e.g. `v`) are correctly extracted;
- Study/Series/SOP ancestor metadata propagates from JSON hierarchy;
- Dynamic IDs are grouped into matching URL shapes;
- Probing a single shape can materialize an entire collection;
- DICOM JSON contains dedicated content fingerprints;
- Manifest recipe records HTTP method + winning DICOM shape.

## Generic POST Transport

`test_network_transport.mjs` starts a local HTTP server and verifies the engine transmits actual POST payloads:

```http
POST /retrieve
Content-Type: application/json
{"imageId":42}
```

## DICOM Safety & Invariant Tests

- Raw/native pixel reconstruction;
- Encapsulated JPEG;
- Multipart parser;
- Part-10 preamble and file meta information;
- Study/Series/SOP identity guard;
- Existing files skipped only when Part-10 validation succeeds.

## Regression Against Python Downloader

```bash
python tests/compare_dicom_dirs.py <PYTHON_DICOM_DIR> <EXTENSION_DICOM_DIR>
```

Compares SOPInstanceUID, PixelData SHA-256, and primary geometric tags.

## Live PACS Verification Checklist

- Unfamiliar generic JSON manifests;
- Signed/one-shot POST endpoints;
- Cross-origin image servers;
- Delayed manifest transmissions;
- Full ZFP `runZfpJob` execution in extension context;
- Multi-tier auth portals;
- File System Access permission persistence.
