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

## 2. Ba cổng chất lượng bắt buộc (3 Non-Negotiable Quality Gates) & Định nghĩa Hoàn thành

Mọi agent (Gemini, Claude, Codex...) trước khi tuyên bố "đã xong", đề xuất commit, hoặc thực hiện commit/push **BẮT BUỘC** phải vượt qua đủ 3 cổng chất lượng sau:

### 🚪 Cổng 1: Phân tích tĩnh & Sạch cú pháp (Static Analysis & Clean Lint)
- **ESLint không lỗi (`npm run lint --prefix webui`)**: Bắt buộc đạt 0 error, 0 warning. Tuyệt đối cấm để lọt biến chưa khai báo (`no-undef`), import sai scope, trùng khoá (`no-dupe-keys`), biến gán thừa.
- **Python syntax**: Các file Python sửa đổi phải biên dịch sạch cú pháp (`python -m py_compile <files>`).

### 🚪 Cổng 2: Kiểm thử tự động với Tương tác DOM thực (Real DOM & Behavioral Test Verification)
- **100% Test Suite xanh**:
  - Python tests: `python -m unittest discover -s tests -t tests` (hoặc
    `PATH="$PWD/tools/bin:$PATH" python -m pytest tests/test_media_*.py` cho media engine).
  - WebUI tests: `npm test --prefix webui` (100% pass, không giả lập kết quả).

#### Đọc kết quả cho đúng — `skipped` không phải `failed`

Suite Python có **527 test và chạy khoảng 6 phút**, vượt timeout mặc định 2 phút
của agent. **Chạy nền, đừng kết luận là treo** rồi bỏ qua Cổng 2.

Dùng `python` trong `.venv` của dự án. Đường dẫn `C:/Python314/python.exe` trong
tài liệu cũ không còn tồn tại.

Không có ffmpeg trong PATH thì 4 test binary-config **tự skip**. Cả
`100 passed, 7 skipped` lẫn `104 passed, 3 skipped` đều là kết quả ĐÚNG, chỉ khác
môi trường. Đừng đi "sửa" những test đó — chúng đang chạy tốt.

- **Luật kiểm thử DOM thực (BẮT BUỘC — ZERO TOLERANCE)**:
  - Thứ gì người dùng bấm (nút, tab, pin timeline, thẻ danh sách, menu) thì test **PHẢI** kích hoạt qua DOM thật: `node.click()`, `fireEvent`, `dispatchEvent`.
  - **Tuyệt đối cấm gọi tắt hàm nội bộ** với object giả lập (ví dụ `action({ dataset: ... })`). Cách gọi tắt này hoàn toàn bỏ qua việc gắn listener DOM, che giấu lỗi liệt sự kiện khi cập nhật `innerHTML` và lỗi scoping.

### 🚪 Cổng 3: Build sản phẩm & Kiểm tra chạy thực (Production Build & Real Runtime Sanity)
- **Rebuild bundle**: Sửa bất cứ thứ gì trong `webui/src/` thì **bắt buộc** chạy lại:
  ```bash
  npm run build --prefix webui
  ```
  Không build thì `web_dist/` vẫn là bundle cũ và app chạy code cũ.
- **Kiểm thử trình duyệt thực tự động (Browser Smoke Test)**: Chạy smoke test tự động trên trình duyệt Chrome thật để đảm bảo bundle production hoạt động hoàn hảo, không bị đứt listener khi chuyển đổi clip/tab, và sạch 100% console error:
  ```bash
  python tools/smoke_browser.py
  # hoặc: npm run test:smoke --prefix webui
  ```
- **Xem trước thủ công (Manual Preview)**: Khi cần kiểm tra tương tác mắt thấy tai nghe: `python tools/run_web_preview.py --static web_dist`.

