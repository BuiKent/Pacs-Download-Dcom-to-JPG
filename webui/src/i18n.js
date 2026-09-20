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

// Exported so a test can check that every string the interface asks for has
// a line here; nothing at runtime reads it directly.
export const EN = {
  // Header, layout and shell
  "DICOM/JPG Downloader & Viewer": "DICOM/JPG Downloader & Viewer",
  Series: "Series",
  "So sánh ba series cạnh nhau": "Compare three series side by side",
  "Khoá cuộn theo vị trí": "Lock scrolling by position",
  "Đã bỏ khoá: mỗi khung cuộn riêng.": "Unlocked: each pane scrolls on its own.",
  "Thu gọn khu tải phim": "Collapse download panel",
  "Mở khu tải phim": "Expand download panel",
  "Tải phim": "Download",
  "Mở folder DICOM hoặc JPG/PNG trong viewer": "Open a DICOM or JPG/PNG folder in the viewer",
  "Quét lại thư mục hiện tại": "Rescan the current folder",
  "Chuyển sang tiếng Anh": "Switch to Vietnamese",
  "Mở thư mục nhật ký (log) phiên làm việc": "Open session log folder",
  "Mở thư mục nhật ký": "Open log folder",
  "Nhật ký phiên làm việc (Logs)": "Session Activity Logs",
  "Mở thư mục Log": "Open Logs Folder",
  "Mở thư mục Log trong Explorer": "Open Logs folder in Explorer",
  "Ghi log tự động mỗi lần khởi chạy — lưu tại thư mục logs/": "Session logs automatically recorded upon each launch in logs/ folder",
  "Giao diện": "Theme",
  "Lịch sử": "History",
  "Mở lại thư mục đã tải hoặc đã xem": "Reopen a downloaded or previously viewed folder",
  "Chưa có lịch sử": "No history yet",
  "(thư mục không còn)": "(folder is gone)",
  "Worklist & Danh Sách Ca Chụp": "Worklist & Study List",
  "Danh sách bệnh nhân & ca chụp": "Patient Worklist & Studies",
  "Danh sách bệnh nhân": "Patient list",
  "Hoạt động & hàng đợi": "Activity & Queue",
  "Tổng hồ sơ": "Total records",
  "Tab đang mở": "Open tabs",
  "Tìm kiếm mã BN, tên bệnh nhân, thư mục...": "Search patient ID, name, folder...",
  "Chưa có hồ sơ nào trong danh sách": "No records in list",
  "Mở folder bệnh nhân": "Open patient folder",
  "Xem phim": "View study",
  "Đóng tab": "Close tab",
  "Chưa rõ mã BN": "Patient ID unknown",
  "Chưa có thông tin hành chính": "No demographics recorded",
  "STT": "No.",
  "Họ và tên": "Patient Name",
  "Mã BN": "Patient ID",
  "Bệnh nhân / Đợt khám": "Patient / Studies",
  "Ngày chụp": "Study date",
  "Trạng thái": "Status",
  "Thao tác": "Actions",
  "Action": "Actions",
  "{} đợt khám": "{} studies",
  "Sắp xếp theo Họ và tên": "Sort by Patient Name",
  "Sắp xếp theo Mã BN": "Sort by Patient ID",
  "Sắp xếp theo Ngày chụp": "Sort by Study Date",
  "Ngày thêm": "Date added",
  "Sắp xếp theo Ngày thêm": "Sort by Date Added",
  "Sao chép ngày thêm": "Copy date added",

  // Study List filters and the read/unread mark
  "Loại chụp": "Modality",
  "Trạng thái đọc": "Read status",
  "Mọi thời điểm": "Any date",
  "Hôm nay": "Today",
  "7 ngày": "Last 7 days",
  "30 ngày": "Last 30 days",
  "Tất cả": "All",
  "Chưa đọc": "Unread",
  "Đã đọc": "Read",
  "Bỏ lọc": "Clear filters",
  "{} ca chưa đọc": "{} unread",
  "Đánh dấu đã đọc": "Mark as read",
  "Bỏ đánh dấu đã đọc": "Mark as unread",
  "Xuất hồ sơ": "Export record",
  "Xuất hồ sơ cho bệnh nhân": "Export record for the patient",
  "Xuất ảnh JPG kèm trang index.html để bệnh nhân mở bằng trình duyệt":
    "Export the JPGs with an index.html the patient can open in a browser",
  "Đang xuất hồ sơ sang thư mục đã chọn…": "Exporting the record to the chosen folder…",
  "Hồ sơ này chưa có thư mục trên đĩa.": "This record has no folder on disk.",
  "Chọn thư mục xuất cần chạy trong ứng dụng WebView2.":
    "Choosing an export folder requires the WebView2 app.",
  "Thu nhỏ cửa sổ": "Minimize",
  "Phóng to / Khôi phục": "Maximize / Restore",
  "Đóng ứng dụng": "Close",

  // One "open" entry point: the archive classifies whatever is in the folder
  // rather than asking the reader to pick the right button first.
  "Mở folder hồ sơ: phim, ảnh, video và văn bản đều được nhận diện":
    "Open a record folder — studies, photos, video and text are all detected",
  "Chưa mở hồ sơ nào": "No record open",
  "Mở folder hồ sơ; app tự phân loại phim DICOM, ảnh, video và văn bản bên trong.":
    "Open a record folder; the app sorts the DICOM studies, photos, video and text inside it.",
  "Mở folder": "Open folder",

  // Viewer tab: the patient rail and its record timeline
  "Thông tin ca": "Case details",
  "Thu gọn thông tin ca": "Collapse case details",
  "Mở thông tin ca": "Expand case details",
  "Mở thông tin ca ( [ )": "Expand case details ( [ )",
  "Tải ca chụp": "Downloads",
  "Lịch sử mở gần đây": "Recent history",
  "Thông tin bệnh nhân": "Patient Information",
  "Sửa thông tin bệnh nhân": "Edit Patient Info",
  "Chỉnh sửa thông tin bệnh nhân": "Edit patient information",
  "Sửa": "Edit",
  "Lưu": "Save",
  "Lưu thay đổi": "Save changes",
  "Hủy": "Cancel",
  "Giới tính": "Gender",
  "Năm sinh": "Birth Year",
  "Số điện thoại": "Phone Number",
  "Điện thoại": "Phone",
  "Địa chỉ": "Address",
  "Nhập họ tên": "Enter patient name",
  "Nhập mã BN": "Enter patient ID",
  "Nhập SĐT": "Enter phone number",
  "Nhập địa chỉ": "Enter address",
  "Tên bệnh viện": "Hospital name",
  "Chẩn đoán / Ghi chú": "Diagnosis / Notes",
  "Nam": "Male",
  "Nữ": "Female",
  "Khác": "Other",
  "Đã lưu thông tin bệnh nhân.": "Patient information saved.",
  "Lỗi:": "Error:",
  "Chưa có tên bệnh nhân": "Patient name not recorded",
  "Bệnh viện": "Hospital",
  "Chẩn đoán": "Diagnosis",
  "Lịch sử khám": "Exam history",
  "Chưa có dữ liệu nào trong hồ sơ này.": "Nothing recorded for this patient yet.",
  "Chưa rõ ngày chụp": "Date not recorded",
  "Chưa có mô tả": "No description",
  "{} tuổi": "{} years old",
  // The short form, for the identity line in a 246px rail.
  "{}T": "{}y",
  "Sao chép số điện thoại": "Copy phone number",
  "Series DICOM này thiếu hình học: chỉ xem/zoom/pan; không dùng kết quả đo vật lý.":
    "This DICOM series has no usable geometry: view/zoom/pan only; do not rely on physical measurements.",
  "Tên hiển thị trên timeline": "Timeline display name",
  "Đổi tên lần chụp hoặc loại media": "Rename this study or media entry",
  "Lưu tên": "Save name",
  "Bỏ thay đổi tên": "Cancel name change",
  "Đã lưu tên hiển thị trên timeline.": "Timeline display name saved.",
  "Dữ liệu gốc DICOM (Ưu tiên dựng từ DICOM)": "Original DICOM data (prioritized for reconstruction)",
  "Dữ liệu ảnh chuyển đổi JPG": "Converted JPG image data",
  "Hoàn tác bước chỉnh sửa": "Undo the last edit",
  "Làm lại bước vừa hoàn tác": "Redo the edit just undone",
  "Đã hoàn tác đến bước {}/{}.": "Undid to edit {} of {}.",
  "Đã làm lại đến bước {}/{}.": "Redid to edit {} of {}.",
  "Đã quay lại file gốc trong hồ sơ.": "Back to the original file in the record.",
  "Ảnh": "Photos",
  "Phim chụp": "Study",
  "Văn bản": "Text",
  "Bệnh án PDF": "PDF records",
  "Chưa có tài liệu nào": "No document here",
  "Lưu vào hồ sơ": "Save to record",
  "Chưa có chỉnh sửa nào để lưu.": "There is no edit to save yet.",
  "Đã lưu vào hồ sơ: {}": "Saved to the record: {}",
  "Hãy kéo chuột trên ảnh để chọn vùng trước.": "Drag on the image to select a region first.",
  "Đã chọn vùng {}×{} px. Chọn công cụ để áp dụng.":
    "Selected {}×{} px. Pick a tool to apply it.",
  "Đang mở hồ sơ…": "Opening record…",
  "Đang mở…": "Opening…",
  "Chưa rõ định dạng nguồn": "Source format not recorded",
  "Không mở được hồ sơ": "Could not open the record",
  "Đã lưu chẩn đoán vào hồ sơ bệnh nhân.": "Diagnosis saved to the patient record.",

  // Text / JSON reading pane
  "Chưa có văn bản nào": "No text file here",
  "Đang đọc file…": "Reading file…",
  "Chép": "Copy",
  "Series video hoặc văn bản, không dựng MPR.":
    "Video or text series — no MPR reconstruction.",

  // Study List: rows whose counts or identity the scan has not established.
  // These read as "not measured", never as a zero or a stand-in value.
  "Ca chụp chưa có mô tả": "Study has no description",
  "Chưa đếm": "Not counted yet",
  "Chưa quét": "Not scanned yet",
  "{} series": "{} series",
  "{} lát": "{} slices",
  series: "series",
  video: "videos",
  trang: "pages",

  // Study List summary tiles
  "bệnh nhân": "patients",
  "hồ sơ": "studies",
  "ảnh & lát": "images & slices",
  "phút video": "video length",
  "trên đĩa": "on disk",
  "cần xử lý": "need attention",

  // Resuming a study the pipeline left unfinished
  "Tải tiếp": "Resume download",
  "Ca chụp này không lưu link viewer để tải tiếp.":
    "This study has no stored viewer link to resume from.",
  "Đã nạp link của ca chụp. Quét series rồi bấm Thử lại để tải tiếp.":
    "Study link loaded. Scan the series, then press Retry to resume.",
  "Đã tải series đã chọn": "Selected series downloaded",
  "Chưa hoàn tất": "Incomplete",

  // Status and modality labels the backend scanner emits. DICOM modality codes
  // (MR, CT) are international and stay as they are; only the words the
  // scanner writes in Vietnamese are listed here.
  "Thiếu folder": "Folder missing",
  "Đang tải": "Downloading",
  "X-Quang": "X-ray",
  "Bệnh án": "Records",

  // Worklist tabs: Study List / Activity & Queue
  "Tổng quan kho & dữ liệu": "Archive & Data Overview",
  "Thư mục nguồn bệnh nhân": "Patient Source Folders",
  "Thêm thư mục nguồn": "Add source folder",
  "Thêm thư mục": "Add folder",
  "Mặc định": "Default",
  "Không tồn tại": "Not found",
  "Mở trong Explorer": "Open in Explorer",
  "Xóa thư mục khỏi danh sách": "Remove folder from list",
  "Nhập đường dẫn thư mục nguồn:": "Enter source folder path:",
  "Đã thêm thư mục nguồn: {}": "Added source folder: {}",
  "Đã thêm thư mục nguồn thành công.": "Source folder added successfully.",
  "Đã xóa thư mục nguồn: {}": "Removed source folder: {}",
  "Chưa có thư mục nguồn nào được cấu hình.": "No source folders configured.",
  "Hồ sơ gần đây": "Recent records",
  "Series trong kho": "Series in archive",
  "Ảnh & lát cắt": "Images & slices",
  "Đang xử lý": "In progress",
  "Gần đây": "Recent",
  "Mở": "Open",
  "Đang chạy...": "Running...",
  "Không có tác vụ nào đang chạy.": "No task is running.",
  "Chưa có thư mục nào được mở hoặc tải.": "No folder has been opened or downloaded yet.",
  "Tác vụ nền": "Background task",
  "Tải ca theo mã bệnh nhân": "Download by patient ID",
  "Tải theo link viewer": "Download from viewer link",
  "Nhập thư mục từ đĩa": "Import folder from disk",
  "Quét lại kho": "Rescan archive",
  "Tìm ca chụp": "Search studies",
  "Dò danh sách series": "Discover series list",
  "Đang tải danh sách bệnh nhân…": "Loading patient list…",
  "Danh sách đã cập nhật": "Patient list is up to date",
  "Danh sách lúc {}": "Patient list as of {}",
  "Ca chụp đang được tải, mở lúc này sẽ thiếu lát cắt": "This study is still downloading; opening it now would show missing slices",
  "Không đồng bộ được danh sách": "Patient list could not be synced",
  "Không tải được danh sách bệnh nhân": "Could not load the patient list",
  "Đang hiển thị dữ liệu lần quét trước.": "Showing data from the previous scan.",
  "Thử quét lại": "Try scanning again",
  "Quét lại": "Rescan",
  "Phòng Xử Lý Video Phẫu Thuật": "Surgery Video Studio",
  "Trình Chỉnh Sửa Ảnh & Tài Liệu": "Photo & Document Editor",
  "Tua lùi 5s": "Rewind 5s",
  "Tua tới 5s": "Forward 5s",
  "Tốc độ": "Speed",
  "Cắt clip": "Trim Clip",
  "Đánh dấu mốc": "Add Bookmark",
  "Mốc phẫu thuật / Ghi chú": "Surgical Bookmarks / Notes",
  "Mốc phẫu thuật": "Surgical bookmark",
  "Bấm để tua video đến mốc này": "Click to seek the clip to this point",
  "Tua đến {} — {}": "Seek to {} — {}",
  "Đã tua đến {}.": "Seeked to {}.",
  "Chuyển sang clip này và tua đến mốc": "Switch to this clip and seek to the point",
  "Thời điểm bắt đầu": "Start Time",
  "Thời điểm kết thúc": "End Time",
  "Xuất clip": "Export Clip",
  "Ghép video": "Concat Videos",
  "Chụp khung hình": "Capture Snapshot",
  "Xoay 90°": "Rotate 90°",
  "Tùy chọn xuất hồ sơ": "Export Record Options",
  "Hồ sơ này có cả ảnh JPG và file gốc DICOM. Vui lòng chọn định dạng muốn xuất ra USB / thư mục:": "This record contains both JPG images and raw DICOM files. Please choose the export format:",
  "Web PACS Viewer (Ảnh JPG)": "Interactive Web PACS Viewer (JPG)",
  "Khuyên dùng": "Recommended",
  "Tạo trang web tự động chạy offline trên mọi trình duyệt. Có thanh cuộn lát cắt, đổi chuỗi xung, phóng to/thu nhỏ, tương phản W/L và so sánh 2 xung song song.": "Creates an offline web viewer running on any browser. Features slice scrolling, series switching, zoom/pan, W/L contrast and 2-up comparison.",
  "ảnh JPG": "JPG images",
  "Nhẹ, mở tức thì trên mọi máy tính": "Lightweight, opens instantly on any PC",
  "File gốc DICOM": "Original DICOM Files",
  "Máy trạm PACS": "PACS Workstations",
  "Xuất toàn bộ file chụp gốc DICOM tiêu chuẩn y khoa chất lượng cao nhất, kèm file hướng dẫn mở bằng RadiAnt, Weasis, MicroDicom, Horos...": "Exports all original diagnostic-quality DICOM files with instructions for RadiAnt, Weasis, MicroDicom, Horos...",
  "file DICOM": "DICOM files",
  "Dành cho bác sĩ CĐHA chuyên sâu": "For radiologists and specialized PACS viewers",
  "Xuất đầy đủ (Cả Web Viewer + DICOM)": "Complete Export (Web Viewer + DICOM)",
  "Tất cả định dạng": "All formats",
  "Bao gồm cả Web PACS Viewer xem nhanh trên trình duyệt lẫn thư mục file gốc DICOM đầy đủ cho máy trạm.": "Includes both the browser-friendly Web PACS Viewer and the complete raw DICOM folder for workstations.",
  "Cắt vùng chọn": "Crop",
  "Che tên/danh tính": "Redact / Hide Identity",
  "Vẽ mũi tên": "Arrow",
  "Khoanh vùng": "Box",
  "Ghi chú chữ": "Text",

  // Photo & video studio: the drawing layer
  "Công cụ vẽ": "Drawing tools",
  "Chọn / di chuyển": "Select / move",
  "Mũi tên chỉ điểm": "Arrow",
  "Đường thẳng": "Line",
  "Khung chữ nhật": "Rectangle",
  "Khung bầu dục": "Ellipse",
  "Bút vẽ tay": "Freehand",
  "Chèn chữ": "Text",
  "Đánh số thứ tự": "Numbered marker",
  "Tô sáng vùng": "Highlight",
  "Làm mờ vùng": "Pixelate",
  "Che kín danh tính": "Redact identity",
  "Cắt ảnh theo vùng chọn": "Crop to selection",
  "Màu": "Colour",
  "Chọn màu tuỳ ý": "Pick any colour",
  "Nét": "Width",
  "Cỡ chữ": "Text size",
  "Độ đậm": "Opacity",
  "Tô đặc": "Filled",
  "Cắt theo vùng chọn": "Crop to selection",
  "Xoá hình đang chọn": "Delete selected",
  "Xoá hết nét vẽ": "Clear drawing",
  "Nội dung ghi chú trên ảnh": "Note text on the image",
  "Xoay trái 90°": "Rotate left 90°",
  "Xoay phải 90°": "Rotate right 90°",
  "Thu nhỏ": "Zoom out",
  "Phóng to": "Zoom in",
  "Vừa khung": "Fit",
  "Áp dụng lên ảnh": "Apply to image",
  "Vẽ đè vĩnh viễn lên ảnh": "Burn the drawing into the image",
  "Tải ảnh về": "Download image",
  "Chưa vẽ gì": "Nothing drawn",
  "Chưa vẽ gì trên ảnh.": "Nothing drawn on the image.",
  "{} nét chưa áp dụng": "{} not applied yet",
  "Đang chọn: {}": "Selected: {}",
  "Đã chọn vùng cắt {}×{} px. Bấm “Cắt ảnh” để áp dụng.": "Crop area {}×{} px selected. Press “Crop” to apply.",
  "Hãy kéo chuột để chọn vùng cần cắt.": "Drag on the image to choose the crop area.",
  "Hãy kéo chuột trên ảnh để chọn vùng cần cắt.": "Drag on the image to choose the crop area.",
  "Đã xoá các nét vẽ chưa áp dụng.": "Cleared the unapplied drawing.",
  "Chưa vẽ gì trên ảnh để áp dụng.": "Nothing has been drawn on the image yet.",
  "Đang vẽ {} chi tiết lên ảnh...": "Burning {} marks into the image...",
  "Đã vẽ {} chi tiết lên ảnh.": "Burned {} marks into the image.",
  "Đã cắt ảnh còn {}×{} px.": "Cropped to {}×{} px.",
  "Ảnh chưa có chỉnh sửa nào; hãy mở file gốc trong thư mục hồ sơ.": "This photo has no edits yet; open the original from the record folder.",
  "Đã tải ảnh đã chỉnh sửa về máy.": "Edited image downloaded.",
  "Đã hoàn tác nét vẽ.": "Drawing step undone.",
  "Đã vẽ lại nét vừa hoàn tác.": "Drawing step redone.",

  // Photo & video studio: the surgical player
  "Cắt giữ lại đoạn đã đánh dấu": "Keep only the marked span",
  "Ghi nét vẽ vĩnh viễn vào video": "Burn the drawing into the video",
  "Áp dụng lên video": "Apply to video",
  "Thanh tua video": "Video scrubber",
  "Đặt điểm đầu tại vị trí đang xem": "Set the in point at the playhead",
  "Đặt điểm cuối tại vị trí đang xem": "Set the out point at the playhead",
  "Đầu": "In",
  "Cuối": "Out",
  "Chưa chọn đoạn": "No span marked",
  "Bỏ đoạn đã đánh dấu": "Clear the marked span",
  "Hãy đặt điểm đầu trước, ở vị trí sớm hơn điểm cuối.": "Set the in point first, earlier than the out point.",
  "Đã đặt điểm đầu tại {}.": "In point set at {}.",
  "Đã chọn đoạn {} → {}.": "Span {} → {} selected.",
  "Đã bỏ đoạn đã đánh dấu.": "Marked span cleared.",
  "Chưa vẽ gì trên video để áp dụng.": "Nothing has been drawn on the video yet.",
  "Đang ghi {} nét vẽ vào video ({} → {})...": "Burning {} marks into the video ({} → {})...",
  "Đang ghi {} nét vẽ vào toàn bộ video...": "Burning {} marks into the whole video...",
  "Đã ghi {} nét vẽ vào video.": "Burned {} marks into the video.",
  "Hãy đánh dấu điểm đầu (I) và điểm cuối (O) trên thanh tua trước.": "Mark the in (I) and out (O) points on the scrubber first.",
  "Hiện": "Show for",
  "Toàn bộ": "Whole clip",
  "Nhóm: {}": "Group: {}",
  "Chẩn đoán ghi trong hồ sơ: {}": "Diagnosis recorded in the chart: {}",

  // Clinical record: what the tumour is, and what has been done about it.
  // Where one study sits in the treatment recorded around it.
  "Trước mổ": "Before surgery",
  "Trước xạ": "Before radiotherapy",
  "Trước hoá": "Before chemotherapy",
  "Trước điều trị đích": "Before targeted therapy",
  "Trong đợt xạ": "During radiotherapy",
  "Trong đợt hoá": "During chemotherapy",
  "Trong đợt điều trị đích": "During targeted therapy",
  "Sau mổ": "After surgery",
  "Sau xạ": "After radiotherapy",
  "Sau hoá": "After chemotherapy",
  "Sau điều trị đích": "After targeted therapy",
  "Sau khi ghi tái phát": "After the recorded relapse",
  "Sau biến chứng": "After the complication",
  "Sau lần khám": "After the visit",
  "cùng ngày": "same day",
  "{} ngày": "{} days",
  "{} tuần": "{} weeks",
  "{} tháng": "{} months",
  "Ngày kết thúc là ước tính từ số buổi xạ, chưa ai xác nhận.": "The end date is estimated from the fraction count; nobody has confirmed it.",
  "Nằm trong 12 tuần sau xạ — cân nhắc giả tiến triển trước khi kết luận tiến triển.": "Within 12 weeks of radiotherapy — weigh pseudoprogression before calling this progression.",
  "Thư mục này chưa có patient-index.json nên chưa ghi được hồ sơ lâm sàng.": "This folder has no patient-index.json, so it cannot hold a clinical record.",
  "Xoá": "Remove",
  "Ghi chú": "Note",
  "Chưa rõ": "Not recorded",
  "Vị trí": "Location",
  "Tái phát": "Relapse",
  "Hậu phẫu": "Post-op",
  "Đang xạ": "On radiotherapy",
  "Đang hoá": "On chemotherapy",
  "Đang điều trị đích": "On targeted therapy",
  "xạ": "radiotherapy",
  "hoá": "chemo",
  "đích": "targeted",
  "chưa cập nhật": "not updated",
  "Đang điều trị": "In treatment",
  "Chưa ghi": "Not recorded",
  "Giai đoạn": "Stage",
  "từ {}": "from {}",
  "đến {}": "until {}",
  "Chưa rõ ngày": "Date not recorded",
  "{} buổi": "{} fractions",
  "{} chu kỳ": "{} cycles",
  "{} (độ {})": "{} (grade {})",
  "Độ {}": "Grade {}",
  // The grade range beside a diagnosis in the list: "độ 2-4".
  "độ {}": "grade {}",
  "Khối u chưa mô tả": "Tumour not described",
  "Hồ sơ lâm sàng": "Clinical record",
  "Hồ sơ bệnh nhân": "Patient record",
  "Sửa hồ sơ bệnh nhân": "Edit this patient record",
  "Chẩn đoán & điều trị": "Diagnosis & treatment",
  "Đã lưu hồ sơ bệnh nhân.": "Patient record saved.",
  "Ghi tự do: lưu ý khi đọc phim, hẹn khám…": "Free text: what to watch for when reading, appointments…",
  "Đang lưu…": "Saving…",
  "Đang sửa ở khung bên phải.": "Being edited in the pane on the right.",
  "Còn bản sửa chưa lưu.": "There are unsaved edits.",
  "Sửa hồ sơ lâm sàng": "Edit clinical record",
  "Lưu hồ sơ lâm sàng": "Save clinical record",
  "Đang tải hồ sơ lâm sàng…": "Loading clinical record…",
  "Đã lưu hồ sơ lâm sàng.": "Clinical record saved.",
  "Chưa ghi hồ sơ lâm sàng cho bệnh nhân này.": "No clinical record has been entered for this patient.",
  "Chẩn đoán dựa trên: {}": "Diagnosis based on: {}",
  "Chưa ghi chẩn đoán này dựa trên gì": "Nobody has recorded what this diagnosis rests on",
  "Chưa rõ căn cứ": "Basis not recorded",
  "Khối u {}": "Tumour {}",
  "Thêm khối u": "Add tumour",
  "Chưa có khối u nào được mô tả.": "No tumour has been described yet.",
  "Khoang": "Compartment",
  "Chưa chọn": "Not chosen",
  "Chọn hoặc gõ vị trí": "Pick or type a location",
  "Bên": "Side",
  "Trục": "Axis",
  "Chọn hoặc gõ": "Pick or type",
  "Mô bệnh học": "Histology",
  "Chọn hoặc gõ chẩn đoán": "Pick or type a diagnosis",
  "Độ WHO": "WHO grade",
  "Căn cứ": "Basis",
  "Ngày có kết quả": "Result date",
  "Ghi chú khối u": "Tumour note",
  "Tuỳ chọn": "Optional",
  "Dấu ấn phân tử": "Molecular markers",
  "Tên dấu ấn": "Marker",
  "Kết quả": "Result",
  "Thêm dấu ấn": "Add marker",
  "Thêm dấu ấn khác": "Add another marker",
  // The panel asks for the markers the diagnosis needs, so without a
  // diagnosis it has nothing to ask for.
  "Chọn chẩn đoán mô bệnh học để app hỏi đúng bộ dấu ấn.":
    "Choose a histological diagnosis and the app will ask for the right markers.",
  "Bắt buộc": "Essential",
  // On a marker row whose answer is being typed instead of chosen.
  "Danh sách": "List",
  "Khác…": "Other…",
  "Gõ chẩn đoán theo phiếu giải phẫu bệnh": "Type the diagnosis as the report words it",
  "Quay lại danh sách đáp án, xoá nội dung đang gõ":
    "Go back to the listed answers, clearing what has been typed",
  "Xoá dấu ấn": "Remove marker",
  "Dấu ấn mới": "New marker",
  "Kết quả ({})": "Result ({})",
  // Between two markers that are alternatives: "ATRX hoặc 1p/19q".
  "hoặc": "or",
  "chưa làm": "not performed",
  "chưa đọc được": "not recognised",
  "Ô này có chữ nhưng không khớp đáp án nào trong danh sách, nên không luật nào đọc được.":
    "This field holds text that matches none of the listed answers, so no rule can read it.",

  // The reading the classification makes of a record: what the work-up still
  // needs, whether the diagnosis is integrated, and the protocol that follows.
  "Bắt buộc còn thiếu": "Essential, still missing",
  "Nên có": "Recommended",
  "Chẩn đoán tích hợp": "Integrated diagnosis",
  "Chưa tích hợp": "Not yet integrated",
  "Mô bệnh học và phân tử đã đủ để kết luận chẩn đoán tích hợp":
    "Histology and molecular results are sufficient for an integrated diagnosis",
  "Chưa đủ căn cứ cho chẩn đoán tích hợp theo WHO CNS5":
    "Not enough evidence for an integrated diagnosis under WHO CNS5",
  "Độ đã ghi {} · theo phân tử là độ {}": "Recorded grade {} · molecular grade {}",
  "Phác đồ chuẩn": "Standard protocol",
  "Cân nhắc theo bối cảnh": "Consider in context",
  "Khi: {}": "When: {}",
  "Điều trị": "Treatment",
  "Sự kiện {}": "Event {}",
  "Thêm sự kiện": "Add event",
  "Chưa có mốc điều trị nào.": "No treatment has been recorded yet.",
  "Loại": "Kind",
  "Bắt đầu": "Start",
  "Kết thúc": "End",
  "Để trống ngày kết thúc nghĩa là đang diễn ra.": "Leaving the end date empty means it is still going.",
  "Nơi thực hiện": "Where",
  "Bệnh viện, trung tâm": "Hospital or centre",
  "Mức độ lấy u": "Extent of resection",
  "Kỹ thuật": "Technique",
  "Liều (Gy)": "Dose (Gy)",
  "Số buổi": "Fractions",
  "Có số buổi thì app tự biết đợt xạ quá hạn cập nhật.": "With a fraction count the app can tell when a course is overdue an update.",
  "Phác đồ": "Regimen",
  "Đã xong": "Done",
  "Tổng chu kỳ": "Total cycles",
  "Chẩn đoán đọc từ tên thư mục: {}": "Diagnosis read from the folder name: {}",
  "suốt video": "for the whole clip",
  "Trình duyệt không mở được định dạng này": "The browser cannot open this format",
  "File vẫn còn nguyên trong hồ sơ. Chuyển sang MP4 để xem, cắt và vẽ lên nó.": "The file is untouched in the record. Convert it to MP4 to view, trim and draw on it.",
  "Chuyển sang MP4": "Convert to MP4",
  "Nét vẽ mới sẽ hiện {}.": "New marks will show {}.",
  "Đã đổi “{}” sang hiện {}. Nét vẽ mới cũng vậy.": "Changed “{}” to show {}. New marks too.",
  "Đang ghi {} nét vẽ vào video ({} nét theo mốc thời gian)...": "Burning {} marks into the video ({} of them timed)...",
  "Trình duyệt không phát được định dạng {} — bấm “Tối ưu MP4” để chuyển đổi rồi xem.": "The browser cannot play {} — press “Optimise MP4” to convert it first.",
  "Xuất file PDF": "Export PDF",
  "Lưu ảnh mới": "Save New Image",
  "Phát": "Play",
  "Tạm dừng": "Pause",
  "Đã sao chép": "Copied",
  "Sao chép": "Copy",
  "Đã sao chép vào clipboard!": "Copied to clipboard!",
  "Không thể sao chép": "Could not copy",
  "Nhấp đúp hoặc bấm icon để sao chép": "Double-click or click icon to copy",
  "Sao chép tên bệnh nhân": "Copy patient name",
  "Sao chép mã BN": "Copy patient ID",
  "Sao chép ngày chụp": "Copy study date",
  "Sao chép tên ca chụp": "Copy study heading",
  "Chưa có video nào": "No video selected",
  "Chưa có ảnh nào": "No photo selected",


  // Download panel
  "TẢI MRI / CT": "DOWNLOAD MRI / CT",
  "Tính năng xuất JPG riêng; không dùng để mở DICOM trong viewer.":
    "A separate JPG export feature; not the way to open DICOM in the viewer.",
  "Chuyển Dcom → JPG": "Convert DICOM → JPG",
  "Phát hiện tài liệu & Báo cáo đính kèm": "Detected Attachments & Reports",
  "Tải kèm toàn bộ tài liệu đính kèm (PDF, TXT, Báo cáo)": "Download all attachments (PDF, TXT, Reports)",
  "Các tệp này sẽ được tải riêng vào thư mục DOCUMENTS": "These files will be saved in the DOCUMENTS folder",
  "Tài liệu đính kèm": "Attachments",
  "Tải kèm": "Include",
  "Tài liệu": "Documents",
  "Mã bệnh nhân": "Patient ID",
  "Tìm ca": "Find studies",
  "Tìm các ca MRI/CT của mã bệnh nhân này trên RIS": "Search RIS for this patient's MRI/CT studies",
  "Link viewer": "Viewer link",
  "Xóa mã bệnh nhân": "Clear the patient code",
  "Xóa link viewer": "Clear the viewer link",
  "Bổ sung thông tin bệnh nhân": "Add patient info",
  "Tên bệnh nhân": "Patient name",
  "Mã BN (ID)": "Patient ID",
  "Năm sinh / Ngày sinh": "DOB / Birth year",
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
  "Hãy tích ít nhất một ngày chụp để tải.":
    "Tick at least one study date to download.",
  "Chưa quét series cho ca {}; hãy bấm Quét danh sách series.":
    "No series scanned for {}; press Scan series list.",
  "Ca {} chưa tích series nào.":
    "{} has no series ticked.",
  "Còn {} ca đang tích chưa chọn được series nào.":
    "{} ticked studies still have no series selected.",
  ảnh: "images",
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
  "Không tạo được phiên riêng cho hồ sơ vừa tải.": "Could not create an isolated viewer session for the downloaded record.",
  "Chưa tìm ca chụp.": "No studies found yet.",
  "Đã tải": "Downloaded",
  "Tải chưa hoàn tất": "Incomplete",
  "Phim mới": "New study",
  "Sao chép toàn bộ nhật ký": "Copy complete log to clipboard",
  "Xoá hiển thị": "Clear display",
  "Chưa có nội dung nhật ký để sao chép.": "No log contents to copy.",
  "Đã sao chép toàn bộ nhật ký (log)!": "Copied complete log to clipboard!",
  "Đã xoá hiển thị nhật ký.": "Log display cleared.",

  // Patient status
  "Không tự động gộp bệnh nhân": "Automatic patient merge blocked",
  "Mã {} đã lưu tên “{}”, nhưng RIS trả “{}”. Hãy kiểm tra lại.":
    "Code {} is stored under the name “{}”, but RIS returned “{}”. Please re-check.",
  "Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất":
    "Already in the archive · {} downloaded · {} new · {} incomplete",
  "{} ca chưa có trong kho; app sẽ tạo một folder bệnh nhân.":
    "{} studies are not in the archive yet; a patient folder will be created.",
  "Đã nhận diện {} ca từ folder Classic cũ": "Recognised {} studies from an old Classic folder",

  // Toolbar
  "Một khung ảnh": "Single pane",
  "So sánh hai series cạnh nhau": "Compare two series side by side",
  "Xem tuần tự 6 lát": "View 6 consecutive slices",
  "Xem tuần tự 8 lát": "View 8 consecutive slices",
  "MPR ba mặt phẳng": "Three-plane MPR",
  "Series không đủ MPR": "Series cannot support MPR",
  "Dựng volume 3D toàn màn hình": "Full-screen 3D volume rendering",
  "Series không đủ 3D": "Series cannot support 3D",
  "DICOM mặc định": "DICOM default",
  "Toàn dải": "Full range",
  "Cửa sổ rộng": "Wide window",
  "Mô mềm JPG": "JPG soft tissue",
  "Cửa sổ hẹp": "Narrow window",
  "Tương phản cao": "High contrast",
  "Cửa sổ Hounsfield (HU)": "Hounsfield window (HU)",
  "Cửa sổ theo WC/WW trong file": "Window from the file's own WC/WW",
  "Preset thị giác 8-bit": "8-bit visual preset",
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
  "Kính lúp": "Magnifier",
  "Thước tỉ lệ (mm)": "Scale bar (mm)",
  "ROI ellipse": "Ellipse ROI",
  "ROI tự do": "Freehand ROI",
  "Đặt lại ba mặt phẳng": "Reset all three planes",
  "Đặt lại góc nhìn": "Reset the camera",
  "Đặt lại hiển thị": "Reset the display",
  "Xoay khung đang chọn 90° theo chiều kim đồng hồ": "Rotate the active pane 90° clockwise",
  "Lật ngang khung đang chọn": "Flip the active pane horizontally",
  "Lưu ảnh 3D": "Save the 3D image",
  "Lưu ảnh": "Save image",
  "Lưu đo/ROI": "Save measurements/ROIs",
  "Tính thể tích ROI": "Compute ROI volume",
  "Đảo màu": "Invert",
  "Chạy phim": "Play cine",
  "Đang chạy phim — nhấn Space để dừng.": "Cine running — press Space to stop.",
  "Đã dừng chạy phim.": "Cine stopped.",

  // Workspace and status
  "Mở folder DICOM hoặc JPG/PNG": "Open a DICOM or JPG/PNG folder",
  "Mở folder trong viewer": "Open a folder in the viewer",
  "Đang khởi động...": "Starting up...",
  "Đang dựng khung xem…": "Building the layout…",
  "Đang mở ảnh…": "Opening images…",
  "Không mở được khung xem": "Could not open the layout",
  "An toàn hiển thị": "Display safety",
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

  "Con trỏ tham chiếu đã bật.": "Reference cursor on.",

  // File Inspector & Single File Open
  "Mở file...": "Open file...",
  "Mở file DICOM hoặc file ảnh": "Open a DICOM file or image file",
  "Mở file DICOM hoặc JPG/PNG đơn lẻ trong viewer": "Open a single DICOM or JPG/PNG file in the viewer",
  "Thông tin file & Link tải": "File Info & Download Link",
  "Chi tiết file & Thẻ DICOM": "File Details & DICOM Tags",
  "Nguồn gốc & Link tải": "Provenance & Download Link",
  "Link tải / Viewer": "Download / Viewer Link",
  "Sao chép link": "Copy link",
  "Đã sao chép link tải vào clipboard!": "Download link copied to clipboard!",
  "Không thể sao chép liên kết": "Could not copy link",
  "Mở liên kết": "Open URL",
  "Mã ca chụp (Accession No)": "Accession number",
  "Bệnh viện / Cơ sở": "Hospital / Facility",
  "Phương thức tải": "Download method",
  "Thời gian tải": "Downloaded at",
  "Thông tin ca chụp": "Study & Patient Demographics",
  "Thông số ảnh": "Image Parameters",
  "Đường dẫn file": "File path",
  "Kích thước file": "File size",
  "Ngày sửa đổi": "Modified date",
  "Lát cắt hiện tại": "Current slice",
  "Độ phân giải": "Resolution",
  "Độ dày lát cắt": "Slice thickness",
  "Khoảng cách lát cắt": "Slice spacing",
  "Pixel Spacing": "Pixel spacing",
  "Bảng thẻ DICOM Header": "DICOM Header Tags",
  "Tìm kiếm thẻ (Tag, Tên, Giá trị)...": "Search tags (Tag, Name, Value)...",
  "Tag": "Tag",
  "VR": "VR",
  "Tên thẻ": "Tag Name",
  "Giá trị": "Value",
  "Không tìm thấy thẻ phù hợp": "No matching tags found",
  "Chưa có thông tin link tải cho file này.": "No download link recorded for this file.",
  "Đang đọc thông tin file...": "Reading file details...",
  "Không tải được thông tin file": "Could not load file details",
  "Đóng": "Close",

  // Lines the English side had no entry for. `t()` falls back to its own
  // key, so each of these was a Vietnamese sentence sitting in an
  // otherwise English screen. Wording follows the terms already used
  // above: `hồ sơ` is a record, `mốc` a bookmark, `ghép` concat, and
  // `ca chụp` a study.
  "+ Mốc": "+ Bookmark",
  "Bấm “+ Thêm mốc” hoặc phím M khi đang xem": "Press “+ Add bookmark”, or M while watching",
  "Bật/tắt clip này": "Select or clear this clip",
  "Bắt đầu ghép ({} clip)": "Concat now ({} clips)",
  "Bệnh nhân": "Patient",
  "Bệnh án / Văn bản": "Records / Text",
  "Ca chụp chưa phân loại": "Unclassified study",
  "Chưa có mốc nào trong clip này.": "No bookmarks in this clip yet.",
  "Chưa có nhật ký phát sinh.": "Nothing has been logged yet.",
  "Chưa rõ tên BN": "Patient name not recorded",
  "Chọn các clip và sử dụng nút ▲/▼ để sắp xếp thứ tự ghép nối theo trình tự phẫu thuật:": "Pick the clips and use ▲/▼ to put them in the order the operation ran:",
  "Chọn file nhật ký": "Choose a log file",
  "Chụp": "Snapshot",
  "Clip khác": "Other clips",
  "Con trỏ tham chiếu": "Reference cursor",
  "Cài đặt hiển thị": "Display preset",
  "Cần chọn ít nhất 2 clip video để ghép.": "Concatenating needs at least 2 clips selected.",
  "Cần ít nhất 2 clip video trong ca mổ để ghép.": "This operation needs at least 2 clips before they can be concatenated.",
  "Cắt đoạn": "Trim",
  "Di chuyển lên trước": "Move earlier",
  "Di chuyển xuống sau": "Move later",
  "File DICOM gốc (.dcm)": "Original DICOM file (.dcm)",
  "File định dạng MPG/MPEG cần chuyển sang MP4 để xem, cắt và vẽ lên nó.": "An MPG/MPEG file has to be converted to MP4 before it can be viewed, trimmed and drawn on.",
  "Ghép & Sắp xếp thứ tự clip phẫu thuật": "Concat and order the surgical clips",
  "Ghép clips": "Concat clips",
  "Ghép các clip video": "Concat the video clips",
  "Hiện tại": "Current",
  "Huỷ": "Cancel",
  "Hủy bỏ": "Cancel",
  "Không lưu được mốc phẫu thuật: {}": "Could not save the surgical bookmark: {}",
  "Không rõ thời lượng": "Duration not known",
  "Không thể mở thư mục: ": "Could not open the folder: ",
  "Không thể đọc nhật ký: ": "Could not read the log: ",
  "Không tìm thấy clip video nào trong ca mổ": "No video clip found in this operation",
  "Không tìm thấy đường dẫn video gốc.": "The original video path was not found.",
  "Không tìm thấy đường dẫn ảnh gốc.": "The original photo path was not found.",
  "Không đủ số lượng file video hợp lệ để ghép.": "Not enough usable video files to concatenate.",
  "Kéo hoặc dùng phím mũi tên; nhấp đúp để đặt lại": "Drag, or use the arrow keys; double-click to reset",
  "Lỗi": "Error",
  "Modality": "Modality",
  "Mô tả ca": "Study description",
  "Mượt": "Smooth",
  "Mật khẩu": "Password",
  "Mốc từ clip khác trong ca mổ": "Bookmark from another clip in this operation",
  "Mốc {}": "Bookmark {}",
  "Mở hồ sơ": "Open record",
  "Mở rộng hoặc thu gọn bệnh nhân {}": "Expand or collapse patient {}",
  "Mở viewer": "Open viewer",
  "Nhập ghi chú / mốc phẫu thuật:": "Note for this surgical bookmark:",
  "Nhập đường dẫn thư mục xuất:": "Path of the export folder:",
  "Nhật ký phiên làm việc": "Session activity log",
  "Phát / Tạm dừng": "Play / Pause",
  "Sẵn sàng.": "Ready.",
  "Sửa tên mốc": "Rename bookmark",
  "Theo dõi": "Follow-up",
  "Thu gọn thông tin ca ( [ )": "Collapse case details ( [ )",
  "Thêm mốc": "Add bookmark",
  "Thêm mốc tại thời điểm hiện tại": "Add a bookmark at the current time",
  "Thêm mốc tại thời điểm hiện tại (phím M)": "Add a bookmark at the current time (M)",
  "Thư mục": "Folder",
  "Tiêu chuẩn": "Standard",
  "Trích xuất ảnh đại diện Thumbnail": "Extract a thumbnail",
  "Tài khoản": "Account",
  "Tìm theo tên hoặc mã bệnh nhân, đợt khám…": "Search by patient name, patient ID or study…",
  "Tạo Filmstrip": "Make filmstrip",
  "Tạo Thumbnail": "Make thumbnail",
  "Tạo chuỗi ảnh Filmstrip": "Make a filmstrip of frames",
  "Tốc độ khung hình:": "Frame rate:",
  "Tối ưu MP4": "Optimise MP4",
  "Tối ưu hoá mã hoá MP4 (H.264)": "Optimise the MP4 encoding (H.264)",
  "Video": "Video",
  "Vui lòng nhập tài khoản RIS dự phòng:": "Enter a fallback RIS account:",
  "Xoá mốc": "Delete bookmark",
  "Đang chuẩn bị ghép {} clip video...": "Preparing to concat {} clips...",
  "Đang cắt video bằng FFmpeg...": "Trimming the video with FFmpeg...",
  "Đang cắt ảnh...": "Cropping the photo...",
  "Đang ghép {} clip video bằng FFmpeg...": "Concatenating {} clips with FFmpeg...",
  "Đang trích xuất chuỗi khung hình filmstrip...": "Extracting the filmstrip frames...",
  "Đang tạo ảnh đại diện thumbnail tại {:.1f}s...": "Making the thumbnail at {:.1f}s...",
  "Đang tải nhật ký...": "Loading the log...",
  "Đang tối ưu hoá mã hoá video MP4 (H.264)...": "Optimising the MP4 (H.264) encoding...",
  "Đang xoay ảnh 90°...": "Rotating the photo 90°...",
  "Đang xuất file PDF...": "Exporting the PDF...",
  "Đang đóng dấu thông tin lên video...": "Stamping the details onto the video...",
  "Đã chuyển sang clip: {} tại {}.": "Moved to clip: {} at {}.",
  "Đã cắt đoạn video ({:.1f}s - {:.1f}s) thành công.": "Trimmed the video ({:.1f}s - {:.1f}s).",
  "Đã ghép thành công {} đoạn video clip.": "Concatenated {} clips.",
  "Đã khoá cuộn: {} — {}.": "Scroll locked: {} — {}.",
  "Đã lưu khung hình snapshot PNG.": "Saved the frame as a PNG.",
  "Đã sao chép toàn bộ nhật ký!": "Copied the whole log.",
  "Đã trích xuất {} khung hình filmstrip.": "Extracted {} filmstrip frames.",
  "Đã tạo ảnh đại diện thumbnail thành công ({:.1f}s).": "Thumbnail made ({:.1f}s).",
  "Đã tối ưu hoá và xuất video MP4 thành công.": "Optimised and exported the MP4.",
  "Đã xoay ảnh 90° thành công.": "Rotated the photo 90°.",
  "Đã xoá mốc phẫu thuật.": "Surgical bookmark deleted.",
  "Đã xuất PDF thành công: {}": "PDF exported: {}",
  "Đã đánh dấu mốc tại {}.": "Bookmarked at {}.",
  "Đã đóng dấu thông tin lên video thành công.": "The details were stamped onto the video.",
  "Đóng dấu / Chèn thông tin phẫu thuật": "Stamp the surgical details onto the video",
  "Đóng dấu thông tin": "Stamp details",
  "Đăng nhập & Thử lại": "Sign in and retry",
  "Đăng nhập RIS thất bại": "RIS sign-in failed",
  "Đường tham chiếu": "Reference lines",
  "Định dạng": "Format",
  "Đổi độ rộng cột {}": "Resize the {} column",
  "Độ phân giải:": "Resolution:",
  "đồng bộ theo vị trí 3D": "synced by 3D position",
  "Ảnh JPG đã giải nén": "Decompressed JPG image",
  "⚠ đồng bộ theo số thứ tự lát (không có đồng bộ không gian)": "⚠ synced by slice number (no spatial sync)",
};

