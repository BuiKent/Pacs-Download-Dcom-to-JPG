"""The 8-bit conversion must reproduce the window a PACS would open with.

JPG keeps a single window per image and cannot be re-windowed afterwards, so a
conversion that drifts off the clinical window is not recoverable by the viewer.
"""

from __future__ import annotations

import unittest

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, MRImageStorage, generate_uid

import dcom_pipeline


def _base_dataset(sop_class: str) -> Dataset:
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = sop_class
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelRepresentation = 0
    return ds


def _ct_slice(hu: np.ndarray, center: float, width: float) -> Dataset:
    ds = _base_dataset(CTImageStorage)
    ds.Modality = "CT"
    ds.Rows, ds.Columns = hu.shape
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.RescaleSlope = 1.0
    ds.RescaleIntercept = -1024.0
    ds.WindowCenter = center
    ds.WindowWidth = width
    ds.PixelData = (hu + 1024.0).astype(np.uint16).tobytes()
    return ds


class ClinicalWindowTests(unittest.TestCase):
    def test_window_is_absolute_not_rescaled_to_the_slice_content(self):
        """Two slices under one window must stay comparable.

        A slice holding only soft tissue does not reach either end of a brain
        window. Stretching it to its own min/max would push that narrow band
        across the full 0..255 range and make it look like a different window
        from the slice next to it.
        """
        soft_only = np.full((8, 8), 30.0)
        soft_only[4:, :] = 40.0
        frames = dcom_pipeline._dicom_to_frames(
            _ct_slice(soft_only, center=40, width=80), dcom_pipeline.CLINICAL,
        )
        image = frames[0].astype(int)

        # 30 HU and 40 HU sit inside an 80-wide window centred on 40, so neither
        # may be driven to black or white.
        self.assertGreater(image.min(), 40)
        self.assertLess(image.max(), 215)
        self.assertAlmostEqual(96, float(image[:4].mean()), delta=2)
        self.assertAlmostEqual(128, float(image[4:].mean()), delta=2)

    def test_hounsfield_window_lands_on_the_expected_grey_levels(self):
        hu = np.array([[-1000.0, 0.0, 30.0, 40.0, 80.0, 1200.0]])
        frames = dcom_pipeline._dicom_to_frames(
            _ct_slice(hu, center=40, width=80), dcom_pipeline.CLINICAL,
        )
        image = frames[0].astype(int)
        self.assertEqual(0, image[0, 0])      # air clipped to black
        self.assertEqual(0, image[0, 1])      # water at the window floor
        self.assertEqual(255, image[0, 4])    # 80 HU at the window ceiling
        self.assertEqual(255, image[0, 5])    # bone clipped to white
        # Grey/white separation must stay clearly visible.
        self.assertGreater(image[0, 3] - image[0, 2], 20)

    def test_signed_ct_uses_the_same_window_as_unsigned(self):
        """The output range depends on PixelRepresentation and the rescale."""
        hu = np.array([[-1000.0, 0.0, 30.0, 40.0, 80.0, 1200.0]])
        unsigned = dcom_pipeline._dicom_to_frames(
            _ct_slice(hu, center=40, width=80), dcom_pipeline.CLINICAL,
        )[0]

        signed_ds = _ct_slice(hu, center=40, width=80)
        signed_ds.PixelRepresentation = 1
        signed_ds.RescaleIntercept = 0.0
        signed_ds.PixelData = hu.astype(np.int16).tobytes()
        signed = dcom_pipeline._dicom_to_frames(signed_ds, dcom_pipeline.CLINICAL)[0]

        np.testing.assert_array_equal(unsigned, signed)


class VoiLutSequenceTests(unittest.TestCase):
    def test_voi_lut_sequence_is_applied_not_replaced_by_a_stretch(self):
        """A non-linear VOI LUT must drive the output, not a percentile stretch.

        The LUT is indexed by pixel value, so the array handed to pydicom keeps
        its integer dtype — on a float input pydicom warns that the result may
        be incorrect, because the index is truncated to the wrong table entry.
        """
        ds = _base_dataset(MRImageStorage)
        ds.Modality = "MR"
        ds.Rows, ds.Columns = 1, 4
        ds.BitsAllocated = 8
        ds.BitsStored = 8
        ds.HighBit = 7
        pixels = np.array([[0, 85, 170, 255]], dtype=np.uint8)
        ds.PixelData = pixels.tobytes()

        lut = Dataset()
        lut.LUTDescriptor = [256, 0, 8]
        # A descending ramp: the output is recognisable only if the LUT ran.
        lut.LUTData = [255 - index for index in range(256)]
        ds.VOILUTSequence = pydicom.Sequence([lut])

        image = dcom_pipeline._dicom_to_frames(ds, dcom_pipeline.CLINICAL)[0]
        np.testing.assert_array_equal(np.array([[255, 170, 85, 0]], dtype=np.uint8), image)


class AutoContrastTests(unittest.TestCase):
    def test_auto_mode_still_stretches_per_slice(self):
        """AUTO is documented as ignoring the clinical window; keep it that way."""
        hu = np.linspace(-100, 100, 64).reshape(8, 8)
        image = dcom_pipeline._dicom_to_frames(
            _ct_slice(hu, center=40, width=80), dcom_pipeline.AUTO,
        )[0]
        self.assertEqual(0, int(image.min()))
        self.assertEqual(255, int(image.max()))


if __name__ == "__main__":
    unittest.main()
