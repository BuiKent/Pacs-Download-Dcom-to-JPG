# Kiểm tra chất lượng release — DCom JPG PACS viewer (WebView2)

Phạm vi: `webui/src/viewer.js`, `webui/src/image-worker.js`,
`webui/src/main.js`, `webui/src/styles.css`, `web_backend.py`, `mpr_engine.py`,
`dcom_pipeline.py`, `dcom_web_app.py`, `tools/smoke_webview.py` và các test liên quan.
Ngày kiểm tra: 30/07/2026 · Nhánh: `main` · Bản gốc: `846bce4`.

Mục tiêu: **sản phẩm chuẩn release, không phải MVP**. Vì vậy mỗi lỗi dưới đây đều
có bằng chứng đo được (không phỏng đoán) và một cổng kiểm tra tự động để không
tái diễn.

---

## 1. Lỗi gốc: chuyển MPR → 3D bị đen màn hình

### 1.1 Hiện tượng đã tái hiện được

Chạy phantom tổng hợp 121 lát trong WebView2 thật (`tools/create_synthetic_mpr.py`),
lấy mẫu pixel trực tiếp từ canvas của từng khung. Cột `nonBlack` là số pixel sáng
trên mẫu 96×96:

| Bước | Chế độ | Rendering engine | Số pixel sáng mỗi khung |
|---|---|---|---|
| 1 | single | engine-1 | `[2426]` ✅ |
| 2 | mpr | engine-2 | `[3656, 4652, 5516]` ✅ |
| 3 | **volume3d** | engine-3 | **`[0, 0, 0, 0]`** ❌ đen hoàn toàn |
| 4 | **mpr (quay lại)** | engine-4 | **`[0, 0, 0]`** ❌ MPR cũng chết theo |

Đúng như mô tả: sang 3D thì đen, và **MPR mất luôn**. Không có exception, không
có thông báo lỗi — `viewerDiagnostics()` vẫn báo `destroyed: false`, mỗi viewport
vẫn có `actors: 1`. Nghĩa là mọi dấu hiệu "thành công" đều đúng, chỉ có điều
không vẽ được gì.

### 1.2 Nguyên nhân gốc

Đo số WebGL context sống trong trang qua mỗi lần đổi chế độ:

```
boot   → 1 context sống
mpr    → 8
single → 15
mpr    → 22   ← từ đây MPR/3D đen
single → 29
mpr    → 35
```

Chuỗi nguyên nhân:

1. `webui/src/viewer.js` tạo **một `RenderingEngine` mới cho mỗi lần đổi layout**
   (`createRenderingEngine()` tăng `renderingGeneration` rồi `new RenderingEngine(...)`).
2. Cornerstone 4.22 chạy ở chế độ `ContextPool`: **mỗi RenderingEngine cấp phát
   một pool 7 WebGL context** (`webGlContextCount: 7`, xem
   `node_modules/@cornerstonejs/core/dist/esm/init.js:16`).
3. `renderingEngine.destroy()` gọi `contextPool.destroy()` → `vtkOffscreenMultiRenderWindow.delete()`,
   nhưng vtk.js **không gọi `WEBGL_lose_context.loseContext()`**. Context chỉ được
   thu hồi khi GC chạy, không xác định thời điểm. Đo được: không có một sự kiện
   `webglcontextlost` nào cho các engine đã destroy.
4. Chromium giới hạn số WebGL context sống đồng thời trên một trang (~16). Từ
   engine thứ 3 trở đi, context mới không dùng được → **viewport dạng volume
   (ORTHOGRAPHIC / VOLUME_3D) vẽ ra khung đen**, trong khi viewport STACK vẫn
   sống vì nó được gán vào context index 0 đã tồn tại từ đầu.

Đó là lý do 2D luôn "bình thường" nhưng MPR và 3D thì đen — và tại sao lỗi chỉ
xuất hiện sau vài lần đổi chế độ, khó tái hiện bằng tay theo một thứ tự cố định.

### 1.3 Cách sửa

Giữ **đúng một RenderingEngine cho cả phiên làm việc**, chỉ đổi viewport bên
trong nó (đây cũng là cách OHIF làm khi đổi layout):

