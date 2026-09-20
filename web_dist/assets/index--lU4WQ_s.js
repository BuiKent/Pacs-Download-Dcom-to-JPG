import{i as Ps,a as Ns,b as Ds,P as Rn,Z as Bn,W as de,S as ma,L as Ro,A as Bo,E as qn,c as Fn,d as Ve,C as fe,T as Ie,R as ct,e as ee,M as ga,f as sn,g as Ls,s as qo,h as Lt,j as Et,O as re,V as Pt,k as ya,l as Es,m as Nt,n as Os,o as va,p as As,q as Vt,r as Rs,t as Bs,u as qs,I as mn}from"./cornerstone-DTOWQiL2.js";import"./vendor-4o8CNpcx.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))o(a);new MutationObserver(a=>{for(const r of a)if(r.type==="childList")for(const c of r.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&o(c)}).observe(document,{childList:!0,subtree:!0});function n(a){const r={};return a.integrity&&(r.integrity=a.integrity),a.referrerPolicy&&(r.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?r.credentials="include":a.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function o(a){if(a.ep)return;a.ep=!0;const r=n(a);fetch(a.href,r)}})();let Fo="",zt="";function Fs(t){Fo=t}function Ae(t){return zt=String(t||""),zt}function Hs(){return zt}function gn(t){const e=new URLSearchParams({token:Fo});return zt&&e.set("session",zt),`${t}${t.includes("?")?"&":"?"}${e.toString()}`}function Ho(){const t={"X-DCom-Token":Fo};return zt&&(t["X-Viewer-Session"]=zt),t}async function N(t,e={}){const n=await fetch(t,{...e,cache:"no-store",headers:{"Content-Type":"application/json",...Ho(),...e.headers||{}}}),a=(n.headers.get("content-type")||"").includes("application/json")?await n.json():await n.text();if(!n.ok)throw new Error(a?.error||a||`HTTP ${n.status}`);return a}async function je(t){const e=await fetch(t,{headers:Ho()});if(!e.ok){let n=`HTTP ${e.status}`;try{n=(await e.json()).error||n}catch{}throw new Error(n)}return e.blob()}async function _s(t){const e=await fetch(t,{headers:Ho()});if(!e.ok){let o=`HTTP ${e.status}`;try{o=(await e.json()).error||o}catch{}throw new Error(o)}const n=(o,a)=>{const r=Number(e.headers.get(o));return Number.isFinite(r)?r:a};return{buffer:await e.arrayBuffer(),pixelType:e.headers.get("X-DCom-Pixel-Type")||"uint16",rows:n("X-DCom-Rows",0),columns:n("X-DCom-Columns",0),samples:n("X-DCom-Samples",1),min:n("X-DCom-Min",0),max:n("X-DCom-Max",0),slope:n("X-DCom-Slope",1),intercept:n("X-DCom-Intercept",0),windowCenter:n("X-DCom-Window-Center",0),windowWidth:n("X-DCom-Window-Width",1),photometric:e.headers.get("X-DCom-Photometric")||"MONOCHROME2"}}function ba(t,e){return`/api/series/${t}/image/${e}`}function Gs(t){return`/api/series/${t}/thumbnail`}let Xt="en";function wa(t){return Xt=t==="vi"?"vi":"en",Xt}function Re(){return Xt}const go={"DICOM/JPG Downloader & Viewer":"DICOM/JPG Downloader & Viewer",Series:"Series","So sánh ba series cạnh nhau":"Compare three series side by side","Khoá cuộn theo vị trí":"Lock scrolling by position","Đã bỏ khoá: mỗi khung cuộn riêng.":"Unlocked: each pane scrolls on its own.","Thu gọn khu tải phim":"Collapse download panel","Mở khu tải phim":"Expand download panel","Tải phim":"Download","Mở folder DICOM hoặc JPG/PNG trong viewer":"Open a DICOM or JPG/PNG folder in the viewer","Quét lại thư mục hiện tại":"Rescan the current folder","Chuyển sang tiếng Anh":"Switch to Vietnamese","Mở thư mục nhật ký (log) phiên làm việc":"Open session log folder","Mở thư mục nhật ký":"Open log folder","Nhật ký phiên làm việc (Logs)":"Session Activity Logs","Mở thư mục Log":"Open Logs Folder","Mở thư mục Log trong Explorer":"Open Logs folder in Explorer","Ghi log tự động mỗi lần khởi chạy — lưu tại thư mục logs/":"Session logs automatically recorded upon each launch in logs/ folder","Giao diện":"Theme","Lịch sử":"History","Mở lại thư mục đã tải hoặc đã xem":"Reopen a downloaded or previously viewed folder","Chưa có lịch sử":"No history yet","(thư mục không còn)":"(folder is gone)","Worklist & Danh Sách Ca Chụp":"Worklist & Study List","Danh sách bệnh nhân & ca chụp":"Patient Worklist & Studies","Danh sách bệnh nhân":"Patient list","Hoạt động & hàng đợi":"Activity & Queue","Tổng hồ sơ":"Total records","Tab đang mở":"Open tabs","Tìm kiếm mã BN, tên bệnh nhân, thư mục...":"Search patient ID, name, folder...","Chưa có hồ sơ nào trong danh sách":"No records in list","Mở folder bệnh nhân":"Open patient folder","Xem phim":"View study","Đóng tab":"Close tab","Chưa rõ mã BN":"Patient ID unknown","Chưa có thông tin hành chính":"No demographics recorded",STT:"No.","Họ và tên":"Patient Name","Mã BN":"Patient ID","Bệnh nhân / Đợt khám":"Patient / Studies","Ngày chụp":"Study date","Trạng thái":"Status","Thao tác":"Actions",Action:"Actions","{} đợt khám":"{} studies","Sắp xếp theo Họ và tên":"Sort by Patient Name","Sắp xếp theo Mã BN":"Sort by Patient ID","Sắp xếp theo Ngày chụp":"Sort by Study Date","Ngày thêm":"Date added","Sắp xếp theo Ngày thêm":"Sort by Date Added","Sao chép ngày thêm":"Copy date added","Loại chụp":"Modality","Trạng thái đọc":"Read status","Mọi thời điểm":"Any date","Hôm nay":"Today","7 ngày":"Last 7 days","30 ngày":"Last 30 days","Tất cả":"All","Chưa đọc":"Unread","Đã đọc":"Read","Bỏ lọc":"Clear filters","{} ca chưa đọc":"{} unread","Đánh dấu đã đọc":"Mark as read","Bỏ đánh dấu đã đọc":"Mark as unread","Xuất hồ sơ":"Export record","Xuất hồ sơ cho bệnh nhân":"Export record for the patient","Xuất ảnh JPG kèm trang index.html để bệnh nhân mở bằng trình duyệt":"Export the JPGs with an index.html the patient can open in a browser","Đang xuất hồ sơ sang thư mục đã chọn…":"Exporting the record to the chosen folder…","Hồ sơ này chưa có thư mục trên đĩa.":"This record has no folder on disk.","Chọn thư mục xuất cần chạy trong ứng dụng WebView2.":"Choosing an export folder requires the WebView2 app.","Thu nhỏ cửa sổ":"Minimize","Phóng to / Khôi phục":"Maximize / Restore","Đóng ứng dụng":"Close","Mở folder hồ sơ: phim, ảnh, video và văn bản đều được nhận diện":"Open a record folder — studies, photos, video and text are all detected","Chưa mở hồ sơ nào":"No record open","Mở folder hồ sơ; app tự phân loại phim DICOM, ảnh, video và văn bản bên trong.":"Open a record folder; the app sorts the DICOM studies, photos, video and text inside it.","Mở folder":"Open folder","Thông tin ca":"Case details","Thu gọn thông tin ca":"Collapse case details","Mở thông tin ca":"Expand case details","Mở thông tin ca ( [ )":"Expand case details ( [ )","Tải ca chụp":"Downloads","Lịch sử mở gần đây":"Recent history","Thông tin bệnh nhân":"Patient Information","Sửa thông tin bệnh nhân":"Edit Patient Info","Chỉnh sửa thông tin bệnh nhân":"Edit patient information",Sửa:"Edit",Lưu:"Save","Lưu thay đổi":"Save changes",Hủy:"Cancel","Giới tính":"Gender","Năm sinh":"Birth Year","Số điện thoại":"Phone Number","Điện thoại":"Phone","Địa chỉ":"Address","Nhập họ tên":"Enter patient name","Nhập mã BN":"Enter patient ID","Nhập SĐT":"Enter phone number","Nhập địa chỉ":"Enter address","Tên bệnh viện":"Hospital name","Chẩn đoán / Ghi chú":"Diagnosis / Notes",Nam:"Male",Nữ:"Female",Khác:"Other","Đã lưu thông tin bệnh nhân.":"Patient information saved.","Lỗi:":"Error:","Chưa có tên bệnh nhân":"Patient name not recorded","Bệnh viện":"Hospital","Chẩn đoán":"Diagnosis","Lịch sử khám":"Exam history","Chưa có dữ liệu nào trong hồ sơ này.":"Nothing recorded for this patient yet.","Chưa rõ ngày chụp":"Date not recorded","Chưa có mô tả":"No description","{} tuổi":"{} years old","{}T":"{}y","Sao chép số điện thoại":"Copy phone number","Series DICOM này thiếu hình học: chỉ xem/zoom/pan; không dùng kết quả đo vật lý.":"This DICOM series has no usable geometry: view/zoom/pan only; do not rely on physical measurements.","Tên hiển thị trên timeline":"Timeline display name","Đổi tên lần chụp hoặc loại media":"Rename this study or media entry","Lưu tên":"Save name","Bỏ thay đổi tên":"Cancel name change","Đã lưu tên hiển thị trên timeline.":"Timeline display name saved.","Dữ liệu gốc DICOM (Ưu tiên dựng từ DICOM)":"Original DICOM data (prioritized for reconstruction)","Dữ liệu ảnh chuyển đổi JPG":"Converted JPG image data","Hoàn tác bước chỉnh sửa":"Undo the last edit","Làm lại bước vừa hoàn tác":"Redo the edit just undone","Đã hoàn tác đến bước {}/{}.":"Undid to edit {} of {}.","Đã làm lại đến bước {}/{}.":"Redid to edit {} of {}.","Đã quay lại file gốc trong hồ sơ.":"Back to the original file in the record.",Ảnh:"Photos","Phim chụp":"Study","Văn bản":"Text","Bệnh án PDF":"PDF records","Chưa có tài liệu nào":"No document here","Lưu vào hồ sơ":"Save to record","Chưa có chỉnh sửa nào để lưu.":"There is no edit to save yet.","Đã lưu vào hồ sơ: {}":"Saved to the record: {}","Hãy kéo chuột trên ảnh để chọn vùng trước.":"Drag on the image to select a region first.","Đã chọn vùng {}×{} px. Chọn công cụ để áp dụng.":"Selected {}×{} px. Pick a tool to apply it.","Đang mở hồ sơ…":"Opening record…","Đang mở…":"Opening…","Chưa rõ định dạng nguồn":"Source format not recorded","Không mở được hồ sơ":"Could not open the record","Đã lưu chẩn đoán vào hồ sơ bệnh nhân.":"Diagnosis saved to the patient record.","Chưa có văn bản nào":"No text file here","Đang đọc file…":"Reading file…",Chép:"Copy","Series video hoặc văn bản, không dựng MPR.":"Video or text series — no MPR reconstruction.","Ca chụp chưa có mô tả":"Study has no description","Chưa đếm":"Not counted yet","Chưa quét":"Not scanned yet","{} series":"{} series","{} lát":"{} slices",series:"series",video:"videos",trang:"pages","bệnh nhân":"patients","hồ sơ":"studies","ảnh & lát":"images & slices","phút video":"video length","trên đĩa":"on disk","cần xử lý":"need attention","Tải tiếp":"Resume download","Ca chụp này không lưu link viewer để tải tiếp.":"This study has no stored viewer link to resume from.","Đã nạp link của ca chụp. Quét series rồi bấm Thử lại để tải tiếp.":"Study link loaded. Scan the series, then press Retry to resume.","Đã tải series đã chọn":"Selected series downloaded","Chưa hoàn tất":"Incomplete","Thiếu folder":"Folder missing","Đang tải":"Downloading","X-Quang":"X-ray","Bệnh án":"Records","Tổng quan kho & dữ liệu":"Archive & Data Overview","Thư mục nguồn bệnh nhân":"Patient Source Folders","Thêm thư mục nguồn":"Add source folder","Thêm thư mục":"Add folder","Mặc định":"Default","Không tồn tại":"Not found","Mở trong Explorer":"Open in Explorer","Xóa thư mục khỏi danh sách":"Remove folder from list","Nhập đường dẫn thư mục nguồn:":"Enter source folder path:","Đã thêm thư mục nguồn: {}":"Added source folder: {}","Đã thêm thư mục nguồn thành công.":"Source folder added successfully.","Đã xóa thư mục nguồn: {}":"Removed source folder: {}","Chưa có thư mục nguồn nào được cấu hình.":"No source folders configured.","Hồ sơ gần đây":"Recent records","Series trong kho":"Series in archive","Ảnh & lát cắt":"Images & slices","Đang xử lý":"In progress","Gần đây":"Recent",Mở:"Open","Đang chạy...":"Running...","Không có tác vụ nào đang chạy.":"No task is running.","Chưa có thư mục nào được mở hoặc tải.":"No folder has been opened or downloaded yet.","Tác vụ nền":"Background task","Tải ca theo mã bệnh nhân":"Download by patient ID","Tải theo link viewer":"Download from viewer link","Nhập thư mục từ đĩa":"Import folder from disk","Quét lại kho":"Rescan archive","Tìm ca chụp":"Search studies","Dò danh sách series":"Discover series list","Đang tải danh sách bệnh nhân…":"Loading patient list…","Danh sách đã cập nhật":"Patient list is up to date","Danh sách lúc {}":"Patient list as of {}","Ca chụp đang được tải, mở lúc này sẽ thiếu lát cắt":"This study is still downloading; opening it now would show missing slices","Không đồng bộ được danh sách":"Patient list could not be synced","Không tải được danh sách bệnh nhân":"Could not load the patient list","Đang hiển thị dữ liệu lần quét trước.":"Showing data from the previous scan.","Thử quét lại":"Try scanning again","Quét lại":"Rescan","Phòng Xử Lý Video Phẫu Thuật":"Surgery Video Studio","Trình Chỉnh Sửa Ảnh & Tài Liệu":"Photo & Document Editor","Tua lùi 5s":"Rewind 5s","Tua tới 5s":"Forward 5s","Tốc độ":"Speed","Cắt clip":"Trim Clip","Đánh dấu mốc":"Add Bookmark","Mốc phẫu thuật / Ghi chú":"Surgical Bookmarks / Notes","Mốc phẫu thuật":"Surgical bookmark","Bấm để tua video đến mốc này":"Click to seek the clip to this point","Tua đến {} — {}":"Seek to {} — {}","Đã tua đến {}.":"Seeked to {}.","Chuyển sang clip này và tua đến mốc":"Switch to this clip and seek to the point","Thời điểm bắt đầu":"Start Time","Thời điểm kết thúc":"End Time","Xuất clip":"Export Clip","Ghép video":"Concat Videos","Chụp khung hình":"Capture Snapshot","Xoay 90°":"Rotate 90°","Tùy chọn xuất hồ sơ":"Export Record Options","Hồ sơ này có cả ảnh JPG và file gốc DICOM. Vui lòng chọn định dạng muốn xuất ra USB / thư mục:":"This record contains both JPG images and raw DICOM files. Please choose the export format:","Web PACS Viewer (Ảnh JPG)":"Interactive Web PACS Viewer (JPG)","Khuyên dùng":"Recommended","Tạo trang web tự động chạy offline trên mọi trình duyệt. Có thanh cuộn lát cắt, đổi chuỗi xung, phóng to/thu nhỏ, tương phản W/L và so sánh 2 xung song song.":"Creates an offline web viewer running on any browser. Features slice scrolling, series switching, zoom/pan, W/L contrast and 2-up comparison.","ảnh JPG":"JPG images","Nhẹ, mở tức thì trên mọi máy tính":"Lightweight, opens instantly on any PC","File gốc DICOM":"Original DICOM Files","Máy trạm PACS":"PACS Workstations","Xuất toàn bộ file chụp gốc DICOM tiêu chuẩn y khoa chất lượng cao nhất, kèm file hướng dẫn mở bằng RadiAnt, Weasis, MicroDicom, Horos...":"Exports all original diagnostic-quality DICOM files with instructions for RadiAnt, Weasis, MicroDicom, Horos...","file DICOM":"DICOM files","Dành cho bác sĩ CĐHA chuyên sâu":"For radiologists and specialized PACS viewers","Xuất đầy đủ (Cả Web Viewer + DICOM)":"Complete Export (Web Viewer + DICOM)","Tất cả định dạng":"All formats","Bao gồm cả Web PACS Viewer xem nhanh trên trình duyệt lẫn thư mục file gốc DICOM đầy đủ cho máy trạm.":"Includes both the browser-friendly Web PACS Viewer and the complete raw DICOM folder for workstations.","Cắt vùng chọn":"Crop","Che tên/danh tính":"Redact / Hide Identity","Vẽ mũi tên":"Arrow","Khoanh vùng":"Box","Ghi chú chữ":"Text","Công cụ vẽ":"Drawing tools","Chọn / di chuyển":"Select / move","Mũi tên chỉ điểm":"Arrow","Đường thẳng":"Line","Khung chữ nhật":"Rectangle","Khung bầu dục":"Ellipse","Bút vẽ tay":"Freehand","Chèn chữ":"Text","Đánh số thứ tự":"Numbered marker","Tô sáng vùng":"Highlight","Làm mờ vùng":"Pixelate","Che kín danh tính":"Redact identity","Cắt ảnh theo vùng chọn":"Crop to selection",Màu:"Colour","Chọn màu tuỳ ý":"Pick any colour",Nét:"Width","Cỡ chữ":"Text size","Độ đậm":"Opacity","Tô đặc":"Filled","Cắt theo vùng chọn":"Crop to selection","Xoá hình đang chọn":"Delete selected","Xoá hết nét vẽ":"Clear drawing","Nội dung ghi chú trên ảnh":"Note text on the image","Xoay trái 90°":"Rotate left 90°","Xoay phải 90°":"Rotate right 90°","Thu nhỏ":"Zoom out","Phóng to":"Zoom in","Vừa khung":"Fit","Áp dụng lên ảnh":"Apply to image","Vẽ đè vĩnh viễn lên ảnh":"Burn the drawing into the image","Tải ảnh về":"Download image","Chưa vẽ gì":"Nothing drawn","Chưa vẽ gì trên ảnh.":"Nothing drawn on the image.","{} nét chưa áp dụng":"{} not applied yet","Đang chọn: {}":"Selected: {}","Đã chọn vùng cắt {}×{} px. Bấm “Cắt ảnh” để áp dụng.":"Crop area {}×{} px selected. Press “Crop” to apply.","Hãy kéo chuột để chọn vùng cần cắt.":"Drag on the image to choose the crop area.","Hãy kéo chuột trên ảnh để chọn vùng cần cắt.":"Drag on the image to choose the crop area.","Đã xoá các nét vẽ chưa áp dụng.":"Cleared the unapplied drawing.","Chưa vẽ gì trên ảnh để áp dụng.":"Nothing has been drawn on the image yet.","Đang vẽ {} chi tiết lên ảnh...":"Burning {} marks into the image...","Đã vẽ {} chi tiết lên ảnh.":"Burned {} marks into the image.","Đã cắt ảnh còn {}×{} px.":"Cropped to {}×{} px.","Ảnh chưa có chỉnh sửa nào; hãy mở file gốc trong thư mục hồ sơ.":"This photo has no edits yet; open the original from the record folder.","Đã tải ảnh đã chỉnh sửa về máy.":"Edited image downloaded.","Đã hoàn tác nét vẽ.":"Drawing step undone.","Đã vẽ lại nét vừa hoàn tác.":"Drawing step redone.","Cắt giữ lại đoạn đã đánh dấu":"Keep only the marked span","Ghi nét vẽ vĩnh viễn vào video":"Burn the drawing into the video","Áp dụng lên video":"Apply to video","Thanh tua video":"Video scrubber","Đặt điểm đầu tại vị trí đang xem":"Set the in point at the playhead","Đặt điểm cuối tại vị trí đang xem":"Set the out point at the playhead",Đầu:"In",Cuối:"Out","Chưa chọn đoạn":"No span marked","Bỏ đoạn đã đánh dấu":"Clear the marked span","Hãy đặt điểm đầu trước, ở vị trí sớm hơn điểm cuối.":"Set the in point first, earlier than the out point.","Đã đặt điểm đầu tại {}.":"In point set at {}.","Đã chọn đoạn {} → {}.":"Span {} → {} selected.","Đã bỏ đoạn đã đánh dấu.":"Marked span cleared.","Chưa vẽ gì trên video để áp dụng.":"Nothing has been drawn on the video yet.","Đang ghi {} nét vẽ vào video ({} → {})...":"Burning {} marks into the video ({} → {})...","Đang ghi {} nét vẽ vào toàn bộ video...":"Burning {} marks into the whole video...","Đã ghi {} nét vẽ vào video.":"Burned {} marks into the video.","Hãy đánh dấu điểm đầu (I) và điểm cuối (O) trên thanh tua trước.":"Mark the in (I) and out (O) points on the scrubber first.",Hiện:"Show for","Toàn bộ":"Whole clip","Nhóm: {}":"Group: {}","Chẩn đoán ghi trong hồ sơ: {}":"Diagnosis recorded in the chart: {}","Trước mổ":"Before surgery","Trước xạ":"Before radiotherapy","Trước hoá":"Before chemotherapy","Trước điều trị đích":"Before targeted therapy","Trong đợt xạ":"During radiotherapy","Trong đợt hoá":"During chemotherapy","Trong đợt điều trị đích":"During targeted therapy","Sau mổ":"After surgery","Sau xạ":"After radiotherapy","Sau hoá":"After chemotherapy","Sau điều trị đích":"After targeted therapy","Sau khi ghi tái phát":"After the recorded relapse","Sau biến chứng":"After the complication","Sau lần khám":"After the visit","cùng ngày":"same day","{} ngày":"{} days","{} tuần":"{} weeks","{} tháng":"{} months","Ngày kết thúc là ước tính từ số buổi xạ, chưa ai xác nhận.":"The end date is estimated from the fraction count; nobody has confirmed it.","Nằm trong 12 tuần sau xạ — cân nhắc giả tiến triển trước khi kết luận tiến triển.":"Within 12 weeks of radiotherapy — weigh pseudoprogression before calling this progression.","Thư mục này chưa có patient-index.json nên chưa ghi được hồ sơ lâm sàng.":"This folder has no patient-index.json, so it cannot hold a clinical record.",Xoá:"Remove","Ghi chú":"Note","Chưa rõ":"Not recorded","Vị trí":"Location","Tái phát":"Relapse","Hậu phẫu":"Post-op","Đang xạ":"On radiotherapy","Đang hoá":"On chemotherapy","Đang điều trị đích":"On targeted therapy",xạ:"radiotherapy",hoá:"chemo",đích:"targeted","chưa cập nhật":"not updated","Đang điều trị":"In treatment","Chưa ghi":"Not recorded","Giai đoạn":"Stage","từ {}":"from {}","đến {}":"until {}","Chưa rõ ngày":"Date not recorded","{} buổi":"{} fractions","{} chu kỳ":"{} cycles","{} (độ {})":"{} (grade {})","Độ {}":"Grade {}","độ {}":"grade {}","Khối u chưa mô tả":"Tumour not described","Hồ sơ lâm sàng":"Clinical record","Hồ sơ bệnh nhân":"Patient record","Sửa hồ sơ bệnh nhân":"Edit this patient record","Chẩn đoán & điều trị":"Diagnosis & treatment","Đã lưu hồ sơ bệnh nhân.":"Patient record saved.","Ghi tự do: lưu ý khi đọc phim, hẹn khám…":"Free text: what to watch for when reading, appointments…","Đang lưu…":"Saving…","Đang sửa ở khung bên phải.":"Being edited in the pane on the right.","Còn bản sửa chưa lưu.":"There are unsaved edits.","Sửa hồ sơ lâm sàng":"Edit clinical record","Lưu hồ sơ lâm sàng":"Save clinical record","Đang tải hồ sơ lâm sàng…":"Loading clinical record…","Đã lưu hồ sơ lâm sàng.":"Clinical record saved.","Chưa ghi hồ sơ lâm sàng cho bệnh nhân này.":"No clinical record has been entered for this patient.","Chẩn đoán dựa trên: {}":"Diagnosis based on: {}","Chưa ghi chẩn đoán này dựa trên gì":"Nobody has recorded what this diagnosis rests on","Chưa rõ căn cứ":"Basis not recorded","Khối u {}":"Tumour {}","Thêm khối u":"Add tumour","Chưa có khối u nào được mô tả.":"No tumour has been described yet.",Khoang:"Compartment","Chưa chọn":"Not chosen","Chọn hoặc gõ vị trí":"Pick or type a location",Bên:"Side",Trục:"Axis","Chọn hoặc gõ":"Pick or type","Mô bệnh học":"Histology","Chọn hoặc gõ chẩn đoán":"Pick or type a diagnosis","Độ WHO":"WHO grade","Căn cứ":"Basis","Ngày có kết quả":"Result date","Ghi chú khối u":"Tumour note","Tuỳ chọn":"Optional","Dấu ấn phân tử":"Molecular markers","Tên dấu ấn":"Marker","Kết quả":"Result","Thêm dấu ấn":"Add marker","Thêm dấu ấn khác":"Add another marker","Chọn chẩn đoán mô bệnh học để app hỏi đúng bộ dấu ấn.":"Choose a histological diagnosis and the app will ask for the right markers.","Bắt buộc":"Essential","Danh sách":"List","Khác…":"Other…","Gõ chẩn đoán theo phiếu giải phẫu bệnh":"Type the diagnosis as the report words it","Quay lại danh sách đáp án, xoá nội dung đang gõ":"Go back to the listed answers, clearing what has been typed","Xoá dấu ấn":"Remove marker","Dấu ấn mới":"New marker","Kết quả ({})":"Result ({})",hoặc:"or","chưa làm":"not performed","chưa đọc được":"not recognised","Ô này có chữ nhưng không khớp đáp án nào trong danh sách, nên không luật nào đọc được.":"This field holds text that matches none of the listed answers, so no rule can read it.","Bắt buộc còn thiếu":"Essential, still missing","Nên có":"Recommended","Chẩn đoán tích hợp":"Integrated diagnosis","Chưa tích hợp":"Not yet integrated","Mô bệnh học và phân tử đã đủ để kết luận chẩn đoán tích hợp":"Histology and molecular results are sufficient for an integrated diagnosis","Chưa đủ căn cứ cho chẩn đoán tích hợp theo WHO CNS5":"Not enough evidence for an integrated diagnosis under WHO CNS5","Độ đã ghi {} · theo phân tử là độ {}":"Recorded grade {} · molecular grade {}","Phác đồ chuẩn":"Standard protocol","Cân nhắc theo bối cảnh":"Consider in context","Khi: {}":"When: {}","Điều trị":"Treatment","Sự kiện {}":"Event {}","Thêm sự kiện":"Add event","Chưa có mốc điều trị nào.":"No treatment has been recorded yet.",Loại:"Kind","Bắt đầu":"Start","Kết thúc":"End","Để trống ngày kết thúc nghĩa là đang diễn ra.":"Leaving the end date empty means it is still going.","Nơi thực hiện":"Where","Bệnh viện, trung tâm":"Hospital or centre","Mức độ lấy u":"Extent of resection","Kỹ thuật":"Technique","Liều (Gy)":"Dose (Gy)","Số buổi":"Fractions","Có số buổi thì app tự biết đợt xạ quá hạn cập nhật.":"With a fraction count the app can tell when a course is overdue an update.","Phác đồ":"Regimen","Đã xong":"Done","Tổng chu kỳ":"Total cycles","Chẩn đoán đọc từ tên thư mục: {}":"Diagnosis read from the folder name: {}","suốt video":"for the whole clip","Trình duyệt không mở được định dạng này":"The browser cannot open this format","File vẫn còn nguyên trong hồ sơ. Chuyển sang MP4 để xem, cắt và vẽ lên nó.":"The file is untouched in the record. Convert it to MP4 to view, trim and draw on it.","Chuyển sang MP4":"Convert to MP4","Nét vẽ mới sẽ hiện {}.":"New marks will show {}.","Đã đổi “{}” sang hiện {}. Nét vẽ mới cũng vậy.":"Changed “{}” to show {}. New marks too.","Đang ghi {} nét vẽ vào video ({} nét theo mốc thời gian)...":"Burning {} marks into the video ({} of them timed)...","Trình duyệt không phát được định dạng {} — bấm “Tối ưu MP4” để chuyển đổi rồi xem.":"The browser cannot play {} — press “Optimise MP4” to convert it first.","Xuất file PDF":"Export PDF","Lưu ảnh mới":"Save New Image",Phát:"Play","Tạm dừng":"Pause","Đã sao chép":"Copied","Sao chép":"Copy","Đã sao chép vào clipboard!":"Copied to clipboard!","Không thể sao chép":"Could not copy","Nhấp đúp hoặc bấm icon để sao chép":"Double-click or click icon to copy","Sao chép tên bệnh nhân":"Copy patient name","Sao chép mã BN":"Copy patient ID","Sao chép ngày chụp":"Copy study date","Sao chép tên ca chụp":"Copy study heading","Chưa có video nào":"No video selected","Chưa có ảnh nào":"No photo selected","TẢI MRI / CT":"DOWNLOAD MRI / CT","Tính năng xuất JPG riêng; không dùng để mở DICOM trong viewer.":"A separate JPG export feature; not the way to open DICOM in the viewer.","Chuyển Dcom → JPG":"Convert DICOM → JPG","Phát hiện tài liệu & Báo cáo đính kèm":"Detected Attachments & Reports","Tải kèm toàn bộ tài liệu đính kèm (PDF, TXT, Báo cáo)":"Download all attachments (PDF, TXT, Reports)","Các tệp này sẽ được tải riêng vào thư mục DOCUMENTS":"These files will be saved in the DOCUMENTS folder","Tài liệu đính kèm":"Attachments","Tải kèm":"Include","Tài liệu":"Documents","Mã bệnh nhân":"Patient ID","Tìm ca":"Find studies","Tìm các ca MRI/CT của mã bệnh nhân này trên RIS":"Search RIS for this patient's MRI/CT studies","Link viewer":"Viewer link","Xóa mã bệnh nhân":"Clear the patient code","Xóa link viewer":"Clear the viewer link","Bổ sung thông tin bệnh nhân":"Add patient info","Tên bệnh nhân":"Patient name","Mã BN (ID)":"Patient ID","Năm sinh / Ngày sinh":"DOB / Birth year","Chất lượng JPG (70-100)":"JPG quality (70-100)","Tải tất cả file":"Download all files","Hiện trình duyệt tải":"Show the download browser","Quét danh sách series":"Scan series list","Chọn tất cả series":"Select all series","Bỏ chọn tất cả series":"Deselect all series","Bỏ chế độ tải tất cả, sau đó quét để chọn T1, T2, FLAIR hoặc series cụ thể.":"Turn off download all, then scan to choose T1, T2, FLAIR, or an exact series.","Hãy chọn ca chụp hoặc nhập link viewer trước khi quét series.":"Select a study or enter a viewer link before scanning series.","Hãy tích ít nhất một ngày chụp trước khi quét series.":"Tick at least one study date before scanning series.","Đang quét danh sách series; chưa tải file ảnh…":"Scanning the series list; no image files are being downloaded…","Đã quét {} nhóm series; hãy bỏ tích những series không muốn tải.":"Scanned {} series groups; untick the series you do not want.","Chưa quét hoặc chưa chọn series cho link viewer.":"The viewer link has not been scanned or no series is selected.","Hãy tích ít nhất một ngày chụp để tải.":"Tick at least one study date to download.","Chưa quét series cho ca {}; hãy bấm Quét danh sách series.":"No series scanned for {}; press Scan series list.","Ca {} chưa tích series nào.":"{} has no series ticked.","Còn {} ca đang tích chưa chọn được series nào.":"{} ticked studies still have no series selected.",ảnh:"images","T1 sau tiêm":"Post-contrast T1","Tưới máu":"Perfusion","Mạch máu":"Angiography","Thư mục lưu":"Storage folder","Đổi thư mục lưu":"Change the storage folder","Tải ca đã chọn":"Download selected","Tải các ca đang tích ở danh sách trên":"Download the studies ticked above","Tải link":"Download link","Tải mới từ link đã dán vào một folder riêng":"Download the pasted link into a new folder","Thử lại":"Retry","Thử lại link vừa dán và gộp vào folder cũ, bỏ qua ảnh đã có":"Retry the pasted link, merging into the existing folder and skipping images already downloaded",Dừng:"Stop","Dừng an toàn tác vụ đang chạy":"Safely stop the running task","Không tạo được phiên riêng cho hồ sơ vừa tải.":"Could not create an isolated viewer session for the downloaded record.","Chưa tìm ca chụp.":"No studies found yet.","Đã tải":"Downloaded","Tải chưa hoàn tất":"Incomplete","Phim mới":"New study","Sao chép toàn bộ nhật ký":"Copy complete log to clipboard","Xoá hiển thị":"Clear display","Chưa có nội dung nhật ký để sao chép.":"No log contents to copy.","Đã sao chép toàn bộ nhật ký (log)!":"Copied complete log to clipboard!","Đã xoá hiển thị nhật ký.":"Log display cleared.","Không tự động gộp bệnh nhân":"Automatic patient merge blocked","Mã {} đã lưu tên “{}”, nhưng RIS trả “{}”. Hãy kiểm tra lại.":"Code {} is stored under the name “{}”, but RIS returned “{}”. Please re-check.","Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất":"Already in the archive · {} downloaded · {} new · {} incomplete","{} ca chưa có trong kho; app sẽ tạo một folder bệnh nhân.":"{} studies are not in the archive yet; a patient folder will be created.","Đã nhận diện {} ca từ folder Classic cũ":"Recognised {} studies from an old Classic folder","Một khung ảnh":"Single pane","So sánh hai series cạnh nhau":"Compare two series side by side","Xem tuần tự 6 lát":"View 6 consecutive slices","Xem tuần tự 8 lát":"View 8 consecutive slices","MPR ba mặt phẳng":"Three-plane MPR","Series không đủ MPR":"Series cannot support MPR","Dựng volume 3D toàn màn hình":"Full-screen 3D volume rendering","Series không đủ 3D":"Series cannot support 3D","DICOM mặc định":"DICOM default","Toàn dải":"Full range","Cửa sổ rộng":"Wide window","Mô mềm JPG":"JPG soft tissue","Cửa sổ hẹp":"Narrow window","Tương phản cao":"High contrast","Cửa sổ Hounsfield (HU)":"Hounsfield window (HU)","Cửa sổ theo WC/WW trong file":"Window from the file's own WC/WW","Preset thị giác 8-bit":"8-bit visual preset",Não:"Brain","Đột quỵ / hố sau":"Stroke / posterior fossa","Máu tụ dưới màng cứng":"Subdural",Xương:"Bone","Xương thái dương":"Temporal bone","Định vị MPR":"MPR crosshair","Xoay khối 3D tự do":"Orbit the 3D volume","Ghi chú chữ lên ảnh":"Add a text note","Nội dung ghi chú":"Note text",Thêm:"Add",Bỏ:"Cancel","Lật dọc khung đang chọn":"Flip the active pane vertically","Xóa mọi phép đo, ROI và ghi chú":"Clear every measurement, ROI and note","Lưu đo/ROI/ghi chú":"Save measurements, ROIs and notes","Khung đang xem không đảo màu được.":"The current pane cannot be inverted.","Di chuyển":"Pan","Thu/phóng":"Zoom","Sáng/tương phản":"Window level","Đo chiều dài (mm)":"Measure length (mm)","Đo chiều dài (pixel)":"Measure length (pixels)","Đo góc":"Measure angle","Kính lúp":"Magnifier","Thước tỉ lệ (mm)":"Scale bar (mm)","ROI ellipse":"Ellipse ROI","ROI tự do":"Freehand ROI","Đặt lại ba mặt phẳng":"Reset all three planes","Đặt lại góc nhìn":"Reset the camera","Đặt lại hiển thị":"Reset the display","Xoay khung đang chọn 90° theo chiều kim đồng hồ":"Rotate the active pane 90° clockwise","Lật ngang khung đang chọn":"Flip the active pane horizontally","Lưu ảnh 3D":"Save the 3D image","Lưu ảnh":"Save image","Lưu đo/ROI":"Save measurements/ROIs","Tính thể tích ROI":"Compute ROI volume","Đảo màu":"Invert","Chạy phim":"Play cine","Đang chạy phim — nhấn Space để dừng.":"Cine running — press Space to stop.","Đã dừng chạy phim.":"Cine stopped.","Mở folder DICOM hoặc JPG/PNG":"Open a DICOM or JPG/PNG folder","Mở folder trong viewer":"Open a folder in the viewer","Đang khởi động...":"Starting up...","Đang dựng khung xem…":"Building the layout…","Đang mở ảnh…":"Opening images…","Không mở được khung xem":"Could not open the layout","An toàn hiển thị":"Display safety",khung:"frames","chỉ đồng bộ các cặp tương thích; mặt phẳng khác hướng giữ lát độc lập":"only compatible pairs are synchronized; differently oriented planes remain independent","Hai mặt phẳng giữ lát độc lập; đường tham chiếu biểu diễn giao tuyến 3D.":"The two planes remain independently scrollable; the reference line shows their 3D intersection.","Không khoá cuộn vì hai series khác hệ tọa độ (Frame of Reference).":"Scroll lock is unavailable because the two series use different Frames of Reference.","Không khởi động được DICOM/JPG Downloader & Viewer":"Could not start DICOM/JPG Downloader & Viewer","Tải lại":"Reload","Thiếu token phiên local.":"The local session token is missing.","Sẵn sàng. Nhấn ⌨ trên thanh công cụ để xem phím tắt.":"Ready. Click ⌨ on the toolbar for the keyboard shortcuts.",lát:"slices","Đang nhận diện DICOM hoặc JPG/PNG trong folder…":"Identifying DICOM or JPG/PNG files in the folder…","Đang đọc và chuyển folder DICOM local…":"Reading and converting the local DICOM folder…","Đang quét lại thư mục phim trong nền…":"Rescanning the image folder in the background…","Đã đổi kho lưu; hãy tìm lại mã bệnh nhân để đối chiếu phim cũ/mới.":"Storage root changed; search the patient code again to re-check old and new studies.","Chọn thư mục cần chạy trong ứng dụng WebView2.":"Choosing a folder requires the WebView2 application.","Nhập DICOM local cần chạy trong ứng dụng WebView2.":"Importing local DICOM requires the WebView2 application.","Chế độ classic chỉ có trong ứng dụng desktop.":"Classic mode is only available in the desktop application.","Tên bệnh nhân không khớp; app đã chặn tự động gộp.":"The patient name does not match; the automatic merge was blocked.","Không có phim mới/chưa hoàn tất được chọn để tải.":"No new or incomplete study is selected for download.","Chưa chọn khung ảnh để xoay.":"No pane is selected to rotate.","Chưa chọn khung ảnh để lật.":"No pane is selected to flip.","Chưa có link viewer để tải.":"There is no viewer link to download.","Không lưu được phép đo trước khi đổi khung xem.":"Could not save measurements before changing the layout.","Khung xem hiện tại không có phép đo/ROI để xóa.":"The current layout has no measurements or ROIs to clear.","Đang mở lại thư mục từ lịch sử…":"Reopening the folder from history…","Đã xóa {} phép đo/ROI.":"Cleared {} measurements/ROIs.","Đã lưu {} phép đo/ROI.":"Saved {} measurements/ROIs.",'Đã lưu ảnh PNG của khung "{}".':'Saved a PNG of the "{}" pane.',"Thể tích ROI thủ công: {} mL (tổng diện tích lát × khoảng cách lát).":"Manual ROI volume: {} mL (sum of slice areas × slice spacing).","Đang dựng MPR từ {} lát…":"Building MPR from {} slices…","Đang dựng mô hình 3D từ {} lát…":"Building the 3D model from {} slices…","CT đã chuyển sang JPG 8-bit: chỉ dùng xem hình thái và đo hình học; không dùng mức xám để suy luận HU hay cửa sổ CT chẩn đoán.":"This CT was converted to 8-bit JPG: use it for morphology and geometric measurement only. Do not infer HU values or diagnostic CT windows from its grey levels.","Chưa xác định được modality của series JPG 8-bit; không dùng mức xám để định lượng tín hiệu hoặc đậm độ.":"The modality of this 8-bit JPG series is unknown; do not use its grey levels to quantify signal or density.","Hết bộ đệm ảnh. Hãy đóng series khác hoặc chọn series ít lát hơn rồi thử lại.":"The image cache is full. Close another series or pick one with fewer slices, then try again.","Mất kết nối tới dịch vụ nội bộ của ứng dụng. Hãy khởi động lại ứng dụng.":"Lost the connection to the application's local service. Restart the application.","Trình kết xuất GPU gặp sự cố. Hãy khởi động lại ứng dụng; nếu lặp lại, cập nhật driver card đồ họa.":"The GPU renderer failed. Restart the application; if it repeats, update your graphics driver.","chi tiết":"details","Con trỏ tham chiếu đã bật.":"Reference cursor on.","Mở file...":"Open file...","Mở file DICOM hoặc file ảnh":"Open a DICOM file or image file","Mở file DICOM hoặc JPG/PNG đơn lẻ trong viewer":"Open a single DICOM or JPG/PNG file in the viewer","Thông tin file & Link tải":"File Info & Download Link","Chi tiết file & Thẻ DICOM":"File Details & DICOM Tags","Nguồn gốc & Link tải":"Provenance & Download Link","Link tải / Viewer":"Download / Viewer Link","Sao chép link":"Copy link","Đã sao chép link tải vào clipboard!":"Download link copied to clipboard!","Không thể sao chép liên kết":"Could not copy link","Mở liên kết":"Open URL","Mã ca chụp (Accession No)":"Accession number","Bệnh viện / Cơ sở":"Hospital / Facility","Phương thức tải":"Download method","Thời gian tải":"Downloaded at","Thông tin ca chụp":"Study & Patient Demographics","Thông số ảnh":"Image Parameters","Đường dẫn file":"File path","Kích thước file":"File size","Ngày sửa đổi":"Modified date","Lát cắt hiện tại":"Current slice","Độ phân giải":"Resolution","Độ dày lát cắt":"Slice thickness","Khoảng cách lát cắt":"Slice spacing","Pixel Spacing":"Pixel spacing","Bảng thẻ DICOM Header":"DICOM Header Tags","Tìm kiếm thẻ (Tag, Tên, Giá trị)...":"Search tags (Tag, Name, Value)...",Tag:"Tag",VR:"VR","Tên thẻ":"Tag Name","Giá trị":"Value","Không tìm thấy thẻ phù hợp":"No matching tags found","Chưa có thông tin link tải cho file này.":"No download link recorded for this file.","Đang đọc thông tin file...":"Reading file details...","Không tải được thông tin file":"Could not load file details",Đóng:"Close","+ Mốc":"+ Bookmark","Bấm “+ Thêm mốc” hoặc phím M khi đang xem":"Press “+ Add bookmark”, or M while watching","Bật/tắt clip này":"Select or clear this clip","Bắt đầu ghép ({} clip)":"Concat now ({} clips)","Bệnh nhân":"Patient","Bệnh án / Văn bản":"Records / Text","Ca chụp chưa phân loại":"Unclassified study","Chưa có mốc nào trong clip này.":"No bookmarks in this clip yet.","Chưa có nhật ký phát sinh.":"Nothing has been logged yet.","Chưa rõ tên BN":"Patient name not recorded","Chọn các clip và sử dụng nút ▲/▼ để sắp xếp thứ tự ghép nối theo trình tự phẫu thuật:":"Pick the clips and use ▲/▼ to put them in the order the operation ran:","Chọn file nhật ký":"Choose a log file",Chụp:"Snapshot","Clip khác":"Other clips","Con trỏ tham chiếu":"Reference cursor","Cài đặt hiển thị":"Display preset","Cần chọn ít nhất 2 clip video để ghép.":"Concatenating needs at least 2 clips selected.","Cần ít nhất 2 clip video trong ca mổ để ghép.":"This operation needs at least 2 clips before they can be concatenated.","Cắt đoạn":"Trim","Di chuyển lên trước":"Move earlier","Di chuyển xuống sau":"Move later","File DICOM gốc (.dcm)":"Original DICOM file (.dcm)","File định dạng MPG/MPEG cần chuyển sang MP4 để xem, cắt và vẽ lên nó.":"An MPG/MPEG file has to be converted to MP4 before it can be viewed, trimmed and drawn on.","Ghép & Sắp xếp thứ tự clip phẫu thuật":"Concat and order the surgical clips","Ghép clips":"Concat clips","Ghép các clip video":"Concat the video clips","Hiện tại":"Current",Huỷ:"Cancel","Hủy bỏ":"Cancel","Không lưu được mốc phẫu thuật: {}":"Could not save the surgical bookmark: {}","Không rõ thời lượng":"Duration not known","Không thể mở thư mục: ":"Could not open the folder: ","Không thể đọc nhật ký: ":"Could not read the log: ","Không tìm thấy clip video nào trong ca mổ":"No video clip found in this operation","Không tìm thấy đường dẫn video gốc.":"The original video path was not found.","Không tìm thấy đường dẫn ảnh gốc.":"The original photo path was not found.","Không đủ số lượng file video hợp lệ để ghép.":"Not enough usable video files to concatenate.","Kéo hoặc dùng phím mũi tên; nhấp đúp để đặt lại":"Drag, or use the arrow keys; double-click to reset",Lỗi:"Error",Modality:"Modality","Mô tả ca":"Study description",Mượt:"Smooth","Mật khẩu":"Password","Mốc từ clip khác trong ca mổ":"Bookmark from another clip in this operation","Mốc {}":"Bookmark {}","Mở hồ sơ":"Open record","Mở rộng hoặc thu gọn bệnh nhân {}":"Expand or collapse patient {}","Mở viewer":"Open viewer","Nhập ghi chú / mốc phẫu thuật:":"Note for this surgical bookmark:","Nhập đường dẫn thư mục xuất:":"Path of the export folder:","Nhật ký phiên làm việc":"Session activity log","Phát / Tạm dừng":"Play / Pause","Sẵn sàng.":"Ready.","Sửa tên mốc":"Rename bookmark","Theo dõi":"Follow-up","Thu gọn thông tin ca ( [ )":"Collapse case details ( [ )","Thêm mốc":"Add bookmark","Thêm mốc tại thời điểm hiện tại":"Add a bookmark at the current time","Thêm mốc tại thời điểm hiện tại (phím M)":"Add a bookmark at the current time (M)","Thư mục":"Folder","Tiêu chuẩn":"Standard","Trích xuất ảnh đại diện Thumbnail":"Extract a thumbnail","Tài khoản":"Account","Tìm theo tên hoặc mã bệnh nhân, đợt khám…":"Search by patient name, patient ID or study…","Tạo Filmstrip":"Make filmstrip","Tạo Thumbnail":"Make thumbnail","Tạo chuỗi ảnh Filmstrip":"Make a filmstrip of frames","Tốc độ khung hình:":"Frame rate:","Tối ưu MP4":"Optimise MP4","Tối ưu hoá mã hoá MP4 (H.264)":"Optimise the MP4 encoding (H.264)",Video:"Video","Vui lòng nhập tài khoản RIS dự phòng:":"Enter a fallback RIS account:","Xoá mốc":"Delete bookmark","Đang chuẩn bị ghép {} clip video...":"Preparing to concat {} clips...","Đang cắt video bằng FFmpeg...":"Trimming the video with FFmpeg...","Đang cắt ảnh...":"Cropping the photo...","Đang ghép {} clip video bằng FFmpeg...":"Concatenating {} clips with FFmpeg...","Đang trích xuất chuỗi khung hình filmstrip...":"Extracting the filmstrip frames...","Đang tạo ảnh đại diện thumbnail tại {:.1f}s...":"Making the thumbnail at {:.1f}s...","Đang tải nhật ký...":"Loading the log...","Đang tối ưu hoá mã hoá video MP4 (H.264)...":"Optimising the MP4 (H.264) encoding...","Đang xoay ảnh 90°...":"Rotating the photo 90°...","Đang xuất file PDF...":"Exporting the PDF...","Đang đóng dấu thông tin lên video...":"Stamping the details onto the video...","Đã chuyển sang clip: {} tại {}.":"Moved to clip: {} at {}.","Đã cắt đoạn video ({:.1f}s - {:.1f}s) thành công.":"Trimmed the video ({:.1f}s - {:.1f}s).","Đã ghép thành công {} đoạn video clip.":"Concatenated {} clips.","Đã khoá cuộn: {} — {}.":"Scroll locked: {} — {}.","Đã lưu khung hình snapshot PNG.":"Saved the frame as a PNG.","Đã sao chép toàn bộ nhật ký!":"Copied the whole log.","Đã trích xuất {} khung hình filmstrip.":"Extracted {} filmstrip frames.","Đã tạo ảnh đại diện thumbnail thành công ({:.1f}s).":"Thumbnail made ({:.1f}s).","Đã tối ưu hoá và xuất video MP4 thành công.":"Optimised and exported the MP4.","Đã xoay ảnh 90° thành công.":"Rotated the photo 90°.","Đã xoá mốc phẫu thuật.":"Surgical bookmark deleted.","Đã xuất PDF thành công: {}":"PDF exported: {}","Đã đánh dấu mốc tại {}.":"Bookmarked at {}.","Đã đóng dấu thông tin lên video thành công.":"The details were stamped onto the video.","Đóng dấu / Chèn thông tin phẫu thuật":"Stamp the surgical details onto the video","Đóng dấu thông tin":"Stamp details","Đăng nhập & Thử lại":"Sign in and retry","Đăng nhập RIS thất bại":"RIS sign-in failed","Đường tham chiếu":"Reference lines","Định dạng":"Format","Đổi độ rộng cột {}":"Resize the {} column","Độ phân giải:":"Resolution:","đồng bộ theo vị trí 3D":"synced by 3D position","Ảnh JPG đã giải nén":"Decompressed JPG image","⚠ đồng bộ theo số thứ tự lát (không có đồng bộ không gian)":"⚠ synced by slice number (no spatial sync)"};function s(t){return Xt==="vi"?t:go[t]??t}const _o={"Nội sọ":"Intracranial","Tuỷ sống":"Spinal","Trong trục":"Intra-axial","Ngoài trục":"Extra-axial","Nội tuỷ":"Intramedullary","Ngoài tuỷ - trong màng cứng":"Intradural extramedullary","Ngoài màng cứng":"Extradural",P:"R",T:"L",Giữa:"Midline","Hai bên":"Bilateral","Thuỳ trán":"Frontal lobe","Thuỳ đỉnh":"Parietal lobe","Thuỳ thái dương":"Temporal lobe","Thuỳ chẩm":"Occipital lobe","Thuỳ đảo":"Insula","Thể chai":"Corpus callosum","Đồi thị":"Thalamus","Hạch nền":"Basal ganglia","Não thất bên":"Lateral ventricle","Não thất III":"Third ventricle","Não thất IV":"Fourth ventricle","Vùng tuyến tùng":"Pineal region","Vùng yên":"Sellar region","Vùng trên yên":"Suprasellar region","Góc cầu tiểu não":"Cerebellopontine angle (CPA)","Thân não":"Brainstem","Tiểu não":"Cerebellum","Hố sau":"Posterior fossa","Nền sọ trước":"Anterior skull base","Nền sọ giữa":"Middle skull base","Nền sọ sau":"Posterior skull base","Lỗ chẩm":"Foramen magnum","Xoang tĩnh mạch dọc trên":"Superior sagittal sinus","Cạnh liềm não":"Parafalcine","Lều tiểu não":"Tentorial","Màng não lan toả":"Diffuse leptomeningeal","Bản lề cổ-chẩm":"Craniocervical junction","C1-C2":"C1-C2","Cột sống cổ":"Cervical spine","Bản lề cổ-ngực":"Cervicothoracic junction","Cột sống ngực":"Thoracic spine","Bản lề ngực-thắt lưng":"Thoracolumbar junction","Cột sống thắt lưng":"Lumbar spine","Nón tuỷ":"Conus medullaris","Đuôi ngựa":"Cauda equina","Cùng-cụt":"Sacrococcygeal","Đám rối cánh tay":"Brachial plexus","U thần kinh đệm":"Gliomas","U màng não thất và đám rối mạch mạc":"Ependymal & choroid plexus","U thần kinh đệm - thần kinh và u phôi":"Glioneuronal & embryonal","U màng não và u trung mô":"Meningioma & mesenchymal","U vỏ bao thần kinh":"Nerve sheath","U vùng yên và tuyến tùng":"Sellar & pineal","U lympho và di căn":"Lymphoma & metastasis","Nang, tổn thương dạng u và mạch máu":"Cysts, tumour-like & vascular","U sao bào, IDH đột biến":"Astrocytoma, IDH-mutant","U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q":"Oligodendroglioma, IDH-mutant, 1p/19q-codeleted","U nguyên bào thần kinh đệm, IDH tự nhiên":"Glioblastoma, IDH-wildtype","U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi":"Diffuse midline glioma, H3 K27-altered","U thần kinh đệm lan toả bán cầu, H3 G34 đột biến":"Diffuse hemispheric glioma, H3 G34-mutant","U sao bào lông":"Pilocytic astrocytoma","U sao bào vàng đa hình":"Pleomorphic xanthoastrocytoma (PXA)","U sao bào dưới màng não thất tế bào khổng lồ":"Subependymal giant cell astrocytoma (SEGA)","U màng não thất":"Ependymoma","U dưới màng não thất":"Subependymoma","U đám rối mạch mạc":"Choroid plexus tumour","U hạch thần kinh đệm":"Ganglioglioma","U biểu mô thần kinh loạn sản phôi":"Dysembryoplastic neuroepithelial tumour (DNET)","U nguyên bào tuỷ":"Medulloblastoma","U quái không điển hình/dạng cơ vân":"Atypical teratoid/rhabdoid tumour (ATRT)","U màng não":"Meningioma","U xơ đơn độc":"Solitary fibrous tumour","U nguyên bào mạch máu":"Haemangioblastoma","U dây sống":"Chordoma","U bao sợi thần kinh":"Schwannoma","U sợi thần kinh":"Neurofibroma","U tuyến yên":"Pituitary adenoma (PitNET)","U sọ hầu":"Craniopharyngioma","U tế bào mầm nội sọ":"Intracranial germ cell tumour","U nhu mô tuyến tùng":"Pineal parenchymal tumour","U lympho thần kinh trung ương nguyên phát":"Primary CNS lymphoma (PCNSL)","U di căn":"Metastasis","Nang keo":"Colloid cyst","Nang màng nhện":"Arachnoid cyst","U bì":"Dermoid cyst","U thượng bì":"Epidermoid cyst","U mỡ":"Lipoma","U mạch thể hang":"Cavernous malformation","Dị dạng thông động tĩnh mạch":"Arteriovenous malformation (AVM)","Hình ảnh":"Imaging","Mô bệnh học":"Histopathology",Mổ:"Surgery",Xạ:"Radiotherapy",Hoá:"Chemotherapy","Đích/Miễn dịch":"Targeted / immunotherapy","Theo dõi":"Follow-up","Tái phát/Tiến triển":"Recurrence / progression","Biến chứng":"Complication","Lấy toàn bộ":"Gross total resection (GTR)","Lấy gần toàn bộ":"Near total resection (NTR)","Lấy một phần":"Subtotal resection (STR)","Sinh thiết":"Biopsy","Chỉ mở sọ giải áp":"Decompressive craniectomy only","Dẫn lưu não thất":"Ventricular drainage","Xạ phẫu Gamma Knife":"Gamma Knife radiosurgery","Xạ phẫu CyberKnife":"CyberKnife radiosurgery","Xạ toàn não":"Whole-brain radiotherapy (WBRT)","Xạ trục não tuỷ":"Craniospinal irradiation (CSI)","Temozolomide đồng thời":"Concurrent temozolomide","Temozolomide bổ trợ":"Adjuvant temozolomide","Đột biến":"Mutant","Không đột biến":"Wildtype","Không đột biến (đã giải trình tự)":"Wildtype (sequenced)","IHC R132H âm tính (chưa giải trình tự)":"IHC R132H negative (not sequenced)","Chưa làm":"Not performed","Đồng mất":"Codeleted","Không đồng mất":"Not codeleted","Mất biểu hiện":"Loss of expression","Còn biểu hiện":"Retained","Mất đồng hợp tử":"Homozygous deletion","Không mất đồng hợp tử":"No homozygous deletion","Methyl hoá":"Methylated","Không methyl hoá":"Unmethylated","Dương tính lan toả (IHC)":"Diffuse positivity (IHC)","K27M đột biến":"K27M mutant","Mất biểu hiện H3K27me3":"H3K27me3 loss","Không thay đổi":"Not altered","G34R/V đột biến":"G34R/V mutant","Khuếch đại":"Amplified","Không khuếch đại":"Not amplified","Thêm 7 mất 10 (+7/-10)":"+7/-10",Không:"No","V600E đột biến":"V600E mutant","Hợp nhất KIAA1549-BRAF":"KIAA1549-BRAF fusion","Hợp nhất":"Fusion present","Không hợp nhất":"No fusion","Dương tính":"Positive","Âm tính":"Negative","SHH TP53 tự nhiên":"SHH, TP53-wildtype","SHH TP53 đột biến":"SHH, TP53-mutant","Nhóm 3":"Group 3","Nhóm 4":"Group 4","IHC chỉ bắt được IDH1 R132H. IHC âm tính chưa phải IDH tự nhiên, trừ u độ 4 ở bệnh nhân từ 55 tuổi trở lên.":"IHC detects only IDH1 R132H. A negative stain is not IDH-wildtype, except for a grade 4 tumour in a patient aged 55 or over.","Đồng mất toàn nhánh là tiêu chuẩn bắt buộc của u thần kinh đệm ít nhánh. Mất một phần nhánh không tính.":"Whole-arm codeletion is an essential criterion for oligodendroglioma. Partial-arm loss does not count.","Mất biểu hiện ATRX hướng về u sao bào và thực tế loại trừ đồng mất 1p/19q.":"ATRX loss points to astrocytoma and effectively excludes 1p/19q codeletion.","Mất đồng hợp tử CDKN2A/B đưa u sao bào IDH đột biến lên độ 4 dù mô học chưa đủ tiêu chuẩn.":"Homozygous CDKN2A/B deletion makes an IDH-mutant astrocytoma grade 4 even when the histology falls short.","MGMT không tham gia định danh u. Đây là yếu tố tiên lượng và dự báo đáp ứng temozolomide.":"MGMT does not name the tumour. It is prognostic and predicts response to temozolomide.","U màng não: từ 4 nhân chia trở lên là độ 2, từ 20 trở lên là độ 3.":"Meningioma: 4 or more mitoses is grade 2, 20 or more is grade 3.","Ghi tỉ lệ phần trăm, ví dụ 25%.":"Record a percentage, for example 25%.","Ghi nhóm methyl hoá và điểm tin cậy nếu phiếu có.":"Record the methylation class and its calibrated score if the report gives one.","/10 vi trường":"/10 HPF","Nhiễm sắc thể 7/10":"Chromosome 7/10","Hồ sơ methyl hoá":"Methylation profile","Nhóm u nguyên bào tuỷ":"Medulloblastoma subgroup","Chỉ số nhân chia":"Mitotic count","TERT promoter":"TERT promoter","U phôi":"Embryonal tumour",Chung:"General","Mất đồng hợp tử CDKN2A/B trong u sao bào IDH đột biến là tiêu chuẩn độ 4 của WHO CNS5, không phụ thuộc mô học.":"Homozygous CDKN2A/B deletion in an IDH-mutant astrocytoma is a WHO CNS5 grade 4 criterion in its own right, whatever the histology shows.","U màng não có đột biến TERT promoter hoặc mất đồng hợp tử CDKN2A/B được xếp độ 3 theo WHO CNS5.":"A meningioma with a TERT promoter mutation or homozygous CDKN2A/B deletion is CNS WHO grade 3.","Đồng mất 1p/19q loại trừ u sao bào. Đối chiếu lại: đây nhiều khả năng là u thần kinh đệm ít nhánh.":"1p/19q codeletion excludes astrocytoma. Review this: it is more likely an oligodendroglioma.","Tên chẩn đoán ghi IDH đột biến nhưng kết quả giải trình tự là không đột biến.":"The diagnosis is named IDH-mutant but the sequencing result is wildtype.","Tên chẩn đoán ghi IDH tự nhiên nhưng kết quả xét nghiệm là đột biến.":"The diagnosis is named IDH-wildtype but the test result is mutant.","Tên chẩn đoán ghi đồng mất 1p/19q nhưng kết quả là không đồng mất.":"The diagnosis names 1p/19q codeletion but the result is not codeleted.","Tên chẩn đoán ghi H3 K27 thay đổi nhưng kết quả là không thay đổi.":"The diagnosis is named H3 K27-altered but the result is not altered.","Tên chẩn đoán ghi H3 G34 đột biến nhưng kết quả là không đột biến.":"The diagnosis is named H3 G34-mutant but the result is not mutant.","Bệnh nhân từ 65-70 tuổi trở lên hoặc thể trạng kém":"Aged roughly 65-70 or over, or poor performance status","MGMT methyl hoá, ở bệnh nhân cao tuổi không xạ được":"MGMT methylated, in an elderly patient unfit for radiotherapy","Số lượng tổn thương hạn chế, bệnh ngoài sọ đang kiểm soát":"A limited number of lesions, with extracranial disease controlled","Di căn lan toả nhiều ổ":"Diffuse, multifocal metastases","Liều xạ trục hạ thấp ở nhóm nguy cơ chuẩn":"A reduced craniospinal dose in the standard-risk group","Phác đồ Stupp":"Stupp protocol","Xạ giảm phân liều ± temozolomide":"Hypofractionated RT ± temozolomide","Temozolomide đơn thuần":"Temozolomide alone","Xạ khu trú + PCV":"Focal RT + PCV","Xạ khu trú + temozolomide bổ trợ":"Focal RT + adjuvant temozolomide","Theo dõi bằng hình ảnh":"Imaging surveillance","Xạ khu trú":"Focal radiotherapy","Hoá chất nền methotrexate liều cao":"High-dose methotrexate based","Xạ trục não tuỷ + hoá chất":"Craniospinal irradiation + chemotherapy","Hoá chất nền platinum + xạ":"Platinum-based chemotherapy + RT","Xạ phẫu định vị":"Stereotactic radiosurgery","Xạ toàn não bảo tồn hồi hải mã + memantine":"Hippocampal-avoidance WBRT + memantine","Phẫu thuật rồi theo dõi":"Surgery then surveillance","Xạ + Hoá":"RT + chemotherapy"};function j(t){const e=String(t??"").trim();return!e||Xt==="vi"?e:_o[e]??e}function ka(t){const e=String(t??"").trim(),n=_o[e];return!n||n===e?e:Xt==="vi"?`${e} (${n})`:n}function C(t,...e){let n=0;return s(t).replace(/\{\}/g,()=>n<e.length?String(e[n++]):"{}")}const Ws=[[/Lần đầu chạy trên máy này: đang tải nhân trình duyệt Chromium \(~150MB, chỉ 1 lần\)\.\.\./g,"First run on this machine: downloading the Chromium browser engine (~150MB, one time)..."],[/Đã tải xong Chromium\./g,"Chromium downloaded successfully."],[/Không tự tải được Chromium \((.+)\)\. Hãy chạy thủ công: python -m playwright install chromium/g,"Could not auto-download Chromium ($1). Please run manually: python -m playwright install chromium"],[/Thử lại: đã có sẵn (\d+) ảnh trong folder — sẽ bổ sung ảnh mới, bỏ trùng\./g,"Retry: found $1 existing images in the folder — new images will be appended and duplicates skipped."],[/ {2}\.\.\.đã tải (\d+) ảnh \(DICOM: (\d+)\)/g,"  ...downloaded $1 images (DICOM: $2)"],[/Đang mở trình duyệt ảo \(Chromium\)\.\.\./g,"Opening the virtual browser (Chromium)..."],[/Công cụ nền: (.+) \(dòng này chỉ báo trình duyệt tự động, không báo đăng nhập\)\./g,"Background tool: $1 (this line reports browser automation, not a new sign-in)."],[/\[(\d+)\/(\d+)\] Đang đọc series ngày (.+)\.\.\./g,"[$1/$2] Reading series for $3..."],[/>>> LỊCH SỬ: mở lại (.+)/g,">>> HISTORY: reopened $1"],[/Đang tải trang viewer \(không chỉnh sửa link\)\.\.\./g,"Loading the viewer page (link left unmodified)..."],[/ {2}Cảnh báo khi tải trang: (.+)/g,"  Warning while loading the page: $1"],[/!!! Link đã HẾT HẠN \(urlExpired\)\. Hãy lấy link mới từ trang xem rồi thử lại\./g,"!!! The link has EXPIRED (urlExpired). Get a new link from the viewer page and try again."],[/!!! Link đã HẾT HẠN \/ SESSION không còn hiệu lực \(server trả (.+)\)\. Hãy lấy LINK MỚI từ trang xem rồi tải lại NGAY \(loại link này sống rất ngắn\)\./g,"!!! The link has EXPIRED / the SESSION is no longer valid (server returned $1). Get a NEW link from the viewer page and retry IMMEDIATELY (these links are very short-lived)."],[/DICOMweb: (\d+) series\. Đang liệt kê ảnh\.\.\./g,"DICOMweb: $1 series. Listing images..."],[/DICOMweb: (\d+) series, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\./g,"DICOMweb: $1 series, $2 images. Downloading directly (6 parallel threads)..."],[/DICOMweb: (\d+) series ảnh đã chọn, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\./g,"DICOMweb: $1 selected image series, $2 images. Downloading directly (6 parallel threads)..."],[/DICOMweb: (\d+) series ảnh, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\./g,"DICOMweb: $1 image series, $2 images. Downloading directly (6 parallel threads)..."],[/ {2}Lỗi QIDO series \((.+)\) — bỏ qua\./g,"  QIDO series error ($1) — skipping."],[/ {2}Không tách được studyUID từ QIDO — bỏ qua\./g,"  Could not extract studyUID from QIDO — skipping."],[/Đang dò manifest của viewer\.\.\./g,"Scanning for the viewer manifest..."],[/✓ Có manifest → tải TRỰC TIẾP theo API \(không cần click\/cuộn\)\./g,"✓ Manifest found → downloading DIRECTLY via the API (no clicking or scrolling needed)."],[/Không thấy manifest → chế độ MÔ PHỎNG \(cuộn\/click\), chỉ xử lý xung ĐANG HIỂN THỊ\./g,"No manifest found → SIMULATION mode (scroll/click), processing only the VISIBLE series."],[/Chờ (\d+)s để bắt nốt ảnh còn lại\.\.\./g,"Waiting $1s to capture the remaining images..."],[/Tải xong\. Tổng ảnh: (\d+) \(DICOM (\d+), JPG (\d+), PNG (\d+), trùng bỏ (\d+)\)\./g,"Download complete. Total images: $1 (DICOM $2, JPG $3, PNG $4, $5 duplicates skipped)."],[/Manifest: (\d+) series, ~(\d+) ảnh\. Đang tải trực tiếp (\d+) ảnh \(6 luồng song song\)\.\.\./g,"Manifest: $1 series, ~$2 images. Downloading $3 images directly (6 parallel threads)..."],[/Manifest: (\d+) series đã chọn\/(\d+) series, ~(\d+) ảnh\. Đang tải trực tiếp (\d+) ảnh \(6 luồng song song\)\.\.\./g,"Manifest: $1 of $2 selected series, ~$3 images. Downloading $4 images directly (6 parallel threads)..."],[/ {6}Bước 1\/2: Tạo vé viewer tạm thời cho StudyUID đã chọn \(không tìm lại mã bệnh nhân\)\.\.\./g,"      Step 1/2: Creating a temporary viewer ticket for the selected StudyUID (the patient is not searched again)..."],[/ {6}Bước 2\/2: Đang đọc danh sách series từ viewer \(chưa tải file ảnh\)\.\.\./g,"      Step 2/2: Reading the series list from the viewer (no image files are being downloaded)..."],[/Đường nội bộ (.+) không khả dụng; tự chuyển sang cổng PACS công cộng\./g,"The internal endpoint $1 is unavailable; continuing through the public PACS gateway."],[/ {6}✓ Đã dùng lại phiên RIS; không đăng nhập lại\./g,"      ✓ Reused the existing RIS session; no new sign-in."],[/ {6}Phiên RIS cũ đã hết hạn; app đang tự đăng nhập lại một lần\./g,"      The old RIS session expired; the app is signing in again once."],[/ {6}Chưa có phiên RIS hợp lệ; app đang tự đăng nhập một lần\./g,"      There is no valid RIS session; the app is signing in once."],[/ {6}✓ Viewer mở trực tiếp; không cần đăng nhập RIS\./g,"      ✓ The viewer opened directly; no RIS sign-in was needed."],[/Đã quét (\d+) series; chưa tải file ảnh nào\./g,"Scanned $1 series; no image files were saved."],[/ {2}✓ Đã đủ theo manifest: (\d+)\/(\d+) ảnh\./g,"  ✓ Complete per manifest: $1/$2 images."],[/ {2}⚠ Tải được (\d+)\/(\d+) ảnh — thiếu (\d+) \(có thể do mạng\/timeout; chạy lại sẽ bù, ảnh trùng tự bỏ\)\./g,"  ⚠ Downloaded $1/$2 images — $3 missing (possibly network/timeout; a retry fills the gaps and skips duplicates)."],[/Chuyển đổi: tìm thấy (\d+) file DICOM\. Chất lượng JPG=(\d+)(.*), tương phản=(.+)\./g,"Conversion: found $1 DICOM files. JPG quality=$2$3, contrast=$4."],[/ {2}\.\.\.đã chuyển (\d+) ảnh/g,"  ...converted $1 images"],[/Chuyển đổi xong: (\d+) ảnh JPG(.*), bỏ qua (\d+), lỗi (\d+)\./g,"Conversion complete: $1 JPG images$2, $3 skipped, $4 errors."],[/Tóm tắt theo series:/g,"Summary by series:"],[/ {3}• (.+): (\d+) ảnh/g,"   • $1: $2 images"],[/ {3}Tổng: (\d+) ảnh, (\d+) series\./g,"   Total: $1 images, $2 series."],[/BƯỚC 1\/2: Tải ảnh từ viewer( \(THỬ LẠI — gộp vào folder cũ\))?/g,"STEP 1/2: Download images from the viewer$1"],[/ \(THỬ LẠI — gộp vào folder cũ\)/g," (RETRY — merging into the existing folder)"],[/Không tải được ảnh nào\. Kiểm tra lại link \(còn hạn không\) và thử tắt chế độ ẩn trình duyệt\./g,"No images were downloaded. Check whether the link has expired and try turning off headless mode."],[/BƯỚC 2\/2: Chuyển DICOM -> JPG chất lượng cao/g,"STEP 2/2: Convert DICOM -> high-quality JPG"],[/HOÀN TẤT\. Ảnh JPG nằm ở: (.+)/g,"COMPLETE. JPG images are in: $1"],[/Không thấy danh sách series \(có thể giao diện khác\)\. Vẫn thử cuộn ảnh hiện tại\./g,"No series list found (the UI may differ). Still trying to scroll the current images."],[/Phát hiện (\d+) series \(xung\) đang hiển thị để duyệt\./g,"Detected $1 visible series to browse."],[/Không tìm thấy thumbnail series theo class chuẩn; sẽ cuộn ảnh đang hiển thị\./g,"Could not find standard series thumbnails; will scroll the currently visible images."],[/\[Series (\d+)\/(\d+)\] (.*) {2}\(~(\d+) ảnh\) — đang nạp\.\.\./g,"[Series $1/$2] $3  (~$4 images) — loading..."],[/ {3}\(không bấm được thumbnail này, bỏ qua\)/g,"   (could not click this thumbnail, skipping)"],[/ {3}-> series này thêm (\d+) ảnh \(tổng (\d+)\)\./g,"   -> this series added $1 images (total $2)."],[/ {2}Lỗi file (.+): (.+)/g,"  File error $1: $2"],[/chuẩn lâm sàng \(VOI LUT\)/g,"clinical standard (VOI LUT)"],[/Đã nạp trình xem: (\d+) series, (\d+) ảnh từ (.+)/g,"Loaded viewer: $1 series, $2 images from $3"],[/Đang quét folder DICOM local và chuyển sang JPG chất lượng (\d+)…/g,"Scanning the local DICOM folder and converting to JPG at quality $1…"],[/Không tìm thấy folder cũ của link này; sẽ tải mới vào folder riêng\./g,"No previous folder found for this link; downloading into a new folder instead."],[/Đang yêu cầu dừng an toàn\.\.\./g,"Requesting a safe stop..."],[/Đã dừng\./g,"Stopped."],[/Hoàn tất\./g,"Complete."],[/Đang chuẩn bị\.\.\./g,"Preparing..."],[/Lỗi: (.+)/g,"Error: $1"],[/Đã khôi phục geometry DICOM cho (\d+) series JPG 2D cũ; crosslink dùng tọa độ bệnh nhân thật\./g,"Restored DICOM geometry for $1 legacy 2D JPG series; crosslink uses real patient coordinates."],[/Đang đọc metadata DICOM: (\d+)\/(\d+) file…/g,"Reading DICOM metadata: $1/$2 files..."],[/Bỏ qua (\d+) file nghi DICOM chưa hỗ trợ \(ảnh màu, metadata thiếu hoặc file hỏng\)\./g,"Skipped $1 files suspected to be unsupported DICOM (color images, missing metadata, or corrupted)."],[/Đã nhận diện (\d+) series DICOM, mở trực tiếp không chuyển JPG\./g,"Identified $1 DICOM series, opening directly without JPG conversion."],[/Đang quét thư mục phim: (\d+) thư mục…/g,"Scanning imaging folders: $1 folders..."],[/Bỏ qua thư mục không đọc được: (.+) \((.+)\)/g,"Skipping unreadable folder: $1 ($2)"],[/Đã quét (\d+) thư mục, tìm thấy (\d+) series ảnh\./g,"Scanned $1 folders, found $2 image series."],[/Không thể đổi tên thư mục: (.+)/g,"Could not rename directory: $1"],[/Không thể ghi metadata tải tiếp: (.+)/g,"Could not write resume metadata: $1"],[/❌ CHẶN GỘP CA (\d+) DO MÂU THUẪN ĐỊNH DANH: (.+)/g,"❌ BLOCKED MERGING STUDY $1 DUE TO AN IDENTITY CONFLICT: $2"],[/PatientID DICOM '(.+)' không khớp mã RIS '(.+)'\./g,"DICOM PatientID '$1' does not match RIS PatientID '$2'."],[/PatientName DICOM '(.+)' không khớp tên RIS '(.+)'\./g,"DICOM PatientName '$1' does not match the RIS patient name '$2'."],[/Ngày sinh DICOM '(.+)' không khớp hồ sơ '(.+)'\./g,"DICOM birth date '$1' does not match the patient record '$2'."],[/Giới DICOM '(.+)' không khớp hồ sơ '(.+)'\./g,"DICOM sex '$1' does not match the patient record '$2'."],[/DICOMweb chưa liệt kê đủ instance của mọi series ảnh; không đánh dấu ca là hoàn tất\. (.+)/g,"DICOMweb did not list every image instance; the study was not marked complete. $1"],[/(.+): tìm thấy (\d+)\/không rõ instance/g,"$1: found $2/unknown instances"],[/(.+): tìm thấy (\d+)\/(\d+) instance/g,"$1: found $2/$3 instances"]];function ue(t){const e=String(t??"");return Xt==="vi"?e:go[e]?go[e]:Ws.reduce((n,[o,a])=>n.replace(o,a),e)}function l(t){return String(t??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function Ue(){return{state:"unknown",kinds:[],where:"",since:"",stale:!1,expectedEnd:""}}function Rt(){return{tumors:[],events:[]}}const k={loading:!1,saving:!1,error:"",loadedFor:"",record:Rt(),stage:Ue(),assessment:[],draftAssessment:[],label:"",vocabulary:null,editing:!1,draft:null,freeFields:new Set,canWrite:!0,reason:""};function Vs(){k.loading=!1,k.saving=!1,k.error="",k.loadedFor="",k.record=Rt(),k.stage=Ue(),k.assessment=[],k.draftAssessment=[],k.label="",k.editing=!1,k.draft=null,k.freeFields=new Set,k.canWrite=!0,k.reason=""}const js={Xạ:"Đang xạ",Hoá:"Đang hoá","Đích/Miễn dịch":"Đang điều trị đích"},Us={Xạ:"xạ",Hoá:"hoá","Đích/Miễn dịch":"đích"};function xa(t){const e=t&&typeof t=="object"?t:Ue(),n=Array.isArray(e.kinds)?e.kinds:[],o=String(e.where||"").trim();let a="",r="";if(e.state==="relapse")a=s("Tái phát"),r="relapse";else if(e.state==="active"&&n.length){const[d,...u]=n,h=s(js[d]||d),p=u.map(f=>s(Us[f]||f));a=[h,...p].join(" + "),r="active"}else if(e.state==="post-op")a=s("Hậu phẫu"),r="postop";else if(e.state==="followup")a=s("Theo dõi"),r="followup";else return null;e.stale&&(r="stale",a=`${a} · ${s("chưa cập nhật")}`);const c=[a];return o&&c.push(o),e.since&&c.push(C("từ {}",yn(e.since))),{text:a,tone:r,where:o,title:c.join(" · ")}}function yn(t){const e=String(t||"").trim(),n=e.match(/^(\d{4})-(\d{2})-(\d{2})$/);return n?`${n[3]}/${n[2]}/${n[1]}`:e}function Ks(t){const e=yn(t?.start),n=yn(t?.end);return e&&n?e===n?e:`${e} – ${n}`:e?C("từ {}",e):n?C("đến {}",n):s("Chưa rõ ngày")}function zs(t){const e=t||{},n=[];if(e.extent&&n.push(j(e.extent)),e.technique&&n.push(j(e.technique)),e.regimen&&n.push(j(e.regimen)),Number.isFinite(e.doseGy)&&e.doseGy>0&&n.push(`${e.doseGy} Gy`),Number.isFinite(e.fractions)&&e.fractions>0&&n.push(C("{} buổi",e.fractions)),Number.isFinite(e.cycles)&&e.cycles>0){const o=Number.isFinite(e.cyclesDone)?e.cyclesDone:null;n.push(o===null?C("{} chu kỳ",e.cycles):`${o}/${e.cycles}`)}return e.note&&n.push(e.note),n.join(" · ")}function $a(t){const e=t||{};return[[e.location,e.side].map(o=>j(o)).filter(Boolean).join(" "),j(e.axis)].filter(Boolean).join(" · ")}function Xs(t){const e=t||{},n=j(e.histology),o=String(e.grade||"").trim();return n&&o?C("{} (độ {})",n,o):n||(o?C("Độ {}",o):$a(e)||s("Khối u chưa mô tả"))}const Js={Mổ:"Trước mổ",Xạ:"Trước xạ",Hoá:"Trước hoá","Đích/Miễn dịch":"Trước điều trị đích"},Sa={Xạ:"Trong đợt xạ",Hoá:"Trong đợt hoá","Đích/Miễn dịch":"Trong đợt điều trị đích"},Ys={Mổ:"Sau mổ",Xạ:"Sau xạ",Hoá:"Sau hoá","Đích/Miễn dịch":"Sau điều trị đích","Tái phát/Tiến triển":"Sau khi ghi tái phát","Biến chứng":"Sau biến chứng","Theo dõi":"Sau lần khám"},Zs=84;function Qs(t){const e=String(t||"").trim();return/^\d{8}$/.test(e)?`${e.slice(0,4)}-${e.slice(4,6)}-${e.slice(6,8)}`:""}function io(t,e){const n=Date.parse(`${t}T00:00:00Z`),o=Date.parse(`${e}T00:00:00Z`);return!Number.isFinite(n)||!Number.isFinite(o)?null:Math.round((o-n)/864e5)}function tl(t){return t.end?{date:t.end,estimated:!1}:t.expectedEnd?{date:t.expectedEnd,estimated:!0}:{date:"",estimated:!1}}function el(t,e,{today:n=""}={}){const o=String(e||"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(o))return null;const a=(Array.isArray(t)?t:[]).filter(h=>h&&typeof h=="object"&&h.start);if(!a.length)return null;const r=n||new Date().toISOString().slice(0,10),c=a.find(h=>{if(!Sa[h.kind]||h.start>o)return!1;const p=h.end||(h.expectedEnd&&h.expectedEnd<r?h.expectedEnd:"");return!p||p>=o});if(c)return{phase:"during",kind:c.kind,anchorDate:c.start,days:io(c.start,o),estimated:!1,pseudoprogression:!1};let d=null;for(const h of a){const{date:p,estimated:f}=tl(h),y=p||h.start;y>o||(!d||y>d.when)&&(d={event:h,when:y,estimated:f})}if(d){const h=io(d.when,o);return{phase:"after",kind:d.event.kind,anchorDate:d.when,days:h,estimated:d.estimated,pseudoprogression:d.event.kind==="Xạ"&&h!==null&&h>=0&&h<=Zs}}const u=a.reduce((h,p)=>h.start<=p.start?h:p);return{phase:"before",kind:u.kind,anchorDate:u.start,days:io(o,u.start),estimated:!1,pseudoprogression:!1}}function nl(t){const e=Number(t);return!Number.isFinite(e)||e<0?"":e===0?s("cùng ngày"):e<14?C("{} ngày",e):e<70?C("{} tuần",Math.round(e/7)):C("{} tháng",Math.round(e/30))}function ol(t){if(!t||typeof t!="object")return null;const e=nl(t.days);let n="",o="";if(t.phase==="during")n=s(Sa[t.kind]||t.kind),o="during";else if(t.phase==="before")n=s(Js[t.kind]||t.kind),o="before";else{const r=s(Ys[t.kind]||t.kind);n=e?`${r} ${e}`:r,o="after"}const a=[];return t.estimated&&a.push(s("Ngày kết thúc là ước tính từ số buổi xạ, chưa ai xác nhận.")),t.pseudoprogression&&(o="pseudo",a.push(s("Nằm trong 12 tuần sau xạ — cân nhắc giả tiến triển trước khi kết luận tiến triển."))),{text:n,tone:o,title:[n,...a].join(" · "),estimated:!!t.estimated}}let Fi=0;function Ca(t){return Fi+=1,`${t}-${Date.now().toString(36)}-${Fi}`}function Ia(){return{id:Ca("t"),compartment:"",location:"",side:"",axis:"",histology:"",grade:"",molecular:{},basis:"",confirmedAt:"",source:"",note:""}}function Ta(t=""){return{id:Ca("e"),kind:t,start:"",end:"",where:"",extent:"",technique:"",regimen:"",doseGy:null,fractions:null,cycles:null,cyclesDone:null,note:""}}function il(t){const e=t&&typeof t=="object"?t:Rt();return{tumors:(e.tumors||[]).map(n=>({...Ia(),...n,molecular:{...n.molecular||{}}})),events:(e.events||[]).map(n=>({...Ta(),...n}))}}function pt(){const t=k.vocabulary;return{compartments:t?.compartments||[],locations:t?.locations||{},axes:t?.axes||{},sides:t?.sides||[],histologies:t?.histologies||[],histologyGroups:t?.histologyGroups||{},grades:t?.grades||[],gradesByHistology:t?.gradesByHistology||{},molecularMarkers:t?.molecularMarkers||[],markerGroups:t?.markerGroups||{},markerResults:t?.markerResults||{},markerNotes:t?.markerNotes||{},markerUnits:t?.markerUnits||{},workup:t?.workup||{},diagnosisBases:t?.diagnosisBases||[],eventKinds:t?.eventKinds||[],resectionExtents:t?.resectionExtents||[],radiotherapyTechniques:t?.radiotherapyTechniques||[],chemoRegimens:t?.chemoRegimens||[]}}function ne(t,e,n=null){return`<datalist id="${l(t)}">${(e||[]).map(o=>{const a=n?n(o):"";return`<option value="${l(o)}"${a?` label="${l(a)}"`:""}></option>`}).join("")}</datalist>`}function al(t,e){const n=pt(),o=n.gradesByHistology[String(t||"").trim()];if(!o)return n.grades;const a=String(e||"").trim();return a&&!o.includes(a)?[...o,a]:o}function rl(t){const e=pt().gradesByHistology[t];if(!e||!e.length)return"";const n=e.length>1?`${e[0]}-${e[e.length-1]}`:e[0];return C("độ {}",n)}function Te(t){return _o[t]||""}function Me(t,e,n,o=""){return`<input class="dxf-input" type="text" data-clinical-field="${l(t)}"
    list="${l(n)}" value="${l(e||"")}"
    placeholder="${l(o)}" autocomplete="off">`}function Se(t,e,n,o){return`<select class="dxf-input" data-clinical-field="${l(t)}">
    <option value=""${e?"":" selected"}>${l(o)}</option>
    ${(n||[]).map(a=>`
      <option value="${l(a)}"${a===e?" selected":""}>${l(ka(a))}</option>
    `).join("")}
  </select>`}function yo(t,e){return`<input class="dxf-input" type="date" data-clinical-field="${l(t)}"
    value="${l(e||"")}">`}function nn(t,e,n){const o=Number.isFinite(e)?String(e):"";return`<input class="dxf-input" type="number" min="0" data-clinical-field="${l(t)}"
    value="${l(o)}" placeholder="${l(n)}">`}function Ma(t){const e=pt(),n=Object.keys(e.markerGroups||{}).find(o=>(e.markerGroups[o]||[]).includes(t));return n?j(n):""}function Pa(t){return(Array.isArray(t)?t:[t].filter(Boolean)).join(` ${s("hoặc")} `)}function sl(t){const e=pt().workup[String(t.histology||"").trim()];if(!e)return"";const n=Object.entries(t.molecular||{}).filter(([,c])=>String(c||"").trim()).map(([c])=>c),o=c=>(c||[]).map(d=>Array.isArray(d)?d:[d]).filter(d=>!d.some(u=>n.includes(u))).map(Pa),a=o(e.essential),r=o(e.useful);return!a.length&&!r.length?"":`
    <p class="dxf-workup">
      ${a.length?`
        <span class="dxf-workup-need">${l(s("Bắt buộc còn thiếu"))}:
          ${l(a.join(", "))}</span>
      `:""}
      ${r.length?`
        <span class="dxf-workup-extra">${l(s("Nên có"))}:
          ${l(r.join(", "))}</span>
      `:""}
    </p>
  `}const vn="__other__";function Hn(t,e){return`m:${t}:${e}`}function Go(t){return`h:${t}`}function ll(t,e){const n=pt(),o=n.histologies||[],a=String(t.histology||"").trim(),r=Go(e);if(k.freeFields.has(r)||a&&!o.includes(a))return`
      <input class="dxf-input" type="text" data-clinical-field="histology"
        value="${l(a)}"
        placeholder="${l(s("Gõ chẩn đoán theo phiếu giải phẫu bệnh"))}" autocomplete="off">
      <button class="dxf-mini" type="button" data-action="clinical-histology-list"
        data-tumor-index="${l(String(e))}"
        title="${l(s("Quay lại danh sách đáp án, xoá nội dung đang gõ"))}"
        >${l(s("Danh sách"))}</button>
    `;const c=[],d=new Map;for(const h of o){const p=(n.histologyGroups||{})[h]||"";d.has(p)||(d.set(p,[]),c.push(p)),d.get(p).push(h)}const u=h=>{const p=rl(h);return`<option value="${l(h)}"${h===a?" selected":""}
      >${l(ka(h))}${p?` · ${l(p)}`:""}</option>`};return`<select class="dxf-input" data-clinical-field="histology">
    <option value=""${a?"":" selected"}>${l(s("Chưa chọn"))}</option>
    ${c.map(h=>h?`<optgroup label="${l(j(h))}">${d.get(h).map(u).join("")}</optgroup>`:d.get(h).map(u).join("")).join("")}
    <option value="${vn}">${l(s("Khác…"))}</option>
  </select>`}function cl(t){const e=pt().workup[String(t.histology||"").trim()]||{},n=[],o=new Set,a=(c,d)=>{const u=String(c||"").trim();!u||o.has(u)||(o.add(u),n.push({name:u,role:d}))},r=c=>(c||[]).flatMap(d=>Array.isArray(d)?d:[d]);return r(e.essential).forEach(c=>a(c,"essential")),r(e.useful).forEach(c=>a(c,"useful")),Object.keys(t.molecular||{}).forEach(c=>a(c,"extra")),n}function dl(t,e,n){const o=Hn(n,t),a=pt(),r=a.markerResults[t]||[],c=j(a.markerUnits[t]||""),d=j(a.markerNotes[t]||""),u=d?` title="${l(d)}"`:"",h=String(e||"");return(r.length?k.freeFields.has(o)||h&&!r.includes(h):!0)?`
      <input class="dxf-input" type="text" data-clinical-field="molecularValue"
        value="${l(h)}"
        placeholder="${l(c?C("Kết quả ({})",c):s("Kết quả"))}"${u}
        autocomplete="off">
      ${r.length?`
        <button class="dxf-mini" type="button" data-action="clinical-marker-list"
          data-tumor-index="${l(String(n))}"
          data-marker-name="${l(t)}"
          title="${l(s("Quay lại danh sách đáp án, xoá nội dung đang gõ"))}"
          >${l(s("Danh sách"))}</button>
      `:""}
    `:`<select class="dxf-input" data-clinical-field="molecularValue"${u}>
    <option value=""${h?"":" selected"}>${l(s("Chưa ghi"))}</option>
    ${r.map(f=>`
      <option value="${l(f)}"${f===h?" selected":""}
        >${l(j(f))}</option>
    `).join("")}
    <option value="${vn}">${l(s("Khác…"))}</option>
  </select>`}function ul(t,e){const n=t.molecular||{},o=cl(t),a={essential:s("Bắt buộc"),useful:s("Nên có")};return`
    <div class="dxf-molecular">
      <span class="dxf-sub-label">${l(s("Dấu ấn phân tử"))}</span>
      ${sl(t)}
      ${o.length?"":`
        <p class="dxf-hint">${l(s("Chọn chẩn đoán mô bệnh học để app hỏi đúng bộ dấu ấn."))}</p>
      `}
      ${o.map(r=>{const c=j(pt().markerNotes[r.name]||""),d=r.role!=="extra";return`
        <div class="dxf-molecular-row ${l(r.role)}"
          data-marker-name="${l(r.name)}">
          ${d?`
            <span class="dxf-marker-name" title="${l(Ma(r.name))}"
              >${l(r.name)}<small class="dxf-marker-role ${l(r.role)}"
                >${l(a[r.role])}</small></span>
          `:`
            <input class="dxf-input dxf-marker" type="text" list="dx-markers"
              data-clinical-field="molecularName" value="${l(r.name)}"
              placeholder="${l(s("Tên dấu ấn"))}" autocomplete="off">
          `}
          ${dl(r.name,n[r.name]??"",e)}
          ${d?"":`
            <button class="dxf-mini danger" type="button" data-action="clinical-remove-marker"
              data-tumor-index="${e}" data-marker-name="${l(r.name)}"
              title="${l(s("Xoá dấu ấn"))}">×</button>
          `}
        </div>
        ${c?`<small class="dxf-marker-note">${l(c)}</small>`:""}
      `}).join("")}
      <button class="dxf-mini" type="button" data-action="clinical-add-marker" data-tumor-index="${e}">
        + ${l(s("Thêm dấu ấn khác"))}
      </button>
    </div>
  `}function hl(t,e){const n=pt(),o=t.compartment||"",a=n.locations[o]||[],r=n.axes[o]||[];return`
    <div class="dxf-block" data-tumor-index="${e}">
      <div class="dxf-block-head">
        <b>${l(C("Khối u {}",e+1))}</b>
        <button class="dxf-mini danger" type="button" data-action="clinical-remove-tumor"
          data-tumor-index="${e}">${l(s("Xoá"))}</button>
      </div>
      <label class="dxf-field">
        <span>${l(s("Khoang"))}</span>
        ${Se("compartment",o,n.compartments,s("Chưa chọn"))}
      </label>
      <label class="dxf-field">
        <span>${l(s("Vị trí"))}</span>
        ${Me("location",t.location,`dx-loc-${e}`,s("Chọn hoặc gõ vị trí"))}
      </label>
      ${ne(`dx-loc-${e}`,a,Te)}
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${l(s("Bên"))}</span>
          ${Se("side",t.side,n.sides,"—")}
        </label>
        <label class="dxf-field">
          <span>${l(s("Trục"))}</span>
          ${Me("axis",t.axis,`dx-axis-${e}`,s("Chọn hoặc gõ"))}
        </label>
        ${ne(`dx-axis-${e}`,r,Te)}
      </div>
      <label class="dxf-field dxf-wide dxf-picker">
        <span>${l(s("Mô bệnh học"))}</span>
        ${ll(t,e)}
      </label>
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${l(s("Độ WHO"))}</span>
          ${Se("grade",t.grade,al(t.histology,t.grade),"—")}
        </label>
        <label class="dxf-field">
          <span>${l(s("Ngày có kết quả"))}</span>
          ${yo("confirmedAt",t.confirmedAt)}
        </label>
      </div>
      <label class="dxf-field dxf-wide">
        <span>${l(s("Căn cứ"))}</span>
        ${Se("basis",t.basis,n.diagnosisBases,s("Chưa rõ"))}
      </label>
      ${ul(t,e)}
      <label class="dxf-field dxf-wide">
        <span>${l(s("Ghi chú khối u"))}</span>
        <textarea class="dxf-input" rows="2" data-clinical-field="note"
          placeholder="${l(s("Tuỳ chọn"))}">${l(t.note||"")}</textarea>
      </label>
      ${Wo(e,k.draftAssessment)}
    </div>
  `}function pl(t,e){const n=pt(),o=t.kind||"";return`
    <div class="dxf-block" data-event-index="${e}">
      <div class="dxf-block-head">
        <b>${l(C("Sự kiện {}",e+1))}</b>
        <button class="dxf-mini danger" type="button" data-action="clinical-remove-event"
          data-event-index="${e}">${l(s("Xoá"))}</button>
      </div>
      <label class="dxf-field">
        <span>${l(s("Loại"))}</span>
        ${Se("kind",o,n.eventKinds,s("Chưa chọn"))}
      </label>
      <div class="dxf-row">
        <label class="dxf-field">
          <span>${l(s("Bắt đầu"))}</span>
          ${yo("start",t.start)}
        </label>
        <label class="dxf-field">
          <span>${l(s("Kết thúc"))}</span>
          ${yo("end",t.end)}
        </label>
      </div>
      <p class="dxf-hint">${l(s("Để trống ngày kết thúc nghĩa là đang diễn ra."))}</p>
      <label class="dxf-field">
        <span>${l(s("Nơi thực hiện"))}</span>
        <input class="dxf-input" type="text" data-clinical-field="where"
          value="${l(t.where||"")}"
          placeholder="${l(s("Bệnh viện, trung tâm"))}">
      </label>
      ${o==="Mổ"?`
        <label class="dxf-field">
          <span>${l(s("Mức độ lấy u"))}</span>
          ${Me("extent",t.extent,"dx-extents",s("Chọn hoặc gõ"))}
        </label>
      `:""}
      ${o==="Xạ"?`
        <label class="dxf-field">
          <span>${l(s("Kỹ thuật"))}</span>
          ${Me("technique",t.technique,"dx-techniques",s("Chọn hoặc gõ"))}
        </label>
        <div class="dxf-row">
          <label class="dxf-field">
            <span>${l(s("Liều (Gy)"))}</span>
            ${nn("doseGy",t.doseGy,"60")}
          </label>
          <label class="dxf-field">
            <span>${l(s("Số buổi"))}</span>
            ${nn("fractions",t.fractions,"30")}
          </label>
        </div>
        <p class="dxf-hint">${l(s("Có số buổi thì app tự biết đợt xạ quá hạn cập nhật."))}</p>
      `:""}
      ${o==="Hoá"||o==="Đích/Miễn dịch"?`
        <label class="dxf-field">
          <span>${l(s("Phác đồ"))}</span>
          ${Me("regimen",t.regimen,"dx-regimens",s("Chọn hoặc gõ"))}
        </label>
        <div class="dxf-row">
          <label class="dxf-field">
            <span>${l(s("Đã xong"))}</span>
            ${nn("cyclesDone",t.cyclesDone,"3")}
          </label>
          <label class="dxf-field">
            <span>${l(s("Tổng chu kỳ"))}</span>
            ${nn("cycles",t.cycles,"6")}
          </label>
        </div>
      `:""}
      <label class="dxf-field dxf-wide">
        <span>${l(s("Ghi chú"))}</span>
        <textarea class="dxf-input" rows="2" data-clinical-field="note"
          placeholder="${l(s("Tuỳ chọn"))}">${l(t.note||"")}</textarea>
      </label>
    </div>
  `}function fl(){const t=pt();return`
    ${ne("dx-markers",t.molecularMarkers,Ma)}
    ${ne("dx-extents",t.resectionExtents,Te)}
    ${ne("dx-techniques",t.radiotherapyTechniques,Te)}
    ${ne("dx-regimens",t.chemoRegimens,Te)}
  `}function ml(t){const e=new Date().getFullYear(),n=t.gender&&t.gender!=="Nam"&&t.gender!=="Nữ";return`
    <form class="dxf-section" data-field="patient-edit-form" onsubmit="event.preventDefault();">
      <div class="dxf-section-head">
        <b>${l(s("Thông tin bệnh nhân"))}</b>
      </div>
      <div class="dxf-block">
        <label class="dxf-field dxf-wide">
          <span>${l(s("Họ và tên"))}</span>
          <input class="dxf-input" name="patientName" maxlength="128"
            value="${l(t.patientName||"")}"
            placeholder="${l(s("Nhập họ tên"))}">
        </label>
        <label class="dxf-field">
          <span>${l(s("Mã bệnh nhân"))}</span>
          <input class="dxf-input" name="patientId" maxlength="128" required
            value="${l(t.patientId||"")}"
            placeholder="${l(s("Nhập mã BN"))}">
        </label>
        <label class="dxf-field">
          <span>${l(s("Giới tính"))}</span>
          <select class="dxf-input" name="gender">
            <option value=""${t.gender?"":" selected"}>—</option>
            <option value="Nam"${t.gender==="Nam"?" selected":""}>${l(s("Nam"))}</option>
            <option value="Nữ"${t.gender==="Nữ"?" selected":""}>${l(s("Nữ"))}</option>
            <option value="Khác"${n?" selected":""}>${l(s("Khác"))}</option>
          </select>
        </label>
        <label class="dxf-field">
          <span>${l(s("Năm sinh"))}</span>
          <input class="dxf-input" name="birthYear" type="number" min="1900" max="${e}"
            value="${l(t.birthYear||"")}" placeholder="YYYY">
        </label>
        <label class="dxf-field">
          <span>${l(s("Số điện thoại"))}</span>
          <input class="dxf-input" name="phone" type="tel"
            value="${l(t.phone||"")}"
            placeholder="${l(s("Nhập SĐT"))}">
        </label>
        <label class="dxf-field dxf-wide">
          <span>${l(s("Địa chỉ"))}</span>
          <input class="dxf-input" name="address" value="${l(t.address||"")}"
            placeholder="${l(s("Nhập địa chỉ"))}">
        </label>
        <label class="dxf-field dxf-wide">
          <span>${l(s("Bệnh viện"))}</span>
          <input class="dxf-input" name="hospital" value="${l(t.hospital||"")}"
            placeholder="${l(s("Tên bệnh viện"))}">
        </label>
        <label class="dxf-field dxf-wide">
          <span>${l(s("Chẩn đoán / Ghi chú"))}</span>
          <textarea class="dxf-input" name="diagnosis" rows="3"
            placeholder="${l(s("Ghi tự do: lưu ý khi đọc phim, hẹn khám…"))}"
            >${l(t.diagnosis||"")}</textarea>
        </label>
      </div>
    </form>
  `}function gl(t){return`
    <div class="dxf-section">
      <div class="dxf-section-head">
        <b>${l(s("Chẩn đoán"))}</b>
        <button class="dxf-mini" type="button" data-action="clinical-add-tumor">
          + ${l(s("Thêm khối u"))}
        </button>
      </div>
      ${t.tumors.length?t.tumors.map(hl).join(""):`<p class="dxf-empty">${l(s("Chưa có khối u nào được mô tả."))}</p>`}
    </div>
  `}function yl(t){return`
    <div class="dxf-section">
      <div class="dxf-section-head">
        <b>${l(s("Điều trị"))}</b>
        <button class="dxf-mini" type="button" data-action="clinical-add-event">
          + ${l(s("Thêm sự kiện"))}
        </button>
      </div>
      ${t.events.length?t.events.map(pl).join(""):`<p class="dxf-empty">${l(s("Chưa có mốc điều trị nào."))}</p>`}
    </div>
  `}function Na(t={},e=null){const n=k.draft||Rt(),o=[t.patientName,t.patientId].map(a=>String(a||"").trim()).filter(Boolean).join(" · ");return`
    <div class="dx-workspace">
      ${fl()}
      <header class="dxw-bar">
        <div class="dxw-title">
          <b>${l(s("Hồ sơ bệnh nhân"))}</b>
          ${o?`<span class="dxw-patient">${l(o)}</span>`:""}
        </div>
        <div class="dxw-actions">
          <button class="dxw-btn primary" type="button" data-action="save-record"
            ${k.saving?"disabled":""}>${l(k.saving?s("Đang lưu…"):s("Lưu"))}</button>
          <button class="dxw-btn" type="button" data-action="cancel-record"
            >${l(s("Đóng"))}</button>
        </div>
      </header>
      ${k.error?`
        <p class="dxf-error" role="alert">${l(k.error)}</p>
      `:""}
      <div class="dxw-body">
        <section class="dxw-col">${ml(e||t)}</section>
        <section class="dxw-col">${gl(n)}</section>
        <section class="dxw-col">${yl(n)}</section>
      </div>
    </div>
  `}function Wo(t,e=k.assessment){const n=(e||[])[t];if(!n||!n.line)return"";const o=n.grade||{},a=o.source==="molecular"&&o.recorded&&o.recorded!==o.grade,r=n.conflicts||[],c=(n.missing||[]).filter(S=>S.essential),d=(n.missing||[]).filter(S=>!S.essential),u=n.protocols||{},h=u.preferred||[],p=u.conditional||[],f=(S,b,g)=>S.length?`
    <p class="dx-gap ${g}">
      <span class="dx-gap-label">${l(b)}</span>
      ${S.map($=>{const O=$.unreadable?{cls:" unreadable",suffix:s("chưa đọc được"),hint:s("Ô này có chữ nhưng không khớp đáp án nào trong danh sách, nên không luật nào đọc được.")}:$.declined?{cls:" declined",suffix:s("chưa làm"),hint:""}:{cls:"",suffix:"",hint:""},T=O.hint||j($.note||"");return`<span class="dx-gap-item${O.cls}"
          ${T?`title="${l(T)}"`:""}
          >${l(Pa($.markers))}${O.suffix?` (${l(O.suffix)})`:""}</span>`}).join("")}
    </p>
  `:"",y=(S,b,g)=>S.length?`
    <div class="dx-rx ${g}">
      <span class="dx-rx-label">${l(b)}</span>
      ${S.map($=>`
        <div class="dx-rx-item">
          <b>${l(j($.name))}</b>
          <span class="dx-rx-kind">${l(j($.kind))}</span>
          <small class="dx-rx-detail">${l($.detail)}</small>
          ${$.cycles?`<small class="dx-rx-cycles">${l($.cycles)}</small>`:""}
          ${$.when?`<small class="dx-rx-when">${l(C("Khi: {}",j($.when)))}</small>`:""}
          <small class="dx-rx-ref">${l($.reference)}</small>
        </div>
      `).join("")}
    </div>
  `:"";return`
    <div class="dx-reading">
      <p class="dx-integrated">
        <span class="dx-integrated-line">${l(n.line)}</span>
        <span class="dx-integrated-flag ${n.integrated?"done":"pending"}"
          title="${l(n.integrated?s("Mô bệnh học và phân tử đã đủ để kết luận chẩn đoán tích hợp"):s("Chưa đủ căn cứ cho chẩn đoán tích hợp theo WHO CNS5"))}"
          >${l(n.integrated?s("Chẩn đoán tích hợp"):s("Chưa tích hợp"))}</span>
      </p>
      ${a?`
        <p class="dx-escalated" title="${l(j(o.rule))}">
          ${l(C("Độ đã ghi {} · theo phân tử là độ {}",o.recorded,o.grade))}
          <small>${l(j(o.rule))}</small>
        </p>
      `:""}
      ${r.length?`
        <ul class="dx-conflicts">
          ${r.map(S=>`
            <li><b>${l(S.marker)}</b> ${l(j(S.text))}</li>
          `).join("")}
        </ul>
      `:""}
      ${f(c,s("Bắt buộc còn thiếu"),"need")}
      ${f(d,s("Nên có"),"extra")}
      ${y(h,s("Phác đồ chuẩn"),"preferred")}
      ${y(p,s("Cân nhắc theo bối cảnh"),"conditional")}
    </div>
  `}function vl(t){return Wo(t,k.draftAssessment)}function bl(){const t=k.record||Rt(),e=t.tumors||[],n=t.events||[];return!e.length&&!n.length?`<p class="dxf-empty">${l(s("Chưa ghi hồ sơ lâm sàng cho bệnh nhân này."))}</p>`:`
    ${e.length?`
      <ul class="dx-tumors">
        ${e.map((o,a)=>{const r=$a(o),c=Object.entries(o.molecular||{});return`
            <li class="dx-tumor">
              <b>${l(Xs(o))}</b>
              ${r?`<small>${l(r)}</small>`:""}
              ${c.length?`
                <span class="dx-markers">
                  ${c.map(([d,u])=>`
                    <span class="dx-marker">${l(d)}: ${l(u)}</span>
                  `).join("")}
                </span>
              `:""}
              ${o.basis?`
                <span class="dx-basis ${o.basis==="Mô bệnh học"?"confirmed":"imaging"}"
                  title="${l(C("Chẩn đoán dựa trên: {}",j(o.basis)))}"
                  >${l(j(o.basis))}${o.confirmedAt?` · ${l(yn(o.confirmedAt))}`:""}</span>
              `:`
                <span class="dx-basis unknown" title="${l(s("Chưa ghi chẩn đoán này dựa trên gì"))}"
                  >${l(s("Chưa rõ căn cứ"))}</span>
              `}
              ${o.note?`<small class="dx-note">${l(o.note)}</small>`:""}
              ${Wo(a)}
            </li>
          `}).join("")}
      </ul>
    `:""}
    ${n.length?`
      <ul class="dx-events">
        ${n.map(o=>{const a=zs(o);return`
            <li class="dx-event${!o.end?" open":""}">
              <span class="dx-event-kind">${l(j(o.kind))}</span>
              <span class="dx-event-body">
                <b>${l(Ks(o))}</b>
                ${o.where?`<small>${l(o.where)}</small>`:""}
                ${a?`<small>${l(a)}</small>`:""}
              </span>
            </li>
          `}).join("")}
      </ul>
    `:""}
  `}function Da(){const t=xa(k.stage),e=k.editing,n=!!k.draft&&!e;return`
    <div class="dx-card">
      ${e?`
        <p class="dx-hint">${l(s("Đang sửa ở khung bên phải."))}</p>
      `:""}
      ${n?`
        <p class="dx-hint pending">${l(s("Còn bản sửa chưa lưu."))}</p>
      `:""}
      ${t?`
        <div class="dx-stage">
          <span class="dx-stage-chip ${l(t.tone)}" title="${l(t.title)}"
            >${l(t.text)}</span>
          ${t.where?`<span class="dx-stage-where">${l(t.where)}</span>`:""}
        </div>
      `:""}
      ${k.error&&!e?`
        <p class="dxf-error" role="alert">${l(k.error)}</p>
      `:""}
      ${k.loading?`<p class="dxf-empty">${l(s("Đang tải hồ sơ lâm sàng…"))}</p>`:k.canWrite?bl():`<p class="dxf-empty">${l(k.reason||s("Thư mục này chưa có patient-index.json nên chưa ghi được hồ sơ lâm sàng."))}</p>`}
    </div>
  `}const wl=new Set(["doseGy","fractions","cycles","cyclesDone"]);function kl(t){const e=String(t??"").trim();if(!e)return null;const n=Number(e);return Number.isFinite(n)&&n>=0?Math.round(n):null}function xl(t,e="change"){const n=k.draft;if(!n||!t)return!1;const o=t.dataset.clinicalField;if(!o)return!1;const a=t.closest("[data-tumor-index]"),r=t.closest("[data-marker-name]"),c=t.closest("[data-event-index]");if(r&&a){const d=Number(a.dataset.tumorIndex),u=n.tumors[d];if(!u)return!1;const h=r.dataset.markerName||"",p=Object.entries(u.molecular||{}),f=p.findIndex(([b])=>b===h);if(o==="molecularName"){if(f<0)return!1;const b=t.value.trim();return p[f]=[b,p[f][1]],r.dataset.markerName=b,u.molecular=Object.fromEntries(p.filter(([g])=>g)),e==="change"}const y=t.value;if(y===vn)return k.freeFields.add(Hn(d,h)),f>=0&&(p[f]=[h,""]),u.molecular=Object.fromEntries(p.filter(([b])=>b)),!0;const S=y.trim();return!S&&f>=0&&!r.classList.contains("extra")?p.splice(f,1):f>=0?p[f]=[h,S]:S&&p.push([h,S]),u.molecular=Object.fromEntries(p.filter(([b])=>b)),t.tagName==="SELECT"&&e==="change"}if(a){const d=Number(a.dataset.tumorIndex),u=n.tumors[d];return u?o==="histology"&&t.value===vn?(k.freeFields.add(Go(d)),u.histology="",!0):(u[o]=t.value,o==="histology"||o==="compartment"?e==="change":!1):!1}if(c){const d=n.events[Number(c.dataset.eventIndex)];return d?(d[o]=wl.has(o)?kl(t.value):t.value,o==="kind"&&e==="change"):!1}return!1}function $l(){k.draft&&k.draft.tumors.push(Ia())}function Sl(t){k.draft&&k.draft.tumors.splice(t,1)}function Cl(){k.draft&&k.draft.events.push(Ta())}function Il(t){k.draft&&k.draft.events.splice(t,1)}function Tl(t){const e=k.draft?.tumors?.[t];if(!e)return;const n={...e.molecular||{}};let o=s("Dấu ấn mới"),a=2;for(;n[o]!==void 0;)o=`${s("Dấu ấn mới")} ${a}`,a+=1;n[o]="",e.molecular=n}function Ml(t,e){const n=k.draft?.tumors?.[t];if(!n)return;const o=Object.entries(n.molecular||{}).filter(([a])=>a!==e);n.molecular=Object.fromEntries(o),k.freeFields.delete(Hn(t,e))}function Pl(t){k.freeFields.delete(Go(t));const e=k.draft?.tumors?.[t];e&&(e.histology="")}function Nl(t,e){const n=k.draft?.tumors?.[t];if(k.freeFields.delete(Hn(t,e)),!n||!n.molecular)return;const o=Object.entries(n.molecular).map(([a,r])=>a===e?[a,""]:[a,r]);n.molecular=Object.fromEntries(o)}function La(){const t=k.draft||Rt();return{tumors:t.tumors.map(e=>({...e,molecular:Object.fromEntries(Object.entries(e.molecular||{}).filter(([n,o])=>n.trim()&&String(o).trim()))})),events:t.events}}function Dl(t,e=!1){return(t||[]).map(n=>({...n,selected:!e&&n.selected!==void 0?!!n.selected:!e&&n.local_status!=="downloaded"}))}function he(t){return(t||[]).filter(e=>e.selected===!0)}function Vo(t){return Object.fromEntries((t||[]).map(e=>[e.studyUid,(e.series||[]).filter(n=>n.selected!==!1).map(n=>n.id)]))}function bn(t,e={}){return{...e,...Vo(t)}}function Ea(t,e={}){return(t||[]).map(n=>{const o=Object.prototype.hasOwnProperty.call(e,n.studyUid),a=new Set(e[n.studyUid]||[]);return{...n,series:(n.series||[]).map(r=>({...r,selected:o?a.has(r.id):!0}))}})}function Oa(t,e){const n=Vo(e);return he(t).filter(o=>{const a=String(o.study_uid||"").trim(),r=n[a];return!(Array.isArray(r)&&r.length>0)})}function Ll(t,e){return he(t).length?Oa(t,e).length===0:!1}const jo="dcom-rendering-engine",vo="dcom-tools",Uo="dcomjpg",wn="cornerstoneStreamingImageVolume",El=Object.freeze({maxImagesToPrefetch:8,minBefore:2,maxAfter:6,directionExtraImages:0,preserveExistingPool:!0}),ln=[Rn,Bn,de,ma,Ro,Bo,qn,Fn,Ve,fe,Ie,ct,ee,ga,sn],kn={window:de.toolName,pan:Rn.toolName,zoom:Bn.toolName,length:Ro.toolName,angle:Bo.toolName,ellipse:qn.toolName,freehand:Fn.toolName,text:Ve.toolName,crosshair:fe.toolName,orbit3d:Ie.toolName,magnify:ga.toolName},Ol=new Set([Ro.toolName,Bo.toolName,qn.toolName,Fn.toolName,Ve.toolName]);let Hi=!1,M=null,Ko=!1,B=null,xn=null,Ot=[],bo="Nội dung ghi chú",wo="Thêm",ko="Bỏ";const _n=Object.freeze({compare:2,compare3:3});let R=za(),G="",bt=null,Q=null,U=[],ht="single",Tt="window",zo="stack",jt=!0,Xo=!1,$n=!0,Pe=null,Be=0,Jt=()=>{},xo=()=>{};const me=new Map,Dt=new Map,qe=new Map;let st=null,cn=!1,Al=0,Fe="main",$o=null;const Rl=Object.freeze({full:{lower:0,upper:255},soft:{lower:28,upper:205},contrast:{lower:62,upper:168}}),Aa=Object.freeze([{id:"ct-brain",label:"Não",width:80,center:40},{id:"ct-stroke",label:"Đột quỵ / hố sau",width:40,center:40},{id:"ct-subdural",label:"Máu tụ dưới màng cứng",width:215,center:75},{id:"ct-bone",label:"Xương",width:1800,center:400},{id:"ct-temporal",label:"Xương thái dương",width:4e3,center:700}]),Bl=new Map(Aa.map(t=>[t.id,t])),ql=Object.freeze({full:1,soft:1.5,contrast:.6});function Gn(t){if(t?.sourceType!=="dicom"||t?.modality!=="CT")return!1;const e=t.pixelData||{};return Number.isFinite(e.rescaleSlope)&&e.rescaleSlope!==0&&Number.isFinite(e.rescaleIntercept)}function So(t){const e=[{id:"full",label:t?.sourceType==="dicom"?"DICOM mặc định":"Toàn dải"},{id:"soft",label:t?.sourceType==="dicom"?"Cửa sổ rộng":"Mô mềm JPG"},{id:"contrast",label:t?.sourceType==="dicom"?"Cửa sổ hẹp":"Tương phản cao"}];return Gn(t)?[...Aa.map(n=>({id:n.id,label:n.label,detail:`W${n.width}/L${n.center}`})),...e]:e}function Sn(t){return Gn(t)?"ct-brain":"full"}function Fl(t){const e=t?.pixelData||{},n=Math.max(1,Math.min(Number(e.bitsStored)||16,32)),o=Number(e.pixelRepresentation)===1,a=o?-(2**(n-1)):0,r=o?2**(n-1)-1:2**n-1,c=Number.isFinite(e.rescaleSlope)&&e.rescaleSlope!==0?e.rescaleSlope:1,d=Number.isFinite(e.rescaleIntercept)?e.rescaleIntercept:0;return{lower:a*c+d,upper:r*c+d}}function Ra(t,e=null){if(e?.sourceType!=="dicom")return Rl[t]||null;const n=Bl.get(t);if(n)return Gn(e)?{lower:n.center-n.width/2,upper:n.center+n.width/2}:null;const o=e.pixelData||{},a=Fl(e),r=Number.isFinite(o.windowCenter)?o.windowCenter:(a.lower+a.upper)/2,c=Number.isFinite(o.windowWidth)&&o.windowWidth>0?o.windowWidth:Math.max(1,a.upper-a.lower),d=ql[t];if(!Number.isFinite(d))return null;const u=c*d;return!Number.isFinite(u)||u<=0?null:{lower:r-u/2,upper:r+u/2}}function Ba(t){if(!t)return null;const e=Number(t.pixelData?.numberOfFrames||1);return t.sourceType==="dicom"&&e>1&&!t.geometry?{level:"warning",text:"DICOM multi-frame thiếu vị trí 3D theo khung: xem được từng khung, nhưng không có MPR/3D và không đồng bộ theo vị trí với series khác."}:t.sourceType==="dicom"?null:t.modality==="CT"?{level:"danger",text:"CT đã chuyển sang JPG 8-bit: chỉ dùng xem hình thái và đo hình học; không dùng mức xám để suy luận HU hay cửa sổ CT chẩn đoán."}:["MR","CT"].includes(t.modality)?null:{level:"warning",text:"Chưa xác định được modality của series JPG 8-bit; không dùng mức xám để định lượng tín hiệu hoặc đậm độ."}}function qa(t){const e=new RegExp(`^${Uo}:([a-f0-9]{20}):(\\d+)$`).exec(t);return e?{seriesId:e[1],index:Number(e[2])}:null}function Hl(t,e){const n=qa(e);if(!n)return;const o=me.get(n.seriesId),a=Dt.get(n.seriesId);if(!o)return;const r=o.geometry;if(t==="generalSeriesModule")return{modality:o.modality==="CT"?"CT":o.modality==="MR"?"MR":"OT",seriesInstanceUID:n.seriesId};if(t==="generalImageModule")return{instanceNumber:n.index+1};if(t==="imagePixelModule"){const c=o.pixelData||{};return{samplesPerPixel:c.samplesPerPixel||1,photometricInterpretation:c.photometricInterpretation||"MONOCHROME2",rows:r?.rows||c.rows||1,columns:r?.columns||c.columns||1,bitsAllocated:c.bitsAllocated||8,bitsStored:c.bitsStored||8,highBit:c.highBit??7,pixelRepresentation:c.pixelRepresentation||0}}if(t==="modalityLutModule")return{rescaleIntercept:0,rescaleSlope:1,rescaleType:o.modality==="CT"?"HU":"US"};if(t==="voiLutModule"){const c=o.pixelData?.windowCenter,d=o.pixelData?.windowWidth;return{windowCenter:[Number.isFinite(c)?c:127.5],windowWidth:[Number.isFinite(d)&&d>0?d:255]}}if(t==="imagePlaneModule"&&r&&a){const c=a.ordered_slices?.[n.index];return c?{frameOfReferenceUID:r.frameOfReferenceUID||n.seriesId,rows:r.rows,columns:r.columns,imageOrientationPatient:r.orientation,rowCosines:r.orientation.slice(0,3),columnCosines:r.orientation.slice(3,6),imagePositionPatient:c.position,pixelSpacing:[...r.pixelSpacing],rowPixelSpacing:r.pixelSpacing[0],columnPixelSpacing:r.pixelSpacing[1],sliceThickness:r.sliceSpacing,spacingBetweenSlices:r.sliceSpacing,sliceLocation:c.distance}:void 0}}function _l(t,e){return`${Uo}:${t}:${e}`}function Fa(t,e,n){const o=document.createElement("canvas");o.width=e,o.height=n;const a=o.getContext("2d"),r=a.createImageData(e,n);for(let c=0,d=0;c<t.length;c+=1,d+=4)r.data[d]=t[c],r.data[d+1]=t[c],r.data[d+2]=t[c],r.data[d+3]=255;return a.putImageData(r,0,0),o}async function Gl(t){const e=await createImageBitmap(t),n=e.width,o=e.height,r=(typeof OffscreenCanvas=="function"?new OffscreenCanvas(n,o):Object.assign(document.createElement("canvas"),{width:n,height:o})).getContext("2d",{willReadFrequently:!0});if(!r)throw new Error("Không tạo được bộ giải mã ảnh.");r.drawImage(e,0,0),e.close();const c=r.getImageData(0,0,n,o).data,d=c.length;let u=!1;for(let p=0;p<d;p+=4){const f=c[p],y=c[p+1],S=c[p+2];if(Math.abs(f-y)>2||Math.abs(y-S)>2){u=!0;break}}if(Fe="main",u){const p=new Uint8Array(n*o*3);for(let f=0,y=0;f<d;f+=4,y+=3)p[y]=c[f],p[y+1]=c[f+1],p[y+2]=c[f+2];return{pixels:p,width:n,height:o,isColor:!0}}const h=new Uint8Array(n*o);for(let p=0,f=0;f<h.length;p+=4,f+=1)h[f]=c[p];return{pixels:h,width:n,height:o,isColor:!1}}function Ha(t){for(const e of qe.values())e.reject(t);qe.clear()}function Wl(){if(cn||typeof Worker!="function")return null;if(st)return st;try{return st=new Worker(new URL("/assets/image-worker-Bavxkbgc.js",import.meta.url),{type:"module"}),st.addEventListener("message",t=>{const{id:e,width:n,height:o,isColor:a,pixels:r,error:c}=t.data||{},d=qe.get(e);if(!d)return;if(qe.delete(e),c){d.reject(new Error(c));return}Fe="worker";const u=new Uint8Array(r);d.resolve({pixels:u.slice(),width:n,height:o,isColor:!!a})}),st.addEventListener("error",t=>{const e=new Error(t.message||"Bộ giải mã ảnh nền gặp sự cố.");Ha(e),st?.terminate(),st=null,cn=!0}),st}catch{return cn=!0,null}}async function Vl(t){const e=Wl();if(e)try{const n=++Al;return await new Promise((o,a)=>{qe.set(n,{resolve:o,reject:a}),e.postMessage({id:n,blob:t})})}catch(n){/OffscreenCanvas|createImageBitmap|giải mã ảnh nền/i.test(n?.message||"")&&(cn=!0,st?.terminate(),st=null)}return Gl(t)}function jl(t,e){const o={uint8:Uint8Array,int8:Int8Array,uint16:Uint16Array,int16:Int16Array,uint32:Uint32Array,int32:Int32Array}[e];if(!o)throw new Error(`Kiểu pixel DICOM chưa được hỗ trợ: ${e}`);return new o(t)}function Ul(t,e,n,o,a){if(e===1&&n===0)return{pixels:t,min:o,max:a};const r=Math.min(o*e+n,a*e+n),c=Math.max(o*e+n,a*e+n),d=Number.isInteger(e)&&Number.isInteger(n);let u=Float32Array;d&&(r>=-32768&&c<=32767?u=Int16Array:r>=-2147483648&&c<=2147483647&&(u=Int32Array));const h=new u(t.length);for(let p=0;p<t.length;p+=1)h[p]=t[p]*e+n;return{pixels:h,min:r,max:c}}function _a({rgb:t,rows:e,columns:n}){const o=e*n*3;if(!t||t.length!==o)throw new Error(`Pixel màu DICOM không đầy đủ: ${t?.length??0}/${o}.`);return{minPixelValue:0,maxPixelValue:255,slope:1,intercept:0,windowCenter:127.5,windowWidth:255,getPixelData:()=>t,rows:e,columns:n,height:e,width:n,color:!0,rgba:!1,numberOfComponents:3,invert:!1,photometricInterpretation:"RGB",sizeInBytes:t.byteLength,dataType:"Uint8Array"}}function Ga(t,e,n){const o=document.createElement("canvas");o.width=e,o.height=n;const a=o.getContext("2d"),r=a.createImageData(e,n);for(let c=0,d=0;c<t.length;c+=3,d+=4)r.data[d]=t[c],r.data[d+1]=t[c+1],r.data[d+2]=t[c+2],r.data[d+3]=255;return a.putImageData(r,0,0),o}function Kl(t,e,n,o,a,r){const c=new Uint8Array(t.length),d=Math.max(1,a-o);for(let u=0;u<t.length;u+=1){const h=Math.max(0,Math.min(255,Math.round((t[u]-o)/d*255)));c[u]=r?255-h:h}return Fa(c,e,n)}async function zl(t,e,n){const o=await _s(ba(e.seriesId,e.index)),a=n?.geometry?.pixelSpacing||n?.pixelData?.pixelSpacing;if(o.samples===3){const f=new Uint8Array(o.buffer);return Fe="dicom-color",{imageId:t,..._a({rgb:f,rows:o.rows,columns:o.columns}),getCanvas:()=>Ga(f,o.columns,o.rows),columnPixelSpacing:a?.[1],rowPixelSpacing:a?.[0],imageQualityStatus:mn.FULL_RESOLUTION}}const r=jl(o.buffer,o.pixelType);if(r.length!==o.rows*o.columns)throw new Error(`Pixel DICOM không đầy đủ: ${r.length}/${o.rows*o.columns}.`);const{pixels:c,min:d,max:u}=Ul(r,o.slope,o.intercept,o.min,o.max),h=n?.geometry?.pixelSpacing||n?.pixelData?.pixelSpacing,p=o.photometric==="MONOCHROME1";return Fe="dicom-direct",{imageId:t,minPixelValue:d,maxPixelValue:u,slope:1,intercept:0,preScale:{enabled:!0,scaled:!0,scalingParameters:{modality:n?.modality,rescaleSlope:o.slope,rescaleIntercept:o.intercept}},windowCenter:o.windowCenter,windowWidth:o.windowWidth,getPixelData:()=>c,getCanvas:()=>Kl(c,o.columns,o.rows,d,u,p),rows:o.rows,columns:o.columns,height:o.rows,width:o.columns,color:!1,rgba:!1,numberOfComponents:1,columnPixelSpacing:h?.[1],rowPixelSpacing:h?.[0],invert:p,photometricInterpretation:o.photometric,sizeInBytes:c.byteLength,dataType:c.constructor.name,imageQualityStatus:mn.FULL_RESOLUTION}}function Xl(t){const e=qa(t);return{promise:(async()=>{if(!e)throw new Error("ImageId không hợp lệ.");const o=me.get(e.seriesId);if(o?.sourceType==="dicom")return zl(t,e,o);const a=await je(ba(e.seriesId,e.index)),{pixels:r,width:c,height:d,isColor:u}=await Vl(a),h=o?.geometry?.pixelSpacing||o?.pixelData?.pixelSpacing;if(u)return{imageId:t,..._a({rgb:r,rows:d,columns:c}),getCanvas:()=>Ga(r,c,d),columnPixelSpacing:h?.[1],rowPixelSpacing:h?.[0],imageQualityStatus:mn.FULL_RESOLUTION};if(!$o){let p=255,f=0,y=0;for(const S of r)p=Math.min(p,S),f=Math.max(f,S),S&&(y+=1);$o={width:c,height:d,min:p,max:f,nonZero:y}}return{imageId:t,minPixelValue:0,maxPixelValue:255,slope:1,intercept:0,windowCenter:127.5,windowWidth:255,getPixelData:()=>r,getCanvas:()=>Fa(r,c,d),rows:d,columns:c,height:d,width:c,color:!1,rgba:!1,numberOfComponents:1,columnPixelSpacing:h?.[1],rowPixelSpacing:h?.[0],invert:!1,photometricInterpretation:"MONOCHROME2",sizeInBytes:r.byteLength,dataType:"Uint8Array",imageQualityStatus:mn.FULL_RESOLUTION}})()}}async function Jl(t={}){if(Jt=t.onStatus||Jt,xo=t.onSlice||xo,!Hi){await Ps(),await Ns(),qo.setConfiguration(El),qs(Uo,Xl),Ds(Hl,1e4);for(const e of ln)try{Ls(e)}catch{}Hi=!0}}function _i(t=""){return new Promise(e=>{const n=document.createElement("div");n.className="text-prompt-backdrop";const o=document.createElement("form");o.className="text-prompt";const a=document.createElement("label");a.textContent=bo;const r=document.createElement("input");r.type="text",r.maxLength=120,r.value=t;const c=document.createElement("div");c.className="text-prompt-actions";const d=document.createElement("button");d.type="button",d.textContent=ko;const u=document.createElement("button");u.type="submit",u.className="primary",u.textContent=wo;let h=!1;const p=f=>{h||(h=!0,n.remove(),e(f))};o.addEventListener("submit",f=>{f.preventDefault(),p(r.value.trim()||null)}),d.addEventListener("click",()=>p(null)),n.addEventListener("mousedown",f=>{f.target===n&&p(null)}),r.addEventListener("keydown",f=>{f.key==="Escape"&&p(null),f.stopPropagation()}),a.append(r),c.append(d,u),o.append(a,c),n.append(o),document.body.append(n),r.focus(),r.select()})}function Yl({label:t,confirm:e,cancel:n}){bo=t||bo,wo=e||wo,ko=n||ko}function Zl(t){t.setToolConfiguration(Ve.toolName,{getTextCallback:e=>{_i("").then(e)},changeTextCallback:(e,n,o)=>{_i(e?.data?.text||"").then(o)}})}function Yt(t){me.set(t.id,t)}async function Jo(t){if(!Dt.has(t.id))try{Dt.set(t.id,await N(`/api/series/${t.id}/manifest`))}catch{Dt.set(t.id,{})}return Dt.get(t.id)}function z(){return!!M&&Ko}function Ke(){R=za(),ir(),Be+=1,xn?.disconnect(),xn=null;for(const t of Ot)try{qo.disable(t)}catch{}if(Lt.removeAllAnnotations(),B&&(va(vo),B=null),zo="stack",z())for(const t of M.getViewports()||[])try{M.disableElement(t.id)}catch{}Ot=[],G="",bt=null}function Yo(){return z()||(M=new Es(jo),Ko=!0),M}function Ne(){Ke()}function Ql(){if(Ke(),z())try{M.destroy()}catch{}M=null,Ko=!1,Q=null,U=[],Ha(new Error("Cửa sổ viewer đã đóng.")),st?.terminate(),st=null}function Zo(t,e="stack"){const n=e==="volume3d";if(va(vo),B=As(vo),!B)throw new Error("Không tạo được nhóm công cụ.");zo=e;const o=Ka(e);for(const a of o)B.addTool(a.toolName);o.includes(Ve)&&Zl(B);for(const a of t)B.addViewport(a,jo);B.setToolActive(Rn.toolName,{bindings:[{mouseButton:Vt.Auxiliary}]}),B.setToolActive(Bn.toolName,{bindings:[{mouseButton:Vt.Secondary}]}),n||B.setToolActive(ma.toolName,{bindings:[{mouseButton:Vt.Wheel}]}),o.includes(de)&&B.setToolActive(de.toolName,{bindings:[{mouseButton:Vt.Primary,modifierKey:17}]}),o.includes(ct)&&jt&&(B.setToolEnabled(ct.toolName),Xe()),Za(),jn()}function Qo(t){xn=new ResizeObserver(()=>{try{M?.resize(!0,!0)}catch{}}),xn.observe(t)}async function Wa(){await new Promise(t=>requestAnimationFrame(()=>requestAnimationFrame(t))),z()&&(M.resize(!0,!0),M.render())}function be(t){if(!t||t.length!==3)return"";const e=Math.abs(t[0]),n=Math.abs(t[1]),o=Math.abs(t[2]),a=Math.max(e,n,o);return a===e?t[0]<0?"R":"L":a===n?t[1]<0?"A":"P":a===o?t[2]<0?"I":"S":""}function Zt(t){const e=String(t||"").trim();if(!e||/^[\*\?\s]+$/.test(e))return"";const n=e.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"").toUpperCase();return["ANON","ANONYMOUS","ANONYMIZED","ANONYMISED","REDACTED","MASKED","REMOVED","HIDDEN","UNKNOWN","XXX","XXXX","KHONGROTEN","KHONGROID"].includes(n)?"":e}function we(t,e=1){const n=Number(t);return Number.isFinite(n)?String(Number(n.toFixed(e))):""}function tc(t,e){const n=t?.acquisition||e?.acquisition||{},o=String(t?.modality||e?.modality||"").toUpperCase(),a=[];if(o==="MR"||o==="MRI"){const u=we(n.repetitionTime),h=we(n.echoTime,2);(u||h)&&a.push(`TR/TE: ${u||"—"} / ${h||"—"} ms`)}const r=we(n.kvp),c=we(n.exposure,2);(r||c)&&a.push([r&&`kVp: ${r}`,c&&`mAs: ${c}`].filter(Boolean).join("  "));const d=we(n.sliceThickness,2);return d&&a.push(`ST: ${d} mm`),a}function ec(t,e,n,o,a,r,c,d,u){const h=M?.getViewport(t);if(!h)return;const p=me.get(h.element?.dataset?.seriesId);if(!p)return;const f=Dt.get(p.id)||{},y=Zt(f.patientName)||Zt(f.patient_name)||"",S=Zt(f.patientId)||Zt(f.patient_id)||"",b=Zt(f.patientBirthDate)||Zt(f.patient_birth_date)||"",g=b?`DOB: ${b}`:"",$=[y,S,g].filter(Boolean);e.innerText=$.length?$.join(`
`):"— Hồ sơ không kèm thông tin định danh —";const O=p.modality||f.modality||"";let T=f.studyDate||f.study_date||p.studyDate||"";if(!T){const Y=(p.studyGroup||"").split(" - ");Y.length>0&&Y[0]!=="Không rõ ca chụp"&&/^\d{4}-\d{2}-\d{2}/.test(Y[0])&&(T=`${Y[0]} (thư mục)`)}const V=p.acquisition||f.acquisition||{},J=f.institutionName||f.institution_name||V.institutionName||"",kt=p.description||f.series_description||"",xt=V.accessionNumber?`Acc: ${V.accessionNumber}`:"",oo=p.sourceType==="dicom"?"DICOM":"JPG",Ye=`${O} · ${oo}`;n.innerText=[T,Ye,kt,xt,J].filter(Boolean).join(`
`);const W=Math.round((h.getZoom?.()||1)*100),at=(typeof h.getProperties=="function"?h.getProperties():{}).voiRange,Ht=at&&Number.isFinite(at.lower)&&Number.isFinite(at.upper)?`WW/WL: ${Math.round(at.upper-at.lower)} / ${Math.round((at.upper+at.lower)/2)}`:"";o.innerText=[`Zoom: ${W}%`,Ht,...tc(p,f)].filter(Boolean).join(`
`);let ye="";if(typeof h.getCurrentImageIdIndex=="function"){const Y=h.getCurrentImageIdIndex(),it=h.getImageIds?.().length||p.sliceCount||1;ye=`Im: ${Y+1}/${it}`}let ve="";if(h.getCamera){const Y=h.getCamera();if(Y.viewPlaneNormal&&Y.viewUp){const it=Y.viewPlaneNormal,et=Y.viewUp;r.innerText=be(et),c.innerText=be([-et[0],-et[1],-et[2]]);const rt=[et[1]*it[2]-et[2]*it[1],et[2]*it[0]-et[0]*it[2],et[0]*it[1]-et[1]*it[0]];u.innerText=be(rt),d.innerText=be([-rt[0],-rt[1],-rt[2]]);const $t=be(it);$t&&(ve=$t==="S"||$t==="I"?"Axial":$t==="L"||$t==="R"?"Sagittal":"Coronal")}}a.innerText=[ye,ve].filter(Boolean).join(`
`)}function Cn(t,e,n,o="",a=""){const r=document.createElement("section");r.className=`viewport-shell ${o}`.trim(),r.dataset.viewportId=e,r.dataset.seriesId=a;const c=document.createElement("div");c.className="viewport-label",c.textContent=n;const d=document.createElement("div");d.id=e,d.className="viewport",d.dataset.seriesId=a,d.oncontextmenu=T=>T.preventDefault();let u=null;d.addEventListener("pointerdown",T=>{He(e),T.button===2&&(u={x:T.clientX,y:T.clientY,time:Date.now()})}),d.addEventListener("pointerup",T=>{if(T.button!==2||!u)return;const V=T.clientX-u.x,J=T.clientY-u.y,kt=Math.hypot(V,J),xt=Date.now()-u.time;u=null,!(kt>4||xt>400)&&oc(e,T.clientX,T.clientY)}),d.addEventListener("dblclick",()=>{bt&&bt!==e&&document.getElementById(bt)?.closest(".viewport-shell")?.classList.remove("viewport-maximized"),bt=r.classList.toggle("viewport-maximized")?e:null,setTimeout(()=>M?.resize(!0,!1),0)});const h=document.createElement("div");h.className="orientation-marker orientation-t";const p=document.createElement("div");p.className="orientation-marker orientation-b";const f=document.createElement("div");f.className="orientation-marker orientation-l";const y=document.createElement("div");y.className="orientation-marker orientation-r";const S=document.createElement("div");S.className="viewport-overlay overlay-tl";const b=document.createElement("div");b.className="viewport-overlay overlay-tr";const g=document.createElement("div");g.className="viewport-overlay overlay-bl";const $=document.createElement("div");$.className="viewport-overlay overlay-br";const O=()=>ec(e,S,b,g,$,h,p,f,y);return d.addEventListener(Et.IMAGE_RENDERED,O),d.addEventListener(Et.CAMERA_MODIFIED,O),r.append(c,d,h,p,f,y,S,b,g,$),t.append(r),Ot.push(d),G||He(e),d}function nc(t,e){const n=document.createElement("button");n.type="button",n.className="mpr-swap-button",n.textContent="⇄",n.title=`Đưa ${e} vào khung lớn`,n.setAttribute("aria-label",n.title),n.addEventListener("pointerdown",o=>{He(t.dataset.viewportId),o.stopPropagation()}),n.addEventListener("click",o=>{o.stopPropagation(),Va(e)&&t.dispatchEvent(new CustomEvent("mprprimarychange",{bubbles:!0,detail:{plane:e}}))}),t.append(n)}function Wn({element:t,viewport:e,label:n,count:o,initialIndex:a,eventName:r,eventIndex:c,eventCount:d}){if(!Number.isFinite(o)||o<2)return;const u=t.closest(".viewport-shell");if(!u)return;const h=document.createElement("label");h.className="slice-control",h.innerHTML=`<button type="button" class="cine-btn" title="Chạy phim">▶</button>
    <input type="range" min="0" max="${o-1}" step="1" aria-label="Lát ảnh ${n}">`;const p=h.querySelector("input"),f=h.querySelector(".cine-btn");let y=null;f.addEventListener("click",b=>{b.stopPropagation(),He(t.id),y?(clearInterval(y),y=null,f.textContent="▶",f.title="Chạy phim"):(f.textContent="■",f.title="Dừng phim",y=setInterval(()=>{const g=e.getImageIds?.().length||o;let O=((e.getCurrentImageIdIndex?.()??0)+1)%g;typeof e.setImageIdIndex=="function"&&(e.setImageIdIndex(O),e.render())},90))});const S=(b,g=o)=>{const $=Math.max(1,Number(g)||o),O=Math.max(0,Math.min(Number(b)||0,$-1));p.max=String($-1),p.value=String(O),G===t.id&&xo({viewportId:t.id,label:n,index:O,count:$})};h.addEventListener("pointerdown",b=>{He(t.id),b.stopPropagation()}),p.addEventListener("input",()=>{const b=Number(p.value),g=e.getCurrentImageIdIndex?.()??e.getSliceIndex?.()??0,$=b-g;$&&e.scroll($),e.render()}),t.addEventListener(r,b=>{S(c(b.detail),d?.(b.detail)||o)}),u.append(h),S(a,o)}function He(t){if(G!==t){G=t;for(const e of document.querySelectorAll("#workspace .viewport-shell"))e.classList.toggle("is-active",e.dataset.viewportId===t);Xe()}}function oc(t,e,n){const o=M?.getViewport(t);if(!o)return;const a=o.element.getBoundingClientRect(),r=[e-a.left,n-a.top];let c;try{c=o.canvasToWorld(r)}catch{return}const d=B?.getToolInstance?.(fe.toolName);if(d?.setToolCenter)d.setToolCenter(c,!0),M?.render();else{const u=M?.getViewports()||[];let h=!1;for(const p of u){if(p.id===t||p.type!=="stack")continue;const f=Rs(c,p);f!=null&&(p.setImageIdIndex(f),h=!0)}h&&M?.render()}}function ti(){if(!z()||!G)return null;try{return M.getViewport(G)||null}catch{return null}}function ic(t){const e=["axial","coronal","sagittal"];if(!e.includes(t))return null;const n=e.filter(o=>o!==t);return{[t]:"mpr-primary",[n[0]]:"mpr-secondary-top",[n[1]]:"mpr-secondary-bottom"}}function Va(t,e=!0){const n=ic(t);if(!n)return!1;for(const o of document.querySelectorAll(".mode-mpr .mpr-plane")){o.classList.remove("mpr-primary","mpr-secondary-top","mpr-secondary-bottom");const a=n[o.dataset.plane];a&&o.classList.add(a)}return e&&requestAnimationFrame(()=>{try{M?.resize(!0,!0),M?.render()}catch{}}),!0}function ac(t=0,e=90){const n=Number.isFinite(Number(t))?Number(t):0,o=Number.isFinite(Number(e))?Number(e):0;return((n+o)%360+360)%360}function rc(t){const e=ti();if(!e||typeof e.getViewPresentation!="function"||typeof e.setViewPresentation!="function")return null;const n=e.getViewPresentation(),o=t(n||{});return e.setViewPresentation(o),e.render(),o}function sc(){return rc(t=>({...t,rotation:ac(t.rotation,90)}))}function ja(t){const e=ti();if(!e||typeof e.getCamera!="function"||typeof e.setCamera!="function")return null;const n=e.getCamera()||{},o={[t]:!n[t]};return e.setCamera(o),e.render(),o}function lc(){return ja("flipHorizontal")}function cc(){return ja("flipVertical")}function Vn(t){return Array.from({length:t.sliceCount},(e,n)=>_l(t.id,n))}function Ua(t,e,n=0,o=0){if(!Number.isInteger(t)||t<1)return[];if(!Number.isInteger(e)||e<1)return[];const a=Math.max(0,Math.min(n,e-1)),r=Math.max(0,Math.min(o,t-1)),c=Math.max(0,t-e),d=Math.max(0,Math.min(r-a,c));return Array.from({length:e},(u,h)=>Math.min(d+h,t-1))}function ei(t,e){const n=t.classList.contains("busy");t.className=`workspace-grid mode-${e}`,n&&t.classList.add("busy")}async function Gi(t,e,n=0,o=!0){const a=M.getStackViewport(t);await a.setStack(Vn(e),Math.max(0,Math.min(n,e.sliceCount-1))),a.resetCamera(),a.render();const r=document.getElementById(t);r.dataset.seriesId=e.id,r.closest(".viewport-shell").dataset.seriesId=e.id,Wn({element:r,viewport:a,label:e.name,count:e.sliceCount,initialIndex:n,eventName:Et.STACK_NEW_IMAGE,eventIndex:c=>c.imageIdIndex}),o&&qo.enable(r)}function In(t){return t?.geometry?.ordered_slices?t.geometry.ordered_slices:Dt.get(t?.id)?.ordered_slices||null}function Tn(t){return t?.geometry?.orientation?t.geometry.orientation:Dt.get(t?.id)?.image_orientation_patient||null}function Mn(t){if(!Array.isArray(t)||t.length!==6)return null;const e=t.slice(0,3),n=t.slice(3,6),o=e[1]*n[2]-e[2]*n[1],a=e[2]*n[0]-e[0]*n[2],r=e[0]*n[1]-e[1]*n[0],c=Math.hypot(o,a,r);return c<1e-6?null:[o/c,a/c,r/c]}function ni(t,e,n){const o=t?.geometry?.frameOfReferenceUID,a=n?.geometry?.frameOfReferenceUID;if(o&&a&&o!==a)return null;const r=Mn(Tn(t)),c=Mn(Tn(n));return r&&c&&Math.abs(r[0]*c[0]+r[1]*c[1]+r[2]*c[2])<.9?null:dc(t,e,n,r,c)}function Ka(t="stack"){return t==="volume3d"?[Ie,Rn,Bn]:t==="hybrid"?ln:t==="mpr"?ln.filter(e=>e!==Ie):ln.filter(e=>e!==Ie&&e!==fe)}function ze(t,e){const n=t?.geometry,o=e?.geometry,a=In(t),r=In(e),c=Mn(Tn(t)),d=Mn(Tn(e));if(!n||!o)return"index";if(!c||!d||!a?.length||!r?.length)return"blocked";const u=n.frameOfReferenceUID,h=o.frameOfReferenceUID;return u&&h&&u!==h?"blocked":Math.abs(c[0]*d[0]+c[1]*d[1]+c[2]*d[2])<.9?"reference":"spatial"}function dc(t,e,n,o,a){const r=In(t),c=In(n);if(!r?.[e]||!c?.length)return null;const d=r[e]?.position;if(!Array.isArray(d)||d.length!==3)return null;let u=0,h=1/0;if(a){const p=d[0]*a[0]+d[1]*a[1]+d[2]*a[2];let f=1/0,y=-1/0;for(let g=0;g<c.length;g+=1){const $=c[g]?.position;if(!Array.isArray($)||$.length!==3)continue;const O=$[0]*a[0]+$[1]*a[1]+$[2]*a[2];O<f&&(f=O),O>y&&(y=O);const T=Math.abs(p-O);T<h&&(h=T,u=g)}const S=y-f;if(Math.max(0,f-p,p-y)>Math.max(S,50))return null}else{for(let p=0;p<c.length;p+=1){const f=c[p]?.position;if(!Array.isArray(f)||f.length!==3)continue;const y=Math.hypot(d[0]-f[0],d[1]-f[1],d[2]-f[2]);y<h&&(h=y,u=p)}if(h>50)return null}return u}function uc(t,e,n,o,a=[]){const r=a[e],c=n-(t[e]??0);return t.map((d,u)=>{if(u===e)return n;const h=a[u],p=ze(r,h);if(p==="spatial"){const y=ni(r,n,h);return typeof y=="number"&&Number.isInteger(y)?y:d}if(p==="reference"||p==="blocked")return d;const f=Math.max(0,(o[u]||1)-1);return Math.max(0,Math.min(d+c,f))})}function za(){return{enabled:!1,anchor:null,viewportIds:[],seriesList:[],sliceCounts:[],spatialMode:null}}function Xa(){return R.viewportIds.map(t=>M?.getStackViewport(t)?.getCurrentImageIdIndex()??0)}function Ja(t){const e=new Set;for(let n=0;n<t.length;n+=1)for(let o=n+1;o<t.length;o+=1){const a=t[n],r=t[o];e.add(ze(a,r))}return e.size===1?[...e][0]:"mixed"}function Ya(t){if(!t||R.viewportIds.length<2)return R.enabled=!1,R.anchor=null,R.spatialMode=null,!1;const e=Ja(R.seriesList);return R.seriesList.some((o,a)=>R.seriesList.some((r,c)=>c>a&&["spatial","index"].includes(ze(o,r))))?(R.anchor=Xa(),R.enabled=!0,R.spatialMode=e,!0):(R.enabled=!1,R.anchor=null,R.spatialMode=e,!1)}function oi(){return{enabled:R.enabled,anchor:R.anchor?.slice()||null,spatialMode:R.spatialMode||null}}function Wi(t){return jt=!!t,!B||!B.hasTool(ct.toolName)||(jt?(B.setToolEnabled(ct.toolName),Xe()):B.setToolDisabled(ct.toolName),M?.render()),jt}function Xe(){if(!B||!B.hasTool(ct.toolName)||!jt||!G)return;const t=R.viewportIds.indexOf(G);if(!(t>=0?R.seriesList[t]:null)?.geometry){B.setToolDisabled(ct.toolName);return}B.setToolEnabled(ct.toolName),B.setToolConfiguration(ct.toolName,{sourceViewportId:G,enforceSameFrameOfReference:!0})}function _e(t){const e=t?.geometry?.pixelSpacing||t?.pixelData?.pixelSpacing||null;return!Array.isArray(e)||e.length<2?!1:e.slice(0,2).every(n=>Number.isFinite(Number(n))&&Number(n)>0)}function Za(){if(!B||!B.hasTool(sn.toolName))return;const t=U.length?U.every(_e):_e(Q);Xo&&t?B.setToolEnabled(sn.toolName):B.setToolDisabled(sn.toolName)}function hc(t){return Xo=!!t,Za(),M?.render(),Qa()}function Qa(){return Xo?U.length?U.every(_e):_e(Q):!1}function jn(){if(!(!B||!B.hasTool(ee.toolName))){if(!$n||R.viewportIds.length<2){B.setToolDisabled(ee.toolName);return}B.setToolConfiguration(ee.toolName,{positionSync:!1,disableCursor:!1,displayThreshold:5}),B.setToolPassive(ee.toolName)}}function Vi(t){return $n=!!t,jn(),M?.render(),$n}function pc(){if(!_n[ht]||!G)return null;const t=R.viewportIds.indexOf(G);if(t<0)return null;const e=R.seriesList[t];return{paneIndex:t,viewportId:G,seriesId:e?.id||""}}async function fc(){if(!bt||!_n[ht])return;const t=M?.getViewport(bt);if(!t||!U.length)return;const e=t.element?.dataset?.seriesId,n=U.findIndex(a=>a.id===e);if(n<0)return;const o=U[(n+1)%U.length];if(o&&o.id!==e){const a=G;G=bt,await tr(o),G=a}}async function tr(t){if(!_n[ht]||!G||!t)return null;const e=R.viewportIds.indexOf(G);if(e<0)return null;Yt(t),await Jo(t),R.seriesList[e]=t,R.sliceCounts[e]=t.sliceCount||1,U=[...new Map(R.seriesList.map(u=>[u.id,u])).values()];let n=Math.floor((t.sliceCount||1)/2);for(let u=0;u<R.viewportIds.length;u+=1){if(u===e)continue;const h=R.seriesList[u],f=M?.getStackViewport(R.viewportIds[u])?.getCurrentImageIdIndex()??0,y=ni(h,f,t);if(typeof y=="number"&&Number.isInteger(y)){n=y;break}}const o=G,a=document.getElementById(o),r=a?.closest(".viewport-shell");r?.querySelector(".slice-control")?.remove();const c=r?.querySelector(".viewport-label");c&&(c.textContent=t.name);const d=M?.getStackViewport(o);return await d.setStack(Vn(t),Math.max(0,Math.min(n,t.sliceCount-1))),d.resetCamera(),d.render(),a&&(a.dataset.seriesId=t.id),r&&(r.dataset.seriesId=t.id),Wn({element:a,viewport:d,label:t.name,count:t.sliceCount,initialIndex:n,eventName:Et.STACK_NEW_IMAGE,eventIndex:u=>u.imageIdIndex}),R.enabled&&(R.anchor=Xa(),R.spatialMode=Ja(R.seriesList)),Xe(),jn(),M?.render(),{paneIndex:e,viewportId:o}}function mc(t,e){R={enabled:!1,anchor:null,viewportIds:e,seriesList:t||[],sliceCounts:t.map(o=>o?.sliceCount||1),spatialMode:null};let n=!1;e.forEach((o,a)=>{const r=document.getElementById(o);r&&r.addEventListener(Et.STACK_NEW_IMAGE,async c=>{if(!R.enabled||!R.anchor||n)return;const d=uc(R.anchor,a,c.detail.imageIdIndex,R.sliceCounts,R.seriesList);n=!0;try{await new Promise(u=>window.setTimeout(u,0)),await Promise.all(e.map(async(u,h)=>{if(h===a)return;const p=M?.getStackViewport(u);!p||p.getCurrentImageIdIndex()===d[h]||await p.setImageIdIndex(d[h])})),M?.renderViewports(e)}finally{n=!1}})})}function gc(t,e){let n=!1;e.forEach((o,a)=>{document.getElementById(o).addEventListener(Et.STACK_NEW_IMAGE,async c=>{if(n)return;const d=Ua(t.sliceCount,e.length,a,c.detail.imageIdIndex);n=!0;try{await new Promise(u=>window.setTimeout(u,0)),await Promise.all(e.map(async(u,h)=>{const p=M?.getStackViewport(u);!p||p.getCurrentImageIdIndex()===d[h]||await p.setImageIdIndex(d[h])})),M?.renderViewports(e)}finally{n=!1}})})}async function yc(t,e,n,o=null,a=Tt){Ke(),Q=e;const r=_n[n]||0,c=r?[e,...Array.isArray(o)?o:[o]].slice(0,r).map(h=>h||e):[e];for(;r&&c.length<r;)c.push(e);U=[...new Map(c.map(h=>[h.id,h])).values()],ht=n;for(const h of U)Yt(h);for(const h of U)await Jo(h);t.innerHTML="",ei(t,n),Yo();const d=[];if(r)c.forEach((h,p)=>{const f=`stack-${String.fromCharCode(97+p)}`;d.push({viewportId:f,type:Pt.STACK,element:Cn(t,f,h.name,"",h.id)})});else{const h=n==="montage6"?6:n==="montage8"?8:1;for(let p=0;p<h;p+=1){const f=`stack-${p}`;d.push({viewportId:f,type:Pt.STACK,element:Cn(t,f,`${e.name} · ${p+1}`,"",e.id)})}}if(M.setViewports(d),Zo(d.map(h=>h.viewportId)),r){const h=Math.floor((c[0].sliceCount||1)/2),p=c.map((f,y)=>{if(y===0)return h;const S=ze(c[0],f);if(S==="spatial"){const b=ni(c[0],h,f);if(typeof b=="number"&&Number.isInteger(b))return b}return S==="index"?Math.min(h,(f.sliceCount||1)-1):Math.floor((f.sliceCount||1)/2)});await Promise.all(c.map((f,y)=>Gi(d[y].viewportId,f,p[y]))),mc(c,d.map(f=>f.viewportId)),Ya(!0),Xe(),jn()}else{const h=d.length,p=n==="single",f=h>1?Ua(e.sliceCount,h):[Math.floor(e.sliceCount/2)];await Promise.all(d.map((y,S)=>Gi(y.viewportId,e,f[S],p))),h>1&&gc(e,d.map(y=>y.viewportId))}Qo(t);const u=Un(a);for(const h of U)await ai(h);return Jt(e.geometry?"Đo chiều dài/ROI theo mm. Chuột giữa: pan · chuột phải: zoom · lăn: đổi lát.":e?.sourceType==="dicom"?"Series DICOM này thiếu hình học: chỉ xem/zoom/pan; không dùng kết quả đo vật lý.":"Series JPG không có hình học: chỉ xem/zoom/pan; không dùng kết quả đo vật lý."),u}class er extends Error{constructor(){super("Yêu cầu dựng volume đã bị thay thế."),this.name="SupersededError",this.superseded=!0}}async function vc(t,e,n=4){const o=Vn(t),a=o.filter(f=>!Nt.getImage(f));let r=o.length-a.length;const c=()=>{window.__volumeLoadState={volumeId:`${wn}:${t.id}`,loaded:r,processed:r,total:o.length,complete:r===o.length},Jt(`Đang nạp volume: ${r}/${o.length} lát…`,{loaded:r,total:o.length})};c();let d=0;const u=[],h=async()=>{for(;d<a.length;){if(e!==Be)return;const f=a[d];d+=1;try{await Bs(f),r+=1,(r===o.length||r%10===0)&&c()}catch(y){u.push({imageId:f,error:y})}}};if(await Promise.all(Array.from({length:Math.min(Math.max(1,n),Math.max(1,a.length))},()=>h())),e!==Be)throw new er;const p=o.filter(f=>!Nt.getImage(f));if(u.length||p.length)throw window.__volumeLoadState={volumeId:`${wn}:${t.id}`,loaded:o.length-p.length,processed:o.length,total:o.length,complete:!1},new Error(`Không thể nạp đủ volume: thiếu ${p.length||u.length}/${o.length} lát.`);return r=o.length,c(),o}async function nr(t){const e=Be;await Jo(t);const n=`${wn}:${t.id}`;Bc(t.id);const o=await vc(t,e);let a=Nt.getVolume(n);if(a?.loadStatus&&!a.loadStatus.loaded&&(Nt.removeVolumeLoadObject(n),a=null),a||(Jt(`Đang dựng volume từ đủ ${t.sliceCount} lát…`),a=await Os(n,o)),e!==Be)throw new er;if(a.imageIds?.length!==t.sliceCount)throw new Error(`Volume không đầy đủ: ${a.imageIds?.length||0}/${t.sliceCount} lát.`);return{id:n,volume:a}}async function bc(t,e,n="axial",o="crosshair"){if(!e.mprReady)throw new Error(e.mprReason);Ke(),Q=e,U=[e],ht="mpr",Yt(e),t.innerHTML="",ei(t,"mpr");const a=[["mpr-axial","AXIAL","axial",re.AXIAL],["mpr-coronal","CORONAL","coronal",re.CORONAL],["mpr-sagittal","SAGITTAL","sagittal",re.SAGITTAL]];Yo();const r=a.map(([u,h,p,f])=>{const y=Cn(t,u,h,"mpr-plane",e.id);return y.parentElement.dataset.plane=p,nc(y.parentElement,p),{viewportId:u,type:Pt.ORTHOGRAPHIC,element:y,defaultOptions:{orientation:f,background:[.01,.015,.025]}}});Va(n,!1),M.setViewports(r);const{id:c}=await nr(e);await ya(M,[{volumeId:c}],a.map(u=>u[0]));for(const[u]of a){const h=M.getViewport(u);h.resetCamera(),h.render()}for(const[u,h]of a){const p=M.getViewport(u),f=p.getNumberOfSlices?.()||e.sliceCount;Wn({element:document.getElementById(u),viewport:p,label:h,count:f,initialIndex:p.getSliceIndex?.()||0,eventName:Et.VOLUME_NEW_IMAGE,eventIndex:y=>y.imageIndex,eventCount:y=>y.numberOfSlices})}Zo(a.map(u=>u[0]),"mpr");const d=Un(o);return Qo(t),await Wa(),await ai(e),Jt("MPR dùng hình học DICOM thật · R/L, A/P, S/I do Cornerstone suy ra từ tọa độ bệnh nhân."),d}function ji(t,e){return Math.max(0,Math.min(t[1],e[1])-Math.max(t[0],e[0]))}function or(t,e,n){const o=Array.isArray(n)&&n.length===2?n.map(Number):null,a=[e.lower,e.upper].sort((u,h)=>u-h);if(!o||!o.every(Number.isFinite))return a;const r=Number.isFinite(t?.pixelData?.rescaleSlope)&&t.pixelData.rescaleSlope!==0?t.pixelData.rescaleSlope:1,c=Number.isFinite(t?.pixelData?.rescaleIntercept)?t.pixelData.rescaleIntercept:0,d=[(e.lower-c)/r,(e.upper-c)/r].sort((u,h)=>u-h);return ji(d,o)>ji(a,o)?d:a}function wc(t){const o=t?.getDefaultActor?.()?.actor?.getMapper?.()?.getInputData?.()?.getPointData?.()?.getScalars?.()?.getRange?.();return Array.isArray(o)&&o.length===2?o:null}function kc(t,e){const n=Array.isArray(e)&&e.length===2?e.map(Number):[0,255];if(t?.sourceType!=="dicom")return[0,255];const o=Ra("full",t);if(!o)return n;const a=or(t,o,n),r=Math.max(n[0],a[0]),c=Math.min(n[1],a[1]);return c>r?[r,c]:n}function xc(t,e){const o=t.getDefaultActor?.()?.actor,a=o?.getProperty?.();if(!a)return;const r=o.getMapper?.().getInputData?.().getPointData?.().getScalars?.(),[c,d]=kc(e,r?.getRange?.()),u=Math.max(1,d-c),h=y=>c+u*y,p=a.getRGBTransferFunction(0);p.removeAllPoints(),p.addRGBPoint(h(0),0,0,0),p.addRGBPoint(h(.2),.04,.025,.02),p.addRGBPoint(h(.42),.35,.22,.18),p.addRGBPoint(h(.67),.72,.58,.5),p.addRGBPoint(h(1),1,.94,.86);const f=a.getScalarOpacity(0);f.removeAllPoints(),f.addPoint(h(0),0),f.addPoint(h(.24),0),f.addPoint(h(.42),.03),f.addPoint(h(.64),.16),f.addPoint(h(.98),.46),f.addPoint(h(1),.72),a.setInterpolationTypeToLinear()}async function $c(t,e,n="orbit3d"){if(!e.mprReady)throw new Error(e.mprReason);Ke(),Q=e,U=[e],ht="volume3d",Yt(e),t.innerHTML="",ei(t,"volume3d"),Yo();const o=[["volume-axial","AXIAL",Pt.ORTHOGRAPHIC,re.AXIAL],["volume-coronal","CORONAL",Pt.ORTHOGRAPHIC,re.CORONAL],["volume-sagittal","SAGITTAL",Pt.ORTHOGRAPHIC,re.SAGITTAL],["volume-3d",`3D · ${e.description}`,Pt.VOLUME_3D,null]];M.setViewports(o.map(([d,u,h,p])=>({viewportId:d,type:h,element:Cn(t,d,u,d==="volume-3d"?"volume-render-pane":"volume-mpr-pane",e.id),defaultOptions:{...p?{orientation:p}:{},background:[.01,.015,.025]}})));const{id:a}=await nr(e),r=o.map(d=>d[0]);await ya(M,[{volumeId:a}],r),xc(M.getViewport("volume-3d"),e);for(const d of r){const u=M.getViewport(d);u.resetCamera(),u.render()}for(const[d,u,h]of o){if(h===Pt.VOLUME_3D)continue;const p=M.getViewport(d),f=p.getNumberOfSlices?.()||e.sliceCount;Wn({element:document.getElementById(d),viewport:p,label:u,count:f,initialIndex:p.getSliceIndex?.()||0,eventName:Et.VOLUME_NEW_IMAGE,eventIndex:y=>y.imageIndex,eventCount:y=>y.numberOfSlices})}Zo(r,"hybrid");const c=Un(n);return Qo(t),await Wa(),await ai(e),Jt("Ba mặt phẳng MPR và mô hình 3D dùng chung một volume đã nạp đầy đủ."),c}function yt(){const t=B?.getToolInstance?.(ct.toolName);return{mode:ht,sourceType:Q?.sourceType||"",engineId:z()?jo:"",destroyed:!z(),activeViewportId:G,tool:Tt,decodePath:Fe,lastDecodeStats:$o,referenceLines:{requested:jt,toolMode:t?.mode||"",toolOptions:B?.toolOptions?.[ct.toolName]||null,sourceViewportId:t?.configuration?.sourceViewportId||"",initialized:!!t?.editData?.annotation,pairModes:R.seriesList.map((e,n)=>R.seriesList.slice(n+1).map(o=>ze(e,o))).flat()},referenceCursor:(()=>{const e=B?.getToolInstance?.(ee.toolName);return{requested:$n,toolMode:e?.mode||"",positionSync:e?.configuration?.positionSync??null,displayThreshold:e?.configuration?.displayThreshold??null}})(),viewports:(z()?M.getViewports()||[]:[]).map(e=>{const n=e.getProperties?.()||{};return{id:e.id,actors:e.getActors?.().length||0,imageIndex:e.getCurrentImageIdIndex?.()??null,voiRange:n.voiRange||null,invert:!!n.invert,supportsInvert:"invert"in n}})}}function Sc(t,e=Ot.length,n=!1,o="stack"){if(!kn[t]||t==="crosshair"&&e<2||t==="orbit3d"&&!n)return"window";const a=kn[t];return Ka(o).some(r=>r.toolName===a)?t:"window"}function Un(t){const e=Ot.some(r=>r.id==="volume-3d"),n=Sc(t,Ot.length,e,zo),o=kn[n];if(!B)return Tt=n,Tt;if(!o||!B.hasTool(o))return Tt="window",Tt;for(const r of Object.values(kn))if(r!==o&&B.hasTool(r))try{r===de.toolName?B.setToolActive(r,{bindings:[{mouseButton:Vt.Primary,modifierKey:17}]}):B.setToolPassive(r)}catch{}const a=[{mouseButton:Vt.Primary}];return o===de.toolName&&a.push({mouseButton:Vt.Primary,modifierKey:17}),B.setToolActive(o,{bindings:a}),Tt=n,Tt}function Cc(){if(!z()||!G)return;const t=M.getViewport(G);if(t&&(t.resetCamera(),typeof t.resetProperties=="function"&&t.resetProperties(),t.render(),(ht==="mpr"||ht==="volume3d")&&t.id!=="volume-3d")){const e=t.getCamera?.().focalPoint,n=B?.getToolInstance?.(fe.toolName);e&&n?.setToolCenter&&(n.setToolCenter([...e],!0),M.render())}}function Ic(){if(z()){for(const t of M.getViewports()||[])t.resetCamera(),typeof t.resetProperties=="function"&&t.resetProperties(),t.render();if(ht==="mpr"||ht==="volume3d"){const e=(M.getViewports()||[]).find(o=>o.id!=="volume-3d"&&o.getCamera?.().focalPoint)?.getCamera?.().focalPoint,n=B?.getToolInstance?.(fe.toolName);e&&n?.setToolCenter&&(n.setToolCenter([...e],!0),M.render())}}}async function Ge(t){const e=Ra(t,Q);if(!e||!z())return!1;const n=new Set((M.getStackViewports()||[]).map(o=>o.id));for(const o of M.getViewports()||[]){if(o.id==="volume-3d"||typeof o.setProperties!="function")continue;let a=e;if(!n.has(o.id)){const[r,c]=or(Q,e,wc(o));a={lower:r,upper:c}}o.setProperties({voiRange:{...a}}),o.render()}return await new Promise(o=>requestAnimationFrame(()=>requestAnimationFrame(o))),!0}function Tc(){if(!z())return 0;let t=0;for(const e of M.getViewports()||[]){if(typeof e.getProperties!="function"||typeof e.setProperties!="function")continue;const n=e.getProperties();if(!(!n||!("invert"in n)))try{e.setProperties({invert:!n.invert}),e.render(),t+=1}catch{}}return t}function Ui(t){const e=ti()||(z()?M.getViewports()?.[0]:null);return!e||typeof e.scroll!="function"?!1:(e.scroll(t),!0)}function Mc(t,e){if(Pe)return ir(),!1;if(!z())return!1;const n=bt||G||"stack-0",o=M.getStackViewport(n);if(!o||!o.getCurrentImageIdIndex||typeof o.setImageIdIndex!="function")return!1;const a=o.getImageIds?.().length||t?.sliceCount||1;return Pe=window.setInterval(()=>{const r=(o.getCurrentImageIdIndex()+1)%a;o.setImageIdIndex(r),o.render()},90),!0}function ir(){Pe&&(window.clearInterval(Pe),Pe=null)}async function Pc(){const t=document.getElementById(G)||Ot[0],e=t?.querySelector("canvas");if(!e)throw new Error("Chưa có ảnh để lưu.");const n=t.closest(".viewport-shell")?.querySelector(".viewport-label")?.textContent,o=await new Promise(c=>e.toBlob(c,"image/png"));if(!o)throw new Error("Không đọc được ảnh từ khung xem.");const a=URL.createObjectURL(o),r=document.createElement("a");return r.href=a,r.download=`DCom_${Date.now()}.png`,r.click(),window.setTimeout(()=>URL.revokeObjectURL(a),6e4),n||G}function Kn(t,e){return!t||!e?!1:String(t.metadata?.referencedImageId||"").includes(e)||String(t.metadata?.volumeId||"").includes(e)?!0:Object.keys(t.data?.cachedStats||{}).some(n=>n.includes(e))}function ar(t){return Ol.has(t?.metadata?.toolName)}async function Nc(){const t=new Set(U.map(n=>n.id));!t.size&&Q?.id&&t.add(Q.id);const e=Lt.getAllAnnotations().filter(n=>ar(n)&&(!t.size||[...t].some(o=>Kn(n,o))));for(const n of e)n.annotationUID&&Lt.removeAnnotation(n.annotationUID);return z()&&M.render(),await ii(),e.length}async function Dc(){const t=new Set(U.map(n=>n.id));!t.size&&Q?.id&&t.add(Q.id);const e=Lt.getAllAnnotations().filter(n=>ar(n)&&(!t.size||[...t].some(o=>Kn(n,o))));if(e.length>0){const n=e[e.length-1];return n.annotationUID&&Lt.removeAnnotation(n.annotationUID),z()&&M.render(),await ii(),1}return 0}function rr(t){return Lt.getAllAnnotations().filter(e=>!t||Kn(e,t)).map(e=>JSON.parse(JSON.stringify(e)))}async function sr(t){const e=rr(t.id);return await N(`/api/series/${t.id}/annotations`,{method:"POST",body:JSON.stringify({annotations:e})}),e.length}async function ii(t=null){const e=t?[t]:U.length?U:Q?[Q]:[];let n=0;for(const o of e)n+=await sr(o);return n}async function Lc(){const t=U.filter(e=>rr(e.id).length);if(!t.length)return 0;try{let e=0;for(const n of t)e+=await sr(n);return e}catch{return-1}}function Ki(t,e){if(!Array.isArray(t)||!Array.isArray(e)||t.length!==3||e.length!==3)return!1;const n=Math.hypot(...t),o=Math.hypot(...e);if(!n||!o)return!1;const a=t.reduce((r,c,d)=>r+c*e[d],0);return Math.abs(a/n/o)>=.999}function Ec(t,e){if(!t||!Array.isArray(e)||!e.length)return"";const n=t.metadata?.viewPlaneNormal,o=String(t.metadata?.referencedImageId||"");if(o){const c=e.filter(u=>u.imageIds?.includes(o));if(c.length===1)return c[0].id;if(c.length>1&&Array.isArray(n)){const u=c.find(h=>Ki(n,h.viewPlaneNormal));if(u)return u.id}if(c.length)return c[0].id;const d=e.filter(u=>u.seriesId&&o.includes(u.seriesId));if(d.length)return d[0].id}const a=[t.metadata?.volumeId,...Object.keys(t.data?.cachedStats||{})].join(" "),r=a?e.filter(c=>!c.seriesId||a.includes(c.seriesId)):[...e];if(Array.isArray(n)){const c=r.find(d=>Ki(n,d.viewPlaneNormal));if(c)return c.id}return r.length===1?r[0].id:""}function Oc(){return z()?Ot.map(t=>{let e=null;try{e=M.getViewport(t.id)}catch{}return{id:t.id,seriesId:t.dataset.seriesId||"",imageIds:e?.getImageIds?.()||[],viewPlaneNormal:e?.getCamera?.().viewPlaneNormal||null}}):[]}async function ai(t){const e=await N(`/api/series/${t.id}/annotations`);if(!Array.isArray(e.annotations)||!e.annotations.length)return;const n=Oc();for(const o of e.annotations){const a=Ec(o,n),r=a?document.getElementById(a):null;if(r)try{Lt.addAnnotation(o,r)}catch{}}z()&&M.render()}function Co(t,e=0){if(!t||e>5)return null;if(typeof t.area=="number"&&Number.isFinite(t.area))return t.area;if(Array.isArray(t))for(const n of t){const o=Co(n,e+1);if(o!=null)return o}else if(typeof t=="object")for(const n of Object.values(t)){const o=Co(n,e+1);if(o!=null)return o}return null}function Ac(t=Q){if(!t?.mprReady)throw new Error("Chỉ tính thể tích khi series có hình học DICOM hợp lệ.");const e=new Set([qn.toolName,Fn.toolName]),n=t.geometry.orientation,o=n.slice(0,3),a=n.slice(3,6),r=[o[1]*a[2]-o[2]*a[1],o[2]*a[0]-o[0]*a[2],o[0]*a[1]-o[1]*a[0]],c=u=>{const h=u.metadata?.viewPlaneNormal;return!Array.isArray(h)||h.length!==3?!!u.metadata?.referencedImageId:Math.abs(h.reduce((f,y,S)=>f+y*r[S],0))>=.999},d=Lt.getAllAnnotations().filter(u=>Kn(u,t.id)&&e.has(u.metadata?.toolName)&&c(u)).map(u=>Co(u.data?.cachedStats)).filter(u=>u!=null&&u>=0);if(!d.length)throw new Error("Chưa có ROI ellipse/freehand đủ dữ liệu trên các lát.");return d.reduce((u,h)=>u+h,0)*t.geometry.sliceSpacing/1e3}function Rc(t){const e=me.get(t);if(!t||!e)return 0;const n=`${wn}:${t}`;try{Nt.getVolume(n)&&Nt.removeVolumeLoadObject(n)}catch{}let o=0;for(const a of Vn(e))if(Nt.getImage(a))try{Nt.removeImageLoadObject(a),o+=1}catch{}return o}function Bc(t){for(const e of me.keys())e!==t&&Rc(e)}function qc(){if(!z()||!G)return 0;try{const t=M.getViewport(G);if(t){if(typeof t.getCurrentImageIdIndex=="function"){const e=t.getCurrentImageIdIndex();if(typeof e=="number"&&!Number.isNaN(e))return Math.max(0,e)}if(typeof t.getSliceIndex=="function"){const e=t.getSliceIndex();if(typeof e=="number"&&!Number.isNaN(e))return Math.max(0,e)}}}catch{}return 0}const zn=[{id:"select",shape:null,key:"V",icon:"cursor",label:"Chọn / di chuyển"},{id:"arrow",shape:"arrow",key:"A",icon:"arrow",label:"Mũi tên chỉ điểm"},{id:"line",shape:"line",key:"L",icon:"line",label:"Đường thẳng"},{id:"rect",shape:"rect",key:"R",icon:"rect",label:"Khung chữ nhật"},{id:"ellipse",shape:"ellipse",key:"E",icon:"ellipse",label:"Khung bầu dục"},{id:"pen",shape:"pen",key:"P",icon:"pen",label:"Bút vẽ tay"},{id:"text",shape:"text",key:"T",icon:"text",label:"Chèn chữ"},{id:"marker",shape:"marker",key:"N",icon:"marker",label:"Đánh số thứ tự"},{id:"highlight",shape:"highlight",key:"H",icon:"highlight",label:"Tô sáng vùng"},{id:"pixelate",shape:"pixelate",key:"B",icon:"pixelate",label:"Làm mờ vùng"},{id:"redact",shape:"redact",key:"X",icon:"redact",label:"Che kín danh tính"},{id:"crop",shape:null,key:"C",icon:"crop",label:"Cắt ảnh theo vùng chọn"}],zi=new Map(zn.map(t=>[t.id,t]));function Ut(t){return zi.get(t)||zi.get("select")}const Fc=["#ff3b30","#ff9500","#ffcc00","#34c759","#00c7be","#0a84ff","#ffffff","#000000"],Bt=new Set(["rect","ellipse","highlight","pixelate","redact"]),qt=new Set(["arrow","line"]);function Hc(t,e){if(e==null)return!0;const n=t?.startS,o=t?.endS;return n==null||o===null||o===void 0?!0:e>=n&&e<=o}let Xi=0;function _c(){return Xi+=1,`sh_${Xi}`}function Gc(){return{color:"#ff3b30",strokeWidth:4,fontSize:28,opacity:1,filled:!1,textBackground:!0}}function Wc(){return{shapes:[],past:[],future:[]}}function ri(t){return t.map(e=>({...e,points:e.points?e.points.map(n=>({...n})):void 0}))}function St(t){t&&(t.past.push(ri(t.shapes)),t.past.length>100&&t.past.shift(),t.future.length=0)}function lr(t){return!!t?.past?.length}function cr(t){return!!t?.future?.length}function Vc(t){return lr(t)?(t.future.push(ri(t.shapes)),t.shapes=t.past.pop(),!0):!1}function jc(t){return cr(t)?(t.past.push(ri(t.shapes)),t.shapes=t.future.pop(),!0):!1}function Uc(t){const e=(t?.shapes||[]).filter(n=>n.kind==="marker").map(n=>Number(n.label)||0);return e.length?Math.max(...e)+1:1}function ao(t,e,n,o={}){const a={id:_c(),kind:t,color:n.color,strokeWidth:n.strokeWidth,opacity:n.opacity,...o};return qt.has(t)?{...a,x1:e.x,y1:e.y,x2:e.x,y2:e.y}:Bt.has(t)?{...a,x:e.x,y:e.y,width:0,height:0,filled:n.filled}:t==="pen"?{...a,points:[{x:e.x,y:e.y}]}:t==="text"?{...a,x:e.x,y:e.y,text:"",fontSize:n.fontSize,background:n.textBackground}:t==="marker"?{...a,x:e.x,y:e.y,fontSize:n.fontSize,label:o.label||1}:a}function Kc(t,e,n={}){if(t){if(qt.has(t.kind)){t.x2=e.x,t.y2=e.y;return}if(Bt.has(t.kind)){const o=t.originX??t.x,a=t.originY??t.y;let r=e.x-o,c=e.y-a;if(n.square){const d=Math.max(Math.abs(r),Math.abs(c));r=Math.sign(r||1)*d,c=Math.sign(c||1)*d}t.x=Math.min(o,o+r),t.y=Math.min(a,a+c),t.width=Math.abs(r),t.height=Math.abs(c);return}if(t.kind==="pen"){const o=t.points[t.points.length-1];(!o||Math.hypot(e.x-o.x,e.y-o.y)>=1)&&t.points.push({x:e.x,y:e.y})}}}function zc(t,e){Bt.has(t?.kind)&&(t.originX=e.x,t.originY=e.y)}function Pn(t){return t?qt.has(t.kind)?Math.hypot(t.x2-t.x1,t.y2-t.y1)>=4:Bt.has(t.kind)?t.width>=4&&t.height>=4:t.kind==="pen"?t.points.length>=2:t.kind==="text"?String(t.text||"").trim().length>0:t.kind==="marker":!1}function si(t,e=null){if(!t)return null;if(qt.has(t.kind))return{x:Math.min(t.x1,t.x2),y:Math.min(t.y1,t.y2),width:Math.abs(t.x2-t.x1),height:Math.abs(t.y2-t.y1)};if(Bt.has(t.kind))return{x:t.x,y:t.y,width:t.width,height:t.height};if(t.kind==="pen"){const n=t.points.map(c=>c.x),o=t.points.map(c=>c.y),a=Math.min(...n),r=Math.min(...o);return{x:a,y:r,width:Math.max(...n)-a,height:Math.max(...o)-r}}if(t.kind==="text"){const n=e?e(t):{width:t.fontSize*6,height:t.fontSize};return{x:t.x,y:t.y,width:n.width,height:n.height}}if(t.kind==="marker"){const n=dr(t);return{x:t.x-n,y:t.y-n,width:n*2,height:n*2}}return null}function dr(t){return Math.max(12,(t.fontSize||28)*.75)}function ur(t,e,n){if(t){if(qt.has(t.kind)){t.x1+=e,t.y1+=n,t.x2+=e,t.y2+=n;return}if(t.kind==="pen"){t.points.forEach(o=>{o.x+=e,o.y+=n});return}t.x+=e,t.y+=n}}function Xc(t,e,n){const o=si(t);if(!o)return;const a=Math.min(0,e-(o.x+o.width))-Math.min(0,o.x),r=Math.min(0,n-(o.y+o.height))-Math.min(0,o.y);(a||r)&&ur(t,a,r)}function hr(t){if(!t)return[];if(qt.has(t.kind))return[{id:"p1",x:t.x1,y:t.y1},{id:"p2",x:t.x2,y:t.y2}];if(Bt.has(t.kind)){const{x:e,y:n,width:o,height:a}=t;return[{id:"nw",x:e,y:n},{id:"ne",x:e+o,y:n},{id:"se",x:e+o,y:n+a},{id:"sw",x:e,y:n+a}]}return[]}function Jc(t,e,n){if(!t)return;if(e==="p1"){t.x1=n.x,t.y1=n.y;return}if(e==="p2"){t.x2=n.x,t.y2=n.y;return}if(!Bt.has(t.kind))return;const o=t.x+t.width,a=t.y+t.height,r=e==="nw"||e==="sw"?o:t.x,c=e==="nw"||e==="ne"?a:t.y;t.x=Math.min(r,n.x),t.y=Math.min(c,n.y),t.width=Math.abs(n.x-r),t.height=Math.abs(n.y-c)}function Ji(t,e,n,o,a){const r=o-e,c=a-n,d=r*r+c*c;if(!d)return Math.hypot(t.x-e,t.y-n);let u=((t.x-e)*r+(t.y-n)*c)/d;return u=Math.max(0,Math.min(1,u)),Math.hypot(t.x-(e+u*r),t.y-(n+u*c))}function ro(t,e,n=6,o=null){for(let a=t.length-1;a>=0;a-=1)if(Yc(t[a],e,n,o))return t[a];return null}function Yc(t,e,n=6,o=null){if(!t)return!1;const a=Math.max(n,(t.strokeWidth||1)/2+n);if(qt.has(t.kind))return Ji(e,t.x1,t.y1,t.x2,t.y2)<=a;if(t.kind==="pen"){for(let d=1;d<t.points.length;d+=1){const u=t.points[d-1],h=t.points[d];if(Ji(e,u.x,u.y,h.x,h.y)<=a)return!0}return!1}const r=si(t,o);if(!r||!(e.x>=r.x-a&&e.x<=r.x+r.width+a&&e.y>=r.y-a&&e.y<=r.y+r.height+a))return!1;if(t.kind==="rect"&&!t.filled){const d=e.x>=r.x+a&&e.x<=r.x+r.width-a,u=e.y>=r.y+a&&e.y<=r.y+r.height-a;return!(d&&u)}return!0}function pr(t){const e=String(t||"").replace("#",""),n=e.length===3?e.split("").map(a=>a+a).join(""):e.padEnd(6,"0").slice(0,6),o=parseInt(n,16);return[o>>16&255,o>>8&255,o&255]}function li(t,e=1){return`600 ${Math.max(8,(t.fontSize||28)*e)}px "Segoe UI", Arial, sans-serif`}function fr(t){return String(t.text||"").split(`
`)}function mr(t,e){t.save(),t.font=li(e,1);const n=fr(e),o=Math.max(...n.map(r=>t.measureText(r).width),1);t.restore();const a=(e.fontSize||28)*1.25;return{width:o,height:a*n.length}}function Zc(t,e,n){const o=n.scale||1,a=Math.max(1,(e.strokeWidth||1)*o);t.save(),t.globalAlpha=e.opacity??1,t.strokeStyle=e.color,t.fillStyle=e.color,t.lineWidth=a,t.lineCap="round",t.lineJoin="round";const r=c=>c*o;switch(e.kind){case"line":t.beginPath(),t.moveTo(r(e.x1),r(e.y1)),t.lineTo(r(e.x2),r(e.y2)),t.stroke();break;case"arrow":Qc(t,e,o);break;case"rect":e.filled?t.fillRect(r(e.x),r(e.y),r(e.width),r(e.height)):t.strokeRect(r(e.x),r(e.y),r(e.width),r(e.height));break;case"ellipse":t.beginPath(),t.ellipse(r(e.x+e.width/2),r(e.y+e.height/2),Math.max(1,r(e.width/2)),Math.max(1,r(e.height/2)),0,0,Math.PI*2),e.filled?t.fill():t.stroke();break;case"highlight":t.globalAlpha=(e.opacity??1)*.35,t.fillRect(r(e.x),r(e.y),r(e.width),r(e.height));break;case"redact":t.fillStyle="#000000",t.globalAlpha=1,t.fillRect(r(e.x),r(e.y),r(e.width),r(e.height));break;case"pixelate":id(t,e,n);break;case"pen":t.beginPath(),e.points.forEach((c,d)=>{d===0?t.moveTo(r(c.x),r(c.y)):t.lineTo(r(c.x),r(c.y))}),t.stroke();break;case"text":td(t,e,o);break;case"marker":ed(t,e,o);break}t.restore()}function Qc(t,e,n){const o=f=>f*n,a=Math.max(1,(e.strokeWidth||1)*n),r=Math.atan2(e.y2-e.y1,e.x2-e.x1),c=Math.max(a*3.2,10),d=o(e.x2),u=o(e.y2),h=d-Math.cos(r)*c*.72,p=u-Math.sin(r)*c*.72;t.beginPath(),t.moveTo(o(e.x1),o(e.y1)),t.lineTo(h,p),t.stroke(),t.beginPath(),t.moveTo(d,u),t.lineTo(d-c*Math.cos(r-Math.PI/7),u-c*Math.sin(r-Math.PI/7)),t.lineTo(d-c*Math.cos(r+Math.PI/7),u-c*Math.sin(r+Math.PI/7)),t.closePath(),t.fill()}function td(t,e,n){const o=fr(e),a=(e.fontSize||28)*n,r=a*1.25;t.font=li(e,n),t.textBaseline="top";const c=Math.max(...o.map(h=>t.measureText(h).width),1),d=e.x*n,u=e.y*n;if(e.background){const h=a*.22;t.fillStyle="rgba(0, 0, 0, 0.6)",t.fillRect(d-h,u-h,c+h*2,r*o.length+h*2)}t.fillStyle=e.color,o.forEach((h,p)=>t.fillText(h,d,u+p*r))}function ed(t,e,n){const o=dr(e)*n;t.beginPath(),t.arc(e.x*n,e.y*n,o,0,Math.PI*2),t.fillStyle=e.color,t.fill(),t.lineWidth=Math.max(1,o*.12),t.strokeStyle="rgba(255, 255, 255, 0.92)",t.stroke(),t.fillStyle=nd(e.color),t.font=`700 ${o*1.15}px "Segoe UI", Arial, sans-serif`,t.textAlign="center",t.textBaseline="middle",t.fillText(String(e.label??1),e.x*n,e.y*n+o*.05),t.textAlign="start"}function nd(t){const[e,n,o]=pr(t);return(.299*e+.587*n+.114*o)/255>.6?"#111111":"#ffffff"}function od(t){return Math.max(4,Math.round((t.strokeWidth||4)*2.5))}function id(t,e,n){const o=n.scale||1,a=e.x*o,r=e.y*o,c=e.width*o,d=e.height*o,u=n.image;if(!u||!c||!d){t.fillStyle="rgba(20, 20, 20, 0.85)",t.fillRect(a,r,c,d);return}const h=od(e),p=Math.max(1,Math.round(e.width/h)),f=Math.max(1,Math.round(e.height/h)),y=n.buffer;if(!y)return;y.width=p,y.height=f;const S=y.getContext("2d");S.imageSmoothingEnabled=!0;try{S.drawImage(u,e.x,e.y,e.width,e.height,0,0,p,f)}catch{return}t.imageSmoothingEnabled=!1,t.drawImage(y,0,0,p,f,a,r,c,d),t.imageSmoothingEnabled=!0}function ad(t,e,n,o,a=!0){const r=n.scale||1,c=si(e,o);if(!c)return;const d=4;t.save(),t.strokeStyle="#4da3ff",t.lineWidth=1,t.setLineDash([5,4]),t.strokeRect(c.x*r-d,c.y*r-d,c.width*r+d*2,c.height*r+d*2),t.setLineDash([]);for(const u of a?hr(e):[])t.beginPath(),t.rect(u.x*r-4,u.y*r-4,8,8),t.fillStyle="#ffffff",t.fill(),t.strokeStyle="#1a73e8",t.stroke();t.restore()}function rd(t,e,n,o=null,a={}){if(!t)return;const r=t.getContext("2d");if(!r)return;const c=n.dpr||1;r.setTransform(c,0,0,c,0,0),r.clearRect(0,0,t.width/c,t.height/c);const d=h=>mr(r,h);for(const h of e){if(h.editing)continue;!Hc(h,a.time??null)&&(r.globalAlpha=.22),Zc(r,h,n),r.globalAlpha=1}const u=e.find(h=>h.id===o);u&&!u.editing&&ad(r,u,n,d,a.handles!==!1)}function sd(t){const e={kind:t.kind,color:pr(t.color),stroke_width:Math.max(1,Math.round(t.strokeWidth||1)),opacity:Number(t.opacity??1)};Number.isFinite(t.startS)&&Number.isFinite(t.endS)&&(e.start_s=Number(t.startS),e.end_s=Number(t.endS));const n=o=>Math.round(Number(o)||0);return qt.has(t.kind)?{...e,x1:n(t.x1),y1:n(t.y1),x2:n(t.x2),y2:n(t.y2)}:Bt.has(t.kind)?{...e,x:n(t.x),y:n(t.y),width:n(t.width),height:n(t.height),filled:!!t.filled}:t.kind==="pen"?{...e,points:t.points.map(o=>[n(o.x),n(o.y)])}:t.kind==="text"?{...e,x:n(t.x),y:n(t.y),text:String(t.text||""),font_size:Math.max(6,n(t.fontSize)),background:!!t.background}:t.kind==="marker"?{...e,x:n(t.x),y:n(t.y),label:String(t.label??1),font_size:Math.max(6,n(t.fontSize))}:e}function gr(t){return t.filter(Pn).map(sd)}const on=9;let De=null;function K(){return De}function ci(){De&&(De.destroy(),De=null)}function ld(t){const{wrap:e,img:n,canvas:o,getLayer:a,getStyle:r,getTool:c,scroller:d}=t;if(!e||!n||!o)return null;ci();const u=t.onChange||(()=>{}),h=t.onStatus||(()=>{}),p=t.onToolDone||(()=>{}),f=t.shapeExtras||(()=>({})),y=t.getTime||(()=>null),S=typeof document<"u"?document.createElement("canvas"):null,b={selectedId:null,crop:null,zoom:0,editor:null,destroyed:!1};let g=null,$=null,O=!1;function T(){return n.getBoundingClientRect()}function V(){const v=T();return{width:n.naturalWidth||n.videoWidth||v.width||1,height:n.naturalHeight||n.videoHeight||v.height||1}}b.naturalSize=V;function J(){const v=T();return v.width?v.width/V().width:1}function kt(v){const w=T(),I=J()||1;return{x:(v.clientX-w.left)/I,y:(v.clientY-w.top)/I}}function xt(v){const w=V();return{x:Math.max(0,Math.min(v.x,w.width)),y:Math.max(0,Math.min(v.y,w.height))}}function oo(){return{scale:J(),dpr:typeof window<"u"&&window.devicePixelRatio||1,image:n,buffer:S}}function Ye(){const v=T(),w=e.getBoundingClientRect(),I=typeof window<"u"&&window.devicePixelRatio||1,D=Math.max(1,Math.round(v.width)),H=Math.max(1,Math.round(v.height));o.style.left=`${v.left-w.left}px`,o.style.top=`${v.top-w.top}px`,o.style.width=`${D}px`,o.style.height=`${H}px`,(o.width!==Math.round(D*I)||o.height!==Math.round(H*I))&&(o.width=Math.round(D*I),o.height=Math.round(H*I))}function W(){if(b.destroyed)return;Ye();const v=a(),w=v?v.shapes:[],I=g?.draft?[...w,g.draft]:w;rd(o,I,oo(),b.selectedId,{handles:Ut(c()).id==="select",time:y()}),b.crop&&Di(),et()}b.repaint=W,b.syncSize=Ye;function Di(){const v=o.getContext("2d");if(!v)return;const w=J(),I=typeof window<"u"&&window.devicePixelRatio||1,D=b.crop,H=o.width/I,en=o.height/I;v.save(),v.setTransform(I,0,0,I,0,0),v.fillStyle="rgba(0, 0, 0, 0.55)",v.beginPath(),v.rect(0,0,H,en),v.rect(D.x*w,D.y*w,D.width*w,D.height*w),v.fill("evenodd"),v.strokeStyle="#ffffff",v.lineWidth=1,v.setLineDash([6,4]),v.strokeRect(D.x*w,D.y*w,D.width*w,D.height*w),v.setLineDash([]),v.strokeStyle="rgba(255, 255, 255, 0.35)";for(let nt=1;nt<3;nt+=1){const _t=(D.x+D.width*nt/3)*w,qi=(D.y+D.height*nt/3)*w;v.beginPath(),v.moveTo(_t,D.y*w),v.lineTo(_t,(D.y+D.height)*w),v.moveTo(D.x*w,qi),v.lineTo((D.x+D.width)*w,qi),v.stroke()}v.restore()}function at(){return a()?.shapes||[]}function Ht(){return at().find(v=>v.id===b.selectedId)||null}b.selectedShape=Ht;function ye(v){b.selectedId!==v&&(b.selectedId=v,u({reason:"select"}),W())}b.select=ye;function ve(v){const w=Ht();if(!w)return null;const I=J()||1,D=on/I;return hr(w).find(H=>Math.hypot(H.x-v.x,H.y-v.y)<=D)||null}function Y(v){const w=o.getContext("2d");return w?mr(w,v):{width:0,height:0}}function it(v){rt({keep:!0}),v.editing=!0;const w=document.createElement("textarea");w.className="photo-text-input",w.value=v.text||"",w.spellcheck=!1,w.setAttribute("aria-label",s("Nội dung ghi chú trên ảnh")),e.appendChild(w),$={element:w,shape:v},et(),w.focus(),w.setSelectionRange(w.value.length,w.value.length),w.addEventListener("input",()=>{v.text=w.value,I(),W()}),w.addEventListener("keydown",D=>{D.stopPropagation(),D.key==="Escape"&&(D.preventDefault(),rt()),D.key==="Enter"&&!D.shiftKey&&(D.preventDefault(),rt())}),w.addEventListener("blur",()=>rt()),I(),W();function I(){const D=J()||1,H=Y(v);w.style.width=`${Math.max(40,(H.width+v.fontSize)*D)}px`,w.style.height=`${Math.max(20,H.height*D+4)}px`}}b.openTextEditor=it;function et(){if(!$)return;const{element:v,shape:w}=$,I=J()||1,D=T(),H=e.getBoundingClientRect();v.style.left=`${D.left-H.left+w.x*I}px`,v.style.top=`${D.top-H.top+w.y*I}px`,v.style.font=li(w,I),v.style.color=w.color,v.style.background=w.background?"rgba(0, 0, 0, 0.6)":"transparent"}function rt({keep:v=!1}={}){if(!$)return;const{element:w,shape:I}=$;if($=null,I.editing=!1,I.text=w.value,w.remove(),v)return;const D=a();Pn(I)||(D&&(D.shapes=D.shapes.filter(H=>H.id!==I.id)),b.selectedId===I.id&&(b.selectedId=null)),u({reason:"text"}),W()}b.closeTextEditor=rt;function $t(v){if(d&&(v.button===1||O&&v.button===0)){v.preventDefault(),o.setPointerCapture?.(v.pointerId),g={mode:"pan",startX:v.clientX,startY:v.clientY,scrollLeft:d.scrollLeft,scrollTop:d.scrollTop},o.style.cursor="grabbing";return}if(v.button!==0)return;const w=Ut(c()),I=xt(kt(v));if(rt(),v.preventDefault(),o.setPointerCapture?.(v.pointerId),w.id==="crop"){b.crop={x:I.x,y:I.y,width:0,height:0,originX:I.x,originY:I.y},g={mode:"crop"},W();return}if(w.id==="select"){const nt=ve(I);if(nt){St(a()),g={mode:"handle",handleId:nt.id,shape:Ht()};return}const _t=ro(at(),I,on/(J()||1),Y);ye(_t?_t.id:null),_t&&(St(a()),g={mode:"move",shape:_t,last:I,moved:!1});return}const D=r(),H=a();if(!H)return;if(w.shape==="text"){St(H);const nt=ao("text",I,D,f("text"));H.shapes.push(nt),b.selectedId=nt.id,it(nt),p(w.id);return}if(w.shape==="marker"){St(H);const nt=ao("marker",I,D,{label:Uc(H),...f("marker")});H.shapes.push(nt),b.selectedId=nt.id,u({reason:"draw"}),p(w.id),W();return}if(!w.shape)return;const en=ao(w.shape,I,D,f(w.shape));zc(en,I),g={mode:"draw",draft:en},W()}function Li(v){if(!g){$s(v);return}if(g.mode==="pan"){d.scrollLeft=g.scrollLeft-(v.clientX-g.startX),d.scrollTop=g.scrollTop-(v.clientY-g.startY);return}const w=xt(kt(v));if(g.mode==="crop"){const I=b.crop,D=w.x-I.originX,H=w.y-I.originY;I.x=Math.min(I.originX,I.originX+D),I.y=Math.min(I.originY,I.originY+H),I.width=Math.abs(D),I.height=Math.abs(H),W();return}if(g.mode==="draw"){Kc(g.draft,w,{square:v.shiftKey}),W();return}if(g.mode==="move"&&g.shape){ur(g.shape,w.x-g.last.x,w.y-g.last.y),Xc(g.shape,V().width,V().height),g.last=w,g.moved=!0,W();return}g.mode==="handle"&&g.shape&&(Jc(g.shape,g.handleId,w),W())}function Ze(v){if(!g)return;const w=g.mode,I=g.draft,D=g.moved;if(g=null,o.releasePointerCapture?.(v.pointerId),w==="pan"){o.style.cursor=O?"grab":"";return}if(w==="crop"){!b.crop||b.crop.width<4||b.crop.height<4?(b.crop=null,h(s("Hãy kéo chuột để chọn vùng cần cắt."))):h(C("Đã chọn vùng cắt {}×{} px. Bấm “Cắt ảnh” để áp dụng.",Math.round(b.crop.width),Math.round(b.crop.height))),u({reason:"crop"}),W();return}if(w==="draw"&&I){if(Pn(I)){const H=a();St(H),delete I.originX,delete I.originY,H.shapes.push(I),b.selectedId=I.id,u({reason:"draw"}),p(Ut(c()).id)}W();return}if(w==="move"&&D||w==="handle"){u({reason:"edit"}),W();return}if(w==="move"){const H=a();H?.past.length&&H.past.pop()}}function Ei(v){const w=xt(kt(v)),I=ro(at(),w,on/(J()||1),Y);I?.kind==="text"&&(b.selectedId=I.id,it(I))}function $s(v){if(O){o.style.cursor="grab";return}const w=Ut(c());if(w.id!=="select"){o.style.cursor=(w.id==="crop","crosshair");return}const I=xt(kt(v));if(ve(I)){o.style.cursor="nwse-resize";return}const D=ro(at(),I,on/(J()||1),Y);o.style.cursor=D?"move":"default"}function Ss(){const v=a(),w=Ht();return!v||!w?!1:(St(v),v.shapes=v.shapes.filter(I=>I.id!==w.id),b.selectedId=null,u({reason:"delete"}),W(),!0)}b.deleteSelected=Ss;function Cs(){const v=a();return!v||!v.shapes.length?!1:(St(v),v.shapes=[],b.selectedId=null,u({reason:"clear"}),W(),!0)}b.clearShapes=Cs;function Is(v){const w=Ht();return w?(St(a()),Object.assign(w,v),u({reason:"restyle"}),$?.shape===w&&et(),W(),!0):!1}b.restyleSelected=Is;function Ts(){b.crop=null,W()}b.clearCrop=Ts;function Ms(){if(!b.crop)return null;const v={x:Math.max(0,Math.round(b.crop.x)),y:Math.max(0,Math.round(b.crop.y)),width:Math.round(b.crop.width),height:Math.round(b.crop.height)},w=V();return v.width=Math.min(v.width,w.width-v.x),v.height=Math.min(v.height,w.height-v.y),v.width>0&&v.height>0?v:null}b.cropRect=Ms;function Oi(v){t.onZoomAt&&(v.preventDefault(),t.onZoomAt(v.deltaY<0?1.15:1/1.15,v.clientX,v.clientY))}function Ai(v){v.code!=="Space"||O||$||v.target?.closest?.("input, textarea, select")||(O=!0,o.style.cursor="grab")}function Ri(v){v.code==="Space"&&(O=!1,g||(o.style.cursor=""))}o.addEventListener("wheel",Oi,{passive:!1}),window.addEventListener("keydown",Ai),window.addEventListener("keyup",Ri),o.addEventListener("pointerdown",$t),o.addEventListener("pointermove",Li),o.addEventListener("pointerup",Ze),o.addEventListener("pointercancel",Ze),o.addEventListener("dblclick",Ei);const Qe=()=>{W(),u({reason:"ready"})};n.addEventListener("load",Qe),n.addEventListener("loadedmetadata",Qe);let tn=null;typeof ResizeObserver<"u"&&(tn=new ResizeObserver(()=>W()),tn.observe(e),tn.observe(n));const Bi=()=>W();return window.addEventListener("resize",Bi),b.destroy=()=>{b.destroyed=!0,rt({keep:!0}),o.removeEventListener("wheel",Oi),window.removeEventListener("keydown",Ai),window.removeEventListener("keyup",Ri),o.removeEventListener("pointerdown",$t),o.removeEventListener("pointermove",Li),o.removeEventListener("pointerup",Ze),o.removeEventListener("pointercancel",Ze),o.removeEventListener("dblclick",Ei),n.removeEventListener("load",Qe),n.removeEventListener("loadedmetadata",Qe),window.removeEventListener("resize",Bi),tn?.disconnect()},De=b,W(),b}var cd={};const se=new Map,di=[{id:"patient-id",kind:"patientId"},{id:"direct-url",kind:"url"}],yr="dcom_patient_rail_collapsed";function dd(){try{if(typeof localStorage<"u")return localStorage.getItem(yr)==="1"}catch{}return!1}function ud(t){try{typeof localStorage<"u"&&localStorage.setItem(yr,t?"1":"0")}catch{}}let m=typeof document<"u"?document.querySelector("#app"):null;function ui(){return typeof document>"u"||(!m||!m.isConnected)&&(m=document.querySelector("#app")),m}function A(){return typeof document>"u"?null:((!m||!m.isConnected)&&(m=document.querySelector("#app")),m&&m.isConnected?m:document)}const Io="dcom.sessionToken",Le=new URL(location.href);let le=Le.searchParams.get("token")||"";try{le?sessionStorage.setItem(Io,le):le=sessionStorage.getItem(Io)||""}catch{}Fs(le);const hd=!!le;le="";Le.searchParams.delete("token");history.replaceState(history.state,"",`${Le.pathname}${Le.search}${Le.hash}`);function pd(){try{sessionStorage.removeItem(Io)}catch{}}const i={bootstrap:null,archive:{root:"",series:[]},selectedId:"",textDoc:null,photoLayers:{},photoTool:"select",photoStyle:Gc(),photoZoom:0,videoIn:null,videoOut:null,videoDuration:0,videoShapeTiming:"span",compareIds:["",""],scrollSync:!0,referenceLines:!0,referenceCursor:!0,scaleOverlay:!1,mode:"single",tool:"window",downloadOpen:!0,patientRailCollapsed:dd(),studies:[],patient:null,downloadAllFiles:!0,downloadAttachments:!0,seriesInventory:[],rememberedSeriesSelections:{},seriesGroupCache:{},status:"Đang khởi động...",isError:!1,busyViewer:!1,cine:!1,mprPrimary:"axial",windowPreset:"full",history:[],sourceFolders:[],editingPatientInfo:!1,lastDirectUrl:"",showManualInfo:!1,manualPatientName:"",manualPatientId:"",manualPatientDob:"",showLoginCard:!1,loginCardAction:null,showFileInfoModal:!1,fileInfoData:null,fileInfoLoading:!1,fileInfoError:"",fileInfoTagFilter:"",showConcatModal:!1,concatClips:[],concatTargetHeight:1080,concatTargetFps:30,mediaIndex:{},mediaEdits:{},photoWorkingPath:null,videoWorkingPath:null,tabs:[],activeTabId:"worklist",worklistSearch:"",worklistPatients:[],worklistLoaded:!1,worklistLoading:!1,worklistScannedAt:"",worklistRevision:"",worklistError:"",patientEditDraft:null,worklistSortColumn:"date",worklistSortOrder:"desc",worklistModality:"",worklistPeriod:"all",worklistRead:"all",worklistStage:"",worklistTab:"studies",job:null,windowMaximized:!1,zenMode:!1,showExportModal:!1,exportModalFolder:"",exportModalOptions:null,exportModalPatientName:"",showLogModal:!1,logModalContent:"",logModalLoading:!1,logModalFilename:"",logModalFolder:"",logModalFileList:[]};let ke=Promise.resolve(),Qt=0;const P={crosshair:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>',info:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',externalLink:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',single:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',compare:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>',compare3:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>',scrollSync:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',referenceLines:'<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',referenceCursor:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>',montage6:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>',montage8:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>',mpr:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>',volume3d:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',window:"◐",pan:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 7.5a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M10 8a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M6 9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M18 11v1a8 8 0 1 1-16 0v-2.5"/></svg>',zoom:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',magnify:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><path d="m21 21-5.2-5.2"/></svg>',scaleBar:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16h18"/><path d="M3 12v8"/><path d="M21 12v8"/><path d="M8 14v6"/><path d="M13 14v6"/><path d="M18 14v6"/></svg>',length:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>',angle:"∠",ellipse:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>',freehand:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',text:'<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>',flipHorizontal:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/><path d="M12 2v20"/></svg>',flipVertical:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M4 12h16"/></svg>',rotateClockwise:`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
    <path d="M21 3v5h-5"></path>
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" transform="rotate(45 12 12)"></rect>
  </svg>`,reset:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',orbit3d:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.1 13A8 8 0 0 1 12 18"/><path d="M19.1 11A8 8 0 0 0 12 6"/><path d="M12 6a8 8 0 0 0-7.1 5"/><path d="M12 18a8 8 0 0 1-7.1-5"/></svg>',invert:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/></svg>',clearAnnotations:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',capture:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',save:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>',volume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M14 16H5.3"/></svg>',history:"🕘"};function q(){return i.archive.series.find(t=>t.id===i.selectedId)||null}const hi={compare:2,compare3:3};function Xn(t=i.mode){return!!hi[t]}function fd(t=i.mode){const e=(hi[t]||1)-1;return Array.from({length:e},(n,o)=>i.archive.series.find(a=>a.id===i.compareIds[o])||null)}function vr(t=i.mode){const e=(hi[t]||1)-1,n=[i.selectedId];for(let o=0;o<e;o+=1){const a=i.compareIds[o];if(a&&i.archive.series.some(d=>d.id===a)&&!n.includes(a)){n.push(a);continue}const c=i.archive.series.find(d=>!n.includes(d.id))||i.archive.series.find(d=>d.id!==i.selectedId)||i.archive.series[0];i.compareIds[o]=c?.id||i.selectedId,n.push(i.compareIds[o])}}function To(t){if(!Xn())return t===i.selectedId?[0]:[];const e=[];t===i.selectedId&&e.push(0);for(let n=0;n<i.compareIds.length;n+=1)i.compareIds[n]===t&&e.push(n+1);return e}function Yi(){for(const t of m.querySelectorAll(".series-card[data-series-id]")){const e=To(t.dataset.seriesId);t.classList.toggle("active",e.length>0),e.length?t.dataset.pane=e.join(","):delete t.dataset.pane}for(const t of m.querySelectorAll(".tl-item[data-timeline-members]")){const e=t.dataset.timelineMembers.split(",").filter(Boolean);t.classList.toggle("on",e.some(n=>To(n).length>0))}}function L(t,e,n,o=!1,a=!1,r=""){const c=/^(mode-|tool-)/.test(t)||["cine","scroll-sync","reference-lines","reference-cursor","scale-overlay"].includes(t);return`<button class="icon-button ${o?"active":""} ${r?"with-label":""}" data-action="${t}"
    title="${l(n)}" aria-label="${l(n)}"
    ${c?`aria-pressed="${o?"true":"false"}"`:""} ${a?"disabled":""}>
    <span>${e}</span>${r?`<small>${l(r)}</small>`:""}
  </button>`}function md(t){if(i.mode==="volume3d"){const d=[L("tool-orbit3d",P.orbit3d,s("Xoay khối 3D tự do"),i.tool==="orbit3d"),L("tool-crosshair",P.crosshair,s("Định vị MPR"),i.tool==="crosshair"),L("tool-pan",P.pan,s("Di chuyển"),i.tool==="pan"),L("tool-zoom",P.zoom,s("Thu/phóng"),i.tool==="zoom")].join(""),u=[L("rotate-clockwise",P.rotateClockwise,s("Xoay khung đang chọn 90° theo chiều kim đồng hồ")),L("flip-horizontal",P.flipHorizontal,s("Lật ngang khung đang chọn")),L("flip-vertical",P.flipVertical,s("Lật dọc khung đang chọn")),L("invert",P.invert,s("Đảo màu")),L("reset",P.reset,s("Đặt lại góc nhìn"))].join(""),h=[L("capture",P.capture,s("Lưu ảnh 3D")),L("file-info",P.info,s("Thông tin file & Link tải"))].join("");return[`<div class="tool-cluster nav-tools">${d}</div>`,'<span class="toolbar-divider"></span>',`<div class="tool-cluster orientation-tools">${u}</div>`,'<span class="toolbar-divider"></span>',`<div class="tool-cluster output-tools">${h}</div>`].join("")}const e=(i.mode==="mpr"?[L("tool-crosshair",P.crosshair,s("Định vị MPR"),i.tool==="crosshair"),L("tool-window",P.window,s("Sáng/tương phản"),i.tool==="window"),L("tool-pan",P.pan,s("Di chuyển"),i.tool==="pan"),L("tool-zoom",P.zoom,s("Thu/phóng"),i.tool==="zoom")]:[L("tool-window",P.window,s("Sáng/tương phản"),i.tool==="window"),L("tool-pan",P.pan,s("Di chuyển"),i.tool==="pan"),L("tool-zoom",P.zoom,s("Thu/phóng"),i.tool==="zoom")]).join(""),n=[L("tool-length",P.length,s(i.mode==="mpr"||t?.geometry?"Đo chiều dài (mm)":"Đo chiều dài (pixel)"),i.tool==="length"),L("tool-angle",P.angle,s("Đo góc"),i.tool==="angle"),L("tool-ellipse",P.ellipse,s("ROI ellipse"),i.tool==="ellipse"),L("tool-freehand",P.freehand,s("ROI tự do"),i.tool==="freehand"),L("tool-text",P.text,s("Ghi chú chữ lên ảnh"),i.tool==="text"),L("tool-magnify",P.magnify,s("Kính lúp"),i.tool==="magnify"),L("scale-overlay",P.scaleBar,s("Thước tỉ lệ (mm)"),i.scaleOverlay,!_e(t))].join(""),o=[L("rotate-clockwise",P.rotateClockwise,s("Xoay khung đang chọn 90° theo chiều kim đồng hồ")),L("flip-horizontal",P.flipHorizontal,s("Lật ngang khung đang chọn")),L("flip-vertical",P.flipVertical,s("Lật dọc khung đang chọn")),L("invert",P.invert,s("Đảo màu")),L("reset",P.reset,s(i.mode==="mpr"?"Đặt lại ba mặt phẳng":"Đặt lại hiển thị"))].join(""),a=[L("clear-annotations",P.clearAnnotations,s("Xóa mọi phép đo, ROI và ghi chú")),L("save-annotations",P.save,s("Lưu đo/ROI/ghi chú")),L("roi-volume",P.volume,s("Tính thể tích ROI"),!1,!t?.mprReady)].join(""),r=Xn()?['<span class="toolbar-divider"></span>',`<div class="tool-cluster compare-tools">
          ${L("scroll-sync",P.scrollSync,s("Khoá cuộn theo vị trí"),i.scrollSync)}
          ${L("reference-lines",P.referenceLines,s("Đường tham chiếu"),i.referenceLines)}
          ${L("reference-cursor",P.referenceCursor,s("Con trỏ tham chiếu"),i.referenceCursor)}
        </div>`]:[],c=[L("capture",P.capture,s("Lưu ảnh")),L("file-info",P.info,s("Thông tin file & Link tải"))].join("");return[`<div class="tool-cluster nav-tools">${e}</div>`,'<span class="toolbar-divider"></span>',`<div class="tool-cluster measure-tools">${n}</div>`,'<span class="toolbar-divider"></span>',`<div class="tool-cluster orientation-tools">${o}</div>`,'<span class="toolbar-divider"></span>',`<div class="tool-cluster markup-tools">${a}</div>`,...r,'<span class="toolbar-divider"></span>',`<div class="tool-cluster output-tools">${c}</div>`].join("")}function gd(){if(!i.history.length)return`<option value="" disabled selected hidden>${P.history} ${l(s("Chưa có lịch sử"))}</option>`;const t=i.history.map((e,n)=>{const o=String(e.folder).split(/[\\/]/).filter(Boolean).pop()||e.folder,a=e.exists?"":` ${s("(thư mục không còn)")}`;return`<option value="${n}" ${e.exists?"":"disabled"}
      title="${l(e.folder)}">${l(`${e.time}  •  ${o}${a}`)}</option>`}).join("");return`<option value="" disabled selected hidden>${P.history} ${l(s("Lịch sử"))}…</option>${t}`}function Mo(t){if(!t)return s("Chưa rõ ngày");const e=String(t).replace(/\D/g,"");if(e.length===8){const n=e.slice(0,4),o=e.slice(4,6);return`${e.slice(6,8)}/${o}/${n}`}if(/^\d{4}-\d{2}-\d{2}$/.test(t)){const[n,o,a]=t.split("-");return`${a}/${o}/${n}`}return t}function br(t){if(!Array.isArray(t)||!t.length)return[];const e=new Map;for(const a of t){let r="",c=a.studyDate||"";if(!c&&a.studyGroup){const f=a.studyGroup.split(" - ");(/^\d{4}-\d{2}-\d{2}/.test(f[0])||/^\d{8}/.test(f[0]))&&(c=f[0])}const d=String(c||"").replace(/\D/g,"");d.length>=8?r=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:/^\d{4}-\d{2}-\d{2}/.test(c)?r=c.slice(0,10):r="0000-00-00",e.has(r)||e.set(r,new Map);const u=e.get(r),h=a.modality&&a.modality!=="UNKNOWN"?a.modality:"";let p=String(a.studyDescription||"").trim();if(!p){const f=String(a.studyGroup||"").trim().split(" - ");f.length>=2&&(/^\d{4}-\d{2}-\d{2}/.test(f[0])||/^\d{8}/.test(f[0]))&&f.shift(),p=f.join(" - ").trim()}p==="Không rõ ca chụp"&&(p=""),p&&h&&!p.toUpperCase().startsWith(h.toUpperCase())&&(p=`${h} · ${p}`),p||(p=h||s("Ca chụp chưa phân loại")),u.has(p)||u.set(p,[]),u.get(p).push(a)}const n=Array.from(e.keys()).sort((a,r)=>a==="0000-00-00"?1:r==="0000-00-00"?-1:r.localeCompare(a)),o=[];for(const a of n){const r=a==="0000-00-00"?s("Chưa rõ ngày chụp"):Mo(a);for(const[c,d]of e.get(a).entries()){if(new Set(d.map(p=>p.timelineKey).filter(Boolean)).size<=1){o.push({dateKey:a,displayDate:r,studyTitle:c,items:d});continue}const h=new Map;for(const p of d){const f=p.timelineKey||"";h.has(f)||h.set(f,[]),h.get(f).push(p)}for(const p of h.values())o.push({dateKey:a,displayDate:r,studyTitle:c,items:p})}}return o}function wr(t){return t.description||t.name||s("Series")}function yd(t,e){const n=br(t.series);return n.length?n.map(o=>{const a=Re()==="en"?`📁 ${o.displayDate} (${o.studyTitle})`:`📁 Ngày ${o.displayDate} (${o.studyTitle})`,r=o.items.map(c=>`<option value="${c.id}" ${c.id===e?"selected":""}>
        ${l(wr(c))} · ${l(bd(c))}
      </option>`).join("");return`<optgroup label="${l(a)}">${r}</optgroup>`}).join(""):""}function vd(t){const e=br(t);if(!e.length)return"";const n=e.length>1;return e.map(o=>{const a=Re()==="en"?`${o.displayDate}`:`Ngày ${o.displayDate}`,r=n?`<div class="series-group-badge" data-date-key="${l(o.dateKey)}" title="${l(`${a} - ${o.studyTitle}`)}">
          <span class="badge-date">📁 ${l(a)}</span>
          <span class="badge-study">${l(o.studyTitle)}</span>
         </div>`:"",c=o.items.map(d=>{const u=To(d.id),h=u.length>0,p=wr(d),f=se.get(d.id)||"";return`<button class="series-card ${h?"active":""}"
              data-series-id="${d.id}" 
              data-date-key="${l(o.dateKey)}"
              title="${l(p)}"
              ${h?`data-pane="${u.join(",")}"`:""}>
              <div class="series-thumb-box">
                <img class="series-card-thumb" data-thumb-id="${d.id}" ${f?`src="${f}"`:""} alt="" />
                ${d.mprReady?'<span class="badge-3d">3D</span>':""}
                <div class="series-thumb-overlay">
                  <b class="series-thumb-title">${l(p)}</b>
                  <span class="series-thumb-count">${d.sliceCount||0}</span>
                </div>
              </div>
            </button>`}).join("");return r+c}).join("")}function bd(t){const n=Number(t?.pixelData?.numberOfFrames||1)>1?s("khung"):s("lát");return`${t?.sliceCount||0} ${n}`}function kr(t){return Gn(t)?"Cửa sổ Hounsfield (HU)":t?.sourceType==="dicom"?"Cửa sổ theo WC/WW trong file":"Preset thị giác 8-bit"}function wd(){const t=i.activeTabId==="worklist",e=i.tabs.map(n=>{const o=n.id===i.activeTabId,a=`${n.patientId?n.patientId+" - ":""}${n.patientName||"Bệnh nhân"}`;if(n.loading)return`<div class="winbar-tab loading${o?" active":""}" data-tab-id="${n.id}">
      <span class="winbar-tab-title" title="${l(a)}">${l(a)} <span class="tab-fmt-badge pending">${l(s("Đang mở…"))}</span></span>
      <button class="winbar-tab-close" data-action="close-tab" data-tab-id="${n.id}" title="${l(s("Đóng tab"))}">×</button>
    </div>`;const r=n.archive?.series||[],c=r.some(p=>p.sourceType==="dicom"),d=c?"DICOM":"JPG",u=r[0]?.modality||"",h=r.length===0?"—":u?`${u} · ${d}`:d;return`<div class="winbar-tab${o?" active":""}" data-tab-id="${n.id}">
      <span class="winbar-tab-title" title="${l(a)}">${l(a)} <span class="tab-fmt-badge ${r.length===0?"pending":c?"dicom":"jpg"}">${l(h)}</span></span>
      <button class="winbar-tab-close" data-action="close-tab" data-tab-id="${n.id}" title="${l(s("Đóng tab"))}">×</button>
    </div>`}).join("");return`<nav class="winbar">
    <div class="winbar-tab${t?" active":""}" data-tab-id="worklist">
      <span class="winbar-tab-title">Worklist</span>
    </div>
    ${e}
    <button class="winbar-add-btn" data-action="choose-archive" title="${l(s("Mở folder DICOM hoặc JPG/PNG trong viewer"))}">+</button>
  </nav>`}const kd=new Set(["dicom","photo","video","doc","text","pdf"]),xd=new Set(["KHONGROTEN","KHONGROID","ANON","ANONYMOUS","ANONYMIZED","ANONYMISED","UNKNOWN","NONE","NULL","REDACTED","REMOVED","HIDDEN","NOVALUE"]);function tt(t){const e=String(t??"").trim();if(!e)return"";const n=e.toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g,"");return!n||xd.has(n)||/^[X?*]+$/.test(n)?"":e}function X(t){return t&&kd.has(t.mediaType)?t.mediaType:"dicom"}function _(t){const e=Math.floor(Number(t)||0),n=Math.floor(e/60),o=e%60,a=String(n).padStart(2,"0"),r=String(o).padStart(2,"0");return`${a}:${r}`}function At(){const t=Number(i.videoIn),e=Number(i.videoOut);return!Number.isFinite(t)||!Number.isFinite(e)||e<=t?null:{start:t,end:e}}function $d(){const t=At(),e=Number(i.videoDuration)||0;if(!t||!e)return"";const n=Math.max(0,Math.min(100,t.start/e*100)),o=Math.max(.5,Math.min(100-n,(t.end-t.start)/e*100));return`<span class="video-range-band" style="left:${n}%; width:${o}%"></span>`}function Nn(t){const e=i.videoBookmarks||[],n=[],o=[],a=t?.id,r=ot(t);for(let d=0;d<e.length;d++){const u=e[d],h={...u,_globalIndex:d};!u.seriesId||u.seriesId===a&&(u.fileIndex===void 0||u.fileIndex===r)?n.push(h):o.push(h)}const c=(d,u)=>(Number(d.time)||0)-(Number(u.time)||0);return n.sort(c),o.sort(c),{current:n,others:o}}function xr(t){const e=Number(i.videoDuration)||0;if(!e)return"";const{current:n}=Nn(t);return n.map(o=>{const a=Math.max(0,Math.min(100,o.time/e*100)),r=o.text||s("Mốc phẫu thuật"),c=`${_(o.time)}: ${l(r)}`;return`
      <div class="video-marker-pin" style="left:${a}%" data-action="seek-video" data-time="${o.time}"
        role="button" tabindex="0"
        aria-label="${l(C("Tua đến {} — {}",_(o.time),r))}"
        title="${c}">
        <span class="video-marker-diamond"></span>
        <div class="video-marker-tooltip">
          <span class="video-marker-tooltip-time">⏱ ${_(o.time)}</span>
          <span class="video-marker-tooltip-text">${l(o.text||s("Mốc phẫu thuật"))}</span>
        </div>
      </div>
    `}).join("")}function $r(t,e){let n="";return t.length===0?n+=`
      <div class="empty-state" style="padding:16px; font-size:12px; color:#89a3b8; text-align:center;">
        ${l(s("Chưa có mốc nào trong clip này."))}
        <div style="font-size:11px; margin-top:4px; opacity:0.8;">${l(s("Bấm “+ Thêm mốc” hoặc phím M khi đang xem"))}</div>
      </div>
    `:n+=t.map(o=>`
      <div class="surgery-bookmark-card" data-action="seek-video" data-time="${o.time}"
        role="button" tabindex="0"
        aria-label="${l(C("Tua đến {} — {}",_(o.time),o.text||s("Mốc phẫu thuật")))}"
        title="${l(s("Bấm để tua video đến mốc này"))}">
        <div class="surgery-bookmark-header">
          <span class="surgery-bookmark-time">⏱ ${_(o.time)}</span>
          <div class="surgery-bookmark-actions" onclick="event.stopPropagation()">
            <button class="icon-tool-btn" data-action="edit-video-bookmark" data-idx="${o._globalIndex}" title="${l(s("Sửa tên mốc"))}">✏</button>
            <button class="icon-tool-btn danger" data-action="delete-video-bookmark" data-idx="${o._globalIndex}" title="${l(s("Xoá mốc"))}">🗑</button>
          </div>
        </div>
        <div class="surgery-bookmark-text" id="bm-text-${o._globalIndex}">${l(o.text||s("Mốc phẫu thuật"))}</div>
      </div>
    `).join(""),e&&e.length>0&&(n+=`
      <div class="surgery-video-other-clips-section">
        <div class="surgery-video-other-clips-header">
          <span>🗂 ${l(s("Mốc từ clip khác trong ca mổ"))}</span>
          <span class="badge" style="font-size:10px; padding:2px 6px;">${e.length}</span>
        </div>
        ${e.map(o=>`
          <div class="surgery-bookmark-card other-clip" data-action="jump-other-clip-bookmark"
            data-series-id="${l(o.seriesId||"")}"
            data-file-index="${o.fileIndex??0}"
            data-time="${o.time}"
            role="button" tabindex="0"
            title="${l(s("Chuyển sang clip này và tua đến mốc"))}">
            <div class="surgery-bookmark-header">
              <span class="surgery-bookmark-clip-badge">🎬 ${l(o.seriesName||s("Clip khác"))}${o.fileIndex!==void 0?` #${o.fileIndex+1}`:""}</span>
              <span class="surgery-bookmark-time">⏱ ${_(o.time)}</span>
            </div>
            <div class="surgery-bookmark-text">${l(o.text||s("Mốc phẫu thuật"))}</div>
          </div>
        `).join("")}
      </div>
    `),n}function Zi(t){const e=Number(t?.time)||0;return`${t?.seriesId||""}|${t?.fileIndex??0}|${e.toFixed(3)}`}function Sd(t,e){const n=Array.isArray(t)?[...t]:[],o=new Set(n.map(Zi));for(const a of e){const r=Zi(a);o.has(r)||(o.add(r),n.push(a))}return n}function so(t){const e=t||q();!e?.id||X(e)!=="video"||N(`/api/series/${e.id}/surgery-bookmarks`,{method:"POST",body:JSON.stringify({bookmarks:i.videoBookmarks||[]})}).catch(n=>{x(C("Không lưu được mốc phẫu thuật: {}",ft(n)),!0)})}function Cd(t){const e=q();!e?.id||X(e)!=="video"||e._bookmarksLoaded||(e._bookmarksLoaded=!0,N(`/api/series/${e.id}/surgery-bookmarks`).then(n=>{const o=Array.isArray(n?.bookmarks)?n.bookmarks:[];o.length!==0&&(i.videoBookmarks=Sd(i.videoBookmarks,o),oe(q()))}).catch(()=>{e._bookmarksLoaded=!1}))}function oe(t){const e=A();if(!e)return;const n=t||q(),o=e.querySelector(".video-marker-pins-layer");o&&(o.innerHTML=xr(n),pe(o));const a=e.querySelector(".surgery-video-bookmarks");if(a){const{current:d,others:u}=Nn(n);a.innerHTML=$r(d,u),pe(a)}const r=e.querySelector("#video-bookmarks-count");if(r){const{current:d}=Nn(n);r.textContent=String(d.length)}const c=e.querySelector("#surgery-video-player");c&&Sr(Number(c.currentTime)||0)}function Sr(t){const e=A();if(!e)return;const n=Number(t)||0,o=.25;let a=null;for(const r of e.querySelectorAll("[data-action='seek-video'][data-time]")){const c=Number(r.dataset.time);!Number.isFinite(c)||c>n+o||(a===null||c>a)&&(a=c)}for(const r of e.querySelectorAll("[data-action='seek-video'][data-time]")){const c=Number(r.dataset.time);r.classList.toggle("active",a!==null&&c===a)}}function Dn(t){const e=A();if(!t||!e)return;const n=Number(t.duration)||Number(i.videoDuration)||0,o=e.querySelector("#video-time-display");o&&(o.textContent=`${_(t.currentTime)} / ${_(n)}`);const a=e.querySelector("#surgery-video-scrubber");a&&n&&(a.value=String((Number(t.currentTime)||0)/n*100)),Sr(Number(t.currentTime)||0)}function dn(){const t=A(),e=t?.querySelector(".video-scrubber-wrap");if(!e)return;const n=At(),o=Number(i.videoDuration)||0;let a=e.querySelector(".video-range-band");if(!n||!o)a?.remove();else{a||(a=document.createElement("span"),a.className="video-range-band",e.prepend(a));const u=Math.max(0,Math.min(100,n.start/o*100));a.style.left=`${u}%`,a.style.width=`${Math.max(.5,Math.min(100-u,(n.end-n.start)/o*100))}%`}const r=t.querySelector("#video-range-readout");r&&(r.textContent=n?`${_(n.start)} → ${_(n.end)}`:s("Chưa chọn đoạn"),n?r.classList.add("active"):r.classList.remove("active"));const c=t.querySelector("[data-action='video-clear-range']");c&&(c.disabled=!n);const d=t.querySelector("[data-action='video-tool-trim']");d&&(d.disabled=!n),mt()}function Id(t){const e=t?.filesPlayable;return!Array.isArray(e)||!e.length||i.videoWorkingPath?!0:e[ot(t)]!==!1}function Td(t){if(!t)return`<div class="empty-state"><b>${l(s("Chưa có video nào"))}</b></div>`;const e=Yn(i.videoWorkingPath),{current:n,others:o}=Nn(t),a=i.videoFilmstrip||[],r=At(),c=ge(t);return`
    <div class="surgery-video-studio">
      <div class="photo-editor-toolbar">
        ${pi(t)}
        ${Br(t)}
        <span class="photo-props-divider"></span>
        <button class="tool-btn" data-action="video-tool-trim" ${r?"":"disabled"}
          title="${l(s("Cắt giữ lại đoạn đã đánh dấu"))}">✂ ${l(s("Cắt đoạn"))}</button>
        <button class="tool-btn" data-action="video-tool-concat" title="${l(s("Ghép các clip video"))}">🔗 ${l(s("Ghép clips"))}</button>
        <button class="tool-btn" data-action="video-tool-burn-text" title="${l(s("Đóng dấu / Chèn thông tin phẫu thuật"))}">🏷 ${l(s("Đóng dấu thông tin"))}</button>
        <button class="tool-btn" data-action="video-tool-thumb" title="${l(s("Trích xuất ảnh đại diện Thumbnail"))}">🖼 ${l(s("Tạo Thumbnail"))}</button>
        <button class="tool-btn" data-action="video-tool-filmstrip" title="${l(s("Tạo chuỗi ảnh Filmstrip"))}">🎞 ${l(s("Tạo Filmstrip"))}</button>
        <button class="tool-btn" data-action="video-tool-transcode" title="${l(s("Tối ưu hoá mã hoá MP4 (H.264)"))}">⚡ ${l(s("Tối ưu MP4"))}</button>
        <span style="flex:1;"></span>
        <button class="tool-btn primary" data-action="video-apply-shapes" id="photo-apply-shapes"
          ${c?"":"disabled"} title="${l(s("Ghi nét vẽ vĩnh viễn vào video"))}">
          ${l(s("Áp dụng lên video"))}${c?` (${c})`:""}
        </button>
        <div id="video-meta-badge" class="badge" style="font-size:11px; padding:4px 8px; opacity:0.85;">🎬 ${l(t.patientName||"Video Phẫu Thuật")}</div>
      </div>
      ${Ir(t)}
      <div class="surgery-video-body">
        <div class="surgery-video-main">
          ${Cr()}
          <div class="surgery-video-stage">
            <div class="photo-editor-canvas-wrap" id="photo-editor-canvas">
              <video id="surgery-video-player" class="surgery-video-element" src="${l(Od(t,e))}" playsinline preload="metadata"></video>
              <canvas id="photo-annotation-canvas" class="photo-annotation-canvas"></canvas>
            </div>
            ${Id(t)?"":`
              <div class="video-unplayable">
                <b>${l(s("Trình duyệt không mở được định dạng này"))}</b>
                <p>${l(s("File định dạng MPG/MPEG cần chuyển sang MP4 để xem, cắt và vẽ lên nó."))}</p>
                <button class="control-btn primary" data-action="video-tool-transcode">
                  ⚡ ${l(s("Chuyển sang MP4"))}
                </button>
              </div>
            `}
          </div>
        </div>
        <aside class="surgery-video-sidebar">
          <div class="surgery-video-sidebar-header">
            <span>📌 ${l(s("Mốc phẫu thuật"))} <span id="video-bookmarks-count" class="badge" style="font-size:10px; padding:2px 6px;">${n.length}</span></span>
            <button class="control-btn primary" data-action="add-video-bookmark" title="${l(s("Thêm mốc tại thời điểm hiện tại (phím M)"))}">+ ${l(s("Thêm mốc"))}</button>
          </div>
          <div class="surgery-video-bookmarks">
            ${$r(n,o)}
          </div>
        </aside>
      </div>
      ${a.length>0?`
        <div class="surgery-video-filmstrip">
          ${a.map((d,u)=>{const h=d.split(/[\\/]/).pop(),p=gn(`/api/media/work-file?name=${encodeURIComponent(h)}`);return`<img src="${l(p)}" title="Frame ${u+1}" data-action="seek-filmstrip-idx" data-idx="${u}" data-total="${a.length}" />`}).join("")}
        </div>
      `:""}
      ${Tr(t)}
      <div class="surgery-video-controls">
        <!-- Tier 1: Full-width Scrubber & Timeline Strip -->
        <div class="surgery-timeline-tier">
          <span class="video-scrubber-wrap">
            ${$d()}
            <div class="video-marker-pins-layer">
              ${xr(t)}
            </div>
            <input type="range" id="surgery-video-scrubber" class="video-scrubber" min="0" max="100" step="0.1" value="0"
              aria-label="${l(s("Thanh tua video"))}">
          </span>
        </div>

        <!-- Tier 2: Streamlined 3-Zone Toolbar -->
        <div class="surgery-actions-tier">
          <!-- Zone 1: Playback Controls -->
          <div class="video-control-group">
            <button class="control-btn" data-action="video-play-pause" title="${l(s("Phát / Tạm dừng"))} (Space)">⏯</button>
            <button class="control-btn icon-btn" data-action="video-rewind-5" title="${l(s("Tua lùi 5s"))}">-5s</button>
            <button class="control-btn icon-btn" data-action="video-forward-5" title="${l(s("Tua tới 5s"))}">+5s</button>
            <span id="video-time-display" class="video-time">00:00 / 00:00</span>
          </div>

          <span class="video-tier-divider"></span>

          <!-- Zone 2: Trimming & Marker Actions -->
          <div class="video-control-group">
            <button class="control-btn icon-btn" data-action="video-set-in" title="${l(s("Đặt điểm đầu tại vị trí đang xem"))} (I)">[ In</button>
            <button class="control-btn icon-btn" data-action="video-set-out" title="${l(s("Đặt điểm cuối tại vị trí đang xem"))} (O)">Out ]</button>
            <span class="video-range-pill ${r?"active":""}" id="video-range-readout">${r?`${_(r.start)} → ${_(r.end)}`:l(s("Chưa chọn đoạn"))}</span>
            <button class="control-btn icon-btn subtle" data-action="video-clear-range" ${r?"":"disabled"}
              title="${l(s("Bỏ đoạn đã đánh dấu"))}">✕</button>
            <button class="control-btn marker-btn" data-action="add-video-bookmark" title="${l(s("Thêm mốc tại thời điểm hiện tại"))} (M)">
              📌 ${l(s("+ Mốc"))}
            </button>
          </div>

          <span style="flex:1;"></span>

          <!-- Zone 3: Utility Controls -->
          <div class="video-control-group">
            <select id="video-speed-select" class="control-btn" title="${l(s("Tốc độ"))}"
              aria-label="${l(s("Tốc độ"))}">
              <option value="0.5">0.5x</option>
              <option value="1.0" selected>1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2.0">2.0x</option>
            </select>
            <button class="control-btn" data-action="video-snapshot" title="${l(s("Chụp khung hình"))}">📸 ${l(s("Chụp"))}</button>
          </div>
        </div>
      </div>
    </div>
  `}function ot(t){const e=Number(t?.sliceCount)||1,n=Number(i.mediaIndex?.[t?.id]??0);return Number.isFinite(n)?Math.max(0,Math.min(Math.trunc(n),e-1)):0}function Md(t,e){if(!t)return;const n=Number(t.sliceCount)||1,o=Math.max(0,Math.min(ot(t)+e,n-1));o!==ot(t)&&(i.mediaIndex={...i.mediaIndex||{},[t.id]:o},Lr(t),i.photoRotation=0,i.videoFilmstrip=[],E(),Z())}function pi(t){const e=Number(t?.sliceCount)||1;if(e<=1)return"";const n=ot(t);return`
    <span class="media-file-nav">
      <button class="tool-btn" data-action="media-file-prev" ${n<=0?"disabled":""}>‹</button>
      <span class="media-file-count">${n+1}/${e}</span>
      <button class="tool-btn" data-action="media-file-next" ${n>=e-1?"disabled":""}>›</button>
    </span>
  `}const Pd={cursor:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51z"/></svg>',arrow:'<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="19" y1="5" x2="5" y2="19"/><polyline points="19 13 19 5 11 5"/></svg>',line:'<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="19" x2="19" y2="5"/></svg>',rect:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>',ellipse:'<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',pen:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.63l4.35-1.33a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/></svg>',text:'<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>',marker:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9.5 12 8v8"/><path d="M10.5 16h3"/></svg>',highlight:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 11-6 6v3h3l6-6"/><path d="m14.5 5.5 4 4"/><path d="M13 3 21 11l-7.5 7.5-8-8z"/></svg>',pixelate:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>',redact:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="1" fill="currentColor"/></svg>',crop:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>'};function Nd(t){return`${t?.id||""}:${ot(t)}`}function Ft(t){if(!t)return null;const e=i.photoLayers||(i.photoLayers={}),n=Nd(t);return e[n]||(e[n]=Wc())}function Dd(t){return Ft(t)?.shapes||[]}function ge(t){return Dd(t).filter(Pn).length}function Cr(){return`
    <div class="photo-tool-rail" role="toolbar" aria-label="${l(s("Công cụ vẽ"))}">
      ${zn.map(t=>{const e=i.photoTool===t.id,n=`${s(t.label)} (${t.key})`;return`<button class="photo-tool ${e?"active":""}" data-action="photo-pick-tool"
          data-tool="${t.id}" title="${l(n)}" aria-label="${l(n)}"
          aria-pressed="${e?"true":"false"}">${Pd[t.icon]||""}</button>`}).join("")}
    </div>
  `}function Ir(t){const e=i.photoStyle,n=ge(t);return`
    <div class="photo-props" id="photo-props">
      <span class="photo-props-label">${l(s("Màu"))}</span>
      <span class="photo-swatches">
        ${Fc.map(o=>`
          <button class="photo-swatch ${e.color.toLowerCase()===o?"active":""}"
            data-action="photo-pick-color" data-color="${o}"
            style="background:${o}" title="${o}" aria-label="${o}"></button>
        `).join("")}
        <input type="color" class="photo-color-input" data-field="photo-color"
          value="${l(e.color)}" title="${l(s("Chọn màu tuỳ ý"))}"
          aria-label="${l(s("Chọn màu tuỳ ý"))}">
      </span>
      <span class="photo-props-divider"></span>
      <label class="photo-props-field">
        <span>${l(s("Nét"))}</span>
        <input type="range" min="1" max="32" step="1" value="${e.strokeWidth}" data-field="photo-stroke">
        <b id="photo-stroke-value">${e.strokeWidth}</b>
      </label>
      <label class="photo-props-field" id="photo-font-field">
        <span>${l(s("Cỡ chữ"))}</span>
        <input type="range" min="10" max="160" step="2" value="${e.fontSize}" data-field="photo-font">
        <b id="photo-font-value">${e.fontSize}</b>
      </label>
      <label class="photo-props-field">
        <span>${l(s("Độ đậm"))}</span>
        <input type="range" min="20" max="100" step="5" value="${Math.round(e.opacity*100)}" data-field="photo-opacity">
        <b id="photo-opacity-value">${Math.round(e.opacity*100)}%</b>
      </label>
      <label class="photo-props-check">
        <input type="checkbox" data-field="photo-fill" ${e.filled?"checked":""}>
        <span>${l(s("Tô đặc"))}</span>
      </label>
      ${X(t)==="video"?Ld():""}
      <span class="photo-props-actions">
        <button class="tool-btn" data-action="photo-apply-crop" id="photo-apply-crop" hidden>
          ✂ ${l(s("Cắt theo vùng chọn"))}
        </button>
        <button class="tool-btn" data-action="photo-delete-shape" id="photo-delete-shape" disabled>
          ${l(s("Xoá hình đang chọn"))}
        </button>
        <button class="tool-btn" data-action="photo-clear-shapes" ${n?"":"disabled"}>
          ${l(s("Xoá hết nét vẽ"))}
        </button>
      </span>
    </div>
  `}function Tr(t){const e=ge(t);return`
    <div class="photo-editor-status">
      <span id="photo-status-hint">${l(s(Ut(i.photoTool).label))}</span>
      <span style="flex:1;"></span>
      <span id="photo-status-size"></span>
      <span id="photo-status-count">${e?C("{} nét chưa áp dụng",e):l(s("Chưa vẽ gì"))}</span>
    </div>
  `}function Ld(){const t=At(),e=t?`${_(t.start)}→${_(t.end)}`:s("Chưa chọn đoạn"),n=(o,a,r)=>`
    <button class="tool-btn ${i.videoShapeTiming===o&&!r?"active":""}"
      data-action="video-timing" data-timing="${o}" ${r?"disabled":""}>${l(a)}</button>`;return`
    <span class="photo-props-divider"></span>
    <span class="photo-props-label">${l(s("Hiện"))}</span>
    <span class="photo-timing-picker" id="photo-timing-picker">
      ${n("all",s("Toàn bộ"),!1)}
      ${n("span",e,!t)}
    </span>
  `}function Ed(t){if(!t)return`<div class="empty-state"><b>${l(s("Chưa có ảnh nào"))}</b></div>`;const e=Yn(i.photoWorkingPath),n=e?`work:${e}`:`${t.id}:${ot(t)}`,o=ge(t);return`
    <div class="photo-editor-studio">
      <div class="photo-editor-toolbar">
        ${pi(t)}
        ${Br(t)}
        <span class="photo-props-divider"></span>
        <button class="tool-btn" data-action="photo-rotate-ccw" title="${l(s("Xoay trái 90°"))}">↺</button>
        <button class="tool-btn" data-action="photo-rotate-cw" title="${l(s("Xoay phải 90°"))}">↻</button>
        <span class="photo-props-divider"></span>
        <button class="tool-btn" data-action="photo-zoom-out" title="${l(s("Thu nhỏ"))}">−</button>
        <button class="tool-btn" data-action="photo-zoom-fit" id="photo-zoom-label"
          title="${l(s("Vừa khung"))}">${i.photoZoom?`${Math.round(i.photoZoom*100)}%`:l(s("Vừa khung"))}</button>
        <button class="tool-btn" data-action="photo-zoom-in" title="${l(s("Phóng to"))}">+</button>
        <span style="flex:1;"></span>
        <button class="tool-btn primary" data-action="photo-apply-shapes" id="photo-apply-shapes"
          ${o?"":"disabled"} title="${l(s("Vẽ đè vĩnh viễn lên ảnh"))}">
          ${l(s("Áp dụng lên ảnh"))}${o?` (${o})`:""}
        </button>
        <button class="tool-btn" data-action="photo-save-edit" ${i.photoWorkingPath?"":"disabled"}>💾 ${l(s("Lưu vào hồ sơ"))}</button>
        <button class="tool-btn" data-action="photo-export-image">⬇ ${l(s("Tải ảnh về"))}</button>
        <button class="tool-btn" data-action="photo-export-pdf">📄 ${l(s("Xuất file PDF"))}</button>
      </div>
      ${Ir(t)}
      <div class="photo-editor-body">
        ${Cr()}
        <div class="photo-editor-stage" id="photo-editor-stage">
          <div class="photo-editor-canvas-wrap" id="photo-editor-canvas">
            <img id="photo-editor-img" class="photo-editor-image" data-media-src="${l(n)}" alt="${l(t.description||"")}">
            <canvas id="photo-annotation-canvas" class="photo-annotation-canvas"></canvas>
          </div>
        </div>
      </div>
      ${Tr(t)}
    </div>
  `}function fi(t){return!t||!i.textDoc?null:i.textDoc.seriesId===t.id?i.textDoc:null}function Mr(t){if(!t)return`<div class="empty-state"><b>${l(s("Chưa có văn bản nào"))}</b></div>`;const e=fi(t),n=Number(t.sliceCount)||1,o=e?e.index:0;return`
    <div class="text-viewer">
      <div class="text-viewer-bar">
        <span class="text-viewer-name">${l(e?.name||t.name||"")}</span>
        ${n>1?`
          <span class="text-viewer-nav">
            <button class="tool-btn" data-action="text-prev" ${o<=0?"disabled":""}>‹</button>
            <span class="text-viewer-count">${o+1}/${n}</span>
            <button class="tool-btn" data-action="text-next" ${o>=n-1?"disabled":""}>›</button>
          </span>
        `:""}
        <span style="flex:1;"></span>
        ${e?.language==="json"?'<span class="text-viewer-badge">JSON</span>':""}
        <button class="tool-btn" data-action="text-copy" ${e?"":"disabled"}>${l(s("Chép"))}</button>
      </div>
      <pre class="text-viewer-body" id="text-viewer-body">${l(e?e.text:s("Đang đọc file…"))}</pre>
    </div>
  `}async function mi(t,e){if(!(!t||!e))try{const n=new URL(e,window.location?.origin||"http://127.0.0.1"),o=n.pathname==="/api/media/work-file"?n.searchParams.get("name"):"",a=n.pathname.match(/^\/api\/series\/([a-f0-9]{20})\/image\/(\d+)$/),r=o?`work:${o}`:a?`${a[1]}:${a[2]}`:"";t.src=r?await Pr(r):URL.createObjectURL(await je(e))}catch(n){x(ft(n),!0)}}const Ee=new Map;function Pr(t){const e=String(t);let n=Ee.get(e);if(!n){const o=e.indexOf(":"),a=e.slice(0,o),r=e.slice(o+1),c=a==="work"?`/api/media/work-file?name=${encodeURIComponent(r)}`:`/api/series/${a}/image/${Number(r)||0}`;n=je(c).then(d=>URL.createObjectURL(d)),n.catch(()=>Ee.delete(e)),Ee.set(e,n)}return n}function Od(t,e=""){return gn(e?`/api/media/work-file?name=${encodeURIComponent(e)}`:`/api/series/${t.id}/image/${ot(t)}`)}function xe(t,e){!t||!e||(t.src=gn(e),t.load())}async function lo(t,e){const n=await je(t),o=URL.createObjectURL(n),a=document.createElement("a");a.href=o,a.download=e,a.click(),window.setTimeout(()=>URL.revokeObjectURL(o),6e4)}function Nr(t=""){for(const[e,n]of[...Ee])t&&e.startsWith(`${t}:`)||(Ee.delete(e),Promise.resolve(n).then(o=>URL.revokeObjectURL(o)).catch(()=>{}))}function Dr(t,e=0){const n=i.mediaEdits||(i.mediaEdits={}),o=`${t}:${Math.max(0,Number(e)||0)}`;return n[o]||(n[o]={steps:[],cursor:-1})}function Je(t){return Dr(t.id,ot(t))}function Mt(t,e){if(!t||!e?.outputPath)return;const n=Je(t);n.steps=n.steps.slice(0,n.cursor+1),n.steps.push({path:e.outputPath,url:e.url||""}),n.cursor=n.steps.length-1,Rr(t)}function Ad(t){if(!t)return null;const e=Je(t);return e.cursor>=0?e.steps[e.cursor]:null}function gi(t){return!!t&&Je(t).cursor>=0}function yi(t){if(!t)return!1;const e=Je(t);return e.cursor<e.steps.length-1}function Rd(t,e){if(!t)return;const n=Je(t),o=Math.max(-1,Math.min(n.cursor+e,n.steps.length-1));if(o===n.cursor)return;n.cursor=o;const a=o>=0?n.steps[o]:null;X(t)==="video"?i.videoWorkingPath=a?a.path:null:(i.photoWorkingPath=a?a.path:null,i.photoRotation=0),E(),Z(),x(a?C(e<0?"Đã hoàn tác đến bước {}/{}.":"Đã làm lại đến bước {}/{}.",o+1,n.steps.length):s("Đã quay lại file gốc trong hồ sơ."))}function Lr(t){const e=Ad(t);X(t)==="video"?(i.videoWorkingPath=e?.path||null,i.photoWorkingPath=null):(i.photoWorkingPath=e?.path||null,i.videoWorkingPath=null)}function Er(t){return lr(Ft(t))||gi(t)}function Or(t){return cr(Ft(t))||yi(t)}function Ar(t){return["photo","doc"].includes(X(t))}function Jn(t){return Ar(t)||X(t)==="video"}function Rr(t){const e=A();if(!e)return;const n=Jn(t),o=e.querySelector("[data-action='media-edit-undo']"),a=e.querySelector("[data-action='media-edit-redo']");o&&(o.disabled=!(n?Er(t):gi(t))),a&&(a.disabled=!(n?Or(t):yi(t)));const r=e.querySelector("[data-action='photo-save-edit']");r&&(r.disabled=!i.photoWorkingPath)}function Bd(t,e){const n=Ft(t);return(e<0?Vc(n):jc(n))?(K()?.select(null),K()?.repaint(),mt(),x(s(e<0?"Đã hoàn tác nét vẽ.":"Đã vẽ lại nét vừa hoàn tác.")),!0):!1}function Br(t){const e=Jn(t),n=e?Er(t):gi(t),o=e?Or(t):yi(t);return`
    <button class="tool-btn" data-action="media-edit-undo" ${n?"":"disabled"}
      title="${l(s("Hoàn tác bước chỉnh sửa"))} (Ctrl+Z)">↶</button>
    <button class="tool-btn" data-action="media-edit-redo" ${o?"":"disabled"}
      title="${l(s("Làm lại bước vừa hoàn tác"))} (Ctrl+Y)">↷</button>
  `}function Yn(t){return String(t||"").split(/[\\/]/).pop()||""}function qr(){const t=A();if(t)for(const e of t.querySelectorAll("[data-media-src]")){const n=String(e.dataset.mediaSrc);n.includes(":")&&Pr(n).then(o=>{e.src=o}).catch(o=>x(ft(o),!0))}}function qd(t){if(!t)return`<div class="empty-state"><b>${l(s("Chưa có tài liệu nào"))}</b></div>`;const e=ot(t);return`
    <div class="pdf-viewer">
      <div class="pdf-viewer-bar">
        <span class="pdf-viewer-name">${l(t.description||t.name||"")}</span>
        ${pi(t)}
      </div>
      <embed class="pdf-viewer-frame" type="application/pdf"
        data-media-src="${l(t.id)}:${e}">
    </div>
  `}function Fr(t){if(k.editing)return Na(i.archive?.patient||{},_r());switch(X(t)){case"video":return Td(t);case"photo":case"doc":return Ed(t);case"text":return Mr(t);case"pdf":return qd(t)}if(i.archive.series.length)return`<div class="viewer-loading">${i.busyViewer?l(s("Đang dựng khung xem…")):""}</div>`;const e=i.tabs.find(n=>n.id===i.activeTabId);return e?.loadError?`<div class="empty-state error"><b>${l(s("Không mở được hồ sơ"))}</b>
      <p>${l(e.loadError)}</p></div>`:e?.loading?`<div class="empty-state"><b>${l(s("Đang mở hồ sơ…"))}</b>
      <p>${l(e.folder||"")}</p></div>`:`<div class="empty-state"><b>${l(s("Chưa mở hồ sơ nào"))}</b>
      <p>${l(s("Mở folder hồ sơ; app tự phân loại phim DICOM, ảnh, video và văn bản bên trong."))}</p>
      <div class="empty-actions">
        <button class="primary" data-action="choose-archive">${l(s("Mở folder"))}</button>
      </div></div>`}function Fd(){return i.activeTabId==="worklist"&&i.downloadOpen}const Hd={dicom:"Phim chụp",photo:"Ảnh",doc:"Bệnh án",video:"Video",text:"Văn bản",pdf:"Bệnh án PDF"};function _d(t){if(!t||typeof t!="string"||t.length!==8)return!1;const e=parseInt(t.slice(0,4),10),n=parseInt(t.slice(4,6),10),o=parseInt(t.slice(6,8),10);return!(isNaN(e)||isNaN(n)||isNaN(o)||e<1900||e>2099||n<1||n>12||o<1||o>31)}function Gd(t,e={}){const n=new Map;for(const r of t||[]){let c=r.studyDate||"";!c&&r.studyGroup&&(c=r.studyGroup.split(" - ")[0]);const d=String(c).replace(/\D/g,"");let u=d.length>=8?d.slice(0,8):"";u&&!_d(u)&&(u=""),n.has(u)||n.set(u,new Map);const h=X(r),p=r.studyGroup||r.studyDescription||(h==="dicom"?r.modality:r.id)||r.id,f=r.timelineKey||`legacy:${u}:${h}:${p}`,y=n.get(u);y.has(f)||y.set(f,{key:f,kind:h,series:[]}),y.get(f).series.push(r)}const o=[...n.entries()].sort((r,c)=>r[0]?c[0]?c[0].localeCompare(r[0]):-1:1).flatMap(([r,c])=>[...c.values()].map(d=>{const u=d.series[0]||{},h=String(u.modality||"").trim().toUpperCase(),p=d.kind==="dicom"&&h&&h!=="UNKNOWN"?h:s(Hd[d.kind]||"Phim chụp"),f=r?`${r.slice(6,8)}/${r.slice(4,6)}/${r.slice(0,4)}`:s("Chưa rõ ngày chụp"),y=String(u.studyDescription||u.description||u.name||"").trim(),S=[...d.series].sort((T,V)=>+!!V.mprReady-+!!T.mprReady||Number(V.sliceCount||0)-Number(T.sliceCount||0))[0],b=r?f:y||f,g=d.series.some(T=>T.sourceType==="dicom"||String(T.sourceFormat||"").toUpperCase()==="DICOM");let $="";g?$="DICOM":u.sourceFormat?$=String(u.sourceFormat).toUpperCase():u.sourceType==="image"||d.kind==="photo"?$="JPG":d.kind==="video"?$="MP4":d.kind==="pdf"?$="PDF":d.kind==="doc"||d.kind==="text"?$="TXT":String(u.mediaType||"").toLowerCase()==="dicom"&&($="DICOM");const O=$==="DICOM"?s("Dữ liệu gốc DICOM (Ưu tiên dựng từ DICOM)"):$==="JPG"?s("Dữ liệu ảnh chuyển đổi JPG"):$||s("Chưa rõ định dạng nguồn");return{...d,dateKey:r,dateLabel:f,badge:p,examName:y,sourceFormat:$||"—",sourceFormatClass:$.toLowerCase()||"unknown",sourceTitle:O,defaultTitle:`${p} - ${b}`,primaryId:S?.id||"",memberIds:d.series.map(T=>T.id)}})),a=new Map;for(const r of o)a.set(r.defaultTitle,(a.get(r.defaultTitle)||0)+1);for(const r of o)a.get(r.defaultTitle)>1&&r.examName&&(r.defaultTitle=`${r.badge} - ${r.dateLabel} · ${r.examName}`),r.title=String(e?.[r.key]||"").trim()||r.defaultTitle;return o}function Hr(t={}){return{patientName:t.patientName||"",patientId:t.patientId||"",gender:t.gender||"",birthYear:t.birthYear||"",phone:t.phone||"",address:t.address||"",hospital:t.hospital||"",diagnosis:t.diagnosis||""}}function _r(){const t=m?.querySelector("[data-field='patient-edit-form']");return vi(t)||i.patientEditDraft||Hr(i.archive?.patient||{})}function vi(t){if(!t)return null;const e=new FormData(t);return{patientName:e.get("patientName")||"",patientId:e.get("patientId")||"",gender:e.get("gender")||"",birthYear:e.get("birthYear")||"",phone:e.get("phone")||"",address:e.get("address")||"",hospital:e.get("hospital")||"",diagnosis:e.get("diagnosis")||""}}function Po(){const t=m?.querySelector(".dx-card");t&&(t.outerHTML=Da(),bi(),Gr())}function Wd(){const t=m?.querySelector(".dx-workspace");if(!t)return;const e=t.querySelector(".dxw-body")?.scrollTop||0;t.outerHTML=Na(i.archive?.patient||{},_r());const n=m?.querySelector(".dx-workspace .dxw-body");n&&e&&(n.scrollTop=e),bi()}let co=!1,an=!1;function dt(){if(co){an=!0;return}co=!0;try{for(let t=0;t<3&&(an=!1,Po(),Wd(),!!an);t+=1);}finally{co=!1,an=!1}}let Qi=0,ta=0;function It(t=250){clearTimeout(Qi),k.editing&&(Qi=setTimeout(()=>{Vd()},t))}async function Vd(){const t=ta+=1;let e=[];try{const n=await N("/api/clinical/assessment",{method:"POST",body:JSON.stringify({record:La()})});e=Array.isArray(n?.assessment)?n.assessment:[]}catch{return}t!==ta||!k.editing||(k.draftAssessment=e,jd())}function jd(){const t=m?.querySelectorAll(".dx-workspace .dxf-block[data-tumor-index]")||[];for(const e of t){const n=vl(Number(e.dataset.tumorIndex)),o=e.querySelector(":scope > .dx-reading");n.trim()?o?o.outerHTML=n:e.insertAdjacentHTML("beforeend",n):o?.remove()}}function Ud(t){const e=t?.dataset?.clinicalField;if(!e||document.activeElement!==t)return null;const n=t.closest("[data-tumor-index]"),o=t.closest("[data-event-index]"),a=n?`[data-tumor-index="${n.dataset.tumorIndex}"]`:o?`[data-event-index="${o.dataset.eventIndex}"]`:"";let r=null;try{r=t.selectionStart}catch{r=null}return{selector:`${a} [data-clinical-field="${e}"]`,caret:r}}function Kd(t){if(!t)return;const e=m?.querySelector(`.dx-workspace ${t.selector}`);if(e&&(e.focus(),!(t.caret===null||typeof e.setSelectionRange!="function")))try{e.setSelectionRange(t.caret,t.caret)}catch{}}const ea=new WeakSet;function bi(){for(const t of[m?.querySelector(".dx-card"),m?.querySelector(".dx-workspace")])t&&zd(t)}function zd(t){t.querySelectorAll("[data-clinical-field]").forEach(e=>{if(ea.has(e))return;ea.add(e);const n=o=>{const a=xl(o.target,o.type);if(It(),!a)return;const r=Ud(o.target);dt(),Kd(r)};e.addEventListener("input",n),e.addEventListener("change",n)}),pe(t)}function Gr(){const t=k.record?.events;m.querySelectorAll(".tl-phase").forEach(e=>{const n=ol(el(t,Qs(e.dataset.dateKey)));e.className=n?`tl-phase ${n.tone}`:"tl-phase",e.textContent=n?n.text:"",n?e.setAttribute("title",n.title):e.removeAttribute("title"),e.hidden=!n})}function Xd(){return`${i.archive?.root||""}::${i.archive?.patient?.patientId||""}`}async function wi({force:t=!1}={}){const e=Xd();if(i.archive?.root&&!(!t&&k.loadedFor===e)){Vs(),k.loading=!0,k.loadedFor=e,Po();try{if(!k.vocabulary){const a=await N("/api/clinical/vocabulary");k.vocabulary=a?.vocabulary||null}const n=new URLSearchParams({archiveRoot:i.archive?.root||"",patientId:i.archive?.patient?.patientId||""}),o=await N(`/api/patient/clinical?${n.toString()}`);k.record=o?.record||Rt(),k.stage=o?.stage||Ue(),k.assessment=Array.isArray(o?.assessment)?o.assessment:[],k.label=String(o?.label||""),k.canWrite=o?.canWrite!==!1,k.reason=String(o?.reason||"")}catch(n){k.error=ft(n)}finally{k.loading=!1,Po()}}}function Jd(){const t=i.archive?.patient||{},e=i.archive?.series||[],n=[jr(t.gender),t.birthYear,t.age?C("{}T",t.age):""].map(c=>String(c||"").trim()).filter(Boolean).join(" · "),o=[l(tt(t.hospital)),tt(t.phone)?`<button class="rec-copy" type="button" data-action="copy-patient-field"
          data-copy-text="${l(t.phone)}"
          title="${l(s("Sao chép số điện thoại"))}"
          >${l(t.phone)}</button>`:"",l(tt(t.address))].filter(Boolean).join(" · "),a=Gd(e,t.timelineLabels||{}),r=()=>`
      <div class="rec-card rec-info-card">
        <div class="rec-id">
          <div class="rec-name-row">
            ${tt(t.patientName)?`
              <button class="rec-copy rec-copy-name" type="button" data-action="copy-patient-field"
                data-copy-text="${l(t.patientName)}"
                title="${l(s("Sao chép tên bệnh nhân"))}"
                >${l(t.patientName)}</button>
            `:`<b class="rec-unnamed">${l(s("Chưa có tên bệnh nhân"))}</b>`}
            ${k.canWrite&&!k.editing?`
              <button class="rec-edit-btn" type="button" data-action="edit-record"
                title="${l(s("Sửa hồ sơ bệnh nhân"))}">✎</button>
            `:""}
          </div>
          <small class="rec-identity">
            ${tt(t.patientId)?`
              <button class="rec-copy" type="button" data-action="copy-patient-field"
                data-copy-text="${l(t.patientId)}"
                title="${l(s("Sao chép mã BN"))}"
                >${l(t.patientId)}</button>
            `:"—"}${n?` · ${l(n)}`:""}
          </small>
          ${o?`<small class="rec-contact">${o}</small>`:""}
        </div>
        <div class="dx-divider">${l(s("Chẩn đoán & điều trị"))}</div>
        ${Da()}
        ${String(t.diagnosis||"").trim()?`
          <p class="dx-note" title="${l(s("Chẩn đoán / Ghi chú"))}"
            >${l(t.diagnosis)}</p>
        `:""}
      </div>
  `;return`
    <aside class="rec-rail patient-history-rail">
      <div class="rail-collapsed-strip" data-action="toggle-patient-rail" title="${l(s("Mở thông tin ca ( [ )"))}">
        <button class="rail-expand-trigger" type="button" data-action="toggle-patient-rail"
          ${i.patientRailCollapsed?"":"hidden"}
          title="${l(s("Mở thông tin ca ( [ )"))}" aria-label="${l(s("Mở thông tin ca"))}">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="rail-vertical-title">${l(s("Thông tin ca"))}</span>
      </div>
      <div class="rec-rail-header">
        <span class="rec-rail-title">${l(s("Thông tin ca"))}</span>
        <button class="rail-toggle-btn" type="button" data-action="toggle-patient-rail"
          title="${l(s("Thu gọn thông tin ca ( [ )"))}" aria-label="${l(s("Thu gọn thông tin ca"))}">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      ${r()}

      <div class="rec-timeline-head"><b>${l(s("Lịch sử khám"))}</b></div>
      <div class="tl">
        ${a.length===0?`<div class="tl-empty">${l(s("Chưa có dữ liệu nào trong hồ sơ này."))}</div>`:a.map(c=>{const d=c.memberIds.includes(i.selectedId);return`
              <div class="tl-item ${c.kind}${d?" on":""}"
                data-timeline-key="${l(c.key)}"
                data-timeline-members="${l(c.memberIds.join(","))}"
                data-timeline-label="${l(c.title)}"
                data-default-label="${l(c.defaultTitle)}"
                title="${l(c.examName?`${c.title} · ${c.examName}`:c.title)}">
                <div class="tl-row">
                  <button class="tl-open" type="button" data-series-id="${l(c.primaryId)}">
                    <div class="tl-card-header">
                      <span class="tl-badge-pill">${l(c.badge)}</span>
                      <span class="tl-date-text">${l(c.dateLabel)}</span>
                      <span class="tl-source-pill ${l(c.sourceFormatClass)}" title="${l(c.sourceTitle)}">${l(c.sourceFormat)}</span>
                    </div>
                    <div class="tl-card-body">
                      <span class="nm">${l(c.title!==c.defaultTitle?c.title:c.examName||c.title)}</span>
                      <span class="tl-phase" data-date-key="${l(c.dateKey||"")}" hidden></span>
                    </div>
                  </button>
                  <input class="tl-name-input" value="${l(c.title)}"
                    maxlength="120" aria-label="${l(s("Tên hiển thị trên timeline"))}">
                  <button class="tl-edit" type="button" data-action="edit-timeline-label"
                    title="${l(s("Đổi tên lần chụp hoặc loại media"))}" aria-label="${l(s("Đổi tên lần chụp hoặc loại media"))}">✎</button>
                  <button class="tl-edit-save" type="button" data-action="save-timeline-label"
                    title="${l(s("Lưu tên"))}" aria-label="${l(s("Lưu tên"))}">✓</button>
                  <button class="tl-edit-cancel" type="button" data-action="cancel-timeline-label"
                    title="${l(s("Bỏ thay đổi tên"))}" aria-label="${l(s("Bỏ thay đổi tên"))}">×</button>
                </div>
              </div>
            `}).join("")}
      </div>
    </aside>
  `}function Zn(){return(Array.isArray(i.worklistPatients)?i.worklistPatients:[]).filter(e=>e&&e.exists!==!1&&Array.isArray(e.studies)&&e.studies.length>0)}let un=!1;async function lt({repaint:t=!0,silent:e=!1}={}){if(un)return!1;un=!0;let n=!1;e||(i.worklistLoading=!0),i.worklistError="",t&&!e&&Kt();try{const o=await N("/api/worklist");i.worklistPatients=Array.isArray(o?.patients)?o.patients:[],i.worklistScannedAt=String(o?.scannedAt||""),i.worklistLoaded=!0,i.worklistRevision=String(o?.revision||i.worklistRevision||""),n=!0}catch(o){i.worklistError=ft(o)}finally{i.worklistLoading=!1,un=!1}return t&&Kt(),n}function Wr(){if(i.worklistLoading)return s("Đang tải danh sách bệnh nhân…");if(i.worklistError)return s("Không đồng bộ được danh sách");const t=Yd(i.worklistScannedAt);return t?C("Danh sách lúc {}",t):s("Danh sách đã cập nhật")}function Yd(t){const e=new Date(String(t||""));return Number.isNaN(e.getTime())?"":`${String(e.getHours()).padStart(2,"0")}:${String(e.getMinutes()).padStart(2,"0")}`}async function Zd(){try{return String((await N("/api/worklist/revision"))?.revision||"")}catch{return i.worklistRevision}}let uo=null,ho=!1,na=0;const Qd=9e4;function tu(){return String(i.job?.status||"")==="running"}function eu(t=2e4){uo&&window.clearInterval(uo),uo=window.setInterval(async()=>{if(!(un||ho||document.hidden)&&!tu()){ho=!0;try{const e=await Zd();if(!e||e===i.worklistRevision||Date.now()-na<Qd)return;await lt({silent:!0})&&(na=Date.now())}finally{ho=!1}}},t)}function Kt(){if(i.activeTabId!=="worklist"||i.worklistTab==="activity")return;const t=A(),e=t?.querySelector(".worklist-tree");if(!e)return;const n=e.scrollTop,o=e.scrollLeft;e.innerHTML=Xr(),zr(e),$i(e),e.scrollTop=n,e.scrollLeft=o;const a=t.querySelector(".worklist-filter-bar.secondary");a&&(a.outerHTML=Zr(),Jr(t));const r=t.querySelector(".worklist-summary");r&&(r.innerHTML=Yr());const c=t.querySelector(".worklist-tab[data-worklist-tab='studies'] .worklist-tab-count");c&&(c.textContent=String(Qn().length));const d=t.querySelector(".worklist-sync-state");d&&(d.textContent=Wr(),d.classList.toggle("error",!!i.worklistError));const u=t.querySelector("[data-action='refresh-worklist']");u&&(u.disabled=i.worklistLoading)}function We(t){if(!t||typeof t!="string")return 0;const e=t.trim(),n=e.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);if(n){const r=Number(n[1]),c=Number(n[2]);let d=Number(n[3]);return d<100&&(d+=2e3),new Date(d,c-1,r).getTime()||0}const o=e.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);if(o){const r=Number(o[1]),c=Number(o[2]),d=Number(o[3]);return new Date(r,c-1,d).getTime()||0}const a=Date.parse(e);return Number.isNaN(a)?0:a}function oa(t){const e=t.studies||[];let n=0;for(const o of e){const a=We(o.studyDate);a>n&&(n=a)}return n}function nu(t){const e=t.studies||[];if(!e.length)return"—";let n=0,o="";for(const a of e){const r=We(a.studyDate);r>=n&&a.studyDate&&(n=r,o=a.studyDate)}return o||e[0]?.studyDate||"—"}function ou(){const t={today:0,week:6,month:29}[i.worklistPeriod];if(t===void 0)return null;const e=new Date;return e.setHours(0,0,0,0),e.setDate(e.getDate()-t),e.getTime()}function iu(t){const e=(i.worklistModality||"").trim().toUpperCase();if(e&&String(t.modality||"").trim().toUpperCase()!==e||i.worklistRead==="unread"&&t.isRead||i.worklistRead==="read"&&!t.isRead)return!1;const n=ou();if(n!==null){const o=We(t.studyDate);if(Number.isFinite(o)&&o>0&&o<n)return!1}return!0}function Vr(){return!!((i.worklistStage||"").trim()||(i.worklistModality||"").trim()||i.worklistPeriod&&i.worklistPeriod!=="all"||i.worklistRead&&i.worklistRead!=="all")}function Qn(){const t=(i.worklistSearch||"").toLowerCase().trim();let e=Zn();Vr()&&(e=e.map(r=>({...r,studies:(r.studies||[]).filter(iu)})).filter(r=>r.studies.length>0));const n=i.worklistStage||"";n&&(e=e.filter(r=>((r.treatmentStage&&typeof r.treatmentStage=="object"?r.treatmentStage.state:"unknown")||"unknown")===n)),t&&(e=e.filter(r=>`${r.category||""} ${r.patientId||""} ${r.patientName||""} ${r.hospital||""} ${r.gender||""} ${r.birthYear||""} ${r.diagnosis||""}`.toLowerCase().includes(t)?!0:(r.studies||[]).some(d=>`${d.studyDate||""} ${d.studyName||""} ${d.modality||""} ${d.folder||""}`.toLowerCase().includes(t))));const o=i.worklistSortColumn,a=i.worklistSortOrder||"asc";return o?[...e].sort((r,c)=>{let d=0;if(o==="name"){const u=String(r.patientName||r.patientId||"").trim(),h=String(c.patientName||c.patientId||"").trim();d=u.localeCompare(h,"vi",{sensitivity:"base",numeric:!0})}else if(o==="id"){const u=String(r.patientId||"").trim(),h=String(c.patientId||"").trim();d=u.localeCompare(h,void 0,{numeric:!0,sensitivity:"base"})}else if(o==="date"){const u=oa(r),h=oa(c);d=u-h}else if(o==="created"){const u=String(r.folderCreatedAtSort||r.folderCreatedAt||""),h=String(c.folderCreatedAtSort||c.folderCreatedAt||"");d=u.localeCompare(h)}return a==="desc"?-d:d}):e}function jr(t){const e=String(t||"").trim();return e?s(e):""}function au(t){const e=[jr(t.gender),t.birthYear?String(t.birthYear).toLowerCase().includes("t")?t.birthYear:`${t.birthYear}`:"",t.hospital].map(n=>String(n||"").trim()).filter(Boolean);return e.length?e.join(" · "):""}function ru(t){const e=String(t?.diagnosis||"").trim();if(!e)return{text:"",fromFolder:!1,title:""};const n=String(t?.diagnosisSource||"")==="folder";return{text:e,fromFolder:n,title:C(n?"Chẩn đoán đọc từ tên thư mục: {}":"Chẩn đoán ghi trong hồ sơ: {}",e)}}function su(t){const e=[t.studyDate,t.studyName].map(n=>String(n||"").trim()).filter(Boolean);return e.length?e.join(" · "):s("Ca chụp chưa có mô tả")}function lu(t){const e=[];return Number.isFinite(t.seriesCount)&&e.push(C("{} series",t.seriesCount)),Number.isFinite(t.sliceCount)&&e.push(C("{} lát",t.sliceCount)),e.length?e.join(" · "):s("Chưa đếm")}function cu(t){const e=t.primaryMediaType||"";return e==="dicom"||t.mediaCounts?.dicom>0?`<span class="fmt-badge dicom" title="${l(s("File DICOM gốc (.dcm)"))}">DICOM</span>`:e==="photo"||t.mediaCounts?.photo>0?`<span class="fmt-badge jpg" title="${l(s("Ảnh JPG đã giải nén"))}">JPG</span>`:e==="video"||t.mediaCounts?.video>0?`<span class="fmt-badge video" title="${l(s("Video"))}">VIDEO</span>`:e==="doc"||t.mediaCounts?.doc>0?`<span class="fmt-badge doc" title="${l(s("Bệnh án / Văn bản"))}">BỆNH ÁN</span>`:`<span class="fmt-badge unknown" title="${l(s("Chưa rõ định dạng nguồn"))}">—</span>`}function du(t){const e=t.mediaSummary||{},n=[];if(e.dicom>0&&n.push('<span class="fmt-badge dicom">DICOM</span>'),e.photo>0&&n.push('<span class="fmt-badge jpg">JPG</span>'),e.video>0&&n.push('<span class="fmt-badge video">VIDEO</span>'),e.doc>0&&n.push('<span class="fmt-badge doc">DOC</span>'),n.length===0){const o=(t.studies||[]).some(a=>a.primaryMediaType==="dicom"||a.mediaCounts?.dicom>0);n.push(o?'<span class="fmt-badge dicom">DICOM</span>':`<span class="fmt-badge unknown" title="${l(s("Chưa rõ định dạng nguồn"))}">—</span>`)}return n.join(" ")}const Ur="worklist_column_widths",to={c0:38,c1:210,c2:100,c3:95,c4:95,c5:120,c6:105,c7:240},ki={c0:30,c1:140,c2:80,c3:80,c4:80,c5:90,c6:90,c7:240},xi={c0:72,c1:900,c2:240,c3:200,c4:200,c5:240,c6:280,c7:900},Kr=Object.keys(to);function hn(t,e){const n=to[t];return Number.isFinite(e)?Math.min(xi[t],Math.max(ki[t],Math.round(e))):n}function Ln(t){const e=t&&typeof t=="object"&&!Array.isArray(t)?t:{};return Object.fromEntries(Kr.map(n=>[n,hn(n,e[n]??to[n])]))}function eo(){try{if(typeof localStorage<"u"){const t=localStorage.getItem(Ur);if(t){const e=JSON.parse(t);return Ln(e)}}}catch{}return Ln()}function po(t){try{typeof localStorage<"u"&&localStorage.setItem(Ur,JSON.stringify(Ln(t)))}catch{}}function zr(t,e){const n=Ln(e||eo());return t&&Kr.forEach(o=>{t.style.setProperty(`--wl-${o}`,`${n[o]}px`),t.querySelector(`.col-resizer[data-col='${o}']`)?.setAttribute("aria-valuenow",String(n[o]))}),n}function uu(t){if(!t)return;const e=t.classList?.contains("worklist-tree")?t:t.closest?.(".worklist-tree")||t.querySelector?.(".worklist-tree")||A()?.querySelector(".worklist-tree");if(!e)return;const n=zr(e,eo());function o(r){const d=e.querySelector(`.col-resizer[data-col='${r}']`)?.closest(".plist-header > *")?.getBoundingClientRect().width||0;return d>0?d:n[r]}function a(r,c,d=null){let u=hn(r,c);if(r==="c7"&&d&&u<d.action){const h=u-d.action,p=hn("c1",d.name-h),f=d.name-p;u=hn("c7",d.action+f),n.c1=p,e.style.setProperty("--wl-c1",`${p}px`),e.querySelector(".col-resizer[data-col='c1']")?.setAttribute("aria-valuenow",String(p))}return n[r]=u,e.style.setProperty(`--wl-${r}`,`${u}px`),e.querySelector(`.col-resizer[data-col='${r}']`)?.setAttribute("aria-valuenow",String(u)),u}t.querySelectorAll(".col-resizer").forEach(r=>{r.addEventListener("pointerdown",c=>{c.preventDefault(),c.stopPropagation();const d=r.dataset.col;if(!d)return;const u=r.closest(".plist-header > *"),h=c.clientX,p=u?u.getBoundingClientRect().width:0,f=p>0?p:n[d]||100,y=d==="c7"?{action:f,name:o("c1")}:null;if(r.classList.add("resizing"),document.documentElement.classList.add("is-column-resizing"),typeof r.setPointerCapture=="function")try{r.setPointerCapture(c.pointerId)}catch{}function S($){if($.pointerId!==c.pointerId)return;const O=$.clientX-h;a(d,f+O,y)}function b($){if($.pointerId===c.pointerId){if(r.classList.remove("resizing"),document.documentElement.classList.remove("is-column-resizing"),typeof r.releasePointerCapture=="function")try{r.releasePointerCapture($.pointerId)}catch{}window.removeEventListener("pointermove",S),window.removeEventListener("pointerup",b),window.removeEventListener("pointercancel",b),window.removeEventListener("blur",g),po(n)}}function g(){b(c)}window.addEventListener("pointermove",S),window.addEventListener("pointerup",b),window.addEventListener("pointercancel",b),window.addEventListener("blur",g)}),r.addEventListener("keydown",c=>{const d=r.dataset.col;if(!d)return;const u=c.key==="ArrowLeft"?-1:c.key==="ArrowRight"?1:0;if(!u&&c.key!=="Home"&&c.key!=="End")return;c.preventDefault(),c.stopPropagation();const h=o(d),p=d==="c7"?{action:h,name:o("c1")}:null,f=c.key==="Home"?ki[d]:c.key==="End"?xi[d]:h+u*(c.shiftKey?50:10);a(d,f,p),po(n)}),r.addEventListener("dblclick",c=>{c.preventDefault(),c.stopPropagation();const d=r.dataset.col;if(!d)return;const u=o(d),h=d==="c7"?{action:u,name:o("c1")}:null;a(d,to[d],h),po(n)}),r.addEventListener("click",c=>{c.stopPropagation(),c.preventDefault()})})}function Ct(t,e,n){const o=C("Đổi độ rộng cột {}",e);return`<span class="col-resizer" data-col="${t}"
    role="separator" tabindex="0" aria-orientation="vertical"
    aria-label="${l(o)}"
    aria-valuemin="${ki[t]}"
    aria-valuemax="${xi[t]}"
    aria-valuenow="${n[t]}"
    title="${l(s("Kéo hoặc dùng phím mũi tên; nhấp đúp để đặt lại"))}"></span>`}function Xr(){const t=Qn();if(i.worklistLoading&&!i.worklistLoaded&&t.length===0)return`<div class="worklist-loading" role="status"><i></i><span>${l(s("Đang tải danh sách bệnh nhân…"))}</span></div>`;if(t.length===0)return i.worklistError?`<div class="empty-state error">
        <b>${l(s("Không tải được danh sách bệnh nhân"))}</b>
        <span>${l(i.worklistError)}</span>
        <button class="primary" data-action="refresh-worklist">${l(s("Thử quét lại"))}</button>
      </div>`:`
      <div class="empty-state">
        <b>${l(s("Chưa có hồ sơ nào trong danh sách"))}</b>
        <div class="empty-actions" style="margin-top: 10px;">
          <button class="primary" data-action="choose-archive">${l(s("Mở folder bệnh nhân"))}</button>
        </div>
      </div>
    `;i.expandedPatients=i.expandedPatients||{};const e=eo();return`
    ${i.worklistError?`<div class="worklist-scan-alert" role="status">
      <span>${l(s("Đang hiển thị dữ liệu lần quét trước."))} ${l(i.worklistError)}</span>
      <button class="soft-button" data-action="refresh-worklist">${l(s("Thử quét lại"))}</button>
    </div>`:""}
    <div class="worklist-table">
      <div class="plist-header">
      <span class="col-stt">${l(s("STT"))}${Ct("c0",s("STT"),e)}</span>
      <div class="col-who">
        <button class="col-sort-btn col-who ${i.worklistSortColumn==="name"?"sorted "+i.worklistSortOrder:""}" type="button" data-action="sort-worklist" data-sort-col="name" title="${l(s("Sắp xếp theo Họ và tên"))}">
          <span>${l(s("Họ và tên"))}</span>
          <i class="sort-icon">${i.worklistSortColumn==="name"?i.worklistSortOrder==="desc"?"▼":"▲":"↕"}</i>
        </button>
        ${Ct("c1",s("Họ và tên"),e)}
      </div>
      <div class="col-pid">
        <button class="col-sort-btn col-pid ${i.worklistSortColumn==="id"?"sorted "+i.worklistSortOrder:""}" type="button" data-action="sort-worklist" data-sort-col="id" title="${l(s("Sắp xếp theo Mã BN"))}">
          <span>${l(s("Mã BN"))}</span>
          <i class="sort-icon">${i.worklistSortColumn==="id"?i.worklistSortOrder==="desc"?"▼":"▲":"↕"}</i>
        </button>
        ${Ct("c2",s("Mã BN"),e)}
      </div>
      <div class="col-date">
        <button class="col-sort-btn col-date ${i.worklistSortColumn==="date"?"sorted "+i.worklistSortOrder:""}" type="button" data-action="sort-worklist" data-sort-col="date" title="${l(s("Sắp xếp theo Ngày chụp"))}">
          <span>${l(s("Ngày chụp"))}</span>
          <i class="sort-icon">${i.worklistSortColumn==="date"?i.worklistSortOrder==="desc"?"▼":"▲":"↕"}</i>
        </button>
        ${Ct("c3",s("Ngày chụp"),e)}
      </div>
      <div class="col-created">
        <button class="col-sort-btn col-created ${i.worklistSortColumn==="created"?"sorted "+i.worklistSortOrder:""}" type="button" data-action="sort-worklist" data-sort-col="created" title="${l(s("Sắp xếp theo Ngày thêm"))}">
          <span>${l(s("Ngày thêm"))}</span>
          <i class="sort-icon">${i.worklistSortColumn==="created"?i.worklistSortOrder==="desc"?"▼":"▲":"↕"}</i>
        </button>
        ${Ct("c4",s("Ngày thêm"),e)}
      </div>
      <span class="col-format">${l(s("Định dạng"))}${Ct("c5",s("Định dạng"),e)}</span>
      <span class="col-status">${l(s("Trạng thái"))}${Ct("c6",s("Trạng thái"),e)}</span>
      <span class="col-acts">${l(s("Action"))}${Ct("c7",s("Action"),e)}</span>
    </div>
    <div class="plist">
      ${t.map((n,o)=>{const a=i.expandedPatients[n.id]!==!1,r=n.studies||[],c=r.length,d=au(n),u=ru(n),h=r.slice().sort((g,$)=>{if(i.worklistSortColumn==="date"){const O=We(g.studyDate),T=We($.studyDate);return i.worklistSortOrder==="desc"?T-O:O-T}return 0}),p=tt(n.patientName)||tt(n.patientId)||s("Chưa rõ tên BN"),f=tt(n.patientId),y=nu(n),S=n.folderCreatedAt||"—",b=`worklist-patient-${o}-studies`;return`
          <div class="prow" data-patient-id="${l(n.id)}" data-expanded="${a}">
            <button class="stt-cell twist-btn" type="button" aria-expanded="${a}" aria-controls="${b}" data-toggle-patient="${l(n.id)}" aria-label="${l(C("Mở rộng hoặc thu gọn bệnh nhân {}",p))}"><i class="twist">▶</i><span class="stt-num">${o+1}</span></button>
            <span class="who copyable-cell" title="${l(p)}">
              <span class="who-main">
                <b>${l(p)}</b>
                ${n.category?`
                  <span class="badge-category" title="${l(C("Nhóm: {}",n.category))}"
                    >📁 ${l(n.category)}</span>
                `:""}
                ${(()=>{const g=xa(n.treatmentStage);return g?`
                    <span class="badge-stage ${l(g.tone)}" title="${l(g.title)}"
                      >${l(g.text)}</span>
                  `:""})()}
                ${tt(n.patientName)||tt(n.patientId)?`
                  <button class="cell-copy-btn" type="button" data-action="copy-cell"
                    data-copy-text="${l(tt(n.patientName)||tt(n.patientId))}"
                    title="${l(s("Sao chép tên bệnh nhân"))}">${P.copy}</button>
                `:""}
              </span>
              ${u.text?`
                <small class="dx-line${u.fromFolder?" from-folder":""}"
                  title="${l(u.title)}">${l(u.text)}</small>
              `:""}
              ${d?`<small>${l(d)}</small>`:""}
            </span>
            <span class="meta pid-col copyable-cell" title="${l(f||"—")}">
              <b>${l(f||"—")}</b>
              ${f?`
                <button class="cell-copy-btn" type="button" data-action="copy-cell"
                  data-copy-text="${l(f)}"
                  title="${l(s("Sao chép mã BN"))}">${P.copy}</button>
              `:""}
            </span>
            <span class="meta date-col copyable-cell" title="${l(y)}">
              <span>${l(y)}</span>
              ${y&&y!=="—"?`
                <button class="cell-copy-btn" type="button" data-action="copy-cell"
                  data-copy-text="${l(y)}"
                  title="${l(s("Sao chép ngày chụp"))}">${P.copy}</button>
              `:""}
            </span>
            <span class="meta created-col copyable-cell" title="${l(S)}">
              <span>${l(S)}</span>
              ${S!=="—"?`
                <button class="cell-copy-btn" type="button" data-action="copy-cell"
                  data-copy-text="${l(S)}"
                  title="${l(s("Sao chép ngày thêm"))}">${P.copy}</button>
              `:""}
            </span>
            <span class="meta format-col">${du(n)}</span>
            <span class="meta status-col count">${l(C("{} đợt khám",c))}</span>
            <span class="rowacts">
              <button class="soft-button" type="button" data-action="open-patient-record" data-patient-id="${l(n.id)}">
                ${l(s("Mở hồ sơ"))}
              </button>
              <button class="soft-button" type="button" data-action="export-patient-record"
                data-folder="${l(n.folder||"")}"
                title="${l(s("Xuất ảnh JPG kèm trang index.html để bệnh nhân mở bằng trình duyệt"))}">
                ${l(s("Xuất hồ sơ"))}
              </button>
            </span>
          </div>

          <div class="studies${a?" on":""}" id="${b}" data-studies="${l(n.id)}">
            ${h.map((g,$)=>{const O=su(g),T=g.studyDate||"—";return`
                <div class="srow${g.isRead?" read":" unread"}">
                  <span class="stt-cell"><span class="rail"></span><span class="stt-subnum">${o+1}.${$+1}</span></span>
                  <span class="who copyable-cell" title="${l(O)}">
                    <span class="who-main">
                      <b>${l(O)}</b>
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${l(O)}"
                        title="${l(s("Sao chép tên ca chụp"))}">${P.copy}</button>
                    </span>
                    <small>${l(lu(g))}</small>
                  </span>
                  <span class="meta pid-col sub copyable-cell" title="${l(tt(n.patientId)||"—")}">
                    <span>—</span>
                    ${tt(n.patientId)?`
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${l(tt(n.patientId))}"
                        title="${l(s("Sao chép mã BN"))}">${P.copy}</button>
                    `:""}
                  </span>
                  <span class="meta date-col copyable-cell" title="${l(T)}">
                    <span>${l(T)}</span>
                    ${g.studyDate&&g.studyDate!=="—"?`
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${l(g.studyDate)}"
                        title="${l(s("Sao chép ngày chụp"))}">${P.copy}</button>
                    `:""}
                  </span>
                  <span class="meta created-col sub copyable-cell" title="${l(S)}">
                    <span>—</span>
                    ${S!=="—"?`
                      <button class="cell-copy-btn" type="button" data-action="copy-cell"
                        data-copy-text="${l(S)}"
                        title="${l(s("Sao chép ngày thêm"))}">${P.copy}</button>
                    `:""}
                  </span>
                  <span class="meta format-col">${cu(g)}</span>
                  <span class="badge status-col ${g.status||"done"}">${l(s(g.statusLabel||"Đã tải"))}</span>
                  <span class="rowacts">
                    ${g.status==="part"&&g.viewerUrl?`
                      <button class="soft-button" type="button" data-action="resume-study-download" data-url="${l(g.viewerUrl)}">
                        ${l(s("Tải tiếp"))}
                      </button>
                    `:""}
                    <button class="soft-button primary" type="button" data-action="open-study-viewer" data-folder="${l(g.folder||"")}" ${["miss","busy"].includes(g.status)?"disabled":""} title="${l(g.status==="busy"?s("Ca chụp đang được tải, mở lúc này sẽ thiếu lát cắt"):"")}">
                      ${l(s("Mở viewer"))}
                    </button>
                    <button class="soft-button" type="button" data-action="reveal-study-folder" data-folder="${l(g.folder||"")}" ${g.status==="miss"?"disabled":""}>
                      ${l(s("Thư mục"))}
                    </button>
                    <button class="soft-button read-toggle${g.isRead?" on":""}" type="button"
                      data-action="toggle-study-read"
                      data-folder="${l(g.folder||"")}"
                      data-read="${g.isRead?"1":"0"}"
                      title="${l(g.isRead?s("Bỏ đánh dấu đã đọc"):s("Đánh dấu đã đọc"))}">
                      ${g.isRead?"✓":"○"}
                    </button>
                  </span>
                </div>
              `}).join("")}
          </div>
        `}).join("")}
    </div>
    </div>
  `}const hu=new Set(["sort-worklist","copy-cell","open-study-viewer","open-patient-record","reveal-study-folder","open-worklist-item","resume-study-download","toggle-study-read","clear-worklist-filters","export-patient-record"]),pu=[["","Tất cả"],["active","Đang điều trị"],["post-op","Hậu phẫu"],["followup","Theo dõi"],["relapse","Tái phát"],["unknown","Chưa ghi"]];function Jr(t){t&&([["worklist-modality","worklistModality"],["worklist-period","worklistPeriod"],["worklist-read","worklistRead"],["worklist-stage","worklistStage"]].forEach(([e,n])=>{t.querySelector(`[data-field='${e}']`)?.addEventListener("change",o=>{i[n]=o.target.value,Kt()})}),t.querySelector("[data-action='clear-worklist-filters']")?.addEventListener("click",()=>{F("clear-worklist-filters",null)}))}function $i(t){t&&(t.querySelectorAll("[data-action='sort-worklist']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation(),F("sort-worklist",e)})}),t.querySelectorAll("[data-action='copy-cell']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation(),F("copy-cell",e)})}),t.querySelectorAll(".copyable-cell").forEach(e=>{e.addEventListener("dblclick",n=>{if(n.target.closest("button"))return;n.stopPropagation();const a=e.querySelector(".cell-copy-btn")?.dataset?.copyText||e.querySelector("b, span")?.textContent?.trim();a&&a!=="—"&&ae(a,`${s("Đã sao chép")}: ${a.length>25?a.slice(0,22)+"...":a}`)})}),t.querySelectorAll(".prow").forEach(e=>{e.addEventListener("click",n=>{const o=n.target.closest("button, a, input, .cell-copy-btn");if(o&&!o.classList.contains("twist-btn"))return;const a=window.getSelection();if(a&&a.toString().trim().length>0)return;const r=e.dataset.patientId||e.dataset.togglePatient;if(!r)return;i.expandedPatients=i.expandedPatients||{},i.expandedPatients[r]=i.expandedPatients[r]===!1;const c=i.expandedPatients[r],d=t.querySelector(`[data-studies='${r}']`);d&&d.classList.toggle("on",c),e.dataset.expanded=String(c);const u=e.querySelector(".twist-btn");u&&u.setAttribute("aria-expanded",String(c))})}),t.querySelectorAll("[data-action='open-study-viewer']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation();const o=e.dataset.folder;o&&pn({folder:o})})}),t.querySelectorAll("[data-action='open-patient-record']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation();const o=e.dataset.patientId,a=Zn().find(c=>c.id===o);if(!a)return;const r=a.folder||a.studies?.[0]?.folder;r&&pn({folder:r})})}),t.querySelectorAll("[data-action='export-patient-record']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation(),F("export-patient-record",e)})}),t.querySelectorAll("[data-action='toggle-study-read']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation(),F("toggle-study-read",e)})}),t.querySelectorAll("[data-action='reveal-study-folder']").forEach(e=>{e.addEventListener("click",async n=>{n.stopPropagation();const o=e.dataset.folder;if(o)try{await N("/api/worklist/reveal-folder",{method:"POST",body:JSON.stringify({folder:o})})}catch(a){x(s("Không thể mở thư mục: ")+a.message,!0)}})}),t.querySelectorAll("[data-action='open-worklist-item']").forEach(e=>{e.addEventListener("click",()=>{const n=e.dataset.folder;n&&pn({folder:n})})}),t.querySelectorAll("[data-action='resume-study-download']").forEach(e=>{e.addEventListener("click",n=>{n.stopPropagation(),fu(e.dataset.url||"")})}),uu(t))}function fu(t){if(!t){x(s("Ca chụp này không lưu link viewer để tải tiếp."),!0);return}i.lastDirectUrl=t,i.showManualInfo=!0,i.downloadOpen=!0,E();const e=A()?.querySelector("#direct-url");e&&(e.value=t,e.focus()),x(s("Đã nạp link của ca chụp. Quét series rồi bấm Thử lại để tải tiếp."))}function mu(t){const e=Number(t)||0;if(e<=0)return"0 B";const n=["B","KB","MB","GB","TB"],o=Math.min(Math.floor(Math.log(e)/Math.log(1024)),n.length-1);return`${(e/Math.pow(1024,o)).toFixed(o===0?0:1)} ${n[o]}`}function Yr(){const t=Qn(),e=t.flatMap(d=>d.studies||[]),n=e.reduce((d,u)=>d+(Number.isFinite(u.sliceCount)?u.sliceCount:0),0),o=t.reduce((d,u)=>d+(Number(u.totalSizeBytes)||0),0),a=e.reduce((d,u)=>d+(Number.isFinite(u.durationSeconds)?u.durationSeconds:0),0),r=e.filter(d=>d.status==="part"||d.status==="miss").length,c=[{value:t.length,label:s("bệnh nhân")},{value:e.length,label:s("hồ sơ")},{value:n.toLocaleString("vi-VN"),label:s("ảnh & lát")}];if(a>0){const d=String(Math.floor(a/60)).padStart(2,"0"),u=String(Math.round(a%60)).padStart(2,"0");c.push({value:`${d}:${u}`,label:s("phút video")})}return o>0&&c.push({value:mu(o),label:s("trên đĩa")}),r>0&&c.push({value:r,label:s("cần xử lý"),alert:!0}),c.map(d=>`
    <div class="activity-stat${d.alert?" alert":""}">
      <b>${l(String(d.value))}</b>
      <small>${l(d.label)}</small>
    </div>
  `).join("")}function gu(){const t=new Map;return Zn().forEach(e=>{(e.studies||[]).forEach(n=>{const o=String(n.modality||"").trim();o&&!t.has(o.toUpperCase())&&t.set(o.toUpperCase(),o)})}),[...t.values()].sort((e,n)=>e.localeCompare(n,"vi"))}function Zr(){const t=gu(),e=Zn().reduce((r,c)=>r+(c.studies||[]).filter(d=>!d.isRead).length,0),n=[["all",s("Mọi thời điểm")],["today",s("Hôm nay")],["week",s("7 ngày")],["month",s("30 ngày")]],o=[["all",s("Tất cả")],["unread",s("Chưa đọc")],["read",s("Đã đọc")]],a=([r,c],d)=>`<option value="${l(r)}"${r===d?" selected":""}>${l(c)}</option>`;return`
    <div class="worklist-filter-bar secondary">
      <label class="worklist-filter">
        <span>${l(s("Loại chụp"))}</span>
        <select data-field="worklist-modality">
          <option value=""${i.worklistModality?"":" selected"}>${l(s("Tất cả"))}</option>
          ${t.map(r=>a([r,r],i.worklistModality)).join("")}
        </select>
      </label>
      <label class="worklist-filter">
        <span>${l(s("Ngày chụp"))}</span>
        <select data-field="worklist-period">
          ${n.map(r=>a(r,i.worklistPeriod)).join("")}
        </select>
      </label>
      <label class="worklist-filter">
        <span>${l(s("Trạng thái đọc"))}</span>
        <select data-field="worklist-read">
          ${o.map(r=>a(r,i.worklistRead)).join("")}
        </select>
      </label>
      <label class="worklist-filter">
        <span>${l(s("Giai đoạn"))}</span>
        <select data-field="worklist-stage">
          ${pu.map(r=>a([r[0],s(r[1])],i.worklistStage)).join("")}
        </select>
      </label>
      <span class="worklist-unread-count">${l(C("{} ca chưa đọc",e))}</span>
      ${Vr()?`<button class="soft-button" type="button" data-action="clear-worklist-filters">${l(s("Bỏ lọc"))}</button>`:""}
    </div>
  `}function yu(){const t=eo(),e=Object.entries(t).map(([n,o])=>`--wl-${n}: ${o}px;`).join(" ");return`
    <div class="worklist-filter-bar filters">
      <input type="search" data-field="worklist-search" placeholder="${l(s("Tìm theo tên hoặc mã bệnh nhân, đợt khám…"))}" value="${l(i.worklistSearch||"")}">
      <span class="worklist-sync-state${i.worklistError?" error":""}" role="status">${l(Wr())}</span>
      <button class="soft-button" data-action="refresh-worklist" ${i.worklistLoading?"disabled":""}>${l(s("Quét lại"))}</button>
    </div>

    ${Zr()}

    <div class="worklist-tree" style="${e}">${Xr()}</div>
  `}const vu={download:"Tải ca theo mã bệnh nhân","direct-download":"Tải theo link viewer","local-import":"Nhập thư mục từ đĩa",archive:"Quét lại kho",search:"Tìm ca chụp","series-discovery":"Dò danh sách series",export:"Xuất hồ sơ cho bệnh nhân"};function Qr(){const t=i.job||i.bootstrap?.job||{},e=t.status==="running",n=i.history||[],o=i.sourceFolders?.length?i.sourceFolders:i.bootstrap?.sourceFolders||(i.bootstrap?.outputRoot?[{folder:i.bootstrap.outputRoot,exists:!0,isDefault:!0}]:[]);return`
    <div class="activity-head">${l(s("Tổng quan kho & dữ liệu"))}</div>
    <div class="activity-summary">
      ${Yr()}
    </div>

    <div class="activity-head-row">
      <div class="activity-head">${l(s("Thư mục nguồn bệnh nhân"))}</div>
      <button class="mini-btn primary source-add-btn" type="button" data-action="add-source-folder" title="${l(s("Thêm thư mục nguồn"))}">
        ➕ ${l(s("Thêm thư mục"))}
      </button>
    </div>
    <div class="activity-source-folders">
      ${o.length===0?`
        <div class="activity-idle">${l(s("Chưa có thư mục nguồn nào được cấu hình."))}</div>
      `:o.map(a=>`
        <div class="activity-folder-row ${a.exists?"":"missing"}">
          <span class="folder-icon">📁</span>
          <span class="folder-path" title="${l(a.folder||"")}">
            ${l(a.folder||"")}
            ${a.isDefault?`<span class="folder-badge default">${l(s("Mặc định"))}</span>`:""}
            ${a.exists?"":`<span class="folder-badge missing">${l(s("Không tồn tại"))}</span>`}
          </span>
          <span class="folder-actions">
            <button class="mini-btn icon-btn" type="button" data-action="open-folder-explorer" data-folder="${l(a.folder||"")}" title="${l(s("Mở trong Explorer"))}">📂</button>
            ${a.isDefault?"":`
              <button class="mini-btn danger icon-btn" type="button" data-action="remove-source-folder" data-folder="${l(a.folder||"")}" title="${l(s("Xóa thư mục khỏi danh sách"))}">🗑️</button>
            `}
          </span>
        </div>
      `).join("")}
    </div>

    <div class="activity-head">${l(s("Đang xử lý"))}</div>
    ${e?`
      <div class="activity-job">
        <b>${l(s(vu[t.kind]||"Tác vụ nền"))}</b>
        <button class="soft-button danger" data-action="stop-job">${l(s("Dừng"))}</button>
        <div class="activity-bar indeterminate"><i></i></div>
        <small class="activity-job-msg">${l(ue(t.message||"")||s("Đang chạy..."))}</small>
      </div>
    `:`
      <div class="activity-idle">${l(s("Không có tác vụ nào đang chạy."))}</div>
    `}

    <div class="activity-head">${l(s("Gần đây"))}</div>
    <div class="activity-history">
      ${n.length===0?`
        <div class="activity-idle">${l(s("Chưa có thư mục nào được mở hoặc tải."))}</div>
      `:n.map(a=>`
        <div class="activity-hrow">
          <span class="activity-time">${l(a.time||"")}</span>
          <span class="activity-path" title="${l(a.folder||"")}">${l(a.folder||"")}</span>
          <span class="activity-acts">
            <button class="soft-button" data-action="open-worklist-item" data-folder="${l(a.folder||"")}">${l(s("Mở"))}</button>
          </span>
        </div>
      `).join("")}
    </div>

    <div class="activity-head-row">
      <div class="activity-head">${l(s("Nhật ký phiên làm việc (Logs)"))}</div>
      <button class="mini-btn primary" type="button" data-action="open-logs">
        ${l(s("Mở thư mục Log"))}
      </button>
    </div>
    <div class="activity-source-folders">
      <div class="activity-folder-row">
        <span class="folder-icon">📝</span>
        <span class="folder-path" title="${l(s("Ghi log tự động mỗi lần khởi chạy — lưu tại thư mục logs/"))}">
          ${l(s("Ghi log tự động mỗi lần khởi chạy — lưu tại thư mục logs/"))}
        </span>
        <span class="folder-actions">
          <button class="mini-btn icon-btn" type="button" data-action="open-logs" title="${l(s("Mở thư mục Log trong Explorer"))}">📂</button>
        </span>
      </div>
    </div>
  `}function bu(){if(i.activeTabId!=="worklist"||i.worklistTab!=="activity")return;const t=A()?.querySelector("#activity-panel");t&&(t.innerHTML=Qr(),$i(t),t.querySelectorAll("[data-action]").forEach(e=>{e.addEventListener("click",()=>F(e.dataset.action,e))}))}function wu(){const t=i.worklistTab==="activity"?"activity":"studies",n=(i.job||i.bootstrap?.job||{}).status==="running"?1:0;return`
    <main class="worklist-view">
      <div class="worklist-tabs" role="tablist">
        <button class="worklist-tab${t==="studies"?" active":""}" role="tab"
          aria-selected="${t==="studies"}"
          data-action="worklist-tab" data-worklist-tab="studies">
          ${l(s("Danh sách bệnh nhân"))}
          <span class="worklist-tab-count">${Qn().length}</span>
        </button>
        <button class="worklist-tab${t==="activity"?" active":""}" role="tab"
          aria-selected="${t==="activity"}"
          data-action="worklist-tab" data-worklist-tab="activity">
          ${l(s("Hoạt động & hàng đợi"))}
          ${n?`<span class="worklist-tab-count running">${n}</span>`:""}
        </button>
      </div>

      ${t==="studies"?yu():`<div id="activity-panel" class="activity-panel">${Qr()}</div>`}
    </main>
  `}function ie(){return typeof window<"u"?window.pywebview?.api:void 0}function ia(t){return!!t?.closest?.("button, select, input, textarea, a, [data-no-drag]")}function ku(){const t=l(s("Thu nhỏ cửa sổ")),e=l(s("Phóng to / Khôi phục")),n=l(s("Đóng ứng dụng"));return`
    <div class="window-controls">
      <button class="win-btn win-min" type="button" data-action="window-minimize"
        title="${t}" aria-label="${t}">
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10"/></svg>
      </button>
      <button class="win-btn win-max" type="button" data-action="window-maximize"
        title="${e}" aria-label="${e}">
        <svg class="glyph-maximize" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" rx="1"/></svg>
        <svg class="glyph-restore" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/>
          <rect x="0.5" y="2.5" width="7" height="7" rx="1"/></svg>
      </button>
      <button class="win-btn win-close" type="button" data-action="window-close"
        title="${n}" aria-label="${n}">
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/></svg>
      </button>
    </div>`}const aa=3;function xu(){const t=A()?.querySelector(".app-header");t&&(t.addEventListener("mousedown",e=>{if(e.button!==0||ia(e.target))return;const n=ie();if(!n?.window_begin_drag)return;const o={x:e.screenX,y:e.screenY},a=()=>{window.removeEventListener("mousemove",r,!0),window.removeEventListener("mouseup",a,!0)};function r(c){if(!(c.buttons&1))return a();Math.abs(c.screenX-o.x)<aa&&Math.abs(c.screenY-o.y)<aa||(a(),Promise.resolve(n.window_begin_drag()).then(No).catch(()=>{}))}window.addEventListener("mousemove",r,!0),window.addEventListener("mouseup",a,!0)}),t.addEventListener("dblclick",e=>{ia(e.target)||F("window-maximize")}))}let $e=null;function No(){const t=ie();return t?.window_state?$e||($e=Promise.resolve(t.window_state()).then(e=>{i.windowMaximized=!!e?.maximized,i.zenMode=!!e?.fullscreen,Do()}).catch(()=>{}).finally(()=>{$e=null}),$e):Promise.resolve()}function Do(){const t=A()?.querySelector(".app-shell");t&&(t.classList.toggle("window-maximized",i.windowMaximized),t.classList.toggle("zen-mode",i.zenMode))}function $u(){let t=!1;window.addEventListener("resize",()=>{t||(t=!0,requestAnimationFrame(()=>{t=!1,No()}))}),No()}function E(){const t=q();So(t).some(g=>g.id===i.windowPreset)||(i.windowPreset=Sn(t));const e=X(t)==="dicom",n=e?Ba(t):null,o=!t?.mprReady;if(!ui())return;const a=m.querySelector(".series-strip"),r=a?a.scrollTop:null,c=a?a.scrollLeft:null,d=m.querySelector(".patient-history-rail"),u=d?d.scrollTop:null,h=m.querySelector("#series-picker"),p=h?h.scrollTop:null,f=m.querySelector(".study-list"),y=f?f.scrollTop:null,S=m.querySelector(".worklist-table-container, .worklist-view"),b=S?S.scrollTop:null;if(m.innerHTML=`
    <div class="app-shell ${Fd()?"":"download-collapsed"} ${i.activeTabId==="worklist"?"worklist-active":"viewer-active"}${i.windowMaximized?" window-maximized":""}${i.zenMode?" zen-mode":""}">
      <header class="app-header">
        <div class="header-left">
          <div class="brand">
            <span class="brand-mark">D</span>
            <div class="brand-text">
              <b>DICOM/JPG Downloader & Viewer</b>
              <small>OFFLINE · v1.1</small>
            </div>
          </div>
        </div>

        <div class="header-center">
          ${i.activeTabId!=="worklist"&&i.archive?.series?.length?`
          <div class="series-selects">
            <label>${l(s("Series"))}
              <select data-field="series">${yd(i.archive,i.selectedId)}</select>
            </label>
          </div>
          `:'<div class="header-center-spacer"></div>'}
        </div>

        <div class="header-right">
          <div class="header-actions">
            ${i.activeTabId==="worklist"?L("toggle-download",i.downloadOpen?"⇤":"⇥",s(i.downloadOpen?"Thu gọn khu tải phim":"Mở khu tải phim"),i.downloadOpen,!1,s("Tải phim")):""}
            ${L("choose-archive",P.folder,s("Mở folder hồ sơ: phim, ảnh, video và văn bản đều được nhận diện"))}
            ${L("refresh-archive","⟳",s("Quét lại thư mục hiện tại"),!1,!i.archive.root)}
            <button class="soft-button" data-action="open-logs">Log</button>
            <button class="soft-button" data-action="toggle-language"
              title="${l(s("Chuyển sang tiếng Anh"))}">${Re()==="en"?"VI":"EN"}</button>
          </div>
          ${ku()}
        </div>
      </header>

      ${wd()}

      ${i.activeTabId==="worklist"?`
      <aside class="download-panel">
        <div class="rail-collapsed-strip" data-action="toggle-download" title="${l(s("Mở khu tải phim"))}">
          <button class="download-expand-trigger" type="button" data-action="toggle-download"
            ${i.downloadOpen?"hidden":""}
            title="${l(s("Mở khu tải phim"))}" aria-label="${l(s("Mở khu tải phim"))}">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="rail-vertical-title">${l(s("Tải ca chụp"))}</span>
        </div>
        <div class="panel-title"><b>${l(s("TẢI MRI / CT"))}</b>
          <button class="panel-toggle-btn" data-action="toggle-download" title="${l(s("Thu gọn khu tải phim"))}" aria-label="${l(s("Thu gọn khu tải phim"))}"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
        <section class="dicom-source-card">
          <button data-action="import-dicom-folder"
            title="${l(s("Tính năng xuất JPG riêng; không dùng để mở DICOM trong viewer."))}">${l(s("Chuyển Dcom → JPG"))}</button>
        </section>
        <div class="hospital-row">
          ${(i.bootstrap?.hospitals||[]).map((g,$)=>`<label><input type="radio" name="hospital" value="${g.id}"
          ${i.patient?.hospitalKey?g.id===i.patient.hospitalKey?"checked":"":g.isDefault??$===0?"checked":""}>
              ${l(g.name)}</label>`).join("")}
        </div>
        <div class="field-row">
          <fieldset class="boxed-field">
            <legend>${l(s("Mã bệnh nhân"))}</legend>
            <span class="clearable">
              <input id="patient-id" autocomplete="off" value="${l(i.patient?.patientId||"")}">
              <button class="clear-field" data-action="clear-patient-id" tabindex="-1"
                title="${l(s("Xóa mã bệnh nhân"))}" aria-label="${l(s("Xóa mã bệnh nhân"))}">×</button>
            </span>
          </fieldset>
          <button data-action="search"
            title="${l(s("Tìm các ca MRI/CT của mã bệnh nhân này trên RIS"))}">${l(s("Tìm ca"))}</button>
        </div>
        <div class="patient-status">${hs()}</div>
        <div class="study-list">${rs()}</div>
        <div class="download-actions">
          <button class="primary" data-action="download-selected"
            title="${l(s("Tải các ca đang tích ở danh sách trên"))}"
            ${i.studies.some(g=>g.local_status!=="downloaded")&&!i.patient?.nameConflict?"":"disabled"}>${l(s("Tải ca đã chọn"))}</button>
          <button class="danger" data-action="stop-job"
            title="${l(s("Dừng an toàn tác vụ đang chạy"))}">${l(s("Dừng"))}</button>
        </div>
        <small class="download-hint" hidden></small>
        <fieldset class="boxed-field">
          <legend>${l(s("Link viewer"))}</legend>
          <span class="clearable">
            <input id="direct-url" type="text" spellcheck="false" value="${l(i.lastDirectUrl)}">
            <button class="clear-field" data-action="clear-direct-url" tabindex="-1"
              title="${l(s("Xóa link viewer"))}" aria-label="${l(s("Xóa link viewer"))}">×</button>
          </span>
        </fieldset>
        <div class="link-actions">
          <button data-action="download-direct"
            title="${l(s("Tải mới từ link đã dán vào một folder riêng"))}">${l(s("Tải link"))}</button>
          <button data-action="download-retry"
            title="${l(s("Thử lại link vừa dán và gộp vào folder cũ, bỏ qua ảnh đã có"))}">${l(s("Thử lại"))}</button>
        </div>
        <div class="manual-info-toggle">
          <label><input type="checkbox" id="manual-info-toggle" ${i.showManualInfo?"checked":""}> ${l(s("Bổ sung thông tin bệnh nhân"))}</label>
        </div>
        <div id="manual-info-container">
          ${ss()}
        </div>
        <div class="download-options">
          <label title="${l(s("Chất lượng JPG (70-100)"))}">JPG
            <input id="quality" type="number" min="70" max="100" value="100"></label>
          <label><input id="download-all-files" type="checkbox" ${i.downloadAllFiles?"checked":""}>
            ${l(s("Tải tất cả file"))}</label>
          <label><input id="show-browser" type="checkbox"> ${l(s("Hiện trình duyệt tải"))}</label>
        </div>
        <div id="series-picker" class="series-picker ${i.downloadAllFiles?"hidden":""}">
          ${us()}
        </div>
        <label class="field">${l(s("Thư mục lưu"))}
          <div class="inline-field"><input id="output-root" value="${l(i.bootstrap?.outputRoot||"")}" readonly>
            <button data-action="choose-output" title="${l(s("Đổi thư mục lưu"))}">…</button></div>
        </label>
        <div class="job-log-wrap">
          <pre class="job-log" id="job-log-pre">${l((i.bootstrap?.job?.logs||[]).map(ue).join(`
`))}</pre>
          <div class="job-log-floating-actions">
            <button type="button" class="job-log-icon-btn btn-clear-log" data-action="clear-job-log" title="${l(s("Xoá hiển thị"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <button type="button" class="job-log-icon-btn btn-copy-log" data-action="copy-job-log" title="${l(s("Sao chép toàn bộ nhật ký"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
        </div>
        <div class="panel-credit">Superkent.bui@gmail.com</div>
      </aside>
      `:""}

      ${i.activeTabId==="worklist"?wu():`
      <main class="viewer-main ${i.patientRailCollapsed?"rail-collapsed":""}">
        ${Jd()}
        ${e?`
        <nav class="toolbar mode-${i.mode}">
          <div class="tool-cluster layout-tools">
            ${L("mode-single",P.single,s("Một khung ảnh"),i.mode==="single")}
            ${L("mode-compare",P.compare,s("So sánh hai series cạnh nhau"),i.mode==="compare",!1,"2")}
            ${L("mode-compare3",P.compare3,s("So sánh ba series cạnh nhau"),i.mode==="compare3",!1,"3")}
            ${L("mode-montage6",P.montage6,s("Xem tuần tự 6 lát"),i.mode==="montage6",!1,"6")}
            ${L("mode-montage8",P.montage8,s("Xem tuần tự 8 lát"),i.mode==="montage8",!1,"8")}
            ${L("mode-mpr",P.mpr,o?t?.mprReason||s("Series không đủ MPR"):s("MPR ba mặt phẳng"),i.mode==="mpr",o)}
            ${L("mode-volume3d",P.volume3d,o?t?.mprReason||s("Series không đủ 3D"):s("Dựng volume 3D toàn màn hình"),i.mode==="volume3d",o,"3D")}
          </div>
          ${i.mode!=="volume3d"?`<div class="window-preset-control">
            <select data-field="window-preset" aria-label="${l(s("Cài đặt hiển thị"))}" title="${l(s(kr(t)))}">
              ${So(t).map(g=>`<option value="${g.id}" ${i.windowPreset===g.id?"selected":""}>${l(g.detail?`${s(g.label)} · ${g.detail}`:s(g.label))}</option>`).join("")}
            </select>
          </div>`:""}
          <span class="toolbar-divider"></span>
          ${md(t)}
        </nav>
        `:""}

        <div class="series-strip">
          ${vd(i.archive.series)}
        </div>

        <div class="safety-notice ${n?.level||""}" ${n?"":"hidden"}>
          <b>${l(s("An toàn hiển thị"))}</b><span>${l(n?s(n.text):"")}</span>
        </div>
        <section id="workspace" class="workspace-grid ${k.editing?"clinical-mode":X(t)!=="dicom"?"media-mode":""}">
          ${Fr(t)}
        </section>
        <footer class="status-bar ${i.isError?"error":""}">
          <span class="status-dot ${i.busyViewer?"busy":""}"></span>
          <span class="status-text">${l(i.status||"")}</span>
          <span class="status-root" title="${l(i.archive.root||"")}">${l(i.archive.root||"")}</span>
        </footer>
      </main>
      `}
      ${Su()}
      ${Cu()}
      ${Iu()}
      ${Tu()}
      ${ns()}
    </div>
  `,Eu(),bi(),Gr(),Du(),ce(),r!==null||c!==null){const g=m.querySelector(".series-strip");g&&(r!==null&&(g.scrollTop=r),c!==null&&(g.scrollLeft=c))}if(u!==null){const g=m.querySelector(".patient-history-rail");g&&(g.scrollTop=u)}if(p!==null){const g=m.querySelector("#series-picker");g&&(g.scrollTop=p)}if(y!==null){const g=m.querySelector(".study-list");g&&(g.scrollTop=y)}if(b!==null){const g=m.querySelector(".worklist-table-container, .worklist-view");g&&(g.scrollTop=b)}}function Su(){return i.showLoginCard?`
    <div class="modal-overlay">
      <div class="login-card">
        <h3>${l(s("Đăng nhập RIS thất bại"))}</h3>
        <p>${l(s("Vui lòng nhập tài khoản RIS dự phòng:"))}</p>
        <label class="field">${l(s("Tài khoản"))}
          <input id="custom-ris-user" type="text" autocomplete="off" autofocus>
        </label>
        <label class="field">${l(s("Mật khẩu"))}
          <input id="custom-ris-pass" type="password">
        </label>
        <div class="login-card-actions">
          <button data-action="cancel-login">${l(s("Huỷ"))}</button>
          <button class="primary" data-action="retry-login">${l(s("Đăng nhập & Thử lại"))}</button>
        </div>
      </div>
    </div>
  `:""}function ts(){const t=i.fileInfoData?.dicomTags||[],e=(i.fileInfoTagFilter||"").toLowerCase().trim();return e?t.filter(n=>(n.tag||"").toLowerCase().includes(e)||(n.name||"").toLowerCase().includes(e)||(n.value||"").toLowerCase().includes(e)):t}function es(t){return t.length?t.map(e=>`
    <tr>
      <td class="dicom-tag-col-tag">${l(e.tag)}</td>
      <td class="dicom-tag-col-vr">${l(e.vr)}</td>
      <td class="dicom-tag-col-name">${l(e.name)}</td>
      <td class="dicom-tag-col-val">${l(e.value)}</td>
    </tr>
  `).join(""):`<tr><td colspan="4" class="dicom-tags-empty">${l(s("Không tìm thấy thẻ phù hợp"))}</td></tr>`}function Cu(){if(!i.showFileInfoModal)return"";const t=i.fileInfoData,e=i.fileInfoLoading,n=i.fileInfoError;if(e)return`
      <div class="file-info-overlay">
        <div class="file-info-dialog">
          <header class="file-info-header">
            <div class="file-info-title-wrap">
              <h3 class="file-info-title">ℹ ${l(s("Chi tiết file & Thẻ DICOM"))}</h3>
            </div>
            <button class="file-info-close-btn" data-action="close-file-info">✕</button>
          </header>
          <div class="file-info-body">
            <div class="viewer-loading">${l(s("Đang đọc thông tin file..."))}</div>
          </div>
        </div>
      </div>
    `;if(n)return`
      <div class="file-info-overlay">
        <div class="file-info-dialog">
          <header class="file-info-header">
            <div class="file-info-title-wrap">
              <h3 class="file-info-title">ℹ ${l(s("Chi tiết file & Thẻ DICOM"))}</h3>
            </div>
            <button class="file-info-close-btn" data-action="close-file-info">✕</button>
          </header>
          <div class="file-info-body">
            <div class="safety-notice high">
              <b>${l(s("Lỗi"))}</b>
              <span>${l(n)}</span>
            </div>
          </div>
        </div>
      </div>
    `;if(!t)return"";const o=t.file||{},a=t.provenance||{},r=t.demographics||{},c=t.study||{},d=t.series||{},u=ts(),h=a.downloadUrl||a.viewerUrl||"";return`
    <div class="file-info-overlay">
      <div class="file-info-dialog">
        <header class="file-info-header">
          <div class="file-info-title-wrap">
            <h3 class="file-info-title">ℹ ${l(s("Chi tiết file & Thẻ DICOM"))}</h3>
            <span class="file-info-subtitle">${l(o.fileName||d.seriesDescription||"")} (${l(o.sliceIndexDisplay||"1/1")})</span>
          </div>
          <button class="file-info-close-btn" data-action="close-file-info" title="${l(s("Đóng"))}">✕</button>
        </header>

        <div class="file-info-body">
          <!-- Provenance / Download Link Card -->
          <div class="provenance-card">
            <div class="provenance-card-title">
              <span>🌐</span> ${l(s("Nguồn gốc & Link tải"))}
            </div>
            ${h?`
              <div class="provenance-link-row">
                <span class="provenance-url-text" title="${l(h)}">${l(h)}</span>
                <button class="provenance-action-btn" data-action="copy-download-url" data-url="${l(h)}">
                  ${P.copy} ${l(s("Sao chép link"))}
                </button>
                <button class="provenance-action-btn secondary" data-action="open-download-url" data-url="${l(h)}">
                  ${P.externalLink} ${l(s("Mở liên kết"))}
                </button>
              </div>
            `:`
              <span class="muted">${l(s("Chưa có thông tin link tải cho file này."))}</span>
            `}
            <div class="provenance-badges-grid">
              ${a.patientCode?`
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${l(s("Mã bệnh nhân"))}</span>
                  <span class="provenance-badge-value">${l(a.patientCode)}</span>
                </div>
              `:""}
              ${a.accessionNumber?`
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${l(s("Mã ca chụp (Accession No)"))}</span>
                  <span class="provenance-badge-value">${l(a.accessionNumber)}</span>
                </div>
              `:""}
              ${a.hospitalName?`
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${l(s("Bệnh viện / Cơ sở"))}</span>
                  <span class="provenance-badge-value">${l(a.hospitalName)}</span>
                </div>
              `:""}
              ${c.studyDate?`
                <div class="provenance-badge-item">
                  <span class="provenance-badge-label">${l(s("Ngày chụp"))}</span>
                  <span class="provenance-badge-value">${l(Mo(c.studyDate))}</span>
                </div>
              `:""}
            </div>
          </div>

          <!-- Demographics & Study Info -->
          <div class="info-section">
            <h4 class="info-section-title">${l(s("Thông tin ca chụp"))}</h4>
            <div class="info-grid">
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Tên bệnh nhân"))}</span>
                <span class="info-cell-value">${l(r.patientName||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Mã BN (ID)"))}</span>
                <span class="info-cell-value">${l(r.patientId||a.patientCode||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Năm sinh / Ngày sinh"))}</span>
                <span class="info-cell-value">${l(r.patientBirthDate?Mo(r.patientBirthDate):"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Giới tính"))}</span>
                <span class="info-cell-value">${l(r.patientSex||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Modality"))}</span>
                <span class="info-cell-value">${l(c.modality||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Mô tả ca"))}</span>
                <span class="info-cell-value">${l(c.studyDescription||"—")}</span>
              </div>
            </div>
          </div>

          <!-- File & Image Parameters -->
          <div class="info-section">
            <h4 class="info-section-title">${l(s("Thông số ảnh"))}</h4>
            <div class="info-grid">
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Đường dẫn file"))}</span>
                <span class="info-cell-value" title="${l(o.filePath||"")}">${l(o.filePath||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Kích thước file"))}</span>
                <span class="info-cell-value">${l(o.fileSizeFormatted||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Lát cắt hiện tại"))}</span>
                <span class="info-cell-value">${l(o.sliceIndexDisplay||"—")}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Độ phân giải"))}</span>
                <span class="info-cell-value">${d.columns&&d.rows?`${d.columns} × ${d.rows}`:"—"}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Pixel Spacing"))}</span>
                <span class="info-cell-value">${Array.isArray(d.pixelSpacing)?d.pixelSpacing.map(p=>Number(p).toFixed(3)).join(" × ")+" mm":"—"}</span>
              </div>
              <div class="info-cell">
                <span class="info-cell-label">${l(s("Khoảng cách lát cắt"))}</span>
                <span class="info-cell-value">${d.sliceSpacing?`${Number(d.sliceSpacing).toFixed(2)} mm`:"—"}</span>
              </div>
            </div>
          </div>

          <!-- DICOM Header Tags Table -->
          <div class="info-section">
            <h4 class="info-section-title">${l(s("Bảng thẻ DICOM Header"))} (<span data-field="dicom-tag-count">${u.length}</span>)</h4>
            <div class="dicom-tags-container">
              <div class="dicom-tag-filter-row">
                <input class="dicom-tag-search-input" id="dicom-tag-filter" type="text"
                  placeholder="${l(s("Tìm kiếm thẻ (Tag, Tên, Giá trị)..."))}"
                  value="${l(i.fileInfoTagFilter||"")}">
              </div>
              <div class="dicom-tags-table-wrap">
                <table class="dicom-tags-table">
                  <thead>
                    <tr>
                      <th style="width: 110px;">${l(s("Tag"))}</th>
                      <th style="width: 50px;">${l(s("VR"))}</th>
                      <th style="width: 220px;">${l(s("Tên thẻ"))}</th>
                      <th>${l(s("Giá trị"))}</th>
                    </tr>
                  </thead>
                  <tbody>${es(u)}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `}function Iu(){if(!i.showConcatModal)return"";const t=i.concatClips||[],e=t.filter(n=>n.selected).length;return`
    <div class="modal-overlay concat-modal-overlay">
      <div class="concat-modal-card">
        <div class="concat-modal-header">
          <h3>🔗 ${l(s("Ghép & Sắp xếp thứ tự clip phẫu thuật"))}</h3>
          <button class="icon-button" data-action="close-concat-modal" title="${l(s("Đóng"))}">✕</button>
        </div>
        <p style="margin:0; font-size:12px; color:var(--label-muted,#7890a2);">${l(s("Chọn các clip và sử dụng nút ▲/▼ để sắp xếp thứ tự ghép nối theo trình tự phẫu thuật:"))}</p>
        <div class="concat-clip-list">
          ${t.length===0?`<div class="empty-state" style="padding:20px;"><b>${l(s("Không tìm thấy clip video nào trong ca mổ"))}</b></div>`:t.map((n,o)=>`
            <div class="concat-clip-item ${n.selected?"":"disabled"}" data-clip-id="${l(`${n.seriesId}:${n.index??0}`)}">
              <input type="checkbox" class="concat-clip-checkbox" data-action="toggle-concat-clip" data-clip-idx="${o}" ${n.selected?"checked":""} style="cursor:pointer;" title="${l(s("Bật/tắt clip này"))}">
              <span class="concat-clip-order">#${o+1}</span>
              <div class="concat-clip-info">
                <div class="concat-clip-title">${l(n.name)}</div>
                <div class="concat-clip-meta">⏱ ${n.duration?_(n.duration):s("Không rõ thời lượng")}</div>
              </div>
              <div class="concat-clip-reorder">
                <button class="concat-reorder-btn" data-action="move-concat-clip-up" data-clip-idx="${o}" ${o===0?"disabled":""} title="${l(s("Di chuyển lên trước"))}">▲</button>
                <button class="concat-reorder-btn" data-action="move-concat-clip-down" data-clip-idx="${o}" ${o===t.length-1?"disabled":""} title="${l(s("Di chuyển xuống sau"))}">▼</button>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="concat-settings">
          <label>
            <span>${l(s("Độ phân giải:"))}</span>
            <select id="concat-resolution-select" data-field="concat-resolution">
              <option value="1080" ${i.concatTargetHeight===1080?"selected":""}>1080p (Full HD)</option>
              <option value="720" ${i.concatTargetHeight===720?"selected":""}>720p (HD)</option>
              <option value="480" ${i.concatTargetHeight===480?"selected":""}>480p (SD)</option>
            </select>
          </label>
          <label>
            <span>${l(s("Tốc độ khung hình:"))}</span>
            <select id="concat-fps-select" data-field="concat-fps">
              <option value="30" ${i.concatTargetFps===30?"selected":""}>30 fps (${l(s("Tiêu chuẩn"))})</option>
              <option value="60" ${i.concatTargetFps===60?"selected":""}>60 fps (${l(s("Mượt"))})</option>
            </select>
          </label>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
          <button class="control-btn" data-action="close-concat-modal">${l(s("Hủy"))}</button>
          <button class="control-btn primary" data-action="start-concat-video" ${e<2?"disabled":""}>
            🔗 ${l(C("Bắt đầu ghép ({} clip)",e))}
          </button>
        </div>
      </div>
    </div>
  `}function Tu(){if(!i.showExportModal)return"";const t=i.exportModalOptions||{jpgCount:0,dicomCount:0},e=i.exportModalFolder||"",n=i.exportModalPatientName||s("Bệnh nhân");return`
    <div class="export-modal-overlay">
      <div class="export-modal-dialog">
        <header class="export-modal-header">
          <div class="export-modal-title-wrap">
            <h3 class="export-modal-title">📦 ${l(s("Tùy chọn xuất hồ sơ"))}</h3>
            <span class="export-modal-subtitle">${l(n)}</span>
          </div>
          <button class="file-info-close-btn" data-action="close-export-modal" title="${l(s("Đóng"))}">✕</button>
        </header>
        <div class="export-modal-body">
          <p class="export-modal-desc">${l(s("Hồ sơ này có cả ảnh JPG và file gốc DICOM. Vui lòng chọn định dạng muốn xuất ra USB / thư mục:"))}</p>

          <div class="export-options-grid">
            <!-- Option 1: Web Viewer (JPG) -->
            <div class="export-option-card" data-action="confirm-export-choice" data-mode="viewer" data-folder="${l(e)}">
              <div class="export-card-icon">🌐</div>
              <div class="export-card-content">
                <div class="export-card-title">
                  <b>${l(s("Web PACS Viewer (Ảnh JPG)"))}</b>
                  <span class="export-card-badge recommended">${l(s("Khuyên dùng"))}</span>
                </div>
                <div class="export-card-desc">
                  ${l(s("Tạo trang web tự động chạy offline trên mọi trình duyệt. Có thanh cuộn lát cắt, đổi chuỗi xung, phóng to/thu nhỏ, tương phản W/L và so sánh 2 xung song song."))}
                </div>
                <div class="export-card-meta">
                  <span>🖼 ${t.jpgCount||0} ${l(s("ảnh JPG"))}</span>
                  <span>⚡ ${l(s("Nhẹ, mở tức thì trên mọi máy tính"))}</span>
                </div>
              </div>
            </div>

            <!-- Option 2: DICOM Originals -->
            <div class="export-option-card" data-action="confirm-export-choice" data-mode="dicom" data-folder="${l(e)}">
              <div class="export-card-icon">💾</div>
              <div class="export-card-content">
                <div class="export-card-title">
                  <b>${l(s("File gốc DICOM"))}</b>
                  <span class="export-card-badge">${l(s("Máy trạm PACS"))}</span>
                </div>
                <div class="export-card-desc">
                  ${l(s("Xuất toàn bộ file chụp gốc DICOM tiêu chuẩn y khoa chất lượng cao nhất, kèm file hướng dẫn mở bằng RadiAnt, Weasis, MicroDicom, Horos..."))}
                </div>
                <div class="export-card-meta">
                  <span>📁 ${t.dicomCount||0} ${l(s("file DICOM"))}</span>
                  <span>🔬 ${l(s("Dành cho bác sĩ CĐHA chuyên sâu"))}</span>
                </div>
              </div>
            </div>

            <!-- Option 3: Both -->
            <div class="export-option-card" data-action="confirm-export-choice" data-mode="both" data-folder="${l(e)}">
              <div class="export-card-icon">📦</div>
              <div class="export-card-content">
                <div class="export-card-title">
                  <b>${l(s("Xuất đầy đủ (Cả Web Viewer + DICOM)"))}</b>
                  <span class="export-card-badge">${l(s("Tất cả định dạng"))}</span>
                </div>
                <div class="export-card-desc">
                  ${l(s("Bao gồm cả Web PACS Viewer xem nhanh trên trình duyệt lẫn thư mục file gốc DICOM đầy đủ cho máy trạm."))}
                </div>
                <div class="export-card-meta">
                  <span>🌐 ${t.jpgCount||0} JPG + 📁 ${t.dicomCount||0} DICOM</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <footer class="export-modal-footer">
          <button class="tool-btn" data-action="close-export-modal">${l(s("Hủy bỏ"))}</button>
        </footer>
      </div>
    </div>
  `}function ns(){return i.showLogModal?`
    <div class="file-info-overlay log-modal-overlay">
      <div class="file-info-dialog log-modal-dialog">
        <header class="file-info-header">
          <div class="file-info-title-wrap">
            <h3 class="file-info-title log-modal-title">${l(s("Nhật ký phiên làm việc"))}</h3>
            ${i.logModalFileList&&i.logModalFileList.length>1?`
              <select class="log-file-select" data-field="log-file-select" aria-label="${l(s("Chọn file nhật ký"))}">
                ${i.logModalFileList.map(t=>`
                  <option value="${l(t)}" ${t===i.logModalFilename?"selected":""}>
                    ${l(t)}${t===i.logModalFileList[0]?" ("+l(s("Hiện tại"))+")":""}
                  </option>
                `).join("")}
              </select>
            `:i.logModalFilename?`<span class="file-info-subtitle">${l(i.logModalFilename)}</span>`:""}
          </div>
          <div class="log-modal-header-actions">
            <button type="button" class="soft-button" data-action="reveal-logs-folder">
              ${l(s("Thư mục"))}
            </button>
            <button type="button" class="soft-button" data-action="copy-modal-logs">
              ${l(s("Sao chép"))}
            </button>
            <button type="button" class="file-info-close-btn" data-action="close-log-modal">✕</button>
          </div>
        </header>
        <div class="file-info-body log-modal-body">
          <pre class="modal-log-pre ${i.logModalLoading?"loading":""}">${l(i.logModalContent||(i.logModalLoading?s("Đang tải nhật ký..."):s("Chưa có nhật ký phát sinh.")))}</pre>
        </div>
      </div>
    </div>
  `:""}async function Mu(t){const e=t.target,n=e?.value;if(!n)return;const a=(e.closest(".log-modal-dialog")||document.querySelector(".log-modal-dialog")||m)?.querySelector(".modal-log-pre");a&&a.classList.add("loading");try{const r=await N(`/api/logs/content?file=${encodeURIComponent(n)}`);i.logModalContent=r?.content||"",i.logModalFilename=r?.filename||n,i.logModalFolder=r?.folder||"",r?.fileList&&(i.logModalFileList=r.fileList),a&&(a.textContent=i.logModalContent||s("Chưa có nhật ký phát sinh."),a.scrollTop=a.scrollHeight)}catch(r){const c=s("Không thể đọc nhật ký: ")+(r?.message||"");i.logModalContent=c,a&&(a.textContent=c)}finally{a&&a.classList.remove("loading")}}function os(t){t&&(t.addEventListener("click",e=>{e.target===t&&(i.showLogModal=!1,t.remove())}),t.querySelector("[data-field='log-file-select']")?.addEventListener("change",Mu))}function Lo(t=s("Đã sao chép vào clipboard!")){const e=document.querySelector(".copy-toast");e&&e.remove();const n=document.createElement("div");n.className="copy-toast",n.textContent=t,document.body.appendChild(n),setTimeout(()=>{n.remove()},2500)}async function ae(t,e){if(t)try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(t);else{const n=document.createElement("textarea");n.value=t,n.style.position="fixed",n.style.opacity="0",document.body.appendChild(n),n.focus(),n.select(),document.execCommand("copy"),n.remove()}Lo(e||s("Đã sao chép vào clipboard!"))}catch{Lo(s("Không thể sao chép"))}}async function Pu(){if(i.selectedId){i.showFileInfoModal=!0,i.fileInfoLoading=!0,i.fileInfoError="",i.fileInfoTagFilter="",E();try{const t=qc(),e=await N(`/api/series/${i.selectedId}/file-info?index=${t}`);i.fileInfoData=e,i.fileInfoLoading=!1}catch(t){i.fileInfoLoading=!1,i.fileInfoError=t.message||s("Không tải được thông tin file")}E()}}function is(){i.showFileInfoModal=!1,i.fileInfoData=null,i.fileInfoError="",E()}async function Eo(t,e=0){if(!t)return;try{const o=await N(`/api/series/${t.id}/text?index=${Number(e)||0}`);i.textDoc={seriesId:t.id,...o}}catch(o){i.textDoc={seriesId:t.id,index:Number(e)||0,name:t.name||"",language:"text",text:ft(o)}}const n=A()?.querySelector(".text-viewer");n&&(n.outerHTML=Mr(t),as(A()),x(s("Sẵn sàng.")))}function as(t){if(!t)return;const e=q();if(!e)return;const n=Number(e.sliceCount)||1,o=fi(e)?.index||0;t.querySelector("[data-action='text-prev']")?.addEventListener("click",()=>{o>0&&Eo(e,o-1)}),t.querySelector("[data-action='text-next']")?.addEventListener("click",()=>{o<n-1&&Eo(e,o+1)}),t.querySelector("[data-action='text-copy']")?.addEventListener("click",()=>{i.textDoc?.text&&ae(i.textDoc.text)})}const Oe=new Map;function Nu(t){let e=Oe.get(t);return e||(e=je(Gs(t)).then(n=>{const o=URL.createObjectURL(n);return se.set(t,o),o}),e.catch(()=>{Oe.delete(t),se.delete(t)}),Oe.set(t,e)),e}function Du(){const t=new Set(i.archive.series.map(e=>e.id));for(const[e,n]of Oe){if(t.has(e))continue;Oe.delete(e);const o=se.get(e);o&&URL.revokeObjectURL(o),se.delete(e),n.then(a=>URL.revokeObjectURL(a)).catch(()=>{})}for(const e of m.querySelectorAll(".series-card-thumb[data-thumb-id]")){const n=e.dataset.thumbId,o=se.get(n);if(o){e.getAttribute("src")!==o&&(e.src=o);continue}Nu(n).then(a=>{e.isConnected&&e.getAttribute("src")!==a&&(e.src=a)}).catch(()=>{e.remove()})}}function rs(){return i.studies.length?i.studies.map((t,e)=>`
    <label class="study-item">
      <input type="checkbox" data-study-index="${e}"
        ${t.selected&&!i.patient?.nameConflict?"checked":""}
        ${i.patient?.nameConflict?"disabled":""}>
      <span><b>${l(t.modality)} · ${l(t.date)}</b>
        <small>${l(t.desc||t.study_uid)}</small>
        <em class="study-state ${l(t.local_status||"new")}">${l(s({downloaded:"Đã tải",incomplete:"Tải chưa hoàn tất",new:"Phim mới"}[t.local_status]||"Phim mới"))}</em></span>
    </label>`).join(""):`<span class="muted">${l(s("Chưa tìm ca chụp."))}</span>`}function ss(){return i.showManualInfo?`
    <div class="manual-info-panel">
      <label>${l(s("Tên bệnh nhân"))} <input id="manual-patient-name" type="text" value="${l(i.manualPatientName)}" autocomplete="off"></label>
      <label>${l(s("Mã BN (ID)"))} <input id="manual-patient-id" type="text" value="${l(i.manualPatientId)}" autocomplete="off"></label>
      <label>${l(s("Năm sinh / Ngày sinh"))} <input id="manual-patient-dob" type="text" value="${l(i.manualPatientDob)}" autocomplete="off" placeholder="DD/MM/YYYY hoặc YYYY"></label>
    </div>
  `:""}function ls(){return i.seriesInventory.flatMap(t=>t.attachments||[])}function Lu(){const t=ls();return t.length?`
    <div class="attachment-notification-card">
      <div class="attachment-header">
        <div class="attachment-title-wrap">
          <span class="attachment-icon">📎</span>
          <div>
            <strong>${l(s("Phát hiện tài liệu & Báo cáo đính kèm"))} (${t.length})</strong>
            <small>${l(s("Các tệp này sẽ được tải riêng vào thư mục DOCUMENTS"))}</small>
          </div>
        </div>
        <label class="attachment-toggle-label">
          <input type="checkbox" id="attachment-download-toggle" ${i.downloadAttachments?"checked":""}>
          <span>${l(s("Tải kèm"))}</span>
        </label>
      </div>
      <div class="attachment-file-list">
        ${t.map(e=>`
          <div class="attachment-item-chip" title="${l(e.url||"")}">
            <span class="attachment-chip-icon">${e.type==="pdf"?"📄":e.type==="text"?"📝":"📁"}</span>
            <span class="attachment-chip-name">${l(e.name||s("Tài liệu"))}</span>
            <span class="attachment-chip-badge">${l((e.type||"DOC").toUpperCase())}</span>
          </div>
        `).join("")}
      </div>
    </div>`:""}function cs(){const t=m.querySelector("#manual-info-container");t&&(t.innerHTML=ss(),ds())}function ds(){m.querySelector("#manual-patient-name")?.addEventListener("input",t=>{i.manualPatientName=t.target.value}),m.querySelector("#manual-patient-id")?.addEventListener("input",t=>{i.manualPatientId=t.target.value}),m.querySelector("#manual-patient-dob")?.addEventListener("input",t=>{i.manualPatientDob=t.target.value})}function no(t){const e=!!String(t||"").trim();if(i.showManualInfo!==e){i.showManualInfo=e;const n=m.querySelector("#manual-info-toggle");n&&(n.checked=i.showManualInfo),cs()}}function us(){const t=Lu(),e=`
    <div class="series-picker-actions">
      <button data-action="discover-series">${l(s("Quét danh sách series"))}</button>
      ${i.seriesInventory.length?`
        <button data-action="select-series-all">${l(s("Chọn tất cả series"))}</button>
        <button data-action="deselect-series-all">${l(s("Bỏ chọn tất cả series"))}</button>`:""}
    </div>`;return i.seriesInventory.length?`${t}${e}${i.seriesInventory.map((n,o)=>`
    <section class="series-choice-group">
      <b>${l([n.studyDate,n.studyDescription].filter(Boolean).join(" · ")||s("Link viewer"))}</b>
      ${(n.series||[]).map((a,r)=>`
        <label class="series-choice">
          <input type="checkbox" data-series-group="${o}" data-series-choice="${r}"
            ${a.selected===!1?"":"checked"}>
          <span>
            ${a.sequenceHint?`<strong>${l(a.sequenceHint)}</strong>`:""}
            <b>${l(a.description||a.id)}</b>
            <small>${l([a.number?`#${a.number}`:"",a.imageCount?`${a.imageCount} ${s("ảnh")}`:""].filter(Boolean).join(" · "))}</small>
          </span>
        </label>`).join("")}
    </section>`).join("")}`:`${e}<small class="series-picker-hint">${l(s("Bỏ chế độ tải tất cả, sau đó quét để chọn T1, T2, FLAIR hoặc series cụ thể."))}</small>`}function hs(){const t=i.patient;if(!t)return"";if(t.nameConflict)return`<div class="patient-alert danger"><b>${l(s("Không tự động gộp bệnh nhân"))}</b>
      <span>${l(C("Mã {} đã lưu tên “{}”, nhưng RIS trả “{}”. Hãy kiểm tra lại.",t.patientId,t.storedPatientName,t.patientName))}</span></div>`;const e=[t.patientId,t.patientName,t.hospitalName].filter(Boolean).map(l).join(" · "),n=t.exists?C("Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất",t.downloadedStudies,t.newStudies,t.incompleteStudies):C("{} ca chưa có trong kho; app sẽ tạo một folder bệnh nhân.",t.newStudies),o=t.legacyStudiesDetected?` · ${C("Đã nhận diện {} ca từ folder Classic cũ",t.legacyStudiesDetected)}`:"";return`<div class="patient-alert ${t.exists?"existing":"new"}">
    <b>${e}</b><span>${n}${o}</span>
    ${t.folder?`<small>${l(t.folder)}</small>`:""}</div>`}const ra=new WeakSet;function pe(t){if(t)for(const e of t.querySelectorAll("[data-action]"))hu.has(e.dataset.action)||ra.has(e)||(ra.add(e),e.addEventListener("click",n=>{n.stopPropagation(),F(e.dataset.action,e)}),e.getAttribute("role")==="button"&&e.addEventListener("keydown",n=>{n.key!=="Enter"&&n.key!==" "||(n.preventDefault(),n.stopPropagation(),F(e.dataset.action,e))}))}function Eu(){if(!ui())return;pe(m);const t=m.querySelector(".file-info-overlay");t?.addEventListener("click",a=>{a.target===t&&is()});const e=m.querySelector(".concat-modal-overlay");e?.addEventListener("click",a=>{a.target===e&&(i.showConcatModal=!1,E())});const n=m.querySelector(".export-modal-overlay");n?.addEventListener("click",a=>{a.target===n&&(i.showExportModal=!1,E())});const o=m.querySelector(".log-modal-overlay");os(o),m.querySelector("[data-field='concat-resolution']")?.addEventListener("change",a=>{i.concatTargetHeight=Number(a.target.value)||1080}),m.querySelector("[data-field='concat-fps']")?.addEventListener("change",a=>{i.concatTargetFps=Number(a.target.value)||30}),m.querySelector("#dicom-tag-filter")?.addEventListener("input",a=>{i.fileInfoTagFilter=a.target.value;const r=ts(),c=m.querySelector(".dicom-tags-table tbody");c&&(c.innerHTML=es(r));const d=m.querySelector("[data-field='dicom-tag-count']");d&&(d.textContent=String(r.length))}),xu(),m.querySelector(".app-header [data-action='toggle-download']")?.setAttribute("aria-expanded",i.downloadOpen?"true":"false"),m.querySelector("[data-field='series']")?.addEventListener("change",a=>{i.selectedId=a.target.value;const r=q();(i.mode==="mpr"||i.mode==="volume3d")&&!r?.mprReady&&(i.mode="single",i.tool="window"),E(),Z()}),m.querySelector("[data-field='history']")?.addEventListener("change",a=>{const r=i.history[Number(a.target.value)];a.target.selectedIndex=0,r&&pn(r)}),m.querySelector("[data-field='window-preset']")?.addEventListener("change",async a=>{i.windowPreset=a.target.value,await Ge(i.windowPreset),window.__viewerDiagnostics=yt()}),eh(),m.querySelectorAll(".winbar-tab").forEach(a=>{a.addEventListener("click",r=>{if(r.target.closest(".winbar-tab-close"))return;const c=a.dataset.tabId;c&&Pi(c)})}),m.querySelectorAll(".winbar-tab-close").forEach(a=>{a.addEventListener("click",r=>{r.stopPropagation();const c=a.dataset.tabId;c&&Uu(c)})}),$i(m),as(m),Jr(m),m.querySelector("[data-field='worklist-search']")?.addEventListener("input",a=>{i.worklistSearch=a.target.value,Kt()}),m.querySelectorAll("[data-series-id]").forEach(a=>{a.addEventListener("click",async()=>{const r=a.dataset.seriesId,c=i.archive.series.find(y=>y.id===r);if(!c)return;if(a.classList.contains("tl-open")||a.closest(".tl-item")){const y=m.querySelector(`.series-card[data-series-id="${r}"]`);if(y){const S=y.dataset.dateKey;((S?m.querySelector(`.series-group-badge[data-date-key="${S}"]`):null)||y).scrollIntoView({behavior:"smooth",block:"start"})}return}if(k.editing){k.editing=!1,i.selectedId=r,E(),await Z();return}if(Xn()){const y=pc();if(!y)return;y.paneIndex===0?i.selectedId=r:i.compareIds[y.paneIndex-1]=r,await tr(c),Yi(),i.windowPreset!=="full"&&await Ge(i.windowPreset),window.__viewerDiagnostics=yt(),i.scrollSync=oi().enabled;const S=m.querySelector("[data-action='scroll-sync']");S&&(S.classList.toggle("active",i.scrollSync),S.setAttribute("aria-pressed",i.scrollSync?"true":"false"));return}const d=q(),u=X(d),h=X(c);i.selectedId=r;const p=q();let f=!1;if((i.mode==="mpr"||i.mode==="volume3d")&&!p?.mprReady?(i.mode="single",i.tool="window",f=!0):u!==h&&(f=!0),f)E(),Z();else{Yi();const y=m.querySelector("[data-field='series']");y&&(y.value=r);const S=m.querySelector("[data-field='window-preset']");S&&(S.innerHTML=So(p).map($=>`<option value="${$.id}" ${i.windowPreset===$.id?"selected":""}>${l($.detail?`${s($.label)} · ${$.detail}`:s($.label))}</option>`).join(""),S.setAttribute("title",l(s(kr(p)))));const b=Ba(p),g=m.querySelector(".safety-notice");if(g){g.hidden=!b,g.className=`safety-notice ${b?.level||""}`;const $=g.querySelector("span");$&&($.textContent=b?s(b.text):"")}if(h!=="dicom"){const $=m.querySelector("#workspace");$&&($.innerHTML=Fr(p),ce())}else Z()}})}),m.querySelectorAll(".tl-name-input").forEach(a=>{a.addEventListener("keydown",r=>{r.key==="Enter"?(r.preventDefault(),a.closest(".tl-item")?.querySelector("[data-action='save-timeline-label']")?.click()):r.key==="Escape"&&(r.preventDefault(),a.closest(".tl-item")?.querySelector("[data-action='cancel-timeline-label']")?.click())})}),m.querySelectorAll("[data-study-index]").forEach(a=>{a.addEventListener("change",()=>ms(a))}),m.querySelector("#download-all-files")?.addEventListener("change",a=>{i.downloadAllFiles=a.target.checked,m.querySelector("#series-picker")?.classList.toggle("hidden",i.downloadAllFiles),wt()}),m.querySelector("#direct-url")?.addEventListener("input",a=>{i.lastDirectUrl=a.target.value,no(a.target.value),i.seriesInventory.some(r=>r.studyUid==="direct")&&(i.seriesInventory=[],delete i.rememberedSeriesSelections.direct,vt())}),m.querySelectorAll("input[name='hospital']").forEach(a=>{a.addEventListener("change",()=>{i.seriesInventory=[],i.rememberedSeriesSelections={},i.seriesGroupCache={},vt(),wt()})}),m.querySelector("#manual-info-toggle")?.addEventListener("change",a=>{i.showManualInfo=a.target.checked,cs()}),ds(),ps(),wt()}function ps(){m.querySelector("#attachment-download-toggle")?.addEventListener("change",t=>{i.downloadAttachments=t.target.checked}),m.querySelectorAll("[data-series-group][data-series-choice]").forEach(t=>{t.addEventListener("change",()=>{const e=i.seriesInventory[Number(t.dataset.seriesGroup)]?.series?.[Number(t.dataset.seriesChoice)];e&&(e.selected=t.checked),i.rememberedSeriesSelections=bn(i.seriesInventory,i.rememberedSeriesSelections),wt()})})}function vt(){const t=m.querySelector("#series-picker");t&&(t.classList.toggle("hidden",i.downloadAllFiles),t.innerHTML=us(),t.querySelectorAll("[data-action]").forEach(e=>{e.addEventListener("click",()=>F(e.dataset.action))}),ps())}function fo(){return Vo(i.seriesInventory)}function Si(t){return String(t?.study_uid||"").trim()}function Ou(t){return[t?.modality,t?.date].filter(Boolean).join(" · ")||Si(t)}function fs(t){(t||[]).forEach(e=>{const n=String(e.studyUid||"").trim();n&&n!=="direct"&&(i.seriesGroupCache[n]=e)})}function Au(){i.rememberedSeriesSelections=bn(i.seriesInventory,i.rememberedSeriesSelections),fs(i.seriesInventory);const t=i.seriesInventory.filter(n=>n.studyUid==="direct"),e=he(i.studies).map(n=>i.seriesGroupCache[Si(n)]).filter(Boolean);i.seriesInventory=Ea([...t,...e],i.rememberedSeriesSelections)}function ms(t){const e=i.studies[Number(t.dataset.studyIndex)];e&&(e.selected=t.checked,Au(),vt(),wt())}function Ru(){if(i.patient?.nameConflict)return s("Tên bệnh nhân không khớp; app đã chặn tự động gộp.");if(!i.studies.length)return s("Chưa tìm ca chụp.");if(!he(i.studies).length)return s("Hãy tích ít nhất một ngày chụp để tải.");if(i.downloadAllFiles||Ll(i.studies,i.seriesInventory))return"";const t=Oa(i.studies,i.seriesInventory);if(t.length>2)return C("Còn {} ca đang tích chưa chọn được series nào.",t.length);const e=t.map(Ou).join(", ");return t.every(n=>!i.seriesGroupCache[Si(n)])?C("Chưa quét series cho ca {}; hãy bấm Quét danh sách series.",e):C("Ca {} chưa tích series nào.",e)}function wt(){const t=Ru(),e=m.querySelector("[data-action='download-selected']");e&&(e.disabled=!!t);const n=m.querySelector(".download-hint");if(n){const o=!!t&&i.studies.length>0;n.textContent=o?t:"",n.hidden=!o}}function Ci(t,e){const n=a=>String(a||"").replace(/[\\/]+$/,"").replace(/\\/g,"/").toLowerCase(),o=n(t);return!!o&&o===n(e)}async function pn(t){const e=t.folder||"",n=i.tabs.find(c=>Ci(c.folder,e));if(n){await Pi(n.id);return}i.lastDirectUrl=t.url||"";const o=A()?.querySelector("#direct-url");o&&(o.value=i.lastDirectUrl),no(i.lastDirectUrl);const a=i.tabs.find(c=>c.id===i.activeTabId);a&&Ti(a),Mi(),i.editingPatientInfo=!1,i.patientEditDraft=null;const r=Ni({folder:e,loading:!0,patientName:e.split(/[\\/]/).filter(Boolean).pop()||"",status:s("Đang mở hồ sơ…")});i.tabs.push(r),i.activeTabId=r.id,i.archive={root:"",series:[]},i.selectedId="",i.compareIds=["",""],Ae(""),Ne(),E(),x(s("Đang mở hồ sơ…"));try{const c=await N("/api/sessions/create",{method:"POST",body:JSON.stringify({path:e})});if(!On(r.id,c.archive,c.sessionId||"",e)){c.sessionId&&N("/api/sessions/close",{method:"POST",body:JSON.stringify({sessionId:c.sessionId})}).catch(()=>{});return}Ce(),i.activeTabId===r.id&&x(s("Sẵn sàng."))}catch(c){const d=ft(c),u=i.tabs.find(h=>h.id===r.id);u&&(u.loading=!1,u.loadError=d,u.status=d),i.activeTabId===r.id&&x(d,!0),E()}}async function Ce(){try{const t=await N("/api/history");i.history=Array.isArray(t?.history)?t.history:[],(m?.querySelectorAll("[data-field='history']")||[]).forEach(n=>{n.innerHTML=gd(),n.disabled=!i.history.length})}catch{}}function Bu(){const t=A(),e=t?.querySelector("#photo-editor-canvas"),n=t?.querySelector("#photo-editor-img, #surgery-video-player"),o=t?.querySelector("#photo-annotation-canvas");if(!e||!n||!o){ci();return}ld({wrap:e,img:n,canvas:o,scroller:t.querySelector("#photo-editor-stage"),onZoomAt:(a,r,c)=>ys(a,r,c),shapeExtras:()=>X(q())==="video"?gs():{},getTime:()=>{const a=A()?.querySelector("#surgery-video-player");return a?a.currentTime:null},getLayer:()=>Ft(q()),getStyle:()=>i.photoStyle,getTool:()=>i.photoTool,onStatus:a=>x(a),onChange:()=>mt(),onToolDone:a=>{(a==="text"||a==="marker")&&En("select")}}),Ii(),mt()}function gs(){if(i.videoShapeTiming!=="span")return{};const t=At();return t?{startS:t.start,endS:t.end}:{}}function En(t){const e=Ut(t);i.photoTool=e.id;const n=K();e.id!=="crop"&&n?.clearCrop(),e.id!=="select"&&n?.select(null),mt(),x(s(e.label))}function Ii(){const t=A()?.querySelector("#photo-editor-img");if(!t)return;const e=Number(i.photoZoom)||0;e>0&&t.naturalWidth?(t.style.maxWidth="none",t.style.maxHeight="none",t.style.width=`${Math.round(t.naturalWidth*e)}px`,t.style.height="auto"):(t.style.maxWidth="100%",t.style.maxHeight="100%",t.style.width="",t.style.height="");const n=A()?.querySelector("#photo-zoom-label");n&&(n.textContent=e?`${Math.round(e*100)}%`:s("Vừa khung")),K()?.repaint()}function ys(t,e,n){const o=A(),a=o?.querySelector("#photo-editor-stage"),r=o?.querySelector("#photo-editor-img");if(!a||!r?.naturalWidth)return;const c=r.getBoundingClientRect();if(!c.width)return;const d=(e-c.left)/c.width,u=(n-c.top)/c.height,h=i.photoZoom||c.width/r.naturalWidth,p=Math.max(.05,Math.min(8,h*t));if(p===i.photoZoom)return;i.photoZoom=p,Ii();const f=r.getBoundingClientRect();a.scrollLeft+=f.left+d*f.width-e,a.scrollTop+=f.top+u*f.height-n,K()?.repaint()}function sa(t){const e=A()?.querySelector("#photo-editor-stage");if(!e)return;const n=e.getBoundingClientRect();ys(t,n.left+n.width/2,n.top+n.height/2)}function mt(){const t=A();if(!t)return;const e=q();Ft(e);const n=K(),o=n?.selectedShape()||null,a=ge(e);t.querySelectorAll("[data-action='photo-pick-tool']").forEach(T=>{const V=T.dataset.tool===i.photoTool;T.classList.toggle("active",V),T.setAttribute("aria-pressed",V?"true":"false")});const r=o||i.photoStyle,c=String(r.color||"").toLowerCase();t.querySelectorAll("[data-action='photo-pick-color']").forEach(T=>{T.classList.toggle("active",T.dataset.color===c)}),rn(t,"[data-field='photo-color']",r.color),rn(t,"[data-field='photo-stroke']",r.strokeWidth),rn(t,"[data-field='photo-font']",r.fontSize??i.photoStyle.fontSize),rn(t,"[data-field='photo-opacity']",Math.round((r.opacity??1)*100));const d=t.querySelector("[data-field='photo-fill']");d&&(d.checked=!!r.filled),Gt(t,"#photo-stroke-value",r.strokeWidth),Gt(t,"#photo-font-value",r.fontSize??i.photoStyle.fontSize),Gt(t,"#photo-opacity-value",`${Math.round((r.opacity??1)*100)}%`);const u=["text","marker"].includes(i.photoTool)||["text","marker"].includes(o?.kind),h=t.querySelector("#photo-font-field");h&&h.classList.toggle("muted",!u),Gt(t,"#photo-status-hint",o?C("Đang chọn: {}",s(Oo(o.kind))):s(Ut(i.photoTool).label));const p=At();if(t.querySelectorAll("[data-action='video-timing']").forEach(T=>{const V=T.dataset.timing,J=V!=="span"||!!p;T.disabled=!J,T.classList.toggle("active",i.videoShapeTiming===V&&J),V==="span"&&(T.textContent=p?`${_(p.start)}→${_(p.end)}`:s("Chưa chọn đoạn"))}),o&&X(e)==="video"){const T=Number.isFinite(o.startS)&&Number.isFinite(o.endS)?`${_(o.startS)}→${_(o.endS)}`:s("Toàn bộ");Gt(t,"#photo-status-hint",`${C("Đang chọn: {}",s(Oo(o.kind)))} · ${T}`)}const f=t.querySelector("#photo-apply-crop");f&&(f.hidden=i.photoTool!=="crop",f.disabled=!n?.cropRect());const y=t.querySelector("#photo-delete-shape");y&&(y.disabled=!o);const S=t.querySelector("[data-action='photo-clear-shapes']");S&&(S.disabled=!a);const b=t.querySelector("#photo-apply-shapes");if(b){const T=X(e)==="video"?s("Áp dụng lên video"):s("Áp dụng lên ảnh");b.disabled=!a,b.textContent=a?`${T} (${a})`:T}Gt(t,"#photo-status-count",a?C("{} nét chưa áp dụng",a):s("Chưa vẽ gì"));const g=t.querySelector("#photo-editor-img, #surgery-video-player"),$=g?.naturalWidth||g?.videoWidth,O=g?.naturalHeight||g?.videoHeight;$&&O&&Gt(t,"#photo-status-size",`${$}×${O} px`),Rr(e)}function rn(t,e,n){const o=t.querySelector(e);o&&n!==void 0&&n!==null&&(o.value=String(n))}function Gt(t,e,n){const o=t.querySelector(e);o&&(o.textContent=String(n))}function Oo(t){const e=zn.find(n=>n.shape===t);return e?e.label:t}function te(t){Object.assign(i.photoStyle,t),K()?.restyleSelected(t),mt()}async function fn(t,{silent:e=!1}={}){const n=await Hu(t);if(!n)throw new Error(s("Không tìm thấy đường dẫn ảnh gốc."));const o=Ft(t),a=gr(o?.shapes||[]);if(!a.length)return n;e||x(C("Đang vẽ {} chi tiết lên ảnh...",a.length));const r=await N("/api/media/photo/shapes",{method:"POST",body:JSON.stringify({path:n,shapes:a})});return i.photoWorkingPath=r.outputPath,Mt(t,r),o.shapes=[],o.past=[],o.future=[],K()?.select(null),mi(A()?.querySelector("#photo-editor-img"),r.url),mt(),r.outputPath}function qu(){const e=A()?.querySelector("#photo-props");if(!e)return;const n=(o,a)=>{const r=e.querySelector(o);r&&(r.oninput=()=>a(r))};n("[data-field='photo-color']",o=>te({color:o.value})),n("[data-field='photo-stroke']",o=>te({strokeWidth:Number(o.value)||1})),n("[data-field='photo-font']",o=>te({fontSize:Number(o.value)||28})),n("[data-field='photo-opacity']",o=>te({opacity:Math.max(.05,(Number(o.value)||100)/100)})),n("[data-field='photo-fill']",o=>te({filled:o.checked}))}async function la(t){const e=q();if(!e)return;const n=await fn(e,{silent:!0});x(s("Đang xoay ảnh 90°..."));const o=await N("/api/media/photo/rotate",{method:"POST",body:JSON.stringify({path:n,degrees:t})});i.photoWorkingPath=o.outputPath,Mt(e,o),mi(A()?.querySelector("#photo-editor-img"),o.url),x(s("Đã xoay ảnh 90° thành công."))}function ce(){pe(A()?.querySelector("#workspace")||A()),Cd(),qr(),Bu(),qu();const t=m.querySelector("#surgery-video-player");if(t){const e=m.querySelector("#surgery-video-scrubber"),n=m.querySelector("#video-speed-select");t.ontimeupdate=()=>Dn(t),t.onerror=()=>{const r=(Yn(i.videoWorkingPath)||String(q()?.name||"")).toLowerCase(),c=r.includes(".")?r.slice(r.lastIndexOf(".")):"";x(C("Trình duyệt không phát được định dạng {} — bấm “Tối ưu MP4” để chuyển đổi rồi xem.",c||"này"),!0)},t.onloadedmetadata=()=>{i.videoDuration=Number(t.duration)||0,dn(),oe(q()),i._pendingVideoSeek!==void 0&&i._pendingVideoSeek!==null&&(t.currentTime=i._pendingVideoSeek,i._pendingVideoSeek=null),Dn(t),K()?.repaint()},t.readyState>=1&&t.onloadedmetadata(),e&&(e.oninput=()=>{t.duration&&(t.currentTime=Number(e.value)/100*t.duration)}),n&&(n.onchange=()=>{t.playbackRate=Number(n.value)||1}),typeof window<"u"&&!window._videoShortcutsBound&&(window._videoShortcutsBound=!0,window.addEventListener("keydown",r=>{const c=r.target;c&&(c.tagName==="INPUT"||c.tagName==="TEXTAREA"||c.isContentEditable)||!(typeof m<"u"&&m?m:typeof document<"u"?document:null)?.querySelector("#surgery-video-player")||(r.key==="m"||r.key==="M"?(r.preventDefault(),F("add-video-bookmark")):r.key==="i"||r.key==="I"?(r.preventDefault(),F("video-set-in")):r.key==="o"||r.key==="O"?(r.preventDefault(),F("video-set-out")):r.key===" "&&!r.repeat&&(r.preventDefault(),F("video-play-pause")))}));const o=(m||document).querySelector("#video-meta-badge"),a=q();o&&a&&!a._videoInfoLoaded&&Wt(a).then(r=>{if(r)return N("/api/media/video/info",{method:"POST",body:JSON.stringify({path:r})}).then(c=>{const d=c?.info;if(d){a._videoInfoLoaded=!0;const u=d.width&&d.height?`${d.width}x${d.height}`:"",h=d.fps?`${Math.round(d.fps)}fps`:"",p=d.codec||"",f=d.durationSeconds?_(d.durationSeconds):"",y=[u,h,p,f].filter(Boolean).join(" · ");y&&(o.textContent=`🎬 ${a.patientName||"Video Phẫu Thuật"} (${y})`)}})}).catch(()=>null)}}async function Fu(){const t=[];for(const e of i.archive?.series||[]){if(X(e)!=="video")continue;const o=((await N(`/api/series/${e.id}/file-paths`).catch(()=>null))?.images||[]).filter(Boolean);o.forEach((a,r)=>{t.push({seriesId:e.id,index:r,path:a,name:String(a).split(/[\\/]/).pop()||e.description||e.name,duration:o.length===1&&e.durationSeconds||0,selected:!0})})}return t}async function Wt(t){if(!t)return null;if(i.videoWorkingPath&&(!i.selectedId||t.id===i.selectedId))return i.videoWorkingPath;const n=(await N(`/api/series/${t.id}/file-paths`).catch(()=>null))?.images||[];return n[ot(t)]||n[0]||null}async function Hu(t){if(!t)return null;if(i.photoWorkingPath&&(!i.selectedId||t.id===i.selectedId))return i.photoWorkingPath;const n=(await N(`/api/series/${t.id}/file-paths`).catch(()=>null))?.images||[];return n[ot(t)]||n[0]||null}async function ca(t,e="viewer"){if(t)if(window.pywebview?.api?.choose_export_folder){const n=await window.pywebview.api.choose_export_folder(t,e);n&&(i.bootstrap.job=n,x(s("Đang xuất hồ sơ sang thư mục đã chọn…")),gt())}else{const n=window.prompt(s("Nhập đường dẫn thư mục xuất:"));if(!n||!n.trim())return;const o=await N("/api/worklist/export",{method:"POST",body:JSON.stringify({folder:t,destination:n.trim(),mode:e})});o&&(i.bootstrap.job=o,x(s("Đang xuất hồ sơ sang thư mục đã chọn…")),gt())}}async function _u(){const t=m?.querySelector("[data-field='patient-edit-form']");if(!t)return!1;const e=vi(t),n=i.activeTabId,o=i.tabs.find(d=>d.id===n),a=o?.archive||i.archive,r=a?.patient?.patientId||"",c=a?.root||"";i.patientEditDraft={...e},o&&(o.patientEditDraft={...e});try{const d=await N("/api/patient/update",{method:"POST",body:JSON.stringify({info:e,archiveRoot:c,patientId:r})});if(d?.patient){a.patient=d.patient,o&&(o.archive=a,o.patientName=d.patient.patientName||"",o.patientId=d.patient.patientId||"",o.editingPatientInfo=!1,o.patientEditDraft=null);const u=p=>String(p||"").replace(/[\\/]+$/,"").toLowerCase();let h=i.worklistPatients.find(p=>c&&u(p.folder)===u(c));if(!h&&r){const p=i.worklistPatients.filter(f=>f.patientId===r);p.length===1&&([h]=p)}if(h)for(const p of["patientName","patientId","gender","birthYear","hospital"])h[p]=d.patient[p]||""}return i.activeTabId===n?(i.archive=a,!0):(o&&(o.status=s("Đã lưu thông tin bệnh nhân.")),!1)}catch(d){const u=ft(d);return i.activeTabId===n?(k.error=u,x(`${s("Lỗi:")} ${u}`,!0)):o&&(o.status=`${s("Lỗi:")} ${u}`),!1}}async function Gu(t){try{const e=await N("/api/patient/clinical",{method:"POST",body:JSON.stringify({record:t,archiveRoot:i.archive?.root||"",patientId:i.archive?.patient?.patientId||""})});return k.record=e?.record||Rt(),k.stage=e?.stage||Ue(),k.assessment=Array.isArray(e?.assessment)?e.assessment:[],k.label=String(e?.label||""),lt({silent:!0}),!0}catch(e){return k.error=ft(e),!1}}async function F(t,e=null){try{if(t==="cancel-login"){i.showLoginCard=!1,i.loginCardAction=null,E();return}if(t==="retry-login"){const n=m.querySelector("#custom-ris-user")?.value.trim(),o=m.querySelector("#custom-ris-pass")?.value;if(!n)throw new Error("Chưa nhập tài khoản dự phòng.");const a=i.loginCardAction;return i.showLoginCard=!1,i.loginCardAction=null,E(),i.customRisUser=n,i.customRisPass=o,F(a)}if(t==="window-minimize"){await ie()?.window_minimize?.();return}if(t==="window-maximize"){const n=ie()?.window_toggle_maximize;if(!n)return;i.windowMaximized=!!await n(),Do();return}if(t==="window-close"){const n=ie()?.window_close;n?await n():window.close();return}if(t==="window-fullscreen"){const n=ie()?.window_toggle_fullscreen;if(!n)return;i.zenMode=!!await n(),Do();return}if(t==="toggle-download"){i.downloadOpen=!i.downloadOpen,m.querySelector(".app-shell")?.classList.toggle("download-collapsed",!i.downloadOpen);const n=m.querySelector(".app-header [data-action='toggle-download']");if(n){n.classList.toggle("active",i.downloadOpen),n.setAttribute("aria-expanded",i.downloadOpen?"true":"false"),n.title=s(i.downloadOpen?"Thu gọn khu tải phim":"Mở khu tải phim");const a=n.querySelector("span");a&&(a.textContent=i.downloadOpen?"⇤":"⇥")}const o=m.querySelector(".download-expand-trigger");o&&(o.hidden=i.downloadOpen);return}if(t==="toggle-patient-rail"){i.patientRailCollapsed=!i.patientRailCollapsed,ud(i.patientRailCollapsed);const n=m.querySelector(".viewer-main");if(n){n.classList.toggle("rail-collapsed",i.patientRailCollapsed);const o=n.querySelector(".rail-expand-trigger");o&&(o.hidden=!i.patientRailCollapsed)}else E();return}if(t==="toggle-language"){const n=m.querySelector("#direct-url")?.value??i.lastDirectUrl,o=m.querySelector("#patient-id")?.value??"",a=m.querySelector("#quality")?.value??"100",r=m.querySelector("#show-browser")?.checked??!1;wa(Re()==="en"?"vi":"en"),xs(),i.lastDirectUrl=n,E();const c=m.querySelector("#patient-id");c&&(c.value=o);const d=m.querySelector("#quality");d&&(d.value=a);const u=m.querySelector("#show-browser");u&&(u.checked=r),x(i.status),await N("/api/settings/language",{method:"POST",body:JSON.stringify({language:Re()})}),await Z();return}if(t==="clear-patient-id"||t==="clear-direct-url"){const n=di.find(a=>t===`clear-${a.id}`),o=n&&m.querySelector(`#${n.id}`);o&&await Qu(o,n.kind),n?.kind==="url"&&(i.seriesInventory=i.seriesInventory.filter(a=>a.studyUid!=="direct"),delete i.rememberedSeriesSelections.direct,vt());return}if(t==="worklist-tab"){const n=e?.dataset?.worklistTab==="activity"?"activity":"studies";if(n===i.worklistTab)return;i.worklistTab=n,E(),n==="studies"&&lt();return}if(t==="refresh-worklist"){await lt();return}if(t==="open-logs"){i.logModalLoading=!0;try{const r=await N("/api/logs/content");i.logModalContent=r?.content||"",i.logModalFilename=r?.filename||"",i.logModalFolder=r?.folder||"",i.logModalFileList=r?.fileList||[]}catch(r){i.logModalContent=s("Không thể đọc nhật ký: ")+(r?.message||"")}finally{i.logModalLoading=!1}i.showLogModal=!0;const n=(m||document).querySelector(".log-modal-overlay");n&&n.remove();const o=ui()?m:document.querySelector("#app");if(o&&o.children.length>0){const r=document.createElement("div");r.innerHTML=ns();const c=r.firstElementChild;if(c){o.appendChild(c),pe(c),os(c);const d=c.querySelector(".modal-log-pre");d&&(d.scrollTop=d.scrollHeight);return}}E();const a=(m||document).querySelector(".modal-log-pre");a&&(a.scrollTop=a.scrollHeight);return}if(t==="close-log-modal"){i.showLogModal=!1;const n=(m||document).querySelector(".log-modal-overlay");n?n.remove():E();return}if(t==="reveal-logs-folder"){try{window.pywebview?.api?.reveal_logs?await window.pywebview.api.reveal_logs():await N("/api/logs/reveal",{method:"POST"})}catch(n){x(s("Không thể mở thư mục: ")+(n?.message||""),!0)}return}if(t==="copy-modal-logs"){const n=i.logModalContent||"";n&&await ae(n,s("Đã sao chép toàn bộ nhật ký!"));return}if(t==="export-patient-record"){const n=e?.dataset?.folder;if(!n)throw new Error(s("Hồ sơ này chưa có thư mục trên đĩa."));const a=(i.worklistPatients||[]).find(d=>d.folder===n)?.patientName||i.archive?.patient?.patientName||"";let r=null;try{window.pywebview?.api?.get_export_options?r=await window.pywebview.api.get_export_options(n):r=await N("/api/worklist/export-options",{method:"POST",body:JSON.stringify({folder:n})})}catch{r={hasJpg:!0,hasDicom:!1}}if(r?.hasJpg&&r?.hasDicom){i.showExportModal=!0,i.exportModalFolder=n,i.exportModalOptions=r,i.exportModalPatientName=a,E();return}const c=r?.hasDicom&&!r?.hasJpg?"dicom":"viewer";await ca(n,c);return}if(t==="close-export-modal"){i.showExportModal=!1,i.exportModalFolder="",i.exportModalOptions=null,E();return}if(t==="confirm-export-choice"){const n=e?.dataset?.folder||i.exportModalFolder,o=e?.dataset?.mode||"viewer";i.showExportModal=!1,i.exportModalFolder="",i.exportModalOptions=null,E(),await ca(n,o);return}if(t==="clear-worklist-filters"){i.worklistModality="",i.worklistPeriod="all",i.worklistRead="all",i.worklistStage="",Kt();return}if(t==="toggle-study-read"){const n=e?.dataset?.folder;if(!n)return;const o=e.dataset.read!=="1",a=await N("/api/worklist/read",{method:"POST",body:JSON.stringify({folder:n,read:o})});(i.worklistPatients||[]).forEach(r=>{(r.studies||[]).forEach(c=>{c.folder===n&&(c.isRead=!!a?.isRead,c.readAt=String(a?.readAt||""))})}),Kt();return}if(t==="sort-worklist"){const n=e?.dataset?.sortCol;if(!n)return;i.worklistSortColumn===n?i.worklistSortOrder=i.worklistSortOrder==="asc"?"desc":"asc":(i.worklistSortColumn=n,i.worklistSortOrder=n==="date"?"desc":"asc"),Kt();return}if(t==="choose-archive"){if(!window.pywebview?.api)throw new Error(s("Chọn thư mục cần chạy trong ứng dụng WebView2."));const n=await window.pywebview.api.choose_archive();n&&(i.bootstrap.job=n,x(s("Đang nhận diện DICOM hoặc JPG/PNG trong folder…")),gt());return}if(t==="photo-save-edit"){const n=q();if(!n)return;if(!i.photoWorkingPath)throw new Error(s("Chưa có chỉnh sửa nào để lưu."));const o=ot(n),a=await N("/api/media/save",{method:"POST",body:JSON.stringify({path:i.photoWorkingPath,seriesId:n.id,mediaIndex:o})}),r=await N("/api/archive/open",{method:"POST",body:JSON.stringify({path:i.archive.root})}).catch(()=>null);if(r?.series&&ks(r,Hs(),i.archive.root),q()?.id===n.id){const u=((await N(`/api/series/${n.id}/file-paths`).catch(()=>null))?.images||[]).findIndex(p=>Ci(p,a.savedPath));u>=0&&(i.mediaIndex={...i.mediaIndex||{},[n.id]:u});const h=Dr(n.id,o);h.steps=[],h.cursor=-1,i.photoWorkingPath=null,E(),Z()}x(C("Đã lưu vào hồ sơ: {}",a.name));return}if(t==="media-edit-undo"||t==="media-edit-redo"){const n=q(),o=t==="media-edit-redo"?1:-1;if(Jn(n)&&Bd(n,o))return;Rd(n,o);return}if(t==="media-file-prev"||t==="media-file-next"){Md(q(),t==="media-file-next"?1:-1);return}if(t==="edit-record"){i.editingPatientInfo=!0,i.patientEditDraft=i.patientEditDraft||Hr(i.archive?.patient||{});const n=i.tabs.find(o=>o.id===i.activeTabId);n&&(n.editingPatientInfo=!0,n.patientEditDraft={...i.patientEditDraft}),k.draft=k.draft||il(k.record),k.editing=!0,k.error="",k.draftAssessment=k.assessment,It(0),E(),await Z();return}if(t==="cancel-record"){i.editingPatientInfo=!1,i.patientEditDraft=null;const n=i.tabs.find(o=>o.id===i.activeTabId);n&&(n.editingPatientInfo=!1,n.patientEditDraft=null),k.draft=null,k.editing=!1,k.error="",E(),await Z();return}if(t==="clinical-add-tumor"){$l(),dt(),It();return}if(t==="clinical-remove-tumor"){Sl(Number(e?.dataset?.tumorIndex)),dt(),It();return}if(t==="clinical-add-event"){Cl(),dt();return}if(t==="clinical-remove-event"){Il(Number(e?.dataset?.eventIndex)),dt();return}if(t==="clinical-add-marker"){Tl(Number(e?.dataset?.tumorIndex)),dt(),It();return}if(t==="clinical-remove-marker"){Ml(Number(e?.dataset?.tumorIndex),String(e?.dataset?.markerName||"")),dt(),It();return}if(t==="clinical-histology-list"){Pl(Number(e?.dataset?.tumorIndex)),dt(),It();return}if(t==="clinical-marker-list"){Nl(Number(e?.dataset?.tumorIndex),String(e?.dataset?.markerName||"")),dt(),It();return}if(t==="save-record"){const n=La();k.saving=!0,k.error="",dt();const o=await _u(),a=o?await Gu(n):!1;if(k.saving=!1,!o||!a){dt();return}k.draft=null,k.editing=!1,i.editingPatientInfo=!1,i.patientEditDraft=null,E(),await Z(),x(s("Đã lưu hồ sơ bệnh nhân."));return}if(t==="edit-timeline-label"){const n=e?.closest(".tl-item"),o=n?.querySelector(".tl-name-input");if(!n||!o)return;n.classList.add("editing"),o.value=n.dataset.timelineLabel||n.dataset.defaultLabel||"",o.focus(),o.select();return}if(t==="cancel-timeline-label"){const n=e?.closest(".tl-item"),o=n?.querySelector(".tl-name-input");if(!n)return;o&&(o.value=n.dataset.timelineLabel||n.dataset.defaultLabel||""),n.classList.remove("editing");return}if(t==="save-timeline-label"){const n=e?.closest(".tl-item"),o=n?.querySelector(".tl-name-input"),a=n?.dataset.timelineKey||"";if(!n||!o||!a)return;const r=o.value.trim(),c=n.dataset.timelineLabel||n.dataset.defaultLabel||"";if(r===c){n.classList.remove("editing");return}const d=await N("/api/patient/timeline-label",{method:"POST",body:JSON.stringify({timelineKey:a,label:r,archiveRoot:i.archive?.root||"",patientId:i.archive?.patient?.patientId||""})});i.archive.patient=d.patient||i.archive.patient;const u=d.label||n.dataset.defaultLabel||s("Chưa có mô tả");n.dataset.timelineLabel=u,n.querySelector(".nm").textContent=u,o.value=u,n.classList.remove("editing"),x(s("Đã lưu tên hiển thị trên timeline."));return}if(t==="file-info"){await Pu();return}if(t==="close-file-info"){is();return}if(t==="copy-cell"||t==="copy-patient-field"){const n=e?.dataset?.copyText;n&&n!=="—"&&await ae(n,`${s("Đã sao chép")}: ${n.length>25?n.slice(0,22)+"...":n}`);return}if(t==="copy-download-url"){const n=e?.dataset?.url;n&&await ae(n,s("Đã sao chép link tải vào clipboard!"));return}if(t==="open-download-url"){const n=e?.dataset?.url;n&&window.open(n,"_blank");return}if(t==="copy-job-log"){const n=m.querySelector(".job-log"),o=(i.bootstrap?.job?.logs||[]).map(ue).join(`
`)||n?.textContent||"";if(!o.trim()){x(s("Chưa có nội dung nhật ký để sao chép."));return}await ae(o),Lo(s("Đã sao chép toàn bộ nhật ký (log)!"));const a=m.querySelector(".btn-copy-log");a&&(a.classList.add("copied"),setTimeout(()=>{a.classList.remove("copied")},2e3));return}if(t==="clear-job-log"){i.bootstrap?.job&&(i.bootstrap.job.logs=[]),i.job&&(i.job.logs=[]);const n=m.querySelector(".job-log");n&&(n.textContent=""),x(s("Đã xoá hiển thị nhật ký."));return}if(t==="import-dicom-folder"){if(!window.pywebview?.api)throw new Error(s("Nhập DICOM local cần chạy trong ứng dụng WebView2."));const n=await window.pywebview.api.choose_dicom_folder(mo());n&&(i.bootstrap.job=n,x(s("Đang đọc và chuyển folder DICOM local…")),gt());return}if(t==="choose-output"){const n=await window.pywebview?.api?.choose_output();if(n){i.bootstrap.outputRoot=n.outputRoot,n.sourceFolders&&(i.sourceFolders=n.sourceFolders),i.studies=[],i.patient=null,i.seriesInventory=[],i.rememberedSeriesSelections={},i.seriesGroupCache={};const o=m.querySelector("#output-root");o&&(o.value=n.outputRoot),Ao(),vt(),lt(),x(s("Đã đổi kho lưu; hãy tìm lại mã bệnh nhân để đối chiếu phim cũ/mới."))}return}if(t==="add-source-folder"){if(window.pywebview?.api?.choose_source_folder){const a=await window.pywebview.api.choose_source_folder();a?.sourceFolders&&(i.sourceFolders=a.sourceFolders,E(),lt(),x(s("Đã thêm thư mục nguồn thành công.")));return}const n=window.prompt(s("Nhập đường dẫn thư mục nguồn:"));if(!n||!n.trim())return;const o=await N("/api/source-folders/add",{method:"POST",body:JSON.stringify({folder:n.trim()})});o?.sourceFolders&&(i.sourceFolders=o.sourceFolders,E(),lt(),x(C("Đã thêm thư mục nguồn: {}",n.trim())));return}if(t==="remove-source-folder"){const n=e?.dataset?.folder;if(!n)return;const o=await N("/api/source-folders/remove",{method:"POST",body:JSON.stringify({folder:n})});o?.sourceFolders&&(i.sourceFolders=o.sourceFolders,E(),lt(),x(C("Đã xóa thư mục nguồn: {}",n)));return}if(t==="open-folder-explorer"){const n=e?.dataset?.folder;if(!n)return;await N("/api/worklist/reveal-folder",{method:"POST",body:JSON.stringify({folder:n})});return}if(t==="refresh-archive"){i.bootstrap.job=await N("/api/archive/scan",{method:"POST",body:JSON.stringify({path:i.archive.root})}),x(s("Đang quét lại thư mục phim trong nền…")),gt();return}if(t==="search"){const n=m.querySelector("#patient-id").value.trim(),o=m.querySelector("input[name='hospital']:checked")?.value;i.studies=[],i.patient=null,i.seriesInventory=[],i.rememberedSeriesSelections={},i.seriesGroupCache={},Ao(),vt(),await N("/api/search",{method:"POST",body:JSON.stringify({patientId:n,hospital:o,customUsername:i.customRisUser,customPassword:i.customRisPass})}),gt();return}if(t==="select-series-all"||t==="deselect-series-all"){const n=t==="select-series-all";i.seriesInventory.forEach(o=>{(o.series||[]).forEach(a=>{a.selected=n})}),i.rememberedSeriesSelections=bn(i.seriesInventory,i.rememberedSeriesSelections),vt(),wt();return}if(t==="discover-series"){const n=he(i.studies),o=m.querySelector("#direct-url")?.value.trim()||"";if(i.studies.length&&!n.length)throw new Error(s("Hãy tích ít nhất một ngày chụp trước khi quét series."));if(!i.studies.length&&!o)throw new Error(s("Hãy chọn ca chụp hoặc nhập link viewer trước khi quét series."));i.rememberedSeriesSelections=bn(i.seriesInventory,i.rememberedSeriesSelections),i.seriesInventory=[],vt(),wt(),await N("/api/series/discover",{method:"POST",body:JSON.stringify({studies:n,url:n.length?"":o,hospital:i.patient?.hospitalKey||m.querySelector("input[name='hospital']:checked")?.value,showBrowser:m.querySelector("#show-browser").checked,customUsername:i.customRisUser,customPassword:i.customRisPass})}),x(s("Đang quét danh sách series; chưa tải file ảnh…")),gt();return}if(t==="download-selected"){if(i.patient?.nameConflict)throw new Error(s("Tên bệnh nhân không khớp; app đã chặn tự động gộp."));const n=he(i.studies);if(!n.length)throw new Error(s("Không có phim mới/chưa hoàn tất được chọn để tải."));await N("/api/download",{method:"POST",body:JSON.stringify({studies:n,patientId:i.patient?.patientId,patientName:i.patient?.patientName,hospital:i.patient?.hospitalKey,allStudies:i.studies,seriesSelections:i.downloadAllFiles?void 0:fo(),...mo()})}),gt();return}if(t==="download-direct"||t==="download-retry"){const n=m.querySelector("#direct-url").value.trim();if(!n)throw new Error(s("Chưa có link viewer để tải."));if(!i.downloadAllFiles&&!(fo().direct||[]).length)throw new Error(s("Chưa quét hoặc chưa chọn series cho link viewer."));i.lastDirectUrl=n,await N("/api/download/direct",{method:"POST",body:JSON.stringify({url:n,resume:t==="download-retry",selectedSeriesIds:i.downloadAllFiles?void 0:fo().direct||[],...mo()})}),gt();return}if(t==="stop-job"){await N("/api/job/stop",{method:"POST",body:"{}"});return}if(t?.startsWith("mode-")){const n=t.slice(5);if(n===i.mode)return;i.mode=n,i.tool=Wu(n,i.tool),i.cine=!1,Xn()&&(vr(),i.scrollSync=!0,Wi(i.referenceLines),Vi(i.referenceCursor)),E(),await Z();return}if(t==="scale-overlay"){i.scaleOverlay=hc(!i.scaleOverlay);const n=m.querySelector("[data-action='scale-overlay']");n&&(n.classList.toggle("active",i.scaleOverlay),n.setAttribute("aria-pressed",i.scaleOverlay?"true":"false"));return}if(t?.startsWith("tool-")){i.tool=Un(t.slice(5)),vs();return}if(t==="scroll-sync"){i.scrollSync=Ya(!i.scrollSync);const n=m.querySelector("[data-action='scroll-sync']");n&&(n.classList.toggle("active",i.scrollSync),n.setAttribute("aria-pressed",i.scrollSync?"true":"false"));const{anchor:o,spatialMode:a}=oi();if(i.scrollSync){const r=(o||[]).map(d=>d+1).join(" · "),c=s(a==="spatial"?"đồng bộ theo vị trí 3D":a==="index"?"⚠ đồng bộ theo số thứ tự lát (không có đồng bộ không gian)":"chỉ đồng bộ các cặp tương thích; mặt phẳng khác hướng giữ lát độc lập");x(C("Đã khoá cuộn: {} — {}.",r,c))}else["reference","blocked"].includes(a)?x(s(a==="reference"?"Hai mặt phẳng giữ lát độc lập; đường tham chiếu biểu diễn giao tuyến 3D.":"Không khoá cuộn vì hai series khác hệ tọa độ (Frame of Reference).")):x(s("Đã bỏ khoá: mỗi khung cuộn riêng."));return}if(t==="reference-lines"){i.referenceLines=Wi(!i.referenceLines);const n=m.querySelector("[data-action='reference-lines']");n&&(n.classList.toggle("active",i.referenceLines),n.setAttribute("aria-pressed",i.referenceLines?"true":"false")),x(s(i.referenceLines?"Đường tham chiếu đã bật.":"Đường tham chiếu đã tắt."));return}if(t==="reference-cursor"){i.referenceCursor=Vi(!i.referenceCursor);const n=m.querySelector("[data-action='reference-cursor']");n&&(n.classList.toggle("active",i.referenceCursor),n.setAttribute("aria-pressed",i.referenceCursor?"true":"false")),x(s(i.referenceCursor?"Con trỏ tham chiếu đã bật.":"Con trỏ tham chiếu đã tắt."));return}if(t==="reset"){i.windowPreset=Sn(q()),Cc(),await Ge(i.windowPreset),window.__viewerDiagnostics=yt();const n=m.querySelector("[data-field='window-preset']");n&&(n.value=i.windowPreset)}if(t==="reset-all"){i.windowPreset=Sn(q()),Ic(),await Ge(i.windowPreset),window.__viewerDiagnostics=yt();const n=m.querySelector("[data-field='window-preset']");n&&(n.value=i.windowPreset)}if(t==="undo-annotation"&&Dc(),t==="clear-annotations"){const n=await Nc();x(n?C("Đã xóa {} phép đo/ROI.",n):s("Khung xem hiện tại không có phép đo/ROI để xóa."))}if(t==="rotate-clockwise"){if(!sc())throw new Error(s("Chưa chọn khung ảnh để xoay."));window.__viewerDiagnostics=yt()}if(t==="flip-horizontal"){if(!lc())throw new Error(s("Chưa chọn khung ảnh để lật."));window.__viewerDiagnostics=yt()}if(t==="flip-vertical"){if(!cc())throw new Error(s("Chưa chọn khung ảnh để lật."));window.__viewerDiagnostics=yt()}if(t==="invert"){const n=Tc();if(window.__viewerDiagnostics=yt(),!n)throw new Error(s("Khung đang xem không đảo màu được."))}if(t==="cine"){i.cine=Mc(q()),x(s(i.cine?"Đang chạy phim — nhấn Space để dừng.":"Đã dừng chạy phim."));return}if(t==="capture"){const n=await Pc();x(C('Đã lưu ảnh PNG của khung "{}".',n))}if(t==="save-annotations"){const n=await ii();x(C("Đã lưu {} phép đo/ROI.",n))}if(t==="roi-volume"){const n=Ac();x(C("Thể tích ROI thủ công: {} mL (tổng diện tích lát × khoảng cách lát).",n.toFixed(2)))}if(t==="video-play-pause"){const n=m.querySelector("#surgery-video-player");n&&(n.paused?n.play():n.pause());return}if(t==="video-rewind-5"){const o=A()?.querySelector("#surgery-video-player");o&&(o.currentTime=Math.max(0,o.currentTime-5));return}if(t==="video-forward-5"){const o=A()?.querySelector("#surgery-video-player");o&&(o.currentTime=Math.min(o.duration||0,o.currentTime+5));return}if(t==="add-video-bookmark"){const o=A()?.querySelector("#surgery-video-player"),a=o?o.currentTime:0,r=q();let c="";typeof window<"u"&&typeof window.prompt=="function"&&(window.prompt._isMockFunction||window.prompt.mock!==void 0)&&(c=window.prompt(s("Nhập ghi chú / mốc phẫu thuật:"))||""),c||(c=C("Mốc {}",_(a))),i.videoBookmarks||(i.videoBookmarks=[]);const d={time:a,text:c};r?.id&&(d.seriesId=r.id,d.seriesName=r.name||r.patientName||"",d.fileIndex=ot(r),d.createdAt=Date.now()),i.videoBookmarks.push(d),oe(r),so(r),x(C("Đã đánh dấu mốc tại {}.",_(a)));return}if(t==="delete-video-bookmark"){const n=Number(e?.dataset?.idx);Number.isFinite(n)&&i.videoBookmarks&&i.videoBookmarks[n]&&(i.videoBookmarks.splice(n,1),oe(q()),so(),x(s("Đã xoá mốc phẫu thuật.")));return}if(t==="edit-video-bookmark"){const n=Number(e?.dataset?.idx);if(Number.isFinite(n)&&i.videoBookmarks&&i.videoBookmarks[n]){const o=i.videoBookmarks[n],r=A()?.querySelector(`#bm-text-${n}`);if(r&&!r.querySelector("input")){const c=o.text||"";r.innerHTML=`<input type="text" class="bookmark-inline-input" value="${l(c)}" />`;const d=r.querySelector("input");d.focus(),d.select();const u=()=>{const h=d.value.trim();o.text=h||s("Mốc phẫu thuật"),oe(q()),so()};d.onkeydown=h=>{h.key==="Enter"?(h.preventDefault(),u()):h.key==="Escape"&&oe(q())},d.onblur=u}}return}if(t==="jump-other-clip-bookmark"){const n=e?.dataset?.seriesId,o=Number(e?.dataset?.fileIndex||0),a=Number(e?.dataset?.time||0);if(n&&i.archive?.series){const r=i.archive.series.find(c=>c.id===n);if(r){i.selectedId=n,o>0&&(i.mediaIndex={...i.mediaIndex||{},[n]:o}),i.videoWorkingPath=null,i._pendingVideoSeek=a,E(),ce();const c=A()?.querySelector("#surgery-video-player");c&&(c.currentTime=a),x(C("Đã chuyển sang clip: {} tại {}.",r.name||r.patientName,_(a)))}}return}if(t==="seek-video"){const n=Number(e?.dataset?.time||0),a=A()?.querySelector("#surgery-video-player");if(!a)return;Number.isFinite(Number(a.duration))&&Number(a.duration)>0||(i._pendingVideoSeek=n),a.currentTime=n,Dn(a),x(C("Đã tua đến {}.",_(n)));return}if(t==="video-snapshot"){const o=A()?.querySelector("#surgery-video-player");if(o){const a=document.createElement("canvas");a.width=o.videoWidth||1280,a.height=o.videoHeight||720,a.getContext("2d").drawImage(o,0,0,a.width,a.height);const c=document.createElement("a");c.download=`snapshot_${Math.floor(o.currentTime)}s.png`,c.href=a.toDataURL("image/png"),c.click(),x(s("Đã lưu khung hình snapshot PNG."))}return}if(t==="seek-filmstrip-idx"){const n=Number(e?.dataset?.idx||0),o=Number(e?.dataset?.total||1),r=A()?.querySelector("#surgery-video-player");r&&r.duration&&(r.currentTime=n/o*r.duration,Dn(r));return}if(t==="video-set-in"||t==="video-set-out"){const n=A()?.querySelector("#surgery-video-player"),o=Number(n?.currentTime)||0;if(t==="video-set-in")i.videoIn=o,i.videoOut!==null&&i.videoOut<=o&&(i.videoOut=null);else{if(i.videoIn===null||o<=i.videoIn)throw new Error(s("Hãy đặt điểm đầu trước, ở vị trí sớm hơn điểm cuối."));i.videoOut=o}dn(),x(t==="video-set-in"?C("Đã đặt điểm đầu tại {}.",_(o)):C("Đã chọn đoạn {} → {}.",_(i.videoIn),_(o)));return}if(t==="video-timing"){const n=e?.dataset?.timing==="span"?"span":"all";i.videoShapeTiming=n;const o=n==="span"?gs():{startS:null,endS:null},a=K()?.selectedShape()||null,r=!!a&&K()?.restyleSelected(o);mt(),K()?.repaint();const c=n==="span"?At():null,d=c?`${_(c.start)} → ${_(c.end)}`:s("suốt video");x(r?C("Đã đổi “{}” sang hiện {}. Nét vẽ mới cũng vậy.",s(Oo(a.kind)),d):C("Nét vẽ mới sẽ hiện {}.",d));return}if(t==="video-clear-range"){i.videoIn=null,i.videoOut=null,dn(),x(s("Đã bỏ đoạn đã đánh dấu."));return}if(t==="video-apply-shapes"){const n=q();if(!n)return;const o=Ft(n),a=gr(o?.shapes||[]);if(!a.length)throw new Error(s("Chưa vẽ gì trên video để áp dụng."));const r=await Wt(n);if(!r)throw new Error(s("Không tìm thấy đường dẫn video gốc."));const c=a.filter(u=>u.start_s!==void 0).length;x(c?C("Đang ghi {} nét vẽ vào video ({} nét theo mốc thời gian)...",a.length,c):C("Đang ghi {} nét vẽ vào toàn bộ video...",a.length));const d=await N("/api/media/video/burn-overlay",{method:"POST",body:JSON.stringify({path:r,shapes:a})});i.videoWorkingPath=d.outputPath,Mt(n,d),o.shapes=[],o.past=[],o.future=[],K()?.select(null),xe(A()?.querySelector("#surgery-video-player"),d.url),mt(),x(C("Đã ghi {} nét vẽ vào video.",a.length));return}if(t==="video-tool-trim"){const n=q();if(!n)return;const o=At();if(!o)throw new Error(s("Hãy đánh dấu điểm đầu (I) và điểm cuối (O) trên thanh tua trước."));x(s("Đang cắt video bằng FFmpeg..."));const a=await Wt(n);if(!a)throw new Error(s("Không tìm thấy đường dẫn video gốc."));const r=await N("/api/media/video/trim",{method:"POST",body:JSON.stringify({path:a,startSeconds:o.start,endSeconds:o.end,reencode:!1})});i.videoWorkingPath=r.outputPath,Mt(n,r),i.videoIn=null,i.videoOut=null,xe(A()?.querySelector("#surgery-video-player"),r.url),dn(),x(C("Đã cắt đoạn video ({:.1f}s - {:.1f}s) thành công.",o.start,o.end));return}if(t==="video-tool-burn-text"){const n=q();if(!n)return;const a=(typeof m<"u"&&m?m:typeof document<"u"?document:null)?.querySelector("#surgery-video-player"),r=`${n.patientName||"BN"} - ${new Date().toLocaleDateString()}`;x(s("Đang đóng dấu thông tin lên video..."));const c=await Wt(n);if(!c)throw new Error(s("Không tìm thấy đường dẫn video gốc."));const d=await N("/api/media/video/burn-text",{method:"POST",body:JSON.stringify({path:c,overlays:[{text:r,x:24,y:24,fontSize:24,color:"yellow",box:!0}]})});i.videoWorkingPath=d.outputPath,Mt(n,d),a&&xe(a,d.url),x(s("Đã đóng dấu thông tin lên video thành công."));return}if(t==="video-tool-filmstrip"){const n=q();if(!n)return;x(s("Đang trích xuất chuỗi khung hình filmstrip..."));const o=await Wt(n);if(!o)throw new Error(s("Không tìm thấy đường dẫn video gốc."));const a=await N("/api/media/video/filmstrip",{method:"POST",body:JSON.stringify({path:o,count:6,maxWidth:160})});i.videoFilmstrip=a.frames||[],E(),ce(),x(C("Đã trích xuất {} khung hình filmstrip.",i.videoFilmstrip.length));return}if(t==="video-tool-transcode"){const n=q();if(!n)return;x(s("Đang tối ưu hoá mã hoá video MP4 (H.264)..."));const o=await Wt(n);if(!o)throw new Error(s("Không tìm thấy đường dẫn video gốc."));const a=await N("/api/media/video/transcode",{method:"POST",body:JSON.stringify({path:o,crf:23,use_hw:!0})});i.videoWorkingPath=a.outputPath,Mt(n,a),E(),ce();const c=(typeof m<"u"&&m?m:typeof document<"u"?document:null)?.querySelector("#surgery-video-player");c&&xe(c,a.url),x(s("Đã tối ưu hoá và xuất video MP4 thành công."));return}if(t==="video-tool-concat"){const n=await Fu();if(n.length<2)throw new Error(s("Cần ít nhất 2 clip video trong ca mổ để ghép."));i.concatClips=n,i.showConcatModal=!0,E();return}if(t==="close-concat-modal"){i.showConcatModal=!1,E();return}if(t==="toggle-concat-clip"){const n=Number(e?.dataset?.clipIdx);i.concatClips&&i.concatClips[n]&&(i.concatClips[n].selected=!i.concatClips[n].selected,E());return}if(t==="move-concat-clip-up"){const n=Number(e?.dataset?.clipIdx);if(i.concatClips&&n>0){const o=i.concatClips[n];i.concatClips[n]=i.concatClips[n-1],i.concatClips[n-1]=o,E()}return}if(t==="move-concat-clip-down"){const n=Number(e?.dataset?.clipIdx);if(i.concatClips&&n<i.concatClips.length-1){const o=i.concatClips[n];i.concatClips[n]=i.concatClips[n+1],i.concatClips[n+1]=o,E()}return}if(t==="start-concat-video"){const n=q();if(!n)return;const o=(i.concatClips||[]).filter(u=>u.selected);if(o.length<2)throw new Error(s("Cần chọn ít nhất 2 clip video để ghép."));x(C("Đang chuẩn bị ghép {} clip video...",o.length));const a=o.map(u=>u.path).filter(Boolean);if(a.length<2)throw new Error(s("Không đủ số lượng file video hợp lệ để ghép."));i.showConcatModal=!1,E(),x(C("Đang ghép {} clip video bằng FFmpeg...",a.length));const r=await N("/api/media/video/concat",{method:"POST",body:JSON.stringify({sources:a,targetHeight:i.concatTargetHeight||1080,targetFps:i.concatTargetFps||30})});i.videoWorkingPath=r.outputPath,Mt(n,r);const d=A()?.querySelector("#surgery-video-player");d&&xe(d,r.url),x(C("Đã ghép thành công {} đoạn video clip.",a.length));return}if(t==="video-tool-thumb"){const n=q();if(!n)return;const a=A()?.querySelector("#surgery-video-player"),r=a?a.currentTime:0;x(C("Đang tạo ảnh đại diện thumbnail tại {:.1f}s...",r));const c=await Wt(n);if(!c)throw new Error(s("Không tìm thấy đường dẫn video gốc."));const d=await N("/api/media/video/thumbnail",{method:"POST",body:JSON.stringify({path:c,atSeconds:r,maxWidth:480})});await lo(d.url,`thumb_${Math.floor(r)}s.jpg`),x(C("Đã tạo ảnh đại diện thumbnail thành công ({:.1f}s).",r));return}if(t==="photo-rotate-cw"){await la(90);return}if(t==="photo-rotate-ccw"){await la(-90);return}if(t==="photo-pick-tool"){En(e?.dataset?.tool||"select");return}if(t==="photo-pick-color"){te({color:String(e?.dataset?.color||"#ff3b30")});return}if(t==="photo-delete-shape"){K()?.deleteSelected();return}if(t==="photo-clear-shapes"){K()?.clearShapes(),x(s("Đã xoá các nét vẽ chưa áp dụng."));return}if(t==="photo-zoom-in"){sa(1.25);return}if(t==="photo-zoom-out"){sa(.8);return}if(t==="photo-zoom-fit"){i.photoZoom=0,Ii();return}if(t==="photo-apply-shapes"){const n=q();if(!n)return;const o=ge(n);if(!o)throw new Error(s("Chưa vẽ gì trên ảnh để áp dụng."));await fn(n),x(C("Đã vẽ {} chi tiết lên ảnh.",o));return}if(t==="photo-apply-crop"){const n=q();if(!n)return;const o=K()?.cropRect();if(!o)throw new Error(s("Hãy kéo chuột trên ảnh để chọn vùng cần cắt."));const a=await fn(n,{silent:!0});x(s("Đang cắt ảnh..."));const r=await N("/api/media/photo/crop",{method:"POST",body:JSON.stringify({path:a,rect:o})});i.photoWorkingPath=r.outputPath,Mt(n,r),K()?.clearCrop(),mi(A()?.querySelector("#photo-editor-img"),r.url),En("select"),x(C("Đã cắt ảnh còn {}×{} px.",o.width,o.height));return}if(t==="photo-export-image"){const n=q();if(!n)return;await fn(n,{silent:!0});const o=i.photoWorkingPath;if(!o)throw new Error(s("Ảnh chưa có chỉnh sửa nào; hãy mở file gốc trong thư mục hồ sơ."));const a=Yn(o);await lo(`/api/media/work-file?name=${encodeURIComponent(a)}`,`${n.patientName||"anh"}_${Date.now()}.jpg`),x(s("Đã tải ảnh đã chỉnh sửa về máy."));return}if(t==="photo-export-pdf"){const n=q();if(!n)return;x(s("Đang xuất file PDF..."));const o=i.photoWorkingPath?{sources:[i.photoWorkingPath]}:{seriesId:n.id},a=await N("/api/media/photo/export-pdf",{method:"POST",body:JSON.stringify(o)});await lo(a.url,`patient_document_${Date.now()}.pdf`),x(C("Đã xuất PDF thành công: {}",a.outputPath));return}}catch(n){const o=String(n?.message||n);if(o.includes("Không đăng nhập được RIS")||o.includes("Không thể đăng nhập vào RIS")){i.showLoginCard=!0,i.loginCardAction=t,E();return}x(ft(n),!0)}}const da={volume3d:"orbit3d",mpr:"crosshair"};function Wu(t,e){return da[t]?da[t]:e==="orbit3d"||e==="crosshair"?"window":e}function vs(t=m||(typeof document<"u"?document:null)){t?.querySelectorAll('.toolbar .icon-button[data-action^="tool-"]').forEach(e=>{const n=e.dataset.action===`tool-${i.tool}`;e.classList.toggle("active",n),e.setAttribute("aria-pressed",n?"true":"false")})}const Vu=[[/cachedSizeExceeded|Cache size|cacheSize/i,"Hết bộ đệm ảnh. Hãy đóng series khác hoặc chọn series ít lát hơn rồi thử lại."],[/Failed to fetch|NetworkError|load failed/i,"Mất kết nối tới dịch vụ nội bộ của ứng dụng. Hãy khởi động lại ứng dụng."],[/WebGL|GPU|context lost/i,"Trình kết xuất GPU gặp sự cố. Hãy khởi động lại ứng dụng; nếu lặp lại, cập nhật driver card đồ họa."]];function ft(t){const e=ue(t?.message||String(t)),n=Vu.find(([o])=>o.test(e));return n?`${s(n[1])} (${s("chi tiết")}: ${e})`:e}function ju(){const t={};return i.seriesInventory.forEach(e=>{e.studyUid&&e.studyUid!=="direct"&&e.attachments?.length&&(t[e.studyUid]=e.attachments)}),t}function mo(){const t={outputRoot:i.bootstrap.outputRoot,quality:Number(m.querySelector("#quality").value||100),showBrowser:m.querySelector("#show-browser").checked,downloadAllFiles:i.downloadAllFiles,downloadAttachments:!!i.downloadAttachments,attachments:ls(),attachmentsByStudy:ju(),customUsername:i.customRisUser,customPassword:i.customRisPass};return i.showManualInfo&&(t.manualInfo={patientName:i.manualPatientName,patientId:i.manualPatientId,patientDob:i.manualPatientDob}),t}function Ti(t){t&&(t.mediaIndex=i.mediaIndex||{},t.mediaEdits=i.mediaEdits||{},t.photoLayers=i.photoLayers||{},t.videoIn=i.videoIn,t.videoOut=i.videoOut,t.photoWorkingPath=i.photoWorkingPath||null,t.videoWorkingPath=i.videoWorkingPath||null,t.videoBookmarks=i.videoBookmarks||[],t.videoFilmstrip=i.videoFilmstrip||[],t.lastMediaSeriesId=i._lastPhotoSeriesId||"",t.textDoc=i.textDoc||null)}function bs(t){i.mediaIndex=t?.mediaIndex||{},i.mediaEdits=t?.mediaEdits||{},i.photoWorkingPath=t?.photoWorkingPath||null,i.videoWorkingPath=t?.videoWorkingPath||null,i.videoBookmarks=t?.videoBookmarks||[],i.videoFilmstrip=t?.videoFilmstrip||[],i._lastPhotoSeriesId=t?.lastMediaSeriesId||"",i.textDoc=t?.textDoc||null,i.photoLayers=t?.photoLayers||{},i.videoIn=t?.videoIn??null,i.videoOut=t?.videoOut??null,i.videoDuration=0,i.photoTool="select",i.photoZoom=0,ci(),i.showConcatModal=!1,i.concatClips=[]}function Mi(){bs(null)}async function Pi(t){if(i.activeTabId===t)return;const e=i.tabs.find(o=>o.id===i.activeTabId);if(e&&(e.archive=i.archive,e.selectedId=i.selectedId,e.compareIds=[...i.compareIds],e.mode=i.mode,e.tool=i.tool,e.windowPreset=i.windowPreset,e.mprPrimary=i.mprPrimary,e.status=i.status,e.editingPatientInfo=!!i.editingPatientInfo,i.editingPatientInfo?e.patientEditDraft=vi(m?.querySelector("[data-field='patient-edit-form']"))||i.patientEditDraft:e.patientEditDraft=null,Ti(e)),Ne(),i.activeTabId=t,t==="worklist"){i.editingPatientInfo=!1,i.patientEditDraft=null,Ae(""),E();return}const n=i.tabs.find(o=>o.id===t);if(n){Ae(n.sessionId||""),i.archive=n.archive,wi(),i.selectedId=n.selectedId,i.compareIds=[...n.compareIds],i.mode=n.mode,i.tool=n.tool,i.windowPreset=n.windowPreset,i.mprPrimary=n.mprPrimary,i.status=n.status,i.editingPatientInfo=!!n.editingPatientInfo,i.patientEditDraft=n.patientEditDraft?{...n.patientEditDraft}:null,bs(n);for(const o of i.archive.series)Yt(o)}E(),await Z()}async function Uu(t){const e=i.tabs.findIndex(o=>o.id===t);if(e===-1)return;const n=i.tabs[e];if(n.sessionId&&N("/api/sessions/close",{method:"POST",body:JSON.stringify({sessionId:n.sessionId})}).catch(()=>{}),i.tabs.splice(e,1),Nr(i.activeTabId===t?"":i.selectedId),i.activeTabId===t){const o=i.tabs[e]||i.tabs[e-1],a=o?o.id:"worklist";await Pi(a)}else E()}const Ku=/screen\s*save|dose\s*report|scout|localiz|survey|patient\s*protocol|summary/i;function ws(t){const e=(t||[]).filter(Boolean);if(e.length===0)return"";const n=e.filter(u=>(u.mediaType||"dicom")==="dicom"),o=n.length?n:e,a=o.reduce((u,h)=>{const p=String(h.studyDate||"");return p>u?p:u},""),r=a?o.filter(u=>String(u.studyDate||"")===a):o,c=u=>Ku.test(String(u.description||u.name||""))?1:0;return[...r].sort((u,h)=>{const p=c(u)-c(h);return p!==0?p:(Number(h.sliceCount)||0)-(Number(u.sliceCount)||0)})[0]?.id||e[0].id}let ua=0;function Ni(t={}){return ua+=1,{id:`tab-${Date.now()}-${ua}`,sessionId:"",folder:"",patientId:"",patientName:"",archive:{root:"",series:[]},loading:!1,loadError:"",selectedId:"",compareIds:["",""],mode:"single",tool:"window",windowPreset:null,mprPrimary:"axial",scrollLinked:!1,status:s("Sẵn sàng."),editingPatientInfo:!1,patientEditDraft:null,mediaIndex:i.mediaIndex,mediaEdits:i.mediaEdits,photoLayers:{},videoIn:null,videoOut:null,photoWorkingPath:null,videoWorkingPath:null,videoBookmarks:[],videoFilmstrip:[],lastMediaSeriesId:"",textDoc:null,...t}}function On(t,e,n="",o=""){const a=i.tabs.find(u=>u.id===t);if(!a)return!1;const r=e||{root:"",series:[]},c=r.series||[];for(const u of c)Yt(u);const d=c.some(u=>u.id===a.selectedId)?a.selectedId:ws(c);return a.archive=r,a.loading=!1,a.loadError="",n&&(a.sessionId=n),a.folder=o||r.root||a.folder||"",a.patientId=r.patient?.patientId||a.patientId||"",a.patientName=r.patient?.patientName||a.patientName||(r.root?r.root.split(/[\\/]/).pop():""),a.selectedId=d,a.mode="single",a.tool="window",a.windowPreset=Sn(c.find(u=>u.id===d)),a.status=s("Sẵn sàng."),i.activeTabId!==t?(E(),!0):(Ae(a.sessionId||""),i.archive=r,wi(),i.selectedId=d,i.mode=a.mode,i.tool=a.tool,i.windowPreset=a.windowPreset,vr("compare3"),a.compareIds=[...i.compareIds],E(),Z(),!0)}function ks(t,e="",n=""){const o=i.tabs.find(a=>a.id===i.activeTabId);if(!o||i.activeTabId==="worklist"){Mi(),i.editingPatientInfo=!1,i.patientEditDraft=null;const a=Ni({sessionId:e||"",folder:n||t?.root||""});return i.tabs.push(a),i.activeTabId=a.id,On(a.id,t,e,n),a.id}return On(o.id,t,e,n),o.id}function Z(){if(i.activeTabId==="worklist"||k.editing)return Promise.resolve();const t=q();if(!t)return ke;const e=X(t);if(e==="text")return Ne(),i.busyViewer=!1,m.querySelector(".status-dot")?.classList.remove("busy"),Eo(t,fi(t)?.index||0),Promise.resolve();if(e==="pdf")return Ne(),i.busyViewer=!1,A()?.querySelector(".status-dot")?.classList.remove("busy"),qr(),x(s("Sẵn sàng.")),Promise.resolve();if(e==="video"||e==="photo"||e==="doc"){i._lastPhotoSeriesId!==t.id&&(i._lastPhotoSeriesId=t.id,Nr(t.id),Lr(t),i.photoRotation=0,i.videoFilmstrip=[],i._videoInfoLoaded=!1),Ne(),i.busyViewer=!1;const u=document.querySelector("#workspace");return u&&(u.classList.remove("busy"),delete u.dataset.loadingText),m.querySelector(".status-dot")?.classList.remove("busy"),x(s("Sẵn sàng.")),ce(),Promise.resolve()}const n=i.mode,o=fd(),a=++Qt,r=document.querySelector("#workspace");if(!r)return ke;const c=n==="mpr"?C("Đang dựng MPR từ {} lát…",t.sliceCount):n==="volume3d"?C("Đang dựng mô hình 3D từ {} lát…",t.sliceCount):s("Đang mở ảnh…");i.busyViewer=!0,window.__viewerReadyMode="",r.dataset.loadingText=c,r.classList.add("busy"),m.querySelector(".status-dot")?.classList.add("busy"),x(c);const d=async()=>{const u=r;if(a!==Qt||!u.isConnected){u.classList.remove("busy"),delete u.dataset.loadingText;return}i.busyViewer=!0,window.__viewerReadyMode="";const h=n==="mpr"?C("Đang dựng MPR từ {} lát…",t.sliceCount):n==="volume3d"?C("Đang dựng mô hình 3D từ {} lát…",t.sliceCount):s("Đang mở ảnh…");u.dataset.loadingText=h,u.classList.add("busy"),m.querySelector(".status-dot")?.classList.add("busy"),x(h);try{if(await Lc()===-1&&x(s("Không lưu được phép đo trước khi đổi khung xem."),!0),await new Promise(S=>requestAnimationFrame(()=>requestAnimationFrame(S))),a!==Qt||!u.isConnected)return;let f=i.tool;if(n==="mpr"?f=await bc(u,t,i.mprPrimary,i.tool):n==="volume3d"?f=await $c(u,t,i.tool):f=await yc(u,t,n,o,i.tool),a!==Qt||!u.isConnected)return;f&&f!==i.tool&&(i.tool=f,vs());const y=Qa();if(y!==i.scaleOverlay){i.scaleOverlay=y;const S=m.querySelector("[data-action='scale-overlay']");S&&(S.classList.toggle("active",y),S.setAttribute("aria-pressed",y?"true":"false"))}if(n==="compare"||n==="compare3"){const S=oi();i.scrollSync=S.enabled;const b=m.querySelector("[data-action='scroll-sync']");b&&(b.classList.toggle("active",i.scrollSync),b.setAttribute("aria-pressed",i.scrollSync?"true":"false"),b.title=s(i.scrollSync?"Đang khoá cuộn theo vị trí — bấm để cuộn từng khung riêng":"Cuộn từng khung riêng — bấm để khoá theo độ lệch hiện tại"))}n!=="volume3d"&&i.windowPreset!=="full"&&await Ge(i.windowPreset),window.__lastViewerError=null,window.__viewerReadyMode=n,window.__viewerDiagnostics=yt()}catch(p){if(p?.superseded||a!==Qt||!u.isConnected)return;const f=ft(p);window.__lastViewerError={message:p?.message||String(p),stack:p?.stack||""},u.innerHTML=`<div class="empty-state error"><b>${l(s("Không mở được khung xem"))}</b>
        <span>${l(f)}</span>
        <button class="primary" data-action="retry-viewer">${l(s("Thử lại"))}</button></div>`,u.querySelector("[data-action='retry-viewer']")?.addEventListener("click",()=>Z()),x(f,!0)}finally{u.classList.remove("busy"),delete u.dataset.loadingText,a===Qt&&(i.busyViewer=!1,m.querySelector(".status-dot")?.classList.remove("busy"))}};return ke=ke.catch(()=>{}).then(d),ke}function x(t,e=!1){i.status=t,i.isError=!!e;const o=(m||(typeof document<"u"?document.querySelector("#app"):null))?.querySelector(".status-bar");if(o){o.classList.toggle("error",i.isError);const a=o.querySelector(".status-text");a&&(a.textContent=t)}}const ha={1:"window",2:"pan",3:"zoom",4:"length",5:"angle",6:"ellipse",7:"freehand",8:"text"};function zu(t){return!!t?.closest?.("input, textarea, select")}function Xu(t){const e=q();if(!Jn(e)||!K())return!1;if(t.ctrlKey||t.metaKey){const o=t.key.toLowerCase();return o==="z"?(t.preventDefault(),F(t.shiftKey?"media-edit-redo":"media-edit-undo"),!0):o==="y"?(t.preventDefault(),F("media-edit-redo"),!0):t.key==="Enter"?(t.preventDefault(),F("photo-apply-shapes"),!0):!1}if(t.altKey)return!1;if(t.key==="Delete"||t.key==="Backspace")return t.preventDefault(),F("photo-delete-shape"),!0;if(t.key==="Escape")return K()?.clearCrop(),K()?.select(null),mt(),!0;if(t.key==="+"||t.key==="=")return F("photo-zoom-in"),!0;if(t.key==="-"||t.key==="_")return F("photo-zoom-out"),!0;if(t.key==="0")return F("photo-zoom-fit"),!0;if(t.key===" "&&Ar(e))return t.preventDefault(),!0;if(X(e)==="video"){if(t.key.toLowerCase()==="i")return F("video-set-in"),!0;if(t.key.toLowerCase()==="o")return F("video-set-out"),!0;if(t.key===" ")return t.preventDefault(),F("video-play-pause"),!0}const n=zn.find(o=>o.key.toLowerCase()===t.key.toLowerCase());return n?(En(n.id),!0):!1}function Ju(){window.addEventListener("keydown",t=>{if(t.key==="F11"){t.preventDefault(),F("window-fullscreen");return}if(t.key==="Escape"&&document.querySelector(".app-shell.zen-mode")){t.preventDefault(),F("window-fullscreen");return}if(zu(t.target))return;if(t.key==="["&&!t.ctrlKey&&!t.altKey&&!t.metaKey&&i.activeTabId!=="worklist"){t.preventDefault(),F("toggle-patient-rail");return}if(Xu(t))return;if(t.key==="Tab"&&!t.ctrlKey&&!t.altKey&&!t.metaKey&&!t.shiftKey&&document.querySelector(".viewport-maximized")){t.preventDefault(),fc();return}if(t.ctrlKey&&t.key.toLowerCase()==="z"){t.preventDefault(),F("undo-annotation");return}if(t.ctrlKey||t.altKey||t.metaKey||i.busyViewer||!i.archive.series.length)return;const e={ArrowLeft:-1,ArrowUp:-1,PageUp:-5,ArrowRight:1,ArrowDown:1,PageDown:5};if(t.key in e){Ui(e[t.key])&&t.preventDefault();return}if(t.key==="Home"||t.key==="End"){const o=q();o&&Ui(t.key==="Home"?-o.sliceCount:o.sliceCount)&&t.preventDefault();return}if(ha[t.key]){F(`tool-${ha[t.key]}`);return}if(t.key==="R"){F("reset-all");return}const n=t.key.toLowerCase();n==="c"?F("tool-crosshair"):n==="r"?F("reset"):n==="i"?F("invert"):n==="s"?F("save-annotations"):n==="p"?F("capture"):t.key===" "&&(t.preventDefault(),F("cine"))})}let ut=null;function gt(){ut&&window.clearInterval(ut),ut=window.setInterval(pa,1e3),pa()}function Ao(){const t=m.querySelector(".study-list");t&&(t.innerHTML=rs());const e=m.querySelector(".patient-status");e&&(e.innerHTML=hs()),m.querySelectorAll("[data-study-index]").forEach(n=>{n.addEventListener("change",()=>ms(n))}),wt()}async function pa(){const t=await N("/api/job");if(i.bootstrap.job=t,i.job=t,bu(),t.kind==="search"&&t.status==="complete"){const n=Array.isArray(t.result)?t.result:t.result?.studies||[];i.patient=Array.isArray(t.result)?null:t.result?.patient||null,i.studies=Dl(n,!!i.patient?.nameConflict),Ao()}if(t.kind==="series-discovery"&&t.status==="complete"){const n=Array.isArray(t.result?.groups)?t.result.groups:[];i.seriesInventory=Ea(n,i.rememberedSeriesSelections),fs(i.seriesInventory),window.clearInterval(ut),ut=null,vt(),wt(),x(C("Đã quét {} nhóm series; hãy bỏ tích những series không muốn tải.",i.seriesInventory.length));return}if(["download","direct-download","local-import"].includes(t.kind)&&t.status==="complete"){const n=t.result?.archive;if(t.result?.patient&&(i.patient=t.result.patient),Array.isArray(t.result?.studies)){const o=new Map(t.result.studies.map(a=>[a.study_uid,a.local_status]));i.studies.forEach(a=>{o.has(a.study_uid)&&(a.local_status=o.get(a.study_uid))})}if(n){window.clearInterval(ut),ut=null;const o=t.result?.patientFolder||t.result?.output||n.root||"",a=t.result?.sessionId||"";if(!a){x(s("Không tạo được phiên riêng cho hồ sơ vừa tải."),!0),Ce(),lt();return}const r=i.tabs.find(d=>Ci(d.folder,o));let c=r?r.id:"";if(!r){const d=i.activeTabId==="worklist";d&&(Mi(),i.editingPatientInfo=!1,i.patientEditDraft=null);const u=Ni({folder:o});i.tabs.push(u),d&&(i.activeTabId=u.id),c=u.id}On(c,n,a,o),Ce(),lt({silent:!0});return}}if(t.kind==="archive"&&t.status==="complete"){window.clearInterval(ut),ut=null,ks(t.result||{root:"",series:[]}),Ce();return}const e=m.querySelector(".job-log");if(e){const n=e.scrollHeight-e.scrollTop-e.clientHeight<=35,o=e.scrollTop;e.textContent=(t.logs||[]).map(ue).join(`
`),n?e.scrollTop=e.scrollHeight:e.scrollTop=o}if(i.busyViewer||x(ue(t.message||t.status)),["complete","error","stopped"].includes(t.status)){if(window.clearInterval(ut),ut=null,t.status==="error"&&(String(t.message).includes("Không đăng nhập được RIS")||String(t.message).includes("Không thể đăng nhập vào RIS"))){i.showLoginCard=!0,i.loginCardAction=t.kind==="search"?"search":t.kind==="series-discovery"?"discover-series":"download-selected",E();return}Ce(),lt()}}async function Yu(t){if(!window.pywebview?.api?.read_clipboard)return"";try{return(await window.pywebview.api.read_clipboard())?.[t]||""}catch{return""}}function An(t){const e=m.querySelector(`[data-action="clear-${t.id}"]`);e&&(e.hidden=!t.value)}async function Zu(t,e){const n=await Yu(e);return!n||n===t.value.trim()?!1:(t.value=n,e==="url"&&(i.lastDirectUrl=n,no(n)),An(t),!0)}async function Qu(t,e){t.value="",e==="url"&&(i.lastDirectUrl="",no("")),An(t),t.focus()}function th(t,e){t.addEventListener("input",()=>{e==="url"&&(i.lastDirectUrl=t.value),An(t)}),An(t)}function eh(){for(const{id:t,kind:e}of di){const n=m.querySelector(`#${t}`);n&&th(n,e)}}async function fa(){for(const{id:t,kind:e}of di){const n=m.querySelector(`#${t}`);n&&await Zu(n,e)}}function xs(){Yl({label:s("Nội dung ghi chú"),confirm:s("Thêm"),cancel:s("Bỏ")})}async function nh(){if(!m)return;if(!hd)throw new Error(s("Thiếu token phiên local."));i.bootstrap=await N("/api/bootstrap"),wa(i.bootstrap.language||"en"),xs(),i.history=Array.isArray(i.bootstrap.history)?i.bootstrap.history:[],i.sourceFolders=Array.isArray(i.bootstrap.sourceFolders)?i.bootstrap.sourceFolders:[];const t=i.bootstrap.worklist||{};i.worklistPatients=Array.isArray(t.patients)?t.patients:[],i.worklistLoaded=!t.deferred||i.worklistPatients.length>0,i.worklistScannedAt=String(t.scannedAt||""),i.worklistRevision=String(i.bootstrap.worklistRevision||""),i.worklistLoading=!1,i.worklistError="",i.lastDirectUrl=i.bootstrap.lastDirectUrl||"",i.showManualInfo=!!i.lastDirectUrl.trim(),i.status="Đang khởi động...",i.archive=i.bootstrap.archive;const e=i.bootstrap.archiveSessionId||"";if(e&&Ae(e),wi(),i.selectedId=ws(i.archive.series),i.compareIds=[i.archive.series[1]?.id||i.selectedId,i.archive.series[2]?.id||i.archive.series[1]?.id||i.selectedId],i.archive.series&&i.archive.series.length>0){const n=i.archive.root?i.archive.root.split(/[\\/]/).pop():i.archive.patient?.patientName||"Bệnh nhân 1",o={id:"tab-init",sessionId:e,folder:i.archive.root||"",patientId:i.archive.patient?.patientId||"",patientName:i.archive.patient?.patientName||n,archive:i.archive,selectedId:i.selectedId,compareIds:[...i.compareIds],mode:i.mode,tool:i.tool,windowPreset:i.windowPreset,mprPrimary:"axial",scrollLinked:!1,status:"Sẵn sàng.",editingPatientInfo:!1,patientEditDraft:null};Ti(o),i.tabs.push(o),i.activeTabId=o.id}else i.activeTabId="worklist";for(const n of i.archive.series)Yt(n);await Jl({onStatus:(n,o)=>{x(n);const a=document.querySelector("#workspace.busy");a&&o&&(a.dataset.loadingText=`${n} (${o.loaded}/${o.total})`)}}),m.addEventListener("mprprimarychange",n=>{n.detail?.plane&&(i.mprPrimary=n.detail.plane)}),Ju(),$u(),window.addEventListener("pagehide",Ql),window.addEventListener("focus",fa),i.status=s("Sẵn sàng. Nhấn ⌨ trên thanh công cụ để xem phím tắt."),E(),fa(),lt({silent:i.worklistPatients.length>0}),eu(),await Z()}const oh=typeof globalThis.process<"u"&&!!cd?.VITEST||typeof import.meta<"u"&&!1;oh||nh().catch(t=>{/\b(401|403)\b/.test(String(t?.message||""))&&pd(),m.innerHTML=`<div class="fatal-error"><b>${l(s("Không khởi động được DICOM/JPG Downloader & Viewer"))}</b>
      <pre>${l(t.stack||t.message)}</pre>
      <button class="primary" id="fatal-reload">${l(s("Tải lại"))}</button></div>`,document.querySelector("#fatal-reload")?.addEventListener("click",()=>location.reload())});
