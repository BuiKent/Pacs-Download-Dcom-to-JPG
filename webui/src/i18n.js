// Vietnamese is the source language: every string in the UI is written in
// Vietnamese and looked up here when English is active. A missing key falls
// back to the Vietnamese text, so an untranslated string degrades to readable
// output instead of an empty label.

let language = "en";

export function setLanguage(value) {
  language = value === "vi" ? "vi" : "en";
  return language;
}

export function getLanguage() {
  return language;
}

const EN = {
  // Header, layout and shell
  "DICOM/JPG Downloader & Viewer": "DICOM/JPG Downloader & Viewer",
  Series: "Series",
  "So sánh với": "Compare with",
  "Và với": "And with",
  "So sánh ba series cạnh nhau": "Compare three series side by side",
  "Đang khoá cuộn theo vị trí — bấm để cuộn từng khung riêng":
    "Scroll is locked by position — click to scroll each pane on its own",
  "Cuộn từng khung riêng — bấm để khoá theo độ lệch hiện tại":
    "Each pane scrolls on its own — click to lock them at the current offset",
  "Đã khoá cuộn theo vị trí hiện tại: {}.": "Scroll locked at the current position: {}.",
  "Đã bỏ khoá: mỗi khung cuộn riêng.": "Unlocked: each pane scrolls on its own.",
  "Thu gọn khu tải phim": "Collapse download panel",
  "Mở khu tải phim": "Expand download panel",
  "Tải phim": "Download",
  "Mở folder DICOM hoặc JPG/PNG trong viewer": "Open a DICOM or JPG/PNG folder in the viewer",
  "Quét lại thư mục hiện tại": "Rescan the current folder",
  "Khởi động lại bằng --classic": "Restart with --classic",
  "Chuyển sang tiếng Anh": "Switch to Vietnamese",
  "Lịch sử": "History",
  "Mở lại thư mục đã tải hoặc đã xem": "Reopen a downloaded or previously viewed folder",
  "Chưa có lịch sử": "No history yet",
  "(thư mục không còn)": "(folder is gone)",

  // Download panel
  "TẢI MRI / CT": "DOWNLOAD MRI / CT",
  "Tính năng xuất JPG riêng; không dùng để mở DICOM trong viewer.":
    "A separate JPG export feature; not the way to open DICOM in the viewer.",
  "Chuyển Dcom → JPG": "Convert DICOM → JPG",
  "Mã bệnh nhân": "Patient code",
  "Tìm ca": "Find studies",
  "Tìm các ca MRI/CT của mã bệnh nhân này trên RIS": "Search RIS for this patient's MRI/CT studies",
  "Hoặc dán link viewer": "Or paste a viewer link",
  "Link viewer": "Viewer link",
  "Xóa mã bệnh nhân": "Clear the patient code",
  "Xóa link viewer": "Clear the viewer link",
  "Chuyển Dcom → JPG": "Convert DICOM → JPG",
  "Chất lượng JPG (70-100)": "JPG quality (70-100)",
  "Tải tất cả file": "Download all files",
  "Hiện trình duyệt tải": "Show the download browser",
  "Quét danh sách series": "Scan series list",
  "Chọn tất cả series": "Select all series",
  "Bỏ chọn tất cả series": "Deselect all series",
  "Bỏ chế độ tải tất cả, sau đó quét để chọn T1, T2, FLAIR hoặc series cụ thể.":
    "Turn off download all, then scan to choose T1, T2, FLAIR, or an exact series.",
  "Hãy chọn ca chụp hoặc nhập link viewer trước khi quét series.":
    "Select a study or enter a viewer link before scanning series.",
  "Hãy tích ít nhất một ngày chụp trước khi quét series.":
    "Tick at least one study date before scanning series.",
  "Đang quét danh sách series; chưa tải file ảnh…":
    "Scanning the series list; no image files are being downloaded…",
  "Đã quét {} nhóm series; hãy bỏ tích những series không muốn tải.":
    "Scanned {} series groups; untick the series you do not want.",
  "Chưa quét hoặc chưa chọn series cho link viewer.":
    "The viewer link has not been scanned or no series is selected.",
  ảnh: "images",
  Khác: "Other",
  "T1 sau tiêm": "Post-contrast T1",
  "Tưới máu": "Perfusion",
  "Mạch máu": "Angiography",
  "Thư mục lưu": "Storage folder",
  "Đổi thư mục lưu": "Change the storage folder",
  "Tải ca đã chọn": "Download selected",
  "Tải các ca đang tích ở danh sách trên": "Download the studies ticked above",
  "Tải link": "Download link",
  "Tải mới từ link đã dán vào một folder riêng": "Download the pasted link into a new folder",
  "Thử lại": "Retry",
  "Thử lại link vừa dán và gộp vào folder cũ, bỏ qua ảnh đã có":
    "Retry the pasted link, merging into the existing folder and skipping images already downloaded",
  "Dừng": "Stop",
  "Dừng an toàn tác vụ đang chạy": "Safely stop the running task",
  "Chưa tìm ca chụp.": "No studies found yet.",
  "Đã tải": "Downloaded",
  "Đã tải series đã chọn": "Selected series downloaded",
  "Tải chưa hoàn tất": "Incomplete",
  "Phim mới": "New study",

  // Patient status
  "Không tự động gộp bệnh nhân": "Automatic patient merge blocked",
  "Mã {} đã lưu tên “{}”, nhưng RIS trả “{}”. Hãy kiểm tra lại.":
    "Code {} is stored under the name “{}”, but RIS returned “{}”. Please re-check.",
  "RIS chưa trả tên bệnh nhân. App vẫn có thể tải nhưng folder sẽ ghi CHUA_RO_TEN; hãy kiểm tra tên trên RIS/DICOM.":
    "RIS did not return a patient name. The download still works but the folder will be named CHUA_RO_TEN; check the name in RIS/DICOM.",
  "Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất":
    "Already in the archive · {} downloaded · {} new · {} incomplete",
  "{} ca chưa có trong kho; app sẽ tạo một folder bệnh nhân.":
    "{} studies are not in the archive yet; a patient folder will be created.",
  "Đã nhận diện {} ca từ folder Classic cũ": "Recognised {} studies from an old Classic folder",
  "{} ca đã tải theo series được chọn": "{} studies downloaded as selected series",

  // Toolbar
  "Một khung ảnh": "Single pane",
  "So sánh hai series cạnh nhau": "Compare two series side by side",
  "Xem tuần tự 6 lát": "View 6 consecutive slices",
  "Xem tuần tự 8 lát": "View 8 consecutive slices",
  "MPR ba mặt phẳng": "Three-plane MPR",
  "Series không đủ MPR": "Series cannot support MPR",
  "Dựng volume 3D toàn màn hình": "Full-screen 3D volume rendering",
  "Series không đủ 3D": "Series cannot support 3D",
  "Hiển thị": "Display",
  "DICOM mặc định": "DICOM default",
  "Toàn dải": "Full range",
  "Cửa sổ rộng": "Wide window",
  "Mô mềm JPG": "JPG soft tissue",
  "Cửa sổ hẹp": "Narrow window",
  "Tương phản cao": "High contrast",
  "Cửa sổ hiển thị trên pixel DICOM gốc": "Display window over original DICOM pixels",
  "Preset thị giác trên dữ liệu ảnh 8-bit": "Visual preset over 8-bit image data",
  "Cửa sổ Hounsfield chuẩn, tính trực tiếp trên pixel CT gốc":
    "Standard Hounsfield windows, computed directly on original CT pixels",
  "Cửa sổ hiển thị trên pixel DICOM gốc, quy chiếu theo WC/WW trong file":
    "Display window over original DICOM pixels, scaled from the file's own WC/WW",
  "Não": "Brain",
  "Đột quỵ / hố sau": "Stroke / posterior fossa",
  "Máu tụ dưới màng cứng": "Subdural",
  "Xương": "Bone",
  "Xương thái dương": "Temporal bone",
  "Định vị MPR": "MPR crosshair",
  "Xoay khối 3D tự do": "Orbit the 3D volume",
  "Ghi chú chữ lên ảnh": "Add a text note",
  "Nội dung ghi chú": "Note text",
  "Thêm": "Add",
  "Bỏ": "Cancel",
  "Lật dọc khung đang chọn": "Flip the active pane vertically",
  "Xóa mọi phép đo, ROI và ghi chú": "Clear every measurement, ROI and note",
  "Lưu đo/ROI/ghi chú": "Save measurements, ROIs and notes",
  "Khung đang xem không đảo màu được.": "The current pane cannot be inverted.",
  "Di chuyển": "Pan",
  "Thu/phóng": "Zoom",
  "Sáng/tương phản": "Window level",
  "Đo chiều dài (mm)": "Measure length (mm)",
  "Đo chiều dài (pixel)": "Measure length (pixels)",
  "Đo góc": "Measure angle",
  "ROI ellipse": "Ellipse ROI",
  "ROI tự do": "Freehand ROI",
  "Đặt lại ba mặt phẳng": "Reset all three planes",
  "Đặt lại góc nhìn": "Reset the camera",
  "Đặt lại hiển thị": "Reset the display",
  "Xóa tất cả đo dài, đo góc và ROI": "Clear every length, angle and ROI measurement",
  "Xoay khung đang chọn 90° theo chiều kim đồng hồ": "Rotate the active pane 90° clockwise",
  "Lật ngang khung đang chọn": "Flip the active pane horizontally",
  "Lưu ảnh 3D": "Save the 3D image",
  "Lưu ảnh": "Save image",
  "Lưu đo/ROI": "Save measurements/ROIs",
  "Tính thể tích ROI": "Compute ROI volume",
  "Đảo màu": "Invert",
  "Chạy phim": "Play cine",
  "Dừng chạy phim": "Stop cine",
  "Xem danh sách phím tắt": "Show the keyboard shortcuts",

  // Workspace and status
  "Mở folder DICOM hoặc JPG/PNG": "Open a DICOM or JPG/PNG folder",
  "DICOM được đọc trực tiếp với pixel gốc; không tạo JPG trung gian. Geometry hợp lệ sẽ bật MPR/3D.":
    "DICOM is read directly at original pixel depth with no intermediate JPG. Valid geometry enables MPR/3D.",
  "Mở folder trong viewer": "Open a folder in the viewer",
  "Đang khởi động...": "Starting up...",
  "Đang dựng khung xem…": "Building the layout…",
  "Đang mở ảnh…": "Opening images…",
  "Không mở được khung xem": "Could not open the layout",
  "An toàn hiển thị": "Display safety",
  "DICOM multi-frame: viewer hiện chỉ hiển thị khung đầu tiên; không dùng MPR/3D cho series này.":
    "Multi-frame DICOM: the viewer currently shows only the first frame; do not use MPR/3D for this series.",
  "khung": "frames",
  "chỉ đồng bộ các cặp tương thích; mặt phẳng khác hướng giữ lát độc lập":
    "only compatible pairs are synchronized; differently oriented planes remain independent",
  "Hai mặt phẳng giữ lát độc lập; đường tham chiếu biểu diễn giao tuyến 3D.":
    "The two planes remain independently scrollable; the reference line shows their 3D intersection.",
  "Không khoá cuộn vì hai series khác hệ tọa độ (Frame of Reference).":
    "Scroll lock is unavailable because the two series use different Frames of Reference.",
  "Không khởi động được DICOM/JPG Downloader & Viewer":
    "Could not start DICOM/JPG Downloader & Viewer",
  "Tải lại": "Reload",
  "Thiếu token phiên local.": "The local session token is missing.",
  "Sẵn sàng. Nhấn ⌨ trên thanh công cụ để xem phím tắt.":
    "Ready. Click ⌨ on the toolbar for the keyboard shortcuts.",
  "📁 Ca chụp chưa phân loại": "📁 Unsorted study",
  "lát": "slices",

  // Action feedback
  "Đang nhận diện DICOM hoặc JPG/PNG trong folder…":
    "Identifying DICOM or JPG/PNG files in the folder…",
  "Đang đọc và chuyển folder DICOM local…": "Reading and converting the local DICOM folder…",
  "Đang quét lại thư mục phim trong nền…": "Rescanning the image folder in the background…",
  "Đã đổi kho lưu; hãy tìm lại mã bệnh nhân để đối chiếu phim cũ/mới.":
    "Storage root changed; search the patient code again to re-check old and new studies.",
  "Chọn thư mục cần chạy trong ứng dụng WebView2.":
    "Choosing a folder requires the WebView2 application.",
  "Nhập DICOM local cần chạy trong ứng dụng WebView2.":
    "Importing local DICOM requires the WebView2 application.",
  "Chế độ classic chỉ có trong ứng dụng desktop.":
    "Classic mode is only available in the desktop application.",
  "Tên bệnh nhân không khớp; app đã chặn tự động gộp.":
    "The patient name does not match; the automatic merge was blocked.",
  "Không có phim mới/chưa hoàn tất được chọn để tải.":
    "No new or incomplete study is selected for download.",
  "Chưa chọn khung ảnh để xoay.": "No pane is selected to rotate.",
  "Chưa chọn khung ảnh để lật.": "No pane is selected to flip.",
  "Chưa có link viewer để tải.": "There is no viewer link to download.",
  "Không lưu được phép đo trước khi đổi khung xem.":
    "Could not save measurements before changing the layout.",
  "Khung xem hiện tại không có phép đo/ROI để xóa.":
    "The current layout has no measurements or ROIs to clear.",
  "Chưa chọn mục lịch sử.": "No history entry is selected.",
  "Đang mở lại thư mục từ lịch sử…": "Reopening the folder from history…",
  "Đã xóa {} phép đo/ROI.": "Cleared {} measurements/ROIs.",
  "Đã lưu {} phép đo/ROI.": "Saved {} measurements/ROIs.",
  'Đã lưu ảnh PNG của khung "{}".': 'Saved a PNG of the "{}" pane.',
  "Thể tích ROI thủ công: {} mL (tổng diện tích lát × khoảng cách lát).":
    "Manual ROI volume: {} mL (sum of slice areas × slice spacing).",
  "Đang dựng MPR từ {} lát…": "Building MPR from {} slices…",
  "Đang dựng mô hình 3D từ {} lát…": "Building the 3D model from {} slices…",

  // Safety notices raised by the viewer
  "CT đã chuyển sang JPG 8-bit: chỉ dùng xem hình thái và đo hình học; không dùng mức xám để suy luận HU hay cửa sổ CT chẩn đoán.":
    "This CT was converted to 8-bit JPG: use it for morphology and geometric measurement only. Do not infer HU values or diagnostic CT windows from its grey levels.",
  "Chưa xác định được modality của series JPG 8-bit; không dùng mức xám để định lượng tín hiệu hoặc đậm độ.":
    "The modality of this 8-bit JPG series is unknown; do not use its grey levels to quantify signal or density.",

  // Error hints
  "Hết bộ đệm ảnh. Hãy đóng series khác hoặc chọn series ít lát hơn rồi thử lại.":
    "The image cache is full. Close another series or pick one with fewer slices, then try again.",
  "Mất kết nối tới dịch vụ nội bộ của ứng dụng. Hãy khởi động lại ứng dụng.":
    "Lost the connection to the application's local service. Restart the application.",
  "Trình kết xuất GPU gặp sự cố. Hãy khởi động lại ứng dụng; nếu lặp lại, cập nhật driver card đồ họa.":
    "The GPU renderer failed. Restart the application; if it repeats, update your graphics driver.",
  "chi tiết": "details",

  "Phím tắt: ←/→ hoặc PgUp/PgDn đổi lát · Home/End lát đầu/cuối · 1 sáng · 2 pan · 3 zoom · 4 đo dài · 5 góc · 6 ROI ellipse · 7 ROI tự do · 8 ghi chú chữ · C định vị · R đặt lại · I đảo màu · Space chạy phim · S lưu đo · P lưu ảnh.":
    "Shortcuts: ←/→ or PgUp/PgDn change slice · Home/End first/last slice · 1 window · 2 pan · 3 zoom · 4 length · 5 angle · 6 ellipse ROI · 7 freehand ROI · 8 text note · C crosshair · R reset · I invert · Space cine · S save measurements · P save image.",
};

