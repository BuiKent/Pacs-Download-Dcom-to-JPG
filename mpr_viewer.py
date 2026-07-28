"""
Lightweight PACS-style MPR and brain-tumor measurement window.

The viewer reads only JPG slices plus mpr-volume.json.  It intentionally uses
NumPy, Pillow and Tkinter already shipped with the main application: no local
server and no heavyweight 3D framework are required.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

import numpy as np
import tkinter as tk
from tkinter import ttk, messagebox
from PIL import Image, ImageDraw, ImageEnhance, ImageTk

import mpr_engine


ROI_FILE = "mpr-roi.json"
PLANE_TITLES = {
    "axial": "AXIAL",
    "coronal": "CORONAL",
    "sagittal": "SAGITTAL",
}


def _distance_mm(
    p1: tuple[float, float],
    p2: tuple[float, float],
    spacing: tuple[float, float],
) -> float:
    return math.hypot((p2[0] - p1[0]) * spacing[0], (p2[1] - p1[1]) * spacing[1])


class MprPane:
    def __init__(self, owner: "MprViewerWindow", parent, plane: str):
        self.owner = owner
        self.plane = plane
        self.frame = ttk.LabelFrame(parent, text=PLANE_TITLES[plane])
        self.frame.grid_propagate(False)
        self.canvas = tk.Canvas(
            self.frame,
            bg="#050505",
            highlightthickness=1,
            highlightbackground="#333333",
            cursor="crosshair",
        )
        self.canvas.pack(fill="both", expand=True)
        self.tk_image = None
        self.fit = True
        self.zoom = 1.0
        self.pan_x = 0.0
        self.pan_y = 0.0
        self.origin_x = 0.0
        self.origin_y = 0.0
        self.px_per_mm = 1.0
        self.spacing = (1.0, 1.0)
        self.image_shape = (1, 1)
        self._drag_start: Optional[tuple[float, float]] = None
        self._drag_preview: Optional[int] = None
        self._pan_start: Optional[tuple[float, float, float, float]] = None

        self.canvas.bind("<Configure>", lambda _e: self.render())
        self.canvas.bind("<ButtonPress-1>", self._left_press)
        self.canvas.bind("<B1-Motion>", self._left_drag)
        self.canvas.bind("<ButtonRelease-1>", self._left_release)
        self.canvas.bind("<Double-Button-1>", self._double_left)
        self.canvas.bind("<ButtonPress-3>", self._pan_press)
        self.canvas.bind("<B3-Motion>", self._pan_drag)
        self.canvas.bind("<ButtonRelease-3>", self._pan_release)
        self.canvas.bind("<MouseWheel>", self._wheel)

    def index(self) -> int:
        return self.owner.indices[self.plane]

    def _raw_plane(self) -> np.ndarray:
        return mpr_engine.plane_array(self.owner.volume, self.plane, self.index())

    def _crosshair_point(self) -> tuple[float, float]:
        x, y, z = self.owner.crosshair
        if self.plane == "axial":
            return float(x), float(y)
        if self.plane == "coronal":
            return float(x), float(z)
        return float(y), float(z)

    def _set_crosshair_from_point(self, point: tuple[float, float]) -> None:
        u, v = point
        x, y, z = self.owner.crosshair
        if self.plane == "axial":
            x, y = round(u), round(v)
        elif self.plane == "coronal":
            x, z = round(u), round(v)
        else:
            y, z = round(u), round(v)
        self.owner.set_crosshair(x, y, z)

    def _canvas_point(self, event) -> tuple[float, float]:
        return self.canvas.canvasx(event.x), self.canvas.canvasy(event.y)

    def canvas_to_image(self, x: float, y: float) -> Optional[tuple[float, float]]:
        sx, sy = self.spacing
        if self.px_per_mm <= 0:
            return None
        u = (x - self.origin_x) / (sx * self.px_per_mm)
        v = (y - self.origin_y) / (sy * self.px_per_mm)
        rows, cols = self.image_shape
        if u < 0 or v < 0 or u > cols - 1 or v > rows - 1:
            return None
        return u, v

    def image_to_canvas(self, point: tuple[float, float]) -> tuple[float, float]:
        sx, sy = self.spacing
        return (
            self.origin_x + point[0] * sx * self.px_per_mm,
            self.origin_y + point[1] * sy * self.px_per_mm,
        )

    def reset_view(self) -> None:
        self.fit = True
        self.zoom = 1.0
        self.pan_x = self.pan_y = 0.0
        self.render()

    def render(self) -> None:
        if not self.canvas.winfo_exists():
            return
        raw = self._raw_plane()
        self.image_shape = raw.shape
        self.spacing = mpr_engine.plane_spacing(self.owner.manifest, self.plane)
        image = Image.fromarray(raw, mode="L")
        brightness = float(self.owner.brightness.get())
        contrast = float(self.owner.contrast.get())
        if abs(brightness - 1.0) > 1e-3:
            image = ImageEnhance.Brightness(image).enhance(brightness)
        if abs(contrast - 1.0) > 1e-3:
            image = ImageEnhance.Contrast(image).enhance(contrast)

        rows, cols = raw.shape
        sx, sy = self.spacing
        canvas_w = max(self.canvas.winfo_width(), 20)
        canvas_h = max(self.canvas.winfo_height(), 20)
        physical_w = max(cols * sx, 1e-6)
        physical_h = max(rows * sy, 1e-6)
        fit_scale = min((canvas_w - 12) / physical_w, (canvas_h - 12) / physical_h)
        self.px_per_mm = max(fit_scale * self.zoom, 0.01)
        draw_w = max(1, round(physical_w * self.px_per_mm))
        draw_h = max(1, round(physical_h * self.px_per_mm))
        display = image.resize((draw_w, draw_h), Image.Resampling.LANCZOS)
        self.tk_image = ImageTk.PhotoImage(display)
        self.origin_x = (canvas_w - draw_w) / 2 + self.pan_x
        self.origin_y = (canvas_h - draw_h) / 2 + self.pan_y

        self.canvas.delete("all")
        self.canvas.create_image(self.origin_x, self.origin_y, image=self.tk_image, anchor="nw")
        self._draw_crosshair()
        self._draw_annotations()
        self.canvas.create_text(
            8,
            8,
            text=f"{PLANE_TITLES[self.plane]}  {self.index() + 1}/{self.owner.plane_count(self.plane)}",
            fill="#ffffff",
            anchor="nw",
            font=("Segoe UI", 9, "bold"),
        )

    def _draw_crosshair(self) -> None:
        point = self._crosshair_point()
        x, y = self.image_to_canvas(point)
        width = self.canvas.winfo_width()
        height = self.canvas.winfo_height()
        self.canvas.create_line(x, 0, x, height, fill="#45d7ff", dash=(4, 4), tags="crosshair")
        self.canvas.create_line(0, y, width, y, fill="#45d7ff", dash=(4, 4), tags="crosshair")

    def _draw_annotations(self) -> None:
        current = self.index()
        for item in self.owner.lengths:
            if item["plane"] != self.plane or int(item["index"]) != current:
                continue
            p1 = tuple(item["p1"])
            p2 = tuple(item["p2"])
            x1, y1 = self.image_to_canvas(p1)
            x2, y2 = self.image_to_canvas(p2)
            self.canvas.create_line(x1, y1, x2, y2, fill="#ffe45c", width=2)
            self.canvas.create_oval(x1 - 3, y1 - 3, x1 + 3, y1 + 3, fill="#ffe45c", outline="")
            self.canvas.create_oval(x2 - 3, y2 - 3, x2 + 3, y2 + 3, fill="#ffe45c", outline="")
            self.canvas.create_text(
                (x1 + x2) / 2,
                (y1 + y2) / 2 - 10,
                text=f"{float(item['length_mm']):.1f} mm",
                fill="#ffe45c",
                font=("Segoe UI", 9, "bold"),
            )

        points = self.owner.rois.get(self.plane, {}).get(current)
        if points:
            coords = []
            for point in points:
                coords.extend(self.image_to_canvas(tuple(point)))
            self.canvas.create_polygon(
                *coords,
                outline="#5cff75",
                fill="",
                width=2,
            )
            area = mpr_engine.polygon_area_mm2(
                [tuple(p) for p in points],
                self.spacing,
            )
            x, y = self.image_to_canvas(tuple(points[0]))
            self.canvas.create_text(
                x + 4,
                y - 8,
                text=f"{area / 100.0:.2f} cm²",
                fill="#5cff75",
                anchor="sw",
                font=("Segoe UI", 9, "bold"),
            )

        if self.plane == self.owner.active_polygon_plane and self.owner.active_polygon:
            coords = []
            for point in self.owner.active_polygon:
                coords.extend(self.image_to_canvas(point))
            if len(coords) >= 4:
                self.canvas.create_line(*coords, fill="#7dff91", width=2)
            for x, y in zip(coords[0::2], coords[1::2]):
                self.canvas.create_oval(x - 2, y - 2, x + 2, y + 2, fill="#7dff91", outline="")

    def _left_press(self, event) -> None:
        point = self.canvas_to_image(*self._canvas_point(event))
        if point is None:
            return
        tool = self.owner.tool.get()
        if tool == "crosshair":
            self._set_crosshair_from_point(point)
        elif tool in ("length", "ellipse"):
            self._drag_start = point

    def _left_drag(self, event) -> None:
        if self._drag_start is None:
            return
        point = self.canvas_to_image(*self._canvas_point(event))
        if point is None:
            return
        if self._drag_preview is not None:
            self.canvas.delete(self._drag_preview)
        x1, y1 = self.image_to_canvas(self._drag_start)
        x2, y2 = self.image_to_canvas(point)
        if self.owner.tool.get() == "ellipse":
            self._drag_preview = self.canvas.create_oval(
                x1, y1, x2, y2, outline="#5cff75", width=2, dash=(4, 2)
            )
        else:
            self._drag_preview = self.canvas.create_line(
                x1, y1, x2, y2, fill="#ffe45c", width=2, dash=(4, 2)
            )

    def _left_release(self, event) -> None:
        if self._drag_start is None:
            return
        end = self.canvas_to_image(*self._canvas_point(event))
        start = self._drag_start
        self._drag_start = None
        if self._drag_preview is not None:
            self.canvas.delete(self._drag_preview)
            self._drag_preview = None
        if end is None:
            return

        if self.owner.tool.get() == "length":
            length = _distance_mm(start, end, self.spacing)
            if length > 0.1:
                self.owner.lengths.append({
                    "plane": self.plane,
                    "index": self.index(),
                    "p1": list(start),
                    "p2": list(end),
                    "length_mm": length,
                })
                self.owner.save_annotations()
        elif self.owner.tool.get() == "ellipse":
            cx = (start[0] + end[0]) / 2
            cy = (start[1] + end[1]) / 2
            rx = abs(end[0] - start[0]) / 2
            ry = abs(end[1] - start[1]) / 2
            if rx >= 1 and ry >= 1:
                points = [
                    (cx + rx * math.cos(2 * math.pi * i / 48),
                     cy + ry * math.sin(2 * math.pi * i / 48))
                    for i in range(48)
                ]
                self.owner.set_roi(self.plane, self.index(), points)
        self.owner.refresh_all()

    def _double_left(self, event) -> str:
        if self.owner.tool.get() == "polygon" and self.owner.active_polygon_plane == self.plane:
            self.owner.finish_polygon()
            return "break"
        return ""

    def polygon_click(self, event) -> None:
        point = self.canvas_to_image(*self._canvas_point(event))
        if point is None:
            return
        if self.owner.active_polygon_plane not in (None, self.plane):
            self.owner.cancel_polygon()
        self.owner.active_polygon_plane = self.plane
        self.owner.active_polygon_index = self.index()
        self.owner.active_polygon.append(point)
        self.render()

    def _pan_press(self, event) -> None:
        x, y = self._canvas_point(event)
        self._pan_start = (x, y, self.pan_x, self.pan_y)

    def _pan_drag(self, event) -> None:
        if self._pan_start is None:
            return
        x, y = self._canvas_point(event)
        sx, sy, px, py = self._pan_start
        self.pan_x = px + x - sx
        self.pan_y = py + y - sy
        self.fit = False
        self.render()

    def _pan_release(self, _event) -> None:
        self._pan_start = None

    def _wheel(self, event) -> str:
        if event.state & 0x0004:
            factor = 1.15 if event.delta > 0 else 1 / 1.15
            self.zoom = min(12.0, max(0.1, self.zoom * factor))
            self.fit = False
            self.render()
        else:
            self.owner.step_plane(self.plane, 1 if event.delta < 0 else -1)
        return "break"


class MprViewerWindow(tk.Toplevel):
    def __init__(self, parent, series_folder: Path):
        super().__init__(parent)
        self.series_folder = Path(series_folder)
        try:
            self.volume, self.manifest = mpr_engine.load_mpr_volume(self.series_folder)
        except Exception as exc:
            self.destroy()
            raise ValueError(str(exc)) from exc

        self.title(f"MPR & u não — {self.manifest.get('series_description', self.series_folder.name)}")
        self.geometry("1450x900")
        self.minsize(1050, 700)
        self.configure(bg="#111111")

        z_count, y_count, x_count = self.volume.shape
        self.crosshair = [x_count // 2, y_count // 2, z_count // 2]
        self.indices = {
            "axial": self.crosshair[2],
            "coronal": self.crosshair[1],
            "sagittal": self.crosshair[0],
        }
        self.tool = tk.StringVar(value="crosshair")
        self.brightness = tk.DoubleVar(value=1.0)
        self.contrast = tk.DoubleVar(value=1.0)
        self.lengths: list[dict] = []
        self.rois: dict[str, dict[int, list[tuple[float, float]]]] = {
            "axial": {},
            "coronal": {},
            "sagittal": {},
        }
        self.active_polygon: list[tuple[float, float]] = []
        self.active_polygon_plane: Optional[str] = None
        self.active_polygon_index: Optional[int] = None
        self.yaw = tk.DoubleVar(value=-35.0)
        self.pitch = tk.DoubleVar(value=25.0)
        self.panes: dict[str, MprPane] = {}
        self.model_canvas = None
        self._load_annotations()
        self._build_ui()
        self.after(50, self.refresh_all)

    def _build_ui(self) -> None:
        toolbar = ttk.Frame(self)
        toolbar.pack(fill="x", padx=6, pady=5)
        ttk.Label(
            toolbar,
            text=f"{self.manifest.get('series_type', 'T1')} · "
                 f"{self.volume.shape[0]} lát · "
                 f"{self.manifest.get('slice_spacing', 0):.2f} mm",
            font=("Segoe UI", 10, "bold"),
        ).pack(side="left", padx=(0, 12))

        for text, value in (
            ("Crosshair", "crosshair"),
            ("Đo dài", "length"),
            ("ROI ellipse", "ellipse"),
            ("ROI đa giác", "polygon"),
        ):
            ttk.Radiobutton(
                toolbar,
                text=text,
                value=value,
                variable=self.tool,
                command=self.cancel_polygon,
            ).pack(side="left", padx=2)

        ttk.Button(toolbar, text="Kết thúc ROI", command=self.finish_polygon).pack(side="left", padx=(8, 2))
        ttk.Button(toolbar, text="Xóa lát hiện tại", command=self.delete_current_annotations).pack(side="left", padx=2)
        ttk.Button(toolbar, text="Đặt lại khung", command=self.reset_views).pack(side="left", padx=2)

        controls = ttk.Frame(self)
        controls.pack(fill="x", padx=6, pady=(0, 4))
        ttk.Label(controls, text="Sáng").pack(side="left")
        ttk.Scale(
            controls,
            variable=self.brightness,
            from_=0.2,
            to=3.0,
            orient="horizontal",
            command=lambda _v: self.refresh_planes(),
            length=180,
        ).pack(side="left", padx=(4, 12))
        ttk.Label(controls, text="Tương phản").pack(side="left")
        ttk.Scale(
            controls,
            variable=self.contrast,
            from_=0.2,
            to=3.0,
            orient="horizontal",
            command=lambda _v: self.refresh_planes(),
            length=180,
        ).pack(side="left", padx=(4, 12))
        ttk.Label(
            controls,
            text="Chuột: lăn = đổi lát · Ctrl+lăn = zoom · chuột phải = kéo ảnh",
            foreground="#555555",
        ).pack(side="left", padx=8)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, padx=6, pady=(0, 4))
        body.rowconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)

        for plane, row, column in (
            ("axial", 0, 0),
            ("coronal", 0, 1),
            ("sagittal", 1, 0),
        ):
            pane = MprPane(self, body, plane)
            pane.frame.grid(row=row, column=column, sticky="nsew", padx=2, pady=2)
            self.panes[plane] = pane
            pane.canvas.bind("<Button-1>", self._dispatch_polygon_click, add="+")

        model_frame = ttk.LabelFrame(body, text="3D U TỪ ROI AXIAL")
        model_frame.grid(row=1, column=1, sticky="nsew", padx=2, pady=2)
        model_frame.rowconfigure(0, weight=1)
        model_frame.columnconfigure(0, weight=1)
        self.model_canvas = tk.Canvas(model_frame, bg="#050505", highlightthickness=0)
        self.model_canvas.grid(row=0, column=0, columnspan=4, sticky="nsew")
        self.model_canvas.bind("<Configure>", lambda _e: self.render_3d())
        ttk.Label(model_frame, text="Xoay").grid(row=1, column=0, padx=4)
        ttk.Scale(
            model_frame,
            variable=self.yaw,
            from_=-180,
            to=180,
            command=lambda _v: self.render_3d(),
        ).grid(row=1, column=1, sticky="ew")
        ttk.Label(model_frame, text="Nghiêng").grid(row=1, column=2, padx=4)
        ttk.Scale(
            model_frame,
            variable=self.pitch,
            from_=-90,
            to=90,
            command=lambda _v: self.render_3d(),
        ).grid(row=1, column=3, sticky="ew")
        model_frame.columnconfigure(1, weight=1)
        model_frame.columnconfigure(3, weight=1)

        self.status = ttk.Label(self, text="", font=("Segoe UI", 10, "bold"))
        self.status.pack(fill="x", padx=8, pady=(0, 6))

        self.bind("<Escape>", lambda _e: self.cancel_polygon())
        self.bind("<Return>", lambda _e: self.finish_polygon())

    def _dispatch_polygon_click(self, event) -> None:
        if self.tool.get() != "polygon":
            return
        for pane in self.panes.values():
            if event.widget is pane.canvas:
                pane.polygon_click(event)
                break

    def plane_count(self, plane: str) -> int:
        if plane == "axial":
            return self.volume.shape[0]
        if plane == "coronal":
            return self.volume.shape[1]
        return self.volume.shape[2]

    def set_crosshair(self, x: int, y: int, z: int) -> None:
        x = max(0, min(int(x), self.volume.shape[2] - 1))
        y = max(0, min(int(y), self.volume.shape[1] - 1))
        z = max(0, min(int(z), self.volume.shape[0] - 1))
        self.crosshair[:] = [x, y, z]
        self.indices.update(axial=z, coronal=y, sagittal=x)
        self.refresh_planes()

    def step_plane(self, plane: str, delta: int) -> None:
        index = max(0, min(self.indices[plane] + delta, self.plane_count(plane) - 1))
        x, y, z = self.crosshair
        if plane == "axial":
            z = index
        elif plane == "coronal":
            y = index
        else:
            x = index
        self.set_crosshair(x, y, z)

    def refresh_planes(self) -> None:
        for pane in self.panes.values():
            pane.render()
        self._update_status()

    def refresh_all(self) -> None:
        self.refresh_planes()
        self.render_3d()

    def reset_views(self) -> None:
        self.brightness.set(1.0)
        self.contrast.set(1.0)
        for pane in self.panes.values():
            pane.fit = True
            pane.zoom = 1.0
            pane.pan_x = pane.pan_y = 0.0
        self.refresh_all()

    def set_roi(self, plane: str, index: int, points) -> None:
        clean = [(float(x), float(y)) for x, y in points]
        if len(clean) < 3:
            return
        self.rois.setdefault(plane, {})[int(index)] = clean
        self.save_annotations()
        self.cancel_polygon()
        self.refresh_all()

    def finish_polygon(self) -> None:
        if (
            self.active_polygon_plane is not None
            and self.active_polygon_index is not None
            and len(self.active_polygon) >= 3
        ):
            plane = self.active_polygon_plane
            index = self.active_polygon_index
            points = list(self.active_polygon)
            self.set_roi(plane, index, points)
        else:
            self.cancel_polygon()

    def cancel_polygon(self) -> None:
        self.active_polygon = []
        self.active_polygon_plane = None
        self.active_polygon_index = None
        if hasattr(self, "panes"):
            self.refresh_planes()

    def delete_current_annotations(self) -> None:
        changed = False
        for plane, index in self.indices.items():
            if index in self.rois.get(plane, {}):
                del self.rois[plane][index]
                changed = True
        before = len(self.lengths)
        self.lengths = [
            item for item in self.lengths
            if int(item.get("index", -1)) != self.indices.get(item.get("plane", ""), -2)
        ]
        changed = changed or len(self.lengths) != before
        if changed:
            self.save_annotations()
        self.cancel_polygon()
        self.refresh_all()

    def _annotation_path(self) -> Path:
        return self.series_folder / ROI_FILE

    def _load_annotations(self) -> None:
        path = self._annotation_path()
        if not path.is_file():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self.lengths = list(data.get("lengths", []))
            for plane, by_index in data.get("rois", {}).items():
                if plane not in self.rois:
                    continue
                self.rois[plane] = {
                    int(index): [(float(x), float(y)) for x, y in points]
                    for index, points in by_index.items()
                }
        except Exception:
            # Annotation corruption must never prevent opening the image volume.
            self.lengths = []
            self.rois = {"axial": {}, "coronal": {}, "sagittal": {}}

    def save_annotations(self) -> None:
        data = {
            "format": "dcom-mpr-roi",
            "version": 1,
            "series_instance_uid": self.manifest.get("series_instance_uid", ""),
            "lengths": self.lengths,
            "rois": {
                plane: {str(index): points for index, points in by_index.items()}
                for plane, by_index in self.rois.items()
            },
        }
        path = self._annotation_path()
        temp = path.with_suffix(".json.tmp")
        try:
            temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(path)
        except Exception as exc:
            messagebox.showwarning("Không lưu được ROI", str(exc), parent=self)

    def _update_status(self) -> None:
        axial = self.rois.get("axial", {})
        volume = mpr_engine.roi_volume_ml(axial, self.manifest)
        self.status.config(
            text=(
                f"ROI axial: {len(axial)} lát · Thể tích u: {volume:.2f} mL"
                if axial
                else "Để đo thể tích và dựng 3D u: vẽ ROI ellipse/đa giác trên nhiều lát AXIAL."
            )
        )

    def _tumor_points(self) -> np.ndarray:
        axial = self.rois.get("axial", {})
        if not axial:
            return np.empty((0, 3), dtype=np.float32)
        row_spacing, col_spacing = (float(v) for v in self.manifest["pixel_spacing"])
        dz = float(self.manifest["slice_spacing"])
        rows, cols = self.volume.shape[1:]
        sample_step = max(1, min(rows, cols) // 100)
        all_points = []
        for z, polygon in axial.items():
            mask = Image.new("1", (cols, rows), 0)
            ImageDraw.Draw(mask).polygon([(float(x), float(y)) for x, y in polygon], fill=1)
            sampled = np.asarray(mask, dtype=np.uint8)[::sample_step, ::sample_step]
            yy, xx = np.nonzero(sampled)
            if len(xx) == 0:
                continue
            xx = xx.astype(np.float32) * sample_step * col_spacing
            yy = yy.astype(np.float32) * sample_step * row_spacing
            zz = np.full_like(xx, float(z) * dz)
            all_points.append(np.column_stack((xx, yy, zz)))
        return np.concatenate(all_points, axis=0) if all_points else np.empty((0, 3), dtype=np.float32)

    def render_3d(self) -> None:
        if self.model_canvas is None:
            return
        canvas = self.model_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 20)
        height = max(canvas.winfo_height(), 20)
        points = self._tumor_points()
        if len(points) == 0:
            canvas.create_text(
                width / 2,
                height / 2,
                text="Chưa có mô hình u\nVẽ ROI trên các lát AXIAL",
                fill="#aaaaaa",
                justify="center",
                font=("Segoe UI", 12, "bold"),
            )
            return

        points = points - points.mean(axis=0, keepdims=True)
        yaw = math.radians(float(self.yaw.get()))
        pitch = math.radians(float(self.pitch.get()))
        rz = np.array([
            [math.cos(yaw), -math.sin(yaw), 0],
            [math.sin(yaw), math.cos(yaw), 0],
            [0, 0, 1],
        ], dtype=np.float32)
        rx = np.array([
            [1, 0, 0],
            [0, math.cos(pitch), -math.sin(pitch)],
            [0, math.sin(pitch), math.cos(pitch)],
        ], dtype=np.float32)
        rotated = points @ (rz @ rx).T
        xy = rotated[:, :2]
        span = np.ptp(xy, axis=0)
        scale = min((width - 30) / max(float(span[0]), 1.0), (height - 45) / max(float(span[1]), 1.0))
        screen_x = width / 2 + xy[:, 0] * scale
        screen_y = height / 2 - xy[:, 1] * scale
        depth = rotated[:, 2]
        dmin, dmax = float(depth.min()), float(depth.max())
        normalized = (depth - dmin) / max(dmax - dmin, 1e-6)
        order = np.argsort(depth)
        skip = max(1, len(order) // 12000)
        for idx in order[::skip]:
            t = float(normalized[idx])
            color = f"#{int(70 + 150 * t):02x}{int(80 + 80 * (1-t)):02x}{int(210 - 70 * t):02x}"
            radius = 1.2 + t
            x, y = float(screen_x[idx]), float(screen_y[idx])
            canvas.create_oval(x - radius, y - radius, x + radius, y + radius, fill=color, outline="")
        volume = mpr_engine.roi_volume_ml(self.rois["axial"], self.manifest)
        canvas.create_text(
            8,
            8,
            text=f"Thể tích: {volume:.2f} mL · {len(self.rois['axial'])} lát ROI",
            fill="#ffffff",
            anchor="nw",
            font=("Segoe UI", 10, "bold"),
        )
