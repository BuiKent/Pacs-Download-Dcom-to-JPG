from __future__ import annotations

import json
import tempfile
import tkinter as tk
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

import mpr_engine
from dcom_downloader_app import App


def _write_mpr_package(folder: Path, count: int = 8) -> None:
    folder.mkdir(parents=True)
    ordered = []
    for index in range(count):
        filename = f"MPR_{index + 1:04d}.jpg"
        pixels = np.full((24, 32), index * 20, dtype=np.uint8)
        Image.fromarray(pixels, mode="L").save(folder / filename, quality=100)
        ordered.append({
            "file": filename,
            "position": [0.0, 0.0, float(index)],
            "distance": float(index),
            "sop_instance_uid": str(index),
        })
    manifest = {
        "format": mpr_engine.MANIFEST_FORMAT,
        "version": mpr_engine.MANIFEST_VERSION,
        "series_type": "T1_POST_CONTRAST",
        "series_description": "UI TEST T1+C",
        "series_number": 1,
        "study_instance_uid": "1",
        "series_instance_uid": "2",
        "frame_of_reference_uid": "3",
        "rows": 24,
        "columns": 32,
        "slice_count": count,
        "pixel_spacing": [0.5, 0.5],
        "slice_spacing": 1.0,
        "image_orientation_patient": [1, 0, 0, 0, 1, 0],
        "affine": [],
        "intensity": {},
        "jpeg_quality": 100,
        "ordered_slices": ordered,
    }
    (folder / mpr_engine.MANIFEST_NAME).write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )


class EmbeddedMprUiTests(unittest.TestCase):
    def test_mpr_stays_in_main_window_and_reuses_volume(self):
        try:
            root = tk.Tk()
        except tk.TclError as exc:
            self.skipTest(f"Tk display unavailable: {exc}")
        root.withdraw()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                package = Path(tmp) / "MPR_T1_POST"
                _write_mpr_package(package)
                legacy_annotations = {
                    "format": "dcom-mpr-roi",
                    "version": 1,
                    "lengths": [{
                        "plane": "coronal",
                        "index": 0,
                        "p1": [2.0, 1.0],
                        "p2": [8.0, 2.0],
                    }],
                    "rois": {
                        "coronal": {
                            "0": [[2.0, 1.0], [8.0, 1.0], [8.0, 3.0]],
                        },
                    },
                }
                (package / "mpr-roi.json").write_text(
                    json.dumps(legacy_annotations), encoding="utf-8",
                )
                app = App(root)
                root.geometry("1024x640+-2000+-2000")
                root.deiconify()
                app._load_dir(Path(tmp))
                root.update()
                self.assertLessEqual(
                    app.panel_toggle_btn.winfo_x() + app.panel_toggle_btn.winfo_width(),
                    app.panel_toggle_btn.master.winfo_width(),
                )

                self.assertTrue(app._set_viewer_mode("mpr"))
                root.update()
                self.assertEqual("mpr", app.viewer_mode)
                self.assertTrue(app.mpr_workspace.is_loaded)
                self.assertTrue(app.download_panel_collapsed)
                self.assertFalse(
                    any(isinstance(widget, tk.Toplevel) for widget in root.winfo_children())
                )

                cached_volume = id(app.mpr_workspace.volume)
                app._set_viewer_mode("2d")
                root.update()
                self.assertFalse(app.download_panel_collapsed)
                app.pan_2d_enabled.set(True)
                app._toggle_2d_pan()
                self.assertEqual("fleur", app.canvas.cget("cursor"))
                self.assertEqual("break", app._pan_2d_press(SimpleNamespace(x=10, y=10)))
                self.assertEqual("break", app._pan_2d_drag(SimpleNamespace(x=20, y=15)))
                app._set_viewer_mode("mpr")
                root.update()
                self.assertEqual(cached_volume, id(app.mpr_workspace.volume))

                workspace = app.mpr_workspace
                self.assertEqual("mpr", workspace.display_mode)
                self.assertFalse(workspace.model_frame.winfo_ismapped())
                self.assertTrue(workspace.mpr_body.winfo_ismapped())
                self.assertEqual("disabled", str(workspace.open_3d_btn["state"]))
                self.assertEqual(
                    {"axial": 0, "coronal": 1, "sagittal": 2},
                    {
                        plane: int(pane.frame.grid_info()["column"])
                        for plane, pane in workspace.panes.items()
                    },
                )
                self.assertTrue(all(int(pane.frame.grid_info()["row"]) == 0 for pane in workspace.panes.values()))
                self.assertEqual([2.0, 6.0], workspace.lengths[0]["p1"])
                self.assertEqual((2.0, 6.0), workspace.rois["coronal"][0][0])
                migrated = json.loads((package / "mpr-roi.json").read_text(encoding="utf-8"))
                self.assertEqual(
                    "pacs-superior-up", migrated["display_convention"],
                )
                workspace.panes["coronal"]._set_crosshair_from_point((5.0, 0.0))
                self.assertEqual(7, workspace.crosshair[2])
                workspace.panes["sagittal"]._set_crosshair_from_point((4.0, 7.0))
                self.assertEqual(0, workspace.crosshair[2])
                workspace.set_crosshair(
                    workspace.volume.shape[2] // 2,
                    workspace.volume.shape[1] // 2,
                    workspace.volume.shape[0] // 2,
                )
                workspace.select_plane("coronal")
                old_coronal = workspace.indices["coronal"]
                app._viewer_next()
                self.assertEqual(old_coronal + 1, workspace.indices["coronal"])

                angle_index = workspace.indices["coronal"]
                workspace.angle_click("coronal", angle_index, (1.0, 1.0))
                workspace.angle_click("coronal", angle_index, (1.0, 10.0))
                workspace.angle_click("coronal", angle_index, (10.0, 10.0))
                self.assertEqual(1, len(workspace.angles))
                self.assertAlmostEqual(90.0, workspace.angles[0]["angle_deg"], places=5)
                workspace.undo_last()
                self.assertEqual([], workspace.angles)

                square = [(2.0, 2.0), (8.0, 2.0), (8.0, 8.0), (2.0, 8.0)]
                axial_index = workspace.indices["axial"]
                coronal_index = workspace.indices["coronal"]
                workspace.set_roi("axial", axial_index, square)
                self.assertEqual("normal", str(workspace.open_3d_btn["state"]))
                self.assertTrue(workspace.set_display_mode("3d"))
                root.update()
                self.assertEqual("3d", workspace.display_mode)
                self.assertTrue(workspace.model_frame.winfo_ismapped())
                self.assertTrue(workspace.model_toolbar.winfo_ismapped())
                self.assertFalse(workspace.mpr_body.winfo_ismapped())
                self.assertFalse(workspace.mpr_toolbar.winfo_ismapped())
                workspace._reset_3d_camera()
                self.assertAlmostEqual(-35.0, workspace.yaw.get())
                self.assertAlmostEqual(25.0, workspace.pitch.get())
                self.assertTrue(workspace.set_display_mode("mpr"))
                root.update()
                self.assertTrue(workspace.mpr_body.winfo_ismapped())
                self.assertFalse(workspace.model_frame.winfo_ismapped())

                pane = workspace.panes["axial"]
                workspace._set_fit_policy("contain")
                root.update()
                contain_scale = pane.px_per_mm
                workspace._set_fit_policy("cover")
                root.update()
                self.assertGreaterEqual(pane.px_per_mm, contain_scale)
                workspace._select_tool("pan")
                self.assertEqual("fleur", pane.canvas.cget("cursor"))
                workspace.set_roi("coronal", coronal_index, square)
                workspace.select_plane("coronal")
                workspace.delete_current_annotations()
                self.assertNotIn(coronal_index, workspace.rois["coronal"])
                self.assertIn(axial_index, workspace.rois["axial"])
                workspace.undo_last()
                self.assertIn(coronal_index, workspace.rois["coronal"])

                # A panel collapsed manually before entering MPR remains
                # collapsed after returning to 2D. Only automatic collapse is
                # automatically restored.
                app._set_viewer_mode("2d")
                app._toggle_download_panel(collapse=True)
                app._set_viewer_mode("mpr")
                app._set_viewer_mode("2d")
                root.update()
                self.assertTrue(app.download_panel_collapsed)

                app._toggle_download_panel(collapse=False)
                root.update()
                self.assertFalse(app.download_panel_collapsed)
                app._toggle_download_panel(collapse=True)
                root.update()
                self.assertTrue(app.download_panel_collapsed)
        finally:
            for job in root.tk.call("after", "info"):
                try:
                    root.after_cancel(job)
                except tk.TclError:
                    pass
            root.destroy()


