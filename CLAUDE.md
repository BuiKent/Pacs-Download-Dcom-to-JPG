# Quy định cho agent làm việc trên repo này

## 1. Ngôn ngữ — quy định cứng

**Mọi thứ agent VIẾT RA trong mã nguồn phải bằng tiếng Anh:**

- Comment và docstring
- Tên biến, hàm, class, hằng số
- Tên test và thông điệp assert
- Commit message

**Tiếng Việt được giữ nguyên ở những chỗ nó là NỘI DUNG chạy thật, không phải mã:**

- **Khoá i18n.** `webui/src/i18n.js` lấy tiếng Việt làm khoá tra cứu, tiếng Anh là
  bản dịch: `t("Lát cắt hiện tại")` → `EN["Lát cắt hiện tại"] = "Current slice"`.
  Đổi khoá sang tiếng Anh là phá cả hệ thống đa ngôn ngữ. Giữ nguyên.
- **Chuỗi hiển thị cho người dùng** ở tầng Python: thông điệp lỗi, dòng log của
  pipeline, nhãn trên giao diện Tk. Đây là thứ bác sĩ đọc trên màn hình.
- **Dữ liệu và OCR tiếng Việt.** Tên bệnh nhân, mô tả ca chụp, tên thư mục —
  không đụng tới.

**Trả lời cho người dùng trong chat bằng tiếng Việt**: phần tổng kết, giải thích,
báo cáo kết quả. Người dùng đọc tiếng Việt; mã nguồn đọc tiếng Anh.

### Cách phân biệt nhanh

| Câu hỏi | Trả lời |
| :--- | :--- |
| Dòng này chỉ lập trình viên đọc? | Tiếng Anh |
| Dòng này hiện lên màn hình cho bác sĩ? | Tiếng Việt |
| Dòng này là khoá `t("...")`? | Tiếng Việt, không được đổi |

## 2. Chạy test

Dự án dùng **unittest**, không phải pytest, và cần `-t tests`:

```bash
C:/Python314/python.exe -m unittest discover -s tests -t tests
```

Riêng bộ media engine dùng pytest và cần ffmpeg trong PATH:

```bash
PATH="$PWD/tools/bin:$PATH" python -m pytest tests/test_media_*.py
```

Không có ffmpeg trong PATH thì 4 test binary-config tự skip — `100 passed,
7 skipped` và `104 passed, 3 skipped` đều là kết quả đúng, chỉ khác môi trường.

Sửa bất cứ thứ gì trong `webui/src/` thì **bắt buộc** chạy lại:

```bash
npm run build --prefix webui
```

Không build thì `web_dist/` vẫn là bundle cũ và app chạy code cũ.

## 3. Không bịa dữ liệu lâm sàng

Đây là app đọc phim. Giới tính, năm sinh, mã bệnh nhân, bệnh viện là những
trường bác sĩ dùng để xác nhận mở đúng hồ sơ.

**Không biết thì để trống và hiển thị `—`. Tuyệt đối không đặt giá trị mặc định
nghe có vẻ hợp lý.** Đã từng có lỗi đặt mặc định `gender="Nam"`, `birthYear="1974"`,
`hospital="BV A"` (chép từ bệnh nhân mẫu trong mockup), khiến một hồ sơ tên nữ
hiển thị thành nam sinh năm 1974.

Nguồn sự thật là `patient-index.json` — pipeline ghi từ tag DICOM. Đọc manifest
trước, chỉ đoán từ tên thư mục khi không có manifest.

## 4. Không đập đi xây lại

Refactor phải bê nguyên phần đang chạy, chỉ thiết kế đúng vùng mới. Đổi tên app,
vẽ lại component đã có, hay thay cấu trúc dữ liệu đang dùng là dấu hiệu đi quá
phạm vi được giao.

Riêng `patient-index.json`: `studies` là **dict khoá theo studyUid**, tên khoá
**camelCase**, `status` nhận `complete` / `selected` / `incomplete`. Chỉ được
THÊM khoá mới, không đổi cấu trúc, không bump `PATIENT_MANIFEST_FORMAT`.

## 5. Vùng đọc phim luôn nền tối

Vỏ app (header, winbar, worklist, khu tải phim) dùng bảng màu Notion nền trắng.
**Vùng chẩn đoán — toolbar viewer, thumbnail series, canvas ảnh, Video/Photo
Studio — phải giữ nền tối bằng mã màu hardcode**, không lấy token chrome. Nền
sáng làm sai lệch cảm nhận thang xám (Window/Level, Hounsfield Unit).