### 🎯 Định nghĩa Hoàn thành (Definition of Done - DoD)
Agent **CHỈ ĐƯỢC PHÉP** thông báo xong việc hoặc sẵn sàng commit khi:
`Lint sạch 0 lỗi` ➔ `Test 100% pass với DOM thật` ➔ `npm run build hoàn tất` ➔ `Smoke test trình duyệt thật (tools/smoke_browser.py) đạt 0 lỗi`.

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
**camelCase**, `status` nhận `complete` / `selected` / `incomplete` / `partial`. Chỉ được
THÊM khoá mới, không đổi cấu trúc, không bump `PATIENT_MANIFEST_FORMAT`.

## 5. Hai theme, chọn theo tab đang mở

App có đúng hai bảng màu, và tab đang mở quyết định dùng bảng nào. Lớp
`worklist-active` / `viewer-active` trên `.app-shell` là công tắc duy nhất.

| Tab đang mở | Vỏ app (header, winbar, khu tải phim, status bar) | Vùng chẩn đoán |
| :--- | :--- | :--- |
| **Worklist** | Notion nền trắng | không hiển thị |
| **Bệnh nhân** | nền tối, đổi qua token trong `.app-shell.viewer-active` | nền tối |

**Vùng chẩn đoán — toolbar viewer, thumbnail series, canvas ảnh, rail bệnh nhân,
Video/Photo Studio — luôn nền tối bằng mã màu hardcode**, không lấy token
chrome, kể cả khi vỏ app đang sáng. Nền sáng làm sai lệch cảm nhận thang xám
(Window/Level, Hounsfield Unit).

Đổi theme là đổi token, không phải đổi mã màu trong từng rule. Vỏ tối lấy trọn
bộ token từ `.app-shell.viewer-active`; vỏ sáng dùng token gốc ở `:root`.

### `color-scheme` phải đi cùng nền

`:root` khai `color-scheme: light`, `.app-shell.viewer-active` khai
`color-scheme: dark`. Trình duyệt dùng cờ này để tô **những thứ CSS không nói
tới**: chữ trong `<input>`, con trỏ nháy, ô checkbox, nút radio, thanh cuộn.

Đã từng để cờ này là `dark` toàn cục trong khi vỏ app nền trắng: hai ô "Mã bệnh
nhân" và "Link viewer" hiện chữ trắng trên card trắng (1.00:1), checkbox chưa
tick bị vẽ thành ô đen đặc nhìn như đang tick. Thêm một control mới mà quên đặt
`color` là lỗi quay lại ngay.

### Ngưỡng tương phản

Mọi cặp chữ/nền phải đạt **4.5:1**. `webui/src/color-contrast.test.js` tự tính
tỉ lệ cho các cặp token và sẽ fail nếu tụt xuống dưới — thêm token màu mới thì
thêm cặp vào danh sách `PAIRS` trong đó.

Test đó chỉ thấy token. Muốn thấy thứ trình duyệt thật sự tô — cascade thật, màu
mặc định của UA, các trạng thái rỗng/lỗi — thì dựng app rồi đo:

```bash
python tools/run_web_preview.py --static web_dist   # in ra URL kèm token
python ~/.claude/skills/contrast-audit/audit.py <URL> --steps tools/ui-states.json
```

`tools/ui-states.json` lái app qua 6 trạng thái đáng kiểm: kho rỗng, quét lỗi,
danh sách có hồ sơ, hai ô nhập đã điền, tab Hoạt động, tab bệnh nhân nền tối.
Dùng `goto` chứ đừng dùng `reload` — app xoá token khỏi URL lúc khởi động nên
reload sẽ rơi vào màn hình lỗi.

Hai lỗi hay gặp, đã sửa nhưng dễ tái diễn:

- Chữ trắng trên `--accent-bg` (xanh nhạt) — nút trông như rỗng. Nhãn của
  `button.primary` dùng `--accent-fg`, không dùng `#fff`.
- `.empty-state` được viết cho canvas đọc phim: `position: absolute; inset: 0`
  và nền `#05080c`. Thả nó vào Worklist thì nó phủ đen cả cửa sổ. Trong Worklist
  phải dùng bản đã scope lại `.worklist-tree .empty-state`.
