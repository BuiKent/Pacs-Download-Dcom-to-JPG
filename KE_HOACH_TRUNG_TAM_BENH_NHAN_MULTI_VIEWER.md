# Kế hoạch tách Trung tâm tải phim và Viewer đa cửa sổ

Trạng thái: **Đề xuất kiến trúc, chưa triển khai mã nguồn**

Ngày lập: **06/08/2026**

Phạm vi: giao diện WebView2/Cornerstone của `Dcom to JPG`

## 1. Kết luận ngắn

Phương án này **nên làm và làm được** với kiến trúc hiện tại, nhưng phải tách phiên viewer ở backend trước khi cho phép mở nhiều cửa sổ.

Kiến trúc được khuyến nghị:

1. Chỉ có một **cửa sổ Trung tâm tải & quản lý**.
2. Thanh tải phim bên trái được giữ gần giống hiện tại.
3. Vùng viewer hiện tại được thay bằng **Kho bệnh nhân, danh sách ca chụp, lịch sử và trạng thái tải**.
4. Khi người dùng bấm **Mở viewer**, ứng dụng tạo một **cửa sổ viewer riêng**, ưu tiên mở lớn/maximize và chỉ chứa công cụ xem phim.
5. Có thể mở nhiều cửa sổ viewer cùng lúc, mỗi cửa sổ có phiên dữ liệu và Cornerstone RenderingEngine riêng.
6. Không mở sẵn một cửa sổ viewer trống khi khởi động. Cửa sổ chỉ được tạo khi có ca cần xem; vùng quản lý hiển thị trạng thái “Chọn một ca để mở viewer”.