export function t(text) {
  if (language === "vi") return text;
  return EN[text] ?? text;
}

/**
 * The clinical vocabulary in English, kept apart from the interface strings.
 *
 * Two reasons it is not merged into `EN`. The values here are *recorded data* —
 * what is stored in `clinical-index.json` is the Vietnamese on the left, and
 * the English on the right is only how it is read out — so a term must never be
 * substituted where the stored string itself is meant. And some of them are one
 * letter: "P" and "T" are phải and trái, and a table shared with the interface
 * would rewrite any future `t("T")` in the app into "L".
 *
 * The Vietnamese side is the contract. `tests/test_clinical_record.py` fails if
 * `clinical_record.vocabulary()` ever offers a term this table has no English
 * for, so the two files cannot drift apart unnoticed.
 */
export const CLINICAL_EN = {
  // Compartment, axis and side
  "Nội sọ": "Intracranial",
  "Tuỷ sống": "Spinal",
  "Trong trục": "Intra-axial",
  "Ngoài trục": "Extra-axial",
  "Nội tuỷ": "Intramedullary",
  "Ngoài tuỷ - trong màng cứng": "Intradural extramedullary",
  "Ngoài màng cứng": "Extradural",
  "P": "R",
  "T": "L",
  "Giữa": "Midline",
  "Hai bên": "Bilateral",

  // Intracranial locations
  "Thuỳ trán": "Frontal lobe",
  "Thuỳ đỉnh": "Parietal lobe",
  "Thuỳ thái dương": "Temporal lobe",
  "Thuỳ chẩm": "Occipital lobe",
  "Thuỳ đảo": "Insula",
  "Thể chai": "Corpus callosum",
  "Đồi thị": "Thalamus",
  "Hạch nền": "Basal ganglia",
  "Não thất bên": "Lateral ventricle",
  "Não thất III": "Third ventricle",
  "Não thất IV": "Fourth ventricle",
  "Vùng tuyến tùng": "Pineal region",
  "Vùng yên": "Sellar region",
  "Vùng trên yên": "Suprasellar region",
  "Góc cầu tiểu não": "Cerebellopontine angle (CPA)",
  "Thân não": "Brainstem",
  "Tiểu não": "Cerebellum",
  "Hố sau": "Posterior fossa",
  "Nền sọ trước": "Anterior skull base",
  "Nền sọ giữa": "Middle skull base",
  "Nền sọ sau": "Posterior skull base",
  "Lỗ chẩm": "Foramen magnum",
  "Xoang tĩnh mạch dọc trên": "Superior sagittal sinus",
  "Cạnh liềm não": "Parafalcine",
  "Lều tiểu não": "Tentorial",
  "Màng não lan toả": "Diffuse leptomeningeal",

  // Spinal locations
  "Bản lề cổ-chẩm": "Craniocervical junction",
  "C1-C2": "C1-C2",
  "Cột sống cổ": "Cervical spine",
  "Bản lề cổ-ngực": "Cervicothoracic junction",
  "Cột sống ngực": "Thoracic spine",
  "Bản lề ngực-thắt lưng": "Thoracolumbar junction",
  "Cột sống thắt lưng": "Lumbar spine",
  "Nón tuỷ": "Conus medullaris",
  "Đuôi ngựa": "Cauda equina",
  "Cùng-cụt": "Sacrococcygeal",
  "Đám rối cánh tay": "Brachial plexus",

  // The families the diagnosis list is grouped into
  "U thần kinh đệm": "Gliomas",
  "U màng não thất và đám rối mạch mạc": "Ependymal & choroid plexus",
  "U thần kinh đệm - thần kinh và u phôi": "Glioneuronal & embryonal",
  "U màng não và u trung mô": "Meningioma & mesenchymal",
  "U vỏ bao thần kinh": "Nerve sheath",
  "U vùng yên và tuyến tùng": "Sellar & pineal",
  "U lympho và di căn": "Lymphoma & metastasis",
  "Nang, tổn thương dạng u và mạch máu": "Cysts, tumour-like & vascular",

  // WHO CNS5 entity names. English is the nomenclature these were written in,
  // so it is the name a report, a guideline and a tumour board all use.
  "U sao bào, IDH đột biến": "Astrocytoma, IDH-mutant",
  "U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q":
    "Oligodendroglioma, IDH-mutant, 1p/19q-codeleted",
  "U nguyên bào thần kinh đệm, IDH tự nhiên": "Glioblastoma, IDH-wildtype",
  "U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi":
    "Diffuse midline glioma, H3 K27-altered",
  "U thần kinh đệm lan toả bán cầu, H3 G34 đột biến":
    "Diffuse hemispheric glioma, H3 G34-mutant",
  "U sao bào lông": "Pilocytic astrocytoma",
  "U sao bào vàng đa hình": "Pleomorphic xanthoastrocytoma (PXA)",
  "U sao bào dưới màng não thất tế bào khổng lồ":
    "Subependymal giant cell astrocytoma (SEGA)",
  "U màng não thất": "Ependymoma",
  "U dưới màng não thất": "Subependymoma",
  "U đám rối mạch mạc": "Choroid plexus tumour",
  "U hạch thần kinh đệm": "Ganglioglioma",
  "U biểu mô thần kinh loạn sản phôi": "Dysembryoplastic neuroepithelial tumour (DNET)",
  "U nguyên bào tuỷ": "Medulloblastoma",
  "U quái không điển hình/dạng cơ vân": "Atypical teratoid/rhabdoid tumour (ATRT)",
  "U màng não": "Meningioma",
  "U xơ đơn độc": "Solitary fibrous tumour",
  "U nguyên bào mạch máu": "Haemangioblastoma",
  "U dây sống": "Chordoma",
  "U bao sợi thần kinh": "Schwannoma",
  "U sợi thần kinh": "Neurofibroma",
  "U tuyến yên": "Pituitary adenoma (PitNET)",
  "U sọ hầu": "Craniopharyngioma",
  "U tế bào mầm nội sọ": "Intracranial germ cell tumour",
  "U nhu mô tuyến tùng": "Pineal parenchymal tumour",
  "U lympho thần kinh trung ương nguyên phát": "Primary CNS lymphoma (PCNSL)",
  "U di căn": "Metastasis",
  "Nang keo": "Colloid cyst",
  "Nang màng nhện": "Arachnoid cyst",
  "U bì": "Dermoid cyst",
  "U thượng bì": "Epidermoid cyst",
  "U mỡ": "Lipoma",
  "U mạch thể hang": "Cavernous malformation",
  "Dị dạng thông động tĩnh mạch": "Arteriovenous malformation (AVM)",

  // What the diagnosis rests on
  "Hình ảnh": "Imaging",
  "Mô bệnh học": "Histopathology",

  // Treatment
  "Mổ": "Surgery",
  "Xạ": "Radiotherapy",
  "Hoá": "Chemotherapy",
  "Đích/Miễn dịch": "Targeted / immunotherapy",
  "Theo dõi": "Follow-up",
  "Tái phát/Tiến triển": "Recurrence / progression",
  "Biến chứng": "Complication",
  // The abbreviations an operation note is written with.
  "Lấy toàn bộ": "Gross total resection (GTR)",
  "Lấy gần toàn bộ": "Near total resection (NTR)",
  "Lấy một phần": "Subtotal resection (STR)",
  "Sinh thiết": "Biopsy",
  "Chỉ mở sọ giải áp": "Decompressive craniectomy only",
  "Dẫn lưu não thất": "Ventricular drainage",
  "Xạ phẫu Gamma Knife": "Gamma Knife radiosurgery",
  "Xạ phẫu CyberKnife": "CyberKnife radiosurgery",
  "Xạ toàn não": "Whole-brain radiotherapy (WBRT)",
  "Xạ trục não tuỷ": "Craniospinal irradiation (CSI)",
  "Temozolomide đồng thời": "Concurrent temozolomide",
  "Temozolomide bổ trợ": "Adjuvant temozolomide",

  // Molecular marker results.
  //
  // The two negative IDH answers are translated apart rather than both into
  // "negative", because the distinction between them is the whole reason the
  // marker has four answers: immunohistochemistry sees IDH1 R132H alone, so a
  // negative stain has not excluded the non-canonical IDH1 and IDH2
  // substitutions, and collapsing the two would read an untested tumour as a
  // wildtype one.
  "Đột biến": "Mutant",
  "Không đột biến": "Wildtype",
  "Không đột biến (đã giải trình tự)": "Wildtype (sequenced)",
  "IHC R132H âm tính (chưa giải trình tự)": "IHC R132H negative (not sequenced)",
  "Chưa làm": "Not performed",
  "Đồng mất": "Codeleted",
  "Không đồng mất": "Not codeleted",
  "Mất biểu hiện": "Loss of expression",
  "Còn biểu hiện": "Retained",
  "Mất đồng hợp tử": "Homozygous deletion",
  "Không mất đồng hợp tử": "No homozygous deletion",
  "Methyl hoá": "Methylated",
  "Không methyl hoá": "Unmethylated",
  "Dương tính lan toả (IHC)": "Diffuse positivity (IHC)",
  "K27M đột biến": "K27M mutant",
  "Mất biểu hiện H3K27me3": "H3K27me3 loss",
  "Không thay đổi": "Not altered",
  "G34R/V đột biến": "G34R/V mutant",
  "Khuếch đại": "Amplified",
  "Không khuếch đại": "Not amplified",
  "Thêm 7 mất 10 (+7/-10)": "+7/-10",
  "Không": "No",
  "V600E đột biến": "V600E mutant",
  "Hợp nhất KIAA1549-BRAF": "KIAA1549-BRAF fusion",
  "Hợp nhất": "Fusion present",
  "Không hợp nhất": "No fusion",
  "Dương tính": "Positive",
  "Âm tính": "Negative",
  "SHH TP53 tự nhiên": "SHH, TP53-wildtype",
  "SHH TP53 đột biến": "SHH, TP53-mutant",
  "Nhóm 3": "Group 3",
  "Nhóm 4": "Group 4",

  // What a marker's answers mean, shown under the row that takes them and as
  // the tooltip on an outstanding work-up item. Translated rather than left in
  // Vietnamese because the IDH one carries the distinction between a negative
  // antibody and a sequenced wildtype, which is the difference between a grade
  // 2 astrocytoma and a glioblastoma.
  "IHC chỉ bắt được IDH1 R132H. IHC âm tính chưa phải IDH tự nhiên, trừ u độ 4 ở bệnh nhân từ 55 tuổi trở lên.":
    "IHC detects only IDH1 R132H. A negative stain is not IDH-wildtype, except for a grade 4 tumour in a patient aged 55 or over.",
  "Đồng mất toàn nhánh là tiêu chuẩn bắt buộc của u thần kinh đệm ít nhánh. Mất một phần nhánh không tính.":
    "Whole-arm codeletion is an essential criterion for oligodendroglioma. Partial-arm loss does not count.",
  "Mất biểu hiện ATRX hướng về u sao bào và thực tế loại trừ đồng mất 1p/19q.":
    "ATRX loss points to astrocytoma and effectively excludes 1p/19q codeletion.",
  "Mất đồng hợp tử CDKN2A/B đưa u sao bào IDH đột biến lên độ 4 dù mô học chưa đủ tiêu chuẩn.":
    "Homozygous CDKN2A/B deletion makes an IDH-mutant astrocytoma grade 4 even when the histology falls short.",
  "MGMT không tham gia định danh u. Đây là yếu tố tiên lượng và dự báo đáp ứng temozolomide.":
    "MGMT does not name the tumour. It is prognostic and predicts response to temozolomide.",
  "U màng não: từ 4 nhân chia trở lên là độ 2, từ 20 trở lên là độ 3.":
    "Meningioma: 4 or more mitoses is grade 2, 20 or more is grade 3.",
  "Ghi tỉ lệ phần trăm, ví dụ 25%.": "Record a percentage, for example 25%.",
  "Ghi nhóm methyl hoá và điểm tin cậy nếu phiếu có.":
    "Record the methylation class and its calibrated score if the report gives one.",
  "/10 vi trường": "/10 HPF",

  // Marker names that are words rather than gene symbols.
  "Nhiễm sắc thể 7/10": "Chromosome 7/10",
  "Hồ sơ methyl hoá": "Methylation profile",
  "Nhóm u nguyên bào tuỷ": "Medulloblastoma subgroup",
  "Chỉ số nhân chia": "Mitotic count",
  "TERT promoter": "TERT promoter",

  // Marker families, as the picker groups them. The glioma, ependymal and
  // meningioma families are already translated above as tumour entities, and
  // one key carries both readings.
  "U phôi": "Embryonal tumour",
  "Chung": "General",

  // What a rule says when it fires: why a grade was outranked, and why two
  // recorded facts cannot both be true. Translated because a reader who is
  // told a grade moved has to be able to read the reason for it.
  "Mất đồng hợp tử CDKN2A/B trong u sao bào IDH đột biến là tiêu chuẩn độ 4 của WHO CNS5, không phụ thuộc mô học.":
    "Homozygous CDKN2A/B deletion in an IDH-mutant astrocytoma is a WHO CNS5 grade 4 criterion in its own right, whatever the histology shows.",
  "U màng não có đột biến TERT promoter hoặc mất đồng hợp tử CDKN2A/B được xếp độ 3 theo WHO CNS5.":
    "A meningioma with a TERT promoter mutation or homozygous CDKN2A/B deletion is CNS WHO grade 3.",
  "Đồng mất 1p/19q loại trừ u sao bào. Đối chiếu lại: đây nhiều khả năng là u thần kinh đệm ít nhánh.":
    "1p/19q codeletion excludes astrocytoma. Review this: it is more likely an oligodendroglioma.",
  "Tên chẩn đoán ghi IDH đột biến nhưng kết quả giải trình tự là không đột biến.":
    "The diagnosis is named IDH-mutant but the sequencing result is wildtype.",
  "Tên chẩn đoán ghi IDH tự nhiên nhưng kết quả xét nghiệm là đột biến.":
    "The diagnosis is named IDH-wildtype but the test result is mutant.",
  "Tên chẩn đoán ghi đồng mất 1p/19q nhưng kết quả là không đồng mất.":
    "The diagnosis names 1p/19q codeletion but the result is not codeleted.",
  "Tên chẩn đoán ghi H3 K27 thay đổi nhưng kết quả là không thay đổi.":
    "The diagnosis is named H3 K27-altered but the result is not altered.",
  "Tên chẩn đoán ghi H3 G34 đột biến nhưng kết quả là không đột biến.":
    "The diagnosis is named H3 G34-mutant but the result is not mutant.",

  // The condition a regimen is offered under, never left for the reader to
  // infer from the regimen's name.
  "Bệnh nhân từ 65-70 tuổi trở lên hoặc thể trạng kém":
    "Aged roughly 65-70 or over, or poor performance status",
  "MGMT methyl hoá, ở bệnh nhân cao tuổi không xạ được":
    "MGMT methylated, in an elderly patient unfit for radiotherapy",
  "Số lượng tổn thương hạn chế, bệnh ngoài sọ đang kiểm soát":
    "A limited number of lesions, with extracranial disease controlled",
  "Di căn lan toả nhiều ổ": "Diffuse, multifocal metastases",
  "Liều xạ trục hạ thấp ở nhóm nguy cơ chuẩn":
    "A reduced craniospinal dose in the standard-risk group",

  // Treatment protocols. The regimen names are translated; the doses and
  // schedules beside them are not, because a dose is written the same way in
  // both languages and a translated one is a dose somebody has retyped.
  "Phác đồ Stupp": "Stupp protocol",
  "Xạ giảm phân liều ± temozolomide": "Hypofractionated RT ± temozolomide",
  "Temozolomide đơn thuần": "Temozolomide alone",
  "Xạ khu trú + PCV": "Focal RT + PCV",
  "Xạ khu trú + temozolomide bổ trợ": "Focal RT + adjuvant temozolomide",
  "Theo dõi bằng hình ảnh": "Imaging surveillance",
  "Xạ khu trú": "Focal radiotherapy",
  "Hoá chất nền methotrexate liều cao": "High-dose methotrexate based",
  "Xạ trục não tuỷ + hoá chất": "Craniospinal irradiation + chemotherapy",
  "Hoá chất nền platinum + xạ": "Platinum-based chemotherapy + RT",
  "Xạ phẫu định vị": "Stereotactic radiosurgery",
  "Xạ toàn não bảo tồn hồi hải mã + memantine": "Hippocampal-avoidance WBRT + memantine",
  "Phẫu thuật rồi theo dõi": "Surgery then surveillance",
  // A protocol's kind reuses the event-kind wording above, so "Xạ", "Hoá" and
  // "Theo dõi" are not repeated here.
  "Xạ + Hoá": "RT + chemotherapy",
};

