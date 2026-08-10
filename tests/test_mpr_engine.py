from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid

import mpr_engine
import dcom_pipeline
from web_backend import ArchiveCatalog


def _write_series(
    base: Path,
    description: str,
    count: int,
    *,
    series_number: int,
    spacing: float = 1.0,
    value_offset: int = 0,
    contrast_agent: str = "",
    modality: str = "MR",
    extension: str = ".dcm",
    window: tuple[float, float] | None = None,
    rescale: tuple[float, float] | None = None,
    pixel_fill: np.ndarray | None = None,
    study_uid: str | None = None,
    frame_uid: str | None = None,
) -> str:
    series_uid = generate_uid()
    study_uid = study_uid or generate_uid()
    frame_uid = frame_uid or generate_uid()
    folder = base / f"series-{series_number}-{series_uid[-8:]}"
    folder.mkdir(parents=True)
    for index in range(count):
        sop_uid = generate_uid()
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = MRImageStorage
        file_meta.MediaStorageSOPInstanceUID = sop_uid
        file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        file_meta.ImplementationClassUID = generate_uid()
        ds = FileDataset(
            str(folder / f"{index:04d}{extension}"),
            {},
            file_meta=file_meta,
            preamble=b"\0" * 128,
        )
        ds.SOPClassUID = MRImageStorage
        ds.SOPInstanceUID = sop_uid
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.FrameOfReferenceUID = frame_uid
        ds.Modality = modality
        ds.SeriesNumber = series_number
        ds.SeriesDescription = description
        ds.ProtocolName = description
        if contrast_agent:
            ds.ContrastBolusAgent = contrast_agent
        ds.ImageType = ["ORIGINAL", "PRIMARY", "M"]
        ds.InstanceNumber = index + 1
        ds.Rows = 16
        ds.Columns = 20
        ds.PixelSpacing = [0.5, 0.5]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = [0, 0, index * spacing]
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        if window is not None:
            ds.WindowCenter = window[0]
            ds.WindowWidth = window[1]
        if rescale is not None:
            ds.RescaleSlope = rescale[0]
            ds.RescaleIntercept = rescale[1]
        if pixel_fill is not None:
            pixels = pixel_fill.astype(np.uint16)
            ds.Rows, ds.Columns = pixels.shape
        else:
            pixels = (
                np.arange(ds.Rows * ds.Columns, dtype=np.uint16).reshape(ds.Rows, ds.Columns)
                + value_offset
                + index
            )
        ds.PixelData = pixels.tobytes()
        ds.save_as(str(folder / f"{index:04d}{extension}"), enforce_file_format=True)
    return series_uid


class MprSelectionTests(unittest.TestCase):
    def test_complete_ct_and_extensionless_dicom_are_volume_candidates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ct_uid = _write_series(
                root, "CT HEAD THIN", 101, series_number=2,
                modality="CT", extension="",
            )
            selected = mpr_engine.select_mpr_candidates(root)
            self.assertEqual([ct_uid], [item.series_uid for item in selected])
            self.assertEqual("CT_VOLUME", selected[0].kind)
            self.assertEqual("CT", selected[0].modality)

    def test_all_eligible_post_and_pre_are_returned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pre_uid = _write_series(root, "3D AX T1 BRAVO", 101, series_number=6)
            post_uid = _write_series(root, "3D AX T1 BRAVO+c", 101, series_number=9)
            selected = mpr_engine.select_mpr_candidates(root)
            self.assertEqual([post_uid, pre_uid], [item.series_uid for item in selected])
            self.assertEqual(
                ["T1_POST_CONTRAST", "T1_PRE_CONTRAST"],
                [item.kind for item in selected],
            )
            self.assertEqual(post_uid, mpr_engine.select_mpr_candidate(root).series_uid)

    def test_pre_contrast_is_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pre_uid = _write_series(root, "3D AX T1 MPRAGE", 101, series_number=4)
            selected = mpr_engine.select_mpr_candidate(root)
            self.assertIsNotNone(selected)
            self.assertEqual(pre_uid, selected.series_uid)
            self.assertEqual("T1_PRE_CONTRAST", selected.kind)

    def test_one_hundred_slices_is_not_eligible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_series(root, "3D AX T1 BRAVO+c", 100, series_number=9)
            self.assertIsNone(mpr_engine.select_mpr_candidate(root))