- `createRenderingEngine()` chỉ tạo engine lần đầu, sau đó trả lại engine cũ.
- `destroyCurrent()` gọi `renderingEngine.disableElement(id)` cho **từng**
  viewport cũ. Đây là điểm quan trọng: `setViewports()` gọi `_reset()` nhưng
  `_reset()` **không** trả slot về context pool (`contextPool.removeViewport`
  chỉ được gọi từ `disableElement`) — nếu chỉ dựa vào `setViewports()` thì pool
  vẫn phình ra theo thời gian.
- Thêm `disposeViewer()` (chỉ dùng khi đóng cửa sổ, gắn vào `pagehide`) để giải
  phóng GPU đúng một lần.

Kết quả đo lại sau khi sửa, chuỗi `mpr → 3d → mpr → 3d → single → montage6 → mpr`:

| Bước | Engine | WebGL context sống | Pixel sáng |
|---|---|---|---|
| mpr | engine (1 duy nhất) | 1 | `[3656, 4652, 5516]` ✅ |
| volume3d | engine (1 duy nhất) | 1 | `[2425, 3792, 4518, 2215]` ✅ |
| mpr | engine (1 duy nhất) | 1 | `[3656, 4652, 5516]` ✅ |
| volume3d | engine (1 duy nhất) | 1 | `[2425, 3792, 4518, 2215]` ✅ |
| single | engine (1 duy nhất) | 1 | `[2426]` ✅ |
| montage6 | engine (1 duy nhất) | 6 | `[460, 460, 482, 528, 574, 621]` ✅ |
| mpr | engine (1 duy nhất) | 6 | `[3656, 4652, 5516]` ✅ |

Số context đứng yên ở mức tối đa 1 pool, đổi qua lại MPR/3D không giới hạn.

---

## 2. Vì sao lỗi này lọt qua cổng kiểm tra (nghiêm trọng ngang lỗi gốc)

