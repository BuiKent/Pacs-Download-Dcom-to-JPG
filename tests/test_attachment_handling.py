"""Detection and retrieval of non-DICOM clinical documents (report PDF, TXT, Word)."""
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from dcom_pipeline import (
    ViewerCapture,
    _attachment_filename,
    _inspect_attachment_candidate,
    download_attachments,
)


def _response(url: str, **headers) -> MagicMock:
    response = MagicMock()
    response.url = url
    response.headers = headers
    return response


class TestAttachmentDetection(unittest.TestCase):
    def test_capture_carries_attachments_into_legacy_dict(self):
        cap = ViewerCapture()
        self.assertEqual(cap.discovered_attachments, [])
        self.assertEqual(cap.as_legacy_dict()["discovered_attachments"], [])

    def test_pdf_response_is_recorded_with_disposition_name(self):
        cap = ViewerCapture()
        recorded = _inspect_attachment_candidate(_response(
            "https://pacs.example.com/api/v1/report/print?studyUid=1.2.3.4",
            **{
                "content-type": "application/pdf",
                "content-length": "12345",
                "content-disposition": 'attachment; filename="Ket_qua_MRI_So_nao.pdf"',
            },
        ), cap)
        self.assertTrue(recorded)
        self.assertEqual(len(cap.discovered_attachments), 1)
        attachment = cap.discovered_attachments[0]
        self.assertEqual(attachment["type"], "pdf")
        self.assertEqual(attachment["name"], "Ket_qua_MRI_So_nao.pdf")
        self.assertEqual(attachment["size"], 12345)

    def test_word_and_text_reports_are_recorded_but_assets_are_not(self):
        cap = ViewerCapture()
        self.assertTrue(_inspect_attachment_candidate(_response(
            "https://pacs.example.com/reports/phieu_kham.docx",
            **{"content-type": "application/vnd.openxmlformats-officedocument"
                               ".wordprocessingml.document"},
        ), cap))
        self.assertTrue(_inspect_attachment_candidate(_response(
            "https://pacs.example.com/api/clinical_report_summary.txt",
            **{"content-type": "text/plain"},
        ), cap))
        self.assertFalse(_inspect_attachment_candidate(_response(
            "https://pacs.example.com/assets/bundle.js",
            **{"content-type": "application/javascript"},
        ), cap))
        self.assertEqual(len(cap.discovered_attachments), 2)

    def test_plain_text_without_report_hint_is_ignored(self):
        """A token or heartbeat body is text/plain too; DOCUMENTS/ must stay clean."""
        cap = ViewerCapture()
        self.assertFalse(_inspect_attachment_candidate(_response(
            "https://pacs.example.com/api/session/token",
            **{"content-type": "text/plain"},
        ), cap))
        self.assertEqual(cap.discovered_attachments, [])

    def test_same_url_is_recorded_once(self):
        cap = ViewerCapture()
        url = "https://pacs.example.com/report/1.pdf"
        self.assertTrue(_inspect_attachment_candidate(
            _response(url, **{"content-type": "application/pdf"}), cap))
        self.assertFalse(_inspect_attachment_candidate(
            _response(url, **{"content-type": "application/pdf"}), cap))
        self.assertEqual(len(cap.discovered_attachments), 1)


class TestAttachmentFilename(unittest.TestCase):
    def test_directory_parts_cannot_escape_the_documents_folder(self):
        self.assertEqual(
            _attachment_filename("../../../Windows/System32/evil.exe", "pdf", 1),
            "evil.exe")
        self.assertEqual(_attachment_filename("C:\\Users\\report.pdf", "pdf", 1), "report.pdf")

    def test_percent_encoded_name_is_decoded(self):
        self.assertEqual(
            _attachment_filename("Ket%20qua%20MRI.pdf", "pdf", 1), "Ket qua MRI.pdf")

    def test_missing_name_falls_back_to_the_type_extension(self):
        self.assertEqual(_attachment_filename("", "pdf", 3), "Bao_cao_3.pdf")
        self.assertEqual(_attachment_filename("", "text", 2), "Bao_cao_2.txt")
        self.assertEqual(_attachment_filename("summary", "text", 1), "summary.txt")
        self.assertEqual(_attachment_filename("", "", 1), "Bao_cao_1.bin")


