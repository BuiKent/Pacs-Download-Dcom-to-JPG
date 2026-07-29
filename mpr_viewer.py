"""
Lightweight PACS-style MPR and brain-tumor measurement workspace.

The viewer reads only JPG slices plus mpr-volume.json.  It intentionally uses
NumPy, Pillow and Tkinter already shipped with the main application: no local
server and no heavyweight 3D framework are required.
"""

from __future__ import annotations

import json
import math
from copy import deepcopy
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


def _angle_degrees(
    p1: tuple[float, float],
    vertex: tuple[float, float],
    p2: tuple[float, float],
    spacing: tuple[float, float],
) -> float:
    """Physical p1-vertex-p2 angle, corrected for anisotropic pixels."""
    sx, sy = spacing
    v1 = ((p1[0] - vertex[0]) * sx, (p1[1] - vertex[1]) * sy)
    v2 = ((p2[0] - vertex[0]) * sx, (p2[1] - vertex[1]) * sy)
    norm1 = math.hypot(*v1)
    norm2 = math.hypot(*v2)
    if norm1 <= 1e-9 or norm2 <= 1e-9:
        return 0.0
    cosine = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (norm1 * norm2)))
    return math.degrees(math.acos(cosine))


class MprPane:
    def __init__(self, owner: "MprWorkspace", parent, plane: str):
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

    def set_active(self, active: bool) -> None:
        color = "#20b8e8" if active else "#333333"
        self.canvas.configure(
            highlightbackground=color,
            highlightcolor=color,
            highlightthickness=2 if active else 1,
        )

    def sync_cursor(self) -> None:
        tool = self.owner.tool.get()
        self.canvas.configure(cursor="fleur" if tool == "pan" else "crosshair")

    def index(self) -> int:
        return self.owner.indices[self.plane]

    def _raw_plane(self) -> np.ndarray:
        return mpr_engine.plane_array(self.owner.volume, self.plane, self.index())

    def _crosshair_point(self) -> tuple[float, float]:
        x, y, z = self.owner.crosshair
        if self.plane == "axial":
            return float(x), float(y)
        if self.plane == "coronal":
            return float(x), float(self.owner.volume.shape[0] - 1 - z)
        return float(y), float(self.owner.volume.shape[0] - 1 - z)

    def _set_crosshair_from_point(self, point: tuple[float, float]) -> None:
        u, v = point
        x, y, z = self.owner.crosshair
        if self.plane == "axial":
            x, y = round(u), round(v)
        elif self.plane == "coronal":
            x, z = round(u), self.owner.volume.shape[0] - 1 - round(v)
        else:
            y, z = round(u), self.owner.volume.shape[0] - 1 - round(v)
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
        if not self.canvas.winfo_exists() or self.owner.volume is None:
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
        scales = ((canvas_w - 12) / physical_w, (canvas_h - 12) / physical_h)
        fit_scale = max(scales) if self.owner.fit_policy.get() == "cover" else min(scales)
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
        self._draw_orientation_labels()
        self.canvas.create_text(
            8,
            8,
            text=f"{PLANE_TITLES[self.plane]}  {self.index() + 1}/{self.owner.plane_count(self.plane)}",
            fill="#ffffff",
            anchor="nw",
            font=("Segoe UI", 9, "bold"),
        )

    def _draw_orientation_labels(self) -> None:
        try:
            left, right, top, bottom = mpr_engine.plane_orientation_labels(
                self.owner.manifest,
                self.plane,
            )
        except (KeyError, TypeError, ValueError):
            return
        width = max(self.canvas.winfo_width(), 20)
        height = max(self.canvas.winfo_height(), 20)
        style = {
            "fill": "#ffcf5c",
            "font": ("Segoe UI", 10, "bold"),
        }
        self.canvas.create_text(7, height / 2, text=left, anchor="w", **style)
        self.canvas.create_text(width - 7, height / 2, text=right, anchor="e", **style)
        self.canvas.create_text(width / 2, 7, text=top, anchor="n", **style)
        self.canvas.create_text(width / 2, height - 7, text=bottom, anchor="s", **style)

    def _draw_crosshair(self) -> None:
        point = self._crosshair_point()
        x, y = self.image_to_canvas(point)
        width = self.canvas.winfo_width()
        height = self.canvas.winfo_height()
        self.canvas.create_line(x, 0, x, height, fill="#45d7ff", dash=(4, 4), tags="crosshair")
        self.canvas.create_line(0, y, width, y, fill="#45d7ff", dash=(4, 4), tags="crosshair")

    def _draw_annotations(self) -> None:
        if not self.owner.show_annotations.get():
            return

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

        for item in self.owner.angles:
            if item["plane"] != self.plane or int(item["index"]) != current:
                continue
            p1 = tuple(item["p1"])
            vertex = tuple(item["vertex"])
            p2 = tuple(item["p2"])
            c1 = self.image_to_canvas(p1)
            cv = self.image_to_canvas(vertex)
            c2 = self.image_to_canvas(p2)
            self.canvas.create_line(*c1, *cv, *c2, fill="#ff9f43", width=2)
            self.canvas.create_oval(
                cv[0] - 3, cv[1] - 3, cv[0] + 3, cv[1] + 3,
                fill="#ff9f43", outline="",
            )
            self.canvas.create_text(
                cv[0] + 8, cv[1] - 8,
                text=f"{float(item['angle_deg']):.1f}°",
                fill="#ffb56b", anchor="sw",
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

        if (
            self.plane == self.owner.active_angle_plane
            and self.index() == self.owner.active_angle_index
            and self.owner.active_angle
        ):
            coords = [self.image_to_canvas(point) for point in self.owner.active_angle]
            if len(coords) >= 2:
                self.canvas.create_line(
                    *(value for point in coords for value in point),
                    fill="#ff9f43", width=2, dash=(4, 2),
                )
            for x, y in coords:
                self.canvas.create_oval(x - 3, y - 3, x + 3, y + 3, fill="#ff9f43", outline="")

    def _left_press(self, event) -> None:
        self.owner.select_plane(self.plane)
        if self.owner.tool.get() == "pan":
            self._pan_press(event)
            return
        point = self.canvas_to_image(*self._canvas_point(event))
        if point is None:
            return
        tool = self.owner.tool.get()
        if tool == "crosshair":
            self._set_crosshair_from_point(point)
        elif tool == "angle":
            self.owner.angle_click(self.plane, self.index(), point)
        elif tool in ("length", "ellipse"):
            self._drag_start = point

    def _left_drag(self, event) -> None:
        if self.owner.tool.get() == "pan":
            self._pan_drag(event)
            return
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
        if self.owner.tool.get() == "pan":
            self._pan_release(event)
            return
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
                self.owner.push_undo()
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


class MprWorkspace(ttk.Frame):
    """Reusable MPR viewport embedded in the application's main viewer area."""

    def __init__(self, parent):
        super().__init__(parent)
        self.series_folder: Optional[Path] = None
        self.volume: Optional[np.ndarray] = None
        self.manifest: dict = {}
        self.crosshair = [0, 0, 0]
        self.indices = {"axial": 0, "coronal": 0, "sagittal": 0}
        self.tool = tk.StringVar(value="crosshair")
        self.fit_policy = tk.StringVar(value="contain")
        self.display_mode = "mpr"
        self.brightness = tk.DoubleVar(value=1.0)
        self.contrast = tk.DoubleVar(value=1.0)
        self.lengths: list[dict] = []
        self.angles: list[dict] = []
        self.show_annotations = tk.BooleanVar(value=True)
        self.active_plane = "axial"
        self.active_plane_var = tk.StringVar(value="Đang thao tác: AXIAL")
        self.active_angle: list[tuple[float, float]] = []
        self.active_angle_plane: Optional[str] = None
        self.active_angle_index: Optional[int] = None
        self._undo_stack: list[dict] = []
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
        self.mpr_toolbar = None
        self.mpr_actions = None
        self.mpr_controls = None
        self.mpr_body = None
        self.model_toolbar = None
        self.model_frame = None
        self.info_var = tk.StringVar(value="Chọn một series MPR để bắt đầu.")
        self._build_ui()

    def load_series(self, series_folder: Path) -> bool:
        """Load one MPR package, reusing the cached volume when possible."""
        folder = Path(series_folder).resolve()
        if self.series_folder == folder and self.volume is not None:
            self.after_idle(self.refresh_all)
            return False
        try:
            volume, manifest = mpr_engine.load_mpr_volume(folder)
        except Exception as exc:
            raise ValueError(str(exc)) from exc

        self.series_folder = folder
        self.volume = volume
        self.manifest = manifest
        z_count, y_count, x_count = volume.shape
        self.crosshair[:] = [x_count // 2, y_count // 2, z_count // 2]
        self.indices.update(
            axial=self.crosshair[2],
            coronal=self.crosshair[1],
            sagittal=self.crosshair[0],
        )
        self.lengths = []
        self.angles = []
        self.active_angle = []
        self.active_angle_plane = None
        self.active_angle_index = None
        self._undo_stack = []
        self.rois = {"axial": {}, "coronal": {}, "sagittal": {}}
        self.active_polygon = []
        self.active_polygon_plane = None
        self.active_polygon_index = None
        self.tool.set("crosshair")
        self.display_mode = "mpr"
        self.brightness.set(1.0)
        self.contrast.set(1.0)
        self.fit_policy.set("contain")
        self._load_annotations()
        self._sync_3d_button()
        self.info_var.set(
            f"{manifest.get('series_type', 'T1')} · "
            f"{z_count} lát · "
            f"{float(manifest.get('slice_spacing', 0)):.2f} mm · "
            f"{manifest.get('series_description', folder.name)}"
        )
        for pane in self.panes.values():
            pane.fit = True
            pane.zoom = 1.0
            pane.pan_x = pane.pan_y = 0.0
        self.set_display_mode("mpr")
        self.after_idle(self.refresh_all)
        return True

    @property
    def is_loaded(self) -> bool:
        return self.volume is not None and self.series_folder is not None

    def _add_tooltip(self, widget, text: str) -> None:
        tip = {"window": None}

        def show(_event=None):
            if tip["window"] is not None:
                return
            window = tk.Toplevel(widget)
            window.wm_overrideredirect(True)
            window.wm_geometry(
                f"+{widget.winfo_rootx() + 8}+"
                f"{widget.winfo_rooty() + widget.winfo_height() + 5}"
            )
            tk.Label(
                window,
                text=text,
                background="#ffffe0",
                relief="solid",
                borderwidth=1,
                padx=6,
                pady=2,
            ).pack()
            tip["window"] = window

        def hide(_event=None):
            if tip["window"] is not None:
                tip["window"].destroy()
                tip["window"] = None

        widget.bind("<Enter>", show, add="+")
        widget.bind("<Leave>", hide, add="+")
        widget.bind("<ButtonPress>", hide, add="+")

    def _select_tool(self, tool: str) -> None:
        self.tool.set(tool)
        self.cancel_draft(refresh=False)
        for pane in self.panes.values():
            pane.sync_cursor()
        self.refresh_planes()

    def _set_fit_policy(self, policy: str) -> None:
        if policy not in ("contain", "cover"):
            return
        self.fit_policy.set(policy)
        for pane in self.panes.values():
            pane.zoom = 1.0
            pane.pan_x = pane.pan_y = 0.0
        self.refresh_planes()

    def _sync_3d_button(self) -> None:
        if hasattr(self, "open_3d_btn"):
            self.open_3d_btn.config(
                state="normal" if self.rois.get("axial") else "disabled",
            )

    def set_display_mode(self, mode: str) -> bool:
        if mode not in ("mpr", "3d"):
            raise ValueError(f"Chế độ MPR không hợp lệ: {mode}")
        if mode == "3d" and not self.rois.get("axial"):
            self.bell()
            return False
        self.display_mode = mode
        if mode == "3d":
            for frame in (
                self.mpr_toolbar,
                self.mpr_actions,
                self.mpr_controls,
                self.mpr_body,
            ):
                frame.pack_forget()
            self.model_toolbar.pack(
                fill="x", padx=6, pady=(2, 4), before=self.status,
            )
            self.model_frame.pack(
                fill="both", expand=True, padx=6, pady=(0, 4), before=self.status,
            )
            self.after_idle(self.render_3d)
        else:
            self.model_toolbar.pack_forget()
            self.model_frame.pack_forget()
            self.mpr_toolbar.pack(
                fill="x", padx=6, pady=2, before=self.status,
            )
            self.mpr_actions.pack(
                fill="x", padx=6, pady=(0, 2), before=self.status,
            )
            self.mpr_controls.pack(
                fill="x", padx=6, pady=(0, 4), before=self.status,
            )
            self.mpr_body.pack(
                fill="both", expand=True, padx=6, pady=(0, 4), before=self.status,
            )
            self.after_idle(self.refresh_planes)
        return True

    def _reset_3d_camera(self) -> None:
        self.yaw.set(-35.0)
        self.pitch.set(25.0)
        self.render_3d()

    def _build_ui(self) -> None:
        header = ttk.Frame(self)
        header.pack(fill="x", padx=8, pady=(6, 2))
        self.mpr_toolbar = ttk.Frame(self)
        self.mpr_toolbar.pack(fill="x", padx=6, pady=2)
        toolbar = self.mpr_toolbar
        ttk.Label(
            header,
            textvariable=self.info_var,
            font=("Segoe UI", 10, "bold"),
        ).pack(side="left", fill="x", expand=True)
        ttk.Label(
            header,
            textvariable=self.active_plane_var,
            foreground="#4b6f8f",
        ).pack(side="right", padx=(10, 0))

        for icon, value, tooltip in (
            ("⌖", "crosshair", "Crosshair liên kết ba mặt phẳng"),
            ("✋", "pan", "Bàn tay: kéo ảnh bằng chuột trái"),
            ("↔", "length", "Đo chiều dài"),
            ("∠", "angle", "Đo góc bằng ba điểm"),
            ("◯", "ellipse", "Vẽ ROI ellipse"),
            ("⬡", "polygon", "Vẽ ROI đa giác"),
        ):
            button = ttk.Radiobutton(
                toolbar,
                text=icon,
                value=value,
                variable=self.tool,
                command=lambda selected=value: self._select_tool(selected),
                style="Toolbutton",
                width=3,
            )
            button.pack(side="left", padx=1)
            self._add_tooltip(button, tooltip)

        self.mpr_actions = ttk.Frame(self)
        self.mpr_actions.pack(fill="x", padx=6, pady=(0, 2))
        actions = self.mpr_actions
        ttk.Button(actions, text="Kết thúc ROI", command=self.finish_polygon).pack(side="left", padx=2)
        undo_btn = ttk.Button(actions, text="↶", width=3, command=self.undo_last)
        undo_btn.pack(side="left", padx=1)
        self._add_tooltip(undo_btn, "Hoàn tác annotation cuối")
        delete_btn = ttk.Button(actions, text="⌫", width=3, command=self.delete_current_annotations)
        delete_btn.pack(side="left", padx=1)
        self._add_tooltip(delete_btn, "Xóa annotation ở lát và mặt phẳng đang chọn")
        annotations_btn = ttk.Checkbutton(
            actions, text="◉", variable=self.show_annotations,
            command=self.refresh_planes, style="Toolbutton", width=3,
        )
        annotations_btn.pack(side="left", padx=1)
        self._add_tooltip(annotations_btn, "Ẩn/hiện số đo và ROI")
        whole_btn = ttk.Button(
            actions, text="⛶", width=3,
            command=lambda: self._set_fit_policy("contain"),
        )
        whole_btn.pack(side="left", padx=(8, 1))
        self._add_tooltip(whole_btn, "Hiện toàn bộ ảnh, không cắt mép")
        fill_btn = ttk.Button(
            actions, text="▣", width=3,
            command=lambda: self._set_fit_policy("cover"),
        )
        fill_btn.pack(side="left", padx=1)
        self._add_tooltip(fill_btn, "Lấp đầy viewport; có thể cắt mép, dùng bàn tay để kéo")
        reset_btn = ttk.Button(actions, text="↺", width=3, command=self.reset_views)
        reset_btn.pack(side="left", padx=1)
        self._add_tooltip(reset_btn, "Đặt lại zoom, pan, sáng và tương phản")
        self.open_3d_btn = ttk.Button(
            actions, text="3D ROI", command=lambda: self.set_display_mode("3d"),
            state="disabled",
        )
        self.open_3d_btn.pack(side="right", padx=2)

        self.mpr_controls = ttk.Frame(self)
        self.mpr_controls.pack(fill="x", padx=6, pady=(0, 4))
        controls = self.mpr_controls
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
            text="Lăn: đổi lát · Ctrl+lăn: zoom · Chuột phải: pan",
            foreground="#555555",
        ).pack(side="left", padx=8)

        self.mpr_body = ttk.Frame(self)
        self.mpr_body.pack(fill="both", expand=True, padx=6, pady=(0, 4))
        body = self.mpr_body
        body.rowconfigure(0, weight=1)
        for column in range(3):
            body.columnconfigure(column, weight=1)

        for plane, column in (
            ("axial", 0),
            ("coronal", 1),
            ("sagittal", 2),
        ):
            pane = MprPane(self, body, plane)
            pane.frame.grid(row=0, column=column, sticky="nsew", padx=2, pady=2)
            self.panes[plane] = pane
            pane.canvas.bind("<Button-1>", self._dispatch_polygon_click, add="+")
        self.select_plane("axial")
        for pane in self.panes.values():
            pane.sync_cursor()

        self.model_toolbar = ttk.Frame(self)
        back_btn = ttk.Button(
            self.model_toolbar, text="← MPR",
            command=lambda: self.set_display_mode("mpr"),
        )
        back_btn.pack(side="left", padx=(0, 10))
        ttk.Label(self.model_toolbar, text="Xoay").pack(side="left")
        ttk.Scale(
            self.model_toolbar,
            variable=self.yaw,
            from_=-180,
            to=180,
            command=lambda _v: self.render_3d(),
            length=220,
        ).pack(side="left", padx=(4, 12))
        ttk.Label(self.model_toolbar, text="Nghiêng").pack(side="left")
        ttk.Scale(
            self.model_toolbar,
            variable=self.pitch,
            from_=-90,
            to=90,
            command=lambda _v: self.render_3d(),
            length=220,
        ).pack(side="left", padx=(4, 12))
        camera_btn = ttk.Button(
            self.model_toolbar, text="↺", width=3,
            command=self._reset_3d_camera,
        )
        camera_btn.pack(side="left")
        self._add_tooltip(camera_btn, "Đặt lại góc nhìn 3D")

        self.model_frame = ttk.LabelFrame(self, text="3D U TỪ ROI AXIAL")
        self.model_frame.rowconfigure(0, weight=1)
        self.model_frame.columnconfigure(0, weight=1)
        self.model_canvas = tk.Canvas(
            self.model_frame, bg="#050505", highlightthickness=0,
        )
        self.model_canvas.grid(row=0, column=0, sticky="nsew")
        self.model_canvas.bind("<Configure>", lambda _e: self.render_3d())

        self.status = ttk.Label(self, text="", font=("Segoe UI", 10, "bold"))
        self.status.pack(fill="x", padx=8, pady=(0, 6))

    def _dispatch_polygon_click(self, event) -> None:
        if self.tool.get() != "polygon":
            return
        for pane in self.panes.values():
            if event.widget is pane.canvas:
                pane.polygon_click(event)
                break

    def select_plane(self, plane: str) -> None:
        if plane not in PLANE_TITLES:
            return
        self.active_plane = plane
        self.active_plane_var.set(f"Đang thao tác: {PLANE_TITLES[plane]}")
        for name, pane in self.panes.items():
            pane.set_active(name == plane)
        if self.volume is not None:
            self._update_status()

    def push_undo(self) -> None:
        self._undo_stack.append({
            "lengths": deepcopy(self.lengths),
            "angles": deepcopy(self.angles),
            "rois": deepcopy(self.rois),
        })
        del self._undo_stack[:-30]

    def undo_last(self) -> None:
        if not self._undo_stack:
            self.bell()
            return
        snapshot = self._undo_stack.pop()
        self.lengths = snapshot["lengths"]
        self.angles = snapshot["angles"]
        self.rois = snapshot["rois"]
        self.cancel_draft(refresh=False)
        self.save_annotations()
        self._sync_3d_button()
        self.refresh_all()

    def angle_click(
        self,
        plane: str,
        index: int,
        point: tuple[float, float],
    ) -> None:
        if self.active_angle_plane != plane or self.active_angle_index != index:
            self.active_angle = []
        self.active_angle_plane = plane
        self.active_angle_index = int(index)
        self.active_angle.append((float(point[0]), float(point[1])))
        if len(self.active_angle) < 3:
            self.refresh_planes()
            return
        p1, vertex, p2 = self.active_angle[:3]
        angle = _angle_degrees(
            p1, vertex, p2,
            mpr_engine.plane_spacing(self.manifest, plane),
        )
        if angle > 0.1:
            self.push_undo()
            self.angles.append({
                "plane": plane,
                "index": int(index),
                "p1": list(p1),
                "vertex": list(vertex),
                "p2": list(p2),
                "angle_deg": angle,
            })
            self.save_annotations()
        self.active_angle = []
        self.active_angle_plane = None
        self.active_angle_index = None
        self.refresh_all()

    def plane_count(self, plane: str) -> int:
        if self.volume is None:
            return 0
        if plane == "axial":
            return self.volume.shape[0]
        if plane == "coronal":
            return self.volume.shape[1]
        return self.volume.shape[2]

    def set_crosshair(self, x: int, y: int, z: int) -> None:
        if self.volume is None:
            return
        x = max(0, min(int(x), self.volume.shape[2] - 1))
        y = max(0, min(int(y), self.volume.shape[1] - 1))
        z = max(0, min(int(z), self.volume.shape[0] - 1))
        self.crosshair[:] = [x, y, z]
        self.indices.update(axial=z, coronal=y, sagittal=x)
        self.refresh_planes()

    def step_plane(self, plane: str, delta: int) -> None:
        if self.volume is None:
            return
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
        if self.volume is None:
            return
        for pane in self.panes.values():
            pane.render()
        self._update_status()

    def refresh_all(self) -> None:
        if self.volume is None:
            return
        if self.display_mode == "3d":
            self.render_3d()
        else:
            self.refresh_planes()

    def reset_views(self) -> None:
        if self.volume is None:
            return
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
        self.push_undo()
        self.rois.setdefault(plane, {})[int(index)] = clean
        self.save_annotations()
        self._sync_3d_button()
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

    def cancel_draft(self, refresh: bool = True) -> None:
        self.active_polygon = []
        self.active_polygon_plane = None
        self.active_polygon_index = None
        self.active_angle = []
        self.active_angle_plane = None
        self.active_angle_index = None
        if refresh and hasattr(self, "panes"):
            self.refresh_planes()

    def cancel_polygon(self) -> None:
        self.cancel_draft()

    def delete_current_annotations(self) -> None:
        plane = self.active_plane
        index = self.indices[plane]
        has_roi = index in self.rois.get(plane, {})
        has_length = any(
            item.get("plane") == plane and int(item.get("index", -1)) == index
            for item in self.lengths
        )
        has_angle = any(
            item.get("plane") == plane and int(item.get("index", -1)) == index
            for item in self.angles
        )
        if not (has_roi or has_length or has_angle):
            self.cancel_draft()
            return

        self.push_undo()
        self.rois.get(plane, {}).pop(index, None)
        self.lengths = [
            item for item in self.lengths
            if not (item.get("plane") == plane and int(item.get("index", -1)) == index)
        ]
        self.angles = [
            item for item in self.angles
            if not (item.get("plane") == plane and int(item.get("index", -1)) == index)
        ]
        self.save_annotations()
        self._sync_3d_button()
        self.cancel_draft(refresh=False)
        self.refresh_all()

    def _annotation_path(self) -> Path:
        if self.series_folder is None:
            raise ValueError("Chưa có series MPR đang mở.")
        return self.series_folder / ROI_FILE

    def _load_annotations(self) -> None:
        if self.series_folder is None:
            return
        path = self._annotation_path()
        if not path.is_file():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self.lengths = list(data.get("lengths", []))
            self.angles = list(data.get("angles", []))
            for plane, by_index in data.get("rois", {}).items():
                if plane not in self.rois:
                    continue
                self.rois[plane] = {
                    int(index): [(float(x), float(y)) for x, y in points]
                    for index, points in by_index.items()
                }
            if (
                self.volume is not None
                and data.get("display_convention") != "pacs-superior-up"
            ):
                # v1 stored coronal/sagittal coordinates against the old
                # inferior-up display. Preserve those measurements when the
                # PACS-style superior-up convention is first opened.
                last_row = float(self.volume.shape[0] - 1)

                def flip_point(point):
                    return [float(point[0]), last_row - float(point[1])]

                for item in self.lengths:
                    if item.get("plane") in ("coronal", "sagittal"):
                        item["p1"] = flip_point(item["p1"])
                        item["p2"] = flip_point(item["p2"])
                for item in self.angles:
                    if item.get("plane") in ("coronal", "sagittal"):
                        item["p1"] = flip_point(item["p1"])
                        item["vertex"] = flip_point(item["vertex"])
                        item["p2"] = flip_point(item["p2"])
                for plane in ("coronal", "sagittal"):
                    self.rois[plane] = {
                        index: [tuple(flip_point(point)) for point in points]
                        for index, points in self.rois[plane].items()
                    }
                self.save_annotations()
        except Exception:
            # Annotation corruption must never prevent opening the image volume.
            self.lengths = []
            self.angles = []
            self.rois = {"axial": {}, "coronal": {}, "sagittal": {}}

    def save_annotations(self) -> None:
        if self.series_folder is None or self.volume is None:
            return
        data = {
            "format": "dcom-mpr-roi",
            "version": 2,
            "display_convention": "pacs-superior-up",
            "series_instance_uid": self.manifest.get("series_instance_uid", ""),
            "lengths": self.lengths,
            "angles": self.angles,
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
        if self.volume is None:
            self.status.config(text="Chọn một series có dữ liệu MPR.")
            return
        axial = self.rois.get("axial", {})
        volume = mpr_engine.roi_volume_ml(axial, self.manifest)
        self._sync_3d_button()
        self.status.config(
            text=(
                f"ROI axial: {len(axial)} lát · Thể tích u: {volume:.2f} mL"
                if axial
                else "Để đo thể tích và dựng 3D u: vẽ ROI ellipse/đa giác trên nhiều lát AXIAL."
            )
        )

    def _tumor_points(self) -> np.ndarray:
        if self.volume is None:
            return np.empty((0, 3), dtype=np.float32)
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
        if self.model_canvas is None or self.volume is None:
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
