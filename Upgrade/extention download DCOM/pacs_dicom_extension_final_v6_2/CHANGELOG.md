# 6.1

- Nhận diện ShareStudy có query key rỗng: `?=<token>`.
- Study hint không giữ toàn bộ token/share/session value.
- Thêm onboarding quyền: cấp HTTP/HTTPS một lần hoặc giữ chế độ từng site.
- Tách quyền site khỏi tracking: tab chỉ phân tích sâu khi người dùng bật theo dõi.
- Thêm **Học site** theo tab:
  - ghi request viewer;
  - đánh dấu endpoint DICOM;
  - đánh dấu JSON danh sách ảnh;
  - lưu recipe theo origin/path không chứa token value.
- `showDirectoryPicker()` dùng `startIn:'downloads'` và `id:'pacs-dicom'`.
- Nếu hủy picker, fallback sang `chrome.downloads` sau bước fetch + DICOM validation; Download Manager không tự gọi endpoint PACS.
- Chuyển thẻ thư mục lưu xuống dưới History.

# 6.0

- File System Access download engine.
- Validate bytes trước khi ghi `.dcm`.
- Adapter registry + Study/task model thống nhất.
- DICOM reconstruction sửa Transfer Syntax, SpecificCharacterSet và multipart parsing.
- Per-tab state/job.
- Generic binary probe.

## 6.2.1

- Sửa lỗi VietMy không tải được: khi phát lại POST manifest, Content-Type lấy từ ô dùng chung theo origin nên bị request khác (SignalR...) đè lên. ASMX gặp sai Content-Type thì trả HTTP 200 kèm trang HTML, `r.json()` vỡ thành `Unexpected token '<'`.
- Content-Type khi phát lại giờ theo thứ tự: kiểu ghi được của chính request đó → suy từ body (body JSON thì gửi `application/json`) → mới đến kiểu chung của origin.
- Ghi lại Content-Type theo từng request trong `pacsRequests`, không chỉ theo origin.
- `fetchJsonFor` phát hiện server trả HTML tuy HTTP 200 và báo lỗi rõ ràng thay vì lỗi parse JSON khó hiểu.
- Sửa parser DICOM bỏ cuộc khi gặp sequence độ dài không xác định (0xFFFFFFFF): máy Hitachi ghi (0008,1140) ngay trước nhóm 0010 nên mất sạch PatientName/PatientID/StudyInstanceUID, thư mục lưu tụt thành `Unknown - NoID - NoDate`. Giờ nhảy qua trọn sequence (kể cả lồng nhau và item không xác định độ dài) rồi đọc tiếp.
- `summarize()` không còn để bản ghi suy từ Performance API đè lên bản ghi webRequest cùng URL — bản webRequest là chỗ duy nhất giữ method/body để phát lại POST manifest (ảnh hưởng cả VRAD/VRPACS).
- `tests/static_checks.py` đọc file bằng UTF-8, không còn crash `UnicodeDecodeError` trên Windows.
- Không còn bắt buộc phải bật "Theo dõi tab" trước khi mở viewer: nếu chưa ghi được POST manifest, adapter VietMy tự dựng lại từ `caseStudyId` (đọc trong id thẻ series của DOM viewer) và `sToken` (trên URL chia sẻ). `scanPerformance` báo thêm `vietmyStudyId`.
- Khi không dựng lại được, báo lỗi ngay thay vì thử GET — endpoint ASMX gọi GET luôn trả trang HTML kèm HTTP 200.
- Thêm `tests/test_replay_content_type.mjs`, `tests/test_dicom_undefined_sq.mjs`, `tests/test_vietmy_rebuild.mjs`.

## 6.2.0

- Thêm adapter VietMy PMR dựa trên manifest `WS/ws.asmx/GetListImageFileInfo`.
- Chỉ dùng `filePath` để tải DICOM; không dùng `imagePath`/`GetImageFile` rendered image.
- Nhận diện trực tiếp `ws/getfile.ashx` là endpoint DICOM VietMy.
- Parser hỗ trợ ASP.NET ASMX payload bọc trong trường `d` và JSON string.
- Giữ lựa chọn series và số instance theo manifest.
- Replay POST manifest với request body và `Content-Type` gốc của viewer.
- Vẫn bắt buộc validate Part-10 trước khi ghi file.
