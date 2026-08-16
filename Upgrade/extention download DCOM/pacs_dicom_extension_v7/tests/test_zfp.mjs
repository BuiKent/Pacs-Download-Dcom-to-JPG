/**
 * GE Centricity Universal Viewer (ZFP).
 */
import { zfpMetaToDicomJson, zfpSeriesChoices } from '../lib/pacs.js';
import { buildPart10FromFrames, validatePart10, parseDicomMeta } from '../lib/dicom.js';
import { ZfpAdapter } from '../lib/adapters/zfp.js';

const STUDY_UID = '123.184384745292962.1865061923111538';
const SERIES_UID = '1.2.840.113619.2.388.10502719.2141743.14995.1778656444.162';
const SOP_UID = '1.2.840.113619.2.388.10502719.2141743.14122.1778656483.440';

const sopRow = {
  sopClassUid: '1.2.840.10008.5.1.4.1.1.4', sopInstanceUid: SOP_UID, instanceNumber: 1,
  seriesInstanceUid: SERIES_UID,
  imageOrientation: {rowX: 1, rowY: -0, rowZ: 0, columnX: -0, columnY: 0.945525, columnZ: -0.3255496},
  imagePosition: '-118.008\\-126.473\\-42.7255',
  pixelSpacing: {physicalDeltaX: 0.4688, physicalDeltaY: 0.4688},
  sliceLocation: '-81.71514893',
};
const group = {
  studyInstanceUid: STUDY_UID, groupId: `${STUDY_UID}#${SERIES_UID}#0`,
  description: 'Ax FSPGR 3D contrast', groupDisplayId: '4', modalities: ['MR'],
  dicomSops: [sopRow, {...sopRow, sopInstanceUid: SOP_UID + '1', instanceNumber: 2}],
};
const screenSaveA = {studyInstanceUid: STUDY_UID, groupId: STUDY_UID + '#a#0', description: 'Screen Save',
  groupDisplayId: '20002', modalities: ['MR'], dicomSops: [{...sopRow, sopInstanceUid: 'a.1', seriesInstanceUid: 'series.a'}]};
const screenSaveB = {studyInstanceUid: STUDY_UID, groupId: STUDY_UID + '#b#0', description: 'Screen Save',
  groupDisplayId: '20004', modalities: ['MR'], dicomSops: [{...sopRow, sopInstanceUid: 'b.1', seriesInstanceUid: 'series.b'}]};
const study = {
  patientDemographics: {patientName: {personNameString: 'NGUYEN THI PHUONG  1961 F'},
    patientId: '25050532', patientSex: 'F', patientBirthDate: '1961-01-01', accessionNumber: '5260038152'},
  studyDateTime: '2026-05-13 17:26:52',
  mappedStudyDescription: {[STUDY_UID]: 'Unspecified MR'},
};
const meta = {
  sopClassUid: '1.2.840.10008.5.1.4.1.1.4', sopInstanceUid: SOP_UID, seriesInstanceUid: SERIES_UID,
  instanceNumber: 1, dimensions: {rows: 8, columns: 8}, bitsAllocated: 16, bitsStored: 16,
  highBit: 15, pixelRepresentation: 1, samplesPerPixel: 1, photometricInterpretation: 'MONOCHROME2',
  numberOfFrames: 1, windowLevel: {windowWidth: 4871, windowCenter: 2435},
  rescaleInfo: {intercept: 0, slope: 1}, manufacturer: 'GE MEDICAL SYSTEMS',
  manufacturerModelName: 'SIGNA', institutionName: 'BVTN', stationName: 'MR1',
  imageDate: '2026-05-13', imageTime: '17:29:45',
};

// 1. Reconstruct readable DICOM Part-10, preserving patient identity.
const dj = zfpMetaToDicomJson(meta, sopRow, group, study);
const pixels = new Uint8Array(8 * 8 * 2);
for (let i = 0; i < pixels.length; i++) pixels[i] = i & 0xff;
const dcm = buildPart10FromFrames(dj, [pixels], 'application/octet-stream; transfer-syntax=1.2.840.10008.1.2.1');
const v = validatePart10(dcm);
if (!v.ok) throw new Error('DICOM constructed from ZFP invalid: ' + v.reason);
const p = parseDicomMeta(dcm);
if (p.patientName !== 'NGUYEN THI PHUONG 1961 F') throw new Error('Wrong patientName: ' + p.patientName);
if (p.patientId !== '25050532') throw new Error('Wrong patientId: ' + p.patientId);
if (p.studyDate !== '20260513') throw new Error('Wrong studyDate: ' + p.studyDate);
if (p.seriesDescription !== 'Ax FSPGR 3D contrast') throw new Error('Wrong seriesDescription');

// 2. Format times to remove colons.
if (dj['00080031'].Value[0] !== '172945') throw new Error('Image time must strip colons: ' + dj['00080031'].Value[0]);
if (dj['00080030'].Value[0] !== '172652') throw new Error('Study time must strip colons');

// 3. Duplicate series names have distinct ids.
const choices = zfpSeriesChoices([group, screenSaveA, screenSaveB]);
if (new Set(choices.map(c => c.id)).size !== 3) throw new Error('Duplicate series ids');
if (choices[0].imageCount !== 2) throw new Error('Wrong image count');

// 4. Enumerate produces valid tasks with complete reconstruction data.
const ctx = {summary: {zfpInfo: {groups: [group, screenSaveA], study}}, normalizeStudy: x => x};
const inv = await ZfpAdapter.analyze(ctx);
if (inv.patient.id !== '25050532') throw new Error('analyze read wrong patient');
if (inv.series.length !== 2) throw new Error('analyze read wrong series count');
const tasks = await ZfpAdapter.enumerate(inv, [choices[0].id], ctx);
if (tasks.length !== 2) throw new Error('enumerate wrong task count: ' + tasks.length);
for (const t of tasks) {
  if (t.strategy !== 'zfp-image') throw new Error('Wrong strategy');
  if (!t.zfp?.sop.endsWith('#0')) throw new Error('SOP must have frame #0 suffix');
  if (!t.zfp?.sopRow || !t.zfp?.group || !t.zfp?.study) throw new Error('Task missing DICOM reconstruction data');
  if (!t.relativePath.startsWith('01 - 4 - Ax FSPGR 3D contrast/')) throw new Error('Wrong relative path: ' + t.relativePath);
}

console.log('GE ZFP tests OK');

