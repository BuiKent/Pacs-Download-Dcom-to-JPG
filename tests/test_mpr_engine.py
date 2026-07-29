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


def _write_series(
    base: Path,
    description: str,
    count: int,
    *,
    series_number: int,
    spacing: float = 1.0,
    value_offset: int = 0,
    contrast_agent: str = "",
) -> str:
    series_uid = generate_uid()
    study_uid = generate_uid()
    frame_uid = generate_uid()
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
            str(folder / f"{index:04d}.dcm"),
            {},
            file_meta=file_meta,
            preamble=b"\0" * 128,
        )
        ds.is_little_endian = True
        ds.is_implicit_VR = False
        ds.SOPClassUID = MRImageStorage
        ds.SOPInstanceUID = sop_uid
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.FrameOfReferenceUID = frame_uid
        ds.Modality = "MR"
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
        pixels = (
            np.arange(ds.Rows * ds.Columns, dtype=np.uint16).reshape(ds.Rows, ds.Columns)
            + value_offset
            + index
        )
        ds.PixelData = pixels.tobytes()
        ds.save_as(str(folder / f"{index:04d}.dcm"), enforce_file_format=True)
    return series_uid


class MprSelectionTests(unittest.TestCase):
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
            mpr_folders = [p for p in jpg.iterdir() if mpr_engine.read_manifest(p)]
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
            normal_folders = [p for p in jpg.iterdir() if not mpr_engine.read_manifest(p)]
            self.assertEqual(1, len(normal_folders))
            self.assertEqual(2, len(list(normal_folders[0].glob("IM_*.jpg"))))


if __name__ == "__main__":
    unittest.main()
