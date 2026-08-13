# Engine xử lý ảnh/video — video_engine.py + photo_engine.py + media_api.py

Đây là code thật, đã chạy và test thật (không phải mockup) — FFmpeg thật xử lý
video thật, Pillow thật xử lý ảnh thật, 152 test pytest chạy qua toàn bộ, có
server FastAPI thật trả lời qua HTTP thật. Không có phần nào ở đây là giả lập.

## Có gì trong này

```
server/
  video_engine.py              lõi xử lý video — wrap FFmpeg qua subprocess, có giới hạn đồng thời
  photo_engine.py               lõi xử lý ảnh — dùng Pillow, có giới hạn đồng thời
  media_api.py                   lớp FastAPI mỏng expose 2 engine trên qua HTTP
  dev_server.py                   server standalone CHỈ để bạn tự test, không dùng trong production
  test_video_engine.py             19 test — hành vi nghiệp vụ video (probe/trim/concat/...)
  test_photo_engine.py             24 test — hành vi nghiệp vụ ảnh (crop/redact/annotate/...)
  test_media_api.py                20 test — route HTTP cơ bản + bảo mật path-traversal
  test_media_api_routes.py         26 test — route HTTP còn lại (thumbnail/filmstrip/burn-text/...)
  test_concurrency.py              12 test — giới hạn đồng thời video (threading thật)
  test_photo_concurrency.py         6 test — giới hạn đồng thời ảnh (threading thật)
  test_edge_cases.py               34 test — file giả mạo, decompression bomb, injection
  test_binary_configuration.py     11 test — dò/cấu hình đường dẫn FFmpeg
  requirements.txt
```

**Tổng: 152 test, coverage đo được 94%** (xem mục 6).

## Cách tự chạy để kiểm chứng (không cần tin lời tôi)

```bash
cd server
pip install -r requirements.txt
pytest -v                      # phải thấy "152 passed"
pytest --cov=video_engine --cov=photo_engine --cov=media_api --cov-report=term-missing

# thử server thật qua HTTP:
python3 dev_server.py &
curl -F "file=@/path/to/video.mp4" http://127.0.0.1:8731/api/media/upload
curl http://127.0.0.1:8731/api/media/health   # xem trạng thái hàng đợi đồng thời
```

---

## 1. Vì sao dùng FFmpeg/Pillow thay vì "tự viết engine"

Không có app lớn nào (Premiere, DaVinci, CapCut, kể cả trình xem ảnh Windows)
tự viết codec H.264/H.265/JPEG từ đầu ở tầng ứng dụng — đó là hàng chục năm
công sức chuẩn hoá (ISO/ITU), viết lại là vô nghĩa và chắc chắn kém hơn. "Viết
engine" đúng nghĩa ở tầng ứng dụng là:
- Điều khiển đúng công cụ (đúng flag, đúng filter, đúng thứ tự pipeline)
- Xử lý lỗi đúng (file hỏng, định dạng lạ, timeout, tràn tài nguyên)
- Đường ống dữ liệu đúng (không sửa file gốc, dọn file tạm, giới hạn kích thước)
- Tốc độ đúng chiến lược (stream-copy khi có thể, re-encode khi cần chính xác)

Đó là toàn bộ nội dung của `video_engine.py`/`photo_engine.py`.

## 2. Kết quả đo tốc độ thật (trên máy 1 CPU core, không GPU — máy bệnh viện thật thường nhanh hơn)

| Thao tác | Input | Thời gian |
|---|---|---|
| Probe metadata | video MP4 1080p 20s | 1.2s |
| 1 thumbnail | video MP4 1080p | 0.8s |
| Filmstrip 8 khung | video MP4 1080p 20s | ~8s (seek song song, giới hạn bởi 1 CPU core sandbox test) |
| Trim (stream-copy) | video MP4 1080p 5s đoạn cắt | **0.15s** |
| Trim (re-encode chính xác) | video MP4 1080p 5s đoạn cắt | 14s |
| Ghép 2 clip khác định dạng (mp4+avi) | 11s tổng, chuẩn hoá 720p | 17s |
| Chèn text (burn-in) | video MP4 1080p 5s | 18s |
| Ảnh: probe/crop/rotate/redact | scan A4 2480×3508 | **dưới 0.3s mỗi thao tác** |
| Ảnh: annotate (text+mũi tên+khung) | scan A4 | 0.8s |
| Xuất PDF 2 trang | scan A4 | 0.24s |