export function t(text) {
  if (language === "vi") return text;
  return EN[text] ?? text;
}

/** Translate `text`, then substitute each `{}` with the next argument. */
export function tf(text, ...values) {
  let index = 0;
  return t(text).replace(/\{\}/g, () => (index < values.length ? String(values[index++]) : "{}"));
}

// Pipeline log lines arrive already formatted in Vietnamese from the shared
// Python pipeline, so English users get them rewritten by pattern. Ported from
// the classic app's `_translate_log_pattern`.
const LOG_PATTERNS = [
  [/Lần đầu chạy trên máy này: đang tải nhân trình duyệt Chromium \(~150MB, chỉ 1 lần\)\.\.\./g,
    "First run on this machine: downloading the Chromium browser engine (~150MB, one time)..."],
  [/Đã tải xong Chromium\./g, "Chromium downloaded successfully."],
  [/Không tự tải được Chromium \((.+)\)\. Hãy chạy thủ công: python -m playwright install chromium/g,
    "Could not auto-download Chromium ($1). Please run manually: python -m playwright install chromium"],
  [/Thử lại: đã có sẵn (\d+) ảnh trong folder — sẽ bổ sung ảnh mới, bỏ trùng\./g,
    "Retry: found $1 existing images in the folder — new images will be appended and duplicates skipped."],
  [/ {2}\.\.\.đã tải (\d+) ảnh \(DICOM: (\d+)\)/g, "  ...downloaded $1 images (DICOM: $2)"],
  [/Đang mở trình duyệt ảo \(Chromium\)\.\.\./g, "Opening the virtual browser (Chromium)..."],
  [/Công cụ nền: (.+) \(dòng này chỉ báo trình duyệt tự động, không báo đăng nhập\)\./g,
    "Background tool: $1 (this line reports browser automation, not a new sign-in)."],
  [/\[(\d+)\/(\d+)\] Đang đọc series ngày (.+)\.\.\./g,
    "[$1/$2] Reading series for $3..."],
  [/>>> LỊCH SỬ: mở lại (.+)/g, ">>> HISTORY: reopened $1"],
  [/Đang tải trang viewer \(không chỉnh sửa link\)\.\.\./g,
    "Loading the viewer page (link left unmodified)..."],
  [/ {2}Cảnh báo khi tải trang: (.+)/g, "  Warning while loading the page: $1"],
  [/!!! Link đã HẾT HẠN \(urlExpired\)\. Hãy lấy link mới từ trang xem rồi thử lại\./g,
    "!!! The link has EXPIRED (urlExpired). Get a new link from the viewer page and try again."],
  [/!!! Link đã HẾT HẠN \/ SESSION không còn hiệu lực \(server trả (.+)\)\. Hãy lấy LINK MỚI từ trang xem rồi tải lại NGAY \(loại link này sống rất ngắn\)\./g,
    "!!! The link has EXPIRED / the SESSION is no longer valid (server returned $1). Get a NEW link from the viewer page and retry IMMEDIATELY (these links are very short-lived)."],
  [/DICOMweb: (\d+) series\. Đang liệt kê ảnh\.\.\./g, "DICOMweb: $1 series. Listing images..."],
  [/DICOMweb: (\d+) series, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\./g,
    "DICOMweb: $1 series, $2 images. Downloading directly (6 parallel threads)..."],
  [/DICOMweb: (\d+) series ảnh đã chọn, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\./g,
    "DICOMweb: $1 selected image series, $2 images. Downloading directly (6 parallel threads)..."],
  [/DICOMweb: (\d+) series ảnh, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\./g,
    "DICOMweb: $1 image series, $2 images. Downloading directly (6 parallel threads)..."],
  [/ {2}Lỗi QIDO series \((.+)\) — bỏ qua\./g, "  QIDO series error ($1) — skipping."],
  [/ {2}Không tách được studyUID từ QIDO — bỏ qua\./g,
    "  Could not extract studyUID from QIDO — skipping."],
  [/Đang dò manifest của viewer\.\.\./g, "Scanning for the viewer manifest..."],
  [/✓ Có manifest → tải TRỰC TIẾP theo API \(không cần click\/cuộn\)\./g,
    "✓ Manifest found → downloading DIRECTLY via the API (no clicking or scrolling needed)."],
  [/Không thấy manifest → chế độ MÔ PHỎNG \(cuộn\/click\), chỉ xử lý xung ĐANG HIỂN THỊ\./g,
    "No manifest found → SIMULATION mode (scroll/click), processing only the VISIBLE series."],
  [/Chờ (\d+)s để bắt nốt ảnh còn lại\.\.\./g, "Waiting $1s to capture the remaining images..."],
  [/Tải xong\. Tổng ảnh: (\d+) \(DICOM (\d+), JPG (\d+), PNG (\d+), trùng bỏ (\d+)\)\./g,
    "Download complete. Total images: $1 (DICOM $2, JPG $3, PNG $4, $5 duplicates skipped)."],
  [/Manifest: (\d+) series, ~(\d+) ảnh\. Đang tải trực tiếp (\d+) ảnh \(6 luồng song song\)\.\.\./g,
    "Manifest: $1 series, ~$2 images. Downloading $3 images directly (6 parallel threads)..."],
  [/Manifest: (\d+) series đã chọn\/(\d+) series, ~(\d+) ảnh\. Đang tải trực tiếp (\d+) ảnh \(6 luồng song song\)\.\.\./g,
    "Manifest: $1 of $2 selected series, ~$3 images. Downloading $4 images directly (6 parallel threads)..."],
  [/ {6}Bước 1\/2: Tạo vé viewer tạm thời cho StudyUID đã chọn \(không tìm lại mã bệnh nhân\)\.\.\./g,
    "      Step 1/2: Creating a temporary viewer ticket for the selected StudyUID (the patient is not searched again)..."],
  [/ {6}Bước 2\/2: Đang đọc danh sách series từ viewer \(chưa tải file ảnh\)\.\.\./g,
    "      Step 2/2: Reading the series list from the viewer (no image files are being downloaded)..."],
  [/Đường nội bộ (.+) không khả dụng; tự chuyển sang cổng PACS công cộng\./g,
    "The internal endpoint $1 is unavailable; continuing through the public PACS gateway."],
  [/ {6}✓ Đã dùng lại phiên RIS; không đăng nhập lại\./g,
    "      ✓ Reused the existing RIS session; no new sign-in."],
  [/ {6}Phiên RIS cũ đã hết hạn; app đang tự đăng nhập lại một lần\./g,
    "      The old RIS session expired; the app is signing in again once."],
  [/ {6}Chưa có phiên RIS hợp lệ; app đang tự đăng nhập một lần\./g,
    "      There is no valid RIS session; the app is signing in once."],
  [/ {6}✓ Viewer mở trực tiếp; không cần đăng nhập RIS\./g,
    "      ✓ The viewer opened directly; no RIS sign-in was needed."],
  [/Đã quét (\d+) series; chưa tải file ảnh nào\./g,
    "Scanned $1 series; no image files were saved."],
  [/ {2}✓ Đã đủ theo manifest: (\d+)\/(\d+) ảnh\./g, "  ✓ Complete per manifest: $1/$2 images."],
  [/ {2}⚠ Tải được (\d+)\/(\d+) ảnh — thiếu (\d+) \(có thể do mạng\/timeout; chạy lại sẽ bù, ảnh trùng tự bỏ\)\./g,
    "  ⚠ Downloaded $1/$2 images — $3 missing (possibly network/timeout; a retry fills the gaps and skips duplicates)."],
  [/Chuyển đổi: tìm thấy (\d+) file DICOM\. Chất lượng JPG=(\d+)(.*), tương phản=(.+)\./g,
    "Conversion: found $1 DICOM files. JPG quality=$2$3, contrast=$4."],
  [/ {2}\.\.\.đã chuyển (\d+) ảnh/g, "  ...converted $1 images"],
  [/Chuyển đổi xong: (\d+) ảnh JPG(.*), bỏ qua (\d+), lỗi (\d+)\./g,
    "Conversion complete: $1 JPG images$2, $3 skipped, $4 errors."],
  [/Tóm tắt theo series:/g, "Summary by series:"],
  [/ {3}• (.+): (\d+) ảnh/g, "   • $1: $2 images"],
  [/ {3}Tổng: (\d+) ảnh, (\d+) series\./g, "   Total: $1 images, $2 series."],
  [/BƯỚC 1\/2: Tải ảnh từ viewer( \(THỬ LẠI — gộp vào folder cũ\))?/g,
    "STEP 1/2: Download images from the viewer$1"],
  [/ \(THỬ LẠI — gộp vào folder cũ\)/g, " (RETRY — merging into the existing folder)"],
  [/Không tải được ảnh nào\. Kiểm tra lại link \(còn hạn không\) và thử tắt chế độ ẩn trình duyệt\./g,
    "No images were downloaded. Check whether the link has expired and try turning off headless mode."],
  [/BƯỚC 2\/2: Chuyển DICOM -> JPG chất lượng cao/g,
    "STEP 2/2: Convert DICOM -> high-quality JPG"],
  [/HOÀN TẤT\. Ảnh JPG nằm ở: (.+)/g, "COMPLETE. JPG images are in: $1"],
  [/Không thấy danh sách series \(có thể giao diện khác\)\. Vẫn thử cuộn ảnh hiện tại\./g,
    "No series list found (the UI may differ). Still trying to scroll the current images."],
  [/Phát hiện (\d+) series \(xung\) đang hiển thị để duyệt\./g,
    "Detected $1 visible series to browse."],
  [/Không tìm thấy thumbnail series theo class chuẩn; sẽ cuộn ảnh đang hiển thị\./g,
    "Could not find standard series thumbnails; will scroll the currently visible images."],
  [/\[Series (\d+)\/(\d+)\] (.*) {2}\(~(\d+) ảnh\) — đang nạp\.\.\./g,
    "[Series $1/$2] $3  (~$4 images) — loading..."],
  [/ {3}\(không bấm được thumbnail này, bỏ qua\)/g, "   (could not click this thumbnail, skipping)"],
  [/ {3}-> series này thêm (\d+) ảnh \(tổng (\d+)\)\./g,
    "   -> this series added $1 images (total $2)."],
  [/ {2}Lỗi file (.+): (.+)/g, "  File error $1: $2"],
  [/chuẩn lâm sàng \(VOI LUT\)/g, "clinical standard (VOI LUT)"],
  [/Đã nạp trình xem: (\d+) series, (\d+) ảnh từ (.+)/g,
    "Loaded viewer: $1 series, $2 images from $3"],
  // Emitted by the web backend only.
  [/Đang quét folder DICOM local và chuyển sang JPG chất lượng (\d+)…/g,
    "Scanning the local DICOM folder and converting to JPG at quality $1…"],
  [/Không tìm thấy folder cũ của link này; sẽ tải mới vào folder riêng\./g,
    "No previous folder found for this link; downloading into a new folder instead."],
  [/Đang yêu cầu dừng an toàn\.\.\./g, "Requesting a safe stop..."],
  [/Đã dừng\./g, "Stopped."],
  [/Hoàn tất\./g, "Complete."],
  [/Đang chuẩn bị\.\.\./g, "Preparing..."],
  [/Lỗi: (.+)/g, "Error: $1"],
  [/Đã khôi phục geometry DICOM cho (\d+) series JPG 2D cũ; crosslink dùng tọa độ bệnh nhân thật\./g,
    "Restored DICOM geometry for $1 legacy 2D JPG series; crosslink uses real patient coordinates."],
  [/Đang đọc metadata DICOM: (\d+)\/(\d+) file…/g, "Reading DICOM metadata: $1/$2 files..."],
  [/Bỏ qua (\d+) file nghi DICOM chưa hỗ trợ \(ảnh màu, metadata thiếu hoặc file hỏng\)\./g,
    "Skipped $1 files suspected to be unsupported DICOM (color images, missing metadata, or corrupted)."],
  [/Đã nhận diện (\d+) series DICOM, mở trực tiếp không chuyển JPG\./g,
    "Identified $1 DICOM series, opening directly without JPG conversion."],
  [/Đang quét thư mục phim: (\d+) thư mục…/g, "Scanning imaging folders: $1 folders..."],
  [/Bỏ qua thư mục không đọc được: (.+) \((.+)\)/g, "Skipping unreadable folder: $1 ($2)"],
  [/Đã quét (\d+) thư mục, tìm thấy (\d+) series ảnh\./g, "Scanned $1 folders, found $2 image series."],
  [/Không thể đổi tên thư mục: (.+)/g, "Could not rename directory: $1"],
  [/Không thể ghi metadata tải tiếp: (.+)/g, "Could not write resume metadata: $1"],
  [/❌ CHẶN GỘP CA (\d+) DO MÂU THUẪN ĐỊNH DANH: (.+)/g,
    "❌ BLOCKED MERGING STUDY $1 DUE TO AN IDENTITY CONFLICT: $2"],
  [/PatientID DICOM '(.+)' không khớp mã RIS '(.+)'\./g,
    "DICOM PatientID '$1' does not match RIS PatientID '$2'."],
  [/PatientName DICOM '(.+)' không khớp tên RIS '(.+)'\./g,
    "DICOM PatientName '$1' does not match the RIS patient name '$2'."],
  [/Ngày sinh DICOM '(.+)' không khớp hồ sơ '(.+)'\./g,
    "DICOM birth date '$1' does not match the patient record '$2'."],
  [/Giới DICOM '(.+)' không khớp hồ sơ '(.+)'\./g,
    "DICOM sex '$1' does not match the patient record '$2'."],
];

export function translateLog(message) {
  const text = String(message ?? "");
  if (language === "vi") return text;
  if (EN[text]) return EN[text];
  return LOG_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}
