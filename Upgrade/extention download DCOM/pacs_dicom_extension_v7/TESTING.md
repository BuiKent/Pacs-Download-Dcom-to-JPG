# PACS DICOM Downloader 7.0 — test matrix

## Automated checks trong gói

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

## Generic discovery regression

`test_generic_discovery.mjs` khóa:

- URL field có tên vô nghĩa (`v`) vẫn được tìm;
- metadata Study/Series/SOP được kế thừa từ JSON ancestry;
- dynamic IDs được gom về cùng URL shape;
- probe một shape có thể materialize cả collection;
- DICOM JSON có fingerprint nội dung riêng;
- manifest recipe nhớ POST + winning DICOM shape.

## Generic POST transport

`test_network_transport.mjs` mở HTTP server local và xác nhận engine gửi thật:

```http
POST /retrieve
Content-Type: application/json
{"imageId":42}
```

không chỉ lưu method trong task.

## DICOM safety regression

- raw/native reconstruction;
- encapsulated JPEG;
- multipart parsing;
- Part-10 preamble/meta;
- identity guard Study/Series/SOP;
- existing file chỉ skip khi validate được.

## Regression với app Python

```bash
python tests/compare_dicom_dirs.py <PYTHON_DICOM_DIR> <EXTENSION_DICOM_DIR>
```

So theo SOPInstanceUID, PixelData SHA-256 và các tag pixel/hình học chính.

## Những thứ phải live-test trên Chrome/PACS thật

- generic manifest mới chưa từng thấy;
- signed/one-shot POST endpoint;
- cross-origin image server;
- PACS chậm / manifest phát muộn;
- ZFP `runZfpJob` đầy đủ trong extension;
- auth portal nhiều tầng;
- File System Access permission persistence.

Không coi static/unit test là bằng chứng đã live-test bệnh viện thật.