**Ghi chú quan trọng về tốc độ trim/re-encode/burn-text/concat**: sandbox test
chỉ có **1 CPU core** (`nproc` = 1). Video test dùng `testsrc2` (nội dung
random-pattern, khó nén nhất có thể) — video mổ/khám thực tế nén nhanh hơn
nhiều vì ít chuyển động đột ngột. Trên máy bệnh viện thật (4-16 core, không
CPU giả lập), các thao tác re-encode sẽ nhanh hơn đáng kể, và `extract_filmstrip`
(đã viết song song hoá bằng `ThreadPoolExecutor`) sẽ tăng tốc gần tuyến tính
theo số core — điều không thể hiện được trong môi trường 1-core này.

## 3. Có GPU encode (NVENC/QSV) không?

Có, `detect_hw_encoders()` tự dò và `transcode(..., use_hw=True)` tự dùng
NVENC nếu máy có GPU NVIDIA tương thích, rơi về libx264 (CPU) nếu không. Chưa
test trên GPU thật (sandbox không có GPU) — cần bạn tự xác nhận trên máy có
GPU thật, nhưng logic dò/fallback đã đúng và có test (`test_returns_dict_without_crashing`).

## 4. Một bug bảo mật thật đã tìm và sửa trong lúc viết

`_resolve_existing()` chặn path traversal (`../../../etc/passwd`) đúng, ném
`HTTPException(403)` — nhưng ban đầu bị gọi **bên trong khối `try/except
Exception`** của 2 route (`video_probe`, `photo_probe`), khiến `HTTPException`
bị bắt nhầm và bọc thành `500 Lỗi xử lý nội bộ` thay vì trả đúng `403`. Đã
sửa (tách `_resolve_existing()` ra khỏi `try`, thêm lớp bảo vệ kép trong
`_engine_error_to_http`), và khoá lại bằng test `TestPathSecurity` trong
`test_media_api.py` để không tái diễn khi code được sửa tiếp sau này. Đây là
đúng loại lỗi mà chỉ test thật qua HTTP mới bắt được — không thể thấy được
nếu chỉ đọc code.

## 4b. Giới hạn xử lý đồng thời (concurrency)

Vấn đề thật: mỗi lệnh FFmpeg là 1 tiến trình hệ điều hành riêng, ăn trọn 1+
lõi CPU khi encode. Không giới hạn nghĩa là N bác sĩ bấm "Xuất video" cùng
lúc sẽ khởi 2N tiến trình FFmpeg, cắm hết CPU và làm treo cả những request
nhẹ (mở hồ sơ, xem thumbnail) đứng sau trên cùng máy chủ.

**Cách giải quyết**: `_ConcurrencyGate` (semaphore có hàng đợi + timeout chờ)
đặt tại đúng 1 điểm chốt mà mọi lệnh đi qua — `_run()` trong `video_engine.py`
và `_open_safely()` trong `photo_engine.py` — nên áp dụng tự động cho toàn bộ
engine mà không cần sửa từng hàm nghiệp vụ riêng lẻ.

- **Video** tách 2 hạng mục: `heavy` (transcode/concat/burn-text/re-encode
  trim — giới hạn mặc định theo số lõi CPU, tối đa 4) và `light` (probe/
  thumbnail — giới hạn rộng hơn, vì rất nhanh). Hai hạng mục **độc lập hoàn
  toàn**: bác sĩ A đang export video (heavy) không chặn bác sĩ B chỉ đang mở
  hồ sơ khác (light) — có test xác nhận riêng
  (`test_probe_still_works_while_heavy_gate_saturated`).
