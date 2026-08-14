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

## 6.2.4

- Tải xong là panel đổi trạng thái **ngay**. Trước đây `finalizeJob` ghi lịch sử nhưng không gắn kết quả ngược vào inventory đang mở, mà `previousDownload` chỉ được đặt lúc `analyzeTab()` — nên phải tắt/mở lại trình duyệt (để analyze chạy lại) mới thấy "đã tải".
- Tải xong thì **ẩn danh sách series**, giữ card thông tin bệnh nhân (họ tên / ID / ngày chụp / số series) và hiện thẻ kết quả kèm số ảnh đã lưu.
- Phân biệt rõ kết quả thay vì chỉ có "xong/chưa": `Đã tải xong`, `Đã lưu (chưa đủ ảnh)`, `Đã tải, có lỗi`, `Tải lỗi`, `Đã dừng giữa chừng` — dùng chung cho thẻ kết quả và lịch sử.
- Lịch sử hiện thêm số ảnh đã lưu trên tổng số và số ảnh lỗi, có màu riêng cho trạng thái dở dang.
- Thêm lại card **Link viewer**: link thật trước khi rút gọn, gọn đúng một dòng, có nút Chép và bôi đen copy tay được; ghi rõ khi link này khác link trên thanh địa chỉ.
- `static_checks.py` đối chiếu mọi id `sidepanel.js` dùng với `sidepanel.html`, và kiểm tra `finalizeJob` có gắn kết quả vào inventory.

## 6.2.3

- Nút **Tải** không còn mở hộp thoại chọn thư mục. Luồng cũ: ô "Thư mục lưu" ghi sẵn `Downloads / PACS_DICOM` như thể đã cấu hình xong, nhưng bấm Tải vẫn bật Explorer; hủy hộp thoại thì vừa tải luôn vừa âm thầm ghi đè lựa chọn thành `downloads` nên lần sau lại không hỏi — nhìn một đằng chạy một nẻo. Giờ mặc định lưu vào Downloads như v2/v2.1, muốn thư mục riêng thì bấm "Đổi".
- Ô "Thư mục lưu" nói đúng đích thật, có ghi `(mặc định)` khi người dùng chưa chọn gì.
- Từ chối quyền ghi thư mục đã chọn thì chỉ lưu tạm vào Downloads cho lần đó, không ghi đè lựa chọn đã lưu.
- Thêm nút **Về Downloads** — trước đây chọn thư mục riêng rồi là không có đường quay lại.
- Tải "ngầm": tắt giao diện trình tải của Chrome trong lúc chạy job (`downloads.setUiOptions`, quyền `downloads.ui`) rồi bật lại khi xong, để 45 ảnh không làm bong bóng download nhấp nháy liên tục. Bật lại cả khi service worker khởi động lại giữa chừng.

## 6.2.2

- Sửa chế độ lưu qua trình tải của Chrome hỏng ở **mọi** file với `Cannot read properties of undefined (reading 'download')`. Offscreen document chỉ được dùng `chrome.runtime`; mọi `chrome.*` khác đều undefined ở đó, nên `chrome.downloads.download()` gọi từ `offscreen.js` không tồn tại.
- Chuyển toàn bộ `chrome.downloads` (download / onChanged / search / cancel) sang service worker. Offscreen vẫn dựng Blob vì service worker không có `URL.createObjectURL`, rồi gửi `DOWNLOAD_BLOB` nhờ service worker tải.
- Service worker chỉ nhận URL `blob:`; đưa URL khác vào là từ chối, giữ nguyên tính chất Download Manager không tự gọi endpoint PACS.
- `static_checks.py` quét phần code của `offscreen.js` và bắt buộc chỉ được dùng `chrome.runtime` — khoá lại đúng lớp lỗi này cho các bản sau.

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