/**
 * A recorded clinical term, read out in the language on screen.
 *
 * Falls back to the term itself, which is the whole point: a histology typed
 * off a pathology report has no entry here and must reach the screen exactly as
 * it was written down.
 */
export function tc(term) {
  const text = String(term ?? "").trim();
  if (!text || language === "vi") return text;
  return CLINICAL_EN[text] ?? text;
}

/**
 * The same term as a *picker* shows it: both languages at once in Vietnamese.
 *
 * A dropdown is where the term is chosen, and the standard English name is what
 * the pathology report, the guideline and the tumour board all use — so
 * "U màng não (Meningioma)" is what a Vietnamese reader wants to see while
 * choosing, even though "U màng não" alone is what gets stored and what the
 * record reads back.
 */
export function tcPicker(term) {
  const text = String(term ?? "").trim();
  const english = CLINICAL_EN[text];
  if (!english || english === text) return text;
  return language === "vi" ? `${text} (${english})` : english;
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
  [/DICOMweb chưa liệt kê đủ instance của mọi series ảnh; không đánh dấu ca là hoàn tất\. (.+)/g,
    "DICOMweb did not list every image instance; the study was not marked complete. $1"],
  [/(.+): tìm thấy (\d+)\/không rõ instance/g,
    "$1: found $2/unknown instances"],
  [/(.+): tìm thấy (\d+)\/(\d+) instance/g,
    "$1: found $2/$3 instances"],
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
