import {
  formatDmyDate,
  computePatientAge,
  buildPatientFolderName,
  buildStudyFolderName,
  buildStudyStoragePath
} from '../lib/pacs.js';

// 1. Date formatting in DD-MM-YYYY
if (formatDmyDate('20260730') !== '30-07-2026') {
  throw new Error(`Failed YYYYMMDD: got ${formatDmyDate('20260730')}`);
}
if (formatDmyDate('2026-07-30') !== '30-07-2026') {
  throw new Error(`Failed YYYY-MM-DD: got ${formatDmyDate('2026-07-30')}`);
}
if (formatDmyDate('30/07/2026') !== '30-07-2026') {
  throw new Error(`Failed DD/MM/YYYY: got ${formatDmyDate('30/07/2026')}`);
}
if (formatDmyDate('30-07-2026') !== '30-07-2026') {
  throw new Error(`Failed DD-MM-YYYY: got ${formatDmyDate('30-07-2026')}`);
}
if (formatDmyDate('') !== 'KHONG_RO_NGAY') {
  throw new Error(`Failed empty date fallback: got ${formatDmyDate('')}`);
}

// 2. Patient Age computation
if (computePatientAge('19990101', '20260730') !== '27T') {
  throw new Error(`Failed age calculation: got ${computePatientAge('19990101', '20260730')}`);
}
if (computePatientAge('1999', '20260730') !== '27T') {
  throw new Error(`Failed 4-digit birth year age: got ${computePatientAge('1999', '20260730')}`);
}
if (computePatientAge('', '', '027Y') !== '27T') {
  throw new Error(`Failed declared age 027Y: got ${computePatientAge('', '', '027Y')}`);
}
if (computePatientAge('', '', '27T') !== '27T') {
  throw new Error(`Failed declared age 27T: got ${computePatientAge('', '', '27T')}`);
}
if (computePatientAge('', '', '') !== 'KHONG_RO_TUOI') {
  throw new Error(`Failed unknown age: got ${computePatientAge('', '', '')}`);
}

// 3. Patient folder name (Folder to)
const patientFolder = buildPatientFolderName({
  patientId: '2607053993',
  patientName: 'PHAN THI YEN LY',
  birthDate: '19990101',
  studyDate: '20260730',
  downloadDate: '07-09-2026'
});
if (patientFolder !== '2607053993 - PHAN THI YEN LY - 27T - 07-09-2026') {
  throw new Error(`Failed patient folder: got ${patientFolder}`);
}

// 4. Study folder name (Folder be)
const studyFolder = buildStudyFolderName({
  studyDate: '20260730',
  modality: 'MR',
  description: 'so nao + Gadovist'
});
if (studyFolder !== '30-07-2026 - MR - so nao + Gadovist') {
  throw new Error(`Failed study folder: got ${studyFolder}`);
}

// 5. Full storage path with DICOM
const storagePath = buildStudyStoragePath({
  patientId: '2607053993',
  patientName: 'PHAN THI YEN LY',
  birthDate: '19990101',
  studyDate: '20260730',
  modality: 'MR',
  description: 'so nao + Gadovist',
  downloadDate: '07-09-2026'
});
const expectedPath = '2607053993 - PHAN THI YEN LY - 27T - 07-09-2026/30-07-2026 - MR - so nao + Gadovist/DICOM';
if (storagePath !== expectedPath) {
  throw new Error(`Failed storage path: got ${storagePath}, expected ${expectedPath}`);
}

// 6. Test with fallback sentinels when info is missing
const fallbackPath = buildStudyStoragePath({});
const expectedFallback = 'KHONG_RO_ID - KHONG_RO_TEN - KHONG_RO_TUOI - ';
if (!fallbackPath.startsWith(expectedFallback) || !fallbackPath.includes('/KHONG_RO_NGAY - DICOM - KHONG_RO_MO_TA/DICOM')) {
  throw new Error(`Failed fallback path: got ${fallbackPath}`);
}

console.log('All storage path and folder naming tests OK');
