"""
dcom_downloader_app.py
======================
Ứng dụng 2 cột:
  • CỘT TRÁI  — tải ảnh: dán link viewer, chọn tùy chọn, bấm "BẮT ĐẦU TẢI".
  • CỘT PHẢI  — trình xem ảnh: sau khi tải xong tự nạp; chọn xung (series), cuộn
                 qua từng lát theo thứ tự tên, xem phim (cine), phóng to/thu nhỏ,
                 xoay/lật/đảo màu, chỉnh sáng–tương phản, lưu ảnh đang xem.

Chạy: nhấp đúp run_app.bat, hoặc:  python dcom_downloader_app.py

Superkent.bui@gmail.com
"""

from __future__ import annotations

import os
import queue
import re
import threading
import traceback
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from PIL import Image, ImageTk, ImageOps, ImageEnhance, ImageDraw

import dcom_pipeline as pipe
import mpr_engine
import viewer_layout
from mpr_viewer import MprWorkspace

IMG_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff")

# Lịch sử tải/xem: lưu ở thư mục người dùng để file .exe đem đi đâu cũng nhớ
HIST_FILE = Path.home() / ".dcom_downloader_history.json"
HIST_MAX = 30


def _make_icon(kind: str, size: int = 22) -> "ImageTk.PhotoImage":
    """Vẽ icon màu cho nút toolbar (tkinter không hiển thị được emoji màu).
    Vẽ ở 4x rồi thu nhỏ để nét mượt. Gọi sau khi đã có cửa sổ Tk."""
    import math
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if kind == "folder":
        lw = max(2, int(s * 0.02))
        # tab + thân sau (đậm), mặt trước sáng hơn cho có chiều sâu
        d.rounded_rectangle([s * 0.05, s * 0.13, s * 0.45, s * 0.40],
                            radius=s * 0.06, fill="#E8A33D", outline="#C07F1F", width=lw)
        d.rounded_rectangle([s * 0.05, s * 0.24, s * 0.95, s * 0.90],
                            radius=s * 0.08, fill="#E8A33D", outline="#C07F1F", width=lw)
        d.rounded_rectangle([s * 0.05, s * 0.36, s * 0.95, s * 0.90],
                            radius=s * 0.08, fill="#FFC94D", outline="#D89A2B", width=lw)
    else:  # refresh
        col = "#1E88E5"
        cx = cy = s / 2
        r = s * 0.32
        d.arc([cx - r, cy - r, cx + r, cy + r], start=20, end=290,
              fill=col, width=int(s * 0.12))
        th = math.radians(290)                      # đầu cung -> gắn mũi tên
        ex, ey = cx + r * math.cos(th), cy + r * math.sin(th)
        tx, ty = -math.sin(th), math.cos(th)        # hướng đi của cung
        nx, ny = math.cos(th), math.sin(th)         # pháp tuyến
        L = s * 0.17
        d.polygon([(ex + tx * L, ey + ty * L),
                   (ex + nx * L * 0.85, ey + ny * L * 0.85),
                   (ex - nx * L * 0.85, ey - ny * L * 0.85)], fill=col)
    return ImageTk.PhotoImage(img.resize((size, size), Image.LANCZOS))

I18N_EN = {
    "1) Dán LINK viewer (còn hạn):": "1) Paste viewer LINK (active):",
    "2) Thư mục lưu:": "2) Save directory:",
    "Chọn...": "Browse...",
    "Tùy chọn": "Options",
    "Chất lượng JPG:": "JPG Quality:",
    "Xuất thêm PNG": "Export PNG too",
    "Tương phản:": "Contrast:",
    "Chuẩn lâm sàng (khuyên dùng)": "Clinical standard (recommended)",
    "Auto-contrast (gắt hơn)": "Auto-contrast (harsher)",
    "Hiện trình duyệt khi tải (bỏ chọn = chạy ẩn)": "Show browser while downloading (uncheck = headless)",
    "BẮT ĐẦU TẢI": "START DOWNLOAD",
    "Dừng": "Stop",
    "Mở thư mục": "Open folder",
    "↻ Thử lại (link + folder cũ)": "↻ Retry (old link + folder)",
    "＋ Tải link mới (folder mới)": "＋ New download (new folder)",
    "Lịch sử:": "History:",
    ">>> LỊCH SỬ: mở lại {}": ">>> HISTORY: reopened {}",
    "Thư mục không còn tồn tại:\n{}": "Folder no longer exists:\n{}",
    "Nhật ký:": "Log:",
    "Sẵn sàng. Dán link viewer rồi bấm 'BẮT ĐẦU TẢI'.": "Ready. Paste viewer link and click 'START DOWNLOAD'.",
    "Xem lại ảnh cũ: bấm nút 📂 bên phải.": "Review old images: click the 📂 button on the right.",
    "Xung (series):": "Pulse (series):",
    "Nạp thư mục ảnh...": "Load image folder...",
    "Nạp lại thư mục đang mở": "Reload current folder",
    "▶ Phim": "▶ Play",
    "⏸ Dừng": "⏸ Pause",
    "－ Thu nhỏ": "－ Zoom out",
    "＋ Phóng to": "＋ Zoom in",
    "Vừa khung": "Fit",
    "Xoay 90°": "Rotate 90°",
    "Lật ⇔": "Flip ⇔",
    "Lật ⇕": "Flip ⇕",
    "Đảo màu": "Invert color",
    "Đặt lại": "Reset view",
    "Sáng": "Brightness",
    "Tương phản": "Contrast",
    "Lưu ảnh...": "Save image...",
    "Chưa có ảnh. Tải xong sẽ tự nạp, hoặc bấm nút 📂.": "No images yet. Will auto-load after download, or click the 📂 button.",
    "DICOM/JPG Downloader & Viewer": "DICOM/JPG Downloader & Viewer",
    "Superkent.bui@gmail.com": "Superkent.bui@gmail.com",
    "Xác nhận thoát": "Confirm Exit",
    "Đang có tiến trình tải / chuyển đổi ảnh đang chạy.\nBạn có chắc chắn muốn hủy và thoát ứng dụng không?": "A download/conversion process is currently running.\nAre you sure you want to cancel and exit the application?",
    "🏥 TẢI TOÀN BỘ MRI / CT THEO MÃ BỆNH NHÂN (RIS)": "🏥 DOWNLOAD ALL MRI & CT BY PATIENT ID (RIS)",
    "Chọn viện:": "Select hospital:",
    "Mã BN:": "Patient ID:",
    "🔍 TÌM & TẢI MRI / CT": "🔍 SEARCH & DOWNLOAD MRI & CT",
    "🔗 HOẶC DÁN LINK VIEWER TRỰC TIẾP:": "🔗 OR PASTE DIRECT VIEWER LINK:",
    "Thiếu mã bệnh nhân": "Missing Patient ID",
    "Vui lòng nhập MÃ BỆNH NHÂN (vd: 2605032022).": "Please enter PATIENT ID (e.g., 2605032022).",
    "Mã bệnh nhân không hợp lệ": "Invalid Patient ID",
    "Mã bệnh nhân chỉ bao gồm chữ cái và chữ số, không chứa khoảng trắng hoặc ký tự đặc biệt.": "Patient ID must contain letters and numbers only, with no spaces or special characters.",
    "Chọn ca chụp cần tải - BN: ": "Select studies to download - Patient: ",
    "Tích chọn các ca chụp bạn muốn tải về, hoặc bấm 'TẢI TẤT CẢ':": "Check the studies you want to download, or click 'DOWNLOAD ALL':",
    "Chọn": "Select",
    "Ngày chụp": "Study Date",
    "Loại phim": "Modality",
    "Mô tả ca chụp": "Study Description",
    "☑ Chọn tất cả": "☑ Select All",
    "☐ Bỏ chọn tất cả": "☐ Deselect All",
    "❌ Hủy": "❌ Cancel",
    "⚡ TẢI TẤT CẢ": "⚡ DOWNLOAD ALL",
    "Chưa chọn ca nào": "No study selected",
    "Vui lòng tích chọn ít nhất 1 ca chụp để tải về!": "Please check at least 1 study to download!",
    ">>> Đã hủy chọn ca chụp.": ">>> Canceled study selection.",

    "Thiếu link": "Missing link",
    "Hãy dán LINK viewer hợp lệ (bắt đầu bằng http).": "Please paste a valid viewer LINK (starting with http).",
    "Thử lại": "Retry",
    "Chưa có lần tải nào để thử lại.": "No previous download to retry.",
    ">>> THỬ LẠI: link cũ, gộp vào {}": ">>> RETRY: old link, merging into {}",
    ">>> Sẵn sàng cho LINK MỚI. Dán link tiếp theo rồi bấm 'BẮT ĐẦU TẢI'.": ">>> Ready for NEW LINK. Paste the next link and click 'START DOWNLOAD'.",
    "    Folder mới: {}": "    New folder: {}",
    ">>> Đang yêu cầu dừng... (chờ bước hiện tại kết thúc)": ">>> Requesting stop... (waiting for current step to finish)",
    "LỖI:\n{}": "ERROR:\n{}",
    "Tải được {} ảnh.": "Downloaded {} images.",
    "Chọn thư mục lưu": "Select save directory",
    "Thư mục": "Directory",
    "Ảnh nằm ở:\n{}\n\n({})": "Images located at:\n{}\n\n({})",
    "Chọn thư mục chứa ảnh (JPG/PNG)": "Select image folder (JPG/PNG)",
    "Lỗi": "Error",
    "Không đọc được thư mục:\n{}": "Cannot read directory:\n{}",
    "Không có ảnh": "No images",
    "Không tìm thấy ảnh JPG/PNG trong:\n{}": "No JPG/PNG images found in:\n{}",
    "Đã nạp trình xem: {} series, {} ảnh từ {}": "Loaded viewer: {} series, {} images from {}",
    "Đã nạp lại: {} series, {} ảnh từ {}": "Reloaded: {} series, {} images from {}",
    "Chưa có thư mục ảnh nào đang mở để nạp lại.": "No image folder is currently open to reload.",
    "Lỗi mở ảnh: {} ({})": "Error opening image: {} ({})",
    "Lưu ảnh đang xem": "Save viewing image",
    "PNG (không mất dữ liệu)": "PNG (lossless)",
    "Đã lưu: {}": "Saved: {}",
    "Lỗi lưu": "Save error",
}

# --------------------------------------------------------------------------- #
#  Tiện ích nạp ảnh theo series (dùng lại được, dễ kiểm thử)
# --------------------------------------------------------------------------- #

