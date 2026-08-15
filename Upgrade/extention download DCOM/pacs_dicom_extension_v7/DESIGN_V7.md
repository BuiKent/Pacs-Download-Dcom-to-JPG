# V7 design notes — từ PACS-specific sang protocol/content-driven

## Những gì học từ project khác

### OHIF — DataSource boundary
OHIF tách backend khỏi viewer bằng DataSource: proprietary backend có thể map về model nội bộ chung. V7 áp dụng cùng nguyên tắc ở mức downloader: adapter/discovery chỉ tạo Unified Study + task; engine tải không biết bệnh viện nào.

### Cornerstone — loader theo capability/scheme
Cornerstone giao việc lấy pixel cho image loader, không nhét networking vào renderer. V7 giữ retrieval strategy trong task (`dicomweb-instance`, `fetch-dicom`, `zfp-image`) và cho engine chọn route.

### Weasis — nhiều transport, một workflow
Weasis kết nối DICOMweb, WADO-URI, DIMSE và manifest/gateway. V7 extension chỉ làm transport browser có thể làm; vendor adapters là compatibility plugins. App desktop có thể bổ sung DIMSE sau này nhưng vẫn trả cùng Unified Study model.

### dcmjs — DICOM binary/JSON boundary
V7 chưa bundle dcmjs để tránh tăng kích thước và thay parser đã được harden quá sớm. dcmjs được coi là oracle/reference cho regression test và là ứng viên thay dần rare VR/sequence edge cases.

### dicomweb-proxy — normalize legacy PACS
Ý tưởng quan trọng là protocol normalization: backend legacy/proprietary ở ngoài, interface chuẩn ở trong. V7 làm điều tương tự ngay trong extension discovery layer.

## Khác biệt v6.3.x → v7

1. JSON manifest không lọc theo từ khóa endpoint.
2. URL candidate giữ JSON ancestry metadata.
3. URL được cluster theo shape; sample bytes quyết định role.
4. Manifest recipe v3 học DICOM shape / JSON path.
5. Direct binary retrieval hỗ trợ method/body, không hard-code GET.
6. Same-URL POST requests được phân biệt bằng requestId/body fingerprint.
7. Generic inventory group theo Series UID/metadata khi có.
8. MAIN-world observer clone JSON nhỏ; không chạm binary image response.
9. Capability profile được lưu local theo site/fingerprint.
10. Vendor adapters giữ làm fallback, không phải danh sách duy nhất được hỗ trợ.

## Điều v7 vẫn không thể tự giải quyết tuyệt đối

- PACS dùng encrypted/proprietary binary protocol không có đủ metadata để map.
- WebSocket proprietary khác GE ZFP cần protocol-specific framing nếu không phải JSON + raw pixel dễ nhận dạng.
- Viewer chỉ nhận rendered JPEG/PNG/tiles và server không expose original/metadata đủ: không thể tạo original DICOM.
- One-shot signed request có response binary mà extension bắt đầu tracking sau khi request đã qua: có thể phải reload/interact lại.
- Authentication/certificate/CORS policy đặc thù có thể cần compatibility logic.

Nguyên tắc: nếu không chứng minh được DICOM bytes/metadata đúng, báo thiếu/unsupported thay vì giả thành công.
