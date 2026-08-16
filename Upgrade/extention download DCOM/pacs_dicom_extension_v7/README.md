# PACS DICOM Downloader 7.0

Standalone Chrome Extension for discovering and downloading DICOM data from web PACS using **protocol / content detection**, without depending on hardcoded site lists.

V7 builds directly on branch 6.2 → 6.3.x. Storage keys `pacs6_*` are preserved so upgrading users retain history, recipes, and directory selections.

## V7 Goals & Priority

Discovery and download priority order:

1. **Standard DICOMweb / WADO** — QIDO, WADO-RS, WADO-URI, metadata + frames.
2. **Direct DICOM over HTTP(S)** — GET/POST/PUT; verified via Part-10 bytes, ignoring URL extensions and MIME hints.
3. **Generic Manifest Discovery** — inspects arbitrary JSON, extracts URLs recursively, clusters by URL shape, probes samples, and materializes full collections when Part-10 DICOM bytes are confirmed.
4. **MAIN-world JSON observer** — lightweight fallback for non-replayable manifests; clones compact JSON only, never binary DICOM/pixels.
5. **Vendor compatibility adapters** — VietMy, VRAD, VRPACS, and GE ZFP maintained for proprietary workflows.
6. **GE ZFP WebSocket** — captures pixel + metadata streams from `image-provider` to reconstruct valid DICOM Part-10 files.

## Generic Manifest Discovery

V7 does not require image URLs to contain keywords like `dicom`, `wado`, `image`, `instance`, or `.dcm`.

Example arbitrary manifest:

```json
{
  "series": [
    {
      "SeriesInstanceUID": "1.2.3.4",
      "objects": [
        {"SOPInstanceUID":"1.2.3.4.1", "v":"/x/9a1f02?a=1"},
        {"SOPInstanceUID":"1.2.3.4.2", "v":"/x/aa9c31?a=2"}
      ]
    }
  ]
}
```

Pipeline:

```text
JSON
 → recursive URL candidates
 → URL-shape clustering
 → probe 1–2 samples per shape
 → DICM magic bytes confirmed?
 → shape identified as DICOM collection
 → preserve ancestor metadata (Study/Series/SOP if present)
 → Unified Study / Series / tasks
```

Every file passes `validatePart10()` and identity verification before saving.

## POST/PUT DICOM Support

V7 preserves `method + request body + Content-Type` for each request. A PACS can reuse the same URL:

```http
POST /retrieve
{"imageId": 1001}

POST /retrieve
{"imageId": 1002}
```

These two requests are distinct instances; v7 no longer collapses them to a single URL. `requestId` and body fingerprints map responses to corresponding requests.

## Generic Manifest Recipe V3

Local recipes persist:

- Manifest URL shape;
- HTTP method;
- Winning DICOM URL shape;
- Typical JSON path / field URL;
- Adapter success/failure outcomes;
- Failure classification;
- Latency EWMA;
- Preferred DICOMweb retrieval route;
- Capability flags (direct DICOM, generic manifest, HTTP methods, MAIN-world JSON fallback).

Full tokens and sensitive query parameters are never stored in recipes.

## DICOMweb

The engine prioritizes original instances:

```text
WADO-URI
 → WADO-RS Retrieve Instance
 → metadata + frames reconstruction
```

Successful routes are cached for future downloads.

## File Storage

Direct storage path:

```text
fetch
 → validate DICOM
 → File System Access createWritable()
```

Downloads API fallback:

```text
fetch
 → validate DICOM
 → Blob
 → chrome.downloads
```

`chrome.downloads` **never directly fetches PACS URLs**.

## Installation

1. Extract the extension directory.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Remove/disable older versions if testing cleanly.
5. Click **Load unpacked** → select `pacs_dicom_extension_v7`.
6. Onboarding:
   - Grant HTTP/HTTPS permissions for multi-PACS environments; or
   - Grant permissions per site as needed.

Site permissions do not enable automatic deep tracking. Tracking remains strictly per-tab.

## Usage

1. Open PACS/portal and viewer normally.
2. Open the Side Panel.
3. Click **Track tab**.
4. Await Study/Series inventory detection.
5. Select series → click **Download DICOM**.
6. If an unfamiliar site is not auto-detected: **Learn site** remains available as manual fallback.

## Data Safety & Security

- No `chrome.debugger`.
- No cloud/telemetry dependencies.
- No hardcoded credentials.
- Login/password/OTP requests excluded from learning.
- No cookies stored in recipes.
- Validates magic bytes rather than MIME headers or `.dcm` extensions.
- Identity guard verifies Study/Series/SOP against expected task.
- Rendered JPEG/PNG images are never labeled as original DICOM.

## Architecture

```text
Browser tab
  ├─ webRequest: URL/method/body/header/status
  ├─ content/page hints
  ├─ MAIN JSON observer (tracking only)
  └─ ZFP WebSocket hook (GE only)
          ↓
Protocol + Content Discovery
          ↓
Data Sources
  ├─ DICOMweb
  ├─ Generic HTTP DICOM
  ├─ Generic Manifest
  └─ Vendor compatibility adapters
          ↓
Unified Study / Series / Instance tasks
          ↓
Retrieval planner + learned routes
          ↓
Offscreen download engine
          ↓
validate Part-10 + identity check
          ↓
File System Access / validated Blob fallback
```

## Research Basis

V7 references architectural patterns from:

- OHIF Data Source module: https://docs.ohif.org/platform/extensions/modules/data-source/
- OHIF DICOMweb data source: https://docs.ohif.org/configuration/datasources/dicom-web/
- Cornerstone Image Loader: https://www.cornerstonejs.org/docs/concepts/cornerstone-core/imageloader/
- Cornerstone Custom Image Loader: https://www.cornerstonejs.org/docs/how-to-guides/custom-image-loader/
- Weasis: https://github.com/nroduit/weasis
- dcmjs: https://github.com/dcmjs-org/dcmjs
- dicomweb-proxy: https://github.com/knopkem/dicomweb-proxy

See `DESIGN_V7.md` for architectural details.

