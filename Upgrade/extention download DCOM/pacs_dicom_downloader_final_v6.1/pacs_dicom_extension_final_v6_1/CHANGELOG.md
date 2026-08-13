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
