# VietMy PMR adapter

VietMy được nhận diện qua request manifest:

`/WS/ws.asmx/GetListImageFileInfo`

Adapter đọc các record có `filePath`, nhóm theo series và tạo task tải từ `filePath`/`ws/getfile.ashx`. Trường `imagePath` bị bỏ qua vì là ảnh render dành cho viewer.

Luồng tải:

ShareStudy → GetListImageFileInfo → filePath → fetch bytes → validate DICOM Part-10 → lưu.

Manifest chỉ trả JSON cho POST đúng `Content-Type: application/json`; gọi GET thì server trả trang HTML kèm HTTP 200 (không phải lỗi 4xx), nên phải phát lại đúng POST.

Extension bật sau khi manifest đã chạy thì `webRequest` không ghi được method/body. Khi đó adapter tự dựng lại request từ hai thứ vẫn còn trên trang:

- `sToken` — tham số `stoken` trên URL chia sẻ;
- `caseStudyId` — nằm trong id thẻ series của DOM viewer (`<a id="series560541_0">`), `scanPerformance` nhặt về qua trường `vietmyStudyId`.

Không lấy được hai thứ đó thì adapter báo lỗi ngay và hướng dẫn bật `Theo dõi tab` rồi tải lại viewer, thay vì thử GET rồi hỏng khó hiểu.
