import io
import json
import shutil
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid
from PIL import Image

from web_backend import (
    ArchiveCatalog,
    JobState,
    LocalApiServer,
    MEDIA_WORK_ROOT,
    WebController,
    validate_mpr_manifest,
    _dicom_pixel_payload,
    _is_writable_dir,
    _local_import_plan,
    _redirect_plan,
    _study_from_folder_path,
)


class JobStateContractTests(unittest.TestCase):
    def test_dict_result_preserves_partial_status_and_nested_counts(self):
        job = JobState()
        job.start(
            "contract-test",
            lambda: {
                "status": "partial",
                "download": {"dicom": 7, "expected": 10},
            },
        )
        deadline = time.time() + 2
        while job.snapshot()["status"] == "running" and time.time() < deadline:
            time.sleep(0.01)
        snapshot = job.snapshot()
        self.assertEqual("partial", snapshot["status"])
        self.assertIn("7/10", snapshot["message"])

    def test_dict_cancelled_status_is_stopped(self):
        job = JobState()
        job.start("contract-test", lambda: {"status": "cancelled", "cancelled": True})
        deadline = time.time() + 2
        while job.snapshot()["status"] == "running" and time.time() < deadline:
            time.sleep(0.01)
        self.assertEqual("stopped", job.snapshot()["status"])


def _years_since(year: int, month: int, day: int) -> int:
    """Completed years from a birth date to today, as the backend computes it."""
    import datetime

    today = datetime.date.today()
    return today.year - year - ((today.month, today.day) < (month, day))


