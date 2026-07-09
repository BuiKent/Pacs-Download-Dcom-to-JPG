"""
dcom_downloader_app.py
======================
Ứng dụng 2 cột:
  • CỘT TRÁI  — tải ảnh: dán link viewer, chọn tùy chọn, bấm "BẮT ĐẦU TẢI".
  • CỘT PHẢI  — trình xem ảnh: sau khi tải xong tự nạp; chọn xung (series), cuộn
                 qua từng lát theo thứ tự tên, xem phim (cine), phóng to/thu nhỏ,
                 xoay/lật/đảo màu, chỉnh sáng–tương phản, lưu ảnh đang xem.

Chạy: nhấp đúp run_app.bat, hoặc:  python dcom_downloader_app.py
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

from PIL import Image, ImageTk, ImageOps, ImageEnhance

import dcom_pipeline as pipe

IMG_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff")


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
#  Ứng dụng
# --------------------------------------------------------------------------- #

class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("DICOM Downloader & Viewer")
        root.geometry("1360x860")
        root.minsize(1024, 640)

        # --- trạng thái tải ---
        self.msg_q: "queue.Queue[tuple[str, object]]" = queue.Queue()
        self.worker: "threading.Thread | None" = None
        self.stop_flag = threading.Event()
        self.last_jpg_dir: "Path | None" = None
        self.last_url: "str | None" = None
        self.last_out_base: "Path | None" = None

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

        self._build_ui()
        self.root.after(100, self._poll_queue)
        self.root.after(200, lambda: self._set_sash(470))

    # ================================================================= UI
    def _build_ui(self):
        self.paned = ttk.PanedWindow(self.root, orient="horizontal")
        self.paned.pack(fill="both", expand=True)

        left = ttk.Frame(self.paned)
        right = ttk.Frame(self.paned)
        self.paned.add(left, weight=0)
        self.paned.add(right, weight=1)

        self._build_left(left)
        self._build_right(right)

    def _set_sash(self, x):
        try:
            self.paned.sashpos(0, x)
        except Exception:
            pass

    # -------------------------------------------------- CỘT TRÁI (tải ảnh)
    def _build_left(self, frm):
        pad = dict(padx=10, pady=5)

        ttk.Label(frm, text="1) Dán LINK viewer (còn hạn):",
                  font=("Segoe UI", 10, "bold")).pack(anchor="w", **pad)
        self.url_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.url_var).pack(fill="x", padx=10)

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
        self.contrast_mode_var = tk.StringVar(value="Chuẩn lâm sàng (khuyên dùng)")
        ttk.Combobox(r2, textvariable=self.contrast_mode_var, width=26, state="readonly",
                     values=["Chuẩn lâm sàng (khuyên dùng)", "Auto-contrast (gắt hơn)"]).pack(side="left")

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

        self._log("Sẵn sàng. Dán link viewer rồi bấm 'BẮT ĐẦU TẢI'.")
        self._log("Xem lại ảnh cũ: bấm 'Nạp thư mục ảnh...' bên phải.")

    # ------------------------------------------------ CỘT PHẢI (trình xem)
    def _build_right(self, frm):
        # Thanh 1: chọn series + nạp thư mục
        tb1 = ttk.Frame(frm); tb1.pack(fill="x", padx=6, pady=(6, 2))
        ttk.Label(tb1, text="Xung (series):").pack(side="left")
        self.series_var = tk.StringVar()
        self.series_cbo = ttk.Combobox(tb1, textvariable=self.series_var, state="readonly", width=36)
        self.series_cbo.pack(side="left", padx=4)
        self.series_cbo.bind("<<ComboboxSelected>>", lambda e: self._on_series_change())
        ttk.Button(tb1, text="Nạp thư mục ảnh...", command=self._load_folder_dialog).pack(side="left", padx=4)

        # Thanh 2: điều hướng lát cắt + phim
        tb2 = ttk.Frame(frm); tb2.pack(fill="x", padx=6, pady=2)
        ttk.Button(tb2, text="◀", width=3, command=self._prev).pack(side="left")
        self.slice_scale = ttk.Scale(tb2, from_=0, to=0, orient="horizontal", command=self._on_slider)
        self.slice_scale.pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(tb2, text="▶", width=3, command=self._next).pack(side="left")
        self.play_btn = ttk.Button(tb2, text="▶ Phim", width=8, command=self._toggle_cine)
        self.play_btn.pack(side="left", padx=6)
        self.idx_lbl = ttk.Label(tb2, text="—", width=20)
        self.idx_lbl.pack(side="left")

        # Thanh 3: biến đổi ảnh
        tb3 = ttk.Frame(frm); tb3.pack(fill="x", padx=6, pady=2)
        for txt, cmd in [("－ Thu nhỏ", self._zoom_out), ("＋ Phóng to", self._zoom_in),
                         ("Vừa khung", self._fit), ("Xoay 90°", self._rotate90),
                         ("Lật ⇔", self._toggle_flip_h), ("Lật ⇕", self._toggle_flip_v),
                         ("Đảo màu", self._toggle_invert), ("Đặt lại", self._reset_view)]:
            ttk.Button(tb3, text=txt, command=cmd).pack(side="left", padx=2)

        # Thanh 4: sáng / tương phản / lưu
        tb4 = ttk.Frame(frm); tb4.pack(fill="x", padx=6, pady=2)
        ttk.Label(tb4, text="Sáng").pack(side="left")
        self.bright_scale = ttk.Scale(tb4, from_=0.2, to=3.0, orient="horizontal", command=lambda v: self._render())
        self.bright_scale.set(1.0)
        self.bright_scale.pack(side="left", fill="x", expand=True, padx=4)
        ttk.Label(tb4, text="Tương phản").pack(side="left")
        self.contrast_scale = ttk.Scale(tb4, from_=0.2, to=3.0, orient="horizontal", command=lambda v: self._render())
        self.contrast_scale.set(1.0)
        self.contrast_scale.pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(tb4, text="Lưu ảnh...", command=self._save_current).pack(side="left", padx=4)

        # Vùng ảnh
        cv = ttk.Frame(frm); cv.pack(fill="both", expand=True, padx=6, pady=(2, 4))
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

        self.status_lbl = ttk.Label(frm, text="Chưa có ảnh. Tải xong sẽ tự nạp, hoặc bấm 'Nạp thư mục ảnh...'.")
        self.status_lbl.pack(anchor="w", padx=8, pady=(0, 6))

        # phím tắt
        self.root.bind("<Left>", lambda e: self._prev())
        self.root.bind("<Right>", lambda e: self._next())
        self.root.bind("<space>", lambda e: self._toggle_cine())

    # ============================================================ TẢI ẢNH
    def _pick_folder(self):
        d = filedialog.askdirectory(title="Chọn thư mục lưu")
        if d:
            self.out_var.set(d)

    def _open_folder(self):
        target = self.last_jpg_dir or Path(self.out_var.get())
        try:
            os.startfile(str(target))
        except Exception as e:
            messagebox.showinfo("Thư mục", f"Ảnh nằm ở:\n{target}\n\n({e})")

    def _start(self):
        url = self.url_var.get().strip()
        if not url.lower().startswith("http"):
            messagebox.showwarning("Thiếu link", "Hãy dán LINK viewer hợp lệ (bắt đầu bằng http).")
            return
        out_base = Path(self.out_var.get().strip() or
                        (Path.cwd() / f"Tai_ve_{datetime.now():%Y%m%d_%H%M%S}"))
        self._launch(url, out_base, resume=False)

    def _retry(self):
        """Tải lại chính link cũ vào folder cũ, GỘP thêm ảnh (bỏ trùng)."""
        if not self.last_url or not self.last_out_base:
            messagebox.showinfo("Thử lại", "Chưa có lần tải nào để thử lại.")
            return
        self.url_var.set(self.last_url)
        self.out_var.set(str(self.last_out_base))
        self._log(f">>> THỬ LẠI: link cũ, gộp vào {self.last_out_base}")
        self._launch(self.last_url, self.last_out_base, resume=True)

    def _new_download(self):
        """Chuẩn bị tải link MỚI vào folder MỚI (dán link 2 rồi bấm BẮT ĐẦU TẢI)."""
        self.url_var.set("")
        new_out = Path.cwd() / f"Tai_ve_{datetime.now():%Y%m%d_%H%M%S}"
        self.out_var.set(str(new_out))
        self.retry_btn.config(state="disabled")
        self._log(">>> Sẵn sàng cho LINK MỚI. Dán link tiếp theo rồi bấm 'BẮT ĐẦU TẢI'.")
        self._log(f"    Folder mới: {new_out}")

    def _launch(self, url, out_base, resume):
        self.last_url = url
        self.last_out_base = Path(out_base)
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
        self._log(">>> Đang yêu cầu dừng... (chờ bước hiện tại kết thúc)")
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
            self.msg_q.put(("jpgdir", str(jpg_dir)))
            if dl and dl.total():
                self.msg_q.put(("log", f"Tải được {dl.total()} ảnh."))
            self.msg_q.put(("done", True))
        except Exception:
            self.msg_q.put(("log", "LỖI:\n" + traceback.format_exc()))
            self.msg_q.put(("done", False))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.msg_q.get_nowait()
                if kind == "log":
                    self._log(str(payload))
                elif kind == "jpgdir":
                    self.last_jpg_dir = Path(str(payload))
                elif kind == "done":
                    self._finish()
        except queue.Empty:
            pass
        self.root.after(100, self._poll_queue)

    def _finish(self):
        self.progress.stop()
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.open_btn.config(state="normal")
        self.retry_btn.config(state="normal")   # cho phép thử lại link/folder vừa rồi
        self.new_btn.config(state="normal")
        # tự nạp ảnh vừa tải vào trình xem
        if self.last_jpg_dir and self.last_jpg_dir.exists():
            self._load_dir(self.last_jpg_dir)

    def _log(self, msg: str):
        self.log_text.config(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    # ========================================================== TRÌNH XEM
    def _load_folder_dialog(self):
        start = str(self.last_jpg_dir or Path.cwd())
        d = filedialog.askdirectory(title="Chọn thư mục chứa ảnh (JPG/PNG)", initialdir=start)
        if d:
            self._load_dir(Path(d))

    def _load_dir(self, base: Path):
        try:
            series = scan_series(base)
        except Exception as e:
            messagebox.showerror("Lỗi", f"Không đọc được thư mục:\n{e}")
            return
        if not series:
            messagebox.showinfo("Không có ảnh", f"Không tìm thấy ảnh JPG/PNG trong:\n{base}")
            return
        self.series_map = series
        names = list(series.keys())
        self.series_cbo.config(values=names)
        self.series_var.set(names[0])
        total = sum(len(v) for v in series.values())
        self._log(f"Đã nạp trình xem: {len(names)} series, {total} ảnh từ {base}")
        self._on_series_change()

    def _on_series_change(self):
        name = self.series_var.get()
        self.cur_files = self.series_map.get(name, [])
        n = len(self.cur_files)
        self.slice_scale.config(from_=0, to=max(0, n - 1))
        self.cur_index = 0
        self._show_index(0)

    def _show_index(self, i):
        if not self.cur_files:
            return
        self.cur_index = max(0, min(i, len(self.cur_files) - 1))
        path = self.cur_files[self.cur_index]
        try:
            self.base_img = Image.open(path).convert("RGB")
        except Exception as e:
            self.base_img = None
            self.status_lbl.config(text=f"Lỗi mở ảnh: {path.name} ({e})")
            return
        self._syncing_slider = True
        try:
            self.slice_scale.set(self.cur_index)
        finally:
            self._syncing_slider = False
        self.idx_lbl.config(text=f"{self.cur_index + 1}/{len(self.cur_files)}")
        self.status_lbl.config(text=f"{self.series_var.get()}  •  {path.name}")
        self._render()

    def _on_slider(self, v):
        if self._syncing_slider:
            return
        self._show_index(int(float(v)))

    def _prev(self):
        if self.cur_files:
            self._show_index(self.cur_index - 1)

    def _next(self):
        if self.cur_files:
            self._show_index(self.cur_index + 1)

    def _on_wheel(self, e):
        if e.state & 0x0004:  # Ctrl -> zoom
            self._zoom_in() if e.delta > 0 else self._zoom_out()
        else:                 # cuộn -> đổi lát cắt
            self._next() if e.delta < 0 else self._prev()
        return "break"

    def _toggle_cine(self):
        if self.cine_playing:
            self.cine_playing = False
            self.play_btn.config(text="▶ Phim")
            if self.cine_job:
                self.root.after_cancel(self.cine_job)
                self.cine_job = None
        elif self.cur_files:
            self.cine_playing = True
            self.play_btn.config(text="⏸ Dừng")
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
        self.fit_mode = True
        self.bright_scale.set(1.0)
        self.contrast_scale.set(1.0)
        self._render()

    def _processed_image(self) -> "Image.Image | None":
        """Ảnh sau khi áp mọi chỉnh (sáng, tương phản, đảo màu, lật, xoay) — CHƯA zoom."""
        if self.base_img is None:
            return None
        img = self.base_img
        b = float(self.bright_scale.get())
        c = float(self.contrast_scale.get())
        if abs(b - 1.0) > 1e-3:
            img = ImageEnhance.Brightness(img).enhance(b)
        if abs(c - 1.0) > 1e-3:
            img = ImageEnhance.Contrast(img).enhance(c)
        if self.invert:
            img = ImageOps.invert(img)
        if self.flip_h:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        if self.flip_v:
            img = img.transpose(Image.FLIP_TOP_BOTTOM)
        if self.rotate:
            img = img.rotate(-self.rotate, expand=True)
        return img

    def _render(self):
        if not hasattr(self, "canvas"):
            return  # giao diện chưa dựng xong (bị gọi sớm khi khởi tạo thanh trượt)
        img = self._processed_image()
        if img is None:
            self.canvas.delete("all")
            return
        iw, ih = img.size
        cw = max(self.canvas.winfo_width(), 10)
        ch = max(self.canvas.winfo_height(), 10)
        if self.fit_mode:
            self.zoom = min(cw / iw, ch / ih)
        scale = self.zoom
        dw, dh = max(1, int(iw * scale)), max(1, int(ih * scale))
        disp = img.resize((dw, dh), Image.LANCZOS)
        self.tk_img = ImageTk.PhotoImage(disp)
        W, H = max(cw, dw), max(ch, dh)
        self.canvas.delete("all")
        self.canvas.configure(scrollregion=(0, 0, W, H))
        self.canvas.create_image(W // 2, H // 2, image=self.tk_img, anchor="center")

    def _save_current(self):
        img = self._processed_image()
        if img is None:
            return
        src = self.cur_files[self.cur_index]
        out = filedialog.asksaveasfilename(
            title="Lưu ảnh đang xem",
            initialfile=src.stem + "_edited.png",
            defaultextension=".png",
            filetypes=[("PNG (không mất dữ liệu)", "*.png"), ("JPEG", "*.jpg")],
        )
        if not out:
            return
        try:
            if out.lower().endswith((".jpg", ".jpeg")):
                img.save(out, "JPEG", quality=95, optimize=True, subsampling=0)
            else:
                img.save(out, "PNG", optimize=True)
            self.status_lbl.config(text=f"Đã lưu: {out}")
        except Exception as e:
            messagebox.showerror("Lỗi lưu", str(e))


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
