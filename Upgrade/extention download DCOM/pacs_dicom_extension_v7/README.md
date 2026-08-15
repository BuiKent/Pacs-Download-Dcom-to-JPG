# PACS DICOM Downloader 7.0

Chrome Extension độc lập để nhận diện và tải DICOM từ PACS web theo **giao thức / nội dung**, không chỉ theo danh sách bệnh viện đã biết.

V7 được phát triển trực tiếp từ nhánh 6.2 → 6.3.x hiện tại. Các storage key `pacs6_*` được giữ nguyên để không làm mất History, recipe và lựa chọn thư mục của người đang nâng cấp.

## Mục tiêu v7

Thứ tự nhận diện và tải:

1. **DICOMweb / WADO chuẩn** — QIDO, WADO-RS, WADO-URI, metadata + frames.
2. **DICOM trực tiếp qua HTTP(S)** — GET/POST/PUT; xác nhận bằng bytes Part-10, không tin tên URL/MIME.
3. **Generic Manifest Discovery** — đọc JSON bất kỳ, tìm URL theo cấu trúc, gom theo URL shape, probe mẫu và materialize cả collection khi bytes là DICOM.
4. **MAIN-world JSON observer** — fallback nhẹ cho manifest không replay được; chỉ clone JSON nhỏ, không copy DICOM/pixel binary.
5. **Vendor compatibility adapters** — VietMy, VRAD, VRPACS và GE ZFP giữ lại để cứu các workflow proprietary mà generic layer chưa suy ra đủ.
6. **GE ZFP WebSocket** — hứng pixel + metadata từ `image-provider`, dựng DICOM có `provenance: reconstructed`.

## Generic discovery mới

V7 không còn yêu cầu URL ảnh phải chứa `dicom`, `wado`, `image`, `instance`, `.dcm`.

Ví dụ manifest hoàn toàn lạ:

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

Luồng:

```text
JSON
 → recursive URL candidates
 → URL-shape clustering
 → probe 1–2 mẫu/shape
 → bytes có DICM?
 → shape đó là DICOM collection
 → giữ metadata cha (Study/Series/SOP nếu có)
 → Unified Study / Series / tasks
```

Từng file vẫn phải qua `validatePart10()` và identity guard trước khi ghi.

## POST/PUT DICOM

V7 giữ `method + request body + Content-Type` cho từng request. Một PACS có thể dùng cùng một URL:

```http
POST /retrieve
{"imageId": 1001}

POST /retrieve
{"imageId": 1002}
```

Hai request này là hai instance khác nhau; v7 không còn co chúng thành một URL duy nhất. `requestId` và body fingerprint được dùng để ghép response với request tương ứng trong phiên.

## Generic manifest recipe v3

Recipe local hiện học thêm:

- manifest URL shape;
- HTTP method;
- DICOM URL shape thắng;
- JSON path / field URL điển hình;
- adapter thắng/thua;
- failure class;
- latency EWMA;
- preferred DICOMweb retrieval route;
- capability flags (direct DICOM, generic manifest, HTTP methods, MAIN-world JSON fallback).

Không lưu full token/query secret vào recipe.

## DICOMweb

Engine ưu tiên original instance:

```text
WADO-URI
 → WADO-RS Retrieve Instance
 → metadata + frames reconstruction
```

Route thành công được nhớ cho lần tải sau.

## Lưu file

Đường mặc định nhanh:

```text
fetch
 → validate DICOM
 → File System Access createWritable()
```

Nếu dùng chế độ Downloads:

```text
fetch
 → validate DICOM
 → Blob
 → chrome.downloads
```

`chrome.downloads` **không bao giờ tự gọi URL PACS**.

## Cài đặt

1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa/disable bản cũ nếu muốn test sạch.
5. **Load unpacked** → chọn thư mục `pacs_dicom_extension_v7`.
6. Onboarding:
   - cấp HTTP/HTTPS một lần cho môi trường nhiều PACS; hoặc
   - cấp theo từng site.

Có quyền site không đồng nghĩa tự deep-track. Tracking vẫn theo từng tab.

## Cách dùng

1. Mở PACS/portal và viewer như bình thường.
2. Mở Side Panel.
3. Bấm **Theo dõi tab**.
4. Chờ inventory Study/Series.
5. Chọn series → **Tải DICOM**.
6. Nếu site lạ chưa tự nhận: **Học site** vẫn còn như fallback thủ công.

## An toàn dữ liệu

- Không `chrome.debugger`.
- Không cloud/telemetry.
- Không hard-code account/password.
- Request login/password/OTP bị loại khỏi learning.
- Không lưu Cookie trong recipe.
- Không tin MIME hay đuôi `.dcm`; kiểm bytes.
- DICOM task có Study/Series/SOP đã biết phải khớp bytes thực nhận.
- JPEG/PNG/rendered ảnh không được gắn nhãn original DICOM.

## Kiến trúc

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
validate Part-10 + identity
          ↓
File System Access / validated Blob fallback
```

## Research basis

V7 học **kiến trúc**, không copy source code của các project sau:

- OHIF Data Source module: https://docs.ohif.org/platform/extensions/modules/data-source/
- OHIF DICOMweb data source: https://docs.ohif.org/configuration/datasources/dicom-web/
- Cornerstone Image Loader: https://www.cornerstonejs.org/docs/concepts/cornerstone-core/imageloader/
- Cornerstone Custom Image Loader: https://www.cornerstonejs.org/docs/how-to-guides/custom-image-loader/
- Weasis: https://github.com/nroduit/weasis
- dcmjs: https://github.com/dcmjs-org/dcmjs
- dicomweb-proxy: https://github.com/knopkem/dicomweb-proxy

Xem thêm `DESIGN_V7.md`.
