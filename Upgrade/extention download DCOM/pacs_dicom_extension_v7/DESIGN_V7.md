# V7 Design Notes — Protocol and Content-Driven Architecture

## Architectural Influences

### OHIF — DataSource Boundary
OHIF decouples the backend from the viewer via DataSources: proprietary backends map to a common internal model. V7 applies this principle at the downloader level: adapters/discovery create Unified Study objects and tasks; the download engine remains agnostic of specific hospital vendors.

### Cornerstone — Scheme & Capability-Based Loaders
Cornerstone delegates pixel retrieval to specialized image loaders without coupling networking to rendering. V7 encapsulates retrieval strategies in tasks (`dicomweb-instance`, `fetch-dicom`, `zfp-image`), enabling the engine to select appropriate routes.

### Weasis — Multiple Transports, Single Workflow
Weasis connects DICOMweb, WADO-URI, DIMSE, and manifests. The V7 extension implements browser-capable transports while maintaining vendor adapters as compatibility plugins.

### dcmjs — DICOM Binary / JSON Boundary
dcmjs serves as an architectural oracle and reference for regression tests and future parser enhancements for rare VR/sequence edge cases.

### dicomweb-proxy — Normalizing Legacy PACS
Protocol normalization places legacy/proprietary backends on the outside while maintaining standard internal interfaces. V7 applies this pattern directly in the extension discovery layer.

## Key Changes: v6.3.x → v7

1. JSON manifest extraction does not filter by hardcoded endpoint keywords.
2. URL candidates preserve JSON ancestry metadata.
3. URLs are clustered by shape; sample bytes determine role.
4. Manifest recipe v3 learns DICOM shapes and JSON paths.
5. Direct binary retrieval supports custom HTTP methods and request bodies (not hardcoded to GET).
6. Same-URL POST requests are distinguished via requestId and body fingerprints.
7. Generic inventory groups by Series UID / metadata when present.
8. MAIN-world observer clones compact JSON only; ignores binary image streams.
9. Capability profiles are stored locally by site/fingerprint.
10. Vendor adapters serve as fallback plugins rather than exclusive targets.

## Invariant Constraints & Boundaries

- PACS using encrypted/proprietary binary protocols lacking metadata cannot be mapped.
- Proprietary WebSockets other than GE ZFP require protocol-specific framing unless formatted as identifiable JSON + raw pixels.
- Viewers displaying only lossy rendered JPEG/PNG/tiles without exposing original metadata cannot produce authentic original DICOM files.
- One-shot signed binary requests executed prior to tracking activation may require a page reload.
- Custom authentication/certificate policies may require site-specific compatibility handling.

Guiding principle: If correct DICOM bytes and metadata cannot be verified, report unsupported status rather than falsifying success.