def _head_ct_phantom() -> tuple[np.ndarray, np.ndarray]:
    """A 16x20 head-CT-like slice: air, white matter, grey matter, skull."""
    hu = np.full((16, 20), -1000.0)
    hu[2:14, 2:18] = 30.0     # white matter
    hu[5:11, 6:14] = 40.0     # grey matter
    hu[2:14, 2:4] = 1200.0    # skull
    hu[2:14, 16:18] = 1200.0
    return hu, (hu + 1024.0).astype(np.uint16)


class MprWindowTests(unittest.TestCase):
    """The window baked into 8-bit MPR JPGs is irreversible, so it must come
    from the file's own VOI rather than from the volume's value spread."""

    def _ct_root(self, tmp: str, window: tuple[float, float] | None):
        root = Path(tmp)
        _, stored = _head_ct_phantom()
        _write_series(
            root, "PLAIN CT VOLUME", 101, series_number=2,
            modality="CT", window=window, rescale=(1.0, -1024.0),
            pixel_fill=stored,
        )
        candidate = mpr_engine.select_mpr_candidate(root)
        self.assertIsNotNone(candidate)
        return candidate

    def test_series_window_comes_from_the_dicom_voi(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = self._ct_root(tmp, window=(40.0, 80.0))
            low, high, method = mpr_engine._series_intensity_range(candidate)
            self.assertTrue(method.startswith("dicom_voi_linear"))
            self.assertIn("101/101", method)
            # PS3.3 C.11.2.1.2.1 LINEAR: centre - 0.5 +/- (width - 1) / 2.
            self.assertAlmostEqual(0.0, low)
            self.assertAlmostEqual(79.0, high)

    def test_brain_contrast_survives_the_dicom_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = self._ct_root(tmp, window=(40.0, 80.0))
            hu, _ = _head_ct_phantom()

            low, high, _ = mpr_engine._series_intensity_range(candidate)
            windowed = mpr_engine._to_uint8(hu.astype(np.float32), low, high, False)
            separation = abs(
                float(windowed[hu == 40].mean()) - float(windowed[hu == 30].mean())
            )

            # The old whole-volume percentile spans air to cortical bone, which
            # flattens grey/white matter to about one grey level.
            p_low, p_high = mpr_engine._percentile_intensity_range(candidate)
            flattened = mpr_engine._to_uint8(hu.astype(np.float32), p_low, p_high, False)
            percentile_separation = abs(
                float(flattened[hu == 40].mean()) - float(flattened[hu == 30].mean())
            )

            self.assertLessEqual(percentile_separation, 2.0)
            self.assertGreater(separation, 20.0)

    def test_series_without_any_voi_falls_back_to_percentile(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = self._ct_root(tmp, window=None)
            _, _, method = mpr_engine._series_intensity_range(candidate)
            self.assertEqual("series_percentile_0.5_99.5", method)

    def test_manifest_records_the_window_it_baked_in(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = self._ct_root(tmp, window=(40.0, 80.0))
            _, manifest_path = mpr_engine.convert_mpr_candidate(
                candidate, Path(tmp) / "jpg", quality=100, log=lambda _message: None,
            )
            manifest = mpr_engine.read_manifest(manifest_path.parent)
            intensity = manifest["intensity"]
            self.assertTrue(intensity["method"].startswith("dicom_voi_linear"))
            self.assertAlmostEqual(79.0, intensity["window_width"])
            self.assertAlmostEqual(39.5, intensity["window_center"])

    def test_multi_valued_window_takes_the_primary_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            # CT headers often carry soft-tissue then bone; the first is primary.
            candidate = self._ct_root(tmp, window=None)
            path = candidate.slices[0].path
            ds = pydicom.dcmread(str(path))
            ds.WindowCenter = [40, 400]
            ds.WindowWidth = [80, 1800]
            ds.save_as(str(path), enforce_file_format=True)
            self.assertEqual((40.0, 80.0, "LINEAR"), mpr_engine._stored_window(path))


class MprPackageTests(unittest.TestCase):
    def test_export_load_planes_and_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_series(root / "dicom", "3D AX T1 BRAVO+c", 101, series_number=9)
            candidate = mpr_engine.select_mpr_candidate(root / "dicom")
            self.assertIsNotNone(candidate)
            written, manifest_path = mpr_engine.convert_mpr_candidate(
                candidate,
                root / "jpg",
                quality=100,
                log=lambda _message: None,
            )
            self.assertEqual(101, written)
            self.assertTrue(manifest_path.is_file())

            volume, manifest = mpr_engine.load_mpr_volume(manifest_path.parent)
            self.assertEqual((101, 16, 20), volume.shape)
            self.assertEqual((16, 20), mpr_engine.plane_array(volume, "axial", 0).shape)
            coronal = mpr_engine.plane_array(volume, "coronal", 0)
            sagittal = mpr_engine.plane_array(volume, "sagittal", 0)
            self.assertEqual((101, 20), coronal.shape)
            self.assertEqual((101, 16), sagittal.shape)
            np.testing.assert_array_equal(coronal[0], volume[-1, 0, :])
            np.testing.assert_array_equal(sagittal[0], volume[-1, :, 0])

            orientation = {"image_orientation_patient": [1, 0, 0, 0, 1, 0]}
            self.assertEqual(
                ("R", "L", "S", "I"),
                mpr_engine.plane_orientation_labels(orientation, "coronal"),
            )
            self.assertEqual(
                ("A", "P", "S", "I"),
                mpr_engine.plane_orientation_labels(orientation, "sagittal"),
            )

            square = [(0, 0), (10, 0), (10, 10), (0, 10)]
            self.assertAlmostEqual(
                25.0,
                mpr_engine.polygon_area_mm2(square, (0.5, 0.5)),
                places=5,
            )
            self.assertAlmostEqual(
                0.025,
                mpr_engine.roi_volume_ml({0: square}, manifest),
                places=6,
            )

    def test_convert_all_keeps_post_and_pre_even_when_names_collide(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dicom = root / "dicom"
            pre_uid = _write_series(
                dicom, "3D AX T1 BRAVO", 101, series_number=9,
            )
            post_uid = _write_series(
                dicom, "3D AX T1 BRAVO", 101, series_number=9,
                contrast_agent="Gadovist",
            )
            _write_series(dicom, "Ax T2 FLAIR", 2, series_number=2)
            jpg = root / "jpg"
            stats = dcom_pipeline.convert_all(
                dicom,
                jpg,
                quality=95,
                log=lambda _message: None,
            )
            self.assertEqual(202, stats.mpr_converted)
            self.assertEqual(204, stats.converted)
            mpr_folders = [
                p for p in jpg.iterdir()
                if (mpr_engine.read_manifest(p) or {}).get("series_type") != "JPG_GENERIC"
            ]
            self.assertEqual(2, len(mpr_folders))
            manifests = [mpr_engine.read_manifest(path) for path in mpr_folders]
            self.assertEqual(
                {pre_uid, post_uid},
                {manifest["series_instance_uid"] for manifest in manifests},
            )
            self.assertEqual(
                {"T1_POST_CONTRAST", "T1_PRE_CONTRAST"},
                {manifest["series_type"] for manifest in manifests},
            )
            self.assertEqual(2, len({path.name for path in mpr_folders}))
            self.assertTrue(all(len(mpr_engine.manifest_image_files(path)) == 101 for path in mpr_folders))
            self.assertTrue(all(not list(path.glob("IM_*.jpg")) for path in mpr_folders))
            normal_folders = [
                p for p in jpg.iterdir()
                if (mpr_engine.read_manifest(p) or {}).get("series_type") == "JPG_GENERIC"
            ]
            self.assertEqual(1, len(normal_folders))
            self.assertEqual(2, len(list(normal_folders[0].glob("IM_*.jpg"))))
            self.assertEqual("Series_2_Ax T2 FLAIR", normal_folders[0].name)

    def test_generic_jpg_keeps_real_geometry_for_2d_crosslink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dicom = root / "dicom"
            study_uid = generate_uid()
            frame_uid = generate_uid()
            _write_series(
                dicom,
                "Ax T2 FLAIR",
                4,
                series_number=2,
                spacing=5.0,
                study_uid=study_uid,
                frame_uid=frame_uid,
            )
            jpg = root / "jpg"
            dcom_pipeline.convert_all(
                dicom,
                jpg,
                quality=95,
                log=lambda _message: None,
            )

            folder = next(path for path in jpg.iterdir() if path.is_dir())
            manifest = mpr_engine.read_manifest(folder)
            self.assertIsNotNone(manifest)
            self.assertEqual("JPG_GENERIC", manifest["series_type"])
            self.assertEqual(frame_uid, manifest["frame_of_reference_uid"])
            self.assertFalse(manifest["frame_of_reference_synthetic"])
            self.assertEqual(4, manifest["slice_count"])
            self.assertEqual(
                [0.0, 5.0, 10.0, 15.0],
                [item["distance"] for item in manifest["ordered_slices"]],
            )
            self.assertEqual(
                ["IM_0001.jpg", "IM_0002.jpg", "IM_0003.jpg", "IM_0004.jpg"],
                [item["file"] for item in manifest["ordered_slices"]],
            )

            catalog = ArchiveCatalog()
            public = catalog.open(jpg)["series"][0]
            self.assertFalse(public["mprReady"])
            self.assertEqual(frame_uid, public["geometry"]["frameOfReferenceUID"])
            self.assertEqual([0.5, 0.5], public["geometry"]["pixelSpacing"])
            self.assertEqual(5.0, public["geometry"]["sliceSpacing"])


    def test_duplicate_patient_positions_fail_closed_without_crashing(self):
        item = {
            "file": "IM_0001.jpg",
            "rows": 16,
            "columns": 20,
            "pixel_spacing": [0.5, 0.5],
            "orientation": [1, 0, 0, 0, 1, 0],
            "position": [0, 0, 0],
            "frame_uid": "same-frame",
            "study_uid": "same-study",
            "series_uid": "same-series",
            "sop_instance_uid": "one",
        }
        duplicate = {
            **item,
            "file": "IM_0002.jpg",
            "sop_instance_uid": "two",
        }
        self.assertIsNone(
            dcom_pipeline._generic_jpg_spatial_geometry([item, duplicate]),
        )
        invalid_spacing = {**duplicate, "position": [0, 0, 5]}
        item["pixel_spacing"] = [0.0, 0.5]
        invalid_spacing["pixel_spacing"] = [0.0, 0.5]
        self.assertIsNone(
            dcom_pipeline._generic_jpg_spatial_geometry([item, invalid_spacing]),
        )


class SeriesFolderNamerTests(unittest.TestCase):
    def test_name_is_readable_and_stable_per_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            namer = mpr_engine.SeriesFolderNamer(Path(tmp))
            first = namer.name_for(3, "Ax T2 FLAIR FS", "1.2.3.1")
            self.assertEqual("Series_3_Ax T2 FLAIR FS", first)
            self.assertEqual(first, namer.name_for(3, "Ax T2 FLAIR FS", "1.2.3.1"))

    def test_second_series_with_the_same_name_gets_a_readable_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            namer = mpr_engine.SeriesFolderNamer(Path(tmp))
            first = namer.name_for(3, "Ax T2", "1.2.3.1")
            second = namer.name_for(3, "Ax T2", "1.2.3.2")
            self.assertEqual("Series_3_Ax T2", first)
            self.assertEqual("Series_3_Ax T2 (2)", second)

    def test_folder_from_an_older_build_is_reused_not_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = mpr_engine._legacy_series_folder_name(3, "Ax T2", "1.2.3.1")
            (root / legacy).mkdir()
            namer = mpr_engine.SeriesFolderNamer(root)
            self.assertEqual(legacy, namer.name_for(3, "Ax T2", "1.2.3.1"))


if __name__ == "__main__":
    unittest.main()
