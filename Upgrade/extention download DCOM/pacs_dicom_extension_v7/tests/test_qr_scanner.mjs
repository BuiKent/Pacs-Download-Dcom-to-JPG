import { parseQrResult, isLikelyPacsViewerUrl, scanRawImageData, scanWithBarcodeDetector } from '../lib/qr_decoder.js';

// 1. Test parseQrResult
const r1 = parseQrResult('https://pacs.bvbachmai.vn/viewer?studyuid=1.2.840.123');
if (!r1.isUrl || r1.url !== 'https://pacs.bvbachmai.vn/viewer?studyuid=1.2.840.123') {
  throw new Error('parseQrResult standard URL failed');
}

const r2 = parseQrResult('pacs.choray.vn/portal/patient?id=9988');
if (!r2.isUrl || r2.url !== 'https://pacs.choray.vn/portal/patient?id=9988') {
  throw new Error('parseQrResult domain format failed');
}

const r3 = parseQrResult('BN: NGUYEN VAN A - MA BN: 12345');
if (r3.isUrl || r3.text !== 'BN: NGUYEN VAN A - MA BN: 12345') {
  throw new Error('parseQrResult plain text failed');
}

// 2. Test isLikelyPacsViewerUrl
if (!isLikelyPacsViewerUrl('https://vietmy.pmr.vn/Pages/ShareStudy.aspx?stoken=xyz')) {
  throw new Error('isLikelyPacsViewerUrl VietMy failed');
}
if (!isLikelyPacsViewerUrl('https://hospital.vn/dicomweb/studies/1.2.3')) {
  throw new Error('isLikelyPacsViewerUrl DICOMweb failed');
}
if (!isLikelyPacsViewerUrl('https://ketqua.medlatec.vn/tra-cuu?token=123')) {
  throw new Error('isLikelyPacsViewerUrl Portal failed');
}
if (isLikelyPacsViewerUrl('https://randomnews.com/article/123')) {
  throw new Error('isLikelyPacsViewerUrl false positive on non-medical URL');
}

// 3. Test jsQR scanRawImageData with mock or blank
const blankData = new Uint8ClampedArray(100 * 100 * 4);
const blankResult = scanRawImageData(blankData, 100, 100);
if (blankResult !== null) {
  throw new Error('scanRawImageData should return null on blank data');
}

// 4. Test mock BarcodeDetector integration
globalThis.BarcodeDetector = class MockBarcodeDetector {
  constructor(options) {
    this.options = options;
  }
  async detect(source) {
    return [{ rawValue: 'https://pacs.example.com/viewer?id=456' }];
  }
};

const mockResult = await scanWithBarcodeDetector({});
if (mockResult !== 'https://pacs.example.com/viewer?id=456') {
  throw new Error('scanWithBarcodeDetector with mock failed');
}

console.log('QR scanner module tests OK');