pywebview hỗ trợ tạo nhiều cửa sổ, kể cả tạo thêm sau khi vòng lặp giao diện đã khởi động. Tài liệu chính thức: [Multiple Windows](https://pywebview.flowrl.com/examples/multiple_windows) và [API `webview.create_window`](https://pywebview.flowrl.com/api/#webviewcreate_window).

## 2. Vì sao nên tách như vậy

Giao diện hiện tại ghép ba vai trò vào cùng một trang:

- tìm và tải phim;
- quản lý lịch sử/thư mục;
- xem ảnh 2D, compare, montage, MPR và 3D.

Khi `render()` thay lại vùng làm việc, viewer phải giữ hoặc dựng lại canvas, camera, công cụ và annotation. Việc tách Trung tâm quản lý khỏi Viewer mang lại các lợi ích:

- Người dùng vẫn tìm hoặc tải bệnh nhân B trong khi đang xem bệnh nhân A.
- Viewer có toàn bộ diện tích cửa sổ, không bị thanh tải phim chiếm chiều ngang.
- Có thể đặt hai ca cạnh nhau bằng Windows Snap hoặc hai màn hình vật lý.
- Lỗi hoặc thao tác đổi layout ở viewer A không được phép thay đổi viewer B.
- Cửa sổ chính không khởi tạo Cornerstone/WebGL khi chỉ dùng để tải và quản lý phim.
- Luồng làm việc gần với File Explorer: tìm ca trong cửa sổ quản lý, mở ca cần xem thành cửa sổ độc lập, quay lại kho phim để mở ca khác.

## 3. Mô hình giao diện đề xuất

### 3.1. Cửa sổ 1 — Trung tâm tải & quản lý

Đây là cửa sổ mở mặc định và chỉ có một bản.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ DICOM/JPG Downloader & Viewer     [Tải phim] [Kho bệnh nhân] [Lịch sử]      │
├───────────────────────┬──────────────────────────────────────────────────────┤
│ TẢI MRI / CT          │ KHO BỆNH NHÂN                                       │
│                       │ [Tìm ID/tên] [BV] [Ngày] [CT/MR] [Trạng thái]        │
│ Mã BN / Bệnh viện     │                                                      │
│ Danh sách ca từ RIS   │ BN 2606033997 · CHƯA RÕ TÊN · BV ...                │
│ Tải ca đã chọn        │   ├─ 2026-08-06 · MR · 12 series · Đã tải           │
│ Link viewer           │   │    [Mở viewer] [Mở thư mục]                     │
│ Thư mục lưu           │   └─ 2026-08-05 · CT · 4 series · Chưa đủ           │
│ Tiến trình / log      │                                                      │
│                       │ Trạng thái: Chọn một ca để mở viewer                 │
└───────────────────────┴──────────────────────────────────────────────────────┘
```

Hành vi chính:

- Thanh tải bên trái giữ các chức năng hiện có: tìm mã bệnh nhân, chọn bệnh viện, tải study, tải link trực tiếp, chọn thư mục lưu, dừng tác vụ và xem log.
- Vùng bên phải không còn tạo canvas viewer.
- Các tab quản lý bên phải gồm:
  - **Kho bệnh nhân**: gom theo bệnh nhân, mở rộng để thấy các study và series.
  - **Lịch sử**: các thư mục vừa tải/vừa mở, đánh dấu thư mục không còn tồn tại.
  - **Đang tải/hoạt động**: có thể là một tab riêng hoặc một bộ lọc trong Kho bệnh nhân.
- Mỗi study có các thao tác trực tiếp:
  - **Mở viewer**: mở toàn bộ series của study trong một cửa sổ mới.
  - **Mở cả bệnh nhân**: tùy chọn nâng cao, cho phép so sánh các study cũ/mới của đúng bệnh nhân đó.
  - **Mở thư mục**: dùng Explorer của Windows.
  - **Quét lại**: cập nhật khi vừa chép thêm file vào thư mục.
- Study `incomplete` không tự động được coi là đủ để xem. Giao diện phải cảnh báo rõ và mặc định chỉ cho mở sau khi người dùng xác nhận hoặc sau khi tải hoàn tất.

### 3.2. Cửa sổ 2 trở đi — Viewer chuyên dụng

Viewer chỉ được tạo khi người dùng mở một study hoặc một hồ sơ bệnh nhân.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2606033997 · CHƯA RÕ TÊN · MR 06/08/2026                  [−] [□] [×]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Series [........]  [2D] [2 khung] [3 khung] [6] [8] [MPR] [3D]  công cụ   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                              VIEWER TOÀN CỬA SỔ                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Patient ID · tên · bệnh viện · ngày chụp · modality · series · số lát       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Nguyên tắc:

- Không có thanh tải phim trong cửa sổ Viewer.
- Giữ toàn bộ chức năng hiện có: single, compare 2/3 series, montage 6/8, MPR, 3D, window preset, pan/zoom, đo, ROI, annotation, cine và lưu ảnh.
- Tiêu đề cửa sổ và dải nhận dạng luôn hiển thị ít nhất Patient ID, tên bệnh nhân nếu có, ngày study và modality để giảm nguy cơ nhầm ca khi mở nhiều cửa sổ.
- Mở một study thì nạp tất cả series thuộc study đó; series được bấm từ Kho bệnh nhân trở thành series đang chọn ban đầu.
- “Mở cả bệnh nhân” là lệnh riêng, không phải hành vi mặc định, vì quét mọi study sẽ chậm và dùng nhiều bộ nhớ hơn.
- Nếu study đang được mở rồi, bấm lại **Mở viewer** sẽ đưa cửa sổ cũ lên trước thay vì tạo bản trùng. Chỉ cho phép mở trùng bằng một lệnh nâng cao có cảnh báo.

## 4. Hiện trạng kỹ thuật cần lưu ý

### 4.1. Những phần có thể tái sử dụng

- `dcom_web_app.py` đang tạo cửa sổ bằng `webview.create_window` và chạy Edge Chromium/WebView2.
- `webui/src/viewer.js` đã giữ đúng một `RenderingEngine` trong một phiên trang, thay viewport khi đổi layout và chỉ dispose khi đóng trang.
- Mỗi cửa sổ WebView2 có JavaScript runtime riêng, nên biến module và `ENGINE_ID = "dcom-rendering-engine"` được cô lập theo cửa sổ.
- `ArchiveCatalog` đã biết quét DICOM trực tiếp, JPG/PNG, manifest MPR và chặn mở một root chứa nhiều manifest bệnh nhân.
- `patient-index.json` đã lưu Patient ID, tên, bệnh viện, các study, folder, trạng thái và thời gian tải; đây là nguồn phù hợp để dựng Kho bệnh nhân.
- `HistoryStore` đã tương thích với lịch sử của giao diện Classic.
- Local API đã dùng token và chỉ lắng nghe `127.0.0.1`.

### 4.2. Điểm chặn bắt buộc phải sửa trước đa cửa sổ

Hiện `WebController` chỉ có:

- một `ArchiveCatalog`;
- một `JobState`;
- một `NativeApi._window`;
- các route `/api/archive` và `/api/series/...` không có mã phiên viewer.

Nếu giữ nguyên kiến trúc này, mở folder B sẽ thay catalog dùng chung. Viewer A sau đó có thể yêu cầu series từ catalog B hoặc nhận lỗi không tìm thấy series. Đây là lỗi cô lập dữ liệu và không được phép xảy ra trong luồng nhiều bệnh nhân.

Do đó, đa cửa sổ không được triển khai bằng cách gọi thêm `webview.create_window` vào mã hiện tại rồi dùng chung mọi route.

## 5. Kiến trúc mục tiêu

```text
                         ┌────────────────────────────┐
                         │ ApplicationController      │
                         │ settings / history         │
                         │ download job / library     │
                         └─────────────┬──────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │ LocalApiServer + token local        │
                    └───────────────┬─────────────────────┘
                                    │
                         ┌──────────┴───────────┐
                         │ ViewerSessionRegistry│
                         └──────┬────────┬──────┘
                                │        │
                 session A      │        │      session B
             ┌──────────────────┘        └──────────────────┐
             │                                               │
┌────────────┴────────────┐                    ┌─────────────┴───────────┐
│ ArchiveCatalog bệnh nhân A│                  │ ArchiveCatalog bệnh nhân B│
│ Viewer window A / engine A│                  │ Viewer window B / engine B│
└───────────────────────────┘                  └────────────────────────────┘
```

### 5.1. ApplicationController

Quản lý trạng thái dùng chung toàn ứng dụng:

- settings và ngôn ngữ;
- output root;
- một hàng đợi tìm/tải phim;
- HistoryStore;
- PatientLibraryIndex;
- danh sách cửa sổ viewer đang mở.

Trong giai đoạn đầu vẫn chỉ cho một tác vụ RIS/download chính chạy tại một thời điểm, đúng với `JobState` hiện tại. Việc mở và xem ca đã tải không được chặn bởi job download.

### 5.2. PatientLibraryIndex

Tạo một lớp chỉ mục cho màn hình Kho bệnh nhân:

- Nguồn sự thật vẫn là từng `patient-index.json` trong folder bệnh nhân.
- Chỉ mục tổng chỉ là cache để mở giao diện nhanh; có thể xóa và dựng lại.
- Khi tải xong một study, backend cập nhật manifest bệnh nhân rồi cập nhật chỉ mục tổng.
- Khi đổi output root hoặc người dùng bấm **Quét lại kho**, chạy quét nền, không chặn UI.
- Ghi JSON theo kiểu file tạm rồi replace để tránh file dở dang khi mất điện/đóng app.
- Không tự gộp hai hồ sơ chỉ dựa trên tên. Khóa nhận dạng tối thiểu tiếp tục gồm bệnh viện và Patient ID; xung đột tên phải được hiển thị và fail closed như hiện tại.

Dữ liệu màn hình cần có:

- Patient ID, PatientName, bệnh viện;
- folder bệnh nhân và trạng thái còn tồn tại;
- từng StudyUID, ngày, modality, description, folder, số ảnh/series;
- `downloaded`, `new`, `incomplete`;
- thời gian tải/mở gần nhất;
- lỗi scan gần nhất nếu có.

### 5.3. ViewerSessionRegistry

Mỗi lần mở viewer tạo một session độc lập:

```text
ViewerSession
  session_id          UUID ngẫu nhiên
  session_key         đường dẫn chuẩn hóa + StudyUID/phạm vi mở
  archive_catalog     ArchiveCatalog riêng
  patient_identity    thông tin hiển thị cố định của cửa sổ
  selected_series_id  series được chọn ban đầu
  window_id           cửa sổ pywebview tương ứng
  created_at
  lifecycle_state     scanning / ready / closing / closed
```

Quy tắc:

- `session_key` dùng để phát hiện study đã mở và focus cửa sổ cũ.
- `session_id` không được lấy từ Patient ID hoặc StudyUID và không được ghi vào lịch sử.
- Khi cửa sổ đóng, registry xóa session sau khi viewer lưu annotation và dispose tài nguyên.
- API của session A không được phép truy cập catalog của session B.
- Sau khi session đóng, mọi request mang session ID cũ phải trả lỗi rõ ràng, không fallback sang catalog gần nhất.

### 5.4. Route API theo phiên

Giữ các API quản lý dùng chung:

```text
/api/app/bootstrap
/api/app/job
/api/app/history
/api/app/library
/api/app/download/...
```

Tách API viewer theo session:

```text
/api/viewer/{sessionId}/bootstrap
/api/viewer/{sessionId}/archive
/api/viewer/{sessionId}/series/{seriesId}/manifest
/api/viewer/{sessionId}/series/{seriesId}/image/{index}
/api/viewer/{sessionId}/series/{seriesId}/annotations
/api/viewer/{sessionId}/close
```

Local token hiện có tiếp tục được kiểm tra trên mọi request. `sessionId` chỉ định phạm vi dữ liệu, không thay thế token xác thực.

### 5.5. WindowManager và NativeApi theo cửa sổ

Trong `dcom_web_app.py` cần một `WindowManager` thay vì giữ duy nhất `NativeApi._window`:

- `open_viewer(study_request)`;
- `focus_viewer(session_key)`;
- `close_viewer(session_id)`;
- `list_open_viewers()`;
- `close_all()` khi ứng dụng thoát.

Mỗi cửa sổ nhận một NativeApi riêng hoặc một bridge chỉ chứa đúng `window_id/session_id` của nó. Dialog, maximize, focus và destroy phải tác động đúng cửa sổ gọi lệnh.

URL dự kiến:

```text
http://127.0.0.1:<port>/?mode=manager&token=<token>
http://127.0.0.1:<port>/?mode=viewer&session=<uuid>&token=<token>
```

Frontend đọc `mode` để chỉ khởi động phần cần thiết. Cửa sổ manager tuyệt đối không import/khởi tạo Cornerstone; cửa sổ viewer không khởi tạo form tải phim.

## 6. Chính sách đa cửa sổ và tài nguyên

### 6.1. Mức hỗ trợ đề xuất

- Mục tiêu nghiệm thu tối thiểu: **hai viewer 2D hoạt động đồng thời**, mỗi viewer mở một bệnh nhân tổng hợp khác nhau.
- Cho phép tối đa mặc định **ba cửa sổ viewer**. Cần benchmark trước khi biến đây thành giới hạn cứng hoặc cho phép cấu hình cao hơn.
- Chỉ cho một tác vụ dựng volume MPR/3D nặng bắt đầu tại một thời điểm; các cửa sổ khác xếp hàng nhưng 2D đang hiển thị vẫn dùng được.
- Cine dừng khi cửa sổ bị ẩn/minimize hoặc mất focus trong thời gian dài.
- Không prefetch toàn bộ nhiều series ở các cửa sổ nền.
- Khi đóng viewer, phải chạy `disposeViewer()` và loại bỏ session/cache tương ứng.

### 6.2. Vì sao không nên mở sẵn viewer trống

- Tạo thêm cửa sổ không mang giá trị trước khi người dùng chọn ca.
- Có thể khởi tạo runtime WebView2 và Cornerstone sớm hơn cần thiết.
- Người dùng dễ nhầm cửa sổ trống là app chưa tải xong.
- Khó xác định viewer trống sẽ thuộc bệnh nhân nào và khó đặt tiêu đề an toàn.

Thay vào đó, cửa sổ chính hiển thị empty state. Nếu sau này đo được thời gian mở viewer quá lâu, có thể thử preload frontend tĩnh nhưng **không tạo RenderingEngine** trước khi có session.

### 6.3. Không tuyên bố hiệu năng trước benchmark

Không đặt trước các tuyên bố như “không thể màn hình đen”, “RAM luôn dưới X GB” hoặc “mở không giới hạn”. Mỗi cửa sổ có engine/cache ảnh riêng và MPR/3D có thể nạp hàng trăm lát. Giới hạn thực tế phải được đo trên máy đích với dữ liệu tổng hợp và các bộ DICOM nhiều kích thước.

## 7. An toàn dữ liệu và chống nhầm bệnh nhân

Các điều kiện bắt buộc:

1. Mỗi cửa sổ chỉ nhận dữ liệu từ đúng ViewerSession của nó.
2. Tiêu đề/dải identity của viewer luôn hiện Patient ID, tên, bệnh viện, study date và modality khi có.
3. Root chứa nhiều bệnh nhân tiếp tục bị từ chối, không tự chọn bệnh nhân đầu tiên.
4. Không tự gộp bệnh nhân chỉ vì trùng tên hoặc trùng một phần mã.
5. Study đang tải không được âm thầm mở như một study hoàn chỉnh.
6. Khi một folder bị xóa hoặc di chuyển, Kho bệnh nhân ghi `missing` và yêu cầu định vị/quét lại; không trỏ sang folder có tên gần giống.
7. Hai cửa sổ không được ghi đè annotation của cùng một series.
8. Nếu cùng study đã mở, mặc định focus cửa sổ cũ. Nếu sau này cho mở trùng, cần khóa ghi hoặc optimistic version/ETag cho annotation; cửa sổ thứ hai có thể phải ở chế độ chỉ đọc.
9. Việc đóng cửa sổ phải lưu annotation hiện có trước, nhưng nếu lưu lỗi phải cảnh báo thay vì giả vờ đóng an toàn.
10. Tất cả dữ liệu tiếp tục phục vụ local-only; không đưa Patient ID/PatientName vào dịch vụ ngoài.

## 8. Lộ trình triển khai theo lát nhỏ

### Giai đoạn 0 — Khóa hành vi và tạo dữ liệu thử

- Chốt wireframe và nhãn tiếng Việt/Anh.
- Tạo hai bộ DICOM tổng hợp, không có thông tin bệnh nhân thật, mỗi bộ có nhiều series.
- Ghi lại smoke hiện tại cho single, compare, montage, MPR và 3D làm baseline.
- Chốt hành vi khi bấm lại study đã mở, khi đóng cửa sổ chính và khi download đang chạy.

Điều kiện qua giai đoạn: chưa đổi luồng production; baseline có canvas pixel thật, không chỉ kiểm tra DOM.

### Giai đoạn 1 — Tách frontend Manager và Viewer, vẫn một cửa sổ

- Tách `webui/src/main.js` thành các module có trách nhiệm rõ:
  - shell/router theo `mode`;
  - download panel;
  - patient library/history;
  - viewer page;
  - trạng thái/ngôn ngữ dùng chung.
- Cửa sổ manager không gọi `initViewer()`.
- Cửa sổ viewer tái sử dụng `viewer.js`, không hiển thị download panel.
- Chưa mở nhiều cửa sổ; dùng một viewer session thử nghiệm để chứng minh hai chế độ không phụ thuộc DOM của nhau.

Điều kiện qua giai đoạn: mọi test viewer hiện tại còn pass; manager không tạo canvas/WebGL.

### Giai đoạn 2 — PatientLibraryIndex và giao diện Kho bệnh nhân

- Đọc `patient-index.json` từ output root trong tác vụ nền.
- Dựng API danh sách bệnh nhân/study và bộ lọc.
- Hiển thị trạng thái `downloaded/new/incomplete/missing/conflict`.
- Thêm **Mở viewer**, **Mở thư mục**, **Quét lại**.
- Giữ HistoryStore làm nguồn lịch sử thao tác, không dùng lịch sử thay cho hồ sơ bệnh nhân.

Điều kiện qua giai đoạn: quét kho nhiều bệnh nhân không trộn dữ liệu; UI vẫn phản hồi trong lúc scan.

### Giai đoạn 3 — Session hóa backend viewer

- Tách trạng thái app dùng chung khỏi trạng thái catalog viewer.
- Thêm `ViewerSessionRegistry`.
- Chuyển route ảnh/manifest/annotation sang route có `sessionId`.
- Thêm test session A/B song song và test request chéo bị từ chối.
- Giữ API cũ tạm thời sau feature flag nếu cần rollback, sau đó xóa khi migration hoàn tất.

Điều kiện qua giai đoạn: mở catalog A rồi B không làm snapshot hoặc ảnh của A thay đổi.

### Giai đoạn 4 — WindowManager và nhiều cửa sổ WebView2

- Thêm bridge `open_viewer` từ Kho bệnh nhân.
- Tạo cửa sổ Viewer bằng `webview.create_window` sau khi GUI loop đã chạy.
- Gắn NativeApi đúng cửa sổ và session.
- Đặt title, kích thước/maximize và vị trí màn hình hợp lý.
- Focus cửa sổ cũ nếu study đã mở.
- Dọn session khi nhận sự kiện `closed`; không dừng LocalApiServer khi chỉ một viewer đóng.
- Khi đóng cửa sổ Trung tâm, hỏi/xử lý rõ nếu còn download hoặc viewer đang mở; tiến trình chỉ kết thúc sau khi các cửa sổ được đóng an toàn.

Điều kiện qua giai đoạn: hai viewer khác bệnh nhân hiển thị đồng thời và đóng một cửa sổ không ảnh hưởng cửa sổ còn lại.

### Giai đoạn 5 — Điều phối tài nguyên và annotation

- Hàng đợi cho tác vụ dựng MPR/3D nặng.
- Pause cine/prefetch ở cửa sổ nền.
- Khóa hoặc version hóa ghi annotation theo series.
- Đo RAM, GPU context, thời gian mở, thời gian đóng và khả năng thu hồi tài nguyên.
- Thêm thông báo khi đạt giới hạn cửa sổ hoặc tài nguyên không đủ.

Điều kiện qua giai đoạn: không có canvas đen, không ghi chéo annotation, không tăng tài nguyên vô hạn sau chuỗi mở/đóng lặp lại.

### Giai đoạn 6 — Hoàn thiện và đóng gói sau cùng

- Hoàn thiện phím tắt, menu chuột phải, Windows Snap và đa màn hình.
- Cập nhật `HUONG_DAN.md`.
- Chạy toàn bộ test Python, Vitest, build frontend và smoke WebView2 đa cửa sổ.
- Chỉ build EXE khi người dùng yêu cầu sau khi debug nguồn hoàn tất.

## 9. Các file dự kiến bị tác động khi triển khai

| File/khu vực | Thay đổi dự kiến |
|---|---|
| `dcom_web_app.py` | WindowManager, NativeApi theo cửa sổ, lifecycle nhiều window |
| `web_backend.py` | ApplicationController, PatientLibraryIndex, ViewerSessionRegistry, route theo session |
| `webui/src/main.js` | Tách entry/router; không tiếp tục để một file sở hữu cả download và viewer |
| `webui/src/viewer.js` | Giữ engine theo cửa sổ; thêm hook pause/resume/resource status nếu cần |
| `webui/src/styles.css` | Layout Trung tâm quản lý và viewer toàn cửa sổ |
| `webui/src/i18n.js` | Nhãn Kho bệnh nhân, trạng thái session/window và cảnh báo |
| `tests/test_web_backend.py` | Cô lập session và route |
| `tests/test_web_history.py` | Lịch sử missing/moved và không dùng thay registry |
| `tests/test_patient_archive.py` | Dữ liệu index bệnh nhân và xung đột identity |
| `tests/test_webview_bridge.py` | Bridge mở/focus/đóng đúng cửa sổ |
| `tools/smoke_webview.py` | Hai cửa sổ, pixel probe độc lập, đóng/mở lặp lại |
| `HUONG_DAN.md` | Hướng dẫn Trung tâm quản lý và đa cửa sổ |

Tên file/module mới chỉ là gợi ý và có thể điều chỉnh sau khi bắt đầu refactor.

## 10. Ma trận kiểm thử bắt buộc

### 10.1. Backend/unit

- Tạo session A và B với hai root khác nhau.
- Series ID của A chỉ truy cập được qua A; yêu cầu bằng session B phải fail.
- Đóng A không xóa hoặc đổi catalog của B.
- Bấm mở lại cùng `session_key` trả về cửa sổ đã có.
- PatientLibraryIndex rebuild được từ manifest khi cache tổng bị xóa/hỏng.
- Folder missing không được tự ánh xạ sang folder tên gần giống.
- Download job đang chạy không bị viewer scan ghi đè `JobState`.
- Annotation hai session khác series không ảnh hưởng nhau.
- Cùng series mở trùng tuân thủ đúng chính sách focus/readonly/lock.

### 10.2. Frontend/Vitest

- `mode=manager` không gọi `initViewer`.
- `mode=viewer` không render form RIS/download.
- Bộ lọc bệnh nhân không làm mất trạng thái job/log.
- Nút **Mở viewer** gửi đúng folder, StudyUID và selected series.
- Identity banner không mất khi đổi layout/ngôn ngữ.
- Study incomplete/missing/conflict hiển thị đúng và chặn đúng thao tác.

### 10.3. WebView2 smoke với pixel thật

1. Mở cửa sổ manager: không có canvas viewer.
2. Mở bệnh nhân tổng hợp A ở viewer A: single có pixel sáng hợp lệ.
3. Mở bệnh nhân tổng hợp B ở viewer B: single có pixel sáng hợp lệ.
4. Chuyển A sang compare/MPR; B phải giữ nguyên series, lát và camera.
5. Chuyển B sang montage/3D; A không bị mất engine hoặc canvas.
6. Đóng A; B tiếp tục scroll, đo và lưu annotation được.
7. Mở lại A; annotation đúng series được phục hồi.
8. Lặp mở/đóng nhiều lần để phát hiện rò WebGL/cache/process.
9. Xác minh tiêu đề và identity banner của A/B không bị tráo.
10. Chạy thử song song với một download đang hoạt động.

Không công nhận kết quả chỉ dựa trên DOM, trạng thái engine hoặc số viewport. Mỗi layout phải có pixel probe để phát hiện canvas đen.

## 11. Tiêu chí nghiệm thu chức năng

- App khởi động vào Trung tâm tải & quản lý, không mở viewer trống ngoài ý muốn.
- Người dùng tìm/tải phim bằng thanh trái như hiện tại.
- Kho bệnh nhân hiển thị đúng các patient manifest đã có trên đĩa.
- Bấm một study mở viewer toàn cửa sổ với đúng bệnh nhân và tất cả series của study.
- Có thể mở ít nhất hai bệnh nhân trong hai cửa sổ và dùng 2D đồng thời.
- Thao tác, series, annotation, camera và lỗi của viewer A không làm đổi viewer B.
- MPR/3D được điều phối theo chính sách tài nguyên và báo tiến trình rõ ràng.
- Đóng một viewer giải phóng session mà không dừng app hoặc download.
- Không trộn bệnh nhân, không mở nhầm folder, không coi phim thiếu là phim hoàn chỉnh.
- Toàn bộ unit test, frontend test, build và WebView2 multi-window pixel smoke đều pass.

## 12. Các quyết định nên giữ cố định

1. **Một cửa sổ quản lý, nhiều cửa sổ viewer theo nhu cầu.**
2. **Không tạo viewer trống khi startup.**
3. **Mặc định một study cho mỗi viewer; “mở cả bệnh nhân” là lệnh riêng.**
4. **Cùng study thì focus cửa sổ cũ, không âm thầm mở bản trùng.**
5. **Mỗi viewer có ArchiveCatalog/session riêng; settings, history và download dùng chung.**
6. **Kho bệnh nhân đọc từ patient manifest; lịch sử không phải cơ sở dữ liệu bệnh nhân.**
7. **Mở nhiều 2D được ưu tiên; MPR/3D phải có điều phối và benchmark.**
8. **Không build EXE trong các giai đoạn debug nếu chưa có yêu cầu riêng.**

## 13. Đánh giá cuối

Đây là hướng nâng cấp hợp lý cho app vì nó tách rõ “quản lý/tải” khỏi “đọc phim”, làm việc đa bệnh nhân nhanh hơn và tận dụng tốt nhiều màn hình. Phần tạo nhiều cửa sổ không khó nhất; phần quan trọng nhất là **cô lập catalog, API, annotation và vòng đời GPU theo từng viewer session**.

Nếu triển khai đúng theo các giai đoạn trên, có thể giữ lại gần như toàn bộ viewer Cornerstone hiện có mà không phải viết lại engine. Không nên triển khai bằng một thay đổi lớn duy nhất; mỗi giai đoạn cần có test cô lập và smoke WebView2 trước khi chuyển sang giai đoạn kế tiếp.