def write_local_dicom(
    path: Path,
    *,
    series_uid: str | None = None,
    frame_uid: str | None = None,
    instance_number: int = 1,
    position: float | None = None,
    number_of_frames: int = 1,
    skip_frame_uid: bool = False,
    frame_positions: list[float] | None = None,
    photometric: str = "MONOCHROME2",
    palette_bits: int = 8,
    frame_orientations: list[list[float]] | None = None,
    frame_rescale: tuple[float, float] | None = None,
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
        if skip_frame_uid:
            del dataset.FrameOfReferenceUID
    if frame_positions is not None or frame_orientations is not None or frame_rescale:
        # Enhanced layout: geometry and the modality LUT live in the functional
        # groups, not at the top level, exactly as a real Enhanced CT/MR file
        # stores them.
        measures = Dataset()
        measures.PixelSpacing = [0.5, 0.5]
        shared = Dataset()
        shared.PixelMeasuresSequence = Sequence([measures])
        # The shared orientation is always written, even when per-frame values
        # override it: otherwise a test for "per-frame orientation is honoured"
        # would pass merely because no orientation existed at all.
        plane = Dataset()
        plane.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        shared.PlaneOrientationSequence = Sequence([plane])
        if frame_rescale:
            transform = Dataset()
            transform.RescaleSlope = frame_rescale[0]
            transform.RescaleIntercept = frame_rescale[1]
            shared.PixelValueTransformationSequence = Sequence([transform])
        dataset.SharedFunctionalGroupsSequence = Sequence([shared])

        per_frame = []
        for index in range(number_of_frames):
            item = Dataset()
            if frame_positions is not None:
                position_item = Dataset()
                position_item.ImagePositionPatient = [0, 0, float(frame_positions[index])]
                item.PlanePositionSequence = Sequence([position_item])
            if frame_orientations is not None:
                plane_item = Dataset()
                plane_item.ImageOrientationPatient = list(frame_orientations[index])
                item.PlaneOrientationSequence = Sequence([plane_item])
            per_frame.append(item)
        dataset.PerFrameFunctionalGroupsSequence = Sequence(per_frame)
        if not skip_frame_uid:
            dataset.FrameOfReferenceUID = frame_uid or generate_uid()
    dataset.WindowCenter = 8
    dataset.WindowWidth = 16

    if photometric == "RGB":
        dataset.PhotometricInterpretation = "RGB"
        dataset.SamplesPerPixel = 3
        dataset.PlanarConfiguration = 0
        dataset.BitsAllocated = 8
        dataset.BitsStored = 8
        dataset.HighBit = 7
        rgb = np.zeros((4, 4, 3), dtype=np.uint8)
        rgb[..., 0] = np.arange(16, dtype=np.uint8).reshape(4, 4) * 15
        rgb[..., 1] = 64
        rgb[..., 2] = 200
        if number_of_frames > 1:
            rgb = np.stack([rgb] * number_of_frames)
        dataset.PixelData = rgb.tobytes()
        dataset.save_as(str(path), enforce_file_format=True)
        return

    if photometric.startswith("YBR"):
        # Store true red / green rows encoded as YBR, so a test can prove the
        # backend hands back the original colours rather than re-converting.
        from pydicom.pixels import convert_color_space

        dataset.PhotometricInterpretation = photometric
        dataset.SamplesPerPixel = 3
        dataset.PlanarConfiguration = 0
        dataset.BitsAllocated = 8
        dataset.BitsStored = 8
        dataset.HighBit = 7
        rgb = np.zeros((4, 4, 3), dtype=np.uint8)
        rgb[:2, :, 0] = 255
        rgb[2:, :, 1] = 255
        dataset.PixelData = convert_color_space(rgb, "RGB", photometric).tobytes()
        dataset.save_as(str(path), enforce_file_format=True)
        return

    if photometric == "PALETTE COLOR":
        dataset.PhotometricInterpretation = "PALETTE COLOR"
        dataset.SamplesPerPixel = 1
        dataset.BitsAllocated = 8
        dataset.BitsStored = 8
        dataset.HighBit = 7
        # 16-entry LUT: red ramps with the index, green/blue stay flat, so a
        # test can tell "LUT applied" from "raw indices passed through".
        descriptor = [16, 0, palette_bits]
        dataset.RedPaletteColorLookupTableDescriptor = descriptor
        dataset.GreenPaletteColorLookupTableDescriptor = descriptor
        dataset.BluePaletteColorLookupTableDescriptor = descriptor
        if palette_bits == 16:
            top = 65535
            ramp = np.array(
                [round(index * top / 15) for index in range(16)], dtype="<u2"
            ).tobytes()
            flat_green = np.full(16, round(32 * top / 255), dtype="<u2").tobytes()
            flat_blue = np.full(16, round(128 * top / 255), dtype="<u2").tobytes()
        else:
            ramp = bytes(range(0, 256, 16))
            flat_green = bytes([32] * 16)
            flat_blue = bytes([128] * 16)
        dataset.RedPaletteColorLookupTableData = ramp
        dataset.GreenPaletteColorLookupTableData = flat_green
        dataset.BluePaletteColorLookupTableData = flat_blue
        dataset.PixelData = np.arange(16, dtype=np.uint8).reshape(4, 4).tobytes()
        dataset.save_as(str(path), enforce_file_format=True)
        return

    frame = np.arange(16, dtype=np.uint16).reshape(4, 4) + instance_number
    if number_of_frames > 1:
        # Distinct frames, otherwise a test cannot tell frame 2 from frame 0.
        stack = np.stack([frame + index * 100 for index in range(number_of_frames)])
        dataset.PixelData = stack.astype(np.uint16).tobytes()
    else:
        dataset.PixelData = frame.tobytes()
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
    def test_multiframe_without_frame_geometry_is_browsable_frame_by_frame(self):
        """A multi-frame file with no PerFrameFunctionalGroupsSequence still
        becomes one slice per frame; only MPR/3D is withheld, and the reason
        must say why rather than pretending the file is unsupported."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_local_dicom(root / "enhanced.dcm", number_of_frames=3)

            catalog = ArchiveCatalog().open(root)
            self.assertEqual(len(catalog["series"]), 1)
            series = catalog["series"][0]
            self.assertEqual(3, series["sliceCount"])
            self.assertFalse(series["mprReady"])
            self.assertIn("multi-frame", series["mprReason"].lower())
            self.assertNotIn("geometry", series)
            self.assertEqual(3, series["pixelData"]["numberOfFrames"])

    def test_multiframe_with_functional_groups_gets_real_3d_geometry(self):
        """Enhanced geometry lives in the functional groups. Reading it turns
        the frames into a spatially ordered series with a usable manifest."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_local_dicom(
                root / "enhanced.dcm",
                number_of_frames=4,
                frame_positions=[0.0, 5.0, 10.0, 15.0],
            )

            catalog = ArchiveCatalog().open(root)
            series = catalog["series"][0]
            self.assertEqual(4, series["sliceCount"])
            geometry = series.get("geometry")
            self.assertIsNotNone(geometry, "per-frame positions must yield geometry")
            self.assertEqual([0.5, 0.5], list(geometry["pixelSpacing"]))
            self.assertEqual([1, 0, 0, 0, 1, 0], list(geometry["orientation"]))
            self.assertAlmostEqual(5.0, geometry["sliceSpacing"])

    def test_multiframe_pixel_payload_returns_the_requested_frame(self):
        """Each expanded slice must serve its own frame, not always frame 0."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "enhanced.dcm"
            write_local_dicom(path, number_of_frames=3)

            frames = []
            for index in range(3):
                body, headers = _dicom_pixel_payload(path, index)
                # Each frame is a 4×4 uint16 image → 32 bytes.
                self.assertEqual(len(body), 4 * 4 * 2)
                self.assertEqual(headers["X-DCom-Rows"], "4")
                self.assertEqual(headers["X-DCom-Columns"], "4")
                frames.append(body)

            self.assertEqual(3, len(set(frames)), f"frames must differ: {frames}")
            with self.assertRaises(IndexError):
                _dicom_pixel_payload(path, 3)

    def test_rgb_dicom_is_listed_and_served_as_rgb_bytes(self):
        """Colour DICOM (ultrasound, secondary capture) used to be dropped
        silently. It must open in 2D, with MPR/3D withheld for a stated
        reason, and the payload must be interleaved 8-bit RGB."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "color.dcm"
            write_local_dicom(path, photometric="RGB")

            catalog = ArchiveCatalog().open(root)
            self.assertEqual(len(catalog["series"]), 1)
            series = catalog["series"][0]
            self.assertFalse(series["mprReady"])
            self.assertIn("màu", series["mprReason"].lower())
            self.assertNotIn("geometry", series)

            body, headers = _dicom_pixel_payload(path)
            self.assertEqual(headers["X-DCom-Samples"], "3")
            self.assertEqual(headers["X-DCom-Photometric"], "RGB")
            self.assertEqual(headers["X-DCom-Pixel-Type"], "uint8")
            self.assertEqual(len(body), 4 * 4 * 3)

    def test_palette_color_dicom_is_expanded_through_the_lut(self):
        """PALETTE COLOR carries one sample plus a lookup table; the backend
        must resolve the LUT rather than hand the browser raw indices."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "palette.dcm"
            write_local_dicom(path, photometric="PALETTE COLOR")

            catalog = ArchiveCatalog().open(root)
            self.assertEqual(len(catalog["series"]), 1)

            body, headers = _dicom_pixel_payload(path)
            self.assertEqual(headers["X-DCom-Samples"], "3")
            self.assertEqual(len(body), 4 * 4 * 3)
            # Assert the LUT output itself, not merely "the values vary": raw
            # indices 0..15 also vary, so a variance check passes with the LUT
            # skipped entirely.  Red ramps by 16, green and blue stay flat.
            self.assertEqual(list(range(0, 256, 16)), list(body[0::3]))
            self.assertEqual({32}, set(body[1::3]))
            self.assertEqual({128}, set(body[2::3]))

    def test_multiframe_reads_modality_transform_from_functional_groups(self):
        """Enhanced CT states the modality LUT in
        PixelValueTransformationSequence. Reporting the top-level 1/0 default
        hands the viewer stored values while it believes they are Hounsfield."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "enhanced.dcm"
            write_local_dicom(
                path,
                number_of_frames=3,
                frame_positions=[0.0, 5.0, 10.0],
                frame_rescale=(2.0, -1024.0),
            )

            _, headers = _dicom_pixel_payload(path, 1)
            self.assertEqual(2.0, float(headers["X-DCom-Slope"]))
            self.assertEqual(-1024.0, float(headers["X-DCom-Intercept"]))

    def test_multiframe_with_mixed_orientations_is_not_treated_as_uniform(self):
        """Two frames on different planes cannot share one manifest; building
        one anyway would let crosslink and MPR act on a false geometry."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_local_dicom(
                root / "oblique.dcm",
                number_of_frames=2,
                frame_positions=[0.0, 5.0],
                frame_orientations=[
                    [1, 0, 0, 0, 1, 0],
                    [0, 1, 0, 0, 0, -1],
                ],
            )

            series = ArchiveCatalog().open(root)["series"][0]
            self.assertEqual(2, series["sliceCount"])
            self.assertFalse(series["mprReady"])
            self.assertNotIn("geometry", series)

    def test_two_multiframe_files_keep_each_file_frames_together(self):
        """Without a stable tie-break the frames of two files interleave as
        A0, B0, A1, B1 instead of following their own acquisition."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uid = generate_uid()
            # Same InstanceNumber on purpose: the file path and the frame index
            # are then the only things holding the order together, which is the
            # situation the interleaving bug showed up in.
            write_local_dicom(
                root / "a.dcm", series_uid=uid, instance_number=1, number_of_frames=2
            )
            write_local_dicom(
                root / "b.dcm", series_uid=uid, instance_number=1, number_of_frames=2
            )

            catalog = ArchiveCatalog()
            snapshot = catalog.open(root)
            record = catalog.get(snapshot["series"][0]["id"])
            order = [
                (item.name, frame)
                for item, frame in zip(record.images, record.frame_indices)
            ]
            self.assertEqual(
                [("a.dcm", 0), ("a.dcm", 1), ("b.dcm", 0), ("b.dcm", 1)], order
            )

    def test_colour_multiframe_keeps_the_colour_reason(self):
        """The multi-frame message must not overwrite a reason that has
        nothing to do with missing per-frame positions."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_local_dicom(root / "color.dcm", photometric="RGB", number_of_frames=3)

            series = ArchiveCatalog().open(root)["series"][0]
            self.assertEqual(3, series["sliceCount"])
            self.assertIn("màu", series["mprReason"].lower())
            self.assertNotIn("PerFrameFunctionalGroupsSequence", series["mprReason"])

    def test_ybr_dicom_keeps_its_original_colours(self):
        """pydicom already returns RGB for YBR, so converting again in the
        backend would apply the transform twice and tint the whole image."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ybr.dcm"
            write_local_dicom(path, photometric="YBR_FULL")

            body, headers = _dicom_pixel_payload(path)
            self.assertEqual(headers["X-DCom-Samples"], "3")
            pixels = np.frombuffer(body, dtype=np.uint8).reshape(4, 4, 3)
            # Rows 0-1 were pure red, rows 2-3 pure green, up to YBR rounding.
            self.assertGreater(int(pixels[0, 0, 0]), 240, f"red row lost: {pixels[0, 0]}")
            self.assertLess(int(pixels[0, 0, 1]), 15, f"red row tinted: {pixels[0, 0]}")
            self.assertLess(int(pixels[0, 0, 2]), 15, f"red row tinted: {pixels[0, 0]}")
            self.assertGreater(int(pixels[3, 0, 1]), 240, f"green row lost: {pixels[3, 0]}")
            self.assertLess(int(pixels[3, 0, 0]), 15, f"green row tinted: {pixels[3, 0]}")

    def test_palette_color_16bit_lut_scales_by_the_lut_depth(self):
        """A 16-bit LUT must be scaled by the descriptor's bits-per-entry.
        Using BitsStored (the *index* depth, 8) saturates everything to white."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "palette16.dcm"
            write_local_dicom(path, photometric="PALETTE COLOR", palette_bits=16)

            body, _ = _dicom_pixel_payload(path)
            reds = list(np.frombuffer(body, dtype=np.uint8)[0::3])
            self.assertEqual(list(range(0, 256, 17)), reds)
            self.assertEqual({32}, set(np.frombuffer(body, dtype=np.uint8)[1::3]))
            self.assertEqual({128}, set(np.frombuffer(body, dtype=np.uint8)[2::3]))

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

    def test_direct_dicom_manifest_preserves_patient_demographics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "patient.dcm"
            write_local_dicom(path, position=0.0)
            dataset = pydicom.dcmread(str(path), force=True)
            dataset.PatientID = "BN001"
            dataset.PatientName = "NGUYEN^VAN^A"
            dataset.PatientBirthDate = "20001231"
            dataset.PatientSex = "F"
            dataset.PatientAge = "025Y"
            dataset.save_as(str(path), enforce_file_format=True)

            catalog = ArchiveCatalog()
            snapshot = catalog.open(root)
            manifest = catalog.get(snapshot["series"][0]["id"]).manifest

            self.assertEqual("BN001", manifest["patient_id"])
            self.assertEqual("2000-12-31", manifest["patient_birth_date"])
            self.assertEqual("F", manifest["patient_sex"])
            self.assertEqual("025Y", manifest["patient_age"])

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

    def test_generic_jpg_without_mpr_exposes_study_date_in_manifest(self):
        """A generic JPG conversion without MPR (e.g. from 1 slice) still has a manifest,
        and its studyDate is exposed by the catalog for the frontend to render."""
        import pydicom
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            # Write a DICOM with a known study date
            dicom_path = source / "000001"
            write_local_dicom(dicom_path)
            ds = pydicom.dcmread(str(dicom_path))
            ds.StudyDate = "20230501"
            ds.save_as(str(dicom_path))

            controller = WebController()
            controller.output_root = root / "output"
            started = controller.start_local_dicom_import(str(source), {"quality": 100})
            
            deadline = time.time() + 5
            while controller.job.snapshot()["status"] == "running" and time.time() < deadline:
                time.sleep(0.01)
                
            finished = controller.job.snapshot()
            series = finished["result"]["archive"]["series"][0]
            
            self.assertFalse(series["mprReady"])
            self.assertEqual("2023-05-01", series.get("studyDate"))

    def test_legacy_generic_jpg_restores_crosslink_geometry_from_sibling_dicom(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dicom = root / "DICOM"
            dicom.mkdir()
            series_uid = generate_uid()
            frame_uid = generate_uid()
            write_local_dicom(
                dicom / "slice-1.dcm",
                series_uid=series_uid,
                frame_uid=frame_uid,
                instance_number=1,
                position=0.0,
            )
            write_local_dicom(
                dicom / "slice-2.dcm",
                series_uid=series_uid,
                frame_uid=frame_uid,
                instance_number=2,
                position=5.0,
            )

            jpg_root = root / "JPG"
            folder = jpg_root / "Series_1_LOCAL_TEST"
            folder.mkdir(parents=True)
            Image.new("L", (4, 4)).save(folder / "IM_0001.jpg")
            Image.new("L", (4, 4)).save(folder / "IM_0002.jpg")
            (folder / "mpr-volume.json").write_text(json.dumps({
                "format": "dcom-mpr-jpg",
                "version": 1,
                "series_type": "JPG_GENERIC",
                "series_description": "LOCAL TEST",
                "modality": "MR",
                "series_instance_uid": series_uid,
            }), encoding="utf-8")

            catalog = ArchiveCatalog()
            series = catalog.open(jpg_root)["series"][0]
            self.assertFalse(series["mprReady"])
            self.assertIn("geometry", series["mprReason"])
            self.assertEqual(frame_uid, series["geometry"]["frameOfReferenceUID"])
            manifest = catalog.get(series["id"]).manifest
            self.assertEqual(
                ["IM_0001.jpg", "IM_0002.jpg"],
                [item["file"] for item in manifest["ordered_slices"]],
            )
            self.assertEqual(
                [0.0, 5.0],
                [item["distance"] for item in manifest["ordered_slices"]],
            )

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

    def test_a_report_filed_beside_a_scan_is_listed_too(self):
        # A "benh_an" folder holds the scanned GPB picture and the typed MRI
        # report side by side. Only the first kind found was listed, so the
        # report sat on disk with nothing on the timeline pointing at it.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "benh_an"
            folder.mkdir(parents=True)
            Image.new("RGB", (8, 8), (240, 240, 235)).save(folder / "gpb_scan.jpg")
            (folder / "ket_qua_mri.txt").write_text("Thoai hoa sun do II.", encoding="utf-8")

            series = ArchiveCatalog().open(root)["series"]

            kinds = sorted(item["mediaType"] for item in series)
            self.assertEqual(["doc", "text"], kinds)
            # Two records in one folder must not collide on the same id.
            self.assertEqual(2, len({item["id"] for item in series}))

    def test_the_apps_own_bookkeeping_is_never_offered_as_a_report(self):
        # Every converted JPG series has `mpr-volume.json` beside it. Listing
        # companion material in a folder that already has pictures made that
        # geometry file show up on the timeline as a document to read.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "Series_1"
            folder.mkdir(parents=True)
            Image.new("L", (8, 8)).save(folder / "IM_0001.jpg")
            (folder / "mpr-volume.json").write_text("{}", encoding="utf-8")
            (folder / "patient-index.json").write_text("{}", encoding="utf-8")

            series = ArchiveCatalog().open(root)["series"]

            self.assertEqual(1, len(series))
            self.assertNotIn("text", {item["mediaType"] for item in series})

    def test_a_video_filed_beside_photos_is_listed_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "trong_mo"
            folder.mkdir(parents=True)
            Image.new("RGB", (8, 8), (20, 90, 140)).save(folder / "mo_01.jpg")
            (folder / "clip.mp4").write_bytes(bytes([0, 0, 0, 0x18]) + b"ftypmp42")

            series = ArchiveCatalog().open(root)["series"]

            self.assertEqual({"photo", "video"}, {item["mediaType"] for item in series})

    def test_archive_scan_refreshes_the_catalog_it_was_given(self):
        # "Cập nhật folder" is pressed inside a patient tab, and that tab reads
        # from its own session catalog. Scanning into the shared default left
        # the tab holding the series list from before the refresh.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            series = root / "Series_1"
            series.mkdir()
            Image.new("L", (4, 4)).save(series / "1.jpg")
            controller = WebController()
            session = controller.sessions.create_session(str(root))

            Image.new("L", (4, 4)).save(series / "2.jpg")
            controller.start_archive_scan(str(root), catalog=session.catalog)
            deadline = time.time() + 3
            while controller.job.snapshot()["status"] == "running" and time.time() < deadline:
                time.sleep(0.01)

            self.assertEqual("complete", controller.job.snapshot()["status"])
            scanned = session.catalog.snapshot()["series"]
            self.assertEqual(2, len(session.catalog.get(scanned[0]["id"]).images))
            # The shared default catalog was never opened and stays empty.
            self.assertEqual([], controller.catalog.snapshot()["series"])

    def test_saving_an_edit_names_it_after_the_page_that_was_edited(self):
        # A folder of intra-op photos is one series and the editor works on
        # whichever page is on screen. Naming every edit after the first file
        # made the second page read as a derivative of the first.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "anh_trong_mo"
            folder.mkdir(parents=True)
            for name in ("mo_01.jpg", "mo_02.jpg"):
                Image.new("RGB", (8, 8), (20, 90, 140)).save(folder / name)
            controller = WebController()
            snapshot = controller.open_archive(str(root))
            series_id = snapshot["series"][0]["id"]

            work = MEDIA_WORK_ROOT / "unit_test_edit.jpg"
            Image.new("RGB", (8, 8), (200, 20, 20)).save(work)
            try:
                saved = controller.save_media_edit(str(work), series_id, media_index=1)
            finally:
                work.unlink(missing_ok=True)

            self.assertTrue(saved["name"].startswith("mo_02_edit_"))
            Path(saved["savedPath"]).unlink(missing_ok=True)

    def test_saving_an_edit_falls_back_to_the_first_page(self):
        # An index the archive does not have must not raise at the reader.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "anh_trong_mo"
            folder.mkdir(parents=True)
            Image.new("RGB", (8, 8), (20, 90, 140)).save(folder / "mo_01.jpg")
            controller = WebController()
            series_id = controller.open_archive(str(root))["series"][0]["id"]

            work = MEDIA_WORK_ROOT / "unit_test_edit_oob.jpg"
            Image.new("RGB", (8, 8), (200, 20, 20)).save(work)
            try:
                saved = controller.save_media_edit(str(work), series_id, media_index=9)
            finally:
                work.unlink(missing_ok=True)

            self.assertTrue(saved["name"].startswith("mo_01_edit_"))
            Path(saved["savedPath"]).unlink(missing_ok=True)

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

    def request(self, path, token=None, extra=None):
        headers = dict(extra or {})
        if token is not None:
            headers["X-DCom-Token"] = token
        return urllib.request.urlopen(
            urllib.request.Request(
                f"http://127.0.0.1:{self.server.port}{path}",
                headers=headers,
            ),
            timeout=3,
        )

    def post_json(self, path, payload, token=None):
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-DCom-Token"] = token
        data = json.dumps(payload).encode("utf-8")
        return urllib.request.urlopen(
            urllib.request.Request(
                f"http://127.0.0.1:{self.server.port}{path}",
                data=data,
                headers=headers,
                method="POST",
            ),
            timeout=3,
        )

    def test_media_photo_api_endpoints(self):
        from PIL import Image, ImageDraw
        catalog_dir = Path(self.tmp.name) / "archive"
        img_path = catalog_dir / "test_photo.jpg"
        img = Image.new("RGB", (600, 800), "white")
        draw = ImageDraw.Draw(img)
        draw.text((50, 50), "PATIENT PHOTO TEST", fill="black")
        img.save(img_path, quality=90)

        # Test info
        with self.post_json("/api/media/photo/info", {"path": str(img_path)}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertEqual(body["info"]["width"], 600)
            self.assertEqual(body["info"]["height"], 800)

        # Test rotate
        with self.post_json("/api/media/photo/rotate", {"path": str(img_path), "degrees": 90}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_rot = Path(body["outputPath"])
            self.assertTrue(out_rot.exists())
            self.assertIn("url", body)

        # Test crop
        with self.post_json("/api/media/photo/crop", {"path": str(img_path), "rect": {"x": 10, "y": 10, "width": 100, "height": 100}}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_crop = Path(body["outputPath"])
            self.assertTrue(out_crop.exists())
            self.assertIn("url", body)

        # Test redact
        with self.post_json("/api/media/photo/redact", {"path": str(img_path), "regions": [{"x": 40, "y": 40, "width": 200, "height": 40}]}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_redact = Path(body["outputPath"])
            self.assertTrue(out_redact.exists())
            self.assertIn("url", body)

        # Test export PDF
        with self.post_json("/api/media/photo/export-pdf", {"sources": [str(img_path)]}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_pdf = Path(body["outputPath"])
            self.assertTrue(out_pdf.exists())
            self.assertIn("url", body)

    def test_media_video_api_endpoints(self):
        catalog_dir = Path(self.tmp.name) / "archive"
        vid_path = catalog_dir / "test_video.mp4"
        import subprocess
        import video_engine as ve
        # Generate 2s test video using bundled ffmpeg
        subprocess.run([
            ve._ffmpeg(), "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(vid_path),
        ], check=True, capture_output=True)

        # Test video status and encoders
        req_status = urllib.request.Request(
            f"{self.server.url.split('?')[0]}api/media/video/status",
            headers={"X-DCom-Token": self.server.token}
        )
        with urllib.request.urlopen(req_status) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertIn("stats", body)

        # Test video info
        with self.post_json("/api/media/video/info", {"path": str(vid_path)}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertEqual(body["info"]["width"], 320)
            self.assertEqual(body["info"]["height"], 240)
            self.assertGreater(body["info"]["durationSeconds"], 1.5)

        # Test video thumbnail
        with self.post_json("/api/media/video/thumbnail", {"path": str(vid_path), "atSeconds": 0.5}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_thumb = Path(body["outputPath"])
            self.assertTrue(out_thumb.exists())
            self.assertIn("url", body)

        # Test video trim
        with self.post_json("/api/media/video/trim", {"path": str(vid_path), "startSeconds": 0.0, "endSeconds": 1.0, "reencode": False}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_trim = Path(body["outputPath"])
            self.assertTrue(out_trim.exists())
            self.assertIn("url", body)

        # Test video burn-text
        with self.post_json("/api/media/video/burn-text", {"path": str(vid_path), "overlays": [{"text": "TEST OVERLAY"}]}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_burn = Path(body["outputPath"])
            self.assertTrue(out_burn.exists())
            self.assertIn("url", body)

        # Test video filmstrip
        with self.post_json("/api/media/video/filmstrip", {"path": str(vid_path), "count": 3}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertIn("frames", body)
            self.assertEqual(len(body["frames"]), 3)

        # Test video transcode
        with self.post_json("/api/media/video/transcode", {"path": str(vid_path), "crf": 30, "use_hw": False}, token=self.server.token) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            out_trans = Path(body["outputPath"])
            self.assertTrue(out_trans.exists())
            self.assertIn("url", body)

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

    def test_authorized_thumbnail_returns_jpeg(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.request(
            f"/api/series/{series_id}/thumbnail",
            self.server.token,
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")
            self.assertTrue(response.read().startswith(b"\xff\xd8\xff"))

    def test_thumbnail_rejects_missing_token(self):
        # The strip must fetch previews with the bearer token; a bare
        # <img src> carries no header and would only ever render broken.
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(f"/api/series/{series_id}/thumbnail")
        self.assertEqual(caught.exception.code, 401)
        caught.exception.close()

    def test_thumbnail_is_cached_after_first_request(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        record = self.controller.catalog.get(series_id)
        self.assertIsNone(record.thumbnail_bytes)
        with self.request(
            f"/api/series/{series_id}/thumbnail",
            self.server.token,
        ) as response:
            first = response.read()
        self.assertEqual(record.thumbnail_bytes, first)
        with self.request(
            f"/api/series/{series_id}/thumbnail",
            self.server.token,
        ) as response:
            self.assertEqual(response.read(), first)

    def test_direct_dicom_thumbnail_returns_jpeg(self):
        root = Path(self.tmp.name) / "dicom"
        root.mkdir()
        write_local_dicom(root / "slice.dcm", instance_number=3)
        self.controller.open_archive(str(root))
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]

        with self.request(
            f"/api/series/{series_id}/thumbnail",
            self.server.token,
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")
            data = response.read()
            self.assertTrue(data.startswith(b"\xff\xd8\xff"))
            image = Image.open(io.BytesIO(data))
            extrema = image.getextrema()
            max_pixels = [b_max for _min, b_max in extrema]
            self.assertTrue(any(val > 0 for val in max_pixels))

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

    def test_media_file_accepts_the_token_in_the_query(self):
        # <video src> and <embed src> cannot set a header. Without this the
        # player could only load a clip through fetch(), which holds the whole
        # operation in memory before the first frame appears.
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.request(
            f"/api/series/{series_id}/image/0?token={self.server.token}"
        ) as response:
            self.assertEqual(response.status, 200)

    def test_media_file_rejects_a_wrong_token_in_the_query(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(f"/api/series/{series_id}/image/0?token=khong-dung")
        self.assertEqual(caught.exception.code, 401)
        caught.exception.close()

    def test_query_token_unlocks_media_files_only(self):
        # A token in a URL is easier to leak than one in a header, so only the
        # read-only file routes take it. Nothing that returns patient data as
        # JSON, and nothing that writes, is reachable this way.
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(f"/api/archive?token={self.server.token}")
        self.assertEqual(caught.exception.code, 401)
        caught.exception.close()

    def test_media_file_serves_a_byte_range(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        whole = self.controller.catalog.get(series_id).images[0].read_bytes()
        with self.request(
            f"/api/series/{series_id}/image/0",
            self.server.token,
            extra={"Range": "bytes=0-15"},
        ) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(
                response.headers["Content-Range"], f"bytes 0-15/{len(whole)}"
            )
            self.assertEqual(response.read(), whole[:16])

    def test_media_file_serves_a_trailing_range(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        whole = self.controller.catalog.get(series_id).images[0].read_bytes()
        with self.request(
            f"/api/series/{series_id}/image/0",
            self.server.token,
            extra={"Range": "bytes=-8"},
        ) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), whole[-8:])

    def test_media_file_advertises_range_support(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        whole = self.controller.catalog.get(series_id).images[0].read_bytes()
        with self.request(
            f"/api/series/{series_id}/image/0", self.server.token
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Accept-Ranges"], "bytes")
            self.assertEqual(response.read(), whole)

    def test_media_file_refuses_a_range_past_the_end(self):
        series_id = self.controller.catalog.snapshot()["series"][0]["id"]
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(
                f"/api/series/{series_id}/image/0",
                self.server.token,
                extra={"Range": "bytes=999999-"},
            )
        self.assertEqual(caught.exception.code, 416)
        caught.exception.close()

    def test_path_traversal_is_not_served(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/series/../../image/0", self.server.token)
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()


class FrameOfReferenceSyntheticTests(unittest.TestCase):
    """Verify that public_dict correctly reports frameOfReferenceSynthetic
    for DICOM series with and without real FrameOfReferenceUID tags."""

    def test_dicom_without_for_tag_is_marked_synthetic(self):
        """Anonymized DICOM missing FrameOfReferenceUID must get
        frameOfReferenceSynthetic=True.  The synthetic FoR UID is derived
        from the study UID so same-study series share one FoR."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uid = generate_uid()
            for i in range(3):
                write_local_dicom(
                    root / f"slice-{i:03d}.dcm",
                    series_uid=uid,
                    instance_number=i + 1,
                    position=float(i * 5),
                    skip_frame_uid=True,
                )
            snapshot = ArchiveCatalog().open(root)
            series = snapshot["series"][0]
            geo = series.get("geometry", {})
            self.assertIn("frameOfReferenceSynthetic", geo)
            self.assertTrue(
                geo["frameOfReferenceSynthetic"],
                "DICOM without FrameOfReferenceUID must be marked synthetic",
            )
            # UID should still be present (fallback to study UID)
            self.assertTrue(geo.get("frameOfReferenceUID"))

    def test_dicom_with_real_for_tag_is_not_synthetic(self):
        """Normal DICOM with a real FrameOfReferenceUID tag must get
        frameOfReferenceSynthetic=False."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uid = generate_uid()
            fuid = generate_uid()
            for i in range(3):
                write_local_dicom(
                    root / f"slice-{i:03d}.dcm",
                    series_uid=uid,
                    frame_uid=fuid,
                    instance_number=i + 1,
                    position=float(i * 5),
                )
            snapshot = ArchiveCatalog().open(root)
            series = snapshot["series"][0]
            geo = series.get("geometry", {})
            self.assertIn("frameOfReferenceSynthetic", geo)
            self.assertFalse(
                geo["frameOfReferenceSynthetic"],
                "DICOM with real FrameOfReferenceUID must NOT be marked synthetic",
            )
            self.assertEqual(fuid, geo["frameOfReferenceUID"])

    def test_same_study_without_for_tag_share_synthetic_for(self):
        """Two series from the same study, both missing FrameOfReferenceUID,
        must receive the same synthetic FoR UID (derived from study UID).
        Two series from different studies must get different FoR UIDs."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            study_uid = generate_uid()
            series_a = generate_uid()
            series_b = generate_uid()
            series_c = generate_uid()
            other_study_uid = generate_uid()

            # Series A + B: same study, no FoR tag
            for i, sid in enumerate([series_a, series_b]):
                for j in range(3):
                    write_local_dicom(
                        root / f"s{i}_slice-{j:03d}.dcm",
                        series_uid=sid,
                        instance_number=j + 1,
                        position=float(j * 5),
                        skip_frame_uid=True,
                    )

            # Series C: different study, no FoR tag
            for j in range(3):
                write_local_dicom(
                    root / f"s2_slice-{j:03d}.dcm",
                    series_uid=series_c,
                    instance_number=j + 1,
                    position=float(j * 5),
                    skip_frame_uid=True,
                )

            # Patch study UIDs — write_local_dicom always makes a fresh one,
            # so we need to force them.
            import pydicom
            for dcm_path in root.glob("s0_*.dcm"):
                ds = pydicom.dcmread(str(dcm_path))
                ds.StudyInstanceUID = study_uid
                ds.save_as(str(dcm_path))
            for dcm_path in root.glob("s1_*.dcm"):
                ds = pydicom.dcmread(str(dcm_path))
                ds.StudyInstanceUID = study_uid
                ds.save_as(str(dcm_path))
            for dcm_path in root.glob("s2_*.dcm"):
                ds = pydicom.dcmread(str(dcm_path))
                ds.StudyInstanceUID = other_study_uid
                ds.save_as(str(dcm_path))

            snapshot = ArchiveCatalog().open(root)
            geos = [s.get("geometry", {}) for s in snapshot["series"]]
            for_uids = [g.get("frameOfReferenceUID") for g in geos if g]
            self.assertEqual(len(for_uids), 3, "Expected 3 series with geometry")
            self.assertTrue(all(for_uids))

            # Exactly two distinct FoR UIDs: A and B share the study UID,
            # C belongs to a different study and must stay separate.
            unique_fors = set(for_uids)
            self.assertEqual(
                len(unique_fors), 2,
                f"Expected 2 unique FoR UIDs (same-study pair + other study), "
                f"got {len(unique_fors)}: {unique_fors}",
            )
            self.assertIn(study_uid, unique_fors)
            self.assertIn(other_study_uid, unique_fors)

    def test_dicom_missing_study_date_falls_back_to_folder_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            study_folder = root / "2026-07-07 - CT - CT so nao" / "DICOM" / "Series_KEY_IMAGE"
            study_folder.mkdir(parents=True, exist_ok=True)
            dcm_path = study_folder / "key_image.dcm"
            write_local_dicom(dcm_path)

            # Clear StudyDate and StudyDescription from DICOM header
            ds = pydicom.dcmread(str(dcm_path))
            if "StudyDate" in ds:
                del ds.StudyDate
            if "StudyDescription" in ds:
                del ds.StudyDescription
            ds.save_as(str(dcm_path))

            snapshot = ArchiveCatalog().open(root)
            self.assertEqual(len(snapshot["series"]), 1)
            series = snapshot["series"][0]
            self.assertEqual(series["studyDate"], "2026-07-07")
            self.assertIn("2026-07-07", series["studyGroup"])
            self.assertIn("CT so nao", series["studyGroup"])

    def test_start_local_dicom_import_places_jpg_side_by_side(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            study_folder = root / "2026-07-07 - CT - CT so nao"
            dicom_folder = study_folder / "DICOM" / "Series_1"
            dicom_folder.mkdir(parents=True, exist_ok=True)
            dcm_path = dicom_folder / "image.dcm"
            write_local_dicom(dcm_path)

            controller = WebController()
            # Pass the study folder containing DICOM subfolder
            job_info = controller.start_local_dicom_import(str(study_folder))

            # Wait briefly for thread to finish
            for _ in range(50):
                if controller.job.status in {"complete", "error"}:
                    break
                time.sleep(0.1)

            self.assertEqual(controller.job.status, "complete")
            # Verify JPG folder was created side-by-side with DICOM inside study_folder
            expected_jpg_folder = study_folder / "JPG"
            self.assertTrue(expected_jpg_folder.is_dir())
            self.assertTrue(any(expected_jpg_folder.glob("**/mpr-volume.json")))


class LocalImportPlanTests(unittest.TestCase):
    """Every folder shape a user can hand to local import.

    Only the `<study>/DICOM` shape had coverage, yet the other three decide
    where converted JPGs land — getting one wrong writes a study's images
    into the wrong folder, which is invisible until the viewer opens empty.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_dicom_folder_itself_writes_jpg_beside_it(self) -> None:
        source = self.root / "study" / "DICOM"
        source.mkdir(parents=True)

        pairs, open_path = _local_import_plan(source)

        self.assertEqual(pairs, [(source, source.parent / "JPG")])
        self.assertEqual(open_path, source.parent / "JPG")

    def test_study_folder_writes_jpg_next_to_its_dicom(self) -> None:
        source = self.root / "2026-07-07 - CT - CT so nao"
        (source / "DICOM").mkdir(parents=True)

        pairs, open_path = _local_import_plan(source)

        self.assertEqual(pairs, [(source / "DICOM", source / "JPG")])
        self.assertEqual(open_path, source / "JPG")

    def test_patient_folder_converts_every_study_and_opens_the_whole_folder(self) -> None:
        source = self.root / "patient"
        (source / "2026-07-07 - CT" / "DICOM").mkdir(parents=True)
        (source / "2026-08-11 - MR" / "DICOM").mkdir(parents=True)

        pairs, open_path = _local_import_plan(source)

        self.assertEqual(
            pairs,
            [
                (source / "2026-07-07 - CT" / "DICOM", source / "2026-07-07 - CT" / "JPG"),
                (source / "2026-08-11 - MR" / "DICOM", source / "2026-08-11 - MR" / "JPG"),
            ],
        )
        # The studies keep separate JPG siblings, so the viewer has to open the
        # patient folder rather than any one study's output.
        self.assertEqual(open_path, source)

    def test_loose_dicom_folder_writes_jpg_inside_it(self) -> None:
        source = self.root / "loose"
        source.mkdir()

        pairs, open_path = _local_import_plan(source)

        self.assertEqual(pairs, [(source, source / "JPG")])
        self.assertEqual(open_path, source / "JPG")

    def test_redirect_keeps_each_study_folder_under_the_output_root(self) -> None:
        # A read-only source (a burned disc) cannot take a JPG sibling, so the
        # plan is re-aimed at the configured output root instead of failing.
        source = self.root / "patient"
        pairs = [
            (source / "2026-07-07 - CT" / "DICOM", source / "2026-07-07 - CT" / "JPG"),
            (source / "2026-08-11 - MR" / "DICOM", source / "2026-08-11 - MR" / "JPG"),
        ]
        base = self.root / "output" / "LOCAL_DICOM_20260811_120000_patient"

        redirected, open_path = _redirect_plan(pairs, base)

        self.assertEqual(
            redirected,
            [
                (pairs[0][0], base / "2026-07-07 - CT" / "JPG"),
                (pairs[1][0], base / "2026-08-11 - MR" / "JPG"),
            ],
        )
        self.assertEqual(open_path, base)

    def test_writable_probe_leaves_nothing_behind(self) -> None:
        before = set(self.root.iterdir())

        self.assertTrue(_is_writable_dir(self.root))
        self.assertEqual(set(self.root.iterdir()), before)

    def test_writable_probe_reports_false_for_a_missing_folder(self) -> None:
        missing = self.root / "khong-ton-tai" / "sau"

        self.assertFalse(_is_writable_dir(missing))
        # The probe must not conjure the folder it was asked to test.
        self.assertFalse(missing.parent.exists())


class StudyFromFolderPathTests(unittest.TestCase):
    """Reading the study off the folder path.

    This is what keeps a study in one group: the converted JPGs carry no
    StudyDate of their own, and key images often lack StudyDescription, so
    without the path both halves would head their own group in the strip.
    """

    def test_reads_date_modality_and_description_from_the_study_folder(self) -> None:
        folder = Path("/archive/2026-06-16 - CT - CT so nao 16 day/DICOM/Series_1")

        self.assertEqual(
            _study_from_folder_path(folder),
            ("2026-06-16", "CT", "CT so nao 16 day"),
        )

    def test_reads_the_same_study_from_the_jpg_half(self) -> None:
        # The archive root for converted output is the JPG folder itself, so
        # the walk has to continue past it to reach the study folder.
        dicom_side = Path("/archive/2026-06-16 - CT - CT so nao/DICOM/Series_1")
        jpg_side = Path("/archive/2026-06-16 - CT - CT so nao/JPG/Series_1")

        self.assertEqual(_study_from_folder_path(dicom_side), _study_from_folder_path(jpg_side))

    def test_keeps_a_description_that_contains_its_own_hyphen(self) -> None:
        folder = Path("/archive/2026-06-16 - MR - So nao - co tiem thuoc/JPG")

        self.assertEqual(
            _study_from_folder_path(folder),
            ("2026-06-16", "MR", "So nao - co tiem thuoc"),
        )

    def test_falls_back_to_a_bare_leading_date(self) -> None:
        folder = Path("/archive/2026-06-16 phim cu/Series_1")

        self.assertEqual(_study_from_folder_path(folder), ("2026-06-16", "", ""))

    def test_returns_nothing_when_no_folder_names_a_study(self) -> None:
        self.assertEqual(_study_from_folder_path(Path("/archive/phim/Series_1")), ("", "", ""))


class CustomCredentialsTests(unittest.TestCase):
    """Test custom credentials passing in WebController."""

    def test_start_search_extracts_custom_credentials(self) -> None:
        from unittest.mock import MagicMock, patch
        controller = WebController()
        controller.output_root = Path(tempfile.mkdtemp())
        with patch("dcom_pipeline.search_patient_studies") as mock_search:
            mock_search.return_value = {"patient": None, "studies": []}
            controller.start_search({
                "patientId": "12345",
                "hospital": "dhy",
                "customUsername": "testuser",
                "customPassword": "testpass",
            })
            # Give background job time to invoke target
            time.sleep(0.2)
            mock_search.assert_called_once()
            _, kwargs = mock_search.call_args
            self.assertEqual(kwargs.get("custom_username"), "testuser")
            self.assertEqual(kwargs.get("custom_password"), "testpass")


class OpenFileAndFileInfoTests(unittest.TestCase):
    """Tests for single file opening and file-info inspection."""

    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.controller = WebController()
        self.controller.output_root = self.temp_dir
        self.server = LocalApiServer(self.controller, Path(tempfile.mkdtemp()))
        self.server.start()

    def tearDown(self) -> None:
        self.server.stop()

    def test_open_single_image_file_loads_series(self) -> None:
        from PIL import Image
        img_path = self.temp_dir / "slice_001.jpg"
        img = Image.new("RGB", (100, 100), color=(128, 128, 128))
        img.save(img_path)

        catalog = ArchiveCatalog()
        archive = catalog.open(img_path)

        series_records = list(catalog._series.values())
        self.assertEqual(len(series_records), 1)
        series = series_records[0]
        self.assertEqual(series.images[0].resolve(), img_path.resolve())
        self.assertEqual(archive["series"][0]["sliceCount"], 1)

    def test_open_single_file_enriches_from_ancestor_patient_index(self) -> None:
        from PIL import Image
        import json
        study_folder = self.temp_dir / "2026-08-15 - CT - So Nao" / "JPG" / "Series_1"
        study_folder.mkdir(parents=True)
        img_path = study_folder / "img_01.jpg"
        Image.new("RGB", (80, 80)).save(img_path)

        # Write patient-index.json at self.temp_dir
        manifest = {
            "format": "dcom-patient-index-v1",
            "patientName": "LE VAN C",
            "patientId": "BN99999",
            "studies": {
                "study-99": {
                    "downloadUrl": "https://ris.example.com/view/99",
                    "viewerUrl": "https://ris.example.com/view/99",
                    "patientCode": "BN99999",
                    "accessionNumber": "ACC-5544",
                    "hospitalName": "BV Bach Mai",
                }
            },
        }
        (self.temp_dir / "patient-index.json").write_text(json.dumps(manifest), encoding="utf-8")

        catalog = ArchiveCatalog()
        controller = WebController()
        controller.catalog = catalog
        archive = catalog.open(img_path)
        series_records = list(catalog._series.values())
        self.assertEqual(len(series_records), 1)

        # The manifest is what the viewer overlay and /file-info read, and the
        # file sits three levels below the patient-index.json that names it.
        enriched = series_records[0].manifest
        self.assertEqual(enriched["patientName"], "LE VAN C")
        self.assertEqual(enriched["downloadUrl"], "https://ris.example.com/view/99")
        self.assertEqual(enriched["accessionNumber"], "ACC-5544")
        self.assertEqual(enriched["hospitalName"], "BV Bach Mai")

        provenance = controller.get_file_info(archive["series"][0]["id"])["provenance"]
        self.assertEqual(provenance["downloadUrl"], "https://ris.example.com/view/99")
        self.assertEqual(provenance["patientCode"], "BN99999")
        self.assertEqual(provenance["accessionNumber"], "ACC-5544")
        self.assertEqual(provenance["hospitalName"], "BV Bach Mai")

    def test_web_controller_get_file_info(self) -> None:
        from PIL import Image
        img_path = self.temp_dir / "slice_test.png"
        Image.new("RGB", (50, 50)).save(img_path)

        controller = WebController()
        archive = controller.catalog.open(img_path)
        series_id = archive["series"][0]["id"]

        info = controller.get_file_info(series_id, 0)
        self.assertIn("file", info)
        self.assertIn("demographics", info)
        self.assertIn("study", info)
        self.assertIn("series", info)
        self.assertIn("provenance", info)
        self.assertIn("dicomTags", info)
        self.assertEqual(info["file"]["fileName"], "slice_test.png")
        self.assertGreater(info["file"]["fileSize"], 0)

    def test_viewer_session_registry_lifecycle(self) -> None:
        controller = WebController()
        reg = controller.sessions
        self.assertIsNotNone(reg.get_catalog(None))
        self.assertEqual(len(reg.list_sessions()), 0)

        # Create session
        session = reg.create_session("", session_id="test_sess_1")
        self.assertEqual(session.session_id, "test_sess_1")
        self.assertEqual(len(reg.list_sessions()), 1)
        self.assertIs(reg.get_catalog("test_sess_1"), session.catalog)

        # Close session
        reg.close_session("test_sess_1")
        self.assertEqual(len(reg.list_sessions()), 0)
        # Fallback to default catalog
        self.assertIs(reg.get_catalog("test_sess_1"), controller.catalog)

    def test_record_patient_study_includes_media_type_and_duration(self) -> None:
        from dcom_pipeline import record_patient_study, ensure_patient_archive, _read_patient_manifest
        patient_folder, manifest, _ = ensure_patient_archive(
            self.temp_dir,
            patient_id="BN_MEDIA_TEST",
            patient_name="TEST MEDIA",
            hospital_key="dhy",
            hospital_name="BV Dai hoc Y",
        )
        study_folder = patient_folder / "STUDY_1"
        study_folder.mkdir(parents=True, exist_ok=True)
        study_data = {
            "study_uid": "1.2.3.4.5.6.789",
            "date": "2026-08-16",
            "modality": "MR",
            "desc": "Brain MRI",
            "media_type": "photo",
            "duration_seconds": 120,
        }
        record_patient_study(
            patient_folder,
            study_data,
            study_folder,
            complete=True,
            image_count=5,
        )
        updated = _read_patient_manifest(patient_folder)
        self.assertIsNotNone(updated)
        study_entry = updated["studies"]["1.2.3.4.5.6.789"]
        self.assertEqual(study_entry["mediaType"], "photo")
        self.assertEqual(study_entry["durationSeconds"], 120)
        self.assertEqual(study_entry["status"], "complete")

    def test_media_routes_block_path_traversal(self) -> None:
        import urllib.request
        from PIL import Image
        
        # Test rotating a file outside allowed roots
        payload = json.dumps({"path": "C:\\Windows\\system.ini", "degrees": 90}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.server.url.split('?')[0]}api/media/photo/rotate",
            data=payload,
            headers={"Content-Type": "application/json", "X-DCom-Token": self.server.token},
            method="POST"
        )
        try:
            urllib.request.urlopen(req)
            self.fail("Should have raised HTTP error for path outside allowed roots")
        except urllib.error.HTTPError as exc:
            self.assertIn(exc.code, (403, 404))

    def test_media_routes_preserve_original_file(self) -> None:
        import urllib.request
        from PIL import Image
        
        img_path = self.temp_dir / "sample_photo.jpg"
        img = Image.new("RGB", (120, 80), color=(100, 150, 200))
        img.save(img_path)
        original_bytes = img_path.read_bytes()
        
        # Call rotate on valid image in catalog root
        payload = json.dumps({"path": str(img_path), "degrees": 90}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.server.url.split('?')[0]}api/media/photo/rotate",
            data=payload,
            headers={"Content-Type": "application/json", "X-DCom-Token": self.server.token},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            out_path = Path(data["outputPath"])
            self.assertTrue(out_path.exists())
            self.assertNotEqual(str(out_path), str(img_path), "Output path must NEVER equal original file")
            self.assertEqual(img_path.read_bytes(), original_bytes, "Original file must be 100% untouched")
            
            # Verify work-file server
            work_url = f"{self.server.url.split('?')[0]}api/media/work-file?name={out_path.name}"
            req_get = urllib.request.Request(work_url, headers={"X-DCom-Token": self.server.token})
            with urllib.request.urlopen(req_get) as get_resp:
                self.assertEqual(get_resp.status, 200)
                self.assertEqual(get_resp.headers.get("Content-Type"), "image/jpeg")
                self.assertEqual(len(get_resp.read()), out_path.stat().st_size)

    def test_worklist_scanner_discovers_multi_level_hierarchy(self) -> None:
        from web_backend import WorklistScanner
        
        # Create simulated patient folder with 2 studies
        p_dir = self.temp_dir / "TEST-0001_NGUYEN VAN MAU - Nam - 1974 - BV A"
        p_dir.mkdir(parents=True, exist_ok=True)
        
        s1 = p_dir / "2026-08-06 - MR - SO NAO CO TIEM"
        s1.mkdir(parents=True, exist_ok=True)
        # Add 3 dummy dicom files and 1 jpg
        (s1 / "slice1.dcm").write_bytes(b"DICM" + b"\0" * 100)
        (s1 / "slice2.dcm").write_bytes(b"DICM" + b"\0" * 100)
        (s1 / "photo.jpg").write_bytes(b"\xFF\xD8\xFF\xE0" + b"\0" * 50)
        
        s2 = p_dir / "2026-07-02 - MR - COT SONG"
        s2.mkdir(parents=True, exist_ok=True)
        (s2 / "slice1.dcm").write_bytes(b"DICM" + b"\0" * 100)
        
        self.controller.output_root = self.temp_dir
        scanner = WorklistScanner(self.controller)
        patients = scanner.scan()
        
        self.assertTrue(len(patients) >= 1)
        p = next((item for item in patients if item["patientId"] == "TEST-0001"), None)
        self.assertIsNotNone(p)
        self.assertEqual(p["patientName"], "NGUYEN VAN MAU")
        self.assertEqual(p["gender"], "Nam")
        self.assertEqual(p["birthYear"], "1974")
        self.assertEqual(p["hospital"], "BV A")
        self.assertEqual(p["mediaSummary"]["dicom"], 3)
        self.assertEqual(p["mediaSummary"]["photo"], 1)
        self.assertEqual(len(p["studies"]), 2)

    def test_api_worklist_endpoints(self) -> None:
        # Test GET /api/worklist
        req = urllib.request.Request(
            f"{self.server.url.split('?')[0]}api/worklist",
            headers={"X-DCom-Token": self.server.token}
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("patients", data)
            self.assertIsInstance(data["patients"], list)

    def test_worklist_never_invents_patient_demographics(self) -> None:
        """A folder name without sex/birth year must not produce one.

        Those two fields are what a clinician reads to confirm the right chart,
        so an unknown value has to stay blank rather than default to something
        plausible.
        """
        from web_backend import WorklistScanner

        scanner = WorklistScanner(self.controller)
        for folder in ("BN-9999", "TEST-0007_TRAN THI B", "20260816_CT_BUNG"):
            meta = scanner._parse_patient_meta(folder)
            self.assertEqual(meta["gender"], "", f"{folder} invented a sex")
            self.assertEqual(meta["birthYear"], "", f"{folder} invented a birth year")
            self.assertEqual(meta["hospital"], "", f"{folder} invented a hospital")

    def test_worklist_prefers_patient_index_over_folder_name(self) -> None:
        """patient-index.json records the real DICOM tags, so it wins."""
        from web_backend import WorklistScanner

        patient_dir = self.temp_dir / "BN-9999"
        patient_dir.mkdir(parents=True, exist_ok=True)
        (patient_dir / "patient-index.json").write_text(json.dumps({
            "format": "dcom-patient-index-v1",
            "patientId": "TEST-0042",
            "patientName": "TRẦN THỊ MẪU",
            "patientBirthDate": "19880312",
            "patientSex": "F",
            "hospitalName": "BV Bạch Mai",
            "studies": {},
        }), encoding="utf-8")

        meta = WorklistScanner(self.controller)._patient_meta_for(patient_dir)
        self.assertEqual(meta["patientId"], "TEST-0042")
        self.assertEqual(meta["patientName"], "TRẦN THỊ MẪU")
        self.assertEqual(meta["gender"], "Nữ")
        self.assertEqual(meta["birthYear"], "1988")
        self.assertEqual(meta["hospital"], "BV Bạch Mai")

    def test_a_patient_code_is_not_read_as_a_study_date(self) -> None:
        """Found by running the app: `2607063527_...` displayed as 35/06/2607.

        A bare 8-digit match is not a date. The folder below starts with
        `26070635`, which is not a day anyone was scanned on, so the field has
        to stay empty rather than show an impossible one.
        """
        from web_backend import WorklistScanner, _is_real_date, _study_from_folder_path

        self.assertFalse(_is_real_date("26070635"))
        self.assertFalse(_is_real_date("20261301"))
        self.assertFalse(_is_real_date("20260230"))
        self.assertTrue(_is_real_date("20260806"))

        patient = self.temp_dir / "2607063527_NGUYEN HUU SU"
        (patient / "VIDEO").mkdir(parents=True)
        self._write_video(patient / "VIDEO" / "a.mp4")
        self.assertEqual(_study_from_folder_path(patient / "VIDEO")[0], "")
        self.assertEqual(WorklistScanner._format_study_date("26070635"), "")

    def test_app_metadata_is_not_offered_as_a_readable_document(self) -> None:
        """patient-index.json is bookkeeping, not a report for a clinician."""
        from web_backend import media_type_for_file

        self.assertEqual(media_type_for_file(Path("BN/patient-index.json")), "")
        self.assertEqual(media_type_for_file(Path("BN/viewer-annotations.json")), "")
        self.assertEqual(media_type_for_file(Path("BN/ket_qua.json")), "text")

        patient = self.temp_dir / "BN-0011"
        patient.mkdir(parents=True)
        (patient / "patient-index.json").write_text(json.dumps({
            "format": "dcom-patient-index-v1", "patientId": "BN-0011", "studies": {},
        }), encoding="utf-8")
        report = patient / "BAO-CAO"
        report.mkdir()
        (report / "tuong_trinh.txt").write_text("Tường trình", encoding="utf-8")

        names = {item["name"] for item in ArchiveCatalog().open(patient)["series"]}
        self.assertEqual(names, {"BAO-CAO"})

    def test_thumbnail_falls_back_to_a_tile_for_video_and_text(self) -> None:
        """Found by running the app: the strip logged a 500 per media card."""
        from web_backend import build_series_thumbnail

        patient = self.temp_dir / "BN-0012"
        (patient / "VIDEO").mkdir(parents=True)
        self._write_video(patient / "VIDEO" / "a.mp4")
        (patient / "BAO-CAO").mkdir(parents=True)
        (patient / "BAO-CAO" / "a.txt").write_text("x", encoding="utf-8")

        catalog = ArchiveCatalog()
        catalog.open(patient)
        for record in catalog._series.values():
            data = build_series_thumbnail(record)
            self.assertTrue(data.startswith(b"\xff\xd8"), f"{record.name} not a JPEG")

    def test_two_sessions_keep_separate_catalogs(self) -> None:
        """One catalog per tab, so a second patient cannot displace the first.

        Every request used to fall through to the shared default catalog, so
        opening a second record made the first tab report "Không tìm thấy
        series" for slices it had just been showing.
        """
        first = self.temp_dir / "BN-S1"
        (first / "VIDEO").mkdir(parents=True)
        self._write_video(first / "VIDEO" / "a.mp4")
        second = self.temp_dir / "BN-S2"
        (second / "BAO-CAO").mkdir(parents=True)
        (second / "BAO-CAO" / "b.txt").write_text("x", encoding="utf-8")

        sessions = self.controller.sessions
        one = sessions.create_session(str(first))
        two = sessions.create_session(str(second))
        self.assertNotEqual(one.session_id, two.session_id)

        id_one = one.catalog.snapshot()["series"][0]["id"]
        id_two = two.catalog.snapshot()["series"][0]["id"]

        # Each session still resolves its own series after the other opened.
        self.assertEqual(sessions.get_catalog(one.session_id).get(id_one).series_id, id_one)
        self.assertEqual(sessions.get_catalog(two.session_id).get(id_two).series_id, id_two)
        with self.assertRaises(KeyError):
            sessions.get_catalog(one.session_id).get(id_two)

    def test_creating_a_session_records_the_folder_in_history(self) -> None:
        """Opening through a session is still opening; the worklist needs it."""
        folder = self.temp_dir / "BN-S3"
        (folder / "VIDEO").mkdir(parents=True)
        self._write_video(folder / "VIDEO" / "a.mp4")

        self.controller.sessions.create_session(
            str(folder), on_opened=self.controller.history.add,
        )
        recorded = {item.get("folder", "").casefold() for item in self.controller.history_snapshot()}
        self.assertIn(str(folder.resolve()).casefold(), recorded)

    def test_studies_sort_newest_first_by_real_date(self) -> None:
        """studyDate is dd/mm/yyyy for display, so sorting it as text is wrong.

        Ordering the display string put 20/06/2026 ahead of 06/08/2026, which
        also meant "Mở hồ sơ" opened the wrong visit.
        """
        from web_backend import WorklistScanner

        patient = self._patient_with_manifest({
            "1.1": {"studyUid": "1.1", "date": "20260620", "modality": "MR",
                    "description": "MR cu", "folder": "CU", "status": "complete"},
            "1.2": {"studyUid": "1.2", "date": "20260806", "modality": "MR",
                    "description": "MR moi", "folder": "MOI", "status": "complete"},
        })
        for name in ("CU", "MOI"):
            (patient / name).mkdir(parents=True, exist_ok=True)
            (patient / name / "s.dcm").write_bytes(b"DICM" + b"\0" * 100)

        studies = next(
            p for p in WorklistScanner(self.controller).scan() if p["patientId"] == "TEST-7777"
        )["studies"]
        self.assertEqual([s["studyDate"] for s in studies], ["06/08/2026", "20/06/2026"])

    def test_worklist_ignores_history_outside_the_selected_archive(self) -> None:
        """Otherwise a one-patient archive reports every folder ever opened."""
        from web_backend import WorklistScanner

        inside = self.temp_dir / "BN-TRONG-KHO"
        (inside / "VIDEO").mkdir(parents=True)
        self._write_video(inside / "VIDEO" / "a.mp4")

        outside = Path(tempfile.mkdtemp()) / "BN-NGOAI-KHO"
        (outside / "VIDEO").mkdir(parents=True)
        self.addCleanup(shutil.rmtree, outside.parent, True)
        self._write_video(outside / "VIDEO" / "a.mp4")

        self.controller.history.add(str(inside))
        self.controller.history.add(str(outside))
        self.controller.output_root = self.temp_dir

        ids = {p["patientId"] for p in WorklistScanner(self.controller).scan()}
        self.assertIn("BN-TRONG-KHO", ids)
        self.assertNotIn("BN-NGOAI-KHO", ids)

    def test_saving_an_edit_writes_beside_the_original_without_touching_it(self) -> None:
        """Edits used to live only in %TEMP% and vanish on the next tab switch."""
        from PIL import Image
        import web_backend

        patient = self.temp_dir / "BN-EDIT"
        photos = patient / "ANH-MO"
        photos.mkdir(parents=True)
        original = photos / "p1.jpg"
        Image.new("RGB", (48, 48), (10, 20, 30)).save(original)
        before = original.read_bytes()

        catalog = ArchiveCatalog()
        series_id = catalog.open(patient)["series"][0]["id"]

        work = web_backend.MEDIA_WORK_ROOT / "edited_probe.jpg"
        Image.new("RGB", (24, 24), (200, 10, 10)).save(work)
        self.addCleanup(work.unlink, True)

        saved = self.controller.save_media_edit(str(work), series_id, catalog=catalog)

        destination = Path(saved["savedPath"])
        self.assertTrue(destination.is_file())
        # Windows hands back 8.3 short paths here, so compare resolved ones.
        self.assertEqual(destination.parent.resolve(), photos.resolve())
        self.assertNotEqual(destination.resolve(), original.resolve())
        self.assertEqual(original.read_bytes(), before, "the original was modified")

    def test_saving_refuses_a_path_outside_the_work_folder(self) -> None:
        """The save endpoint copies a file; it must not copy an arbitrary one."""
        from PIL import Image

        patient = self.temp_dir / "BN-EDIT2"
        photos = patient / "ANH"
        photos.mkdir(parents=True)
        Image.new("RGB", (32, 32), (0, 0, 0)).save(photos / "p1.jpg")
        stray = self.temp_dir / "khong-phai-work.jpg"
        Image.new("RGB", (8, 8), (1, 2, 3)).save(stray)

        catalog = ArchiveCatalog()
        series_id = catalog.open(patient)["series"][0]["id"]
        with self.assertRaises(PermissionError):
            self.controller.save_media_edit(str(stray), series_id, catalog=catalog)

    def test_archive_snapshot_carries_patient_identity_from_the_manifest(self) -> None:
        """The viewer rail reads this block; before, it was never sent."""
        patient = self.temp_dir / "BN-0007"
        (patient / "VIDEO").mkdir(parents=True)
        self._write_video(patient / "VIDEO" / "a.mp4")
        (patient / "patient-index.json").write_text(json.dumps({
            "format": "dcom-patient-index-v1",
            "patientId": "2607063527",
            "patientName": "NGUYỄN HỮU SỰ",
            "patientBirthDate": "19620918",
            "patientSex": "M",
            "hospitalName": "BV Hà Tĩnh",
            "studies": {},
        }), encoding="utf-8")

        block = ArchiveCatalog().open(patient)["patient"]

        self.assertEqual(block["patientId"], "2607063527")
        self.assertEqual(block["patientName"], "NGUYỄN HỮU SỰ")
        self.assertEqual(block["birthYear"], "1962")
        self.assertEqual(block["gender"], "Nam")
        self.assertEqual(block["hospital"], "BV Hà Tĩnh")
        # Age is derived, so it must be consistent with the birth date rather
        # than a number carried over from anywhere else.
        self.assertEqual(int(block["age"]), _years_since(1962, 9, 18))

    def test_archive_snapshot_invents_no_identity_without_a_manifest(self) -> None:
        """A folder name is not a patient record."""
        patient = self.temp_dir / "BN-9999_NGUYEN VAN A - Nam - 1974"
        (patient / "VIDEO").mkdir(parents=True)
        self._write_video(patient / "VIDEO" / "a.mp4")

        self.assertEqual(ArchiveCatalog().open(patient)["patient"], {})

    def test_diagnosis_is_stored_as_an_extra_manifest_key(self) -> None:
        """Only a key is added; the schema and format version stay put.

        A local archive has no RIS, so the diagnosis is the clinician's own
        note rather than anything read off a tag.
        """
        patient = self.temp_dir / "BN-0008"
        (patient / "VIDEO").mkdir(parents=True)
        self._write_video(patient / "VIDEO" / "a.mp4")
        (patient / "patient-index.json").write_text(json.dumps({
            "format": "dcom-patient-index-v1",
            "patientId": "BN-0008",
            "patientName": "LÊ VĂN MẪU",
            "hospitalName": "BV B",
            "studies": {"1.2.3": {"studyUid": "1.2.3", "folder": "VIDEO", "status": "complete"}},
        }), encoding="utf-8")

        catalog = ArchiveCatalog()
        catalog.open(patient)
        result = self.controller.set_patient_diagnosis("Theo dõi u thực quản", catalog=catalog)

        self.assertEqual(result["patient"]["diagnosis"], "Theo dõi u thực quản")
        self.assertEqual(catalog.snapshot()["patient"]["diagnosis"], "Theo dõi u thực quản")

        saved = json.loads((patient / "patient-index.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["diagnosis"], "Theo dõi u thực quản")
        self.assertEqual(saved["format"], "dcom-patient-index-v1")
        self.assertEqual(saved["patientName"], "LÊ VĂN MẪU")
        self.assertEqual(saved["studies"]["1.2.3"]["status"], "complete")

    def test_converted_mri_jpgs_stay_on_the_reading_canvas(self) -> None:
        """The app's own DICOM→JPG output must not open in the photo editor.

        A JPG slice of an MR or CT study is a diagnostic image in a picture
        container. Routing it by extension handed a radiologist crop, redact
        and arrow tools where window/level and measurement belong.
        """
        from PIL import Image

        for folder, modality in (("MR - SO NAO", "MR"), ("CT - O BUNG", "CT")):
            root = self.temp_dir / f"BN-{modality}"
            slices = root / f"2026-08-06 - {folder}" / "JPG" / "T1_SAG"
            slices.mkdir(parents=True)
            for index in range(3):
                Image.new("L", (64, 64), 100 + index * 20).save(slices / f"IM_{index:04d}.jpg")

            series = ArchiveCatalog().open(root)["series"][0]
            self.assertEqual(series["modality"], modality)
            self.assertEqual(series["mediaType"], "dicom", f"{modality} JPG left the canvas")

    def test_photos_without_a_modality_are_still_photos(self) -> None:
        """The fix above must not drag clinical photographs onto the canvas."""
        from PIL import Image

        root = self.temp_dir / "BN-ANH"
        for folder, expected in (("ANH-TRONG-MO", "photo"), ("BENH_AN-SCAN", "doc")):
            target = root / folder
            target.mkdir(parents=True)
            Image.new("RGB", (64, 64), (10, 20, 30)).save(target / "p1.jpg")

        kinds = {item["name"]: item["mediaType"] for item in ArchiveCatalog().open(root)["series"]}
        self.assertEqual(kinds["ANH-TRONG-MO"], "photo")
        self.assertEqual(kinds["BENH_AN-SCAN"], "doc")

    def test_diagnosis_refuses_to_write_into_a_different_patient(self) -> None:
        """Without a session per tab, the open catalog is not proof of identity.

        A note typed while looking at one patient must never reach another's
        record just because that folder was opened more recently.
        """
        other = self.temp_dir / "BN-KHAC"
        (other / "VIDEO").mkdir(parents=True)
        self._write_video(other / "VIDEO" / "a.mp4")
        (other / "patient-index.json").write_text(json.dumps({
            "format": "dcom-patient-index-v1",
            "patientId": "BN-KHAC",
            "patientName": "TRẦN THỊ B",
            "studies": {},
        }), encoding="utf-8")

        catalog = ArchiveCatalog()
        catalog.open(other)

        with self.assertRaises(ValueError) as caught:
            self.controller.set_patient_diagnosis(
                "Ghi nhầm chỗ",
                archive_root=str(other),
                expected_patient_id="BN-DANG-XEM",
                catalog=catalog,
            )
        self.assertIn("Từ chối ghi", str(caught.exception))

        saved = json.loads((other / "patient-index.json").read_text(encoding="utf-8"))
        self.assertNotIn("diagnosis", saved)

    def test_diagnosis_refuses_a_folder_with_no_manifest(self) -> None:
        """Nowhere to record it means saying so, not writing a new file."""
        patient = self.temp_dir / "BN-0010"
        (patient / "VIDEO").mkdir(parents=True)
        self._write_video(patient / "VIDEO" / "a.mp4")

        catalog = ArchiveCatalog()
        catalog.open(patient)
        with self.assertRaises(ValueError):
            self.controller.set_patient_diagnosis("Ghi thử", catalog=catalog)
        self.assertFalse((patient / "patient-index.json").exists())

    def test_patient_block_leaves_age_blank_when_the_birth_date_is_unusable(self) -> None:
        from web_backend import ArchiveCatalog as Catalog

        for birth in ("", "1962", "19620000", "khong-ro"):
            block = Catalog._patient_block({"patientId": "X", "patientBirthDate": birth})
            self.assertEqual(block["age"], "", f"birthDate={birth!r} invented an age")

    @staticmethod
    def _write_video(path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\0" * 256)

    def test_media_type_is_read_from_the_file_not_the_description(self) -> None:
        """The classifier looks at the extension, never at wording.

        The frontend used to decide this by searching the study description for
        "mổ" and "phẫu thuật", which sent every post-operative follow-up scan
        into the video editor.
        """
        from web_backend import media_type_for_file

        self.assertEqual(media_type_for_file(Path("MR khop goi sau mo/IM_0001.dcm")), "dicom")
        self.assertEqual(media_type_for_file(Path("Case 12/anything.mp4")), "video")
        self.assertEqual(media_type_for_file(Path("bao cao/tuong_trinh.txt")), "text")
        self.assertEqual(media_type_for_file(Path("bao cao/index.json")), "text")
        self.assertEqual(media_type_for_file(Path("anh/gpb.jpg")), "photo")
        self.assertEqual(media_type_for_file(Path("khac/bang_ke.xlsx")), "")

    def test_a_folder_of_surgical_videos_produces_a_video_series(self) -> None:
        """Before this, a video folder scanned to zero series.

        The Video Studio was therefore only ever reachable by a DICOM series
        that had been misclassified, never by an actual recording.
        """
        folder = self.temp_dir / "BN-0001" / "VIDEO-MO"
        self._write_video(folder / "mo_noi_soi_01.mp4")
        self._write_video(folder / "mo_noi_soi_02.mp4")

        archive = ArchiveCatalog().open(self.temp_dir / "BN-0001")
        series = archive["series"]

        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["mediaType"], "video")
        self.assertEqual(series[0]["sliceCount"], 2)

    def test_a_dicom_folder_still_surfaces_the_video_and_report_beside_it(self) -> None:
        """A patient folder holds the scan and the operative record together."""
        patient = self.temp_dir / "BN-0002"
        dicom_dir = patient / "DICOM-MR"
        dicom_dir.mkdir(parents=True)
        series_uid = generate_uid()
        for index in range(2):
            write_local_dicom(
                dicom_dir / f"slice_{index}.dcm",
                series_uid=series_uid,
                instance_number=index + 1,
                position=float(index),
            )
        self._write_video(patient / "VIDEO-MO" / "mo.mp4")
        (patient / "TUONG-TRINH").mkdir(parents=True)
        (patient / "TUONG-TRINH" / "tt.txt").write_text("Tường trình", encoding="utf-8")

        archive = ArchiveCatalog().open(patient)
        kinds = sorted(item["mediaType"] for item in archive["series"])

        self.assertEqual(kinds, ["dicom", "text", "video"])

    def test_scanned_paperwork_is_marked_doc_but_photos_stay_photos(self) -> None:
        from PIL import Image

        patient = self.temp_dir / "BN-0003"
        for folder, name in (("BENH_AN-SCAN", "p1.jpg"), ("ANH-GPB", "g1.jpg")):
            (patient / folder).mkdir(parents=True)
            Image.new("RGB", (32, 32), (128, 128, 128)).save(patient / folder / name)

        archive = ArchiveCatalog().open(patient)
        by_name = {item["name"]: item["mediaType"] for item in archive["series"]}

        self.assertEqual(by_name["BENH_AN-SCAN"], "doc")
        self.assertEqual(by_name["ANH-GPB"], "photo")

    def test_open_single_video_or_text_file(self) -> None:
        folder = self.temp_dir / "BN-0004"
        self._write_video(folder / "mo.mp4")
        (folder / "tt.txt").write_text("Tường trình", encoding="utf-8")

        catalog = ArchiveCatalog()
        self.assertEqual(catalog.open(folder / "mo.mp4")["series"][0]["mediaType"], "video")
        self.assertEqual(catalog.open(folder / "tt.txt")["series"][0]["mediaType"], "text")

    def test_text_endpoint_reformats_json_but_leaves_broken_json_alone(self) -> None:
        """An unparseable .json is shown verbatim — that is why it was opened."""
        folder = self.temp_dir / "BN-0005" / "BAO-CAO"
        folder.mkdir(parents=True)
        (folder / "a.json").write_text('{"patientId":"BN-5","n":[1,2]}', encoding="utf-8")
        (folder / "b.txt").write_text("Tường trình phẫu thuật", encoding="utf-8")
        (folder / "c.json").write_text("{khong phai json", encoding="utf-8")

        catalog = ArchiveCatalog()
        series_id = catalog.open(self.temp_dir / "BN-0005")["series"][0]["id"]

        good = self.controller.get_text_content(series_id, 0, catalog=catalog)
        self.assertEqual(good["language"], "json")
        self.assertIn('\n  "patientId": "BN-5"', good["text"])

        plain = self.controller.get_text_content(series_id, 1, catalog=catalog)
        self.assertEqual(plain["language"], "text")
        self.assertIn("Tường trình phẫu thuật", plain["text"])

        broken = self.controller.get_text_content(series_id, 2, catalog=catalog)
        self.assertEqual(broken["language"], "text")
        self.assertEqual(broken["text"], "{khong phai json")

    def test_text_endpoint_refuses_a_file_too_large_to_display(self) -> None:
        import web_backend

        folder = self.temp_dir / "BN-0006" / "DUMP"
        folder.mkdir(parents=True)
        (folder / "big.txt").write_text("x" * (web_backend.TEXT_MAX_BYTES + 1), encoding="utf-8")

        catalog = ArchiveCatalog()
        series_id = catalog.open(self.temp_dir / "BN-0006")["series"][0]["id"]

        with self.assertRaises(ValueError) as caught:
            self.controller.get_text_content(series_id, 0, catalog=catalog)
        self.assertIn("giới hạn", str(caught.exception))

    def _patient_with_manifest(self, studies: dict) -> Path:
        """A patient folder whose manifest describes the given study folders."""
        patient_dir = self.temp_dir / "BN-7777"
        patient_dir.mkdir(parents=True, exist_ok=True)
        (patient_dir / "patient-index.json").write_text(json.dumps({
            "format": "dcom-patient-index-v1",
            "patientId": "TEST-7777",
            "patientName": "LÊ VĂN MẪU",
            "patientBirthDate": "19550101",
            "patientSex": "M",
            "hospitalName": "BV B",
            "studies": studies,
        }), encoding="utf-8")
        self.controller.output_root = self.temp_dir
        return patient_dir

    def test_worklist_reads_study_date_and_modality_from_the_manifest(self) -> None:
        """The manifest holds the DICOM tags; the folder name is only a guess.

        The folder here is deliberately named so the old heuristics would read
        it as an MR taken on 02/07/2026, while the manifest records the CT of
        06/08/2026 the tags actually carry.
        """
        from web_backend import WorklistScanner

        patient_dir = self._patient_with_manifest({
            "1.2.3": {
                "studyUid": "1.2.3",
                "date": "20260806",
                "modality": "CT",
                "description": "CT ổ bụng có tiêm",
                "folder": "2026-07-02 - MR - COT SONG",
                "status": "complete",
            },
        })
        study_dir = patient_dir / "2026-07-02 - MR - COT SONG"
        study_dir.mkdir(parents=True, exist_ok=True)
        (study_dir / "slice1.dcm").write_bytes(b"DICM" + b"\0" * 100)

        patients = WorklistScanner(self.controller).scan()
        patient = next(p for p in patients if p["patientId"] == "TEST-7777")
        study = patient["studies"][0]

        self.assertEqual(study["studyDate"], "06/08/2026")
        self.assertEqual(study["modality"], "CT")
        self.assertEqual(study["studyName"], "CT ổ bụng có tiêm")
        self.assertEqual(study["status"], "done")

    def test_worklist_surfaces_an_unfinished_download_as_part(self) -> None:
        """`incomplete` in the manifest is what the "Tải tiếp" badge reads."""
        from web_backend import WorklistScanner

        patient_dir = self._patient_with_manifest({
            "1.2.4": {
                "studyUid": "1.2.4",
                "date": "20260519",
                "modality": "CT",
                "description": "CT ngực",
                "folder": "CT-NGUC",
                "status": "incomplete",
                "viewerUrl": "http://viewer/unfinished",
            },
        })
        study_dir = patient_dir / "CT-NGUC"
        study_dir.mkdir(parents=True, exist_ok=True)
        (study_dir / "slice1.dcm").write_bytes(b"DICM" + b"\0" * 100)

        patients = WorklistScanner(self.controller).scan()
        study = next(p for p in patients if p["patientId"] == "TEST-7777")["studies"][0]

        self.assertEqual(study["status"], "part")
        self.assertEqual(study["statusLabel"], "Chưa hoàn tất")
        self.assertEqual(study["viewerUrl"], "http://viewer/unfinished")

    def test_worklist_leaves_an_unknown_study_date_blank(self) -> None:
        """An undated study must not be stamped with today's date.

        A worklist row that shows today for every folder it cannot date makes
        two scans of one patient look like they were taken on the same day.
        """
        from web_backend import WorklistScanner

        patient_dir = self.temp_dir / "BN-8888"
        patient_dir.mkdir(parents=True, exist_ok=True)
        study_dir = patient_dir / "phim cu khong ro ngay"
        study_dir.mkdir(parents=True, exist_ok=True)
        (study_dir / "slice1.dcm").write_bytes(b"DICM" + b"\0" * 100)
        self.controller.output_root = self.temp_dir

        patients = WorklistScanner(self.controller).scan()
        study = next(p for p in patients if p["patientId"] == "BN-8888")["studies"][0]

        self.assertEqual(study["studyDate"], "")
        self.assertNotEqual(study["studyDate"], time.strftime("%d/%m/%Y"))

    def test_worklist_reports_zero_series_for_an_empty_folder(self) -> None:
        """An empty folder holds no series, so it must not claim one."""
        from web_backend import WorklistScanner

        patient_dir = self.temp_dir / "BN-6666"
        (patient_dir / "ca-rong").mkdir(parents=True, exist_ok=True)
        self.controller.output_root = self.temp_dir

        patients = WorklistScanner(self.controller).scan()
        study = next(p for p in patients if p["patientId"] == "BN-6666")["studies"][0]

        self.assertEqual(study["seriesCount"], 0)
        self.assertEqual(study["sliceCount"], 0)
        self.assertEqual(study["modality"], "")

    def test_reveal_folder_rejects_paths_outside_the_archive(self) -> None:
        self.controller.output_root = self.temp_dir
        outside = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, outside, True)
        with self.assertRaises(PermissionError):
            self.controller.reveal_folder(str(outside))

    def test_reveal_folder_refuses_files_so_it_cannot_launch_programs(self) -> None:
        """`os.startfile` runs whatever it is given, so files must be refused."""
        self.controller.output_root = self.temp_dir
        payload = self.temp_dir / "payload.exe"
        payload.write_bytes(b"MZ")
        with self.assertRaises(ValueError):
            self.controller.reveal_folder(str(payload))

    def test_reveal_folder_opens_a_folder_inside_the_archive(self) -> None:
        self.controller.output_root = self.temp_dir
        study = self.temp_dir / "TEST-0001" / "2026-08-06 - MR"
        study.mkdir(parents=True, exist_ok=True)
        with mock.patch("web_backend.os.startfile", create=True) as startfile:
            with mock.patch("web_backend.sys.platform", "win32"):
                result = self.controller.reveal_folder(str(study))
        startfile.assert_called_once()
        self.assertTrue(result["revealed"])


if __name__ == "__main__":
    unittest.main()

