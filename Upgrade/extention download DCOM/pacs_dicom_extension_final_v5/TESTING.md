# PACS DICOM Downloader 5.0 — kiểm tra build

## Đã kiểm tra tự động

- Manifest V3 hợp lệ và đủ local resources.
- `node --check` cho toàn bộ JavaScript.
- Detector nhận diện các mẫu URL: RIS vrViewer, VNrad Viewer hash, HFH token portal, VietMy ShareStudy, Thanh Nhàn portal, HFH login portal.
- DICOM Part-10 writer/parser: native Little Endian và encapsulated JPEG.
- Multipart DICOM parser.
- VRAD manifest parser và DICOMweb series parser.
- Generic captured DICOM có đường IndexedDB → Blob → Chrome Downloads.
- State/job/history tách theo `tabId`.

## Các lỗi đã xử lý trong nhánh 5.0

- `PAGE_HINTS` từ content script không được background xử lý.
- Study cũ còn trên UI khi đổi tab/document/study.
- URL rút gọn làm mất ngữ cảnh study.
- Portal load chậm phụ thuộc timeout của Side Panel.
- Popup/tab con không kế thừa tracking từ portal cha.
- Generic recorder bắt được DICOM nhưng không có đường tải file đã bắt.
- Download job dùng state toàn cục thay vì theo tab.
- VRAD dùng offscreen `fetch()` cho original DICOM gây `Failed to fetch`.
- Hai series trùng SeriesNumber/tên ghi chung thư mục.
- Generic captured subset bị đánh dấu nhầm là cả study đã tải đủ.
- Endpoint DICOM lạ dùng Authorization/X-* bị mất header vì URL không khớp classifier.
- DICOMweb trả thiếu instance so với số khai báo nhưng vẫn có thể bị coi là đủ.
- VRAD manifest khai báo nhiều ảnh hơn số URL tạo được nhưng không báo lỗi.

## Giới hạn kiểm thử

Môi trường build không đăng nhập được các PACS bệnh viện thật và Chromium đồ họa trong container không cho chạy end-to-end extension ổn định. Vì vậy các bài kiểm tra trên là build/unit/smoke test; kiểm thử cuối với từng PACS cần thực hiện trong Chrome của người dùng đang có quyền xem phim.