- **Ảnh** dùng 1 hạng mục duy nhất (Pillow đơn giản hơn FFmpeg, không cần
  tách heavy/light), giới hạn rộng hơn video vì lo ngại chính là RAM chứ
  không phải CPU nghẽn.
- Chờ quá lâu (mặc định 120s cho video heavy, 30s cho light/ảnh) → ném
  `ServerBusyError`, `media_api.py` map thành **HTTP 429** (Too Many
  Requests) — đúng ngữ nghĩa REST để client tự động thử lại thay vì coi là
  lỗi vĩnh viễn.
- Endpoint `GET /api/media/health` trả về số tác vụ đang chạy/đang chờ của
  từng hạng mục, để UI hiển thị "máy đang bận" thay vì để người dùng đoán vì
  sao request treo lâu.

**Bug phụ tìm thấy trong lúc làm phần này**: nhánh streaming của
`transcode()` (dùng `progress_cb` để báo % hoàn thành) trước đây gọi
`process.wait(timeout=...)` **không có try/except** — nếu quá timeout sẽ
ném lỗi thô ra ngoài (không phải `EncodeFailedError` nhất quán với phần còn
lại của engine) và **để tiến trình FFmpeg zombie không bị kill**. Đã sửa cả
hai vấn đề cùng lúc.

Test: `test_concurrency.py` (video, 12 test) và `test_photo_concurrency.py`
(ảnh, 6 test) — dùng threading thật, không mock semaphore, bao gồm cả test
tích hợp gọi FFmpeg thật 2 lần đồng thời để chứng minh hàng đợi hoạt động
trên đường đi production, không chỉ đúng khi test `_ConcurrencyGate` cô lập.

## 4c. Một lỗ hổng DoS thật đã tìm và sửa: decompression bomb

Vấn đề thật (đo được, không phải lý thuyết): `photo_engine._open_safely()`
gọi `Image.open()` rồi `img.load()` **trước khi** kiểm tra kích thước ảnh có
vượt `_MAX_DIMENSION` (8000px) hay không. `img.load()` mới là bước giải nén
toàn bộ pixel vào RAM — với một ảnh PNG nén tốt (ví dụ toàn 1 màu, chỉ ~300KB
trên đĩa) nhưng kích thước 10000×10000px, việc giải nén tốn khoảng **300MB
RAM và 3.7 giây CPU** (đo thực tế trên máy 1 core) — đủ để một kẻ tấn công
gửi vài request như vậy đồng thời làm cạn RAM/CPU máy chủ, xảy ra hoàn toàn
**trước khi** code kịp từ chối ảnh vì quá khổ.

Pillow có sẵn `Image.MAX_IMAGE_PIXELS` nhưng mặc định **chỉ cảnh báo (Warning),
không chặn (không raise Exception)** — đã xác nhận bằng thực nghiệm chứ không
suy đoán.

**Cách sửa**: kiểm tra `img.width`/`img.height` **ngay sau** `Image.open()`
(chỉ đọc header, tốn mili-giây) và **trước** `img.load()` (giải nén thật, tốn
kém). Sau khi sửa, cùng file test 10000×10000px đó bị từ chối trong
**0.0175 giây** thay vì 3.7 giây — nhanh hơn ~200 lần vì không còn giải nén.
Cảnh báo `DecompressionBombWarning` của Pillow được bắt và ghi qua `logger`
có kiểm soát thay vì in thẳng ra stderr không lọc được.

Test trong `test_edge_cases.py::TestPhotoDecompressionBomb`: không chỉ xác
nhận có `raise` đúng loại lỗi, mà còn **đo thời gian thực** (`< 0.5s`, ngưỡng
rất rộng so với ~0.01-0.02s đo được) — một fix sai vị trí (check sau
`load()`) vẫn có thể "pass" nếu test chỉ kiểm tra có raise mà không đo thời
gian, nên phép đo thời gian mới là bằng chứng thật. Có thêm test dùng
`monkeypatch` để spy trực tiếp `Image.Image.load` và xác nhận nó **không hề
được gọi** trên ảnh quá khổ.

