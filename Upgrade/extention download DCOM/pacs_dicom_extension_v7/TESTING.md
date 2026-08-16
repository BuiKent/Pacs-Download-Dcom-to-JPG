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
python tests/static_checks.py
python tests/validate_dicom_minimal.py tests/writer_raw.dcm
python tests/validate_dicom_minimal.py tests/writer_jpeg.dcm
```

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

