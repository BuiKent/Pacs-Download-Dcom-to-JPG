# VietMy PMR Adapter

VietMy is detected via the manifest request:

`/WS/ws.asmx/GetListImageFileInfo`

The adapter reads records with `filePath`, groups them by series, and generates download tasks from `filePath`/`ws/getfile.ashx`. The `imagePath` field is ignored as it represents rendered images for viewer display.

Download pipeline:

ShareStudy → GetListImageFileInfo → filePath → fetch bytes → validate DICOM Part-10 → save.

The manifest only returns JSON for POST requests with `Content-Type: application/json`; sending a GET returns an HTML page with HTTP 200 (not a 4xx error), so replaying the exact POST is required.

If the extension is opened after the manifest request has already executed, `webRequest` will not have recorded the method/body. In this scenario, the adapter reconstructs the request from two remaining cues on the page:

- `sToken` — the `stoken` parameter from the share URL;
- `caseStudyId` — parsed from the series element ID in the viewer DOM (`<a id="series560541_0">`), retrieved by `scanPerformance` via `vietmyStudyId`.

If neither cue can be extracted, the adapter reports a clear error advising the user to click `Track tab` and reload the viewer, preventing confusing GET fallbacks.