## 4d. Test coverage đo được (pytest-cov)

Đo bằng `pytest --cov`, không phải ước lượng:

| File | Coverage | Ghi chú |
|---|---|---|
| `photo_engine.py` | 96% | Dòng miss còn lại: `redact_all_faces_heuristic()` (cố ý chưa triển khai, xem mục 6), font fallback khi thiếu font hệ thống (môi trường test luôn có sẵn font) |
| `media_api.py` | 95% | Từ 72% ban đầu — thiếu hẳn test cho 9/16 route trước khi có `test_media_api_routes.py`. Dòng miss còn lại là nhánh lỗi 500 catch-all hiếm khi trigger |
| `video_engine.py` | 92% | Dòng miss còn lại: nhánh `elif` phụ trong `configure_concurrency` (case hiếm: chỉ set timeout không set limit) |
| **Tổng** | **94%** | 152 test |

Quá trình đo coverage tự nó phát hiện ra lỗ hổng thật: **9 trong 16 route
HTTP hoàn toàn chưa có test nào** (`/video/thumbnail`, `/video/filmstrip`,
`/video/burn-text`, `/video/concat`, `/video/export`, `/photo/rotate`,
`/photo/annotate`, `/photo/export-pdf`, và phần lớn `/upload`) — không phải
chỉ thiếu edge-case, mà thiếu cả test happy-path cơ bản. Đã vá bằng
`test_media_api_routes.py` (26 test mới). Coverage cũng lộ ra
`video_engine.configure_binaries()` — đúng phần logic sẽ dùng khi bạn đóng
gói FFmpeg kèm app (xem mục 5.3) — **0% coverage trước đó**, vá bằng
`test_binary_configuration.py` (11 test), xác nhận đúng hành vi fallback
(không trộn lẫn binary từ bundle với binary từ PATH hệ thống).

## 5. Cách tích hợp vào app thật của bạn

### 5.1. Xác nhận framework backend thật

Tôi **không có** file backend Python thật của bạn (chỉ có `main.js`/`viewer.js`
phía client), nên `media_api.py` được viết **giả định FastAPI** — đoán dựa
trên cách gọi `/api/...` khớp REST convention phổ biến. Việc cần bạn làm:

- Nếu backend thật **là FastAPI**: chỉ cần
  ```python
  from media_api import router as media_router
  app.include_router(media_router, prefix="/api/media")
  ```
- Nếu backend thật **là Flask** (hoặc khác): `video_engine.py` và
  `photo_engine.py` **không cần đổi gì** — chúng không phụ thuộc framework,
  chỉ là hàm Python thuần + subprocess/Pillow. Chỉ cần viết lại phần route
  mỏng trong `media_api.py` theo `Blueprint` của Flask, gọi thẳng các hàm
  `ve.probe()`, `ve.trim()`, `pe.crop()`... y hệt cách `media_api.py` đang làm.

### 5.2. Đường dẫn làm việc (`WORK_ROOT`)