`dcom_web_app.py --smoke-test` **đã có** một cổng riêng cho đúng lỗi này
("Regression gate for the real-world failure where repeated MPR/3D switches left
only the crosshair overlay on a blank WebGL viewport"). Nó kiểm tra:

- số canvas đúng như mong đợi,
- `readyMode` đúng chế độ,
- `diagnostics.destroyed === false`,
- mỗi viewport có `actors >= 1`,
- không còn overlay `busy`.

**Tất cả năm điều kiện đó đều ĐÚNG trong lúc màn hình đen.** Cổng kiểm tra chỉ
xác nhận cấu trúc, chưa bao giờ xác nhận có pixel nào được vẽ ra.

Đã sửa: thêm `PIXEL_PROBE` + `_assert_panes_drawn()` vào `dcom_web_app.py`, lấy
mẫu canvas thật và yêu cầu mỗi khung có tối thiểu `MIN_LIT_PIXELS = 40` pixel
sáng. Cổng này chạy cho **mọi** chế độ (compare, montage6, montage8, mpr,
volume3d) và cho cả ba lần chuyển đổi MPR↔3D lặp lại. Bổ sung thêm hai bất biến:

- **Một engine duy nhất**: tất cả layout phải báo cùng một `engineId` — khóa
  trực tiếp nguyên nhân gốc ở mục 1.
- **Thanh công cụ không được nói dối**: nút đang sáng phải trùng với công cụ mà
  Cornerstone thực sự kích hoạt (mục 3.1).

Đã xác nhận cổng mới *thất bại* khi cố tình bật lại hành vi cũ
(engine mới mỗi layout) — cổng không phải là cổng rỗng.

---

## 3. Các lỗi khác tìm được

### 3.1 Nghiêm trọng — Công cụ đang chọn không đúng công cụ đang chạy

Biến `currentTool` trong `viewer.js` và `state.tool` trong `main.js` là hai
nguồn sự thật song song. Hậu quả đo được (log console thật):

```
warn: For crosshairs to operate, at least two viewports must be given.
```

- Sau khi xem MPR (`setTool("crosshair")`), bấm về **single**: `main.js` đặt
  `state.tool = "window"` và tô sáng nút "Sáng", nhưng `createToolGroup()` gọi
  `setTool(currentTool)` với `currentTool` còn là `"crosshair"` → Cornerstone
  kích hoạt Crosshairs trên layout 1 khung (vô nghĩa). **Kéo chuột trái không
  điều chỉnh sáng/tương phản nữa** dù nút "Sáng" đang sáng.
- Vào **3D** từ MPR: `show3d()` chạy `setTool(currentTool === "rotate3d" ? "rotate3d" : "crosshair")`,
  `currentTool` là `"crosshair"` → người dùng thấy nút "Xoay 3D" sáng nhưng kéo
  chuột lại di chuyển tâm giao điểm, không xoay được mô hình.

Đã sửa: `state.tool` trong `main.js` là nguồn sự thật duy nhất; `showStacks/showMpr/show3d`
nhận `tool` từ caller và **trả về công cụ thực sự áp dụng được**; `setTool()` từ
chối công cụ layout không hỗ trợ qua `toolFallback()` (Crosshairs cần ≥2 khung,
TrackballRotate cần khung 3D) và trả về công cụ thay thế để thanh công cụ tô
sáng lại cho khớp. Có unit test và cổng smoke cho bất biến này.

### 3.2 Nghiêm trọng — Mất phép đo/ROI không cảnh báo

`destroyCurrent()` gọi `annotation.state.removeAllAnnotations()` mỗi lần đổi
layout. Mọi phép đo chiều dài / ROI chưa bấm 💾 bị xóa im lặng khi người dùng
chỉ đơn giản bấm sang MPR để xem lại. Với công cụ dùng trong chẩn đoán, đây là
mất dữ liệu công việc.

Đã sửa: `persistActiveAnnotations()` tự lưu vào thư mục series **trước** khi
dựng lại layout; nếu lưu thất bại thì báo đỏ trên status bar thay vì xóa lặng lẽ.

### 3.3 Nghiêm trọng — Lưu ROI của series này vào file của series khác

`saveAnnotations()` cũ ghi **toàn bộ** annotation đang có vào file của series
đang chọn. Ở chế độ **compare** (2 series cùng lúc), ROI vẽ trên series B bị
ghi vào `viewer-annotations.json` của series A, rồi lần sau được nạp lại lên
series A. Số đo hiển thị trên sai bệnh phẩm.

`roiVolumeMl()` cũng bị ảnh hưởng: nhánh dự phòng `return Boolean(item.metadata?.referencedImageId)`
nhận cả ROI của series khác vào phép tính thể tích.

Đã sửa: `annotationBelongsToSeries()` phân loại theo `referencedImageId` /
`volumeId` / khóa `cachedStats` (đều chứa series id nội bộ). Lưu ý kỹ thuật:
**không thể** dùng `FrameOfReferenceUID` để phân biệt, vì mọi series trong cùng
một ca chụp dùng chung UID này. Có unit test.

### 3.4 Trung bình — `renderingEngine.hasBeenDestroyed` luôn là `undefined`

Lớp facade `RenderingEngine` (`RenderingEngine.js`) **không hiện thực**
`hasBeenDestroyed`; chỉ file `.d.ts` khai báo có. Vì vậy hai guard
`if (renderingEngine && !renderingEngine.hasBeenDestroyed)` trong `viewer.js`
chưa từng chặn được gì. (Tác giả cũ đã lách bằng `_implementation?.hasBeenDestroyed`
trong `viewerDiagnostics()`, nhưng đó là truy cập nội bộ của thư viện.)

Đã sửa: dùng cờ `engineUsable` của riêng ứng dụng qua `engineIsLive()`, không phụ
thuộc thuộc tính không tồn tại và không chọc vào `_impleme]ntation`.

### 3.5 Trung bình — Bộ đệm ảnh không bao giờ được giải phóng

`purgeSeriesCache()` được export nhưng **không nơi nào gọi** — và nếu gọi thì
cũng lỗi: `cache.getCachedImageBasedOnImageURI()` trả về **một** object, không
phải mảng, nên `for (const image of ...)` sẽ throw. Một ca chụp thật có nhiều
series 100–300 lát; volume và slice giải mã cứ tích lũy tới hạn 3 GB của
Cornerstone rồi ném `cachedSizeExceeded` bằng tiếng Anh.

Đã sửa: `purgeSeriesCache()` suy ra imageId từ registry (Cornerstone không có
API công khai để liệt kê cache), và `ensureVolume()` gọi `releaseOtherSeries()`
để nhả volume + slice của các series khác trước khi dựng volume mới.

### 3.6 Trung bình — Kế toán bộ nhớ sai 5 lần

`decodeImage()` giữ lại nguyên `canvas` RGBA cho **mỗi lát đã cache**
(`getCanvas: () => canvas`) nhưng khai báo `sizeInBytes: pixels.byteLength` —
chỉ tính buffer xám 1 byte/pixel. Cornerstone tính hạn mức cache theo
`sizeInBytes`, nên **4 byte/pixel còn lại là bộ nhớ vô hình**: một series 300 lát
512×512 giữ thêm ~314 MB mà cache không hề biết.

Thực tế `getCanvas()` chỉ được CPU-fallback dùng cho ảnh **màu**
(`renderColorImage.js`), còn ảnh của ứng dụng là `color: false` → không bao giờ
được gọi.

Đã sửa: giải mã trên `OffscreenCanvas` tách khỏi document, buffer RGBA được thu
hồi ngay sau khi decode xong; `getCanvas()` dựng lại canvas theo yêu cầu.

### 3.7 Trung bình — Công việc đang xem bị dựng lại giữa lúc tải phim

`pollJob()` chạy mỗi giây; khi tìm ca xong nó gọi `render()` + `renderViewer()`,
tức là **dựng lại toàn bộ khung xem, mất camera/zoom/đo** của người dùng đang
đọc phim, chỉ vì danh sách ca chụp thay đổi. Nó cũng ghi đè status bar của
viewer liên tục.

Đã sửa: `renderStudyList()` chỉ cập nhật đúng danh sách ca; status bar do viewer
giữ trong lúc đang dựng layout.

### 3.8 Trung bình — "Lưu ảnh khung đang xem" lưu sai khung

`captureActiveViewport()` luôn lấy `activeElements[0]`, tức khung được dựng đầu
tiên: ở MPR khi phóng to Sagittal thì vẫn lưu Axial; ở montage luôn lưu ô số 1;
ở compare luôn lưu series bên trái. Ngoài ra `URL.revokeObjectURL()` được gọi
ngay sau `link.click()` — Chromium có thể chưa kịp đọc blob, file lưu ra rỗng.

Đã sửa: theo dõi khung dưới con trỏ (`pointerenter`/`pointerdown`, có viền sáng
`.viewport-shell.is-active` để người dùng thấy), thu hồi blob sau 60 s, và status
bar báo rõ đã lưu khung nào.

### 3.9 Trung bình — Không có cách thoát khi đang dựng volume

Layout được xếp hàng qua `viewerQueue`; trong lúc nạp 300 lát, người dùng bấm
sang chế độ khác thì yêu cầu mới phải đợi hết lượt nạp cũ. Không có cách hủy.

Đã sửa: `loadGeneration` + `SupersededError` — yêu cầu bị thay thế dừng nạp giữa
đường và không báo lỗi giả cho người dùng (lỗi này được bỏ qua có chủ đích).

### 3.10 Thấp — Trạng thái nút "chạy phim" bị kẹt

`state.cine` không được đặt lại khi đổi chế độ, nên nút vẫn hiện biểu tượng
"Ⅱ" (đang chạy) dù cine đã bị `destroyCurrent()` dừng. Đã sửa.

### 3.11 Thấp — Đo trong chế độ 2D có thể ra pixel thay vì mm

`imagePlaneModule` trong `metadataProvider` cần manifest, nhưng manifest chỉ
được nạp từ `ensureVolume()` (tức chỉ khi vào MPR/3D). Ở chế độ single/compare
mở lần đầu, provider trả `undefined` trong khi status bar hứa "Đo chiều dài/ROI
theo mm". Đã sửa: `showStacks()` nạp manifest cho series có hình học trước khi
dựng layout, để đơn vị đo xác định ngay từ đầu chứ không phụ thuộc thứ tự bấm.

### 3.12 Thấp — Thông báo lỗi lộ nguyên văn tiếng Anh của thư viện

`setStatus(error.message)` đẩy thẳng `Failed to fetch`, `cachedSizeExceeded`…
Đã sửa: `humanError()` dịch các nhóm lỗi hay gặp (hết cache, mất kết nối API
nội bộ, sự cố GPU) sang tiếng Việt kèm hành động cần làm, vẫn giữ chi tiết gốc
trong ngoặc để hỗ trợ kỹ thuật.

### 3.13 Thấp — `tools/smoke_webview.py` không thể chạy được

Hai lỗi trong chính công cụ kiểm tra:
- Cửa sổ mở với `hidden=True`: WebView2 không cấp surface để composite, nên
  Cornerstone không gắn canvas và **mọi lần chạy đều timeout** dù build tốt
  (đã xác nhận: `canvases: 0` sau 45 s).
- `print(json.dumps(...))` vỡ với `UnicodeEncodeError` khi stdout là pipe cp1252,
  làm mất luôn kết quả.

Đã sửa cả hai. Lỗi encoding tương tự cũng tồn tại ở đường dự phòng của
`dcom_web_app.main()` — thông báo "WebView2 không khởi động được…" có thể ném
`UnicodeEncodeError` **trước khi** kịp mở giao diện classic; đã ép stdout UTF-8.

---

## 4. Rà soát UI/UX

### 4.1 Đã sửa trong lần này

| Vấn đề | Xử lý |
|---|---|
| Không có phím tắt — bắt buộc rời chuột khỏi ảnh để đổi lát/đổi công cụ | ←/→, ↑/↓, PgUp/PgDn đổi lát, Home/End lát đầu–cuối, 1–7 chọn công cụ, C định vị, R đặt lại, I đảo màu, Space chạy phim, S lưu đo, P lưu ảnh. Bỏ qua khi con trỏ đang trong ô nhập liệu. |
| Không biết đang tác động lên khung nào | Viền sáng `.is-active` theo khung dưới con trỏ; phím tắt và "lưu ảnh" đều theo khung này |
| Không có nơi tra phím tắt | Nút ⌨ trên thanh công cụ hiện danh sách trên status bar |
| Hai cụm nút `legacy-interaction-tools` / `legacy-utility-tools` render ẩn (`hidden`) — DOM chết, trùng `data-action`, vẫn bị gắn event listener | Đã xóa |
| Trình đọc màn hình không biết nút nào đang bật (chỉ có màu) | `aria-pressed` cho nút chế độ/công cụ/cine |
| Không thấy viền focus khi dùng bàn phím | `:focus-visible` cho nút và thẻ series |
| Overlay "Đang dựng MPR từ 121 lát…" đứng yên suốt quá trình nạp | Overlay cập nhật tiến độ `(nạp/tổng)` theo thời gian thực |
| Lỗi khung xem là đường cụt, phải đổi chế độ khác rồi quay lại | Thêm nút "Thử lại" trong khung lỗi |
| Lỗi khởi động là đường cụt hoàn toàn | Thêm nút "Tải lại" (gắn listener bằng JS vì CSP chặn `onclick` inline) |

### 4.2 Đã xử lý tiếp trong vòng debug sau rà soát

Không build EXE trong vòng này. Tám mục tồn tại ở bản rà soát đầu đã được xử lý
và khóa bằng unit test hoặc smoke WebView2:

1. **Giải mã JPG ngoài main thread.** Worker riêng chạy
   `createImageBitmap` + `OffscreenCanvas` + chuyển grayscale. WebView2 cần một
   bản sao `Uint8Array` thuộc main realm trước khi vtk.js upload WebGL; smoke
   xác nhận `decodePath: "worker"` và canvas có pixel. Nếu Worker không được hỗ
   trợ, viewer vẫn fallback về đường main-thread thay vì mất ảnh.
2. **Cảnh báo CT/JPG 8-bit fail-closed.** Backend công bố `modality`, manifest MPR
   mới ghi rõ MR, catalog suy ra CT/MR từ metadata hoặc đường dẫn và trả
   `UNKNOWN` khi không chắc. UI cảnh báo CT không được dùng mức xám để suy luận
   HU/cửa sổ CT; modality chưa rõ cũng có cảnh báo riêng. Preset chỉ gọi là
   "Mô mềm JPG"/"Tương phản cao", không giả làm brain/bone HU.
3. **Khôi phục annotation theo đúng series và mặt phẳng.** Stack dùng image id +
   series id; MPR dùng `viewPlaneNormal`. Trường hợp nhiều khung mà không chứng
   minh được đích sẽ bỏ qua thay vì đoán. Compare lưu cả series A và B.
4. **Slider lát cho từng khung.** Single/compare/montage và ba mặt phẳng MPR có
   range control riêng; nhãn và status bar cập nhật theo khung đang hoạt động.
5. **Nút panel rõ ràng.** Header có nút "Tải phim" với `aria-expanded`; logo
   không còn là điều khiển ẩn.
6. **Preset hiển thị và reset MPR.** Có Toàn dải/Mô mềm JPG/Tương phản cao.
   "Đặt lại" reset camera/properties và đưa tâm Crosshairs về tâm volume.
7. **Token được xóa khỏi URL.** Sau `configureApi()`, `history.replaceState`
   loại `token` nhưng giữ query/hash khác; smoke yêu cầu `location.search`
   không còn token.
8. **Quét archive chạy nền.** Chọn/quét lại thư mục dùng `JobState`; walker
   dừng sớm trước cây `DICOM`/`RAW_JPG`, hỗ trợ dừng và báo tiến độ. Quét lúc
   khởi động bằng `--archive` vẫn đồng bộ có chủ đích để smoke nhận snapshot
   hoàn chỉnh trước khi mở UI.

### 4.3 Đã rà soát và không có vấn đề

- Backend cục bộ (`web_backend.py`): bind `127.0.0.1` cổng ngẫu nhiên, bearer
  token so sánh bằng `compare_digest`, kiểm tra `Host`/`Origin`, CSP chặt
  (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), series id
  là digest mờ thay vì đường dẫn, chống path traversal bằng `relative_to`, ghi
  annotation kiểu atomic qua `.tmp` + `replace`. Không phát hiện lỗ hổng.
- `validate_mpr_manifest()`: kiểm tra trực chuẩn vector định hướng, đều khoảng
  lát, đủ file, tên file an toàn — chặt và đúng chỗ.
- Đồng bộ montage 6/8 lát và chuyển khung lớn của MPR: cổng smoke xác nhận đúng.
- Escape HTML: mọi nội dung từ tên thư mục/manifest đều qua `escapeHtml()`.

---

## 5. Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| `npm test` (vitest, `webui`) | 8/8 pass — thêm test routing annotation, cảnh báo CT/unknown và preset JPG |
| `python -m unittest discover -s tests -v` (6 module) | 24/24 pass — thêm modality fail-closed, prune raw tree và archive background job |
| `python dcom_web_app.py --smoke-test` (cổng release đầy đủ, có kiểm pixel) | pass — `stage: complete`; Worker decode thật; token rời URL; slider từng khung; reset Crosshairs; preset; mọi khung có pixel; một engine duy nhất |
| `python tools/smoke_webview.py` | pass (trước đây luôn timeout) |
| Đổi MPR↔3D lặp lại, đo pixel | pass ở cả 3 vòng, WebGL context không tăng |

Kết quả cổng release sau khi sửa:

```
compare     lit=[3498, 3498]                          engine=dcom-rendering-engine  tool=window
montage6    lit=[467, 467, 490, 536, 582, 630]        engine=dcom-rendering-engine  tool=window
montage8    lit=[437, 437, 454, 502, 542, 591, 680, 789]
mpr         lit=[3706, 4556, 5408]                    engine=dcom-rendering-engine  tool=crosshair
volume3d    lit=[2453, 3838, 4556, 2243]              engine=dcom-rendering-engine  tool=rotate3d
mpr-again        lit=[3706, 4556, 5408]
volume3d-again   lit=[2453, 3838, 4556, 2243]
mpr-third        lit=[3706, 4556, 5408]
toolState = {'highlighted': ['crosshair'], 'active': 'crosshair'}
```

Lệnh tái lập:

```bash
python tools/create_synthetic_mpr.py <thư-mục-phantom>
cd webui && npm run build && npm test && cd ..
python dcom_web_app.py --smoke-test --archive <thư-mục-phantom> --smoke-result smoke.json
```

---

## 6. Nguyên tắc đã giữ nguyên

- Không hạ chuẩn hình học: MPR/3D vẫn chỉ bật khi `validate_mpr_manifest()` xác
  nhận đủ lát, đều khoảng và vector định hướng trực chuẩn; volume vẫn phải nạp
  **đủ** số lát mới dựng (`Volume không đầy đủ: …` vẫn là lỗi chặn).
- Không suy đoán dữ liệu thiếu: series không có hình học vẫn bị chặn đo vật lý và
  vẫn hiện cảnh báo tương ứng.
- Không đổi giao thức backend, định dạng manifest, hay lược đồ series id.
- Offline-only, token cục bộ, CSP không nới lỏng.
- Mọi thay đổi đều có cổng kiểm tra tự động chạy trên WebView2 thật.
