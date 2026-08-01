import json
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid
from PIL import Image

from web_backend import ArchiveCatalog, LocalApiServer, WebController, validate_mpr_manifest


def write_local_dicom(
    path: Path,
    *,
    series_uid: str | None = None,
    frame_uid: str | None = None,
    instance_number: int = 1,
    position: float | None = None,
    number_of_frames: int = 1,
) -> None:
    sop_uid = generate_uid()
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = MRImageStorage
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = generate_uid()
    dataset = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = MRImageStorage
    dataset.SOPInstanceUID = sop_uid
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = series_uid or generate_uid()
    dataset.Modality = "MR"
    dataset.SeriesNumber = 1
    dataset.SeriesDescription = "LOCAL TEST"
    dataset.InstanceNumber = instance_number
    dataset.Rows = 4
    dataset.Columns = 4
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 16
    dataset.BitsStored = 12
    dataset.HighBit = 11
    dataset.PixelRepresentation = 0
    if number_of_frames > 1:
        dataset.NumberOfFrames = number_of_frames
    if position is not None:
        dataset.PixelSpacing = [0.5, 0.5]
        dataset.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        dataset.ImagePositionPatient = [0, 0, position]
        dataset.FrameOfReferenceUID = frame_uid or generate_uid()
    dataset.WindowCenter = 8
    dataset.WindowWidth = 16
    frame = np.arange(16, dtype=np.uint16).reshape(4, 4) + instance_number
    dataset.PixelData = np.repeat(frame[np.newaxis, ...], number_of_frames, axis=0).tobytes()
    dataset.save_as(str(path), enforce_file_format=True)


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
        "modality": "MR",
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
    def test_unsupported_multiframe_dicom_reports_cause_instead_of_zero_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_local_dicom(root / "enhanced.dcm", number_of_frames=3)

            with self.assertRaisesRegex(ValueError, "multi-frame"):
                ArchiveCatalog().open(root)

    def test_direct_dicom_geometry_enables_mpr_without_jpg_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            series_uid = generate_uid()
            frame_uid = generate_uid()
            for index in range(101):
                write_local_dicom(
                    root / f"slice-{index + 1:03d}.dcm",
                    series_uid=series_uid,
                    frame_uid=frame_uid,
                    instance_number=index + 1,
                    position=float(index),
                )

            series = ArchiveCatalog().open(root)["series"][0]

            self.assertTrue(series["mprReady"], series["mprReason"])
            self.assertEqual([0.5, 0.5], series["geometry"]["pixelSpacing"])
            self.assertEqual(1.0, series["geometry"]["sliceSpacing"])
            self.assertFalse((root / "mpr-volume.json").exists())

    def test_open_folder_detects_dicom_without_converting_to_jpg(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uid = generate_uid()
            write_local_dicom(root / "000002.dcm", series_uid=uid, instance_number=2)
            write_local_dicom(root / "000001.dcm", series_uid=uid, instance_number=1)

            snapshot = ArchiveCatalog().open(root)

            self.assertEqual(1, len(snapshot["series"]))
            series = snapshot["series"][0]
            self.assertEqual("dicom", series["sourceType"])
            self.assertEqual(2, series["sliceCount"])
            self.assertEqual(16, series["pixelData"]["bitsAllocated"])
            self.assertFalse(any(root.rglob("*.jpg")))

    def test_local_extensionless_dicom_import_converts_and_opens_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            write_local_dicom(source / "000001")
            controller = WebController()
            controller.output_root = root / "output"
            started = controller.start_local_dicom_import(str(source), {"quality": 100})
            self.assertEqual("local-import", started["kind"])
            deadline = time.time() + 5
            while controller.job.snapshot()["status"] == "running" and time.time() < deadline:
                time.sleep(0.01)
            finished = controller.job.snapshot()
            self.assertEqual("complete", finished["status"], finished["logs"])
            self.assertEqual(1, finished["result"]["converted"])
            self.assertEqual(1, len(finished["result"]["archive"]["series"]))
            self.assertFalse(finished["result"]["archive"]["series"][0]["mprReady"])

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

    def test_modality_is_fail_closed_and_raw_trees_are_pruned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ct = root / "Study_CT" / "Series_1"
            unknown = root / "Study" / "Series_2"
            raw = root / "RAW_JPG" / "ShouldNotAppear"
            for folder in (ct, unknown, raw):
                folder.mkdir(parents=True)
                Image.new("L", (4, 4)).save(folder / "1.jpg")
            snapshot = ArchiveCatalog().open(root)
            modalities = {item["name"]: item["modality"] for item in snapshot["series"]}
            self.assertEqual(modalities[str(Path("Study_CT") / "Series_1")], "CT")
            self.assertEqual(modalities[str(Path("Study") / "Series_2")], "UNKNOWN")
            self.assertFalse(any("ShouldNotAppear" in name for name in modalities))

    def test_archive_scan_runs_as_background_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            series = root / "Series_1"
            series.mkdir()
            Image.new("L", (4, 4)).save(series / "1.jpg")
            controller = WebController()
            started = controller.start_archive_scan(str(root))
            self.assertEqual(started["kind"], "archive")
            deadline = time.time() + 3
            while controller.job.snapshot()["status"] == "running" and time.time() < deadline:
                time.sleep(0.01)
            finished = controller.job.snapshot()
            self.assertEqual(finished["status"], "complete")
            self.assertEqual(len(finished["result"]["series"]), 1)

    def test_direct_dicom_annotations_are_saved_outside_source_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            write_local_dicom(source / "slice.dcm")
            controller = WebController()
            controller.annotation_root = root / "app-data" / "annotations"
            snapshot = controller.open_archive(str(source))
            series_id = snapshot["series"][0]["id"]

            controller.save_annotations(series_id, {"annotations": [{"annotationUID": "test"}]})

            self.assertFalse(any(source.glob("*annotations*.json")))
            self.assertTrue((controller.annotation_root / f"{series_id}.json").is_file())
            self.assertEqual(1, len(controller.get_annotations(series_id)["annotations"]))


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
        caught.exception.close()

    def test_authorized_image_uses_opaque_id(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.request(
            f"/api/series/{series_id}/image/0",
            self.server.token,
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")

    def test_direct_dicom_image_returns_original_16_bit_pixels(self):
        root = Path(self.tmp.name) / "dicom"
        root.mkdir()
        write_local_dicom(root / "slice.dcm", instance_number=3)
        self.controller.open_archive(str(root))
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]

        with self.request(
            f"/api/series/{series_id}/image/0",
            self.server.token,
        ) as response:
            body = response.read()
            self.assertEqual("application/vnd.dcom.pixel-data", response.headers["Content-Type"])
            self.assertEqual("uint16", response.headers["X-DCom-Pixel-Type"])
            self.assertEqual("4", response.headers["X-DCom-Rows"])
            pixels = np.frombuffer(body, dtype="<u2")
            np.testing.assert_array_equal(pixels, np.arange(16, dtype=np.uint16) + 3)

    def test_path_traversal_is_not_served(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/series/../../image/0", self.server.token)
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()


if __name__ == "__main__":
    unittest.main()