def _natkey(name: str):
    """Sắp xếp tự nhiên: IM_2 < IM_10."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _series_sort_key(name: str):
    m = re.search(r"Series[_\s]*(\d+)", name)
    return (int(m.group(1)) if m else 10 ** 9, name.lower())


def scan_series(base: Path) -> "dict[str, list[Path]]":
    """
    Quét thư mục thành map: tên series -> danh sách ảnh (đã sắp xếp).
    - Nếu có thư mục con chứa ảnh (Series_...), mỗi thư mục là 1 series.
    - Nếu có ảnh nằm thẳng trong `base`, gộp thành 1 series.
    - Tự bỏ qua thư mục con "DICOM"/"RAW_JPG"; nếu `base` chính là thư mục tải về
      (có thư mục con "JPG") thì tự nhảy vào "JPG".
    """
    base = Path(base)
    series: "dict[str, list[Path]]" = {}

    def imgs_in(d: Path):
        manifest = mpr_engine.read_manifest(d)
        if manifest:
            # Gói MPR luôn dùng thứ tự tọa độ đã ghi trong manifest, không sắp
            # theo tên file/InstanceNumber. Đồng thời bỏ qua JPG cũ còn sót lại
            # nếu một folder được nâng cấp từ bản trước.
            ordered = mpr_engine.manifest_image_files(d, manifest)
            if ordered:
                return ordered
        return sorted(
            [p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXTS],
            key=lambda p: _natkey(p.name),
        )

    # Ảnh nằm thẳng trong base (folder phẳng)
    direct = imgs_in(base)
    if direct:
        series[base.name] = direct

    # Mọi thư mục con (bất kỳ độ sâu) CHỨA ẢNH TRỰC TIẾP -> mỗi cái là 1 series.
    # Nhờ vậy nhận được cả cấu trúc cũ (…/JPG/Series_*) lẫn mới
    # (…/<ngày - tuổi - mô tả>/Series_*). Bỏ qua DICOM/RAW_JPG.
    all_dirs = [p for p in base.rglob("*") if p.is_dir()]
    for sub in sorted(all_dirs, key=lambda d: _series_sort_key(d.name)):
        rel = sub.relative_to(base).parts
        if any(part in ("DICOM", "RAW_JPG") for part in rel):
            continue
        ims = imgs_in(sub)
        if ims:
            series[sub.name] = ims

    return series


# --------------------------------------------------------------------------- #
#  BẢNG TÍCH CHỌN CA CHỤP (STUDY SELECTION DIALOG)
# --------------------------------------------------------------------------- #

class StudySelectionDialog(tk.Toplevel):
    def __init__(self, parent, studies: list[dict], patient_id: str, hosp_name: str, app_instance):
        super().__init__(parent)
        self.studies = studies
        self.patient_id = patient_id
        self.hosp_name = hosp_name
        self.app = app_instance
        self.result_uids = None  # None = Canceled, list = selected UIDs

        self.title(self.app._t("Chọn ca chụp cần tải - BN: ") + patient_id)
        self.geometry("780x480")
        self.minsize(640, 360)
        self.transient(parent)
        self.grab_set()

        # Header
        top_frame = ttk.Frame(self, padding=10)
        top_frame.pack(fill="x")
        header_lbl = f"🏥 TÌM THẤY {len(studies)} CA CHỤP CHO BỆNH NHÂN: {patient_id} ({hosp_name})"
        ttk.Label(top_frame, text=header_lbl, font=("Segoe UI", 11, "bold")).pack(anchor="w")
        ttk.Label(top_frame, text=self.app._t("Tích chọn các ca chụp bạn muốn tải về, hoặc bấm 'TẢI TẤT CẢ':"),
                  foreground="gray").pack(anchor="w", pady=(2, 0))

        # Table area
        tree_frame = ttk.Frame(self, padding=(10, 0, 10, 5))
        tree_frame.pack(fill="both", expand=True)

        cols = ("check", "date", "modality", "desc")
        self.tree = ttk.Treeview(tree_frame, columns=cols, show="headings", selectmode="none")
        self.tree.heading("check", text=self.app._t("Chọn"), anchor="center")
        self.tree.heading("date", text=self.app._t("Ngày chụp"), anchor="w")
        self.tree.heading("modality", text=self.app._t("Loại phim"), anchor="center")
        self.tree.heading("desc", text=self.app._t("Mô tả ca chụp"), anchor="w")

        self.tree.column("check", width=70, anchor="center")
        self.tree.column("date", width=160, anchor="w")
        self.tree.column("modality", width=90, anchor="center")
        self.tree.column("desc", width=380, anchor="w")

        vbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vbar.set)

        self.tree.pack(side="left", fill="both", expand=True)
        vbar.pack(side="right", fill="y")

        self.checked_state = {}
        for st in self.studies:
            uid = st["study_uid"]
            self.checked_state[uid] = True  # default all checked
            item_id = self.tree.insert("", "end", iid=uid, values=(
                "☑",
                st.get("date", "—"),
                st.get("modality", "MR/CT"),
                st.get("desc", "—")
            ))

        self.tree.bind("<Button-1>", self._on_click)

        # Toolbar & Buttons
        btn_frame = ttk.Frame(self, padding=10)
        btn_frame.pack(fill="x")

        ttk.Button(btn_frame, text=self.app._t("☑ Chọn tất cả"), command=self._select_all).pack(side="left", padx=(0, 4))
        ttk.Button(btn_frame, text=self.app._t("☐ Bỏ chọn tất cả"), command=self._deselect_all).pack(side="left")

        ttk.Button(btn_frame, text=self.app._t("❌ Hủy"), command=self._on_cancel).pack(side="right", padx=(6, 0))
        self.download_btn = ttk.Button(btn_frame, text="", command=self._on_download_selected)
        self.download_btn.pack(side="right", padx=(6, 0))
        ttk.Button(btn_frame, text=self.app._t("⚡ TẢI TẤT CẢ"), command=self._on_download_all).pack(side="right")

        self._update_button_text()
        self.protocol("WM_DELETE_WINDOW", self._on_cancel)

    def _on_click(self, event):
        region = self.tree.identify_region(event.x, event.y)
        if region == "cell":
            item_id = self.tree.identify_row(event.y)
            if item_id in self.checked_state:
                self.checked_state[item_id] = not self.checked_state[item_id]
                new_icon = "☑" if self.checked_state[item_id] else "☐"
                vals = list(self.tree.item(item_id, "values"))
                vals[0] = new_icon
                self.tree.item(item_id, values=vals)
                self._update_button_text()

    def _select_all(self):
        for uid in self.checked_state:
            self.checked_state[uid] = True
            vals = list(self.tree.item(uid, "values"))
            vals[0] = "☑"
            self.tree.item(uid, values=vals)
        self._update_button_text()

    def _deselect_all(self):
        for uid in self.checked_state:
            self.checked_state[uid] = False
            vals = list(self.tree.item(uid, "values"))
            vals[0] = "☐"
            self.tree.item(uid, values=vals)
        self._update_button_text()

    def _update_button_text(self):
        selected_count = sum(1 for v in self.checked_state.values() if v)
        self.download_btn.config(text=f"⬇️ TẢI CA ĐÃ CHỌN ({selected_count}/{len(self.studies)})")

    def _on_download_selected(self):
        selected = [uid for uid, checked in self.checked_state.items() if checked]
        if not selected:
            messagebox.showwarning(self.app._t("Chưa chọn ca nào"),
                                   self.app._t("Vui lòng tích chọn ít nhất 1 ca chụp để tải về!"))
            return
        self.result_uids = selected
        self.destroy()

    def _on_download_all(self):
        self.result_uids = [st["study_uid"] for st in self.studies]
        self.destroy()

    def _on_cancel(self):
        self.result_uids = None
        self.destroy()


# --------------------------------------------------------------------------- #
#  Ứng dụng
# --------------------------------------------------------------------------- #

class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.lang = "vi"
        self._t_widgets = []

        def patch_widget(cls):
            orig = cls
            def wrapper(*args, **kwargs):
                orig_text = kwargs.get("text", "")
                if orig_text:
                    kwargs["text"] = self._t(orig_text)
                w = orig(*args, **kwargs)
                if orig_text:
                    self._t_widgets.append((w, "text", orig_text))
                return w
            return wrapper

        ttk.Label = patch_widget(ttk.Label)
        ttk.Button = patch_widget(ttk.Button)
        ttk.Checkbutton = patch_widget(ttk.Checkbutton)
        ttk.LabelFrame = patch_widget(ttk.LabelFrame)

        root.title(self._t("DICOM/JPG Downloader & Viewer"))
        self._t_widgets.append((root, "title", "DICOM/JPG Downloader & Viewer"))
        screen_w = root.winfo_screenwidth()
        screen_h = root.winfo_screenheight()
        initial_w = min(1360, max(1024, screen_w - 24))
        initial_h = min(860, max(640, screen_h - 72))
        root.geometry(f"{initial_w}x{initial_h}")
        root.minsize(1024, 640)

        # --- trạng thái tải ---
        self.msg_q: "queue.Queue[tuple[str, object]]" = queue.Queue()
        self.worker: "threading.Thread | None" = None
        self.stop_flag = threading.Event()
        self.last_jpg_dir: "Path | None" = None
        self.last_url: "str | None" = None
        self.last_out_base: "Path | None" = None
        self.viewer_dir: "Path | None" = None  # thư mục ảnh đang mở ở trình xem
        self.history: "list[dict]" = []

        # --- trạng thái trình xem ---
        self.series_map: "dict[str, list[Path]]" = {}
        self.cur_files: "list[Path]" = []
        self.cur_index = 0
        self.base_img: "Image.Image | None" = None
        self.tk_img = None
        self.zoom = 1.0
        self.fit_mode = True
        self.rotate = 0
        self.flip_h = False
        self.flip_v = False
        self.invert = False
        self.cine_playing = False
        self.cine_job = None
        self._syncing_slider = False
        self.viewer_mode = "2d"
        self.pan_2d_enabled = tk.BooleanVar(value=False)
        self.fit_policy_2d = tk.StringVar(value="contain")
        self.viewer_layout = "single"
        self.compare_series_var = tk.StringVar()
        self.compare_files: list[Path] = []
        self.compare_index = 0
        self.active_2d_pane = "left"
        self._image_cache: dict[Path, Image.Image] = {}
        self.download_panel_collapsed = False
        self._saved_sash = 470
        self._mpr_auto_collapsed = False

        self._build_ui()
        self._load_history()
        self._refresh_history_combo()
        self.root.bind("<FocusIn>", self._on_window_focus)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(100, self._poll_queue)
        self.root.after(200, lambda: self._set_sash(470))

    def _t(self, vi_text):
        if getattr(self, "lang", "vi") == "vi": return vi_text
        return I18N_EN.get(vi_text, vi_text)

    def _add_tooltip(self, widget, vi_text):
        """Chú thích nhỏ khi rê chuột lên nút dạng icon (dịch lúc hiện)."""
        tip = {"win": None}

        def show(_e=None):
            if tip["win"] is not None:
                return
            x = widget.winfo_rootx() + 10
            y = widget.winfo_rooty() + widget.winfo_height() + 4
            win = tk.Toplevel(widget)
            win.wm_overrideredirect(True)
            win.wm_geometry(f"+{x}+{y}")
            tk.Label(win, text=self._t(vi_text), background="#ffffe0",
                     relief="solid", borderwidth=1, padx=6, pady=2).pack()
            tip["win"] = win

        def hide(_e=None):
            if tip["win"] is not None:
                tip["win"].destroy()
                tip["win"] = None

        widget.bind("<Enter>", show)
        widget.bind("<Leave>", hide)
        widget.bind("<ButtonPress>", hide)

    def _auto_paste_url(self, event=None):
        """Tự động dán link mới từ bộ nhớ tạm (clipboard) vào ô link khi nhấp chuột/focus."""
        try:
            clip = self.root.clipboard_get().strip()
        except Exception:
            return
        if clip and clip.lower().startswith(("http://", "https://", "www.")):
            current = self.url_var.get().strip()
            if current != clip:
                self.url_var.set(clip)
                self.url_ent.select_range(0, tk.END)
                self.url_ent.icursor(tk.END)

    def _on_window_focus(self, event=None):
        if event and event.widget == self.root:
            self._auto_paste_url()
            self._auto_paste_pid()

    def _is_busy(self) -> bool:
        """Kiểm tra xem ứng dụng có đang chạy tác vụ tải hoặc chuyển đổi ảnh hay không."""
        return self.worker is not None and self.worker.is_alive()

    def _on_close(self):
        """Hỏi xác nhận khi thoát ứng dụng nếu có tác vụ đang chạy; thoát trực tiếp nếu rảnh."""
        if self._is_busy():
            ans = messagebox.askyesno(
                self._t("Xác nhận thoát"),
                self._t("Đang có tiến trình tải / chuyển đổi ảnh đang chạy.\nBạn có chắc chắn muốn hủy và thoát ứng dụng không?"),
                icon="warning"
            )
            if not ans:
                return
            self._stop()

        if self.cine_playing:
            self.cine_playing = False

        pipe.clear_ris_session_cache()
        self.root.destroy()

    def _auto_paste_pid(self, event=None):
        """Tự động dán Mã Bệnh Nhân từ bộ nhớ tạm (clipboard) chỉ khi là dãy ký tự chữ/số không có khoảng trắng hoặc ký tự đặc biệt."""
        try:
            clip = self.root.clipboard_get().strip()
        except Exception:
            return
        if clip and re.fullmatch(r"[A-Za-z0-9]+", clip):
            current = self.pid_var.get().strip()
            if current != clip:
                self.pid_var.set(clip)
                self.pid_ent.select_range(0, tk.END)
                self.pid_ent.icursor(tk.END)

    def _toggle_lang(self):
        self.lang = "en" if self.lang == "vi" else "vi"
        self.lang_btn.config(text="🇻🇳 VI" if self.lang == "en" else "🇬🇧 EN")
        for w, attr, orig in self._t_widgets:
            try:
                if attr == "title": w.title(self._t(orig))
                else: w.config(**{attr: self._t(orig)})
            except: pass

        vals = [self._t("Chuẩn lâm sàng (khuyên dùng)"), self._t("Auto-contrast (gắt hơn)")]
        self.contrast_cbo.config(values=vals)
        cur = self.contrast_mode_var.get().lower()
        if "auto" in cur or "gắt" in cur or "harsher" in cur:
            self.contrast_mode_var.set(self._t("Auto-contrast (gắt hơn)"))
        else:
            self.contrast_mode_var.set(self._t("Chuẩn lâm sàng (khuyên dùng)"))

        if self.cine_playing:
            self.play_btn.config(text=self._t("⏸ Dừng"))
        else:
            self.play_btn.config(text=self._t("▶ Phim"))

        current_log = self.log_text.get("1.0", "end").strip()
        vi_logs = "Sẵn sàng. Dán link viewer rồi bấm 'BẮT ĐẦU TẢI'.\nXem lại ảnh cũ: bấm nút 📂 bên phải."
        en_logs = "Ready. Paste viewer link and click 'START DOWNLOAD'.\nReview old images: click the 📂 button on the right."
        if current_log == vi_logs or current_log == en_logs:
            self.log_text.config(state="normal")
            self.log_text.delete("1.0", "end")
            self.log_text.insert("end", self._t("Sẵn sàng. Dán link viewer rồi bấm 'BẮT ĐẦU TẢI'.") + "\n" + self._t("Xem lại ảnh cũ: bấm nút 📂 bên phải.") + "\n")
            self.log_text.config(state="disabled")

    # ================================================================= UI
    def _build_ui(self):
        self.paned = ttk.PanedWindow(self.root, orient="horizontal")
        self.paned.pack(fill="both", expand=True)

        self.left_panel = ttk.Frame(self.paned)
        self.right_panel = ttk.Frame(self.paned)
        self.paned.add(self.left_panel, weight=0)
        self.paned.add(self.right_panel, weight=1)

        self._build_left(self.left_panel)
        self._build_right(self.right_panel)

    def _set_sash(self, x):
        try:
            self.paned.sashpos(0, x)
        except Exception:
            pass

    def _toggle_download_panel(self, collapse=None, manual=True):
        """Hide/show the downloader pane without destroying its form state."""
        if manual:
            self._mpr_auto_collapsed = False
        target = (not self.download_panel_collapsed) if collapse is None else bool(collapse)
        if target == self.download_panel_collapsed:
            return
        if target:
            try:
                self._saved_sash = max(360, int(self.paned.sashpos(0)))
            except Exception:
                pass
            self.paned.forget(self.left_panel)
            self.download_panel_collapsed = True
            self.panel_toggle_btn.config(text="Hiện tải")
        else:
            self.paned.insert(0, self.left_panel, weight=0)
            self.download_panel_collapsed = False
            self.panel_toggle_btn.config(text="Ẩn tải")
            self.root.after_idle(lambda: self._set_sash(self._saved_sash))

    def _current_series_has_mpr(self) -> bool:
        return bool(
            self.cur_files
            and mpr_engine.read_manifest(self.cur_files[0].parent)
        )

    def _sync_mode_buttons(self) -> None:
        if not hasattr(self, "mode_2d_btn"):
            return
        active_2d = self.viewer_mode == "2d"
        for button, layout, label, minimum in (
            (self.mode_2d_btn, "single", "1x1", 1),
            (self.compare_btn, "compare", "1|1", 1),
            (self.montage6_btn, "montage6", "3x2", 6),
            (self.montage8_btn, "montage8", "4x2", 8),
        ):
            enabled = len(self.cur_files) >= minimum
            if layout == "compare":
                enabled = len(self.series_map) >= 2
            button.config(
                text=("\u25cf " + label) if active_2d and self.viewer_layout == layout else label,
                state="normal" if enabled else "disabled",
            )
        has_mpr = self._current_series_has_mpr()
        self.mpr_btn.config(
            text="\u25cf MPR" if self.viewer_mode == "mpr" else "MPR",
            state="normal" if has_mpr else "disabled",
        )

    def _refresh_compare_series_options(self) -> None:
        primary = self.series_var.get()
        names = [name for name in self.series_map if name != primary]
        self.compare_cbo.config(values=names)
        selected = self.compare_series_var.get()
        if selected not in names:
            selected = names[0] if names else ""
            self.compare_series_var.set(selected)
        self.compare_files = self.series_map.get(selected, [])
        self.compare_index = max(0, min(self.compare_index, len(self.compare_files) - 1))

    def _normalize_2d_layout(self) -> None:
        """Fall back to one image when the newly selected data cannot fill a layout."""
        invalid = (
            (self.viewer_layout == "compare" and len(self.series_map) < 2)
            or (self.viewer_layout == "montage6" and len(self.cur_files) < 6)
            or (self.viewer_layout == "montage8" and len(self.cur_files) < 8)
        )
        if invalid:
            self.viewer_layout = "single"
            self.active_2d_pane = "left"
            if hasattr(self, "compare_bar"):
                self.compare_bar.pack_forget()

    def _on_compare_series_change(self) -> None:
        self.compare_files = self.series_map.get(self.compare_series_var.get(), [])
        self.compare_index = 0
        self.active_2d_pane = "right"
        self._sync_2d_navigation()
        self._render()

    def _set_2d_layout(self, layout: str) -> bool:
        if layout not in ("single", "compare", "montage6", "montage8"):
            raise ValueError(f"Unknown 2D layout: {layout}")
        if layout == "compare" and len(self.series_map) < 2:
            self.root.bell()
            return False
        required = 6 if layout == "montage6" else 8 if layout == "montage8" else 1
        if len(self.cur_files) < required:
            self.root.bell()
            return False
        if self.viewer_mode == "mpr":
            self._set_viewer_mode("2d")
        self.viewer_layout = layout
        self.active_2d_pane = "left"
        if layout == "compare":
            self._refresh_compare_series_options()
            self.compare_bar.pack(fill="x", padx=6, pady=(0, 2), before=self.tb2)
        else:
            self.compare_bar.pack_forget()
        self.fit_mode = True
        self._sync_2d_navigation()
        self._sync_mode_buttons()
        self._render()
        return True

    def _sync_2d_navigation(self) -> None:
        if not hasattr(self, "slice_scale"):
            return
        files = self.cur_files
        index = self.cur_index
        if self.viewer_layout == "compare" and self.active_2d_pane == "right":
            files = self.compare_files
            index = self.compare_index
        self._syncing_slider = True
        try:
            self.slice_scale.config(from_=0, to=max(0, len(files) - 1))
            self.slice_scale.set(index if files else 0)
        finally:
            self._syncing_slider = False

        if self.viewer_layout == "compare":
            left = f"L {self.cur_index + 1}/{len(self.cur_files)}" if self.cur_files else "L -"
            right = f"R {self.compare_index + 1}/{len(self.compare_files)}" if self.compare_files else "R -"
            marker = "L" if self.active_2d_pane == "left" else "R"
            self.idx_lbl.config(text=f"{left} | {right} [{marker}]")
        elif self.viewer_layout in ("montage6", "montage8"):
            count = 6 if self.viewer_layout == "montage6" else 8
            end = min(len(self.cur_files), self.cur_index + count)
            self.idx_lbl.config(text=f"{self.cur_index + 1}-{end}/{len(self.cur_files)}")
        else:
            self.idx_lbl.config(
                text=f"{self.cur_index + 1}/{len(self.cur_files)}" if self.cur_files else "-",
            )

    def _set_viewer_mode(self, mode: str) -> bool:
        """Switch the embedded workspace while preserving the loaded MPR volume."""
        if mode not in ("2d", "mpr"):
            raise ValueError(f"Viewer mode không hợp lệ: {mode}")
        if mode == self.viewer_mode:
            self._sync_mode_buttons()
            return True
        if mode == "mpr":
            if not self._current_series_has_mpr():
                messagebox.showinfo(
                    "Không có dữ liệu MPR",
                    "Series này không có mpr-volume.json. MPR chỉ được tạo cho "
                    "T1 sau tiêm đủ trên 100 lát, hoặc T1 không tiêm khi không "
                    "có series sau tiêm.",
                )
                return False
            if self.cine_playing:
                self._toggle_cine()
            try:
                self.mpr_workspace.load_series(self.cur_files[0].parent)
                self.mpr_workspace.set_display_mode("mpr")
            except Exception as exc:
                messagebox.showerror("Không mở được MPR", str(exc))
                return False
            self.viewer_2d.pack_forget()
            self.mpr_workspace.pack(fill="both", expand=True)
            self.viewer_mode = "mpr"
            self._mpr_auto_collapsed = not self.download_panel_collapsed
            if self._mpr_auto_collapsed:
                self._toggle_download_panel(collapse=True, manual=False)
        else:
            self.mpr_workspace.pack_forget()
            self.viewer_2d.pack(fill="both", expand=True)
            self.viewer_mode = "2d"
            if self._mpr_auto_collapsed and self.download_panel_collapsed:
                self._toggle_download_panel(collapse=False, manual=False)
            self._mpr_auto_collapsed = False
            self.root.after_idle(self._render)
        self._sync_mode_buttons()
        return True

    def _viewer_prev(self, _event=None):
        if self.viewer_mode == "mpr":
            self.mpr_workspace.step_plane(self.mpr_workspace.active_plane, -1)
        else:
            self._prev()
        return "break"

    def _viewer_next(self, _event=None):
        if self.viewer_mode == "mpr":
            self.mpr_workspace.step_plane(self.mpr_workspace.active_plane, 1)
        else:
            self._next()
        return "break"

    def _viewer_space(self, _event=None):
        if self.viewer_mode == "2d":
            self._toggle_cine()
        return "break"

    def _viewer_escape(self, _event=None):
        if self.viewer_mode == "mpr":
            self.mpr_workspace.cancel_draft()
            return "break"
        return None

    def _viewer_return(self, _event=None):
        if self.viewer_mode == "mpr":
            self.mpr_workspace.finish_polygon()
            return "break"
        return None

    # -------------------------------------------------- CỘT TRÁI (tải ảnh)
    def _build_left(self, frm):
        pad = dict(padx=10, pady=5)

        lang_frm = ttk.Frame(frm)
        lang_frm.pack(fill="x", padx=10, pady=(5, 0))
        self.lang_btn = ttk.Button(lang_frm, command=self._toggle_lang, width=5)
        self.lang_btn.config(text="🇬🇧 EN")
        self.lang_btn.pack(side="right")

        # Frame Tải tự động theo Mã Bệnh Nhân (RIS)
        ris_frame = ttk.LabelFrame(frm, text="🏥 TẢI TOÀN BỘ MRI / CT THEO MÃ BỆNH NHÂN (RIS)")
        ris_frame.pack(fill="x", padx=10, pady=(6, 4))

        rf1 = ttk.Frame(ris_frame); rf1.pack(fill="x", padx=6, pady=3)
        ttk.Label(rf1, text="Chọn viện:", font=("Segoe UI", 9, "bold")).pack(side="left")
        self.hosp_var = tk.StringVar(value="dhy")
        ttk.Radiobutton(rf1, text="🏥 BV Đại học Y", variable=self.hosp_var, value="dhy").pack(side="left", padx=(8, 4))
        ttk.Radiobutton(rf1, text="🏥 BV Việt Đức", variable=self.hosp_var, value="vduh").pack(side="left", padx=4)

        rf2 = ttk.Frame(ris_frame); rf2.pack(fill="x", padx=6, pady=4)
        ttk.Label(rf2, text="Mã BN:").pack(side="left")
        self.pid_var = tk.StringVar()
        self.pid_ent = ttk.Entry(rf2, textvariable=self.pid_var, width=14)
        self.pid_ent.pack(side="left", padx=(4, 6))
        self.pid_ent.bind("<FocusIn>", self._auto_paste_pid)
        self.pid_ent.bind("<Button-1>", self._auto_paste_pid)

        self.start_mri_btn = ttk.Button(rf2, text="🔍 TÌM & TẢI MRI / CT", command=self._start_mri_patient)
        self.start_mri_btn.pack(side="left", fill="x", expand=True)

        ttk.Label(frm, text="🔗 HOẶC DÁN LINK VIEWER TRỰC TIẾP:",
                  font=("Segoe UI", 10, "bold")).pack(anchor="w", **pad)
        self.url_var = tk.StringVar()
        self.url_ent = ttk.Entry(frm, textvariable=self.url_var)
        self.url_ent.pack(fill="x", padx=10)
        self.url_ent.bind("<FocusIn>", self._auto_paste_url)
        self.url_ent.bind("<Button-1>", self._auto_paste_url)

        ttk.Label(frm, text="2) Thư mục lưu:",
                  font=("Segoe UI", 10, "bold")).pack(anchor="w", **pad)
        out_row = ttk.Frame(frm); out_row.pack(fill="x", padx=10)
        self.out_var = tk.StringVar(value=str(Path.cwd() / f"Tai_ve_{datetime.now():%Y%m%d_%H%M%S}"))
        ttk.Entry(out_row, textvariable=self.out_var).pack(side="left", fill="x", expand=True)
        ttk.Button(out_row, text="Chọn...", command=self._pick_folder).pack(side="left", padx=(6, 0))

        opt = ttk.LabelFrame(frm, text="Tùy chọn")
        opt.pack(fill="x", padx=10, pady=8)
        r1 = ttk.Frame(opt); r1.pack(fill="x", padx=8, pady=5)
        ttk.Label(r1, text="Chất lượng JPG:").pack(side="left")
        self.quality_var = tk.IntVar(value=100)
        ttk.Spinbox(r1, from_=70, to=100, width=5, textvariable=self.quality_var).pack(side="left", padx=(4, 16))
        self.png_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(r1, text="Xuất thêm PNG", variable=self.png_var).pack(side="left")

        r2 = ttk.Frame(opt); r2.pack(fill="x", padx=8, pady=(0, 5))
        ttk.Label(r2, text="Tương phản:").pack(side="left")
        self.contrast_mode_var = tk.StringVar(value=self._t("Chuẩn lâm sàng (khuyên dùng)"))
        self.contrast_cbo = ttk.Combobox(r2, textvariable=self.contrast_mode_var, width=28, state="readonly",
                     values=[self._t("Chuẩn lâm sàng (khuyên dùng)"), self._t("Auto-contrast (gắt hơn)")])
        self.contrast_cbo.pack(side="left")

        r3 = ttk.Frame(opt); r3.pack(fill="x", padx=8, pady=(0, 5))
        self.show_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(r3, text="Hiện trình duyệt khi tải (bỏ chọn = chạy ẩn)",
                        variable=self.show_var).pack(side="left")

        btn_row = ttk.Frame(frm); btn_row.pack(fill="x", padx=10, pady=(0, 2))
        self.start_btn = ttk.Button(btn_row, text="BẮT ĐẦU TẢI", command=self._start)
        self.start_btn.pack(side="left")
        self.stop_btn = ttk.Button(btn_row, text="Dừng", command=self._stop, state="disabled")
        self.stop_btn.pack(side="left", padx=6)
        self.open_btn = ttk.Button(btn_row, text="Mở thư mục", command=self._open_folder, state="disabled")
        self.open_btn.pack(side="left")

        btn_row2 = ttk.Frame(frm); btn_row2.pack(fill="x", padx=10, pady=(0, 6))
        self.retry_btn = ttk.Button(btn_row2, text="↻ Thử lại (link + folder cũ)",
                                    command=self._retry, state="disabled")
        self.retry_btn.pack(side="left")
        self.new_btn = ttk.Button(btn_row2, text="＋ Tải link mới (folder mới)",
                                  command=self._new_download)
        self.new_btn.pack(side="left", padx=6)

        hist_row = ttk.Frame(frm); hist_row.pack(fill="x", padx=10, pady=(0, 6))
        ttk.Label(hist_row, text="Lịch sử:").pack(side="left")
        self.history_var = tk.StringVar()
        self.history_cbo = ttk.Combobox(hist_row, textvariable=self.history_var,
                                        state="readonly")
        self.history_cbo.pack(side="left", fill="x", expand=True, padx=(4, 0))
        self.history_cbo.bind("<<ComboboxSelected>>", lambda e: self._on_history_select())

        self.progress = ttk.Progressbar(frm, mode="indeterminate")
        self.progress.pack(fill="x", padx=10, pady=(0, 6))

        ttk.Label(frm, text="Nhật ký:", font=("Segoe UI", 10, "bold")).pack(anchor="w", padx=10)
        log_frame = ttk.Frame(frm); log_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.log_text = tk.Text(log_frame, height=12, wrap="word", width=52,
                                bg="#1e1e1e", fg="#e0e0e0", insertbackground="#e0e0e0")
        self.log_text.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        sb.pack(side="right", fill="y")
        self.log_text.config(yscrollcommand=sb.set, state="disabled")

        footer = ttk.Frame(frm)
        footer.pack(fill="x", padx=10, pady=(0, 5))
        ttk.Label(footer, text="Superkent.bui@gmail.com",
                  font=("Segoe UI", 9, "italic"), foreground="gray").pack(side="right")

        self._log(self._t("Sẵn sàng. Dán link viewer rồi bấm 'BẮT ĐẦU TẢI'."))
        self._log(self._t("Xem lại ảnh cũ: bấm nút 📂 bên phải."))

    # ------------------------------------------------ CỘT PHẢI (trình xem)
    def _build_right(self, frm):
        # Thanh chung: chọn series, layout và panel tải. MPR dùng lại chính vùng
        # workspace bên dưới, không mở thêm cửa sổ.
        tb1 = ttk.Frame(frm)
        tb1.pack(fill="x", padx=6, pady=(6, 2))
        tb1.columnconfigure(1, weight=1)
        ttk.Label(tb1, text="Series:").grid(row=0, column=0, sticky="w")
        self.series_var = tk.StringVar()
        self.series_cbo = ttk.Combobox(
            tb1, textvariable=self.series_var, state="readonly", width=34
        )
        self.series_cbo.grid(row=0, column=1, sticky="ew", padx=4)
        self.series_cbo.bind("<<ComboboxSelected>>", lambda e: self._on_series_change())
        self._icon_folder = _make_icon("folder")    # giữ tham chiếu kẻo bị GC
        self._icon_refresh = _make_icon("refresh")
        load_btn = ttk.Button(tb1, image=self._icon_folder, command=self._load_folder_dialog)
        load_btn.grid(row=0, column=2, padx=2)
        self._add_tooltip(load_btn, "Nạp thư mục ảnh...")
        refresh_btn = ttk.Button(tb1, image=self._icon_refresh, command=self._reload_dir)
        refresh_btn.grid(row=0, column=3, padx=2)
        self._add_tooltip(refresh_btn, "Nạp lại thư mục đang mở")
        self.panel_toggle_btn = ttk.Button(
            tb1, text="Ẩn tải", width=8, command=self._toggle_download_panel
        )
        self.panel_toggle_btn.grid(row=0, column=4, padx=(8, 0))

        layout_bar = ttk.Frame(frm)
        layout_bar.pack(fill="x", padx=6, pady=(0, 3))
        ttk.Label(layout_bar, text="Bố cục xem:").pack(side="left", padx=(0, 2))
        self.mode_2d_btn = ttk.Button(
            layout_bar, text="1x1", width=5,
            command=lambda: self._set_2d_layout("single"),
        )
        self.mode_2d_btn.pack(side="left", padx=1)
        self._add_tooltip(self.mode_2d_btn, "M\u1ed9t \u1ea3nh")
        self.compare_btn = ttk.Button(
            layout_bar, text="1|1", width=5,
            command=lambda: self._set_2d_layout("compare"),
        )
        self.compare_btn.pack(side="left", padx=1)
        self._add_tooltip(self.compare_btn, "So s\u00e1nh hai series ngang nhau")
        self.montage6_btn = ttk.Button(
            layout_bar, text="3x2", width=5,
            command=lambda: self._set_2d_layout("montage6"),
        )
        self.montage6_btn.pack(side="left", padx=1)
        self._add_tooltip(self.montage6_btn, "Xem 6 l\u00e1t li\u00ean ti\u1ebfp")
        self.montage8_btn = ttk.Button(
            layout_bar, text="4x2", width=5,
            command=lambda: self._set_2d_layout("montage8"),
        )
        self.montage8_btn.pack(side="left", padx=1)
        self._add_tooltip(self.montage8_btn, "Xem 8 l\u00e1t li\u00ean ti\u1ebfp")
        self.mpr_btn = ttk.Button(
            layout_bar,
            text="MPR",
            command=lambda: self._set_viewer_mode("mpr"),
            state="disabled",
        )
        self.mpr_btn.pack(side="left", padx=1)
        ttk.Label(
            layout_bar,
            text="MPR chỉ bật cho gói T1 3D đủ điều kiện",
            foreground="#657786",
        ).pack(side="left", padx=8)

        self.workspace_host = ttk.Frame(frm)
        self.workspace_host.pack(fill="both", expand=True)
        self.viewer_2d = ttk.Frame(self.workspace_host)
        self.mpr_workspace = MprWorkspace(self.workspace_host)

        self.compare_bar = ttk.Frame(self.viewer_2d)
        ttk.Label(self.compare_bar, text="Series ph\u1ee5:").pack(side="left")
        self.compare_cbo = ttk.Combobox(
            self.compare_bar,
            textvariable=self.compare_series_var,
            state="readonly",
            width=42,
        )
        self.compare_cbo.pack(side="left", fill="x", expand=True, padx=(4, 0))
        self.compare_cbo.bind(
            "<<ComboboxSelected>>",
            lambda _event: self._on_compare_series_change(),
        )

        # Thanh 2D: điều hướng lát cắt + phim.
        self.tb2 = ttk.Frame(self.viewer_2d)
        self.tb2.pack(fill="x", padx=6, pady=2)
        tb2 = self.tb2
        ttk.Button(tb2, text="◀", width=3, command=self._prev).pack(side="left")
        self.slice_scale = ttk.Scale(tb2, from_=0, to=0, orient="horizontal", command=self._on_slider)
        self.slice_scale.pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(tb2, text="▶", width=3, command=self._next).pack(side="left")
        self.play_btn = ttk.Button(tb2, text="▶ Phim", width=8, command=self._toggle_cine)
        self.play_btn.pack(side="left", padx=6)
        self.idx_lbl = ttk.Label(tb2, text="—", width=20)
        self.idx_lbl.pack(side="left")

        # Công cụ 2D được nhóm riêng để tránh lẫn với ROI/MPR.
        tb3 = ttk.Frame(self.viewer_2d)
        tb3.pack(fill="x", padx=6, pady=2)
        for icon, tooltip, command in (
            ("\u2212", "Thu nh\u1ecf", self._zoom_out),
            ("+", "Ph\u00f3ng to", self._zoom_in),
        ):
            button = ttk.Button(tb3, text=icon, width=3, command=command)
            button.pack(side="left", padx=1)
            self._add_tooltip(button, tooltip)

        pan_button = ttk.Checkbutton(
            tb3,
            text="\u270b",
            width=3,
            variable=self.pan_2d_enabled,
            command=self._toggle_2d_pan,
            style="Toolbutton",
        )
        pan_button.pack(side="left", padx=1)
        self._add_tooltip(pan_button, "B\u00e0n tay: k\u00e9o \u1ea3nh khi \u0111\u00e3 ph\u00f3ng to")

        for icon, tooltip, command in (
            ("\u26f6", "Hi\u1ec7n to\u00e0n b\u1ed9 \u1ea3nh, kh\u00f4ng c\u1eaft m\u00e9p", self._fit),
            ("\u25a3", "L\u1ea5p \u0111\u1ea7y khung; c\u00f3 th\u1ec3 c\u1eaft m\u00e9p", self._fill_view),
            ("\u21bb", "Xoay 90\u00b0", self._rotate90),
            ("\u2194", "L\u1eadt ngang", self._toggle_flip_h),
            ("\u2195", "L\u1eadt d\u1ecdc", self._toggle_flip_v),
            ("\u25d0", "\u0110\u1ea3o m\u00e0u", self._toggle_invert),
            ("\u21ba", "\u0110\u1eb7t l\u1ea1i hi\u1ec3n th\u1ecb", self._reset_view),
        ):
            button = ttk.Button(tb3, text=icon, width=3, command=command)
            button.pack(side="left", padx=1)
            self._add_tooltip(button, tooltip)

        tb4 = ttk.Frame(self.viewer_2d); tb4.pack(fill="x", padx=6, pady=2)
        ttk.Label(tb4, text="Sáng").pack(side="left")
        self.bright_scale = ttk.Scale(tb4, from_=0.2, to=3.0, orient="horizontal", command=lambda v: self._render())
        self.bright_scale.set(1.0)
        self.bright_scale.pack(side="left", fill="x", expand=True, padx=4)
        ttk.Label(tb4, text="Tương phản").pack(side="left")
        self.contrast_scale = ttk.Scale(tb4, from_=0.2, to=3.0, orient="horizontal", command=lambda v: self._render())
        self.contrast_scale.set(1.0)
        self.contrast_scale.pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(tb4, text="Lưu ảnh...", command=self._save_current).pack(side="left", padx=4)

        # Vùng ảnh 2D.
        cv = ttk.Frame(self.viewer_2d); cv.pack(fill="both", expand=True, padx=6, pady=(2, 4))
        self.canvas = tk.Canvas(cv, bg="#0b0b0b", highlightthickness=0)
        vbar = ttk.Scrollbar(cv, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(cv, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")
        cv.rowconfigure(0, weight=1); cv.columnconfigure(0, weight=1)
        self.canvas.bind("<Configure>", lambda e: self._render())
        self.canvas.bind("<MouseWheel>", self._on_wheel)
        self.canvas.bind("<ButtonPress-1>", self._pan_2d_press)
        self.canvas.bind("<B1-Motion>", self._pan_2d_drag)

        self.status_lbl = ttk.Label(
            self.viewer_2d,
            text="Chưa có ảnh. Tải xong sẽ tự nạp, hoặc bấm nút 📂.",
        )
        self.status_lbl.pack(anchor="w", padx=8, pady=(0, 6))
        self.viewer_2d.pack(fill="both", expand=True)
        self._sync_mode_buttons()

        # Phím tắt được định tuyến theo layout hiện hành.
        self.root.bind("<Left>", self._viewer_prev)
        self.root.bind("<Right>", self._viewer_next)
        self.root.bind("<space>", self._viewer_space)
        self.root.bind("<Escape>", self._viewer_escape)
        self.root.bind("<Return>", self._viewer_return)

    # ============================================================ TẢI ẢNH
    def _pick_folder(self):
        d = filedialog.askdirectory(title=self._t("Chọn thư mục lưu"))
        if d:
            self.out_var.set(d)

    def _open_folder(self):
        target = self.last_jpg_dir or Path(self.out_var.get())
        try:
            os.startfile(str(target))
        except Exception as e:
            messagebox.showinfo(self._t("Thư mục"), self._t("Ảnh nằm ở:\n{}\n\n({})").format(target, e))

    def _start(self):
        url = self.url_var.get().strip()
        if not url.lower().startswith("http"):
            messagebox.showwarning(self._t("Thiếu link"), self._t("Hãy dán LINK viewer hợp lệ (bắt đầu bằng http)."))
            return
        out_base = Path(self.out_var.get().strip() or
                        (Path.cwd() / f"Tai_ve_{datetime.now():%Y%m%d_%H%M%S}"))
        self._launch(url, out_base, resume=False)

    def _start_mri_patient(self):
        pid = self.pid_var.get().strip()
        if not pid:
            messagebox.showwarning(self._t("Thiếu mã bệnh nhân"),
                                   self._t("Vui lòng nhập MÃ BỆNH NHÂN (vd: 2605032022)."))
            return
        if not re.fullmatch(r"[A-Za-z0-9]+", pid):
            messagebox.showwarning(self._t("Mã bệnh nhân không hợp lệ"),
                                   self._t("Mã bệnh nhân chỉ bao gồm chữ cái và chữ số, không chứa khoảng trắng hoặc ký tự đặc biệt."))
            return

        hosp = self.hosp_var.get()
        info = pipe.HOSPITALS.get(hosp, {})
        hosp_name = info.get("name", hosp)
        # The shared pipeline now owns patient-folder resolution. Passing the
        # selected storage root lets it reuse an indexed patient, import the
        # legacy `<BV>_BN_<PID>` layout, or create the new readable name.
        out_base = Path(self.out_var.get().strip() or Path.cwd())

        self._clear_log()
        self.last_url = None
        self.last_out_base = out_base

        self.stop_flag.clear()
        self.start_btn.config(state="disabled")
        if hasattr(self, "start_mri_btn"):
            self.start_mri_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.open_btn.config(state="disabled")
        self.retry_btn.config(state="disabled")
        self.new_btn.config(state="disabled")
        self.progress.start(12)

        def log(msg):
            self.msg_q.put(("log", msg))

        def work_search():
            try:
                log(self._t("Đang đăng nhập RIS và tìm kiếm danh sách ca chụp..."))
                studies = pipe.search_patient_studies(
                    hospital_key=hosp,
                    patient_id=pid,
                    modality="MR_CT",
                    log=log,
                    headless=not self.show_var.get(),
                    should_stop=self.stop_flag.is_set,
                )
                self.msg_q.put(("studies_found", (hosp, pid, hosp_name, out_base, studies)))
            except Exception:
                self.msg_q.put(("log", self._t("LỖI:\n{}").format(traceback.format_exc())))
                self.msg_q.put(("done", False))

        self.worker = threading.Thread(target=work_search, daemon=True)
        self.worker.start()

    def _start_downloading_patient_studies(self, hosp: str, pid: str, out_base: Path, selected_studies: list[dict]):
        def log(msg):
            self.msg_q.put(("log", msg))

        def work_download():
            try:
                contrast_mode = ("auto" if self.contrast_mode_var.get().startswith("Auto") else "clinical")
                pipe.download_studies_list(
                    studies=selected_studies,
                    out_base=out_base,
                    log=log,
                    headless=not self.show_var.get(),
                    quality=int(self.quality_var.get()),
                    save_png=bool(self.png_var.get()),
                    contrast_mode=contrast_mode,
                    should_stop=self.stop_flag.is_set,
                )
                patient_folder, _manifest = pipe.find_patient_archive(out_base, pid, hosp)
                if patient_folder:
                    hosp_name = pipe.HOSPITALS.get(hosp, {}).get("name", hosp)
                    self.msg_q.put(("patientfolder", (str(patient_folder), f"{hosp_name} - BN: {pid}")))
                self.msg_q.put(("done", True))
            except Exception:
                self.msg_q.put(("log", self._t("LỖI:\n{}").format(traceback.format_exc())))
                self.msg_q.put(("done", False))

        self.worker = threading.Thread(target=work_download, daemon=True)
        self.worker.start()

    def _retry(self):
        """Tải lại chính link cũ vào folder cũ, GỘP thêm ảnh (bỏ trùng)."""
        if not self.last_url or not self.last_out_base:
            messagebox.showinfo(self._t("Thử lại"), self._t("Chưa có lần tải nào để thử lại."))
            return
        self.url_var.set(self.last_url)
        self.out_var.set(str(self.last_out_base))
        self._log(self._t(">>> THỬ LẠI: link cũ, gộp vào {}").format(self.last_out_base))
        self._launch(self.last_url, self.last_out_base, resume=True)

    def _new_download(self):
        """Chuẩn bị tải link MỚI vào folder MỚI (dán link 2 rồi bấm BẮT ĐẦU TẢI)."""
        self.url_var.set("")
        new_out = Path.cwd() / f"Tai_ve_{datetime.now():%Y%m%d_%H%M%S}"
        self.out_var.set(str(new_out))
        self.retry_btn.config(state="disabled")
        self._log(self._t(">>> Sẵn sàng cho LINK MỚI. Dán link tiếp theo rồi bấm 'BẮT ĐẦU TẢI'."))
        self._log(self._t("    Folder mới: {}").format(new_out))

    def _launch(self, url, out_base, resume):
        if not resume:
            self._clear_log()  # link + folder mới -> nhật ký cũ không còn liên quan
        self.last_url = url
        self.last_out_base = Path(out_base)
        self._add_history(out_base, url)
        self.stop_flag.clear()
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.open_btn.config(state="disabled")
        self.retry_btn.config(state="disabled")
        self.new_btn.config(state="disabled")
        self.progress.start(12)

        params = dict(
            url=url,
            out_base=Path(out_base),
            headless=not self.show_var.get(),
            quality=int(self.quality_var.get()),
            save_png=bool(self.png_var.get()),
            contrast_mode=("auto" if self.contrast_mode_var.get().startswith("Auto") else "clinical"),
            resume=resume,
        )
        self.worker = threading.Thread(target=self._run, kwargs=params, daemon=True)
        self.worker.start()

    def _stop(self):
        self.stop_flag.set()
        self._log(self._t(">>> Đang yêu cầu dừng... (chờ bước hiện tại kết thúc)"))
        self.stop_btn.config(state="disabled")

    def _run(self, url, out_base, headless, quality, save_png, contrast_mode, resume):
        def log(msg):
            self.msg_q.put(("log", msg))
        try:
            dl, cv, jpg_dir = pipe.run_pipeline(
                url=url, out_base=out_base, log=log, headless=headless,
                quality=quality, save_png=save_png, contrast_mode=contrast_mode,
                should_stop=self.stop_flag.is_set, resume=resume,
            )
            actual_root = Path(jpg_dir).parent
            if actual_root != Path(out_base):
                self.msg_q.put(("directroot", (str(out_base), str(actual_root), str(jpg_dir), url)))
            else:
                self.msg_q.put(("jpgdir", str(jpg_dir)))
            if dl and dl.total():
                self.msg_q.put(("log", self._t("Tải được {} ảnh.").format(dl.total())))
            self.msg_q.put(("done", True))
        except Exception:
            self.msg_q.put(("log", self._t("LỖI:\n{}").format(traceback.format_exc())))
            self.msg_q.put(("done", False))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.msg_q.get_nowait()
                if kind == "log":
                    self._log(str(payload))
                elif kind == "jpgdir":
                    self.last_jpg_dir = Path(str(payload))
                elif kind == "directroot":
                    old_root, folder, jpg_dir, url = payload
                    old_key = str(old_root).lower()
                    self.history = [
                        item for item in self.history
                        if str(item.get("folder", "")).lower() != old_key
                    ]
                    self.last_out_base = Path(str(folder))
                    self.last_jpg_dir = Path(str(jpg_dir))
                    self.out_var.set(str(self.last_out_base))
                    self._add_history(self.last_out_base, str(url))
                elif kind == "patientfolder":
                    folder, label = payload
                    self.last_out_base = Path(str(folder))
                    self.last_jpg_dir = self.last_out_base
                    self._add_history(self.last_out_base, str(label))
                elif kind == "studies_found":
                    hosp, pid, hosp_name, out_base, studies = payload
                    if not studies:
                        self._finish()
                    elif len(studies) == 1:
                        self._start_downloading_patient_studies(hosp, pid, out_base, selected_studies=studies)
                    else:
                        self.progress.stop()
                        dlg = StudySelectionDialog(self.root, studies, pid, hosp_name, self)
                        self.root.wait_window(dlg)
                        if dlg.result_uids:
                            selected_studies = [st for st in studies if st["study_uid"] in dlg.result_uids]
                            self.progress.start(12)
                            self._start_downloading_patient_studies(hosp, pid, out_base, selected_studies=selected_studies)
                        else:
                            self._log(self._t(">>> Đã hủy chọn ca chụp."))
                            self._finish()
                elif kind == "done":
                    self._finish()
        except queue.Empty:
            pass
        self.root.after(100, self._poll_queue)

    def _finish(self):
        self.progress.stop()
        self.start_btn.config(state="normal")
        if hasattr(self, "start_mri_btn"):
            self.start_mri_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.open_btn.config(state="normal")
        self.retry_btn.config(state="normal")   # cho phép thử lại link/folder vừa rồi
        self.new_btn.config(state="normal")
        # tự nạp ảnh vừa tải vào trình xem
        if self.last_jpg_dir and self.last_jpg_dir.exists():
            self._load_dir(self.last_jpg_dir)

    def _translate_log_pattern(self, msg: str) -> str:
        if getattr(self, "lang", "vi") == "vi": return msg
        if msg in I18N_EN: return I18N_EN[msg]
        
        reps = [
            (r"Lần đầu chạy trên máy này: đang tải nhân trình duyệt Chromium \(~150MB, chỉ 1 lần\)\.\.\.", r"First run on this machine: downloading Chromium browser engine (~150MB, one time)..."),
            (r"Đã tải xong Chromium\.", r"Chromium downloaded successfully."),
            (r"Không tự tải được Chromium \((.+)\)\. Hãy chạy thủ công: python -m playwright install chromium", r"Could not auto-download Chromium (\1). Please run manually: python -m playwright install chromium"),
            (r"Thử lại: đã có sẵn (\d+) ảnh trong folder — sẽ bổ sung ảnh mới, bỏ trùng\.", r"Retry: found \1 existing images in folder — will append new images and skip duplicates."),
            (r"  \.\.\.đã tải (\d+) ảnh \(DICOM: (\d+)\)", r"  ...downloaded \1 images (DICOM: \2)"),
            (r"Đang mở trình duyệt ảo \(Chromium\)\.\.\.", r"Opening virtual browser (Chromium)..."),
            (r"Công cụ nền: (.+) \(dòng này chỉ báo trình duyệt tự động, không báo đăng nhập\)\.", r"Background tool: \1 (this line reports browser automation, not a new sign-in)."),
            (r"\[(\d+)\/(\d+)\] Đang đọc series ngày (.+)\.\.\.", r"[\1/\2] Reading series for \3..."),
            (r"      Bước 1/2: Tạo vé viewer tạm thời cho StudyUID đã chọn \(không tìm lại mã bệnh nhân\)\.\.\.", r"      Step 1/2: Creating a temporary viewer ticket for the selected StudyUID (the patient is not searched again)..."),
            (r"      Bước 2/2: Đang đọc danh sách series từ viewer \(chưa tải file ảnh\)\.\.\.", r"      Step 2/2: Reading the series list from the viewer (no image files are being downloaded)..."),
            (r"Đường nội bộ (.+) không khả dụng; tự chuyển sang cổng PACS công cộng\.", r"The internal endpoint \1 is unavailable; continuing through the public PACS gateway."),
            (r"      ✓ Đã dùng lại phiên RIS; không đăng nhập lại\.", r"      ✓ Reused the existing RIS session; no new sign-in."),
            (r"      Phiên RIS cũ đã hết hạn; app đang tự đăng nhập lại một lần\.", r"      The old RIS session expired; the app is signing in again once."),
            (r"      Chưa có phiên RIS hợp lệ; app đang tự đăng nhập một lần\.", r"      There is no valid RIS session; the app is signing in once."),
            (r"      ✓ Viewer mở trực tiếp; không cần đăng nhập RIS\.", r"      ✓ The viewer opened directly; no RIS sign-in was needed."),
            (r">>> LỊCH SỬ: mở lại (.+)", r">>> HISTORY: reopened \1"),
            (r"Đang tải trang viewer \(không chỉnh sửa link\)\.\.\.", r"Loading viewer page (not modifying link)..."),
            (r"  Cảnh báo khi tải trang: (.+)", r"  Warning while loading page: \1"),
            (r"!!! Link đã HẾT HẠN \(urlExpired\)\. Hãy lấy link mới từ trang xem rồi thử lại\.", r"!!! Link has EXPIRED (urlExpired). Please get a new link from the viewer page and try again."),
            (r"!!! Link đã HẾT HẠN / SESSION không còn hiệu lực \(server trả (.+)\)\. Hãy lấy LINK MỚI từ trang xem rồi tải lại NGAY \(loại link này sống rất ngắn\)\.", r"!!! Link has EXPIRED / SESSION is no longer valid (server returned \1). Get a NEW link from the viewer page and retry IMMEDIATELY (these links are short-lived)."),
            (r"DICOMweb: (\d+) series\. Đang liệt kê ảnh\.\.\.", r"DICOMweb: \1 series. Listing images..."),
            (r"DICOMweb: (\d+) series, (\d+) ảnh\. Đang tải trực tiếp \(6 luồng song song\)\.\.\.", r"DICOMweb: \1 series, \2 images. Downloading directly (6 parallel threads)..."),
            (r"  Lỗi QIDO series \((.+)\) — bỏ qua\.", r"  QIDO series error (\1) — skipping."),
            (r"  Không tách được studyUID từ QIDO — bỏ qua\.", r"  Could not extract studyUID from QIDO — skipping."),
            (r"Đang dò manifest của viewer\.\.\.", r"Scanning for viewer manifest..."),
            (r"✓ Có manifest → tải TRỰC TIẾP theo API \(không cần click/cuộn\)\.", r"✓ Manifest found → downloading DIRECTLY via API (no click/scroll needed)."),
            (r"Không thấy manifest → chế độ MÔ PHỎNG \(cuộn/click\), chỉ xử lý xung ĐANG HIỂN THỊ\.", r"No manifest found → SIMULATION mode (scroll/click), processing only VISIBLE series."),
            (r"Chờ (\d+)s để bắt nốt ảnh còn lại\.\.\.", r"Waiting \1s to capture remaining images..."),
            (r"Tải xong\. Tổng ảnh: (\d+) \(DICOM (\d+), JPG (\d+), PNG (\d+), trùng bỏ (\d+)\)\.", r"Download complete. Total images: \1 (DICOM \2, JPG \3, PNG \4, skipped \5 duplicates)."),
            (r"Manifest: (\d+) series, ~(\d+) ảnh\. Đang tải trực tiếp (\d+) ảnh \(6 luồng song song\)\.\.\.", r"Manifest: \1 series, ~\2 images. Downloading \3 images directly (6 parallel threads)..."),
            (r"  ✓ Đã đủ theo manifest: (\d+)/(\d+) ảnh\.", r"  ✓ Complete per manifest: \1/\2 images."),
            (r"  ⚠ Tải được (\d+)/(\d+) ảnh — thiếu (\d+) \(có thể do mạng/timeout; chạy lại sẽ bù, ảnh trùng tự bỏ\)\.", r"  ⚠ Downloaded \1/\2 images — missing \3 (possibly network/timeout; retry will fill gaps, duplicates skipped)."),
            (r"Chuyển đổi: tìm thấy (\d+) file DICOM\. Chất lượng JPG=(\d+)(.*), tương phản=(.+)\.", r"Conversion: found \1 DICOM files. JPG Quality=\2\3, contrast=\4."),
            (r"  \.\.\.đã chuyển (\d+) ảnh", r"  ...converted \1 images"),
            (r"Chuyển đổi xong: (\d+) ảnh JPG(.*), bỏ qua (\d+), lỗi (\d+)\.", r"Conversion complete: \1 JPG images\2, skipped \3, errors \4."),
            (r"Tóm tắt theo series:", r"Summary by series:"),
            (r"   • (.+): (\d+) ảnh", r"   • \1: \2 images"),
            (r"   Tổng: (\d+) ảnh, (\d+) series\.", r"   Total: \1 images, \2 series."),
            (r"BƯỚC 1/2: Tải ảnh từ viewer( \(THỬ LẠI — gộp vào folder cũ\))?", r"STEP 1/2: Download images from viewer\1"),
            (r" \(THỬ LẠI — gộp vào folder cũ\)", r" (RETRY — merging into old folder)"),
            (r"Không tải được ảnh nào\. Kiểm tra lại link \(còn hạn không\) và thử tắt chế độ ẩn trình duyệt\.", r"No images downloaded. Check if the link has expired and try disabling headless mode."),
            (r"BƯỚC 2/2: Chuyển DICOM -> JPG chất lượng cao", r"STEP 2/2: Convert DICOM -> High-quality JPG"),
            (r"HOÀN TẤT\. Ảnh JPG nằm ở: (.+)", r"COMPLETE. JPG images located at: \1"),
            (r"Không thấy danh sách series \(có thể giao diện khác\)\. Vẫn thử cuộn ảnh hiện tại\.", r"No series list found (possible different UI). Will still try to scroll current images."),
            (r"Phát hiện (\d+) series \(xung\) đang hiển thị để duyệt\.", r"Detected \1 visible series to browse."),
            (r"Không tìm thấy thumbnail series theo class chuẩn; sẽ cuộn ảnh đang hiển thị\.", r"Could not find standard series thumbnails; will scroll currently visible images."),
            (r"\[Series (\d+)/(\d+)\] (.*)  \(~(\d+) ảnh\) — đang nạp\.\.\.", r"[Series \1/\2] \3  (~\4 images) — loading..."),
            (r"   \(không bấm được thumbnail này, bỏ qua\)", r"   (could not click this thumbnail, skipping)"),
            (r"   -> series này thêm (\d+) ảnh \(tổng (\d+)\)\.", r"   -> this series added \1 images (total \2)."),
            (r"  Lỗi file (.+): (.+)", r"  File error \1: \2"),
            (r"chuẩn lâm sàng \(VOI LUT\)", r"clinical standard (VOI LUT)"),
            (r"Đã nạp trình xem: (\d+) series, (\d+) ảnh từ (.+)", r"Loaded viewer: \1 series, \2 images from \3"),
        ]
        
        import re
        for p_vi, p_en in reps:
            msg = re.sub(p_vi, p_en, msg)
        return msg

    def _log(self, msg: str):
        msg = self._translate_log_pattern(msg)
        self.log_text.config(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    def _clear_log(self):
        self.log_text.config(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.config(state="disabled")

    # ========================================================== LỊCH SỬ
    def _load_history(self):
        try:
            import json
            data = json.loads(HIST_FILE.read_text(encoding="utf-8"))
            self.history = [h for h in data if isinstance(h, dict) and h.get("folder")]
        except Exception:
            self.history = []

    def _save_history(self):
        try:
            import json
            HIST_FILE.write_text(json.dumps(self.history, ensure_ascii=False, indent=1),
                                 encoding="utf-8")
        except Exception:
            pass  # không để lỗi ghi lịch sử làm hỏng việc chính

    def _add_history(self, folder, url=None):
        """Thêm/đưa lên đầu 1 mục lịch sử. Cùng folder thì CẬP NHẬT link mới."""
        folder = str(folder)
        key = folder.lower()
        old = next((h for h in self.history
                    if str(h.get("folder", "")).lower() == key), None)
        if old:
            self.history.remove(old)
            if not url:
                url = old.get("url") or ""
        self.history.insert(0, {"folder": folder, "url": url or "",
                                "time": datetime.now().strftime("%d/%m %H:%M")})
        del self.history[HIST_MAX:]
        self._save_history()
        self._refresh_history_combo()

    def _refresh_history_combo(self):
        vals = [f'{h.get("time", "")}  •  {Path(str(h.get("folder", "?"))).name}'
                for h in self.history]
        self.history_cbo.config(values=vals)

    def _on_history_select(self):
        i = self.history_cbo.current()
        if i < 0 or i >= len(self.history):
            return
        h = self.history[i]
        folder = Path(str(h.get("folder", "")))
        url = h.get("url") or ""
        self.out_var.set(str(folder))
        if url:  # nạp lại link cũ để có thể sửa/tải lại
            self.url_var.set(url)
            self.last_url = url
            self.last_out_base = folder
            self.retry_btn.config(state="normal")
        self._log(self._t(">>> LỊCH SỬ: mở lại {}").format(folder))
        if folder.exists():
            self._load_dir(folder)
        else:
            messagebox.showinfo(self._t("Thư mục"),
                                self._t("Thư mục không còn tồn tại:\n{}").format(folder))

    # ========================================================== TRÌNH XEM
    def _load_folder_dialog(self):
        start = str(self.last_jpg_dir or Path.cwd())
        d = filedialog.askdirectory(title=self._t("Chọn thư mục chứa ảnh (JPG/PNG)"), initialdir=start)
        if d:
            self._add_history(d)  # nhớ cả folder chỉ mở xem, không tải
            self._load_dir(Path(d))

    def _load_dir(self, base: Path):
        try:
            series = scan_series(base)
        except Exception as e:
            messagebox.showerror(self._t("Lỗi"), self._t("Không đọc được thư mục:\n{}").format(e))
            return
        if not series:
            messagebox.showinfo(self._t("Không có ảnh"), self._t("Không tìm thấy ảnh JPG/PNG trong:\n{}").format(base))
            return
        self.viewer_dir = Path(base)
        self.series_map = series
        names = list(series.keys())
        self.series_cbo.config(values=names)
        mpr_name = next(
            (
                name for name in names
                if series[name] and mpr_engine.read_manifest(series[name][0].parent)
            ),
            names[0],
        )
        self.series_var.set(mpr_name)
        total = sum(len(v) for v in series.values())
        self._log(self._t("Đã nạp trình xem: {} series, {} ảnh từ {}").format(len(names), total, base))
        self._on_series_change()

    def _reload_dir(self):
        """Nạp lại thư mục ảnh đang mở: quét thêm series/ảnh mới xuất hiện
        (vd đang tải dở), giữ nguyên series và lát cắt đang xem."""
        base = self.viewer_dir or self.last_jpg_dir
        if not base or not Path(base).exists():
            messagebox.showinfo(self._t("Không có ảnh"),
                                self._t("Chưa có thư mục ảnh nào đang mở để nạp lại."))
            return
        cur_name = self.series_var.get()
        cur_idx = getattr(self, "cur_index", 0)
        try:
            series = scan_series(Path(base))
        except Exception as e:
            messagebox.showerror(self._t("Lỗi"), self._t("Không đọc được thư mục:\n{}").format(e))
            return
        if not series:
            messagebox.showinfo(self._t("Không có ảnh"), self._t("Không tìm thấy ảnh JPG/PNG trong:\n{}").format(base))
            return
        self.viewer_dir = Path(base)
        self.series_map = series
        names = list(series.keys())
        self.series_cbo.config(values=names)
        total = sum(len(v) for v in series.values())
        self._log(self._t("Đã nạp lại: {} series, {} ảnh từ {}").format(len(names), total, base))
        if cur_name in series:  # giữ nguyên chỗ đang xem
            self.series_var.set(cur_name)
            self.cur_files = series[cur_name]
            n = len(self.cur_files)
            self.slice_scale.config(from_=0, to=max(0, n - 1))
            self._normalize_2d_layout()
            self._refresh_compare_series_options()
            self._show_index(min(cur_idx, n - 1))
            if self.viewer_mode == "mpr":
                if self._current_series_has_mpr():
                    try:
                        self.mpr_workspace.load_series(self.cur_files[0].parent)
                    except Exception as exc:
                        self._set_viewer_mode("2d")
                        messagebox.showerror("Không nạp lại được MPR", str(exc))
                else:
                    self._set_viewer_mode("2d")
            self._sync_2d_navigation()
            self._sync_mode_buttons()
            if self.viewer_mode == "2d":
                self._render()
        else:
            self.series_var.set(names[0])
            self._on_series_change()

    def _on_series_change(self):
        name = self.series_var.get()
        self.cur_files = self.series_map.get(name, [])
        n = len(self.cur_files)
        self.slice_scale.config(from_=0, to=max(0, n - 1))
        self.cur_index = 0
        self._normalize_2d_layout()
        self._refresh_compare_series_options()
        self._show_index(0)
        if self.viewer_mode == "mpr":
            if self._current_series_has_mpr():
                try:
                    self.mpr_workspace.load_series(self.cur_files[0].parent)
                except Exception as exc:
                    self._set_viewer_mode("2d")
                    messagebox.showerror("Không mở được MPR", str(exc))
            else:
                self._set_viewer_mode("2d")
        self._sync_2d_navigation()
        self._sync_mode_buttons()
        if self.viewer_mode == "2d":
            self._render()

    def _open_mpr(self):
        """Backward-compatible command target: MPR is now embedded."""
        self._set_viewer_mode("mpr")

    def _show_index(self, i):
        if not self.cur_files:
            return
        self.cur_index = max(0, min(i, len(self.cur_files) - 1))
        path = self.cur_files[self.cur_index]
        try:
            self.base_img = self._load_cached_image(path)
        except Exception as e:
            self.base_img = None
            self.status_lbl.config(text=self._t("Lỗi mở ảnh: {} ({})").format(path.name, e))
            return
        self._syncing_slider = True
        try:
            self.slice_scale.set(self.cur_index)
        finally:
            self._syncing_slider = False
        self._sync_2d_navigation()
        self.status_lbl.config(text=f"{self.series_var.get()}  •  {path.name}")
        self._render()

    def _on_slider(self, v):
        if self._syncing_slider:
            return
        value = int(float(v))
        if self.viewer_layout == "compare" and self.active_2d_pane == "right":
            self.compare_index = max(0, min(value, len(self.compare_files) - 1))
            self._sync_2d_navigation()
            self._render()
        else:
            self._show_index(value)

    def _step_2d(self, delta: int) -> None:
        if self.viewer_layout == "compare" and self.active_2d_pane == "right":
            if self.compare_files:
                self.compare_index = max(
                    0, min(self.compare_index + delta, len(self.compare_files) - 1),
                )
                self._sync_2d_navigation()
                self._render()
        elif self.cur_files:
            self._show_index(self.cur_index + delta)

    def _prev(self):
        self._step_2d(-1)

    def _next(self):
        self._step_2d(1)

    def _on_wheel(self, e):
        if e.state & 0x0004:  # Ctrl -> zoom
            self._zoom_in() if e.delta > 0 else self._zoom_out()
        else:
            if self.viewer_layout == "compare":
                self.active_2d_pane = self._compare_pane_at(e.x)
            self._step_2d(1 if e.delta < 0 else -1)
        return "break"

    def _compare_pane_at(self, canvas_x: float) -> str:
        """Map a click/wheel position to the visible compare pane after pan/zoom."""
        try:
            x0, _y0, x1, _y1 = (
                float(value) for value in str(self.canvas.cget("scrollregion")).split()
            )
            if x1 > x0:
                return "left" if self.canvas.canvasx(canvas_x) < (x0 + x1) / 2 else "right"
        except (TypeError, ValueError):
            pass
        return "left" if canvas_x < self.canvas.winfo_width() / 2 else "right"

    def _toggle_2d_pan(self):
        self.canvas.configure(
            cursor="fleur" if self.pan_2d_enabled.get() else "",
        )

    def _pan_2d_press(self, event):
        if self.viewer_layout == "compare":
            self.active_2d_pane = self._compare_pane_at(event.x)
            self._sync_2d_navigation()
            self._render()
        if self.pan_2d_enabled.get():
            self.canvas.scan_mark(event.x, event.y)
            return "break"
        return None

    def _pan_2d_drag(self, event):
        if self.pan_2d_enabled.get():
            self.canvas.scan_dragto(event.x, event.y, gain=1)
            return "break"
        return None

    def _toggle_cine(self):
        if self.cine_playing:
            self.cine_playing = False
            self.play_btn.config(text=self._t("▶ Phim"))
            if self.cine_job:
                self.root.after_cancel(self.cine_job)
                self.cine_job = None
        elif self.cur_files:
            self.cine_playing = True
            self.play_btn.config(text=self._t("⏸ Dừng"))
            self._cine_step()

    def _cine_step(self):
        if not self.cine_playing or not self.cur_files:
            return
        nxt = (self.cur_index + 1) % len(self.cur_files)
        self._show_index(nxt)
        self.cine_job = self.root.after(90, self._cine_step)

    # --- biến đổi ---
    def _zoom_in(self):
        self.fit_mode = False
        self.zoom = min(self.zoom * 1.25, 12)
        self._render()

    def _zoom_out(self):
        self.fit_mode = False
        self.zoom = max(self.zoom / 1.25, 0.05)
        self._render()

    def _fit(self):
        self.fit_policy_2d.set("contain")
        self.fit_mode = True
        self._render()

    def _fill_view(self):
        self.fit_policy_2d.set("cover")
        self.fit_mode = True
        self._render()

    def _rotate90(self):
        self.rotate = (self.rotate + 90) % 360
        self._render()

    def _toggle_flip_h(self):
        self.flip_h = not self.flip_h
        self._render()

    def _toggle_flip_v(self):
        self.flip_v = not self.flip_v
        self._render()

    def _toggle_invert(self):
        self.invert = not self.invert
        self._render()

    def _reset_view(self):
        self.rotate = 0
        self.flip_h = self.flip_v = self.invert = False
        self.fit_policy_2d.set("contain")
        self.fit_mode = True
        self.pan_2d_enabled.set(False)
        self._toggle_2d_pan()
        self.bright_scale.set(1.0)
        self.contrast_scale.set(1.0)
        self._render()

    def _load_cached_image(self, path: Path) -> Image.Image:
        key = Path(path)
        cached = self._image_cache.get(key)
        if cached is None:
            cached = Image.open(key).convert("RGB")
            self._image_cache[key] = cached
            while len(self._image_cache) > 32:
                self._image_cache.pop(next(iter(self._image_cache)))
        return cached

    def _process_2d_image(self, source: Image.Image) -> Image.Image:
        img = source
        b = float(self.bright_scale.get())
        c = float(self.contrast_scale.get())
        if abs(b - 1.0) > 1e-3:
            img = ImageEnhance.Brightness(img).enhance(b)
        if abs(c - 1.0) > 1e-3:
            img = ImageEnhance.Contrast(img).enhance(c)
        if self.invert:
            img = ImageOps.invert(img)
        if self.flip_h:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if self.flip_v:
            img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        if self.rotate:
            img = img.rotate(-self.rotate, expand=True)
        return img

    def _layout_image(self) -> "Image.Image | None":
        left = self._processed_image()
        if self.viewer_layout == "single":
            return left
        if self.viewer_layout == "compare":
            right = None
            if self.compare_files:
                right = self._process_2d_image(
                    self._load_cached_image(self.compare_files[self.compare_index]),
                )
            return viewer_layout.compose_compare(
                left,
                right,
                left_label=f"L {self.cur_index + 1}/{len(self.cur_files)}",
                right_label=(
                    f"R {self.compare_index + 1}/{len(self.compare_files)}"
                    if self.compare_files else "R -"
                ),
                active=self.active_2d_pane,
            )

        count = 6 if self.viewer_layout == "montage6" else 8
        files = self.cur_files[self.cur_index:self.cur_index + count]
        images = [
            self._process_2d_image(self._load_cached_image(file))
            for file in files
        ]
        labels = [
            f"{self.cur_index + offset + 1}/{len(self.cur_files)}"
            for offset in range(len(images))
        ]
        return viewer_layout.compose_montage(images, count=count, labels=labels)

    def _processed_image(self) -> "Image.Image | None":
        """Ảnh sau khi áp mọi chỉnh (sáng, tương phản, đảo màu, lật, xoay) — CHƯA zoom."""
        if self.base_img is None:
            return None
        return self._process_2d_image(self.base_img)

    def _render(self):
        if not hasattr(self, "canvas"):
            return  # giao diện chưa dựng xong (bị gọi sớm khi khởi tạo thanh trượt)
        img = self._layout_image()
        if img is None:
            self.canvas.delete("all")
            return
        iw, ih = img.size
        cw = max(self.canvas.winfo_width(), 10)
        ch = max(self.canvas.winfo_height(), 10)
        old_region = self.canvas.cget("scrollregion")
        center_rel_x = center_rel_y = 0.5
        try:
            x0, y0, x1, y1 = (float(v) for v in str(old_region).split())
            if x1 > x0 and y1 > y0:
                center_rel_x = (self.canvas.canvasx(cw / 2) - x0) / (x1 - x0)
                center_rel_y = (self.canvas.canvasy(ch / 2) - y0) / (y1 - y0)
        except (TypeError, ValueError):
            pass
        if self.fit_mode:
            scales = (cw / iw, ch / ih)
            self.zoom = max(scales) if self.fit_policy_2d.get() == "cover" else min(scales)
        scale = self.zoom
        dw, dh = max(1, int(iw * scale)), max(1, int(ih * scale))
        disp = img.resize((dw, dh), Image.LANCZOS)
        self.tk_img = ImageTk.PhotoImage(disp)
        W, H = max(cw, dw), max(ch, dh)
        self.canvas.delete("all")
        self.canvas.configure(scrollregion=(0, 0, W, H))
        self.canvas.create_image(W // 2, H // 2, image=self.tk_img, anchor="center")
        if W > cw:
            self.canvas.xview_moveto(max(0.0, min(1.0, (center_rel_x * W - cw / 2) / W)))
        else:
            self.canvas.xview_moveto(0.0)
        if H > ch:
            self.canvas.yview_moveto(max(0.0, min(1.0, (center_rel_y * H - ch / 2) / H)))
        else:
            self.canvas.yview_moveto(0.0)

    def _save_current(self):
        img = self._layout_image()
        if img is None:
            return
        src = self.cur_files[self.cur_index]
        suffix = {
            "compare": "_compare",
            "montage6": "_6up",
            "montage8": "_8up",
        }.get(self.viewer_layout, "_edited")
        out = filedialog.asksaveasfilename(
            title=self._t("Lưu ảnh đang xem"),
            initialfile=src.stem + suffix + ".png",
            defaultextension=".png",
            filetypes=[(self._t("PNG (không mất dữ liệu)"), "*.png"), ("JPEG", "*.jpg")],
        )
        if not out:
            return
        try:
            if out.lower().endswith((".jpg", ".jpeg")):
                img.save(out, "JPEG", quality=95, optimize=True, subsampling=0)
            else:
                img.save(out, "PNG", optimize=True)
            self.status_lbl.config(text=self._t("Đã lưu: {}").format(out))
        except Exception as e:
            messagebox.showerror(self._t("Lỗi lưu"), str(e))


def main():
    root = tk.Tk()
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
