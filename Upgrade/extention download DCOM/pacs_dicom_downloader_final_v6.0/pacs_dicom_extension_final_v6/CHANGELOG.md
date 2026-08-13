# 6.0

- Thay Chrome Download Manager bằng File System Access download engine.
- Validate bytes trước khi ghi `.dcm`; HTML/login response không được lưu thành DICOM.
- Tăng concurrency instance và frame có giới hạn; job state chỉ flush theo nhịp.
- Bỏ `debugger` mặc định và required host access toàn cục.
- Adapter registry + Study model + task model thống nhất.
- DICOM reconstruction sửa Transfer Syntax, SpecificCharacterSet và multipart binary parsing.
- Per-tab state/job hoàn chỉnh; đổi tab không dừng tracking/download.
- Generic binary probe + learned URL recipe không lưu token/query value.
- Tải một phần không đánh dấu cả study là hoàn tất.
- Resume validate toàn bộ DICOM trước khi skip.
- UI status-first, sticky download, history tách riêng và ẩn study đã tải đủ mặc định.