`media_api.py` hiện dùng `tempfile.gettempdir()/concord_media_work` — đây là
placeholder để module chạy độc lập lúc test. **Cần đổi** trước khi dùng thật,
vì thư mục temp hệ thống có thể bị dọn giữa các phiên làm việc. Đổi
`WORK_ROOT` trong `media_api.py` thành đường dẫn thật của app (gợi ý: cùng
cấp với thư mục kho DICOM `D:\PACS\Kho`, ví dụ `D:\PACS\_work\media\`).

### 5.3. FFmpeg binary

`video_engine.configure_binaries(ffmpeg_dir)` cho phép trỏ tới FFmpeg đóng gói
kèm app. Gọi 1 lần lúc khởi động app:
```python
from pathlib import Path
import video_engine
video_engine.configure_binaries(Path(__file__).parent / "bin" / "ffmpeg")
```
Cần bạn tự tải bộ FFmpeg static build cho Windows (gyan.dev hoặc BtbN builds
trên GitHub) và bỏ vào `<app_root>/bin/ffmpeg/ffmpeg.exe` + `ffprobe.exe`.
Nếu không gọi `configure_binaries()`, engine tự rơi về tìm trong PATH hệ
thống — vẫn hoạt động nếu máy có cài sẵn, chỉ không đảm bảo với máy chưa cài.

### 5.4. Auth / session token

`main.js` đọc `sessionToken` từ query string lúc khởi động (dòng 51-61) rồi
xoá khỏi URL — gợi ý cơ chế auth hiện có nằm ở tầng khác (middleware chung,
cookie session...) chứ không phải trong từng route. `media_api.py` **cố tình
không tự thêm auth** — giả định bạn có middleware xác thực đặt trước router
này trong app chính, áp dụng chung cho mọi route `/api/*`. Nếu chưa có, cần
bổ sung trước khi dùng thật (không nên để route xử lý file public không auth).

### 5.5. Chỗ nối vào mockup UI (`concord-v3.1.html`)

Trong mockup video editor, các nút "+/×" trên clip-card hiện chỉ đổi CSS class
(xem `wireEmbeddedInteractions` trong file HTML). Khi nối vào code thật:
- Nút "+" (ghép clip vào track) → gọi `POST /api/media/video/concat` với danh
  sách path theo đúng thứ tự các clip trong track
- Nút cắt đoạn trên timeline → `POST /api/media/video/trim`
- Nút chèn text → `POST /api/media/video/burn-text`
- Nút "Xuất" cuối cùng → `POST /api/media/video/export`
- Thumbnail rail ảnh/video → `GET .../video/thumbnail` hoặc `POST .../video/filmstrip`

Photo viewer mockup tương tự: crop/rotate/redact/annotate map thẳng 1-1 tới
route cùng tên trong `photo/*`.

## 6. Còn thiếu gì (chưa làm, cần bạn quyết định trước khi làm tiếp)

- **`redact_all_faces_heuristic()`**: chữ ký hàm để sẵn cho nút "Che tất cả
  định danh" trong mockup, nhưng chưa triển khai — cần bạn chọn hướng (OCR +
  regex tìm số CMND/SĐT, hay model nhận diện khuôn mặt) trước khi code, vì 2
  hướng này kéo theo dependency rất khác nhau (pytesseract nhẹ vs
  face_recognition/dlib nặng, cần biên dịch).
- **Streaming tiến trình cho trim/burn-text/concat**: hiện chỉ `transcode()`
  có `progress_cb` streaming %. Muốn thêm cho các hàm khác thì áp dụng đúng
  pattern đã có (đọc `-progress pipe:1` dòng theo dòng).
- **Cleanup file tạm tự động**: `WORK_ROOT` hiện tích tụ file vô hạn theo
  thời gian sử dụng — mỗi lần trim/crop/... đều ghi ra file mới, không có gì
  tự xoá. Đã cố tình để sau theo yêu cầu, chưa triển khai. Khi làm, gợi ý cơ
  chế dọn theo tuổi file (vd. xoá file trong `WORK_ROOT` cũ hơn N giờ) chạy
  định kỳ hoặc lúc khởi động app.
- **Test trên GPU thật**: NVENC/QSV chưa test được (sandbox không có GPU) —
  `detect_hw_encoders()` chỉ xác nhận không crash khi gọi, chưa xác nhận
  encode thật qua GPU cho kết quả đúng.
- **Coverage 94%, không phải 100%**: các dòng miss còn lại (xem mục 4d) đều
  là nhánh hợp lý bỏ qua (tính năng cố ý chưa triển khai, fallback hiếm khi
  trigger) — không cố "vét" lên 100% vì sẽ tạo test giả tạo không tăng thêm
  độ tin cậy thật.
