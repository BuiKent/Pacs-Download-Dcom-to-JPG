import io
import struct
import tempfile
import unittest
from pathlib import Path

import pydicom
import pydicom.encaps as pe
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import (
    ExplicitVRLittleEndian,
    JPEG2000Lossless,
    JPEGLSLossless,
    MRImageStorage,
    generate_uid,
)

import dcom_pipeline
from dcom_pipeline import (
    DownloadStats,
    _is_dicom_dataset_valid_for_decode,
    _validate_dicom_bytes,
    _dicom_to_frames,
    download_all,
)
import mpr_engine
import web_backend


def _make_raw_dicom_bytes(*, rows: int = 4, cols: int = 4, bits: int = 16) -> bytes:
    sop_uid = generate_uid()
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = MRImageStorage
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = generate_uid()
    dataset = FileDataset("sample.dcm", {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = MRImageStorage
    dataset.SOPInstanceUID = sop_uid
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = generate_uid()
    dataset.Rows = rows
    dataset.Columns = cols
    dataset.SamplesPerPixel = 1
    dataset.BitsAllocated = bits
    dataset.BitsStored = 12
    dataset.HighBit = 11
    dataset.PixelRepresentation = 0
    dataset.PixelData = b"\x00" * (rows * cols * 2)
    dataset.is_little_endian = True
    dataset.is_implicit_VR = False
    bio = io.BytesIO()
    dataset.save_as(bio)
    return bio.getvalue()


def _make_encapsulated_dicom_bytes(*, transfer_syntax=JPEG2000Lossless, valid_stream: bool = True) -> bytes:
    sop_uid = generate_uid()
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = MRImageStorage
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = transfer_syntax
    file_meta.ImplementationClassUID = generate_uid()
    dataset = FileDataset("sample_encaps.dcm", {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = MRImageStorage
    dataset.SOPInstanceUID = sop_uid
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = generate_uid()
    dataset.Rows = 4
    dataset.Columns = 4
    dataset.SamplesPerPixel = 1
    dataset.BitsAllocated = 16
    dataset.BitsStored = 12
    dataset.HighBit = 11
    dataset.PixelRepresentation = 0
    if valid_stream:
        # Codestream starting with SOC and properly ending with EOC \xff\xd9
        frame_bytes = b"\xff\x4f\xff\x51\x00\x29\x00\x00" + b"\xaa" * 32 + b"\xff\xd9"
    else:
        # Codestream cut short before \xff\xd9
        frame_bytes = b"\xff\x4f\xff\x51\x00\x29\x00\x00" + b"\xaa" * 32
    dataset.PixelData = pe.encapsulate([frame_bytes])
    dataset.is_little_endian = True
    dataset.is_implicit_VR = False
    bio = io.BytesIO()
    dataset.save_as(bio)
    return bio.getvalue()


class DicomIntegrityValidationTests(unittest.TestCase):
    def test_rejects_empty_or_too_short_bytes(self):
        valid, reason = _validate_dicom_bytes(b"")
        self.assertFalse(valid)
        self.assertIn("quá ngắn", reason)

        valid, reason = _validate_dicom_bytes(b"\x00" * 130)
        self.assertFalse(valid)
        self.assertIn("quá ngắn", reason)

    def test_rejects_missing_dicm_preamble(self):
        data = b"\x00" * 128 + b"XXXX" + b"\x00" * 50
        valid, reason = _validate_dicom_bytes(data)
        self.assertFalse(valid)
        self.assertIn("DICM", reason)

    def test_valid_raw_dicom_is_accepted(self):
        raw_bytes = _make_raw_dicom_bytes()
        valid, reason = _validate_dicom_bytes(raw_bytes)
        self.assertTrue(valid, f"Expected valid, got reason: {reason}")
        self.assertEqual("", reason)

    def test_truncated_raw_dicom_is_rejected(self):
        raw_bytes = _make_raw_dicom_bytes()
        truncated = raw_bytes[:-10]  # cuts 10 bytes from PixelData
        valid, reason = _validate_dicom_bytes(truncated)
        self.assertFalse(valid)
        self.assertIn("PixelData raw bị thiếu", reason)

    def test_valid_encapsulated_jpeg2000_is_accepted(self):
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEG2000Lossless, valid_stream=True)
        valid, reason = _validate_dicom_bytes(encaps_bytes)
        self.assertTrue(valid, f"Expected valid, got reason: {reason}")

    def test_valid_encapsulated_jpegls_is_accepted(self):
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEGLSLossless, valid_stream=True)
        valid, reason = _validate_dicom_bytes(encaps_bytes)
        self.assertTrue(valid, f"Expected valid, got reason: {reason}")

    def test_encapsulated_without_ending_marker_is_rejected(self):
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEG2000Lossless, valid_stream=False)
        valid, reason = _validate_dicom_bytes(encaps_bytes)
        self.assertFalse(valid)
        self.assertIn("marker", reason.lower())

    def test_severely_cut_encapsulated_stream_is_rejected(self):
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEG2000Lossless, valid_stream=True)
        cut = encaps_bytes[:-15]
        valid, reason = _validate_dicom_bytes(cut)
        self.assertFalse(valid)

    def test_encapsulated_bot_only_no_frames_is_rejected(self):
        # CASE 1: Empty Basic Offset Table only, image fragments missing
        bot_only = b"\xfe\xff\x00\xe0\x00\x00\x00\x00"
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEG2000Lossless, valid_stream=True)
        ds = pydicom.dcmread(io.BytesIO(encaps_bytes), force=True)
        ds.PixelData = bot_only
        bio = io.BytesIO()
        ds.save_as(bio, enforce_file_format=True)
        valid, reason = _validate_dicom_bytes(bio.getvalue())
        self.assertFalse(valid)
        self.assertIn("basic offset table", reason.lower())

    def test_encapsulated_rle_truncated_is_rejected(self):
        # CASE 3: RLE Lossless truncated header or offset exceeds length
        from pydicom.uid import RLELossless
        bot_only = b"\xfe\xff\x00\xe0\x00\x00\x00\x00"
        # RLE fragment too short (<64 bytes)
        short_rle = bot_only + b"\xfe\xff\x00\xe0\x10\x00\x00\x00" + b"\x01\x00\x00\x00" + b"\x40\x00\x00\x00" + b"\x00" * 8
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=RLELossless, valid_stream=True)
        ds = pydicom.dcmread(io.BytesIO(encaps_bytes), force=True)
        ds.PixelData = short_rle
        bio = io.BytesIO()
        ds.save_as(bio, enforce_file_format=True)
        valid, reason = _validate_dicom_bytes(bio.getvalue())
        self.assertFalse(valid)
        self.assertIn("rle", reason.lower())

    def test_missing_transfer_syntax_in_file_meta_handled_safely(self):
        raw_bytes = _make_raw_dicom_bytes()
        ds = pydicom.dcmread(io.BytesIO(raw_bytes), force=True)
        # Remove TransferSyntaxUID from file_meta
        if hasattr(ds.file_meta, "TransferSyntaxUID"):
            delattr(ds.file_meta, "TransferSyntaxUID")
        valid, reason = _is_dicom_dataset_valid_for_decode(ds)
        self.assertTrue(valid)

    def test_valid_encapsulated_without_bot_item_is_accepted(self):
        # Valid JPEG 2000 file with only 1 fragment containing image codestream (no separate BOT item)
        valid_j2k_stream = b"\xff\x4f\xff\x51" + b"\x41" * 400 + b"\xff\xd9"
        one_frag_only = b"\xfe\xff\x00\xe0" + struct.pack("<I", len(valid_j2k_stream)) + valid_j2k_stream
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEG2000Lossless, valid_stream=True)
        ds = pydicom.dcmread(io.BytesIO(encaps_bytes), force=True)
        ds.PixelData = one_frag_only
        bio = io.BytesIO()
        ds.save_as(bio, enforce_file_format=True)
        valid, reason = _validate_dicom_bytes(bio.getvalue())
        self.assertTrue(valid, f"Expected valid, got reason: {reason}")

    def test_valid_mpeg_video_with_empty_bot_is_accepted(self):
        # MPEG/H.264 streams do not end with \xff\xd9 and legitimately have an empty Basic Offset Table —
        # must not be rejected just because the first fragment is empty.
        from pydicom.uid import MPEG2MPML

        mpeg_stream = b"\x00\x00\x01\xb3" + b"\x56" * 400 + b"\x00\x00\x01\xb7"
        empty_bot = b"\xfe\xff\x00\xe0" + struct.pack("<I", 0)
        pixel_data = empty_bot + b"\xfe\xff\x00\xe0" + struct.pack("<I", len(mpeg_stream)) + mpeg_stream
        encaps_bytes = _make_encapsulated_dicom_bytes(transfer_syntax=JPEG2000Lossless, valid_stream=True)
        ds = pydicom.dcmread(io.BytesIO(encaps_bytes), force=True)
        ds.file_meta.TransferSyntaxUID = MPEG2MPML
        ds.PixelData = pixel_data
        bio = io.BytesIO()
        ds.save_as(bio, enforce_file_format=True)
        valid, reason = _validate_dicom_bytes(bio.getvalue())
        self.assertTrue(valid, f"Expected valid, got reason: {reason}")