def _write_jpg_series(folder: Path, count: int, offset: int) -> None:
    folder.mkdir(parents=True)
    for index in range(count):
        pixels = np.full((24, 32), offset + index, dtype=np.uint8)
        Image.fromarray(pixels, mode="L").save(
            folder / f"IMG_{index + 1:04d}.jpg",
            quality=100,
        )


class MultiViewUiTests(unittest.TestCase):
    def test_compare_and_six_eight_slice_montage(self):
        try:
            root = tk.Tk()
        except tk.TclError as exc:
            self.skipTest(f"Tk display unavailable: {exc}")
        root.withdraw()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                base = Path(tmp)
                _write_jpg_series(base / "SERIES_A", 12, 10)
                _write_jpg_series(base / "SERIES_B", 9, 100)
                app = App(root)
                root.geometry("1024x640+-2000+-2000")
                root.deiconify()
                app._load_dir(base)
                root.update()

                names = list(app.series_map)
                self.assertEqual(2, len(names))
                self.assertEqual("normal", str(app.compare_btn["state"]))
                self.assertTrue(app._set_2d_layout("compare"))
                root.update()
                self.assertTrue(app.compare_bar.winfo_ismapped())
                self.assertNotEqual(app.series_var.get(), app.compare_series_var.get())

                app.active_2d_pane = "right"
                app._step_2d(3)
                self.assertEqual(0, app.cur_index)
                self.assertEqual(3, app.compare_index)
                app.active_2d_pane = "left"
                app._step_2d(2)
                self.assertEqual(2, app.cur_index)
                self.assertEqual(3, app.compare_index)
                compare = app._layout_image()
                self.assertIsNotNone(compare)
                self.assertEqual((70, 24), compare.size)

                app.series_var.set(app.compare_series_var.get())
                app._on_series_change()
                root.update()
                self.assertNotEqual(app.series_var.get(), app.compare_series_var.get())
                self.assertIsNotNone(app._layout_image())

                long_name = next(name for name, files in app.series_map.items() if len(files) == 12)
                app.series_var.set(long_name)
                app._on_series_change()
                app._show_index(2)
                self.assertTrue(app._set_2d_layout("montage6"))
                montage6 = app._layout_image()
                self.assertIsNotNone(montage6)
                self.assertEqual((108, 54), montage6.size)
                self.assertEqual("3-8/12", app.idx_lbl.cget("text"))

                self.assertTrue(app._set_2d_layout("montage8"))
                app._show_index(9)
                montage8 = app._layout_image()
                self.assertIsNotNone(montage8)
                self.assertEqual((146, 54), montage8.size)
                self.assertEqual("10-12/12", app.idx_lbl.cget("text"))
                self.assertFalse(app.compare_bar.winfo_ismapped())

                self.assertTrue(app._set_2d_layout("single"))
                self.assertEqual("single", app.viewer_layout)

                only_name = app.series_var.get()
                app.series_map = {only_name: app.series_map[only_name]}
                app._set_2d_layout("single")
                app.viewer_layout = "compare"
                app._on_series_change()
                self.assertEqual("single", app.viewer_layout)
        finally:
            for job in root.tk.call("after", "info"):
                try:
                    root.after_cancel(job)
                except tk.TclError:
                    pass
            root.destroy()
if __name__ == "__main__":
    unittest.main()
