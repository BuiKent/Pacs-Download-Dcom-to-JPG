import json
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid
from PIL import Image

from web_backend import ArchiveCatalog, LocalApiServer, WebController, validate_mpr_manifest, _dicom_pixel_payload


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


if __name__ == "__main__":
    unittest.main()
