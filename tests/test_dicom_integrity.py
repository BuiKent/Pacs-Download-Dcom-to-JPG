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
        # CA1: Chỉ có Basic Offset Table rỗng, mất sạch fragment ảnh
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
        # CA3: RLE Lossless bị cắt cụt header hoặc offset vượt quá độ dài
        from pydicom.uid import RLELossless
        bot_only = b"\xfe\xff\x00\xe0\x00\x00\x00\x00"
        # RLE fragment quá ngắn (<64 bytes)
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
        # Xóa TransferSyntaxUID khỏi file_meta
        if hasattr(ds.file_meta, "TransferSyntaxUID"):
            delattr(ds.file_meta, "TransferSyntaxUID")
        valid, reason = _is_dicom_dataset_valid_for_decode(ds)
        self.assertTrue(valid)

    def test_valid_encapsulated_without_bot_item_is_accepted(self):
        # File JPEG 2000 hợp lệ chỉ có 1 fragment chứa codestream ảnh (không có item BOT riêng)
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
        # Luồng MPEG/H.264 không kết thúc bằng \xff\xd9 và có Basic Offset Table
        # rỗng đúng chuẩn — không được loại nhầm chỉ vì fragment đầu rỗng.
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
        # Multipart chứa 1 phần hợp lệ và 1 phần bị hỏng -> toàn bộ phải trả về False
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

    def test_multipart_with_non_image_part_and_valid_dicom_is_accepted(self):
        # Multipart chứa 1 part JSON cảnh báo/thông tin và 1 part DICOM lành -> phải chấp nhận và lưu thành công
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