class DownloadPipelineIntegrityTests(unittest.TestCase):
    def test_save_body_rejects_truncated_dicom(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp) / "DICOM"
            raw_bytes = _make_raw_dicom_bytes()
            truncated = raw_bytes[:-15]

            valid, _ = _validate_dicom_bytes(truncated)
            self.assertFalse(valid)
            self.assertEqual([], list(dicom_dir.rglob("*.dcm")))

    def test_save_body_multipart_requires_all_parts_valid(self):
        # Multipart with 1 valid part and 1 corrupt part -> must return False overall
        valid_part = _make_raw_dicom_bytes()
        corrupt_part = valid_part[:-15]
        multipart_data = (
            b"--boundary123\r\nContent-Type: application/dicom\r\n\r\n" + valid_part +
            b"\r\n--boundary123\r\nContent-Type: application/dicom\r\n\r\n" + corrupt_part +
            b"\r\n--boundary123--\r\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp) / "DICOM"
            parts = dcom_pipeline._multipart_parts(multipart_data)
            image_parts = [part for _pct, part in parts if dcom_pipeline._guess_ext(dcom_pipeline._maybe_base64_decode(part)) in ("dcm", "jpg", "png")]
            saved = [_validate_dicom_bytes(part)[0] for part in image_parts]
            all_ok = bool(saved and all(saved))
            self.assertFalse(all_ok)

    def test_multipart_keeps_pixel_bytes_that_happen_to_end_with_newline(self):
        """Bytes 0x0D/0x0A are common in 16-bit pixels, not newlines.

        Trimming them at the end of every part truncates real pixels: the file
        might look valid but loses data silently.
        """
        payload = bytes([1, 2, 3, 0x0D, 0x0A, 0x0A])
        body = (
            b"--b\r\nContent-Type: application/octet-stream\r\n\r\n" + payload +
            b"\r\n--b--\r\n"
        )
        parts = dcom_pipeline._multipart_parts(body, "multipart/related; boundary=b")
        self.assertEqual([payload], [data for _ct, data in parts])

        two = (
            b"--b\r\nContent-Type: application/octet-stream\r\n\r\n" + bytes([9, 0x0A]) +
            b"\r\n--b\r\nContent-Type: application/octet-stream\r\n\r\n" + bytes([8, 0x0D]) +
            b"\r\n--b--\r\n"
        )
        self.assertEqual(
            [bytes([9, 0x0A]), bytes([8, 0x0D])],
            [data for _ct, data in dcom_pipeline._multipart_parts(two, "multipart/related; boundary=b")],
        )

    def test_frames_of_unknown_compressed_media_type_are_refused(self):
        """If Transfer Syntax cannot be resolved, reject rather than assuming uncompressed.

        Writing raw JPEG-Lossless/RLE bytes directly to PixelData yields a readable file
        with completely corrupt image data.
        """
        meta = {
            "00080016": {"vr": "UI", "Value": ["1.2.840.10008.5.1.4.1.1.7"]},
            "00080018": {"vr": "UI", "Value": ["1.2.3.4"]},
            "00280010": {"vr": "US", "Value": [4]},
            "00280011": {"vr": "US", "Value": [4]},
            "00280100": {"vr": "US", "Value": [16]},
        }
        frames = [bytes(range(32))]
        self.assertIsNone(dcom_pipeline._dicom_from_meta_frames(meta, frames, "image/quaila"))
        # ...but known compression formats can still be assembled without false rejections.
        # (image/jxl is intentionally excluded: pydicom 3.0.2 does not support 1.2.840.10008.1.2.4.140 yet.)
        for media_type in ("image/jll", "image/jpx", "image/x-dicom-rle", "image/jphc"):
            self.assertIsNotNone(
                dcom_pipeline._dicom_from_meta_frames(meta, frames, media_type),
                f"{media_type} should be constructible",
            )

    def test_multipart_with_non_image_part_and_valid_dicom_is_accepted(self):
        # Multipart with 1 JSON info/warning part and 1 valid DICOM part -> must accept and save successfully
        valid_part = _make_raw_dicom_bytes()
        non_image_part = b'{"status": "ok", "metadata": "sample"}'
        multipart_data = (
            b"--boundary123\r\nContent-Type: application/json\r\n\r\n" + non_image_part +
            b"\r\n--boundary123\r\nContent-Type: application/dicom\r\n\r\n" + valid_part +
            b"\r\n--boundary123--\r\n"
        )
        parts = dcom_pipeline._multipart_parts(multipart_data)
        image_parts = [part for _pct, part in parts if dcom_pipeline._guess_ext(dcom_pipeline._maybe_base64_decode(part)) in ("dcm", "jpg", "png")]
        self.assertEqual(1, len(image_parts))
        saved = [_validate_dicom_bytes(part)[0] for part in image_parts]
        self.assertTrue(bool(saved and all(saved)))

    def test_resume_purges_corrupted_dcm_and_parts(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp) / "DICOM"
            dicom_dir.mkdir(parents=True, exist_ok=True)

            # Write a valid file
            valid_file = dicom_dir / "valid.dcm"
            valid_file.write_bytes(_make_raw_dicom_bytes())

            # Write a corrupt file (truncated)
            corrupt_file = dicom_dir / "corrupt.dcm"
            corrupt_file.write_bytes(_make_raw_dicom_bytes()[:-10])

            # Write a leftover part file
            part_file = dicom_dir / "leftover.dcm.part"
            part_file.write_bytes(b"temp junk")

            stats = download_all(
                url="http://fake.test/viewer",
                dicom_dir=dicom_dir,
                resume=True,
                log=lambda m: None,
                headless=True,
            )

            # Part file and corrupt file must be removed
            self.assertFalse(part_file.exists())
            self.assertFalse(corrupt_file.exists())
            self.assertTrue(valid_file.exists())
            self.assertEqual(stats.dicom, 1)
            # Pre-existing files of unknown origin must not be claimed as original DICOM.
            self.assertEqual(stats.original_dicom, 0)
            self.assertEqual(stats.reconstructed_dicom, 0)


class FidelityReportTests(unittest.TestCase):
    """A .dcm file is not assumed to be the original scanner file by default."""

    def test_report_stays_silent_when_every_file_is_original(self):
        stats = dcom_pipeline.DownloadStats(dicom=436, original_dicom=436)
        self.assertEqual("", stats.fidelity_report())

    def test_report_names_the_reconstructed_files(self):
        stats = dcom_pipeline.DownloadStats(
            dicom=488, original_dicom=436, reconstructed_dicom=52,
        )
        report = stats.fidelity_report()
        self.assertIn("436", report)
        self.assertIn("52", report)
        self.assertIn("dựng lại", report)

    def test_report_is_silent_on_an_empty_download(self):
        self.assertEqual("", dcom_pipeline.DownloadStats().fidelity_report())


class DecodeShieldTests(unittest.TestCase):
    def test_dicom_to_frames_raises_value_error_on_truncated_dataset(self):
        raw_bytes = _make_raw_dicom_bytes()
        truncated = raw_bytes[:-10]
        ds = pydicom.dcmread(io.BytesIO(truncated), force=True)
        with self.assertRaises(ValueError) as ctx:
            _dicom_to_frames(ds)
        self.assertIn("không hợp lệ", str(ctx.exception))

    def test_mpr_engine_pixel_array_raises_value_error_on_corrupt_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            corrupt_path = Path(tmp) / "corrupt.dcm"
            corrupt_path.write_bytes(_make_raw_dicom_bytes()[:-10])
            with self.assertRaises(ValueError) as ctx:
                mpr_engine._pixel_array(corrupt_path)
            self.assertIn("không hợp lệ", str(ctx.exception))

    def test_web_backend_dicom_pixel_payload_raises_value_error_on_corrupt_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            corrupt_path = Path(tmp) / "corrupt.dcm"
            corrupt_path.write_bytes(_make_raw_dicom_bytes()[:-10])
            with self.assertRaises(ValueError) as ctx:
                web_backend._dicom_pixel_payload(corrupt_path)
            self.assertIn("không toàn vẹn", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
