import unittest
from pathlib import Path
import tempfile
import shutil
import io

from dcom_pipeline import (
    _normalise_manual_birth_date,
    extract_patient_metadata_bytes,
    extract_patient_metadata,
)
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset

class TestManualInfo(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        
    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_dummy_dicom_bytes(self, **kwargs):
        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = pydicom.uid.ImplicitVRLittleEndian
        ds.file_meta.MediaStorageSOPClassUID = pydicom.uid.CTImageStorage
        ds.file_meta.MediaStorageSOPInstanceUID = "1.2.3.4.5"
        
        for k, v in kwargs.items():
            setattr(ds, k, v)
            
        with io.BytesIO() as fp:
            pydicom.filewriter.dcmwrite(fp, ds, write_like_original=False)
            return fp.getvalue()

    def test_normalise_manual_birth_date(self):
        self.assertEqual(_normalise_manual_birth_date("1990"), "1990-01-01")
        self.assertEqual(_normalise_manual_birth_date("1990-10-25"), "1990-10-25")
        self.assertEqual(_normalise_manual_birth_date("25/10/1990"), "1990-10-25")
        self.assertEqual(_normalise_manual_birth_date("25-10-1990"), "1990-10-25")
        self.assertEqual(_normalise_manual_birth_date("  1990  "), "1990-01-01")
        self.assertEqual(_normalise_manual_birth_date(""), "")
        self.assertEqual(_normalise_manual_birth_date("invalid"), "")
        self.assertEqual(_normalise_manual_birth_date("19901025"), "1990-10-25")
        self.assertEqual(_normalise_manual_birth_date("1990/10/25"), "1990-10-25")
        self.assertEqual(_normalise_manual_birth_date("31/02/1990"), "")
        self.assertEqual(_normalise_manual_birth_date("45/13/1990"), "")
        self.assertEqual(_normalise_manual_birth_date("0/0/1990"), "")
    def test_extract_patient_metadata_bytes_with_manual_info(self):
        dicom_bytes = self._create_dummy_dicom_bytes(
            PatientName="",
            PatientID="",
            PatientBirthDate="",
            PatientAge="",
            StudyDate="20231025"
        )
            
        manual_info = {
            "patientName": "Nguyen Van A",
            "patientId": "12345678",
            "patientDob": "25/10/1990"
        }
        
        metadata = extract_patient_metadata_bytes(dicom_bytes, manual_info=manual_info)
        
        self.assertEqual(metadata["PatientName"], "Nguyen Van A")
        self.assertEqual(metadata["PatientID"], "12345678")
        self.assertEqual(metadata["PatientBirthDate"], "1990-10-25")
        self.assertEqual(metadata["PatientAgeYears"], 33)

    def test_extract_patient_metadata_bytes_without_override(self):
        dicom_bytes = self._create_dummy_dicom_bytes(
            PatientName="Real Patient",
            PatientID="REAL123",
            PatientBirthDate="20000101",
            PatientAge="",
            StudyDate="20231025"
        )
            
        manual_info = {
            "patientName": "Nguyen Van A",
            "patientId": "12345678",
            "patientDob": "25/10/1990"
        }
        
        metadata = extract_patient_metadata_bytes(dicom_bytes, manual_info=manual_info)
        
        self.assertEqual(metadata["PatientName"], "Real Patient")
        self.assertEqual(metadata["PatientID"], "REAL123")
        self.assertEqual(metadata["PatientBirthDate"], "2000-01-01")

    def test_extract_patient_metadata_with_manual_info_dir(self):
        dicom_bytes = self._create_dummy_dicom_bytes(
            PatientName="",
            PatientID="",
            PatientBirthDate="",
            PatientAge="",
            StudyDate="20231025"
        )
        test_file = self.temp_dir / "test.dcm"
        test_file.write_bytes(dicom_bytes)

        manual_info = {
            "patientName": "Tran Van B",
            "patientId": "87654321",
            "patientDob": "15/05/1985"
        }

        metadata = extract_patient_metadata(self.temp_dir, manual_info=manual_info)

        self.assertEqual(metadata["PatientName"], "Tran Van B")
        self.assertEqual(metadata["PatientID"], "87654321")
        self.assertEqual(metadata["PatientBirthDate"], "1985-05-15")
        self.assertEqual(metadata["PatientAgeYears"], 38)

if __name__ == '__main__':
    unittest.main()