class TestAttachmentDownload(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.docs_dir = self.tmp_dir / "DOCUMENTS"

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _opener(self, bodies: dict) -> MagicMock:
        """Fake urllib opener answering each URL with the bytes given."""
        def _open(request, *_args, **_kwargs):
            response = MagicMock()
            response.read.return_value = bodies[request.full_url]
            response.__enter__.return_value = response
            return response

        opener = MagicMock()
        opener.open.side_effect = _open
        return opener

    def test_documents_land_in_their_own_folder(self):
        report = b"%PDF-1.4 dummy clinical report data"
        summary = b"Patient diagnosis: Normal MRI Brain"
        attachments = [
            {"id": "att_1", "name": "Bao_cao_chan_doan.pdf",
             "url": "https://example.com/report.pdf", "type": "pdf"},
            {"id": "att_2", "name": "Tom_tat_benh_an.txt",
             "url": "https://example.com/summary.txt", "type": "text"},
        ]
        opener = self._opener({
            "https://example.com/report.pdf": report,
            "https://example.com/summary.txt": summary,
        })
        with patch("urllib.request.build_opener", return_value=opener):
            downloaded = download_attachments(attachments, self.docs_dir, log=lambda _m: None)
        self.assertEqual(downloaded, 2)
        self.assertEqual((self.docs_dir / "Bao_cao_chan_doan.pdf").read_bytes(), report)
        self.assertEqual((self.docs_dir / "Tom_tat_benh_an.txt").read_bytes(), summary)

    def test_session_headers_and_cookies_travel_with_the_request(self):
        cap = ViewerCapture()
        cap.session_headers = {"https://pacs.example.com": {"Authorization": "Bearer abc"}}
        cap.cookies = [{"name": "SID", "value": "xyz", "domain": "pacs.example.com",
                        "path": "/", "secure": True}]
        url = "https://pacs.example.com/report/1.pdf"
        opener = self._opener({url: b"%PDF-1.4"})
        with patch("urllib.request.build_opener", return_value=opener):
            download_attachments(
                [{"name": "1.pdf", "url": url, "type": "pdf"}],
                self.docs_dir, log=lambda _m: None, captured=cap)
        sent = opener.open.call_args[0][0]
        self.assertEqual(sent.get_header("Authorization"), "Bearer abc")
        self.assertIn("SID=xyz", sent.get_header("Cookie"))

    def test_colliding_names_do_not_overwrite_each_other(self):
        attachments = [
            {"name": "report.pdf", "url": "https://example.com/a", "type": "pdf"},
            {"name": "report.pdf", "url": "https://example.com/b", "type": "pdf"},
        ]
        opener = self._opener({
            "https://example.com/a": b"first",
            "https://example.com/b": b"second",
        })
        with patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(
                download_attachments(attachments, self.docs_dir, log=lambda _m: None), 2)
        self.assertEqual((self.docs_dir / "report.pdf").read_bytes(), b"first")
        self.assertEqual((self.docs_dir / "report (2).pdf").read_bytes(), b"second")

    def test_a_failed_download_leaves_no_empty_documents_folder(self):
        opener = MagicMock()
        opener.open.side_effect = OSError("het han phien")
        logs: list[str] = []
        with patch("urllib.request.build_opener", return_value=opener):
            downloaded = download_attachments(
                [{"name": "1.pdf", "url": "https://example.com/1.pdf", "type": "pdf"}],
                self.docs_dir, log=logs.append)
        self.assertEqual(downloaded, 0)
        self.assertFalse(self.docs_dir.exists())
        self.assertTrue(any("Không tải được tài liệu" in line for line in logs))


if __name__ == "__main__":
    unittest.main()
