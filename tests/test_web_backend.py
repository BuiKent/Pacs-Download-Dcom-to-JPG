import json
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

from web_backend import ArchiveCatalog, LocalApiServer, WebController, validate_mpr_manifest


def make_mpr(folder: Path, count: int = 101) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    slices = []
    for index in range(count):
        name = f"MPR_{index + 1:04d}.jpg"
        Image.new("L", (8, 6), index % 255).save(folder / name, quality=100)
        slices.append({
            "file": name,
            "position": [0.0, 0.0, float(index)],
            "distance": float(index),
            "sop_instance_uid": f"1.2.3.{index}",
        })
    manifest = {
        "format": "dcom-mpr-jpg",
        "version": 1,
        "series_type": "T1_POST_CONTRAST",
        "series_description": "T1 CE",
        "rows": 6,
        "columns": 8,
        "slice_count": count,
        "pixel_spacing": [0.5, 0.5],
        "slice_spacing": 1.0,
        "image_orientation_patient": [1, 0, 0, 0, 1, 0],
        "affine": [[0.5, 0, 0, 0], [0, 0.5, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
        "frame_of_reference_uid": "1.2.3",
        "ordered_slices": slices,
    }
    (folder / "mpr-volume.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


class ManifestValidationTests(unittest.TestCase):
    def test_complete_geometry_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            manifest = make_mpr(folder)
            self.assertEqual(validate_mpr_manifest(folder, manifest), (True, ""))

    def test_incomplete_or_reversed_geometry_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            manifest = make_mpr(folder)
            manifest["ordered_slices"][5]["distance"] = -1
            ready, reason = validate_mpr_manifest(folder, manifest)
            self.assertFalse(ready)
            self.assertIn("tọa độ", reason.lower())

    def test_short_stack_is_not_mpr_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            manifest = make_mpr(folder, count=10)
            ready, reason = validate_mpr_manifest(folder, manifest)
            self.assertFalse(ready)
            self.assertIn("101", reason)


class CatalogTests(unittest.TestCase):
    def test_same_folder_names_do_not_collide(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for parent in ("StudyA", "StudyB"):
                folder = root / parent / "Series_1"
                folder.mkdir(parents=True)
                Image.new("L", (4, 4)).save(folder / "1.jpg")
            snapshot = ArchiveCatalog().open(root)
            self.assertEqual(len(snapshot["series"]), 2)
            self.assertEqual(len({item["id"] for item in snapshot["series"]}), 2)


class ServerSecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.static = root / "static"
        self.static.mkdir()
        (self.static / "index.html").write_text("<h1>ok</h1>", encoding="utf-8")
        series = root / "archive" / "Series_1"
        series.mkdir(parents=True)
        Image.new("L", (4, 4), 80).save(series / "1.jpg")
        self.controller = WebController()
        self.controller.open_archive(str(root / "archive"))
        self.server = LocalApiServer(self.controller, self.static)
        self.server.start()

    def tearDown(self):
        self.server.stop()
        self.tmp.cleanup()

    def request(self, path, token=None):
        headers = {}
        if token is not None:
            headers["X-DCom-Token"] = token
        return urllib.request.urlopen(
            urllib.request.Request(
                f"http://127.0.0.1:{self.server.port}{path}",
                headers=headers,
            ),
            timeout=3,
        )

    def test_api_rejects_missing_token(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/bootstrap")
        self.assertEqual(caught.exception.code, 401)

    def test_authorized_image_uses_opaque_id(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.request(
            f"/api/series/{series_id}/image/0",
            self.server.token,
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")

    def test_path_traversal_is_not_served(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/series/../../image/0", self.server.token)
        self.assertEqual(caught.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
