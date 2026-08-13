
## v2.1 — Slow portal / token bootstrap

- Nhận diện các portal dạng `?token=...` (ví dụ patient portal cổng riêng) là bootstrap shell thay vì trang thường.
- Không tự reload portal token khi UI đang tải chậm.
- Theo dõi `readyState` + số resource để chỉ timeout khi trang thực sự đã im; hard timeout tối đa 180 giây cho slow portal.
- Giữ tối đa 80 URL API gần nhất trong bộ nhớ phiên để chẩn đoán endpoint vendor lạ; không ghi chúng vào History.

# PACS DICOM Downloader 2.0.0

Chrome Extension standalone để tải DICOM trực tiếp từ PACS đang mở. Không cần Python/native app.

## Cài đặt

1. Giải nén thư mục extension.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa bản cũ nếu đang dùng, sau đó **Load unpacked** và chọn thư mục này.
5. Pin `PACS DICOM Downloader` lên toolbar.

> v2 dùng host access HTTP/HTTPS ở mức extension để bắt network của PACS ngay từ khi wrapper/iframe khởi tạo. Listener chỉ ghi nhận URL có dấu hiệu PACS/DICOM; history không lưu token/share URL.

## Workflow

1. Mở study PACS trong Chrome.
2. Mở side panel của extension.
3. Nếu manifest đã xuất hiện, study tự phân tích. Nếu chưa, bấm **Phân tích study hiện tại**.
4. Extension sẽ tự tìm wrapper/iframe/viewer thật; khi cần sẽ reload đúng 1 lần để bắt network từ đầu.
5. Chọn series và bấm **Tải DICOM**.

Folder mẹ:

`Downloads/PACS_DICOM/Tên bệnh nhân - Patient ID - Ngày chụp/`

Ngày là Study Date của PACS/DICOM, không phải ngày tải.

## Adapter

### VRAD / VradViewer
- `StudyData/GetStudies`
- `GetImage` DICOM
- signature/imageObjKey từ manifest
- tải original DICOM bằng `chrome.downloads.download()` thay vì `fetch()` offscreen
- fallback ImageBaseUrl khi chưa thấy GetImage template

### VRPACS / telerad
- `get-share-patient-image`
- imageIds `wadouri:` / `wadors:` / `dicomweb:`
- direct HTTP download bằng Chrome Downloads

### DICOMweb
- QIDO series / instances
- WADO-URI
- WADO-RS multipart
- `/metadata + /frames/N`
- dựng lại DICOM Part-10 khi PACS chỉ phát frames

## Wrapper RIS / iframe

v2 quét:
- `webNavigation.getAllFrames()`
- navigation của subframe
- `iframe/src`, `frame/src`, `embed/src`, `object/data`, `form/action`
- resource timing của tất cả frame mà Chrome cho phép
- URL viewer có trong inline script

Điều này dành cho các URL kiểu `/ris/vrViewer?...`, nơi trang ngoài chỉ là launcher và viewer thật nằm trong iframe.

## State & History

- Study/series hiện tại chỉ tồn tại theo tab + document/study hiện tại.
- Đổi tab, đổi URL hoặc đổi study: UI cũ bị xóa ngay.
- Chỉ `History` persist trong `chrome.storage.local`.
- History lưu metadata tối thiểu: tên, ID, Study Date, số series, adapter và trạng thái tải; không lưu token/share URL.

## Download strategy

- Original DICOM URL: Chrome Downloads trực tiếp, retry tối đa 3 lần.
- DICOMweb cần inspect/reconstruct: offscreen document fetch multipart/metadata/frames, tạo Blob DICOM rồi giao Chrome Downloads.
- Job có cancel, progress và tối đa 3 worker song song.

## Privacy

- Không cloud.
- Không native messaging.
- Không `chrome.debugger`.
- Không gửi DICOM/metadata ra server trung gian.
- Extension có host permission rộng để bắt cross-origin iframe/PACS ngay từ page load; code chỉ lưu network entry khi URL khớp mẫu PACS/DICOM.

## Các lỗi v2 sửa so với 1.1

- Study cũ không còn treo khi đổi tab/study.
- Theo dõi subframe/iframe thật của RIS wrapper.
- Tự reload đúng 1 lần nếu manifest đã trôi qua trước khi panel mở.
- Auto-analyze khi manifest xuất hiện muộn.
- VRAD không còn bắt buộc offscreen `fetch()` từng DICOM, tránh lỗi `Failed to fetch` hàng loạt do CORS/session context.
- Folder mẹ: `Tên - ID - Ngày`.
- History tách khỏi current UI.
